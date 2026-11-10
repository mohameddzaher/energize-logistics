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
const SO_TEAM = ['shipment_orders_manager', 'shipment_orders_staff', 'operations_manager', 'operations_staff'];
/** Who writes the sales half (create, amend, resend, withdraw). */
const ASKERS = [...TOP_ROLES, ...DATA_ROLES, ...PV.SALES_ROLES, ...SO_TEAM];
/** Who places or rejects (the vendors half). */
const PLACERS = [...TOP_ROLES, ...DATA_ROLES, ...PV.VENDOR_ROLES, ...SO_TEAM];
const READERS = [...new Set([...ASKERS, ...PLACERS, 'shipment_orders_followup'])];

const isAsker = (u) => ASKERS.includes(u?.role);
const isPlacer = (u) => PLACERS.includes(u?.role);
const fullName = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');
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

/** The request as this reader receives it: the vendors team never sees the selling price. */
const shape = (user, doc) => {
  if (!doc) return doc;
  const o = typeof doc.toObject === 'function' ? doc.toObject({ virtuals: true }) : { ...doc };
  o.truckTypes = typesOf(o);
  o.open = Math.max(0, (o.trucks || 0) - (o.placed || []).length);
  if (!PV.priceView(user).sell) delete o.sellPrice;
  delete o.lockUntil;
  return o;
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
      if (VENDOR_FORM_KEYS.has(f.key) || f.key === 'status') continue;
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
    const base = { ...scopeFor(req.user) };
    const and = [];
    if (from || to) {
      const r = {};
      if (from) r.$gte = startOfDay(from);
      if (to) r.$lte = endOfDay(to);
      and.push({ createdAt: r });
    }
    if (branch) and.push({ branch });
    if (customer && mongoose.isValidObjectId(String(customer))) and.push({ customer });
    if (handler === 'me') and.push({ handler: req.user._id });
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
    const [rows, total, counts] = await Promise.all([
      ShipmentRequest.find(listFilter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ShipmentRequest.countDocuments(listFilter),
      ShipmentRequest.aggregate([{ $match: filter }, { $group: { _id: '$status', n: { $sum: 1 }, trucks: { $sum: '$trucks' }, placed: { $sum: { $size: '$placed' } } } }]),
    ]);
    const byStatus = { pending: 0, in_progress: 0, completed: 0, rejected: 0, cancelled: 0 };
    let openTrucks = 0;
    for (const c of counts) {
      byStatus[c._id] = c.n;
      if (OPEN.includes(c._id)) openTrucks += c.trucks - c.placed;
    }
    res.json({
      requests: rows.map((r) => shape(req.user, r)), total, byStatus, openTrucks,
      can: { ask: isAsker(req.user), place: isPlacer(req.user) }, priceView: PV.priceView(req.user),
    });
  } catch (e) {
    console.error('[shipment-requests] list:', e);
    res.status(500).json({ message: 'تعذّر تحميل الطلبات' });
  }
};

exports.get = async (req, res) => {
  try {
    const r = await ShipmentRequest.findOne({ _id: req.params.id, ...scopeFor(req.user) }).lean();
    if (!r) return res.status(404).json({ message: 'الطلب غير موجود' });
    // The placed trucks with their live state, so the request reads as the transport orders it became.
    const orders = r.placed.length
      ? await ShipmentOrder.find({ _id: { $in: r.placed.map((p) => p.order) } })
        .select('waybillNumber status supplierName vehiclePlate driverName driverPhone buyPrice advanceAmount sellPrice pickupTime cancelReason').lean()
      : [];
    res.json({ request: shape(req.user, r), orders: PV.stripOrderPrices(req.user, orders), can: { ask: isAsker(req.user), place: isPlacer(req.user) }, priceView: PV.priceView(req.user) });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الطلب' });
  }
};

