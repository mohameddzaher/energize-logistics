/**
 * Linking operations reports to customs clearance transactions.
 * A haulage report (`OperationsWorkflow`) may be a container move from a clearance transaction (port to yard, to the customer, or return to the agent). The link is stored on the report as `customsLink`, a readable copy (transaction, number, bill of lading, containers), so the operations table and collections screens need no second query.
 * Evidence, strongest first:
 * move: the report number is written in the transaction itself (containers[].moves[].ref, or returnRef); the customs department's explicit statement.   bl: the report's document number equals the bill of lading, compared after stripping spaces/dashes, with or without the 4-letter carrier prefix (COSU6444523620 = 6444523620), any length; a bill shared by more than one transaction is rejected.   container: the document number is a container in exactly one transaction.   manual: linked by hand; automatic evidence never changes it.   unlinked: unlinked by hand; weak evidence (bl/container) does not relink it, but `move` does, since customs wrote the number afterwards. Matching is exact, never "contains", which would catch a short number inside a long bill. Recomputed on: every clearance save (model hook, queueClearance), an edited document number (resolveReports), and new reports arriving from the operations platform (linkPendingMoveRefs). Every write clears the screens' cache first, then broadcasts (see announce-before-invalidate).
 */
const mongoose = require('mongoose');
const cache = require('../utils/ttlCache');
const { westernDigits } = require('../utils/arabicSearch');

const INDEX_KEY = 'customslink:index';
const INDEX_TTL = 60 * 1000;
const VIA = ['move', 'bl', 'container', 'manual', 'unlinked'];
const AUTO_VIA = ['move', 'bl', 'container'];

// Normalisation
/** Uppercase Latin letters and Western digits only: "MRKU 701-6023" = "MRKU7016023". */
const normKey = (s) => westernDigits(String(s == null ? '' : s)).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Bill keys: the full number, and the number without the carrier prefix (four letters then digits), since the document number is written both ways. Any length; match is exact. */
function blKeysOf(bl) {
  const k = normKey(bl);
  if (!k) return [];
  const out = [k];
  const m = k.match(/^[A-Z]{4}(\d[A-Z0-9]{7,})$/);
  if (m) out.push(m[1]);
  return out;
}

/** Container (or chassis) key, any length: staff write these numbers as they come. */
const unitKeyOf = (s) => normKey(s);

const idOf = (v) => (v ? String(v._id || v) : '');

// Transaction index
/** There are hundreds of transactions, not thousands, so all are read once and cached for a minute; only a few numbers are needed. The index is cleared on every transaction save (queueClearance). */
async function loadIndex() {
  return cache.wrap(INDEX_KEY, INDEX_TTL, async () => {
    const CustomsClearance = require('../models/CustomsClearance');
    // Cancelled transactions are read for their name only (a manual link to one is kept) and never matched against.
    const rows = await CustomsClearance.find({})
      .select('refNumber blNumber customerName cancelled containers.containerNumber containers.moves containers.returnRef containers.returnVehicleKind')
      .lean();
    const meta = new Map();
    const byReport = new Map();   // report number -> { id, units:Set }
    const byBl = new Map();       // bill key -> Set(ids)
    const byUnit = new Map();     // container key -> { ids:Set, raw }
    const byShortUnit = new Map(); // Container without its last check digit, as people often type it.
    const add = (m, k, id) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(id); };
    for (const c of rows) {
      const id = String(c._id);
      meta.set(id, {
        refNumber: c.refNumber || '', blNumber: c.blNumber || '', customerName: c.customerName || '',
        units: (c.containers || []).map((u) => String(u.containerNumber || '').trim()).filter(Boolean),
      });
      if (c.cancelled) continue;
      for (const k of blKeysOf(c.blNumber)) add(byBl, k, id);
      for (const u of c.containers || []) {
        const unit = String(u.containerNumber || '').trim();
        const uk = unitKeyOf(unit);
        if (uk) {
          if (!byUnit.has(uk)) byUnit.set(uk, { ids: new Set(), raw: unit });
          byUnit.get(uk).ids.add(id);
          if (uk.length === 11) {
            const short = uk.slice(0, 10);
            if (!byShortUnit.has(short)) byShortUnit.set(short, { ids: new Set(), raw: unit });
            byShortUnit.get(short).ids.add(id);
          }
        }
        // Any vehicle kind: the screen takes a number for both, and only an exact report number ever matches.
        const refs = (u.moves || []).filter((m) => m && String(m.ref || '').trim())
          .map((m) => String(m.ref).trim());
        if (String(u.returnRef || '').trim()) refs.push(String(u.returnRef).trim());
        for (const r of refs) {
          if (!byReport.has(r)) byReport.set(r, new Map());
          const per = byReport.get(r);
          if (!per.has(id)) per.set(id, new Set());
          if (unit) per.get(id).add(unit);
        }
      }
    }
    return { meta, byReport, byBl, byUnit, byShortUnit };
  });
}

