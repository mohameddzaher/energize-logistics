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
const SHIPMENT_DELETE_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager'];
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

const FLEET_OWNER = 'شركة تنشيط';

/** Workflow columns as a fleet load writes them. Fleet trucks are ours, so no purchase side. */
function rowOfFleet(f) {
  const when = f.loadDate || f.createdAt;
  return {
    reportDate: when,
    loadingTime: when ? new Date(when).toISOString() : '',
    fromLocation: str(f.fromCity),
    toLocation: str(f.toCity),
    branch: 'النقل الثقيل',
    username: str(f.customerName),
    carOwner: FLEET_OWNER,
    ownerName: FLEET_OWNER,
    carNumber: str(f.vehiclePlate),
    plateNumber: str(f.vehiclePlate),
    carName: str(f.vehiclePlate),
    driverName: str(f.driverName),
    driverPhone: str(f.driverPhone),
    truckType: str(f.trailerType),
    loadType: str(f.loadType),
    representativeName: str(f.supervisorName),
    applicationStatus: str(f.status),
    executionStatus: str(f.status),
    paymentMethod: isSubtype(f.paymentSubtype)
      ? (termsOfSubtype(f.paymentSubtype) === 'نقدي' ? 'cash' : 'late')
      : str(f.paymentType) === 'cash' ? 'cash' : 'late',
    driverRentalType: str(f.rentType),
    driverCost: num(f.driverExpense),
    // A branch customer is a 3PL customer carried by our truck: the fleet's price is what the company pays its fleet (purchase), and the real selling price is written in the workflow by sales, operations or the data team, so it is never written from here.
    ...(f.customerType === 'branch' ? { purchaseValue: num(f.price) } : { sellingValue: num(f.price) }),
  };
}

const fleetPayment = (f) => (isSubtype(f.paymentSubtype)
  ? { paymentType: subtypeFamily(f.paymentSubtype), paymentSubtype: f.paymentSubtype, paymentTypeSource: 'manual' }
  : str(f.paymentType) === 'cash'
  ? { paymentType: 'cash', paymentSubtype: 'cash_ht', paymentTypeSource: 'manual' }
  : str(f.paymentType) === 'tax' ? { paymentType: 'tax', paymentSubtype: 'deferred_invoice', paymentTypeSource: 'manual' } : {});

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
  wanted.documentNumber = doc;

  if (wf) {
    const diff = changes(wf, wanted);
    if (!Object.keys(diff).length) return { changed: false };
    await OperationsWorkflow.updateOne({ _id: wf._id }, { $set: diff });
    if ('documentNumber' in diff) await require('./customsOpsLink').resolveReports({ _id: wf._id }).catch((e) => console.error('[so-link] customs:', e.message));
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
  // The row may be born after the shipment's own customs pass, so it links here too.
  if (doc) await require('./customsOpsLink').resolveReports({ shipmentOrder: o._id }).catch((e) => console.error('[so-link] customs:', e.message));
  const { ensureCollectionsParty } = require('../utils/ensureCollectionsParty');
  await ensureCollectionsParty(o.customerName, { paymentType: wanted.paymentType || '', source: 'operations_workflow' })
    .catch((e) => console.error('[so-link] collections party:', e.message));
  require('./customsOpsLink').linkPendingMoveRefs().catch((e) => console.error('[so-link] customs:', e.message));
  try { require('../utils/walletCollection').scheduleResync(); } catch (_) { /* */ }
  announceWorkflow();
  return { changed: true, created: true };
}

const fleetModel = () => require('../models/FleetModels').FleetShipment;
function announceFleet() {
  try { cache.clear('fleet:'); } catch (_) { /* */ }
  try { emitToAll('fleet:updated', { source: 'workflow' }); } catch (_) { /* */ }
}

/** Fleet load → workflow row. Creates the row on the first call. */
async function mirrorFleet(loadOrId) {
  const f = loadOrId?.createdAt ? loadOrId : await fleetModel().findById(loadOrId).lean();
  // A load carrying a shipment order has no workflow row of its own: the order's row is the one record (services/fleetOrderLink).
  if (f && f.shipmentOrder) return require('./fleetOrderLink').fleetToOrder(f._id);
  if (!f || f.waybillNumber == null) return null;
  const wf = await OperationsWorkflow.findOne({ fleetShipment: f._id }).lean();
  // A load saved before it carried one of the four types takes the workflow's, so the two agree and the loads page shows it.
  if (wf && !isSubtype(f.paymentSubtype) && isSubtype(wf.paymentSubtype)) {
    await fleetModel().updateOne({ _id: f._id }, { $set: { paymentSubtype: wf.paymentSubtype, paymentType: subtypeFamily(wf.paymentSubtype) } });
    f.paymentSubtype = wf.paymentSubtype;
    f.paymentType = subtypeFamily(wf.paymentSubtype);
    announceFleet();
  }
  const wanted = { ...rowOfFleet(f), ...fleetPayment(f) };
  // The load's B/L or container is the row's document number, which the customs link reads; an empty load leaves what the link filled.
  const doc = str(f.blNumber) || str(f.containerNumber);
  if (doc) wanted.documentNumber = doc;
  if (wf) {
    const diff = changes(wf, wanted);
    if (!Object.keys(diff).length) return { changed: false };
    await OperationsWorkflow.updateOne({ _id: wf._id }, { $set: diff });
    if ('documentNumber' in diff) await require('./customsOpsLink').resolveReports({ _id: wf._id }).catch((e) => console.error('[fleet-link] customs:', e.message));
    announceWorkflow();
    return { changed: true };
  }
  try {
    await OperationsWorkflow.create({
      ...wanted, fleetShipment: f._id, reportNumber: String(f.waybillNumber), stage: 'draft', ownerType: 'operation', createdBy: f.createdBy,
    });
  } catch (e) {
    if (e.code === 11000) return { changed: false };
    throw e;
  }
  // A new load with a B/L or container links to its customs transaction at once, not on its first edit.
  if (doc) await require('./customsOpsLink').resolveReports({ fleetShipment: f._id }).catch((e) => console.error('[fleet-link] customs:', e.message));
  announceWorkflow();
  return { changed: true, created: true };
}

