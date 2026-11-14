/**
 * One ledger of every real maintenance event on a heavy-transport truck, built at read time from four sources:
 *  - Ls2MaintenanceRecord (the current model; a periodic one carries its service log and issue request),
 *  - Ls2ServiceLog rows with no record (older periodic services, one undivided cost),
 *  - Ls2Repair rows not yet migrated to a record (older exceptional work, one undivided cost),
 *  - heavy-store out-movements to a truck that no record consumed (parts priced at the store price of the time).
 * Each source is counted once: a record hides the log, the issue request and the repair it links to.
 * Analytics, the maintenance page and the vehicle profile all read this, so their figures agree.
 */
const Ls2Vehicle = require('../models/Ls2Vehicle');
const Ls2ServiceLog = require('../models/Ls2ServiceLog');
const Ls2Repair = require('../models/Ls2Repair');
const { Ls2StoreItem, Ls2StoreMovement } = require('../models/Ls2Store');
const { StoreIssueRequest } = require('../models/StoreIssueRequest');
const { Ls2MaintenanceRecord, MAINTENANCE_TYPES } = require('../models/Ls2MaintenanceRecord');
const { plateKey, vehiclePlateKey } = require('../utils/plateKey');
const { dayKeyOf, startOfDay, endOfDay } = require('../utils/companyDay');
const { issueReasonLabel } = require('../utils/storeIssueReasons');

const TYPE_AR = { periodic: 'صيانة دورية', preventive: 'صيانة وقائية', roadside: 'صيانة على الطريق', accident: 'حادث' };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Exceptional repair category -> maintenance type. Accidents and body damage are accidents, breakdowns happen on the road,
// everything else (tyres, electrical, engine, other) is planned corrective work done in the workshop, i.e. preventive.
const REPAIR_TYPE_OF = { accident: 'accident', body: 'accident', breakdown: 'roadside', tires: 'preventive', electrical: 'preventive', engine: 'preventive', other: 'preventive' };
const repairType = (category) => REPAIR_TYPE_OF[category] || 'preventive';

// Store issue reason -> maintenance type; a general or unstated reason is workshop work outside the periodic plan.
const ISSUE_TYPE_OF = { periodic_maintenance: 'periodic', preventive_maintenance: 'preventive', roadside_breakdown: 'roadside', accident: 'accident', general_maintenance: 'preventive' };
const issueType = (reason) => ISSUE_TYPE_OF[reason] || 'preventive';

const TIRE_RX = /(كاوتش|كفر|إطار|اطار|تاير|tire|tyre)/i;
const isTireItem = (it) => TIRE_RX.test(`${it.name || ''} ${it.category || ''} ${it.groupAr || ''}`);

const REPAIR_CATEGORY_AR = { breakdown: 'عطل', accident: 'حادث', tires: 'كاوتشات', electrical: 'كهرباء', engine: 'محرك', body: 'هيكل', other: 'أخرى' };

/** Instant range for a YYYY-MM-DD period in company time; `{}` when open. */
function instantRange(field, from, to) {
  if (!from && !to) return {};
  return { [field]: { ...(from ? { $gte: startOfDay(from) } : {}), ...(to ? { $lte: endOfDay(to) } : {}) } };
}
const inPeriod = (ymd, from, to) => !!ymd && (!from || ymd >= from) && (!to || ymd <= to);

/** Fleet vehicles with their plate key, for joining free-text plates. */
async function loadFleet() {
  const vehicles = await Ls2Vehicle.find({}).select('unitId plate name driver odometerKm serviceIntervals maintenanceStatus').lean();
  const byKey = new Map();
  for (const v of vehicles) { const k = vehiclePlateKey(v); if (k && !byKey.has(k)) byKey.set(k, v); }
  return { vehicles, byId: new Map(vehicles.map((v) => [v.unitId, v])), byKey };
}

/**
 * Price of each out-movement as the store stood when it was recorded: the last priced purchase of the item recorded
 * before it (that is what the item's unit price was then); the item's current price when no purchase is on record.
 */
async function priceMovements(movements) {
  const ids = [...new Set(movements.map((m) => String(m.item)))];
  if (!ids.length) return new Map();
  const [items, ins] = await Promise.all([
    Ls2StoreItem.find({ _id: { $in: ids } }).select('name code unit unitPrice category groupAr').lean(),
    Ls2StoreMovement.find({ item: { $in: ids }, type: 'in', unitPrice: { $gt: 0 }, reversalOf: null })
      .select('item unitPrice createdAt').sort({ createdAt: 1 }).lean(),
  ]);
  const itemById = new Map(items.map((i) => [String(i._id), i]));
  const insByItem = new Map();
  for (const m of ins) { const k = String(m.item); if (!insByItem.has(k)) insByItem.set(k, []); insByItem.get(k).push(m); }
  const out = new Map();
  for (const m of movements) {
    const k = String(m.item);
    const it = itemById.get(k) || {};
    const list = insByItem.get(k) || [];
    let price = null;
    for (const p of list) { if (p.createdAt <= m.createdAt) price = p.unitPrice; else break; }
    out.set(String(m._id), {
      item: it, unitPrice: r2(price != null ? price : it.unitPrice),
      priceBasis: price != null ? 'purchase' : 'item',
    });
  }
  return out;
}