const unitHit = (idx, uk) => idx.byUnit.get(uk) || (uk.length === 10 ? idx.byShortUnit.get(uk) : null);

/** Automatic link for one report, or `null`. Does not query the DB: the index is preloaded. A report named by two transactions' move fields is not linked to either (no guessing). */
function autoLinkFor(report, idx) {
  const rn = String(report.reportNumber || '').trim();
  const per = rn ? idx.byReport.get(rn) : null;
  if (per && per.size === 1) {
    const [[id, units]] = [...per.entries()];
    return { id, via: 'move', containers: [...units] };
  }
  // A row of a shipment made here is read with both of the shipment's numbers: documentNumber
  // keeps only one of them, so a B/L with no match would hide a container that has one.
  const unit = String(report.shipmentContainer || '').trim();
  const docs = [...new Set([report.documentNumber, report.shipmentBl, unit].map((d) => String(d || '').trim()).filter(Boolean))];
  for (const doc of docs) {
    const ids = new Set();
    for (const key of [normKey(doc), ...blKeysOf(doc)]) for (const id of idx.byBl.get(key) || []) ids.add(id);
    if (ids.size === 1) return { id: [...ids][0], via: 'bl', containers: unit ? [unit] : [] };
  }
  for (const doc of docs) {
    const uk = unitKeyOf(doc);
    const u = uk ? unitHit(idx, uk) : null;
    if (u && u.ids.size === 1) return { id: [...u.ids][0], via: 'container', containers: [u.raw] };
  }
  return null;
}

/** The copy written onto the report. */
function snapshot(idx, id, via, containers, extra = {}) {
  const m = idx.meta.get(String(id)) || {};
  const units = [...new Set((containers || []).filter(Boolean))].sort();
  return {
    clearance: new mongoose.Types.ObjectId(String(id)),
    refNumber: m.refNumber || '',
    blNumber: m.blNumber || '',
    customerName: m.customerName || '',
    containers: units,
    containersText: units.join(' '),
    via,
    ...extra,
  };
}

const sameLink = (a, b) => {
  const x = a || {}; const y = b || {};
  return idOf(x.clearance) === idOf(y.clearance)
    && (x.via || '') === (y.via || '')
    && (x.refNumber || '') === (y.refNumber || '')
    && (x.blNumber || '') === (y.blNumber || '')
    && (x.customerName || '') === (y.customerName || '')
    && (x.containers || []).join('|') === (y.containers || []).join('|')
    && (x.containersText || '') === (y.containersText || (y.containers || []).join(' '));
};

/** What the report's link should be now, given its current state and the evidence. Returns `undefined` for no change. */
function decide(report, idx) {
  const cur = report.customsLink || null;
  const via = cur && cur.via;
  const auto = autoLinkFor(report, idx);
  if (via === 'manual') {
    // A manual link stays; only its copy is refreshed (number or bill changed in the transaction).
    const id = idOf(cur.clearance);
    if (!idx.meta.has(id)) return null; // Transaction deleted; nothing to link to.
    const next = snapshot(idx, id, 'manual', cur.containers, { at: cur.at, byName: cur.byName });
    return sameLink(cur, next) ? undefined : next;
  }
  if (via === 'unlinked' && !(auto && auto.via === 'move')) return undefined;
  if (!auto) {
    if (via && AUTO_VIA.includes(via)) return null; // Evidence gone; unlink.
    return undefined;
  }
  const next = snapshot(idx, auto.id, auto.via, auto.containers, { at: (cur && idOf(cur.clearance) === auto.id && cur.at) || new Date(), byName: '' });
  return sameLink(cur, next) ? undefined : next;
}