/** Open requests waiting for the vendors team: the sidebar badge. */
exports.pendingCount = async (req, res) => {
  try {
    const n = await ShipmentRequest.countDocuments({ status: { $in: OPEN } });
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
    const r = await ShipmentRequest.create({
      ...data, status: 'pending',
      createdBy: req.user._id, createdByName: who, createdByRole: req.user.role,
      log: [{ action: 'created', by: req.user._id, byName: who, note: data.trucks > 1 ? `${data.trucks} شاحنات` : '' }],
    });
    await logAudit({ user: req.user, action: 'create', entity: 'ShipmentRequest', entityId: r._id, changes: { number: r.number, customerName: r.customerName, trucks: r.trucks }, ipAddress: req.ip });
    emit({ id: String(r._id), status: r.status });
    await notifyVendors(`طلبُ شحنةٍ جديد رقم ${r.number}`, `${r.customerName} · ${r.fromCity} ← ${r.toCity} · ${r.trucks} ${r.trucks > 1 ? 'شاحنات' : 'شاحنة'} · ${r.truckType || ''}`, r._id);
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
    if (req.body.resubmit && r.status === 'rejected') {
      r.status = r.placed.length ? 'in_progress' : 'pending';
      r.resubmits += 1;
      r.log.push({ action: 'resubmitted', by: req.user._id, byName: who, note: String(req.body.note || '').trim() });
      resent = true;
    }
    if (r.status === 'in_progress' && r.placed.length >= r.trucks) { r.status = 'completed'; r.closedAt = r.closedAt || new Date(); }
    await r.save();
    await logAudit({ user: req.user, action: 'update', entity: 'ShipmentRequest', entityId: r._id, changes: { fields: changed, resent }, ipAddress: req.ip });
    emit({ id: String(r._id), status: r.status });
    if (resent) await notifyVendors(`أُعيد طلبُ الشحنة رقم ${r.number} بعد تعديله`, `${r.customerName} · ${r.fromCity} ← ${r.toCity}`, r._id);
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

// ── Vendors half ────────────────────────────────────────────────────────────

/** Takes the request so colleagues see who is placing it; a held request can be taken over after the holder releases it. */
exports.claim = async (req, res) => {
  try {
    const r = await ShipmentRequest.findById(req.params.id);
    if (!r) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (!OPEN.includes(r.status)) return bad(res, 'الطلبُ ليس مفتوحًا');
    const release = req.path.endsWith('/release');
    const who = fullName(req.user);
    if (release) {
      if (!r.handler) return res.json({ request: shape(req.user, r) });
      r.log.push({ action: 'released', by: req.user._id, byName: who });
      r.handler = null; r.handlerName = ''; r.handledAt = null;
    } else {
      if (r.handler && String(r.handler) !== String(req.user._id) && !req.body?.takeOver) {
        return res.status(409).json({ code: 'HELD', message: `يعمل على هذا الطلب ${r.handlerName}`, handlerName: r.handlerName });
      }
      r.handler = req.user._id; r.handlerName = who; r.handledAt = new Date();
      r.log.push({ action: 'claimed', by: req.user._id, byName: who });
    }
    await r.save();
    emit({ id: String(r._id), status: r.status });
    res.json({ request: shape(req.user, r) });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر الحفظ'); }
};

/**
 * Places trucks on the request: each one becomes a transport order on the normal serial, through the same creation as the shipment form.
 * Body: { trucks: [{ supplierChoice, vehicle | newVehicle{plate}, driverName, driverPhone, buyPrice, advanceAmount, blNumber, containerNumber, waybillDetails }] }
 */
exports.place = async (req, res) => {
  const now = new Date();
  let locked = null;
  try {
    const trucks = Array.isArray(req.body?.trucks) ? req.body.trucks : [];
    if (!trucks.length) return bad(res, 'أضِف شاحنةً واحدةً على الأقلّ');
    // The purchase price is required from the vendors team, and so are who carries the load and on which truck.
    const problems = [];
    trucks.forEach((t, i) => {
      const n = i + 1;
      if (!/^[0-9a-f]{24}$/i.test(String(t.supplierChoice || ''))) problems.push(`الشاحنة ${n}: اختر المورّد`);
      if (!t.vehicle && !String(t.newVehicle?.plate || '').trim()) problems.push(`الشاحنة ${n}: اختر السيارة أو اكتب لوحتها`);
      if (!String(t.driverName || '').trim()) problems.push(`الشاحنة ${n}: اكتب اسم السائق`);
      if (!(Number(t.buyPrice) > 0)) problems.push(`الشاحنة ${n}: سعرُ الشراء مطلوب`);
    });
    if (problems.length) return bad(res, problems.join(' · '), { problems });

    locked = await ShipmentRequest.findOneAndUpdate(
      { _id: req.params.id, status: { $in: OPEN }, $or: [{ lockUntil: null }, { lockUntil: { $lt: now } }] },
      { $set: { lockUntil: new Date(now.getTime() + 90 * 1000) } },
      { new: true },
    );
    if (!locked) {
      const exists = await ShipmentRequest.findById(req.params.id).select('status').lean();
      if (!exists) return res.status(404).json({ message: 'الطلب غير موجود' });
      if (!OPEN.includes(exists.status)) return bad(res, 'الطلبُ ليس مفتوحًا — ربّما رُفض أو اكتمل أو سُحب');
      return res.status(409).json({ code: 'BUSY', message: 'زميلٌ يُنشئ أوامرَ نقلٍ على هذا الطلب الآن — حاول بعد لحظات' });
    }
    const r = locked;
    // The vendors team fixes each truck's actual type, from the types sales accepted.
    const accepted = typesOf(r);
    const typeProblems = [];
    trucks.forEach((t, i) => {
      const pickedType = String(t.truckType || '').trim() || (accepted.length === 1 ? accepted[0] : '');
      if (accepted.length > 1 && !pickedType) typeProblems.push(`الشاحنة ${i + 1}: حدّد نوعَ الشاحنة المنفَّذ`);
      else if (pickedType && accepted.length && !accepted.includes(pickedType)) typeProblems.push(`الشاحنة ${i + 1}: «${pickedType}» ليس من الأنواع التي طلبها فريق المبيعات`);
      t.truckType = pickedType;
    });
    if (typeProblems.length) {
      await ShipmentRequest.updateOne({ _id: r._id }, { $set: { lockUntil: null } });
      return bad(res, typeProblems.join(' · '), { problems: typeProblems });
    }
    const open = r.trucks - r.placed.length;
    if (trucks.length > open) {
      await ShipmentRequest.updateOne({ _id: r._id }, { $set: { lockUntil: null } });
      return bad(res, `بقي في الطلب ${open} ${open === 1 ? 'شاحنة' : 'شاحنات'} فقط`);
    }

    const shared = {
      customer: r.customer, fromCity: r.fromCity, toCity: r.toCity, branch: r.branch, notes: r.notes,
      truckType: r.truckType, cargoType: r.cargoType, truckLength: r.truckLength, quantity: r.quantity,
      pickupTime: r.pickupTime, startTime: r.startTime, arrivalTime: r.arrivalTime,
      sellPrice: r.sellPrice, paymentSubtype: r.paymentSubtype, customFields: r.customFields || {},
      salesRep: r.salesRep ? String(r.salesRep) : null, status: 'requesting',
    };
    const who = fullName(req.user);
    const created = [];
    const failed = [];
    for (const [i, t] of trucks.entries()) {
      const body = {
        ...shared,
        truckType: t.truckType || r.truckType,
        supplierChoice: t.supplierChoice,
        ...(t.vehicle ? { vehicle: t.vehicle } : { newVehicle: { plate: String(t.newVehicle.plate).trim(), name: '', supplierId: t.supplierChoice, newSupplier: null } }),
        driverName: String(t.driverName || '').trim(),
        ...(t.sourcingRep !== undefined ? { sourcingRep: t.sourcingRep } : {}),
        driverPhone: String(t.driverPhone || '').trim(),
        buyPrice: Number(t.buyPrice),
        advanceAmount: numOrNull(t.advanceAmount),
        blNumber: String(t.blNumber ?? r.blNumber ?? '').trim(),
        containerNumber: String(t.containerNumber ?? r.containerNumber ?? '').trim(),
        waybillDetails: t.waybillDetails,
      };
      try {
        // eslint-disable-next-line no-await-in-loop
        const order = await so.createOneOrder(req, body);
        // eslint-disable-next-line no-await-in-loop
        await ShipmentOrder.updateOne({ _id: order._id }, { $set: {
          shipmentRequest: r._id, requestNumber: r.number, requestedBy: r.createdBy, requestedByName: r.createdByName,
        } });
        created.push(order);
        r.placed.push({ order: order._id, waybillNumber: order.waybillNumber, supplierName: order.supplierName, vehiclePlate: order.vehiclePlate, driverName: order.driverName, truckType: order.truckType || t.truckType || '', by: req.user._id, byName: who });
        r.log.push({ action: 'placed', by: req.user._id, byName: who, order: order._id, waybillNumber: order.waybillNumber, note: order.supplierName || '' });
      } catch (e) {
        failed.push({ index: i, message: e.message || 'تعذّر الإنشاء' });
      }
    }
    if (created.length) {
      if (!r.handler) { r.handler = req.user._id; r.handlerName = who; r.handledAt = now; }
      if (r.placed.length >= r.trucks) {
        r.status = 'completed';
        r.closedAt = r.closedAt || new Date();
        r.log.push({ action: 'completed', by: req.user._id, byName: who });
      } else {
        r.status = 'in_progress';
      }
    }
    r.lockUntil = null;
    await r.save();
    if (created.length) {
      await logAudit({ user: req.user, action: 'place', entity: 'ShipmentRequest', entityId: r._id, changes: { waybills: created.map((o) => o.waybillNumber) }, ipAddress: req.ip });
      emit({ id: String(r._id), status: r.status });
      const nums = created.map((o) => o.waybillNumber).join('، ');
      for (const uid of salesPeople(r)) {
        // eslint-disable-next-line no-await-in-loop
        await notifyUser(uid, `أُنشئ أمرُ النقل لطلبك رقم ${r.number}`, `${r.customerName} · أوامر النقل: ${nums}${r.status === 'completed' ? '' : ` · بقي ${r.trucks - r.placed.length}`}`, r._id);
      }
    }
    if (!created.length) return bad(res, failed[0]?.message || 'لم يُنشأ أيُّ أمر نقل', { failed });
    return res.status(201).json({ request: shape(req.user, r), waybills: created.map((o) => o.waybillNumber), created: created.length, failed });
  } catch (e) {
    if (locked) await ShipmentRequest.updateOne({ _id: locked._id }, { $set: { lockUntil: null } }).catch(() => {});
    console.error('[shipment-requests] place:', e);
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
    const known = await Lookup.findOne({ type: 'sr_reject_reason', deleted: { $ne: true }, $or: [{ nameAr: reason }, { nameEn: reason }, { key: reason }] }).select('nameAr').lean();
    if (!known) return bad(res, 'السببُ غير موجود في قائمة أسباب الرفض — أضِفه إلى القائمة أوّلًا', { fields: ['reason'] });
    const r = await ShipmentRequest.findById(req.params.id);
    if (!r) return res.status(404).json({ message: 'الطلب غير موجود' });
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

module.exports.ASKERS = ASKERS;
module.exports.PLACERS = PLACERS;
module.exports.READERS = READERS;
module.exports.EVENT = EVENT;
