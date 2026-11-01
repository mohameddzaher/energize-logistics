/**
 * Keeps a shipment created on our system and its operations workflow row as one
 * record read in two screens. Platform shipments get this from the platform sync;
 * these have no outside source, so each edit is copied across here.
 *
 * Writes are diffed, so copying back and forth settles instead of looping, and a
 * periodic pass covers writers that do not call in (collections, rename, wallet).
 * When both sides moved, the later `updatedAt` wins.
 */
const ShipmentOrder = require('../models/ShipmentOrder');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const cache = require('../utils/ttlCache');
const { emitToAll } = require('../websocket/socketManager');
const { derivePaymentTypeFor, isSubtype, subtypeFamily, subtypeAfterAuto } = require('../utils/paymentType');
const { termsOfSubtype } = require('../utils/shipmentOrderPayment');

const TICK_MS = 15000;
// One shipment is one record, so these three alone delete it, from either screen.
const SHIPMENT_DELETE_ROLES = ['super_admin', 'admin', 'operations_manager'];
const WF_READERS = ['wf:', 'collections-dept:', 'cdr:', 'colledger:', 'opsprivate:', 'ops:'];
const METHOD = { 'نقدي': 'cash', 'آجل': 'late' };

const str = (v) => String(v == null ? '' : v).trim();
const num = (v) => Number(v) || 0;
const same = (cur, v) => {
  if (v instanceof Date) return new Date(cur || 0).getTime() === v.getTime();
  if (typeof v === 'number') return num(cur) === v;
  return str(cur) === str(v);
};
const changes = (doc, wanted) => Object.fromEntries(Object.entries(wanted).filter(([k, v]) => !same(doc?.[k], v)));

/** Workflow columns as this shipment writes them. */
function rowOf(o) {
  const when = o.pickupTime || o.createdAt;
  return {
    reportDate: when,
    loadingTime: when ? new Date(when).toISOString() : '',
    fromLocation: str(o.fromCity || o.addressFrom),
    toLocation: str(o.toCity || o.addressTo),
    branch: str(o.branch),
    username: str(o.customerName),
    carOwner: str(o.supplierName),
    ownerName: str(o.supplierName),
    carNumber: str(o.vehiclePlate),
    plateNumber: str(o.vehiclePlate),
    carName: str(o.vehicleName),
    driverName: str(o.driverName),
    driverPhone: str(o.driverPhone),
    truckType: str(o.truckType),
    truckSize: str(o.truckLength),
    loadType: str(o.cargoType),
    quantity: o.quantity != null ? String(o.quantity) : '',
    representativeName: str(o.agentName),
    applicationStatus: str(o.status),
    executionStatus: str(o.status),
    paymentMethod: METHOD[str(o.paymentMethod)] || str(o.paymentMethod),
    driverRentalType: str(o.driverRentType),
    driverCost: num(o.driverRentPrice),
    purchaseValue: num(o.buyPrice),
    sellingValue: num(o.sellPrice),
  };
}

/** Order fields a workflow edit may change. Same columns, read the other way. */
function orderOf(w) {
  const out = {
    fromCity: str(w.fromLocation),
    toCity: str(w.toLocation),
    branch: str(w.branch),
    customerName: str(w.username),
    supplierName: str(w.carOwner),
    vehiclePlate: str(w.plateNumber),
    vehicleName: str(w.carName),
    driverName: str(w.driverName),
    driverPhone: str(w.driverPhone),
    truckType: str(w.truckType),
    truckLength: str(w.truckSize),
    cargoType: str(w.loadType),
    sellPrice: num(w.sellingValue),
    buyPrice: num(w.purchaseValue),
    driverRentPrice: num(w.driverCost),
  };
  if (w.reportDate) out.pickupTime = w.reportDate;
  if (str(w.quantity)) out.quantity = Number(w.quantity) || 0;
  if (isSubtype(w.paymentSubtype)) {
    out.paymentSubtype = w.paymentSubtype;
    out.paymentMethod = termsOfSubtype(w.paymentSubtype);
  }
  return out;
}