const REPORT_FIELDS = '_id reportNumber documentNumber customsLink shipmentOrder fleetShipment';

/** Adds each row's shipment or fleet-load numbers, which `autoLinkFor` reads alongside documentNumber. */
async function withShipmentNumbers(rows) {
  const ids = rows.map((r) => r.shipmentOrder).filter(Boolean);
  const loadIds = rows.map((r) => r.fleetShipment).filter(Boolean);
  if (!ids.length && !loadIds.length) return rows;
  const ShipmentOrder = require('../models/ShipmentOrder');
  const { FleetShipment } = require('../models/FleetModels');
  const [orderRows, loadRows] = await Promise.all([
    ids.length ? ShipmentOrder.find({ _id: { $in: ids } }).select('blNumber containerNumber').lean() : [],
    loadIds.length ? FleetShipment.find({ _id: { $in: loadIds } }).select('blNumber containerNumber').lean() : [],
  ]);
  const orders = new Map([...orderRows, ...loadRows].map((o) => [String(o._id), o]));
  return rows.map((r) => {
    const o = orders.get(String(r.shipmentOrder || r.fleetShipment || ''));
    return o ? { ...r, shipmentBl: o.blNumber, shipmentContainer: o.containerNumber } : r;
  });
}

/** A linked fleet load takes the transaction's B/L and its single container into its empty fields, as shipment orders do; nothing written is overwritten. */
async function fillFleetLoads(rows, idx) {
  const { FleetShipment } = require('../models/FleetModels');
  const ops = [];
  for (const { r, link } of rows) {
    if (!r.fleetShipment || !link || !link.clearance) continue;
    const set = {};
    if (!String(r.shipmentBl || '').trim() && link.blNumber) set.blNumber = link.blNumber;
    // A transaction with one container names it even when the link came by B/L.
    const units = (link.containers || []).length ? link.containers : (idx.meta.get(idOf(link.clearance))?.units || []);
    if (!String(r.shipmentContainer || '').trim() && units.length === 1) set.containerNumber = units[0];
    if (Object.keys(set).length) ops.push({ updateOne: { filter: { _id: r.fleetShipment }, update: { $set: set } } });
  }
  if (!ops.length) return;
  await FleetShipment.bulkWrite(ops, { ordered: false });
  try { cache.clear('fleet:'); require('../websocket/socketManager').emitToAll('fleet:updated', { customsLink: true }); } catch (_) { /* No sockets in the script */ }
}

/**
 * Recomputes the links of the given reports and writes what changed. `rows` are light rows or a query filter.
 * @returns {{changed:number, reportNumbers:string[], clearanceIds:string[]}}
 */
