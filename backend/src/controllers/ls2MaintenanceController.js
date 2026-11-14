/**
 * Heavy-transport maintenance records (periodic / preventive / roadside / accident) and their analytics.
 * Parts always leave the heavy store through a store issue request (storeIssueRequestController.postIssue),
 * the only stock-out path the store allows, so balances, the movement log and the vehicle file stay one story.
 */
const mongoose = require('mongoose');
const Ls2Vehicle = require('../models/Ls2Vehicle');
const Ls2AssetEvent = require('../models/Ls2AssetEvent');
const { Ls2StoreItem } = require('../models/Ls2Store');
const { Ls2MaintenanceRecord, MAINTENANCE_TYPES } = require('../models/Ls2MaintenanceRecord');
const { postIssue, cancelIssue } = require('./storeIssueRequestController');
const { todayKey } = require('../utils/companyDay');
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

const ledger = require('../services/ls2MaintenanceLedger');

const periodOf = (q) => ({
  from: YMD.test(String(q.from || '')) ? q.from : '',
  to: YMD.test(String(q.to || '')) ? q.to : '',
  unitId: q.unitId ? Number(q.unitId) : null,
  type: MAINTENANCE_TYPES.includes(String(q.type || '')) ? q.type : '',
});

/**
 * GET /maintenance/entries?unitId&from&to&type&includeCancelled=1
 * Every maintenance entry (records, unlinked service logs, unmigrated repairs, store issues) with its full detail.
 */