async function paymentColumns(o, wf, reportDate) {
  if (isSubtype(o.paymentSubtype)) {
    return { paymentSubtype: o.paymentSubtype, paymentType: subtypeFamily(o.paymentSubtype), paymentTypeSource: 'manual' };
  }
  if (['manual', 'unified'].includes(str(wf?.paymentTypeSource))) return {};
  const CollectionsParty = require('../models/CollectionsParty');
  const party = await CollectionsParty.findOne({
    kind: 'customer',
    $or: [{ nameKey: CollectionsParty.fold(o.customerName) }, { aliasKeys: CollectionsParty.fold(o.customerName) }],
  }).select('paymentType').lean();
  const derived = derivePaymentTypeFor({ reportDate, paymentMethod: METHOD[str(o.paymentMethod)] || o.paymentMethod }, party?.paymentType || '');
  if (!derived) return {};
  return {
    paymentType: derived,
    paymentTypeSource: 'auto',
    paymentSubtype: subtypeAfterAuto(wf?.paymentType, derived, wf?.paymentSubtype) ?? '',
  };
}

function announceWorkflow() {
  for (const p of WF_READERS) { try { cache.clear(p); } catch (_) { /* */ } }
  try { emitToAll('collections:changed', { source: 'shipment_orders' }); } catch (_) { /* */ }
  try { emitToAll('workflow:bulkImported', { source: 'shipment_orders', live: true }); } catch (_) { /* */ }
}

function announceOrders() {
  try { cache.clear('so:'); } catch (_) { /* */ }
  try { emitToAll('shipmentOrders:updated', { source: 'workflow' }); } catch (_) { /* */ }
}

/** Shipment → workflow row. Creates the row on the first call. */
async function mirrorOrder(orderOrId) {
  const o = orderOrId?.createdAt ? orderOrId : await ShipmentOrder.findById(orderOrId).lean();
  if (!o || o.source === 'platform' || o.graduationNumber == null) return null;
  const wf = await OperationsWorkflow.findOne({ shipmentOrder: o._id }).lean();
  const wanted = rowOf(o);
  Object.assign(wanted, await paymentColumns(o, wf, wanted.reportDate));
  const doc = str(o.blNumber) || str(o.containerNumber);
  if (doc && !str(wf?.documentNumber)) wanted.documentNumber = doc;

  if (wf) {
    const diff = changes(wf, wanted);
    if (!Object.keys(diff).length) return { changed: false };
    await OperationsWorkflow.updateOne({ _id: wf._id }, { $set: diff });
    announceWorkflow();
    return { changed: true };
  }
  try {
    await OperationsWorkflow.create({
      ...wanted, shipmentOrder: o._id, reportNumber: String(o.graduationNumber), stage: 'draft', ownerType: 'operation', createdBy: o.createdBy,
    });
  } catch (e) {
    // A hook and the periodic pass raced; the next pass aligns any difference.
    if (e.code === 11000) return { changed: false };
    throw e;
  }
  const { ensureCollectionsParty } = require('../utils/ensureCollectionsParty');
  await ensureCollectionsParty(o.customerName, { paymentType: wanted.paymentType || '', source: 'operations_workflow' })
    .catch((e) => console.error('[so-link] collections party:', e.message));
  require('./customsOpsLink').linkPendingMoveRefs().catch((e) => console.error('[so-link] customs:', e.message));
  try { require('../utils/walletCollection').scheduleResync(); } catch (_) { /* */ }
  announceWorkflow();
  return { changed: true, created: true };
}

