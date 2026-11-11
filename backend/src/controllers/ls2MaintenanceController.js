/**
 * Heavy-transport maintenance records (periodic / preventive / roadside / accident) and their analytics.
 * Parts always leave the heavy store through a store issue request (storeIssueRequestController.postIssue),
 * the only stock-out path the store allows, so balances, the movement log and the vehicle file stay one story.
 */
const mongoose = require('mongoose');
const Ls2Vehicle = require('../models/Ls2Vehicle');
const Ls2ServiceLog = require('../models/Ls2ServiceLog');
const Ls2Repair = require('../models/Ls2Repair');
const Ls2AssetEvent = require('../models/Ls2AssetEvent');
const { Ls2StoreItem } = require('../models/Ls2Store');
const { Ls2MaintenanceRecord, MAINTENANCE_TYPES } = require('../models/Ls2MaintenanceRecord');
const { postIssue, cancelIssue } = require('./storeIssueRequestController');
const { todayKey } = require('../utils/companyDay');
const { vehiclePlateKey } = require('../utils/plateKey');
const cache = require('../utils/ttlCache');
const logAudit = require('../utils/auditLogger');

const TYPE_AR = { periodic: 'صيانة دورية', preventive: 'صيانة وقائية', roadside: 'صيانة على الطريق', accident: 'حادث' };
const ISSUE_REASON_OF = { periodic: 'periodic_maintenance', preventive: 'preventive_maintenance', roadside: 'roadside_breakdown', accident: 'accident' };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const actor = (req) => ({
  id: req.user?._id,
  name: req.user ? `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() : '',
});
// Tyres can sit in the store as ordinary items; their consumption is reported apart.
const TIRE_RX = /(كاوتش|كفر|إطار|اطار|تاير|tire|tyre)/i;
const isTireItem = (it) => TIRE_RX.test(`${it.name || ''} ${it.category || ''} ${it.groupAr || ''}`);

const touch = (payload) => require('../utils/ls2Touch').touchLs2({ maintenance: true, ...payload });

/** Cleans the money and text inputs every type shares; returns `{ error }` or the fields. */
function costFields(b) {
  const labour = money(b.labourCost);
  const towing = money(b.towingCost);
  if (!(labour >= 0) || !(towing >= 0)) return { error: 'التكلفة يجب أن تكون رقمًا لا يقل عن صفر' };
  const work = (Array.isArray(b.work) ? b.work : [])
    .map((w) => ({ label: String(w?.label || '').trim().slice(0, 160), cost: w?.cost === '' || w?.cost == null ? null : Number(w.cost), note: String(w?.note || '').trim().slice(0, 300) }))
    .filter((w) => w.label);
  if (work.some((w) => w.cost != null && !(w.cost >= 0))) return { error: 'تكلفة بند العمل يجب أن تكون رقمًا لا يقل عن صفر' };
  return { labour, towing, work };
}

/**
 * Takes the parts from the heavy store for a record that does not exist yet (its id is reserved).
 * Returns `{ status, body }` on refusal, or `{ parts, request }` when the stock is taken (request null with no parts).
 */
async function takeParts({ recordId, vehicle, type, date, rawParts, note, req }) {
  const lines = (Array.isArray(rawParts) ? rawParts : []).filter((p) => p && (p.item || p.quantity));
  if (!lines.length) return { parts: [], request: null };
  const out = await postIssue({
    wh: 'heavy', who: actor(req), user: req.user, ip: req.ip, maintenanceRecord: recordId,
    body: {
      vehiclePlate: vehicle.plate || vehicle.name || String(vehicle.unitId),
      issueReason: ISSUE_REASON_OF[type], date,
      note: `${TYPE_AR[type]}${note ? ` — ${note}` : ''}`,
      lines: lines.map((p) => ({ item: p.item, quantity: p.quantity })),
    },
  });
  if (out.status !== 201) return out;
  const request = out.body.request;
  // Prices come from the store item at the moment of issue.
  const items = await Ls2StoreItem.find({ _id: { $in: request.lines.map((l) => l.item) } }).select('unitPrice category groupAr name').lean();
  const byId = new Map(items.map((i) => [String(i._id), i]));
  const parts = request.lines.map((l) => {
    const it = byId.get(String(l.item)) || {};
    const unitPrice = r2(it.unitPrice);
    return {
      item: l.item, itemName: l.itemName, itemCode: l.itemCode, unit: l.unit, category: it.category || '',
      quantity: l.quantity, unitPrice, total: r2(unitPrice * l.quantity), isTire: isTireItem({ ...it, name: l.itemName }),
    };
  });
  return { parts, request };
}

/**
 * Builds and saves a record with its parts; used by the record endpoint and by periodic service registration.
 * Returns `{ status, body }`; 201 carries `{ record }`.
 */
async function createRecord({ req, vehicle, type, body, serviceLog = null, intervalId = null, intervalName = '' }) {
  const b = body || {};
  if (!MAINTENANCE_TYPES.includes(type)) return { status: 400, body: { message: 'نوع الصيانة غير صحيح' } };
  const date = YMD.test(String(b.date || '')) ? String(b.date) : todayKey();
  if (date > todayKey()) return { status: 400, body: { code: 'DATE_FUTURE', message: 'تاريخ الصيانة لا يكون بعد اليوم' } };
  const odometerKm = b.odometerKm === '' || b.odometerKm == null ? (vehicle.odometerKm ?? null) : Number(b.odometerKm);
  if (odometerKm != null && !(odometerKm >= 0)) return { status: 400, body: { message: 'قراءة العداد غير صحيحة' } };
  const c = costFields(b);
  if (c.error) return { status: 400, body: { message: c.error } };
  const notes = String(b.notes || '').trim().slice(0, 1000);
  const title = String(b.title || '').trim().slice(0, 200);

  const recordId = new mongoose.Types.ObjectId();
  const taken = await takeParts({ recordId, vehicle, type, date, rawParts: b.parts, note: title || notes.slice(0, 80), req });
  if (taken.status) return taken;
  const { parts, request } = taken;

  const partsCost = r2(parts.reduce((a, p) => a + p.total, 0));
  const labourCost = r2(c.labour + c.work.reduce((a, w) => a + (w.cost || 0), 0));
  const towingCost = r2(c.towing);
  const who = actor(req);
  try {
    const record = await Ls2MaintenanceRecord.create({
      _id: recordId, unitId: vehicle.unitId, plate: vehicle.plate || vehicle.name || '',
      driver: String(b.driver || '').trim() || vehicle.driver || '',
      type, date, odometerKm, title, location: String(b.location || '').trim().slice(0, 200),
      parts, work: c.work, partsCost, labourCost, towingCost, totalCost: r2(partsCost + labourCost + towingCost), notes,
      serviceLog, intervalId, intervalName,
      issueRequest: request ? request._id : null, issueRequestNo: request ? request.number : '',
      createdBy: who.id, createdByName: who.name,
    });
    logAudit({
      user: req.user, action: 'ls2_maintenance_create', entity: 'Ls2MaintenanceRecord', entityId: record._id,
      changes: { after: { type, plate: record.plate, date, parts: parts.map((p) => `${p.itemName} × ${p.quantity}`), totalCost: record.totalCost } }, ipAddress: req.ip,
    }).catch(() => {});
    return { status: 201, body: { record } };
  } catch (e) {
    // The parts went out for a record that failed to save: return them.
    if (request) await cancelIssue({ id: request._id, wh: 'heavy', who, reason: 'تعذّر حفظ سجل الصيانة', user: req.user, ip: req.ip }).catch(() => {});
    throw e;
  }
}
exports.createRecordFor = createRecord;

// GET /maintenance/records?unitId&type&from&to&status
exports.listRecords = async (req, res) => {
  try {
    const filter = {};
    if (req.query.unitId) filter.unitId = Number(req.query.unitId);
    if (MAINTENANCE_TYPES.includes(String(req.query.type || ''))) filter.type = req.query.type;
    filter.status = req.query.status === 'all' ? { $in: ['active', 'cancelled'] } : (req.query.status === 'cancelled' ? 'cancelled' : 'active');
    const from = YMD.test(String(req.query.from || '')) ? req.query.from : '';
    const to = YMD.test(String(req.query.to || '')) ? req.query.to : '';
    if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const limit = Math.min(Number(req.query.limit) || 500, 5000);
    const records = await Ls2MaintenanceRecord.find(filter).sort({ date: -1, createdAt: -1 }).limit(limit).lean();
    res.json({ records: records.map((r) => ({ ...r, typeAr: TYPE_AR[r.type] })) });
  } catch (e) { console.error('ls2 maintenance list', e); res.status(500).json({ message: 'تعذّر تحميل سجلات الصيانة' }); }
};

// POST /maintenance/records { unitId, type, date, odometerKm, parts:[{item,quantity}], labourCost, towingCost, notes, title, location }
exports.createRecord = async (req, res) => {
  try {
    const b = req.body || {};
    // Periodic records are written with their service interval through register-service.
    if (!['preventive', 'roadside', 'accident'].includes(String(b.type || ''))) {
      return res.status(400).json({ message: 'اختر نوع الصيانة: وقائية، على الطريق، أو حادث' });
    }
    const vehicle = await Ls2Vehicle.findOne({ unitId: Number(b.unitId) }).select('unitId plate name driver odometerKm').lean();
    if (!vehicle) return res.status(404).json({ message: 'المركبة غير موجودة' });
    const out = await createRecord({ req, vehicle, type: b.type, body: b });
    if (out.status === 201) touch({ maintenanceRecord: String(out.body.record._id) });
    res.status(out.status).json(out.body);
  } catch (e) { console.error('ls2 maintenance create', e); res.status(500).json({ message: 'تعذّر حفظ سجل الصيانة' }); }
};

// POST /maintenance/records/:id/cancel { reason } — returns the parts to the store and keeps the record as cancelled.
exports.cancelRecord = async (req, res) => {
  try {
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    if (reason.length < 3) return res.status(400).json({ message: 'اكتب سبب الإلغاء — يُسجَّل في السجل باسمك' });
    const who = actor(req);
    // Flip first so a double click cannot return the parts twice.
    const record = await Ls2MaintenanceRecord.findOneAndUpdate(
      { _id: req.params.id, status: 'active' },
      { $set: { status: 'cancelled', cancelledAt: new Date(), cancelledByName: who.name, cancelReason: reason } },
      { new: true },
    );
    if (!record) {
      const exists = await Ls2MaintenanceRecord.exists({ _id: req.params.id });
      return res.status(exists ? 400 : 404).json({ message: exists ? 'السجل ملغى من قبل' : 'السجل غير موجود' });
    }
    if (record.issueRequest) {
      const out = await cancelIssue({ id: record.issueRequest, wh: 'heavy', who, reason: `إلغاء سجل ${TYPE_AR[record.type]} — ${reason}`, user: req.user, ip: req.ip });
      // An already-cancelled request is fine; anything else rolls the record back.
      if (out.status !== 200 && !(out.status === 400 && /ملغى/.test(out.body?.message || ''))) {
        await Ls2MaintenanceRecord.updateOne({ _id: record._id }, { $set: { status: 'active', cancelledAt: null, cancelledByName: '', cancelReason: '' } });
        return res.status(out.status).json(out.body);
      }
    }
    logAudit({
      user: req.user, action: 'ls2_maintenance_cancel', entity: 'Ls2MaintenanceRecord', entityId: record._id,
      changes: { before: { status: 'active' }, after: { status: 'cancelled', reason, issueRequestNo: record.issueRequestNo } }, ipAddress: req.ip,
    }).catch(() => {});
    touch({ maintenanceRecord: String(record._id) });
    res.json({ record });
  } catch (e) { console.error('ls2 maintenance cancel', e); res.status(500).json({ message: 'تعذّر إلغاء سجل الصيانة' }); }
};

/**
 * GET /maintenance/analytics?unitId&from&to&type
 * Costs come from active records only. Older service logs and repairs written before records existed carry one
 * undivided cost, so they are summed apart under `legacy` instead of being guessed into parts or labour.
 */
exports.analytics = async (req, res) => {
  try {
    const key = `ls2:maint:an:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const from = YMD.test(String(req.query.from || '')) ? req.query.from : '';
    const to = YMD.test(String(req.query.to || '')) ? req.query.to : '';
    const unitId = req.query.unitId ? Number(req.query.unitId) : null;
    const type = MAINTENANCE_TYPES.includes(String(req.query.type || '')) ? req.query.type : '';

    const filter = { status: 'active' };
    if (unitId) filter.unitId = unitId;
    if (type) filter.type = type;
    if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

    const dateRange = (field) => ((from || to) ? { [field]: { ...(from ? { $gte: new Date(`${from}T00:00:00+03:00`) } : {}), ...(to ? { $lte: new Date(`${to}T23:59:59.999+03:00`) } : {}) } } : {});
    const vehicles = await Ls2Vehicle.find({}).select('unitId plate name driver').lean();
    const vehicle = unitId ? vehicles.find((v) => v.unitId === unitId) : null;
    const vKey = vehicle ? vehiclePlateKey(vehicle) : null;

    const [records, legacyLogs, legacyRepairs, tireEvents] = await Promise.all([
      Ls2MaintenanceRecord.find(filter).lean(),
      (!type || type === 'periodic')
        ? Ls2ServiceLog.find({ cost: { $gt: 0 }, ...(unitId ? { unitId } : {}), ...dateRange('serviceDate') }).select('_id cost unitId').lean()
        : [],
      (!type || type === 'accident' || type === 'roadside')
        ? Ls2Repair.find({ cost: { $gt: 0 }, ...(unitId ? { unitId } : {}), ...(type === 'accident' ? { category: 'accident' } : type === 'roadside' ? { category: 'breakdown' } : {}), ...dateRange('repairDate') }).select('cost unitId').lean()
        : [],
      Ls2AssetEvent.find({
        entityType: 'tire', action: { $in: ['mounted', 'transferred', 'scrapped', 'damaged'] },
        ...(vKey ? { $or: [{ toPlateKey: vKey }, { fromPlateKey: vKey }] } : {}),
        ...dateRange('date'),
      }).select('action toPlateKey fromPlateKey toPlate fromPlate').lean(),
    ]);

    const linkedLogs = new Set(records.map((r) => r.serviceLog && String(r.serviceLog)).filter(Boolean));
    const legacyServices = legacyLogs.filter((l) => !linkedLogs.has(String(l._id)));

    const zero = () => ({ count: 0, parts: 0, labour: 0, towing: 0, total: 0 });
    const add = (acc, r) => { acc.count += 1; acc.parts += r.partsCost || 0; acc.labour += r.labourCost || 0; acc.towing += r.towingCost || 0; acc.total += r.totalCost || 0; };
    const round = (o) => ({ ...o, parts: r2(o.parts), labour: r2(o.labour), towing: r2(o.towing), total: r2(o.total) });

    const totals = zero();
    const byType = Object.fromEntries(MAINTENANCE_TYPES.map((t) => [t, zero()]));
    const byVehicle = new Map();
    const trend = new Map();
    const parts = new Map();
    const tireByPlate = new Map();
    const vById = new Map(vehicles.map((v) => [v.unitId, v]));
    // Daily buckets for a short range, monthly otherwise.
    const spanDays = from && to ? (new Date(to) - new Date(from)) / 86400000 : 999;
    const bucketOf = (ymd) => (spanDays <= 62 ? ymd : ymd.slice(0, 7));

    for (const r of records) {
      add(totals, r);
      add(byType[r.type], r);
      if (!byVehicle.has(r.unitId)) {
        const v = vById.get(r.unitId);
        byVehicle.set(r.unitId, { unitId: r.unitId, plate: (v && (v.plate || v.name)) || r.plate, driver: (v && v.driver) || '', ...zero(), byType: Object.fromEntries(MAINTENANCE_TYPES.map((t) => [t, 0])) });
      }
      const bv = byVehicle.get(r.unitId);
      add(bv, r); bv.byType[r.type] += r.totalCost || 0;
      const b = bucketOf(r.date);
      if (!trend.has(b)) trend.set(b, { bucket: b, parts: 0, labour: 0, towing: 0, total: 0, ...Object.fromEntries(MAINTENANCE_TYPES.map((t) => [t, 0])) });
      const tb = trend.get(b);
      tb.parts += r.partsCost || 0; tb.labour += r.labourCost || 0; tb.towing += r.towingCost || 0; tb.total += r.totalCost || 0; tb[r.type] += r.totalCost || 0;
      for (const p of r.parts || []) {
        const k = String(p.item);
        if (!parts.has(k)) parts.set(k, { item: k, name: p.itemName, unit: p.unit, isTire: !!p.isTire, quantity: 0, cost: 0, records: 0 });
        const pp = parts.get(k); pp.quantity += p.quantity; pp.cost += p.total || 0; pp.records += 1;
        if (p.isTire) {
          const pk = r.plate || String(r.unitId);
          if (!tireByPlate.has(pk)) tireByPlate.set(pk, { plate: pk, storeQty: 0, storeCost: 0, fitted: 0, scrapped: 0 });
          const t = tireByPlate.get(pk); t.storeQty += p.quantity; t.storeCost += p.total || 0;
        }
      }
    }

    // Tyre registry: tyres fitted onto a truck and tyres scrapped off one, per plate.
    const plateByKey = new Map(vehicles.map((v) => [vehiclePlateKey(v), v.plate || v.name]));
    for (const e of tireEvents) {
      const fitted = (e.action === 'mounted' || e.action === 'transferred') && e.toPlateKey;
      const scrapped = (e.action === 'scrapped' || e.action === 'damaged') && e.fromPlateKey;
      if (!fitted && !scrapped) continue;
      const k = fitted ? e.toPlateKey : e.fromPlateKey;
      if (vKey && k !== vKey) continue;
      const pk = plateByKey.get(k) || (fitted ? e.toPlate : e.fromPlate) || k;
      if (!tireByPlate.has(pk)) tireByPlate.set(pk, { plate: pk, storeQty: 0, storeCost: 0, fitted: 0, scrapped: 0 });
      const t = tireByPlate.get(pk);
      if (fitted) t.fitted += 1; else t.scrapped += 1;
    }
    const tireRows = [...tireByPlate.values()].map((t) => ({ ...t, storeCost: r2(t.storeCost) }))
      .sort((a, b) => (b.storeQty + b.fitted) - (a.storeQty + a.fitted));

    const body = {
      filters: { from, to, unitId, type },
      totals: round(totals),
      byType: MAINTENANCE_TYPES.map((t) => ({ type: t, typeAr: TYPE_AR[t], ...round(byType[t]) })),
      byVehicle: [...byVehicle.values()].map((v) => ({ ...round(v), byType: Object.fromEntries(Object.entries(v.byType).map(([k, x]) => [k, r2(x)])) }))
        .sort((a, b) => b.total - a.total),
      trend: [...trend.values()].sort((a, b) => a.bucket.localeCompare(b.bucket))
        .map((t) => Object.fromEntries(Object.entries(t).map(([k, x]) => [k, typeof x === 'number' ? r2(x) : x]))),
      granularity: spanDays <= 62 ? 'day' : 'month',
      topParts: [...parts.values()].map((p) => ({ ...p, cost: r2(p.cost) })).sort((a, b) => b.cost - a.cost).slice(0, 25),
      tires: {
        storeQty: tireRows.reduce((a, t) => a + t.storeQty, 0),
        storeCost: r2(tireRows.reduce((a, t) => a + t.storeCost, 0)),
        fitted: tireRows.reduce((a, t) => a + t.fitted, 0),
        scrapped: tireRows.reduce((a, t) => a + t.scrapped, 0),
        byVehicle: tireRows.slice(0, 50),
      },
      legacy: {
        services: { count: legacyServices.length, cost: r2(legacyServices.reduce((a, l) => a + (l.cost || 0), 0)) },
        repairs: { count: legacyRepairs.length, cost: r2(legacyRepairs.reduce((a, l) => a + (l.cost || 0), 0)) },
      },
      vehicles: vehicles.map((v) => ({ unitId: v.unitId, plate: v.plate || v.name })).sort((a, b) => String(a.plate).localeCompare(String(b.plate))),
    };
    cache.set(key, body, 30000);
    res.json(body);
  } catch (e) { console.error('ls2 maintenance analytics', e); res.status(500).json({ message: 'تعذّر تحميل تحليلات الصيانة' }); }
};

exports.TYPE_AR = TYPE_AR;