async function resolveReports(rowsOrFilter, { emit = true, dryRun = false } = {}) {
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const rows = await withShipmentNumbers(Array.isArray(rowsOrFilter)
    ? rowsOrFilter
    : await OperationsWorkflow.find(rowsOrFilter).select(REPORT_FIELDS).lean());
  if (!rows.length) return { changed: 0, reportNumbers: [], clearanceIds: [], changes: [] };
  const idx = await loadIndex();
  const ops = []; const changes = []; const clearanceIds = new Set(); const loadFills = [];
  for (const r of rows) {
    const next = decide(r, idx);
    // A row with no number of its own shows the clearance's. Rows of shipments made here
    // get theirs from the shipment, and fleet loads have nowhere else to hold it.
    const link = next === undefined ? r.customsLink : next;
    if (r.fleetShipment && link && link.clearance) loadFills.push({ r, link });
    const fill = link && link.clearance && !r.shipmentOrder && !String(r.documentNumber || '').trim()
      ? ((link.containers || []).length === 1 ? link.containers[0] : link.blNumber) : '';
    if (next === undefined && !fill) continue;
    if (next !== undefined) {
      if (r.customsLink && r.customsLink.clearance) clearanceIds.add(idOf(r.customsLink.clearance));
      if (next && next.clearance) clearanceIds.add(idOf(next.clearance));
      changes.push({ _id: r._id, reportNumber: r.reportNumber, from: r.customsLink || null, to: next });
    }
    const set = { ...(next ? { customsLink: next } : {}), ...(fill ? { documentNumber: fill } : {}) };
    const update = { ...(Object.keys(set).length ? { $set: set } : {}), ...(next === null ? { $unset: { customsLink: 1 } } : {}) };
    ops.push({ updateOne: { filter: { _id: r._id }, update } });
  }
  if (loadFills.length && !dryRun) await fillFleetLoads(loadFills, idx).catch((e) => console.error('[customs-link] fleet loads:', e.message));
  if (ops.length && !dryRun) {
    for (let i = 0; i < ops.length; i += 500) await OperationsWorkflow.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    if (emit) announce({ reportNumbers: changes.map((c) => c.reportNumber), clearanceIds: [...clearanceIds] });
  }
  return { changed: ops.length, reportNumbers: changes.map((c) => c.reportNumber), clearanceIds: [...clearanceIds], changes };
}

/** Pattern matching the key with any spaces, dashes or letter case, whole and not partial. */
const looseRx = (key) => `^[\\s\\-/._]*${key.split('').map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\-/._]*')}[\\s\\-/._]*$`;

/** Recomputes every report a single transaction can affect: those linked to it now, those whose number appears in its move fields, and those whose document number is its bill or one of its containers. */
async function syncClearance(clearanceId, opts = {}) {
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const CustomsClearance = require('../models/CustomsClearance');
  const id = String(clearanceId);
  const c = await CustomsClearance.findById(id).select('blNumber containers.containerNumber containers.moves containers.returnRef containers.returnVehicleKind').lean();
  const or = [{ 'customsLink.clearance': new mongoose.Types.ObjectId(id) }];
  if (c) {
    const refs = new Set();
    const keys = new Set(blKeysOf(c.blNumber));
    for (const u of c.containers || []) {
      for (const m of u.moves || []) if (m && String(m.ref || '').trim()) refs.add(String(m.ref).trim());
      if (String(u.returnRef || '').trim()) refs.add(String(u.returnRef).trim());
      const uk = unitKeyOf(u.containerNumber);
      if (uk) keys.add(uk);
      if (uk.length === 11) keys.add(uk.slice(0, 10));
    }
    if (refs.size) or.push({ reportNumber: { $in: [...refs] } });
    if (keys.size) or.push({ documentNumber: { $regex: [...keys].map(looseRx).join('|'), $options: 'i' } });
    // Shipment orders too; see resolveShipments.
    try {
      const filter = shipmentFilterFor(id, c, refs, keys);
      await resolveShipments(filter, opts);
      // Their rows too: a row whose documentNumber is the shipment's other number is not reached above.
      const ShipmentOrder = require('../models/ShipmentOrder');
      const orders = await ShipmentOrder.find(filter).select('_id').lean();
      if (orders.length) or.push({ shipmentOrder: { $in: orders.map((o) => o._id) } });
      // Fleet loads by their own B/L or container, which may differ from their row's document number.
      if (keys.size) {
        const { FleetShipment } = require('../models/FleetModels');
        const rx = { $regex: [...keys].map(looseRx).join('|'), $options: 'i' };
        const loads = await FleetShipment.find({ $or: [{ blNumber: rx }, { containerNumber: rx }] }).select('_id').lean();
        if (loads.length) or.push({ fleetShipment: { $in: loads.map((l) => l._id) } });
      }
    } catch (e) { console.error('[customs-link] طلبات الشحن:', e.message); }
  } else {
    try { await resolveShipments({ 'customsLink.clearance': new mongoose.Types.ObjectId(id) }, opts); } catch (_) { /* */ }
  }
  return resolveReports({ $or: or }, opts);
}

