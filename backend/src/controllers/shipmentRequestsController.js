/**
 * Shipment requests: sales asks, the vendors team places, and each placed truck becomes a transport order.
 * One API serves three sections (Shipment Orders, Sales, Vendors Management), so a request written on any of their
 * screens is the same row on the others and every change is announced once (`shipmentRequests:changed`).
 */
const mongoose = require('mongoose');
const ShipmentRequest = require('../models/ShipmentRequest');
const ShipmentOrder = require('../models/ShipmentOrder');
const ShipmentOrderCustomer = require('../models/ShipmentOrderCustomer');
const ShipmentOrderField = require('../models/ShipmentOrderField');
const so = require('./shipmentOrdersController');
const PV = require('../config/priceView');
const { TOP_ROLES } = require('../config/constants');
const { DATA_ROLES } = require('../config/roles');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const { startOfDay, endOfDay } = require('../utils/companyDay');
const { sendMongooseError } = require('../utils/mongooseError');

const EVENT = 'shipmentRequests:changed';
const SO_TEAM = ['shipment_orders_manager', 'shipment_orders_team_leader', 'shipment_orders_staff', 'operations_manager', 'operations_team_leader', 'operations_staff'];
/** Who writes the sales half (create, amend, resend, withdraw). */
const ASKERS = [...TOP_ROLES, ...DATA_ROLES, ...PV.SALES_ROLES, ...SO_TEAM];
/** Who places or rejects (the vendors half). */
const PLACERS = [...TOP_ROLES, ...DATA_ROLES, ...PV.VENDOR_ROLES, ...SO_TEAM];
/** Our own fleet works the same board: claims, records sourced trucks and completes on our trucks (fleet-place). */
const FLEET_TEAM = PV.FLEET_ROLES;
const FLEET_NAME = 'النقل الثقيل';
const FLEET_PLACERS = [...TOP_ROLES, ...DATA_ROLES, 'operations_manager', 'operations_team_leader', 'operations_staff', ...FLEET_TEAM];
/** Who claims and records «تحصيل السيارات». */
const WORKERS = [...new Set([...PLACERS, ...FLEET_TEAM])];
const READERS = [...new Set([...ASKERS, ...PLACERS, ...FLEET_TEAM, 'shipment_orders_followup'])];
/** Leads edit or delete a colleague's sourcing entry and complete a request a colleague holds. */
const LEADS = [...TOP_ROLES, ...PV.VENDOR_LEADS, 'operations_manager', 'operations_team_leader', 'shipment_orders_manager', 'shipment_orders_team_leader', 'fleet_manager', 'fleet_team_leader'];
const CLAIM_MS = 60 * 60 * 1000;

const { rightsRoleOf } = require('../config/roles');
const inList = (list, u) => !!u && (list.includes(u.role) || list.includes(rightsRoleOf(u.role)));
const isAsker = (u) => inList(ASKERS, u);
const isPlacer = (u) => inList(PLACERS, u);
const isWorker = (u) => inList(WORKERS, u);
const isFleetPlacer = (u) => inList(FLEET_PLACERS, u);
const isLead = (u) => inList(LEADS, u);
const fullName = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');
/** The team acting: fleet members always act as the fleet; others act as the fleet only from the fleet's page. */
const teamOf = (req) => {
  if (FLEET_TEAM.includes(req.user?.role)) return 'fleet';
  const asked = String(req.body?.team || req.query?.team || '');
  return asked === 'fleet' && isFleetPlacer(req.user) ? 'fleet' : 'vendors';
};
const shownName = (team, user) => (team === 'fleet' ? FLEET_NAME : fullName(user));
const canOf = (u) => ({ ask: isAsker(u), place: isPlacer(u), work: isWorker(u), fleet: isFleetPlacer(u), lead: isLead(u) });

// ── Sales-manager approval ─────────────────────────────────────────────────
/** Approved or from before the rule: what the working board (vendors, operations, fleet) may see. */
const APPROVED = { approvalStatus: { $in: [null, 'approved'] } };
const notApproved = (r) => ['pending', 'returned', 'rejected'].includes(r?.approvalStatus || '');
const Settings = () => require('mongoose').model('ShipmentRequestSettings');
async function approverIds() {
  const s = await Settings().findOne({ key: 'main' }).select('approvers').lean();
  return (s?.approvers || []).map(String);
}
const isSalesManager = (u) => !!u && (rightsRoleOf(u.role) === 'sales_manager' || require('../config/constants').isTopRole(u.role));
async function canApprove(u) {
  if (!u) return false;
  if (isSalesManager(u)) return true;
  return PV.isSalesRole(u) && (await approverIds()).includes(String(u._id));
}
/** A sales member's request waits for approval; the manager's own, top roles' and other sections' do not. */
const needsApproval = (u) => PV.isSalesRole(u) && !isSalesManager(u);
async function notifyApprovers(title, message, id, exceptId) {
  try {
    const User = require('../models/User');
    const ids = new Set([...(await User.find({ role: 'sales_manager', isActive: { $ne: false } }).select('_id').lean()).map((u) => String(u._id)), ...(await approverIds())]);
    ids.delete(String(exceptId || ''));
    for (const uid of ids) {
      // eslint-disable-next-line no-await-in-loop
      await require('../services/notificationService').createNotification({ recipient: uid, type: 'approval_needed', title, message, relatedEntity: 'ShipmentRequestApproval', relatedEntityId: id });
    }
  } catch (_) { /* a notification never blocks the work */ }
}
// A request change moves the analytics (requests funnel, vendors daily page): their caches go before the event.
const emit = (payload) => {
  try { require('../utils/ttlCache').clear('so:analytics:'); } catch (_) { /* */ }
  try { emitToAll(EVENT, payload || {}); } catch (_) { /* */ }
};
const OPEN = ['pending', 'in_progress'];

/** The sales half as written on a request: the shipment form's fields that belong to sales. */
const SALES_FIELDS = ['customer', 'fromCity', 'toCity', 'branch', 'notes', 'blNumber', 'containerNumber',
  'truckType', 'truckTypes', 'cargoType', 'truckLength', 'quantity', 'pickupTime', 'startTime', 'arrivalTime',
  'sellPrice', 'paymentSubtype', 'paymentMethod', 'customFields'];