exports.listEntries = async (req, res) => {
  try {
    const p = periodOf(req.query || {});
    const key = `ls2:maint:en:${JSON.stringify({ ...p, c: req.query.includeCancelled === '1' })}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);
    const { entries } = await ledger.collectEntries({ ...p, includeCancelled: req.query.includeCancelled === '1' });
    const body = { entries: entries.map((e) => ({ ...e, typeAr: TYPE_AR[e.type] })) };
    cache.set(key, body, 30000);
    res.json(body);
  } catch (e) { console.error('ls2 maintenance entries', e); res.status(500).json({ message: 'تعذّر تحميل سجلات الصيانة' }); }
};

const zero = () => ({ count: 0, parts: 0, labour: 0, towing: 0, unsplit: 0, total: 0 });
const addTo = (acc, e) => {
  acc.count += 1; acc.parts += e.partsCost; acc.labour += e.labourCost; acc.towing += e.towingCost;
  acc.unsplit += e.unsplitCost; acc.total += e.totalCost;
};
const roundB = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' && k !== 'count' ? r2(v) : v]));
const addDaysYmd = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * GET /maintenance/analytics?unitId&from&to&type
 * Built on the maintenance ledger, so every figure is a sum of entries the drill-down lists.
 * Distance comes from the daily odometer snapshots; service status is the live interval state of each truck.
 */
exports.analytics = async (req, res) => {
  try {
    const p = periodOf(req.query || {});
    const key = `ls2:maint:an:${JSON.stringify(p)}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const { entries, unmatched, fleet } = await ledger.collectEntries(p);
    // An open period runs from the first entry to today, so distance and buckets have real bounds.
    const from = p.from || entries.reduce((m, e) => (e.date && e.date < m ? e.date : m), todayKey());
    const to = p.to || todayKey();
    const [mileage, tireEvents] = await Promise.all([
      require('./ls2Controller').mileageByUnit(from, to),
      Ls2AssetEvent.find({
        entityType: 'tire', action: { $in: ['mounted', 'transferred', 'removed', 'scrapped', 'damaged', 'retired'] },
        date: { $gte: require('../utils/companyDay').startOfDay(from), $lte: require('../utils/companyDay').endOfDay(to) },
      }).select('action toPlateKey fromPlateKey toPlate fromPlate').lean(),
    ]);

    const totals = zero();
    const byType = Object.fromEntries(MAINTENANCE_TYPES.map((t) => [t, { ...zero(), lastDate: '' }]));
    const bySource = {};
    const byVehicle = new Map();
    const trend = new Map();
    const parts = new Map();
    const tireByUnit = new Map();
    const spanDays = (new Date(to) - new Date(from)) / 86400000;
    const granularity = spanDays <= 62 ? 'day' : 'month';
    const bucketOf = (ymd) => (granularity === 'day' ? ymd : ymd.slice(0, 7));
    const tireRow = (unitId, plate) => {
      if (!tireByUnit.has(unitId)) tireByUnit.set(unitId, { unitId, plate, storeQty: 0, storeCost: 0, fitted: 0, removed: 0, scrapped: 0 });
      return tireByUnit.get(unitId);
    };

    for (const e of entries) {
      addTo(totals, e);
      addTo(byType[e.type], e);
      if (e.date > byType[e.type].lastDate) byType[e.type].lastDate = e.date;
      if (!bySource[e.source]) bySource[e.source] = { source: e.source, count: 0, total: 0 };
      bySource[e.source].count += 1; bySource[e.source].total += e.totalCost;

      if (!byVehicle.has(e.unitId)) {
        const v = fleet.byId.get(e.unitId);
        byVehicle.set(e.unitId, {
          unitId: e.unitId, plate: e.plate, driver: (v && v.driver) || '', ...zero(), dates: [],
          byType: Object.fromEntries(MAINTENANCE_TYPES.map((t) => [t, 0])), countByType: Object.fromEntries(MAINTENANCE_TYPES.map((t) => [t, 0])),
        });
      }
      const bv = byVehicle.get(e.unitId);
      addTo(bv, e); bv.byType[e.type] += e.totalCost; bv.countByType[e.type] += 1; bv.dates.push(e.date);

      const b = bucketOf(e.date);
      if (!trend.has(b)) trend.set(b, { bucket: b, total: 0, count: 0, ...Object.fromEntries(MAINTENANCE_TYPES.flatMap((t) => [[t, 0], [`${t}Count`, 0]])) });
      const tb = trend.get(b);
      tb.total += e.totalCost; tb.count += 1; tb[e.type] += e.totalCost; tb[`${e.type}Count`] += 1;

      for (const l of e.parts) {
        if (!parts.has(l.item)) parts.set(l.item, { item: l.item, name: l.name, code: l.code, unit: l.unit, isTire: l.isTire, quantity: 0, cost: 0, entries: 0, vehicles: new Set() });
        const pp = parts.get(l.item);
        pp.quantity += l.quantity; pp.cost += l.total; pp.entries += 1; pp.vehicles.add(e.unitId);
        if (l.isTire) { const t = tireRow(e.unitId, e.plate); t.storeQty += l.quantity; t.storeCost += l.total; }
      }
    }

    // Tyre registry events of the period, attributed to the truck they went on or came off.
    for (const ev of tireEvents) {
      const onKey = ['mounted', 'transferred'].includes(ev.action) ? ev.toPlateKey : null;
      const offKey = ['removed', 'transferred', 'scrapped', 'damaged', 'retired'].includes(ev.action) ? ev.fromPlateKey : null;
      for (const [k, field] of [[onKey, 'fitted'], [offKey, ['scrapped', 'damaged', 'retired'].includes(ev.action) ? 'scrapped' : 'removed']]) {
        const v = k && fleet.byKey.get(k);
        if (!v || (p.unitId && v.unitId !== p.unitId)) continue;
        tireRow(v.unitId, v.plate || v.name)[field] += 1;
      }
    }

    // Distance of the period; fleet cost per 1,000 km uses every truck with odometer data, serviced or not.
    const kmOf = (uid) => (mileage.get(uid) || {}).km || 0;
    const scopeIds = p.unitId ? [p.unitId] : fleet.vehicles.map((v) => v.unitId);
    const kmTotal = scopeIds.reduce((a, uid) => a + kmOf(uid), 0);
    const kmVehicles = scopeIds.filter((uid) => kmOf(uid) > 0).length;
    const costWithKm = entries.filter((e) => kmOf(e.unitId) > 0).reduce((a, e) => a + e.totalCost, 0);

    const vehicleRows = [...byVehicle.values()].map((v) => {
      const km = kmOf(v.unitId);
      const dates = [...new Set(v.dates)].sort();
      const gaps = dates.slice(1).map((d, i) => (new Date(d) - new Date(dates[i])) / 86400000);
      const { dates: _d, ...rest } = v;
      return {
        ...roundB(rest), byType: Object.fromEntries(Object.entries(v.byType).map(([k, x]) => [k, r2(x)])),
        km: Math.round(km), costPer1000Km: km > 0 ? r2((v.total / km) * 1000) : null,
        per10kKm: km > 0 ? r2((v.count / km) * 10000) : null,
        visitDays: dates.length, firstDate: dates[0] || '', lastDate: dates[dates.length - 1] || '',
        avgDaysBetween: gaps.length ? r2(gaps.reduce((a, g) => a + g, 0) / gaps.length) : null,
      };
    }).sort((a, b) => b.total - a.total);

    const partRows = [...parts.values()].map((x) => ({ ...x, cost: r2(x.cost), vehicles: x.vehicles.size }));
    const tireRows = [...tireByUnit.values()].map((t) => ({ ...t, storeCost: r2(t.storeCost) }))
      .sort((a, b) => (b.storeQty + b.fitted + b.scrapped) - (a.storeQty + a.fitted + a.scrapped));

    // Periodic services due now, from each truck's live interval state (the maintenance page reads the same).
    const serviceRows = [];
    for (const v of fleet.vehicles) {
      if (p.unitId && v.unitId !== p.unitId) continue;
      for (const iv of v.serviceIntervals || []) {
        if (iv.statusLevel !== 'overdue' && iv.statusLevel !== 'due') continue;
        const remaining = iv.remainingKm ?? iv.remainingDays ?? iv.remaining ?? null;
        serviceRows.push({
          unitId: v.unitId, plate: v.plate || v.name, service: iv.name, status: iv.statusLevel, remaining,
          unit: iv.remainingKm != null ? 'km' : iv.remainingDays != null ? 'days' : 'h',
          lastServiceAt: iv.lastServiceAt || null, lastServiceKm: iv.lastServiceKm ?? null,
        });
      }
    }
    serviceRows.sort((a, b) => (a.remaining ?? 1e9) - (b.remaining ?? 1e9));

    // Every bucket of the period is present, so a quiet month reads as zero instead of disappearing.
    const trendRows = [];
    for (let d = from; d <= to; d = granularity === 'day' ? addDaysYmd(d, 1) : addDaysYmd(`${d.slice(0, 7)}-01`, 32).slice(0, 7) + '-01') {
      const b = bucketOf(d);
      if (trendRows.length && trendRows[trendRows.length - 1].bucket === b) continue;
      const row = trend.get(b) || { bucket: b, total: 0, count: 0, ...Object.fromEntries(MAINTENANCE_TYPES.flatMap((t) => [[t, 0], [`${t}Count`, 0]])) };
      trendRows.push(Object.fromEntries(Object.entries(row).map(([k, x]) => [k, typeof x === 'number' && !k.endsWith('ount') ? r2(x) : x])));
      if (trendRows.length > 800) break;
    }

    const vehiclesServiced = byVehicle.size;
    const body = {
      filters: { ...p, from, to },
      totals: {
        ...roundB(totals), vehicles: vehiclesServiced,
        avgPerVehicle: vehiclesServiced ? r2(totals.total / vehiclesServiced) : 0,
        km: Math.round(kmTotal), kmVehicles,
        costPer1000Km: kmTotal > 0 ? r2((costWithKm / kmTotal) * 1000) : null,
        tireQty: tireRows.reduce((a, t) => a + t.storeQty, 0),
      },
      byType: MAINTENANCE_TYPES.map((t) => ({ type: t, typeAr: TYPE_AR[t], ...roundB(byType[t]) })),
      bySource: Object.values(bySource).map((s) => ({ ...s, total: r2(s.total) })),
      byVehicle: vehicleRows,
      trend: trendRows,
      granularity,
      topPartsByCost: [...partRows].sort((a, b) => b.cost - a.cost).slice(0, 30),
      topPartsByQty: [...partRows].sort((a, b) => b.quantity - a.quantity).slice(0, 30),
      partsCount: partRows.length,
      tires: {
        storeQty: tireRows.reduce((a, t) => a + t.storeQty, 0),
        storeCost: r2(tireRows.reduce((a, t) => a + t.storeCost, 0)),
        fitted: tireRows.reduce((a, t) => a + t.fitted, 0),
        removed: tireRows.reduce((a, t) => a + t.removed, 0),
        scrapped: tireRows.reduce((a, t) => a + t.scrapped, 0),
        byVehicle: tireRows,
      },
      services: {
        overdue: serviceRows.filter((s) => s.status === 'overdue').length,
        due: serviceRows.filter((s) => s.status === 'due').length,
        vehiclesOverdue: new Set(serviceRows.filter((s) => s.status === 'overdue').map((s) => s.unitId)).size,
        vehiclesDue: new Set(serviceRows.filter((s) => s.status === 'due').map((s) => s.unitId)).size,
        rows: serviceRows,
      },
      // Store issues whose plate matches no fleet truck: listed, never summed into the fleet figures.
      unmatchedIssues: { count: unmatched.length, cost: r2(unmatched.reduce((a, u) => a + u.total, 0)), rows: unmatched.slice(0, 500) },
      priceBasis: entries.flatMap((e) => e.parts).reduce((acc, l) => { acc[l.priceBasis] = (acc[l.priceBasis] || 0) + 1; return acc; }, {}),
      vehicles: fleet.vehicles.map((v) => ({ unitId: v.unitId, plate: v.plate || v.name })).sort((a, b) => String(a.plate).localeCompare(String(b.plate))),
    };
    cache.set(key, body, 30000);
    res.json(body);
  } catch (e) { console.error('ls2 maintenance analytics', e); res.status(500).json({ message: 'تعذّر تحميل تحليلات الصيانة' }); }
};

exports.TYPE_AR = TYPE_AR;