/** Reports named by customs but not yet linked; they arrive from the platform after their number was written there. Checked after every sync that brought in new reports, against the index. */
async function linkPendingMoveRefs(opts = {}) {
  const idx = await loadIndex();
  const nums = [...idx.byReport.keys()];
  if (!nums.length) return { changed: 0, reportNumbers: [], clearanceIds: [] };
  try {
    const n = nums.map(Number).filter((x) => Number.isFinite(x));
    await resolveShipments({ 'customsLink.via': { $nin: ['move', 'manual'] }, $or: [{ reference: { $in: nums } }, ...(n.length ? [{ graduationNumber: { $in: n } }, { waybillNumber: { $in: n } }] : [])] }, opts);
  } catch (e) { console.error('[customs-link] طلبات الشحن:', e.message); }
  return resolveReports({ reportNumber: { $in: nums }, 'customsLink.via': { $nin: ['move', 'manual'] } }, opts);
}

// Shipment order linking. The bill number and container number in shipment creation are linked to customs: created here they show in customs, and created in customs they link here. A shipment order is linked with the same evidence as an operations report:
// move: its number (haulage report or our bill) is written in a container move field of the transaction.
// bl: the shipment's bill number is the bill of exactly one transaction.
// container: its container number is a container of exactly one transaction. When the link comes from the transaction, the shipment's two empty fields are filled from it.
const refsOfShipment = (o) => [o.graduationNumber, o.waybillNumber, o.reference]
  .map((x) => (x == null ? '' : String(x).trim())).filter(Boolean);

function autoLinkForShipment(o, idx) {
  const hits = new Map();
  for (const r of refsOfShipment(o)) {
    const per = idx.byReport.get(r);
    if (per) for (const [id, units] of per) hits.set(id, new Set([...(hits.get(id) || []), ...units]));
  }
  if (hits.size === 1) { const [[id, units]] = [...hits.entries()]; return { id, via: 'move', containers: [...units] }; }
  if (hits.size > 1) return null;
  const ids = new Set();
  for (const key of blKeysOf(o.blNumber)) for (const id of idx.byBl.get(key) || []) ids.add(id);
  if (ids.size === 1) return { id: [...ids][0], via: 'bl', containers: o.containerNumber ? [String(o.containerNumber).trim()] : [] };
  if (ids.size > 1) return null;
  const uk = unitKeyOf(o.containerNumber);
  const u = uk ? unitHit(idx, uk) : null;
  if (u && u.ids.size === 1) return { id: [...u.ids][0], via: 'container', containers: [u.raw] };
  return null;
}

function decideShipment(o, idx) {
  const cur = o.customsLink || null;
  const via = cur && cur.via;
  const auto = autoLinkForShipment(o, idx);
  if (via === 'manual') {
    const id = idOf(cur.clearance);
    if (!idx.meta.has(id)) return null;
    const next = snapshot(idx, id, 'manual', cur.containers, { at: cur.at, byName: cur.byName });
    return sameLink(cur, next) ? undefined : next;
  }
  if (via === 'unlinked' && !(auto && auto.via === 'move')) return undefined;
  if (!auto) return via && AUTO_VIA.includes(via) ? null : undefined;
  const next = snapshot(idx, auto.id, auto.via, auto.containers, { at: (cur && idOf(cur.clearance) === auto.id && cur.at) || new Date(), byName: '' });
  return sameLink(cur, next) ? undefined : next;
}

const SHIPMENT_FIELDS = '_id graduationNumber waybillNumber reference blNumber containerNumber customsLink source externalId';