/** Workflow row → fleet load. */
async function pullFleet(w) {
  const load = await fleetModel().findById(w.fleetShipment).lean();
  if (!load) return null;
  const wanted = {
    fromCity: str(w.fromLocation), toCity: str(w.toLocation), customerName: str(w.username), vehiclePlate: str(w.plateNumber),
    driverName: str(w.driverName), driverPhone: str(w.driverPhone), trailerType: str(w.truckType), loadType: str(w.loadType),
    // Branch customer: the fleet's price is the row's purchase; the row's selling price is the company's and stays there.
    price: num(load.customerType === 'branch' ? w.purchaseValue : w.sellingValue), driverExpense: num(w.driverCost), status: str(w.applicationStatus) || load.status,
  };
  if (w.reportDate) wanted.loadDate = w.reportDate;
  if (isSubtype(w.paymentSubtype)) { wanted.paymentSubtype = w.paymentSubtype; wanted.paymentType = subtypeFamily(w.paymentSubtype); }
  const diff = changes(load, wanted);
  if (!Object.keys(diff).length) return { changed: false };
  await fleetModel().updateOne({ _id: load._id }, { $set: diff });
  announceFleet();
  return { changed: true };
}

/** Workflow row → shipment. A status change is logged on the shipment like any other. */
async function pullWorkflow(wfOrId, actor) {
  const w = wfOrId?.createdAt ? wfOrId : await OperationsWorkflow.findById(wfOrId).lean();
  if (w?.fleetShipment) return pullFleet(w);
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
  require('./fleetOrderLink').orderToFleetSoon(o._id);
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
  cargoType: ['loadType'], quantity: ['quantity'], status: ['applicationStatus', 'executionStatus'], paymentSubtype: ['paymentSubtype'],
  driverRentPrice: ['driverCost'], buyPrice: ['purchaseValue'], sellPrice: ['sellingValue'], pickupTime: ['reportDate', 'loadingTime'],
};
const ROW_TO_ORDER = Object.fromEntries(Object.entries(ORDER_TO_ROW).flatMap(([o, cols]) => cols.map((c) => [c, o])));
const linkOff = () => !require('./uplClient').isConfigured();
const PAYMENT_KEYS = ['paymentSubtype', 'paymentType'];