/** Workflow row → shipment. A status change is logged on the shipment like any other. */
async function pullWorkflow(wfOrId, actor) {
  const w = wfOrId?.createdAt ? wfOrId : await OperationsWorkflow.findById(wfOrId).lean();
  if (!w?.shipmentOrder) return null;
  const o = await ShipmentOrder.findById(w.shipmentOrder).lean();
  if (!o) return null;
  const diff = changes(o, orderOf(w));
  if (diff.customerName) {
    const c = await require('../models/ShipmentOrderCustomer').findOne({ name: diff.customerName }).select('_id').lean();
    if (c) diff.customer = c._id;
  }
  if (diff.supplierName) {
    const s = await require('../models/ShipmentOrderSupplier').findOne({ name: diff.supplierName }).select('_id').lean();
    if (s) diff.supplier = s._id;
  }
  const status = str(w.applicationStatus);
  const update = {};
  if (Object.keys(diff).length) update.$set = diff;
  const filter = { _id: o._id };
  if (status && status !== str(o.status)) {
    update.$set = { ...(update.$set || {}), status };
    update.$push = {
      statusLog: {
        from: o.status, to: status, note: 'من سير عمل التشغيل', at: new Date(),
        by: actor?._id || null, byName: actor ? `${actor.firstName || ''} ${actor.lastName || ''}`.trim() : '',
      },
    };
    // A hook and the periodic pass can race: only the first one logs the move.
    filter.status = o.status;
  }
  if (!Object.keys(update).length) return { changed: false };
  await ShipmentOrder.updateOne(filter, update);
  announceOrders();
  return { changed: true };
}

/**
 * Rows that came from the platform keep their own spellings on each side (plate,
 * payment method, driver), so only the fields an edit actually touched are copied.
 * Runs only once the link is off; until then the platform sync carries them.
 */
const ORDER_TO_ROW = {
  fromCity: ['fromLocation'], toCity: ['toLocation'], branch: ['branch'], customerName: ['username'],
  supplierName: ['carOwner', 'ownerName'], vehiclePlate: ['carNumber', 'plateNumber'], vehicleName: ['carName'],
  driverName: ['driverName'], driverPhone: ['driverPhone'], truckType: ['truckType'], truckLength: ['truckSize'],
  cargoType: ['loadType'], quantity: ['quantity'], status: ['applicationStatus', 'executionStatus'],
  driverRentPrice: ['driverCost'], buyPrice: ['purchaseValue'], sellPrice: ['sellingValue'], pickupTime: ['reportDate', 'loadingTime'],
};
const ROW_TO_ORDER = Object.fromEntries(Object.entries(ORDER_TO_ROW).flatMap(([o, cols]) => cols.map((c) => [c, o])));
const linkOff = () => !require('./uplClient').isConfigured();

async function mirrorPlatformOrder(orderOrId, keys = []) {
  if (!linkOff()) return null;
  const o = orderOrId?.createdAt ? orderOrId : await ShipmentOrder.findById(orderOrId).lean();
  if (!o || o.source !== 'platform' || !o.externalId) return null;
  const wf = await OperationsWorkflow.findOne({ externalSource: 'ops_upl', externalId: String(o.externalId) }).lean();
  if (!wf) return null;
  const row = rowOf(o);
  const wanted = Object.fromEntries(keys.flatMap((k) => ORDER_TO_ROW[k] || []).map((c) => [c, row[c]]));
  const diff = changes(wf, wanted);
  if (!Object.keys(diff).length) return { changed: false };
  await OperationsWorkflow.updateOne({ _id: wf._id }, { $set: diff });
  announceWorkflow();
  return { changed: true };
}

async function pullPlatformRow(id, keys = []) {
  if (!linkOff()) return null;
  const w = await OperationsWorkflow.findById(id).lean();
  if (w?.externalSource !== 'ops_upl' || !w.externalId) return null;
  const o = await ShipmentOrder.findOne({ source: 'platform', externalId: String(w.externalId) }).lean();
  if (!o) return null;
  const all = { ...orderOf(w), status: str(w.applicationStatus) };
  const wanted = Object.fromEntries(keys.map((c) => ROW_TO_ORDER[c]).filter((k) => k && k in all).map((k) => [k, all[k]]));
  const diff = changes(o, wanted);
  if (!Object.keys(diff).length) return { changed: false };
  const update = { $set: diff };
  // Keeps «how many arrived today» true for these rows too.
  if (diff.status) update.$push = { statusLog: { from: o.status, to: diff.status, note: 'من سير عمل التشغيل', at: new Date(), byName: '' } };
  await ShipmentOrder.updateOne({ _id: o._id }, update);
  announceOrders();
  return { changed: true };
}