/** Recomputes the links of the given shipment orders and fills their empty bill and container from the transaction. */
async function resolveShipments(rowsOrFilter, { emit = true } = {}) {
  const ShipmentOrder = require('../models/ShipmentOrder');
  const rows = Array.isArray(rowsOrFilter)
    ? rowsOrFilter
    : await ShipmentOrder.find(rowsOrFilter).select(SHIPMENT_FIELDS).lean();
  if (!rows.length) return { changed: 0, clearanceIds: [] };
  const idx = await loadIndex();
  const ops = []; const clearanceIds = new Set();
  for (const o of rows) {
    const next = decideShipment(o, idx);
    const link = next === undefined ? o.customsLink : next;
    const set = {};
    if (next !== undefined) {
      if (o.customsLink && o.customsLink.clearance) clearanceIds.add(idOf(o.customsLink.clearance));
      if (next && next.clearance) clearanceIds.add(idOf(next.clearance));
    }
    // Fill the two empty fields from the linked transaction; never overwrite what someone wrote.
    if (link && link.clearance) {
      if (!String(o.blNumber || '').trim() && link.blNumber) set.blNumber = link.blNumber;
      // A clearance with one container names it even when the link came by B/L.
      const units = (link.containers || []).length ? link.containers : (idx.meta.get(idOf(link.clearance))?.units || []);
      if (!String(o.containerNumber || '').trim() && units.length === 1) set.containerNumber = units[0];
    }
    if (next === undefined && !Object.keys(set).length) continue;
    const update = {};
    if (next !== undefined) { if (next) set.customsLink = next; else update.$unset = { customsLink: 1 }; }
    if (Object.keys(set).length) update.$set = set;
    ops.push({ updateOne: { filter: { _id: o._id }, update } });
  }
  if (ops.length) {
    for (let i = 0; i < ops.length; i += 500) await ShipmentOrder.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    if (emit) {
      try { cache.clear('so:'); } catch (_) { /* */ }
      try {
        const { emitToAll } = require('../websocket/socketManager');
        emitToAll('shipmentOrders:updated', { customsLink: true });
        if (clearanceIds.size) emitToAll('customs:opsLinks', { clearanceIds: [...clearanceIds], shipments: true });
      } catch (_) { /* No sockets in the script */ }
    }
  }
  return { changed: ops.length, clearanceIds: [...clearanceIds] };
}

/** A saved shipment order is linked, and its operations report (for platform shipments) takes the bill or container as the document number if empty, so it is linked from the operations workflow too. */
async function afterShipmentSaved(orderId) {
  const ShipmentOrder = require('../models/ShipmentOrder');
  const before = await ShipmentOrder.findById(orderId).select(SHIPMENT_FIELDS).lean();
  if (!before) return;
  await resolveShipments([before]);
  // Re-read: the link may have just filled the B/L or container the row takes its number from.
  const o = await ShipmentOrder.findById(orderId).select(SHIPMENT_FIELDS).lean();
  const doc = String(o.blNumber || '').trim() || String(o.containerNumber || '').trim();
  const native = !(o.source === 'platform' && o.externalId);
  if (doc || native) {
    const OperationsWorkflow = require('../models/OperationsWorkflow');
    const wf = await OperationsWorkflow.findOne(native ? { shipmentOrder: o._id } : { externalId: String(o.externalId) }).select(REPORT_FIELDS).lean();
    // A shipment made here owns the number, so its row follows an edit or a clear.
    const stale = wf && (native ? String(wf.documentNumber || '').trim() !== doc : !String(wf.documentNumber || '').trim());
    if (stale) await OperationsWorkflow.updateOne({ _id: wf._id }, { $set: { documentNumber: doc } });
    // Always for a shipment made here: its link can lag the number the mirror already wrote.
    if (stale || (wf && native)) await resolveReports([{ ...wf, documentNumber: stale ? doc : wf.documentNumber }]);
  }
}

/** Shipment-order conditions a single transaction can touch. */
function shipmentFilterFor(id, c, refs, keys) {
  const or = [{ 'customsLink.clearance': new mongoose.Types.ObjectId(id) }];
  if (refs.size) {
    const list = [...refs];
    const nums = list.map(Number).filter((n) => Number.isFinite(n));
    or.push({ reference: { $in: list } });
    if (nums.length) { or.push({ graduationNumber: { $in: nums } }); or.push({ waybillNumber: { $in: nums } }); }
  }
  if (keys.size) {
    const rx = { $regex: [...keys].map(looseRx).join('|'), $options: 'i' };
    or.push({ blNumber: rx }); or.push({ containerNumber: rx });
  }
  return { $or: or };
}