async function mirrorPlatformOrder(orderOrId, keys = []) {
  if (!linkOff()) return null;
  const o = orderOrId?.createdAt ? orderOrId : await ShipmentOrder.findById(orderOrId).lean();
  if (!o || o.source !== 'platform' || !o.externalId) return null;
  const wf = await OperationsWorkflow.findOne({ externalSource: 'ops_upl', externalId: String(o.externalId) }).lean();
  if (!wf) return null;
  const row = rowOf(o);
  const wanted = Object.fromEntries(keys.flatMap((k) => ORDER_TO_ROW[k] || []).map((c) => [c, row[c]]));
  // Payment type is chosen by hand on the shipment; the workflow takes it with its family.
  if (keys.includes('paymentSubtype') && isSubtype(o.paymentSubtype)) {
    Object.assign(wanted, { paymentSubtype: o.paymentSubtype, paymentType: subtypeFamily(o.paymentSubtype), paymentTypeSource: 'manual' });
  }
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
  if (keys.some((k) => PAYMENT_KEYS.includes(k)) && 'paymentSubtype' in all) {
    wanted.paymentSubtype = all.paymentSubtype;
  }
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
  const loads = rows.map((w) => w.fleetShipment).filter(Boolean);
  if (loads.length) await fleetModel().deleteMany({ _id: { $in: loads } });
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
  // Loads our fleet was carrying for these orders go with them.
  if (orderList.length) await fleetModel().deleteMany({ shipmentOrder: { $in: orderList } });
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
const mirrorFleetSoon = (id) => { if (id) run(mirrorFleet, id); };
const mirrorPlatformSoon = (id, keys) => { if (id) run(mirrorPlatformOrder, id, keys); };
const pullSoon = (id, actor, keys) => {
  if (!id) return;
  run(pullWorkflow, id, actor);
  run(pullPlatformRow, id, keys);
};

/**
 * Platform shipments take the workflow's payment type.
 * The workflow sets it many ways (by hand, in bulk, derived from the customer), and only some of them called the shipment back, so 40,000 platform shipments read blank on the shipments page while the workflow had a type. Bulk and diff-only: unchanged shipments are not rewritten.
 */
async function syncPlatformPayment(since) {
  if (!linkOff()) return 0;
  const rows = await OperationsWorkflow.find({ externalSource: 'ops_upl', externalId: { $nin: ['', null] }, updatedAt: { $gt: since } })
    .select('externalId paymentSubtype').lean();
  const want = new Map(rows.filter((w) => isSubtype(w.paymentSubtype)).map((w) => [String(w.externalId), w.paymentSubtype]));
  let changed = 0;
  const ids = [...want.keys()];
  for (let i = 0; i < ids.length; i += 2000) {
    const batch = ids.slice(i, i + 2000);
    const orders = await ShipmentOrder.find({ source: 'platform', externalId: { $in: batch } }).select('externalId paymentSubtype').lean(); // eslint-disable-line no-await-in-loop
    const ops = [];
    for (const o of orders) {
      const k = want.get(String(o.externalId));
      if (o.paymentSubtype === k) continue;
      ops.push({ updateOne: { filter: { _id: o._id }, update: { $set: { paymentSubtype: k } } } });
    }
    if (ops.length) { await ShipmentOrder.bulkWrite(ops, { ordered: false }); changed += ops.length; } // eslint-disable-line no-await-in-loop
  }
  if (changed) announceOrders();
  return changed;
}

/** One pass over everything touched since `since`; the later side of each pair wins. */
async function reconcile(since) {
  await syncPlatformPayment(since).catch((e) => console.error('[so-link] payment:', e.message));
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

  const loads = await fleetModel().find({ updatedAt: { $gt: since } }).lean();
  const fleetRows = await OperationsWorkflow.find({ fleetShipment: { $type: 'objectId' }, updatedAt: { $gt: since } }).lean();
  const rowBy = new Map(fleetRows.map((w) => [String(w.fleetShipment), w]));
  const loadIds = new Set(loads.map((f) => String(f._id)));
  for (const f of loads) {
    const w = rowBy.get(String(f._id)) || await OperationsWorkflow.findOne({ fleetShipment: f._id }).lean();
    if (w && new Date(w.updatedAt) > new Date(f.updatedAt)) await pullFleet(w);
    else await mirrorFleet(f);
  }
  for (const w of fleetRows) if (!loadIds.has(String(w.fleetShipment))) await pullFleet(w);
}

const BEFORE_ARRIVAL = ['requesting', 'loading', 'uploaded', 'on_way'];
const LATE_FROM = new Date('2026-11-01T00:00:00+03:00');
const riyadhDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(d));

/**
 * At noon on its arrival date, a shipment that has not arrived turns late. Runs once
 * per arrival date, so a person can move it back, and a new date counts again.
 * Older shipments keep the status they came from the platform with.
 */
async function markLateArrivals(now = new Date()) {
  const rows = await ShipmentOrder.find({ status: { $in: BEFORE_ARRIVAL }, arrivalTime: { $gte: LATE_FROM, $lte: new Date(now.getTime() + 864e5) } })
    .select('status arrivalTime source lateForDay').lean();
  let moved = 0;
  for (const o of rows) {
    const day = riyadhDay(o.arrivalTime);
    if (o.lateForDay === day || now < new Date(`${day}T12:00:00+03:00`)) continue;
    const r = await ShipmentOrder.updateOne({ _id: o._id, status: o.status }, {
      $set: { status: 'late', lateForDay: day },
      $push: { statusLog: { from: o.status, to: 'late', note: 'تأخرت تلقائيًا: جاء وقت الوصول ولم تصل', at: now, byName: 'النظام' } },
    });
    if (r.modifiedCount) {
      moved += 1;
      await (o.source === 'platform' ? mirrorPlatformOrder(o._id, ['status']) : mirrorOrder(o._id));
    }
  }
  if (moved) announceOrders();
  return moved;
}

let lateTimer = null;
let timer = null;
function startShipmentOrderLink() {
  if (!lateTimer) {
    lateTimer = setInterval(() => { markLateArrivals().catch((e) => console.error('[so-link] late:', e.message)); }, 5 * 60 * 1000);
  }
  if (timer) return;
  // The first pass reaches back far enough to bring in loads made before the link.
  let since = new Date(0);
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
  SHIPMENT_DELETE_ROLES, syncPlatformPayment, deleteShipments, announceRename, markLateArrivals, mirrorFleet, mirrorFleetSoon, mirrorOrder, pullWorkflow, mirrorPlatformOrder, pullPlatformRow, mirrorSoon, mirrorPlatformSoon, pullSoon, reconcile, startShipmentOrderLink,
};