/**
 * All maintenance entries for a period. `includeCancelled` adds cancelled records flagged `cancelled: true`
 * (never summed). Returns `{ entries, unmatched, fleet }`; `unmatched` are store issues whose plate is no fleet truck.
 */
async function collectEntries({ from = '', to = '', unitId = null, type = '', includeCancelled = false } = {}) {
  from = YMD.test(String(from || '')) ? from : '';
  to = YMD.test(String(to || '')) ? to : '';
  unitId = unitId ? Number(unitId) : null;
  type = MAINTENANCE_TYPES.includes(String(type || '')) ? type : '';
  const fleet = await loadFleet();
  const vehicle = unitId ? fleet.byId.get(unitId) : null;
  const vKey = vehicle ? vehiclePlateKey(vehicle) : null;

  const recFilter = {
    ...(includeCancelled ? {} : { status: 'active' }),
    ...(unitId ? { unitId } : {}),
    ...((from || to) ? { date: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {}),
  };
  const [records, links, linkedRequests, logs, repairs, movements] = await Promise.all([
    Ls2MaintenanceRecord.find(recFilter).sort({ date: -1, createdAt: -1 }).lean(),
    // Links from every record, whatever its date or status: a cancelled record still stands for its source.
    Ls2MaintenanceRecord.find({ $or: [{ serviceLog: { $ne: null } }, { issueRequest: { $ne: null } }, { sourceRepair: { $ne: null } }] })
      .select('serviceLog issueRequest sourceRepair').lean(),
    StoreIssueRequest.find({ maintenanceRecord: { $ne: null } }).select('_id').lean(),
    Ls2ServiceLog.find({
      action: 'serviced', ...(unitId ? { unitId } : {}),
      ...((from || to) ? { $or: [instantRange('serviceDate', from, to), { serviceDate: null, ...instantRange('createdAt', from, to) }] } : {}),
    }).lean(),
    Ls2Repair.find({ ...(unitId ? { unitId } : {}), ...instantRange('repairDate', from, to) }).lean(),
    Ls2StoreMovement.find({
      warehouse: { $ne: 'light' }, type: 'out', reversed: { $ne: true }, reversalOf: null,
      ...((from || to) ? { $or: [{ date: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } }, { date: { $in: ['', null] }, ...instantRange('createdAt', from, to) }] } : {}),
    }).lean(),
  ]);

  const linkedLogs = new Set(links.map((r) => r.serviceLog && String(r.serviceLog)).filter(Boolean));
  const linkedRepairs = new Set(links.map((r) => r.sourceRepair && String(r.sourceRepair)).filter(Boolean));
  const consumed = new Set([
    ...links.map((r) => r.issueRequest && String(r.issueRequest)).filter(Boolean),
    ...linkedRequests.map((r) => String(r._id)),
  ]);
  // Checklist of the service log each periodic record stands for, shown with the record.
  const recLogIds = records.map((r) => r.serviceLog).filter(Boolean);
  const recLogs = recLogIds.length ? await Ls2ServiceLog.find({ _id: { $in: recLogIds } }).select('checklist syncedToWialon').lean() : [];
  const logById = new Map(recLogs.map((l) => [String(l._id), l]));
  const checklistOf = (l) => (l && l.checklist ? l.checklist.map((c) => ({ label: c.labelAr || c.label, status: c.status, deferKm: c.deferKm ?? null, resolved: !!c.resolved, note: c.note || '' })) : []);
  const plateOf = (uid, fallback) => { const v = fleet.byId.get(uid); return (v && (v.plate || v.name)) || fallback || String(uid); };

  const entries = [];
  for (const r of records) {
    entries.push({
      key: `record:${r._id}`, source: 'record', id: String(r._id), unitId: r.unitId, plate: plateOf(r.unitId, r.plate),
      driver: r.driver || '', type: r.type, date: r.date, odometerKm: r.odometerKm ?? null,
      title: r.intervalName || r.title || '', location: r.location || '', ref: r.issueRequestNo || '',
      parts: (r.parts || []).map((p) => ({
        item: String(p.item), name: p.itemName, code: p.itemCode || '', unit: p.unit || '', quantity: p.quantity,
        unitPrice: r2(p.unitPrice), total: r2(p.total), isTire: !!p.isTire, priceBasis: 'issue',
      })),
      work: (r.work || []).map((w) => ({ label: w.label, cost: w.cost, note: w.note || '' })),
      partsCost: r2(r.partsCost), labourCost: r2(r.labourCost), towingCost: r2(r.towingCost), unsplitCost: r2(r.unsplitCost),
      totalCost: r2(r.totalCost), notes: r.notes || '', by: r.createdByName || '', recordedAt: r.createdAt,
      cancelled: r.status === 'cancelled', cancelReason: r.cancelReason || '', cancelledByName: r.cancelledByName || '',
      sourceRepair: r.sourceRepair ? String(r.sourceRepair) : null, repairCategory: r.repairCategory || '',
      serviceLog: r.serviceLog ? String(r.serviceLog) : null,
      checklist: checklistOf(r.serviceLog && logById.get(String(r.serviceLog))),
    });
  }
  for (const l of logs) {
    if (linkedLogs.has(String(l._id))) continue;
    const date = dayKeyOf(l.serviceDate || l.createdAt);
    if ((from || to) && !inPeriod(date, from, to)) continue;
    const cost = r2(l.cost);
    entries.push({
      key: `service_log:${l._id}`, source: 'service_log', id: String(l._id), unitId: l.unitId, plate: plateOf(l.unitId, l.plate),
      driver: '', type: 'periodic', date, odometerKm: l.odometerKm ?? null,
      title: l.intervalName || 'صيانة دورية', location: '', ref: '',
      parts: [], work: [], checklist: checklistOf(l),
      partsCost: 0, labourCost: 0, towingCost: 0, unsplitCost: cost, totalCost: cost,
      notes: l.notes || '', by: l.performedByName || '', recordedAt: l.createdAt, cancelled: false,
    });
  }
  for (const p of repairs) {
    if (linkedRepairs.has(String(p._id))) continue;
    const date = dayKeyOf(p.repairDate || p.createdAt);
    const cost = r2(p.cost);
    entries.push({
      key: `repair:${p._id}`, source: 'repair', id: String(p._id), unitId: p.unitId, plate: plateOf(p.unitId, p.plate),
      driver: p.driver || '', type: repairType(p.category), date, odometerKm: p.odometerKm ?? null,
      title: p.title || '', location: p.workshop || '', ref: '', repairCategory: p.category, repairStatus: p.status,
      parts: [], work: [],
      partsCost: 0, labourCost: 0, towingCost: 0, unsplitCost: cost, totalCost: cost,
      notes: [p.description, p.partsReplaced ? `القطع المستبدلة: ${p.partsReplaced}` : ''].filter(Boolean).join(' · '),
      by: p.performedByName || '', recordedAt: p.createdAt, cancelled: false,
    });
  }

  // Store issues no record consumed, one entry per issue request (or per direct movement).
  const free = movements.filter((m) => !(m.issueRequest && consumed.has(String(m.issueRequest))));
  const prices = await priceMovements(free);
  const groups = new Map();
  const unmatched = [];
  for (const m of free) {
    const date = YMD.test(String(m.date || '')) ? m.date : dayKeyOf(m.createdAt);
    if ((from || to) && !inPeriod(date, from, to)) continue;
    const pr = prices.get(String(m._id)) || { item: {}, unitPrice: 0, priceBasis: 'item' };
    const line = {
      item: String(m.item), name: m.itemName || pr.item.name || '', code: pr.item.code || '', unit: pr.item.unit || '',
      quantity: m.quantity, unitPrice: pr.unitPrice, total: r2(pr.unitPrice * m.quantity),
      isTire: isTireItem({ ...pr.item, name: m.itemName || pr.item.name }), priceBasis: pr.priceBasis,
    };
    const v = fleet.byKey.get(plateKey(m.vehiclePlate));
    if (!v) { unmatched.push({ id: String(m._id), date, type: issueType(m.issueReason), vehiclePlate: m.vehiclePlate || '', ref: m.issueRequestNo || '', ...line }); continue; }
    if (unitId && v.unitId !== unitId) continue;
    const gk = m.issueRequest ? String(m.issueRequest) : String(m._id);
    if (!groups.has(gk)) {
      groups.set(gk, {
        key: `store_issue:${gk}`, source: 'store_issue', id: gk, unitId: v.unitId, plate: v.plate || v.name, driver: '',
        type: issueType(m.issueReason), date, odometerKm: null,
        title: m.issueRequestNo ? `طلب صرف ${m.issueRequestNo}` : 'صرف من المخزن', location: '', ref: m.issueRequestNo || '',
        issueReason: m.issueReason || '', issueReasonAr: issueReasonLabel(m.issueReason),
        parts: [], work: [], partsCost: 0, labourCost: 0, towingCost: 0, unsplitCost: 0, totalCost: 0,
        notes: m.reason || '', by: m.performedByName || '', recordedAt: m.createdAt, cancelled: false,
      });
    }
    const g = groups.get(gk);
    g.parts.push(line);
    g.partsCost = r2(g.partsCost + line.total);
    g.totalCost = g.partsCost;
  }
  entries.push(...groups.values());

  const shown = entries.filter((e) => (!type || e.type === type) && (!vKey || e.unitId === unitId));
  shown.sort((a, b) => (b.date || '').localeCompare(a.date || '') || new Date(b.recordedAt || 0) - new Date(a.recordedAt || 0));
  return { entries: shown, unmatched: unitId ? [] : unmatched.filter((u) => !type || u.type === type), fleet };
}

module.exports = { collectEntries, loadFleet, TYPE_AR, REPAIR_TYPE_OF, ISSUE_TYPE_OF, REPAIR_CATEGORY_AR, repairType, issueType, isTireItem };