// Queue: saving a transaction does not wait for linking. The hook fires after every save and a transaction can be saved twice in one request, so arrivals within 250 ms are batched and computed once. An error here never fails the transaction save.
const pending = new Set();
let timer = null;
let running = Promise.resolve();
function queueClearance(id) {
  if (!id) return;
  try { cache.clear('customslink:'); } catch (_) { /* */ }
  pending.add(String(id));
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const ids = [...pending]; pending.clear();
    running = running.then(async () => {
      for (const one of ids) {
        try { await syncClearance(one); } catch (e) { console.error('[customs-link] تعذّر ربطُ كشوف المعاملة', one, e.message); }
      }
    });
  }, 250);
}
/** For tests and scripts: waits until the queue is empty. */
async function flush() {
  if (timer) { clearTimeout(timer); timer = null; const ids = [...pending]; pending.clear(); running = running.then(async () => { for (const one of ids) await syncClearance(one).catch(() => {}); }); }
  await running;
}

/** Cache is cleared, then broadcast; the order is intentional so a listener that fetches gets fresh data. Listening screens: operations table (`workflow:bulkImported`), collections (`collections:changed`) and the transaction page (`customs:opsLinks`). */
function announce({ reportNumbers = [], clearanceIds = [] } = {}) {
  for (const p of ['wf:', 'collections-dept:', 'cdr:', 'colledger:', 'customslink:']) {
    try { cache.clear(p); } catch (_) { /* */ }
  }
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('workflow:bulkImported', { customsLink: true, reportNumbers: reportNumbers.slice(0, 200) });
    emitToAll('collections:changed', { source: 'customs-link', reportNumbers: reportNumbers.slice(0, 200) });
    emitToAll('customs:opsLinks', { clearanceIds, reportNumbers: reportNumbers.slice(0, 200) });
  } catch (_) { /* No sockets in the script */ }
}

/** The shape screens read, without what they do not need. */
function linkView(l) {
  if (!l || !l.clearance) return null;
  return {
    clearanceId: idOf(l.clearance),
    refNumber: l.refNumber || '',
    blNumber: l.blNumber || '',
    customerName: l.customerName || '',
    containers: l.containers || [],
    via: l.via || '',
  };
}

/** All linked reports indexed by report number and by invoice number, for collections screens whose unit is the invoice (an invoice can span reports from several transactions). They are few among about forty thousand, so read once and cached for a minute; `announce` clears them on every link. */
async function linkedIndex() {
  return cache.wrap('customslink:linked', INDEX_TTL, async () => {
    const OperationsWorkflow = require('../models/OperationsWorkflow');
    const rows = await OperationsWorkflow.find({ 'customsLink.clearance': { $type: 'objectId' } })
      .select('reportNumber invoiceNumber customsLink').lean();
    const byReport = new Map(); const byInvoice = new Map();
    for (const r of rows) {
      const v = linkView(r.customsLink);
      if (!v) continue;
      byReport.set(String(r.reportNumber || '').trim(), v);
      const no = String(r.invoiceNumber || '').trim();
      if (no) {
        if (!byInvoice.has(no)) byInvoice.set(no, new Map());
        const per = byInvoice.get(no);
        const prev = per.get(v.clearanceId);
        // An invoice shows the transaction once; the containers of its reports are merged.
        per.set(v.clearanceId, prev
          ? { ...prev, containers: [...new Set([...prev.containers, ...v.containers])].sort(), reports: prev.reports + 1 }
          : { ...v, reports: 1 });
      }
    }
    return { byReport, byInvoice };
  });
}

/** Transactions of one invoice: an array (empty if nothing is linked). */
const customsOfInvoice = (idx, no) => [...((idx.byInvoice.get(String(no || '').trim()) || new Map()).values())];
/** Transaction of one report, or `null`. */
const customsOfReport = (idx, rn) => idx.byReport.get(String(rn || '').trim()) || null;

module.exports = {
  linkedIndex, customsOfInvoice, customsOfReport,
  VIA, AUTO_VIA,
  normKey, blKeysOf, unitKeyOf,
  loadIndex, autoLinkFor, decide, snapshot,
  resolveReports, syncClearance, linkPendingMoveRefs,
  resolveShipments, afterShipmentSaved, autoLinkForShipment,
  queueClearance, flush, announce, linkView,
};