const TYPE_SEP = ' / ';
/** Accepted truck types: a list from the multi-choice, or the legacy single value; `truckType` becomes their joined label. */
function applyTruckTypes(data) {
  if (data.truckTypes === undefined && data.truckType === undefined) return;
  const raw = data.truckTypes !== undefined ? data.truckTypes : String(data.truckType || '').split(TYPE_SEP);
  const list = [...new Set((Array.isArray(raw) ? raw : [raw]).map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 10);
  data.truckTypes = list;
  data.truckType = list.join(TYPE_SEP);
}
/** Types a request accepts, including old rows that only have the single field. */
const typesOf = (r) => ((r.truckTypes && r.truckTypes.length) ? r.truckTypes : String(r.truckType || '').split(TYPE_SEP).map((x) => x.trim()).filter(Boolean));
/** Keys of the shipment form that the vendors team answers when placing. */
const VENDOR_FORM_KEYS = new Set(['buyPrice', 'advanceAmount', 'driverRentPrice', 'driverName', 'driverPhone', 'vehicleName', 'driverRentType']);
const DATE_KEYS = ['pickupTime', 'startTime', 'arrivalTime'];

const pick = (body, keys) => Object.fromEntries(keys.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
const bad = (res, message, extra = {}) => res.status(400).json({ message, ...extra });

/** A sales rep sees what they asked for or what is written on them; everyone else in the readers sees all. */
const scopeFor = (user) => {
  if (user?.role === 'sales_rep' || user?.role === 'sales_trainee') {
    return { $or: [{ createdBy: user._id }, { salesRep: user._id }] };
  }
  return {};
};

/** The request as this reader receives it: who may see the selling price is config/priceView requestSellVisible. */
const shape = (user, doc) => {
  if (!doc) return doc;
  const o = typeof doc.toObject === 'function' ? doc.toObject({ virtuals: true }) : { ...doc };
  o.truckTypes = typesOf(o);
  o.open = Math.max(0, (o.trucks || 0) - (o.placed || []).length);
  o.sourced = (o.sourcing || []).reduce((n, e) => n + (Number(e.count) || 0), 0);
  if (!PV.requestSellVisible(user)) delete o.sellPrice;
  delete o.lockUntil;
  return o;
};

/**
 * A claim lasts one hour. Expired claims are released here, lazily on reads (throttled) and by the sweep, each with an
 * `expired` log entry dated when the hour ran out, so analytics count it on the right day.
 * The update is conditional on the same holder and deadline, so two workers never release one claim twice.
 */
let lastSweep = 0;
async function expireClaims({ id = null, force = false } = {}) {
  const now = Date.now();
  if (!id && !force && now - lastSweep < 15 * 1000) return 0;
  if (!id) lastSweep = now;
  const q = {
    status: { $in: OPEN }, handler: { $ne: null },
    $or: [{ claimedUntil: { $lt: new Date(now) } }, { claimedUntil: null, handledAt: { $lt: new Date(now - CLAIM_MS) } }],
  };
  if (id) q._id = id;
  const due = await ShipmentRequest.find(q).select('handler handlerName handlerTeam claimedUntil handledAt').lean();
  let n = 0;
  for (const r of due) {
    const endedAt = r.claimedUntil || new Date(new Date(r.handledAt || now).getTime() + CLAIM_MS);
    // eslint-disable-next-line no-await-in-loop
    const out = await ShipmentRequest.updateOne(
      { _id: r._id, handler: r.handler, claimedUntil: r.claimedUntil || null },
      {
        $set: { handler: null, handlerName: '', handledAt: null, claimedUntil: null, handlerTeam: '' },
        $push: { log: { action: 'expired', by: r.handler, byName: r.handlerName, team: r.handlerTeam || '', note: 'انتهت ساعةُ التولّي', at: endedAt } },
      },
    );
    if (out.modifiedCount) n += 1;
  }
  if (n) emit({ expired: n });
  return n;
}
exports.expireClaims = expireClaims;
/** Sweep for claims nobody reads: every two minutes on each worker; the conditional update keeps it single. */
exports.startClaimSweep = () => {
  const t = setInterval(() => { expireClaims({ force: true }).catch(() => {}); }, 2 * 60 * 1000);
  if (t.unref) t.unref();
};

const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

/** Cleans and checks the sales half; returns an error message or null. */
async function prepareSalesHalf(req, data, { creating }) {
  for (const k of DATE_KEYS) if (k in data) data[k] = data[k] ? new Date(data[k]) : null;
  if ('quantity' in data) data.quantity = numOrNull(data.quantity);
  if ('sellPrice' in data) data.sellPrice = numOrNull(data.sellPrice);
  applyTruckTypes(data);
  if ('trucks' in req.body) {
    const n = Math.floor(Number(req.body.trucks));
    if (!Number.isFinite(n) || n < 1 || n > 25) return 'عددُ الشاحنات بين واحدةٍ وخمسٍ وعشرين';
    data.trucks = n;
  }
  try { so.applyPaymentSubtype(data); } catch (e) { return e.message; }
  const branchError = await require('../utils/branchList').applyBranchList(data);
  if (branchError) return branchError;
  await so.resolveInlineCustomer(req, data);
  if (data.customer) {
    if (!mongoose.isValidObjectId(String(data.customer))) return 'العميلُ غير صالح';
    const c = await ShipmentOrderCustomer.findById(data.customer).select('name').lean();
    if (!c) return 'العميلُ غير موجود';
    data.customerName = c.name;
  }
  // The operational sales person: chosen, or the sales member asking.
  const body = { ...req.body };
  if (body.salesRep === undefined && creating && PV.isSalesRole(req.user)) body.salesRep = String(req.user._id);
  try { await so.applySalesRep(data, body); } catch (e) { return e.message; }

  // What a transport order cannot be born without, plus whatever section settings mark required on the sales half.
  const need = (k) => data[k] == null || String(data[k]).trim() === '';
  if (creating || 'sellPrice' in data) {
    if (!(Number(data.sellPrice) > 0)) return { message: 'سعرُ البيع مطلوبٌ في طلب الشحنة', fields: ['sellPrice'] };
  }
  if (creating) {
    const fields = await ShipmentOrderField.find({ active: { $ne: false }, deleted: { $ne: true }, required: true }).select('key labelAr').lean();
    const missing = [];
    if (!data.customer) missing.push({ key: 'customer', labelAr: 'العميل' });
    for (const f of fields) {
      // Pickup, start and arrival times are written by whoever completes the truck, not by sales.
      if (VENDOR_FORM_KEYS.has(f.key) || f.key === 'status' || DATE_KEYS.includes(f.key)) continue;
      const v = SALES_FIELDS.includes(f.key) ? data[f.key] : data.customFields?.[f.key];
      if (v == null || String(v).trim() === '') missing.push(f);
    }
    for (const k of ['fromCity', 'toCity']) if (need(k) && !missing.some((m) => m.key === k)) missing.push({ key: k, labelAr: k === 'fromCity' ? 'من المدينة' : 'إلى المدينة' });
    if (missing.length) return { message: `أكمِل: ${missing.map((m) => m.labelAr || m.key).join('، ')}`, fields: missing.map((m) => m.key) };
  }
  return null;
}

const errOut = (res, e) => (typeof e === 'string' ? bad(res, e) : bad(res, e.message, { fields: e.fields }));

async function notifyUser(userId, title, message, id) {
  if (!userId) return;
  try {
    await require('../services/notificationService').createNotification({
      recipient: userId, type: 'status_changed', title, message, relatedEntity: 'ShipmentRequestReply', relatedEntityId: id,
    });
  } catch (_) { /* a notification never blocks the work */ }
}
async function notifyVendors(title, message, id) {
  try {
    await require('../services/notificationService').notifySection('Vendors Management', { type: 'approval_needed', title, message, relatedEntity: 'ShipmentRequest', relatedEntityId: id });
  } catch (_) { /* a notification never blocks the work */ }
}
const salesPeople = (r) => [...new Set([r.createdBy, r.salesRep].filter(Boolean).map(String))];

// ── Reads ───────────────────────────────────────────────────────────────────

exports.list = async (req, res) => {
  try {
    const { status, q, from, to, branch, customer, handler, mine } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 50));
    await expireClaims().catch(() => {});
    // A delegated approver (a sales rep) reads every request in the approvals view, not only his own.
    const approverView = !!req.query.approval && await canApprove(req.user);
    const base = approverView ? {} : { ...scopeFor(req.user) };
    const and = [];
    // The working board sees approved requests only; so does anyone who does not ask.
    if (req.query.view === 'work' || !isAsker(req.user)) and.push(APPROVED);
    const approval = String(req.query.approval || '');
    if (approval === 'approved') and.push(APPROVED);
    else if (['pending', 'returned', 'rejected'].includes(approval)) and.push({ approvalStatus: approval });
    if (from || to) {
      const r = {};
      if (from) r.$gte = startOfDay(from);
      if (to) r.$lte = endOfDay(to);
      and.push({ createdAt: r });
    }
    const branchClause = branch ? { branch } : null;
    if (branchClause) and.push(branchClause);
    if (customer && mongoose.isValidObjectId(String(customer))) and.push({ customer });
    // «Mine» on the working side: what I hold now, completed trucks on, or recorded sourcing for.
    if (handler === 'me') and.push({ $or: [{ handler: req.user._id }, { 'placed.by': req.user._id }, { 'sourcing.by': req.user._id }] });
    if (mine === '1') and.push({ $or: [{ createdBy: req.user._id }, { salesRep: req.user._id }] });
    if (q && String(q).trim()) {
      const { arabicSearchRegex, westernDigits } = require('../utils/arabicSearch');
      const term = westernDigits(String(q).trim());
      const r = arabicSearchRegex(term);
      const or = [{ customerName: r }, { fromCity: r }, { toCity: r }, { salesRepName: r }, { createdByName: r },
        { handlerName: r }, { truckType: r }, { branch: r }, { rejectReason: r }, { blNumber: r }, { containerNumber: r }, { 'placed.supplierName': r }];
      const n = Number(term);
      if (Number.isFinite(n)) { or.push({ number: n }); or.push({ 'placed.waybillNumber': n }); }
      and.push({ $or: or });
    }
    const filter = and.length ? { ...base, $and: and } : base;
    const statuses = String(status || '').split(',').map((s) => s.trim()).filter(Boolean);
    const listFilter = statuses.length ? { ...filter, status: { $in: statuses } } : filter;
    const [rows, total, counts, branches] = await Promise.all([
      ShipmentRequest.find(listFilter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ShipmentRequest.countDocuments(listFilter),
      ShipmentRequest.aggregate([{ $match: filter }, { $group: { _id: '$status', n: { $sum: 1 }, trucks: { $sum: '$trucks' }, placed: { $sum: { $size: '$placed' } } } }]),
      // Open requests per branch for the branch filter (every company branch is listed, with its count).
      // Counted without the branch filter itself, so picking one branch keeps the others' numbers.
      ShipmentRequest.aggregate([{ $match: { ...(() => { const rest = and.filter((x) => x !== branchClause); return rest.length ? { ...base, $and: rest } : base; })(), status: { $in: OPEN } } }, { $group: { _id: '$branch', n: { $sum: 1 } } }]),
    ]);
    // Every company branch (reference data «الفروع»), in its own order, plus any branch written on a request outside that list.
    const company = await require('./shipmentOrdersController').companyBranchOptions().catch(() => []);
    const openBy = new Map(branches.map((b) => [String(b._id || ''), b.n]));
    const branchList = [...company.map((b) => b.key), ...[...openBy.keys()].filter((k) => k && !company.some((c) => c.key === k))]
      .map((name) => ({ name, open: openBy.get(name) || 0 }));
    const approvalCounts = { pending: 0, approved: 0, returned: 0, rejected: 0 };
    if (req.query.approvalCounts === '1') {
      const andNoApproval = and.filter((x) => x !== APPROVED && !('approvalStatus' in x));
      const g = await ShipmentRequest.aggregate([{ $match: andNoApproval.length ? { ...base, $and: andNoApproval } : base },
        { $group: { _id: { $ifNull: ['$approvalStatus', 'approved'] }, n: { $sum: 1 } } }]);
      for (const x of g) approvalCounts[x._id] = x.n;
    }
    const byStatus = { pending: 0, in_progress: 0, completed: 0, rejected: 0, cancelled: 0 };
    let openTrucks = 0;
    for (const c of counts) {
      byStatus[c._id] = c.n;
      if (OPEN.includes(c._id)) openTrucks += c.trucks - c.placed;
    }
    res.json({
      requests: rows.map((r) => shape(req.user, r)), total, byStatus, openTrucks,
      branches: branchList.map((b) => b.name), branchList,
      approvalCounts,
      can: { ...canOf(req.user), approve: await canApprove(req.user), manageApprovers: isSalesManager(req.user) }, priceView: { ...PV.priceView(req.user), sell: PV.requestSellVisible(req.user) },
    });
  } catch (e) {
    console.error('[shipment-requests] list:', e);
    res.status(500).json({ message: 'تعذّر تحميل الطلبات' });
  }
};

exports.get = async (req, res) => {
  try {
    await expireClaims({ id: req.params.id }).catch(() => {});
    const r = await ShipmentRequest.findOne({ _id: req.params.id, ...((await canApprove(req.user)) ? {} : scopeFor(req.user)) }).lean();
    if (!r || (notApproved(r) && !isAsker(req.user))) return res.status(404).json({ message: 'الطلب غير موجود' });
    // The placed trucks with their live state, so the request reads as the transport orders it became.
    const orders = r.placed.length
      ? await ShipmentOrder.find({ _id: { $in: r.placed.map((p) => p.order) } })
        .select('waybillNumber status supplierName vehiclePlate driverName driverPhone buyPrice advanceAmount sellPrice pickupTime cancelReason').lean()
      : [];
    const sellOk = PV.requestSellVisible(req.user);
    const shown = PV.stripOrderPrices(req.user, orders).map((o) => { if (!sellOk) { const c = { ...o }; delete c.sellPrice; delete c.margin; return c; } return o; });
    res.json({ request: shape(req.user, r), orders: shown, can: { ...canOf(req.user), approve: await canApprove(req.user) }, priceView: { ...PV.priceView(req.user), sell: sellOk } });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الطلب' });
  }
};

/** Open requests waiting for the vendors team: the sidebar badge. */
exports.pendingCount = async (req, res) => {
  try {
    const n = await ShipmentRequest.countDocuments({ status: { $in: OPEN }, ...APPROVED });
    res.json({ count: n });
  } catch (e) { res.json({ count: 0 }); }
};

// ── Sales half ──────────────────────────────────────────────────────────────

exports.create = async (req, res) => {
  try {
    const data = pick(req.body, SALES_FIELDS);
    data.trucks = 1;
    const err = await prepareSalesHalf(req, data, { creating: true });
    if (err) return errOut(res, err);
    const who = fullName(req.user);
    const wait = needsApproval(req.user);
    const r = await ShipmentRequest.create({
      ...data, status: 'pending',
      ...(wait ? { approvalStatus: 'pending' } : {}),
      createdBy: req.user._id, createdByName: who, createdByRole: req.user.role,
      log: [{ action: 'created', by: req.user._id, byName: who, note: data.trucks > 1 ? `${data.trucks} شاحنات` : '' },
        ...(wait ? [{ action: 'approval_requested', by: req.user._id, byName: who }] : [])],
    });
    await logAudit({ user: req.user, action: 'create', entity: 'ShipmentRequest', entityId: r._id, changes: { number: r.number, customerName: r.customerName, trucks: r.trucks }, ipAddress: req.ip });
    emit({ id: String(r._id), status: r.status });
    if (wait) await notifyApprovers(`طلبُ شحنةٍ بانتظار اعتمادك رقم ${r.number}`, `${who} · ${r.customerName} · ${r.fromCity} ← ${r.toCity}`, r._id, req.user._id);
    else await notifyVendors(`طلبُ شحنةٍ جديد رقم ${r.number}`, `${r.customerName} · ${r.fromCity} ← ${r.toCity} · ${r.trucks} ${r.trucks > 1 ? 'شاحنات' : 'شاحنة'} · ${r.truckType || ''}`, r._id);
    res.status(201).json({ request: shape(req.user, r) });
  } catch (e) {
    console.error('[shipment-requests] create:', e);
    return sendMongooseError(res, e, 'تعذّر إنشاء الطلب');
  }
};

/** Amends the sales half; allowed while the request is open or rejected. `resubmit: true` sends it back in the same call. */
exports.update = async (req, res) => {
  try {
    const r = await ShipmentRequest.findOne({ _id: req.params.id, ...scopeFor(req.user) });
    if (!r) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (!['pending', 'in_progress', 'rejected'].includes(r.status)) return bad(res, 'لا يُعدَّل طلبٌ مكتملٌ أو مسحوب — عدِّل أوامرَ النقل نفسَها');
    if (r.approvalStatus === 'rejected') return bad(res, 'رفض مديرُ المبيعات هذا الطلب — أنشئ طلبًا جديدًا');
    const data = pick(req.body, SALES_FIELDS);
    if ('trucks' in req.body) data.trucks = req.body.trucks;
    const err = await prepareSalesHalf(req, data, { creating: false });
    if (err) return errOut(res, err);
    if (data.trucks != null && data.trucks < r.placed.length) return bad(res, `أُنشئ من هذا الطلب ${r.placed.length} أوامرُ نقل — لا يقلّ عددُ الشاحنات عنها`);
    // Once a truck is placed, its customer is fixed with it.
    if (r.placed.length && data.customer && String(data.customer) !== String(r.customer)) return bad(res, 'العميلُ ثابتٌ بعد إنشاء أوّل أمر نقل');
    if (data.customFields) data.customFields = { ...(r.customFields || {}), ...data.customFields };
    const changed = Object.keys(data).filter((k) => String(r[k] ?? '') !== String(data[k] ?? ''));
    Object.assign(r, data);
    const who = fullName(req.user);
    if (changed.length) r.log.push({ action: 'edited', by: req.user._id, byName: who, note: changed.join('، ') });
    let resent = false;
    let backToApproval = false;
    if (req.body.resubmit && r.approvalStatus === 'returned') {
      r.approvalStatus = 'pending';
      r.log.push({ action: 'approval_requested', by: req.user._id, byName: who, note: String(req.body.note || '').trim() || 'بعد التعديل' });
      backToApproval = true;
    } else if (req.body.resubmit && r.status === 'rejected') {
      r.status = r.placed.length ? 'in_progress' : 'pending';
      r.resubmits += 1;
      r.log.push({ action: 'resubmitted', by: req.user._id, byName: who, note: String(req.body.note || '').trim() });
      resent = true;
    }
    if (r.status === 'in_progress' && r.placed.length >= r.trucks) { r.status = 'completed'; r.closedAt = r.closedAt || new Date(); }
    await r.save();
    // The load as sold also changes on the transport orders already created from this request, so the order, the operations row and the printed waybill match the request. Truck type stays per truck (the vendors team fixed it) and the selling price keeps its approval path.
    const SHARED = ['fromCity', 'toCity', 'branch', 'notes', 'blNumber', 'containerNumber', 'cargoType', 'truckLength', 'quantity',
      'pickupTime', 'startTime', 'arrivalTime', 'paymentSubtype', 'paymentMethod', 'customFields'];
    const carry = changed.filter((k) => SHARED.includes(k));
    if (carry.length && r.placed.length) {
      const patch = Object.fromEntries(carry.map((k) => [k, r[k]]));
      if (patch.customFields) patch.customFields = r.customFields || {};
      if (carry.includes('paymentSubtype') && r.paymentMethod) patch.paymentMethod = r.paymentMethod;
      const ids = r.placed.map((p) => p.order);
      await ShipmentOrder.updateMany({ _id: { $in: ids } }, { $set: patch });
      for (const id of ids) {
        so.announceOrderChange(id);
        require('../services/shipmentOrderWorkflowLink').mirrorPlatformSoon(id, carry);
      }
    }
    await logAudit({ user: req.user, action: 'update', entity: 'ShipmentRequest', entityId: r._id, changes: { fields: changed, resent }, ipAddress: req.ip });
    emit({ id: String(r._id), status: r.status });
    if (backToApproval) await notifyApprovers(`أُعيد طلبُ الشحنة رقم ${r.number} للاعتماد بعد تعديله`, `${who} · ${r.customerName} · ${r.fromCity} ← ${r.toCity}`, r._id, req.user._id);
    if (resent && !notApproved(r)) await notifyVendors(`أُعيد طلبُ الشحنة رقم ${r.number} بعد تعديله`, `${r.customerName} · ${r.fromCity} ← ${r.toCity}`, r._id);
    res.json({ request: shape(req.user, r) });
  } catch (e) {
    console.error('[shipment-requests] update:', e);
    return sendMongooseError(res, e, 'تعذّر حفظ الطلب');
  }
};

exports.resubmit = async (req, res) => {
  const note = String(req.body?.note || '').trim();
  req.body = { note, resubmit: true };
  return exports.update(req, res);
};

/** Sales withdraws the request; trucks already placed stay as transport orders and the rest is dropped. */
exports.cancel = async (req, res) => {
  try {
    const r = await ShipmentRequest.findOne({ _id: req.params.id, ...scopeFor(req.user) });
    if (!r) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (!['pending', 'in_progress', 'rejected'].includes(r.status)) return bad(res, 'الطلبُ مغلقٌ بالفعل');
    const who = fullName(req.user);
    const note = String(req.body?.note || '').trim();
    if (r.placed.length) {
      r.trucks = r.placed.length;
      r.status = 'completed';
    } else {
      r.status = 'cancelled';
    }
    r.closedAt = r.closedAt || new Date();
    r.log.push({ action: 'cancelled', by: req.user._id, byName: who, note });
    await r.save();
    await logAudit({ user: req.user, action: 'cancel', entity: 'ShipmentRequest', entityId: r._id, changes: { note }, ipAddress: req.ip });
    emit({ id: String(r._id), status: r.status });
    res.json({ request: shape(req.user, r) });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر سحب الطلب'); }
};

// ── Vendors and fleet half ──────────────────────────────────────────────────

/**
 * Takes the request for one hour so colleagues see who is working it; after the hour it is released (expireClaims)
 * and must be taken again. Claiming again before the hour ends renews it. A fleet member claims as «النقل الثقيل».
 */
exports.claim = async (req, res) => {
  try {
    await expireClaims({ id: req.params.id });
    const r = await ShipmentRequest.findById(req.params.id);
    if (!r || notApproved(r)) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (!OPEN.includes(r.status)) return bad(res, 'الطلبُ ليس مفتوحًا');
    const release = req.path.endsWith('/release');
    const team = teamOf(req);
    const who = shownName(team, req.user);
    const now = new Date();
    if (release) {
      if (!r.handler) return res.json({ request: shape(req.user, r) });
      const other = String(r.handler) !== String(req.user._id) ? r.handlerName : '';
      r.log.push({ action: 'released', by: req.user._id, byName: who, team, note: other && other !== who ? `عن ${other}` : '' });
      r.handler = null; r.handlerName = ''; r.handledAt = null; r.claimedUntil = null; r.handlerTeam = '';
    } else {
      const mine = !!r.handler && (String(r.handler) === String(req.user._id) || (team === 'fleet' && r.handlerTeam === 'fleet'));
      if (r.handler && !mine && !req.body?.takeOver) {
        return res.status(409).json({ code: 'HELD', message: `يعمل على هذا الطلب ${r.handlerName}`, handlerName: r.handlerName, claimedUntil: r.claimedUntil });
      }
      const prev = r.handler && !mine ? r.handlerName : '';
      r.handler = req.user._id; r.handlerName = who; r.handlerTeam = team; r.handledAt = now;
      r.claimedUntil = new Date(now.getTime() + CLAIM_MS);
      r.log.push({ action: 'claimed', by: req.user._id, byName: who, team, note: prev ? `بدلًا من ${prev}` : (mine ? 'تجديد التولّي' : '') });
    }
    await r.save();
    emit({ id: String(r._id), status: r.status });
    res.json({ request: shape(req.user, r) });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر الحفظ'); }
};

// ── «تحصيل السيارات»: who found how many trucks (a follow-up aid; completions stay the real count) ──

const TEAM_ROLES = () => {
  const { rolesOfSection } = require('../config/roles');
  return {
    vendors: [...new Set([...rolesOfSection('Vendors Management'), ...rolesOfSection('Operations'), 'shipment_orders_manager', 'shipment_orders_team_leader', 'shipment_orders_staff'])],
    fleet: [...FLEET_TEAM],
  };
};
/** People who may be named «بمساعدة»: the sourcing pickers' teams plus the fleet. */
const HELPER_ROLES = () => {
  const { rolesOfSection } = require('../config/roles');
  return [...new Set([...rolesOfSection('Vendors Management'), ...rolesOfSection('Sales'), ...rolesOfSection('Operations'),
    ...rolesOfSection('Shipment Orders'), ...DATA_ROLES, ...FLEET_TEAM])];
};
async function teamOptions(roles) {
  const User = require('../models/User');
  const { endedStaff, userEnded } = require('../utils/endedStaff');
  const { LABELS_AR } = require('../config/roles');
  const [users, ended] = await Promise.all([
    User.find({ role: { $in: roles }, isActive: { $ne: false } }).select('firstName lastName role').lean(),
    endedStaff(),
  ]);
  return users.filter((u) => !userEnded(ended, u))
    .map((u) => ({ value: String(u._id), label: fullName(u), role: u.role, roleAr: LABELS_AR[u.role] || u.role }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ar'));
}
/** GET /team-members?team=vendors|fleet|helpers — the «بمساعدة» pickers. */
exports.teamMembers = async (req, res) => {
  try {
    const team = String(req.query.team || 'vendors');
    const roles = team === 'helpers' ? HELPER_ROLES() : (TEAM_ROLES()[team] || TEAM_ROLES().vendors);
    res.json({ options: await teamOptions(roles) });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل القائمة' }); }
};
/** The «بمساعدة» person, checked against the eligible roles; empty means none. */
async function resolveHelper(id) {
  if (!id) return { helper: null, helperName: '' };
  const User = require('../models/User');
  const u = mongoose.isValidObjectId(String(id))
    ? await User.findOne({ _id: id, role: { $in: HELPER_ROLES() }, isActive: { $ne: false } }).select('firstName lastName').lean() : null;
  if (!u) { const e = new Error('«بمساعدة» يُختار من أعضاء الفريق'); e.status = 400; throw e; }
  return { helper: u._id, helperName: fullName(u) };
}
const carsWord = (n) => (n === 1 ? 'سيارة' : n === 2 ? 'سيارتان' : n <= 10 ? 'سيارات' : 'سيارة');

exports.addSourcing = async (req, res) => {
  try {
    const r = await ShipmentRequest.findById(req.params.id);
    if (!r || notApproved(r)) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (['cancelled', 'rejected'].includes(r.status)) return bad(res, 'لا يُسجَّل تحصيلٌ على طلبٍ مرفوضٍ أو مسحوب');
    const count = Math.floor(Number(req.body?.count));
    if (!Number.isFinite(count) || count < 1 || count > 25) return bad(res, 'عددُ السيارات بين 1 و25', { fields: ['count'] });
    const team = teamOf(req);
    const who = shownName(team, req.user);
    const h = await resolveHelper(req.body?.helper);
    if (h.helper && String(h.helper) === String(req.user._id)) return bad(res, 'اختر شخصًا آخرَ في «بمساعدة»');
    const note = String(req.body?.note || '').trim().slice(0, 300);
    r.sourcing.push({ count, team, by: req.user._id, byName: who, ...h, note, at: new Date() });
    r.log.push({ action: 'sourced', by: req.user._id, byName: who, team, note: `${count} ${carsWord(count)}${h.helperName ? ` بمساعدة ${h.helperName}` : ''}${note ? ` — ${note}` : ''}` });
    await r.save();
    await logAudit({ user: req.user, action: 'create', entity: 'ShipmentRequestSourcing', entityId: r._id, changes: { count, helper: h.helperName, team }, ipAddress: req.ip });
    emit({ id: String(r._id), status: r.status });
    res.status(201).json({ request: shape(req.user, r) });
  } catch (e) {
    if (e.status === 400) return bad(res, e.message);
    return sendMongooseError(res, e, 'تعذّر الحفظ');
  }
};

/** Edits or deletes a sourcing entry: its author or a lead. */
async function sourcingEntryFor(req, res) {
  const r = await ShipmentRequest.findById(req.params.id);
  if (!r) { res.status(404).json({ message: 'الطلب غير موجود' }); return {}; }
  const e = r.sourcing.id(req.params.entryId);
  if (!e) { res.status(404).json({ message: 'السجلّ غير موجود' }); return {}; }
  if (String(e.by) !== String(req.user._id) && !isLead(req.user)) {
    res.status(403).json({ message: 'يعدّل السجلَّ كاتبُه أو قائدُ الفريق' }); return {};
  }
  return { r, e };
}
exports.updateSourcing = async (req, res) => {
  try {
    const { r, e } = await sourcingEntryFor(req, res);
    if (!r) return undefined;
    const changes = [];
    if (req.body?.count !== undefined) {
      const count = Math.floor(Number(req.body.count));
      if (!Number.isFinite(count) || count < 1 || count > 25) return bad(res, 'عددُ السيارات بين 1 و25', { fields: ['count'] });
      if (count !== e.count) { changes.push(`${e.count} ← ${count}`); e.count = count; }
    }
    if (req.body?.helper !== undefined) {
      const h = await resolveHelper(req.body.helper);
      if (String(h.helper || '') !== String(e.helper || '')) { changes.push(`بمساعدة: ${h.helperName || '—'}`); e.helper = h.helper; e.helperName = h.helperName; }
    }
    if (req.body?.note !== undefined) e.note = String(req.body.note || '').trim().slice(0, 300);
    e.editedAt = new Date();
    const team = teamOf(req);
    r.log.push({ action: 'sourcing_edited', by: req.user._id, byName: shownName(team, req.user), team, note: changes.join('، ') });
    await r.save();
    emit({ id: String(r._id), status: r.status });
    return res.json({ request: shape(req.user, r) });
  } catch (err) {
    if (err.status === 400) return bad(res, err.message);
    return sendMongooseError(res, err, 'تعذّر الحفظ');
  }
};
exports.deleteSourcing = async (req, res) => {
  try {
    const { r, e } = await sourcingEntryFor(req, res);
    if (!r) return undefined;
    const team = teamOf(req);
    r.log.push({ action: 'sourcing_deleted', by: req.user._id, byName: shownName(team, req.user), team, note: `${e.byName}: ${e.count} ${carsWord(e.count)}` });
    e.deleteOne();
    await r.save();
    await logAudit({ user: req.user, action: 'delete', entity: 'ShipmentRequestSourcing', entityId: r._id, changes: { count: e.count, by: e.byName }, ipAddress: req.ip });
    emit({ id: String(r._id), status: r.status });
    return res.json({ request: shape(req.user, r) });
  } catch (err) { return sendMongooseError(res, err, 'تعذّر الحذف'); }
};

// ── Completion helpers shared by the vendors and the fleet ───────────────────

/** Pickup/start/arrival are written by the completer per truck; a truck without them keeps what the request has. */
const timesOf = (t, r) => Object.fromEntries(DATE_KEYS.map((k) => [k, t[k] ? new Date(t[k]) : (r[k] || null)]));
async function requiredTimeFields() {
  return ShipmentOrderField.find({ key: { $in: DATE_KEYS }, required: true, active: { $ne: false }, deleted: { $ne: true } }).select('key labelAr').lean();
}
function timeProblems(trucks, r, required) {
  const out = [];
  trucks.forEach((t, i) => {
    for (const f of required) {
      const v = t[f.key] || r[f.key];
      if (!v || Number.isNaN(new Date(v).getTime())) out.push(`الشاحنة ${i + 1}: ${f.labelAr || f.key} مطلوب`);
    }
  });
  return out;
}
function typeCheck(trucks, r) {
  const accepted = typesOf(r);
  const out = [];
  trucks.forEach((t, i) => {
    const pickedType = String(t.truckType || '').trim() || (accepted.length === 1 ? accepted[0] : '');
    if (accepted.length > 1 && !pickedType) out.push(`الشاحنة ${i + 1}: حدّد نوعَ الشاحنة المنفَّذ`);
    else if (pickedType && accepted.length && !accepted.includes(pickedType)) out.push(`الشاحنة ${i + 1}: «${pickedType}» ليس من الأنواع التي طلبها فريق المبيعات`);
    t.truckType = pickedType;
  });
  return out;
}
const sharedOf = (r) => ({
  customer: r.customer, fromCity: r.fromCity, toCity: r.toCity, branch: r.branch, notes: r.notes,
  truckType: r.truckType, cargoType: r.cargoType, truckLength: r.truckLength, quantity: r.quantity,
  sellPrice: r.sellPrice, paymentSubtype: r.paymentSubtype, customFields: r.customFields || {},
  salesRep: r.salesRep ? String(r.salesRep) : null, status: 'requesting',
  // B/L and container are written by sales on the request; the completer does not set them.
  blNumber: String(r.blNumber || '').trim(), containerNumber: String(r.containerNumber || '').trim(),
});

/**
 * Locks the open slots for one completion. Refused while a colleague holds a live claim, unless the caller is a lead
 * (a claim is a one-hour reservation, see claim).
 */
async function lockForCompletion(req, res, team) {
  await expireClaims({ id: req.params.id });
  const now = new Date();
  const cur = await ShipmentRequest.findById(req.params.id).select('status handler handlerName handlerTeam approvalStatus').lean();
  if (!cur || notApproved(cur)) { res.status(404).json({ message: 'الطلب غير موجود' }); return null; }
  if (!OPEN.includes(cur.status)) { bad(res, 'الطلبُ ليس مفتوحًا — ربّما رُفض أو اكتمل أو سُحب'); return null; }
  const heldByOther = cur.handler && String(cur.handler) !== String(req.user._id) && !(team === 'fleet' && cur.handlerTeam === 'fleet');
  if (heldByOther && !isLead(req.user)) {
    res.status(409).json({ code: 'HELD', message: `يعمل على هذا الطلب ${cur.handlerName} — تولَّه بعد انتهاء ساعته أو اطلب منه التخلّي`, handlerName: cur.handlerName });
    return null;
  }
  const locked = await ShipmentRequest.findOneAndUpdate(
    { _id: req.params.id, status: { $in: OPEN }, $or: [{ lockUntil: null }, { lockUntil: { $lt: now } }] },
    { $set: { lockUntil: new Date(now.getTime() + 90 * 1000) } },
    { new: true },
  );
  if (!locked) { res.status(409).json({ code: 'BUSY', message: 'زميلٌ يُنشئ أوامرَ نقلٍ على هذا الطلب الآن — حاول بعد لحظات' }); return null; }
  return locked;
}
const unlock = (id) => ShipmentRequest.updateOne({ _id: id }, { $set: { lockUntil: null } }).catch(() => {});

/** After trucks were placed: status, save, audit, event and the sales notification. */
async function finishPlacement(req, r, created, byName, team) {
  if (created.length) {
    if (r.placed.length >= r.trucks) {
      r.status = 'completed';
      r.closedAt = r.closedAt || new Date();
      r.log.push({ action: 'completed', by: req.user._id, byName, team });
    } else {
      r.status = 'in_progress';
    }
  }
  r.lockUntil = null;
  await r.save();
  if (!created.length) return;
  await logAudit({ user: req.user, action: 'place', entity: 'ShipmentRequest', entityId: r._id, changes: { waybills: created.map((o) => o.waybillNumber), team }, ipAddress: req.ip });
  emit({ id: String(r._id), status: r.status });
  const nums = created.map((o) => o.waybillNumber).join('، ');
  for (const uid of salesPeople(r)) {
    // eslint-disable-next-line no-await-in-loop
    await notifyUser(uid, `أُنشئ أمرُ النقل لطلبك رقم ${r.number}`, `${r.customerName} · أوامر النقل: ${nums}${r.status === 'completed' ? '' : ` · بقي ${r.trucks - r.placed.length}`}`, r._id);
  }
}

const IQAMA_RE = /^[12]\d{9}$/;
const cleanIqama = (v) => require('../utils/arabicSearch').westernDigits(String(v || '')).replace(/\s+/g, '');
/** Checks a truck's driver before anything is created: a registered driver, or a new one with his iqama number. */
function driverProblem(t) {
  if (t.driverId) return /^[0-9a-f]{24}$/i.test(String(t.driverId)) ? '' : 'السائق غير صالح';
  if (t.newDriver && String(t.newDriver.name || '').trim()) {
    const iq = cleanIqama(t.newDriver.residenceNumber);
    if (!iq) return 'رقمُ الإقامة مطلوبٌ للسائق الجديد';
    if (!IQAMA_RE.test(iq)) return 'رقمُ الإقامة/الهوية عشرةُ أرقامٍ يبدأ بـ 1 أو 2';
    return '';
  }
  if (String(t.driverName || '').trim()) return '';
  return 'اختر السائق أو سجّل سائقًا جديدًا';
}
/**
 * The truck's driver as a register row: picked, newly registered (iqama required; an iqama already registered is that
 * driver), or, from older clients, a typed name that must match a registered driver.
 */
async function resolvePlacedDriver(req, t, supplierId) {
  const Driver = require('../models/ShipmentOrderDriver');
  const fail = (m) => { const e = new Error(m); e.status = 400; throw e; };
  if (t.driverId) {
    const d = await Driver.findById(t.driverId).lean();
    if (!d) fail('السائق غير موجود');
    return d;
  }
  if (t.newDriver && String(t.newDriver.name || '').trim()) {
    const iq = cleanIqama(t.newDriver.residenceNumber);
    const known = await Driver.findOne({ residenceNumber: iq, isActive: { $ne: false } }).lean();
    if (known) {
      if (!known.supplier && supplierId) await Driver.updateOne({ _id: known._id }, { $set: { supplier: supplierId } });
      return known;
    }
    const created = await Driver.create({
      name: String(t.newDriver.name).trim(), phone: String(t.newDriver.phone || '').trim(), residenceNumber: iq,
      supplier: supplierId || null, createdBy: req.user._id,
    });
    await so.syncDriverEmployee(created._id).catch(() => {});
    try { emitToAll('shipmentOrders:fleet', {}); } catch (_) { /* */ }
    return Driver.findById(created._id).lean();
  }
  const name = String(t.driverName || '').trim();
  const { arabicSearchRegex } = require('../utils/arabicSearch');
  const live = { isActive: { $ne: false }, name: arabicSearchRegex(name) };
  const d = (supplierId && await Driver.findOne({ ...live, supplier: supplierId }).lean()) || await Driver.findOne(live).lean();
  if (!d) fail(`السائق «${name}» غير مسجَّل — سجّله سائقًا جديدًا برقم إقامته`);
  return d;
}
/** A freelancer typed in the completion form joins the register (an existing one with the same name is reused). */
async function resolveFreelancer(req, nf) {
  const Supplier = require('../models/ShipmentOrderSupplier');
  const name = String(nf.name || '').trim();
  const { arabicSearchRegex } = require('../utils/arabicSearch');
  const near = await Supplier.find({ type: 'freelancer', mergedInto: null, isActive: { $ne: false }, name: arabicSearchRegex(name) }).select('_id name').limit(20).lean();
  const fold = (v) => String(v || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase();
  const same = near.find((x) => fold(x.name) === fold(name));
  if (same) return same._id;
  const sup = await Supplier.create({ name, type: 'freelancer', phone: String(nf.phone || '').trim(), createdBy: req.user._id });
  try { emitToAll('shipmentOrders:fleet', {}); } catch (_) { /* */ }
  return sup._id;
}

/**
 * The vendors team completes trucks: each becomes a transport order on the normal serial, through the same creation as
 * the shipment form. Body: { trucks: [{ kind: 'vendor'|'freelancer', supplierChoice | newFreelancer{name,phone},
 * vehicle | newVehicle{plate}, driverId | newDriver{name,phone,residenceNumber}, sourcingRep, helper, buyPrice,
 * advanceAmount, truckType, pickupTime, startTime, arrivalTime }] }
 */
exports.place = async (req, res) => {
  let locked = null;
  try {
    const trucks = Array.isArray(req.body?.trucks) ? req.body.trucks : [];
    if (!trucks.length) return bad(res, 'أضِف شاحنةً واحدةً على الأقلّ');
    const problems = [];
    trucks.forEach((t, i) => {
      const n = i + 1;
      const freshFreelancer = t.newFreelancer && String(t.newFreelancer.name || '').trim();
      if (!freshFreelancer && !/^[0-9a-f]{24}$/i.test(String(t.supplierChoice || ''))) problems.push(`الشاحنة ${n}: ${t.kind === 'freelancer' ? 'اختر الفريلانسر' : 'اختر المورّد'}`);
      if (!t.vehicle && !String(t.newVehicle?.plate || '').trim()) problems.push(`الشاحنة ${n}: اختر السيارة أو أضِف لوحتها`);
      const dp = driverProblem(t);
      if (dp) problems.push(`الشاحنة ${n}: ${dp}`);
      if (!(Number(t.buyPrice) > 0)) problems.push(`الشاحنة ${n}: سعرُ الشراء مطلوب`);
    });
    if (problems.length) return bad(res, problems.join(' · '), { problems });

    locked = await lockForCompletion(req, res, 'vendors');
    if (!locked) return undefined;
    const r = locked;
    const pre = [...typeCheck(trucks, r), ...timeProblems(trucks, r, await requiredTimeFields())];
    // A picked supplier must be of the kind chosen (company for «مورد», individual for «فريلانسر»).
    const Supplier = require('../models/ShipmentOrderSupplier');
    for (const [i, t] of trucks.entries()) {
      if (!t.supplierChoice) continue;
      // eslint-disable-next-line no-await-in-loop
      const sup = await Supplier.findById(t.supplierChoice).select('type approvalStatus').lean();
      if (!sup) pre.push(`الشاحنة ${i + 1}: المورّد غير موجود`);
      else if (['pending', 'rejected', 'returned'].includes(sup.approvalStatus || '')) pre.push(`الشاحنة ${i + 1}: المورّد غير معتمَد بعد`);
      else if (t.kind && (t.kind === 'freelancer') !== (sup.type === 'freelancer')) pre.push(`الشاحنة ${i + 1}: ${t.kind === 'freelancer' ? 'اختر فريلانسر لا شركة' : 'اختر شركةً لا فريلانسر'}`);
    }
    const open = r.trucks - r.placed.length;
    if (trucks.length > open) pre.push(`بقي في الطلب ${open} ${open === 1 ? 'شاحنة' : 'شاحنات'} فقط`);
    if (pre.length) { await unlock(r._id); return bad(res, pre.join(' · '), { problems: pre }); }

    const who = fullName(req.user);
    const created = [];
    const failed = [];
    for (const [i, t] of trucks.entries()) {
      try {
        /* eslint-disable no-await-in-loop */
        const h = await resolveHelper(t.helper);
        const supplierId = t.supplierChoice || await resolveFreelancer(req, t.newFreelancer);
        const driver = await resolvePlacedDriver(req, t, supplierId);
        const body = {
          ...sharedOf(r), ...timesOf(t, r),
          truckType: t.truckType || r.truckType,
          supplierChoice: String(supplierId),
          ...(t.vehicle ? { vehicle: t.vehicle } : { newVehicle: { plate: String(t.newVehicle.plate).trim(), name: '', supplierId: String(supplierId), newSupplier: null } }),
          driverName: driver.name,
          driverPhone: String(driver.phone || t.driverPhone || '').trim(),
          ...(t.sourcingRep !== undefined ? { sourcingRep: t.sourcingRep } : {}),
          buyPrice: Number(t.buyPrice),
          advanceAmount: numOrNull(t.advanceAmount),
          waybillDetails: t.waybillDetails,
        };
        const order = await so.createOneOrder(req, body);
        await ShipmentOrder.updateOne({ _id: order._id }, { $set: {
          shipmentRequest: r._id, requestNumber: r.number, requestedBy: r.createdBy, requestedByName: r.createdByName,
          sourcingHelper: h.helper, sourcingHelperName: h.helperName,
        } });
        // The driver's register row learns the truck he drove when it had none.
        if (order.vehicle && !driver.vehicle) await require('../models/ShipmentOrderDriver').updateOne({ _id: driver._id, vehicle: null }, { $set: { vehicle: order.vehicle } });
        created.push(order);
        r.placed.push({
          order: order._id, waybillNumber: order.waybillNumber, supplierName: order.supplierName, vehiclePlate: order.vehiclePlate, driverName: order.driverName,
          truckType: order.truckType || t.truckType || '', team: 'vendors', sourcingRep: order.sourcingRep || null, sourcingRepName: order.sourcingRepName || '',
          ...h, by: req.user._id, byName: who,
        });
        r.log.push({ action: 'placed', by: req.user._id, byName: who, team: 'vendors', order: order._id, waybillNumber: order.waybillNumber, note: [order.supplierName, h.helperName && `بمساعدة ${h.helperName}`].filter(Boolean).join(' · ') });
        /* eslint-enable no-await-in-loop */
      } catch (e) {
        failed.push({ index: i, message: e.message || 'تعذّر الإنشاء' });
      }
    }
    await finishPlacement(req, r, created, who, 'vendors');
    if (!created.length) return bad(res, failed[0]?.message || 'لم يُنشأ أيُّ أمر نقل', { failed });
    return res.status(201).json({ request: shape(req.user, r), waybills: created.map((o) => o.waybillNumber), created: created.length, failed });
  } catch (e) {
    if (locked) await unlock(locked._id);
    console.error('[shipment-requests] place:', e);
    return sendMongooseError(res, e, 'تعذّر إنشاء أوامر النقل');
  }
};

/** Our own company as a supplier in the carriers register: an order with it becomes a linked fleet load. */
// The fleet is itself the supplier when it completes a request: this exact register row, created if it is ever missing.
const OUR_SUPPLIER_NAME = 'شركة تنشيط للخدمات اللوجستية';
async function ourSupplier() {
  const Supplier = require('../models/ShipmentOrderSupplier');
  const live = { mergedInto: null, isActive: { $ne: false } };
  const exact = await Supplier.findOne({ ...live, name: OUR_SUPPLIER_NAME }).select('_id name').lean();
  if (exact) return exact;
  const created = await Supplier.create({ name: OUR_SUPPLIER_NAME, isActive: true, approvalStatus: 'approved' }).catch(() => null);
  return created ? { _id: created._id, name: created.name } : Supplier.findOne({ ...live, name: /تنشيط/ }).sort({ inMaster: -1, createdAt: 1 }).select('_id name').lean();
}
/** The fleet load the order became (services/fleetOrderLink); the link's own deferred call may be creating it in parallel. */
async function linkedLoad(orderId) {
  const link = require('../services/fleetOrderLink');
  const { FleetShipment } = require('../models/FleetModels');
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    try { await link.orderToFleet(orderId); } catch (e) { if (e.code !== 11000) throw e; }
    // eslint-disable-next-line no-await-in-loop
    const load = await FleetShipment.findOne({ shipmentOrder: orderId }).select('_id').lean();
    if (load) return load;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((ok) => setTimeout(ok, 150));
  }
  throw new Error('أُنشئ أمرُ النقل وتعذّر ربطُه بحمولة الأسطول');
}

/**
 * The fleet completes trucks on our own vehicles: each truck is a transport order with supplier «تنشيط» AND its linked
 * fleet load (fleetOrderLink), so it shows in shipments, the operations workflow and the fleet's loads, board and
 * analytics alike. The request already holds customer, route and selling price; the fleet adds what a load needs.
 * Body: { trucks: [{ vehicle, driver, secondDriver?, price, driverExpense?, fridayBonus?, rentType?, loadType?,
 * expectedArrival?, notes?, helper?, truckType?, pickupTime, startTime?, arrivalTime? }] }
 */
exports.fleetPlace = async (req, res) => {
  let locked = null;
  try {
    const { FleetVehicle, FleetDriver } = require('../models/FleetModels');
    const trucks = Array.isArray(req.body?.trucks) ? req.body.trucks : [];
    if (!trucks.length) return bad(res, 'أضِف شاحنةً واحدةً على الأقلّ');
    const isId = (v) => /^[0-9a-f]{24}$/i.test(String(v || ''));
    const problems = [];
    trucks.forEach((t, i) => {
      const n = i + 1;
      if (!isId(t.vehicle)) problems.push(`الشاحنة ${n}: اختر السيارة من سياراتنا`);
      if (!isId(t.driver)) problems.push(`الشاحنة ${n}: اختر السائق`);
      if (t.secondDriver && String(t.secondDriver) === String(t.driver)) problems.push(`الشاحنة ${n}: السائق الثاني هو الأول نفسه`);
      if (!(Number(t.price) > 0)) problems.push(`الشاحنة ${n}: إيجار السيارة مطلوب`);
    });
    const plates = trucks.map((t) => String(t.vehicle || '')).filter(Boolean);
    if (new Set(plates).size !== plates.length) problems.push('السيارة نفسها مختارةٌ لأكثر من شاحنة');
    if (problems.length) return bad(res, problems.join(' · '), { problems });
    const ours = await ourSupplier();
    if (!ours) return bad(res, 'لا يوجد مورّدٌ باسم «تنشيط» في سجلّ الموردين — أضِفه أوّلًا');

    locked = await lockForCompletion(req, res, 'fleet');
    if (!locked) return undefined;
    const r = locked;
    const pre = [...typeCheck(trucks, r), ...timeProblems(trucks, r, await requiredTimeFields())];
    const open = r.trucks - r.placed.length;
    if (trucks.length > open) pre.push(`بقي في الطلب ${open} ${open === 1 ? 'شاحنة' : 'شاحنات'} فقط`);
    if (pre.length) { await unlock(r._id); return bad(res, pre.join(' · '), { problems: pre }); }

    const fleetCtl = require('./fleetController');
    const link = require('../services/fleetOrderLink');
    const created = [];
    const failed = [];
    for (const [i, t] of trucks.entries()) {
      try {
        /* eslint-disable no-await-in-loop */
        const [veh, drv] = await Promise.all([FleetVehicle.findById(t.vehicle).lean(), FleetDriver.findById(t.driver).lean()]);
        if (!veh) throw Object.assign(new Error('السيارة غير موجودة في سياراتنا'), { status: 400 });
        if (!drv) throw Object.assign(new Error('السائق غير موجود في سائقي الأسطول'), { status: 400 });
        const h = await resolveHelper(t.helper);
        const order = await so.createOneOrder(req, {
          ...sharedOf(r), ...timesOf(t, r),
          truckType: t.truckType || r.truckType,
          supplierChoice: String(ours._id),
          newVehicle: { plate: veh.plate, name: '', supplierId: null, newSupplier: null },
          driverName: drv.name, driverPhone: String(drv.phone || ''),
          buyPrice: Number(t.price), advanceAmount: null,
        });
        await ShipmentOrder.updateOne({ _id: order._id }, { $set: {
          shipmentRequest: r._id, requestNumber: r.number, requestedBy: r.createdBy, requestedByName: r.createdByName,
          // The fleet is credited as a team: «النقل الثقيل» is the sourcing name on the order and in every report.
          sourcingRep: req.user._id, sourcingRepName: FLEET_NAME, sourcingHelper: h.helper, sourcingHelperName: h.helperName,
        } });
        const load = await linkedLoad(order._id);
        await fleetCtl.applyLinkedLoadInputs(req, load._id, {
          vehicle: String(veh._id), driver: String(drv._id), secondDriver: t.secondDriver || null,
          price: Number(t.price), driverExpense: t.driverExpense, fridayBonus: !!t.fridayBonus,
          rentType: t.rentType, loadType: t.loadType, expectedArrival: t.expectedArrival, notes: t.notes,
        });
        // Truck and driver as the fleet seated them flow back to the order (same values unless a seat rule moved someone).
        await link.fleetToOrder(load._id, req.user);
        const fresh = await ShipmentOrder.findById(order._id).select('waybillNumber supplierName vehiclePlate driverName truckType').lean();
        created.push(fresh);
        r.placed.push({
          order: order._id, waybillNumber: fresh.waybillNumber, supplierName: fresh.supplierName, vehiclePlate: fresh.vehiclePlate, driverName: fresh.driverName,
          truckType: fresh.truckType || t.truckType || '', team: 'fleet', fleetShipment: load._id,
          sourcingRep: req.user._id, sourcingRepName: FLEET_NAME, ...h, by: req.user._id, byName: FLEET_NAME,
        });
        r.log.push({ action: 'placed', by: req.user._id, byName: FLEET_NAME, team: 'fleet', order: order._id, waybillNumber: fresh.waybillNumber, note: [fresh.vehiclePlate, h.helperName && `بمساعدة ${h.helperName}`].filter(Boolean).join(' · ') });
        /* eslint-enable no-await-in-loop */
      } catch (e) {
        failed.push({ index: i, message: e.message || 'تعذّر الإنشاء' });
      }
    }
    await finishPlacement(req, r, created, FLEET_NAME, 'fleet');
    if (!created.length) return bad(res, failed[0]?.message || 'لم يُنشأ أيُّ أمر نقل', { failed });
    return res.status(201).json({ request: shape(req.user, r), waybills: created.map((o) => o.waybillNumber), created: created.length, failed });
  } catch (e) {
    if (locked) await unlock(locked._id);
    console.error('[shipment-requests] fleet-place:', e);
    return sendMongooseError(res, e, 'تعذّر إنشاء أوامر النقل');
  }
};

/** The vendors team rejects what is still open, with a reason from the section's list. */
exports.reject = async (req, res) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    const note = String(req.body?.note || '').trim();
    if (!reason) return bad(res, 'اختر سببَ الرفض', { fields: ['reason'] });
    const Lookup = require('../models/Lookup');
    let known = await Lookup.findOne({ type: 'sr_reject_reason', deleted: { $ne: true }, $or: [{ nameAr: reason }, { nameEn: reason }, { key: reason }] }).select('nameAr').lean();
    // A reason typed in the reject dialog joins the list, so the next rejection can pick it.
    if (!known) {
      const count = await Lookup.countDocuments({ type: 'sr_reject_reason' });
      known = await Lookup.create({ type: 'sr_reject_reason', key: `custom_${Date.now().toString(36)}`, nameAr: reason, nameEn: reason, order: count, isActive: true, isSystem: false, createdBy: req.user._id });
      try { require('../websocket/socketManager').emitToAll('lookup:changed', { type: 'sr_reject_reason' }); } catch (_) { /* */ }
    }
    const r = await ShipmentRequest.findById(req.params.id);
    if (!r || notApproved(r)) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (!OPEN.includes(r.status)) return bad(res, 'الطلبُ ليس مفتوحًا');
    if (r.lockUntil && r.lockUntil > new Date()) return res.status(409).json({ code: 'BUSY', message: 'زميلٌ يُنشئ أوامرَ نقلٍ على هذا الطلب الآن' });
    const who = fullName(req.user);
    r.status = 'rejected';
    // Stored as the list's Arabic name whatever the picker sent (key or name), so every screen reads it as written.
    const reasonText = known.nameAr || reason;
    r.rejectReason = reasonText;
    r.rejectNote = note;
    r.rejectedAt = new Date();
    r.rejectedByName = who;
    r.closedAt = r.closedAt || new Date();
    r.log.push({ action: 'rejected', by: req.user._id, byName: who, reason: reasonText, note });
    await r.save();
    await logAudit({ user: req.user, action: 'reject', entity: 'ShipmentRequest', entityId: r._id, changes: { reason: reasonText, note }, ipAddress: req.ip });
    emit({ id: String(r._id), status: r.status });
    const left = r.trucks - r.placed.length;
    for (const uid of salesPeople(r)) {
      // eslint-disable-next-line no-await-in-loop
      await notifyUser(uid, `رُفض طلبُ الشحنة رقم ${r.number}`, `${reasonText}${note ? ` — ${note}` : ''}${r.placed.length ? ` · رُفضت ${left} من ${r.trucks}` : ''} · يمكنك تعديلُه وإعادةُ إرساله`, r._id);
    }
    res.json({ request: shape(req.user, r) });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر رفض الطلب'); }
};


// ── Team performance: who sourced, recorded, helped and claimed ─────────────

/**
 * GET /team-performance?from&to — per person (the fleet as one «النقل الثقيل»): sourcing credit on transport orders
 * («مسؤول التوريد», orders created in the period, cancelled excluded), «تحصيل السيارات» records, «بمساعدة» helps on
 * orders and records, and claims with how many ran out. Each count carries its list for the click-through.
 */
exports.teamPerformance = async (req, res) => {
  try {
    const rDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d);
    const today = rDay(new Date());
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : `${today.slice(0, 8)}01`;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : today;
    const cache = require('../utils/ttlCache');
    const out = await cache.wrap(`so:analytics:srteam:${from}:${to}`, 30 * 1000, () => computeTeamPerformance(from, to));
    res.json(out);
  } catch (e) {
    console.error('[shipment-requests] team-performance:', e);
    res.status(500).json({ message: 'تعذّر حساب أداء الفريق' });
  }
};
async function computeTeamPerformance(from, to) {
  const range = { $gte: startOfDay(from), $lte: endOfDay(to) };
  const [orders, reqs] = await Promise.all([
    ShipmentOrder.find({ createdAt: range, status: { $ne: 'cancelled' }, $or: [{ sourcingRep: { $ne: null } }, { sourcingRepName: { $nin: ['', null] } }, { sourcingHelper: { $ne: null } }] })
      .select('waybillNumber customerName fromCity toCity createdAt sourcingRep sourcingRepName sourcingHelper sourcingHelperName requestNumber shipmentRequest supplierName').lean(),
    ShipmentRequest.find({ $or: [{ 'sourcing.at': range }, { log: { $elemMatch: { at: range, action: { $in: ['claimed', 'expired', 'released'] } } } }] })
      .select('number customerName fromCity toCity branch trucks sourcing log').lean(),
  ]);
  const people = new Map();
  const person = (id, name, team) => {
    const key = team === 'fleet' || name === FLEET_NAME ? 'fleet' : (id ? String(id) : `n:${name || '—'}`);
    if (!people.has(key)) {
      people.set(key, { key, name: key === 'fleet' ? FLEET_NAME : (name || '—'), team: key === 'fleet' ? 'fleet' : 'vendors',
        credit: [], sourced: [], helps: [], claims: [], expired: [], releases: 0 });
    }
    const p = people.get(key);
    if (key !== 'fleet' && name && p.name === '—') p.name = name;
    return p;
  };
  const route = (x) => `${x.fromCity || ''} ← ${x.toCity || ''}`;
  const inRange = (d) => d && d >= range.$gte && d <= range.$lte;
  for (const o of orders) {
    const base = { waybillNumber: o.waybillNumber, requestNumber: o.requestNumber || null, customer: o.customerName || '', route: route(o), at: o.createdAt, supplier: o.supplierName || '' };
    if (o.sourcingRep || o.sourcingRepName) person(o.sourcingRep, o.sourcingRepName).credit.push(base);
    if (o.sourcingHelper) person(o.sourcingHelper, o.sourcingHelperName).helps.push({ ...base, kind: 'order', main: o.sourcingRepName || '' });
  }
  for (const r of reqs) {
    const base = { requestNumber: r.number, customer: r.customerName || '', route: route(r), branch: r.branch || '' };
    for (const e of r.sourcing || []) {
      if (!inRange(e.at)) continue;
      person(e.by, e.byName, e.team).sourced.push({ ...base, count: e.count, at: e.at, helper: e.helperName || '', note: e.note || '' });
      if (e.helper) person(e.helper, e.helperName).helps.push({ ...base, kind: 'sourcing', count: e.count, at: e.at, main: e.byName });
    }
    for (const l of r.log || []) {
      if (!inRange(l.at) || !['claimed', 'expired', 'released'].includes(l.action)) continue;
      const p = person(l.by, l.byName, l.team);
      if (l.action === 'claimed') p.claims.push({ ...base, at: l.at, note: l.note || '' });
      else if (l.action === 'expired') p.expired.push({ ...base, at: l.at });
      else p.releases += 1;
    }
  }
  const byAt = (a, b) => new Date(b.at) - new Date(a.at);
  const rows = [...people.values()].map((p) => {
    ['credit', 'sourced', 'helps', 'claims', 'expired'].forEach((k) => p[k].sort(byAt));
    return {
      ...p,
      creditCount: p.credit.length,
      creditFromRequests: p.credit.filter((x) => x.requestNumber).length,
      sourcedCars: p.sourced.reduce((n, x) => n + (x.count || 0), 0),
      sourcedEntries: p.sourced.length,
      helpsCount: p.helps.length,
      claimsCount: p.claims.length,
      expiredCount: p.expired.length,
      expiredRate: p.claims.length ? Math.round((p.expired.length / p.claims.length) * 100) : 0,
    };
  }).sort((a, b) => b.creditCount - a.creditCount || b.sourcedCars - a.sourcedCars);
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
  return {
    from, to, people: rows,
    totals: { credit: sum('creditCount'), sourcedCars: sum('sourcedCars'), sourcedEntries: sum('sourcedEntries'), helps: sum('helpsCount'), claims: sum('claimsCount'), expired: sum('expiredCount') },
  };
}

/** POST /:id/approve | /:id/return | /:id/decline — the sales manager (or a delegated member) decides a sales rep's request. */
exports.decide = async (req, res) => {
  try {
    if (!(await canApprove(req.user))) return res.status(403).json({ message: 'الاعتمادُ لمدير المبيعات ومَن فوّضه' });
    const r = await ShipmentRequest.findById(req.params.id);
    if (!r) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (r.approvalStatus !== 'pending') return bad(res, 'الطلبُ ليس بانتظار الاعتماد');
    const kind = req.path.split('/').pop();
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    if (kind !== 'approve' && !reason) return bad(res, kind === 'return' ? 'اكتب ما يجب تعديله' : 'اكتب سببَ الرفض', { fields: ['reason'] });
    if (String(r.createdBy) === String(req.user._id) && !isSalesManager(req.user)) return bad(res, 'لا يعتمد العضوُ طلبَه بنفسه');
    const who = fullName(req.user);
    r.approvalStatus = kind === 'approve' ? 'approved' : kind === 'return' ? 'returned' : 'rejected';
    r.approvalReason = kind === 'approve' ? '' : reason;
    r.approvalByName = who;
    r.approvalAt = new Date();
    if (kind === 'decline') { r.status = 'cancelled'; r.closedAt = r.closedAt || new Date(); }
    r.log.push({ action: kind === 'approve' ? 'approved' : kind === 'return' ? 'returned' : 'declined', by: req.user._id, byName: who, reason, note: kind === 'approve' ? reason : '' });
    await r.save();
    await logAudit({ user: req.user, action: kind, entity: 'ShipmentRequestApproval', entityId: r._id, changes: { number: r.number, reason }, ipAddress: req.ip });
    emit({ id: String(r._id), status: r.status });
    const title = kind === 'approve' ? `اعتُمد طلبُ الشحنة رقم ${r.number} وأُرسل إلى فريق الموردين`
      : kind === 'return' ? `أُعيد إليك طلبُ الشحنة رقم ${r.number} للتعديل` : `رُفض طلبُ الشحنة رقم ${r.number}`;
    for (const uid of salesPeople(r)) {
      // eslint-disable-next-line no-await-in-loop
      if (uid !== String(req.user._id)) await notifyUser(uid, title, reason || `${r.customerName} · ${r.fromCity} ← ${r.toCity}`, r._id);
    }
    if (kind === 'approve') await notifyVendors(`طلبُ شحنةٍ جديد رقم ${r.number}`, `${r.customerName} · ${r.fromCity} ← ${r.toCity} · ${r.trucks} ${r.trucks > 1 ? 'شاحنات' : 'شاحنة'} · ${r.truckType || ''}`, r._id);
    return res.json({ request: shape(req.user, r) });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر الحفظ'); }
};

/** GET/PUT /approvers — the members the sales manager delegated; only he (or a top role) edits the list. */
exports.getApprovers = async (req, res) => {
  try {
    const ids = await approverIds();
    const options = await teamOptions(PV.SALES_ROLES.filter((r) => rightsRoleOf(r) !== 'sales_manager'));
    res.json({ approvers: ids, options, canEdit: isSalesManager(req.user), canApprove: await canApprove(req.user) });
  } catch (e) { res.status(500).json({ message: 'تعذّر التحميل' }); }
};
exports.setApprovers = async (req, res) => {
  try {
    if (!isSalesManager(req.user)) return res.status(403).json({ message: 'يحدّد المفوَّضين مديرُ المبيعات فقط' });
    const User = require('../models/User');
    const want = (Array.isArray(req.body?.approvers) ? req.body.approvers : []).filter((x) => mongoose.isValidObjectId(String(x)));
    const ok = await User.find({ _id: { $in: want }, role: { $in: PV.SALES_ROLES }, isActive: { $ne: false } }).select('_id firstName lastName').lean();
    await Settings().updateOne({ key: 'main' }, { $set: { approvers: ok.map((u) => u._id), updatedByName: fullName(req.user) } }, { upsert: true });
    await logAudit({ user: req.user, action: 'update', entity: 'ShipmentRequestApprovers', entityId: null, changes: { approvers: ok.map(fullName) }, ipAddress: req.ip });
    emit({ approvers: true });
    res.json({ approvers: ok.map((u) => String(u._id)) });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر الحفظ'); }
};

module.exports.ASKERS = ASKERS;
module.exports.PLACERS = PLACERS;
module.exports.READERS = READERS;
module.exports.WORKERS = WORKERS;
module.exports.FLEET_PLACERS = FLEET_PLACERS;
module.exports.APPROVED = APPROVED;
module.exports.canApprove = canApprove;
module.exports.EVENT = EVENT;