/**
 * Deletes shipments from both screens. `rows` are workflow rows, `orders` shipments;
 * each is resolved to its other half. Copies land in deletedrecords (utils/keepDeleted)
 * and the manifest number is never issued again.
 */
async function deleteShipments({ rows = [], orders = [] }) {
  const orderIds = new Set(orders.map((o) => String(o._id)));
  const rowIds = new Set(rows.map((w) => String(w._id)));
  const refs = rows.map((w) => w.shipmentOrder).filter(Boolean);
  const ext = rows.filter((w) => w.externalSource === 'ops_upl' && w.externalId).map((w) => String(w.externalId));
  (await ShipmentOrder.find({ $or: [{ _id: { $in: refs } }, { source: 'platform', externalId: { $in: ext } }] }).select('_id').lean())
    .forEach((o) => orderIds.add(String(o._id)));
  const oIds = orders.map((o) => o._id);
  const oExt = orders.filter((o) => o.source === 'platform' && o.externalId).map((o) => String(o.externalId));
  (await OperationsWorkflow.find({ $or: [{ shipmentOrder: { $in: oIds } }, { externalSource: 'ops_upl', externalId: { $in: oExt } }] }).select('_id').lean())
    .forEach((w) => rowIds.add(String(w._id)));
  const rowList = [...rowIds]; const orderList = [...orderIds];
  for (let i = 0; i < rowList.length; i += 5000) await OperationsWorkflow.deleteMany({ _id: { $in: rowList.slice(i, i + 5000) } });
  for (let i = 0; i < orderList.length; i += 5000) await ShipmentOrder.deleteMany({ _id: { $in: orderList.slice(i, i + 5000) } });
  announceWorkflow();
  announceOrders();
  for (const _id of rowList.slice(0, 500)) { try { emitToAll('workflow:deleted', { _id }); } catch (_) { /* */ } }
  return { rows: rowList.length, orders: orderList.length };
}

/** A rename rewrote names on both screens outside this link. */
function announceRename() {
  announceWorkflow();
  announceOrders();
}

const run = (fn, ...args) => setImmediate(() => {
  fn(...args).catch((e) => console.error('[so-link]', e.message));
});
const mirrorSoon = (id) => { if (id) run(mirrorOrder, id); };
const mirrorPlatformSoon = (id, keys) => { if (id) run(mirrorPlatformOrder, id, keys); };
const pullSoon = (id, actor, keys) => {
  if (!id) return;
  run(pullWorkflow, id, actor);
  run(pullPlatformRow, id, keys);
};

/** One pass over everything touched since `since`; the later side of each pair wins. */
async function reconcile(since) {
  const [orders, rows] = await Promise.all([
    ShipmentOrder.find({ source: 'system', graduationNumber: { $ne: null }, updatedAt: { $gt: since } }).lean(),
    OperationsWorkflow.find({ shipmentOrder: { $type: 'objectId' }, updatedAt: { $gt: since } }).lean(),
  ]);
  const wfBy = new Map(rows.map((w) => [String(w.shipmentOrder), w]));
  const orderIds = new Set(orders.map((o) => String(o._id)));
  for (const o of orders) {
    let w = wfBy.get(String(o._id));
    if (!w) w = await OperationsWorkflow.findOne({ shipmentOrder: o._id }).lean();
    if (w && new Date(w.updatedAt) > new Date(o.updatedAt)) await pullWorkflow(w);
    else await mirrorOrder(o);
  }
  for (const w of rows) if (!orderIds.has(String(w.shipmentOrder))) await pullWorkflow(w);
}

let timer = null;
function startShipmentOrderLink() {
  if (timer) return;
  let since = new Date(Date.now() - 24 * 3600 * 1000);
  let running = false;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    const started = new Date(Date.now() - 5000);
    try { await reconcile(since); since = started; } catch (e) { console.error('[so-link] pass:', e.message); }
    running = false;
  }, TICK_MS);
}

module.exports = {
  SHIPMENT_DELETE_ROLES, deleteShipments, announceRename, mirrorOrder, pullWorkflow, mirrorPlatformOrder, pullPlatformRow, mirrorSoon, mirrorPlatformSoon, pullSoon, reconcile, startShipmentOrderLink,
};
