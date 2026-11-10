/**
 * A shipment order carried by our own fleet (owner, 2026-11-10).
 * Shipment orders (3PL) treats the fleet as a supplier: when the order's supplier is our company («تنشيط»), the same
 * load appears in «إدارة الأسطول» as a linked FleetShipment (same transport order number, `shipmentOrder` ref), so the
 * fleet works it like its own: status, driver, follow-ups. Both sides follow each other at once.
 * Money: the fleet's price («إيجار السيارة», its selling price) is the company's purchase price on the order; the fleet
 * never sees the order's selling price. The order keeps the one operations-workflow row (the fleet load does not create
 * its own), so the workflow reads purchase = fleet price and sale = what sales wrote.
 * Writes are diffed updateOne calls that do not call back, so the two sides settle instead of looping.
 */
const ShipmentOrder = require('../models/ShipmentOrder');
const OURS = /تنشيط/;
const str = (v) => String(v == null ? '' : v).trim();
const num = (v) => Number(v) || 0;

const Fleet = () => require('../models/FleetModels');
const isOurs = (o) => !!o && OURS.test(str(o.supplierName));
const FLEET_STATUSES = new Set(['requesting', 'loading', 'uploaded', 'on_way', 'arrived', 'bond_sent', 'bond_received', 'late', 'invoiced', 'cancelled']);

function announce() {
  try { require('../utils/ttlCache').clear('fleet:'); } catch (_) { /* */ }
  try { require('../websocket/socketManager').emitToAll('fleet:updated', { source: 'shipment_orders' }); } catch (_) { /* */ }
}
function announceOrders(id) {
  try { require('../utils/ttlCache').clear('so:'); } catch (_) { /* */ }
  try { require('../websocket/socketManager').emitToAll('shipmentOrders:updated', { id: String(id), source: 'fleet' }); } catch (_) { /* */ }
}
const same = (a, b) => (b instanceof Date ? new Date(a || 0).getTime() === b.getTime() : typeof b === 'number' ? num(a) === b : str(a) === str(b));

/** Our truck and driver behind the order, by plate and name; the supervisor is the truck's. */
async function fleetRefs(o) {
  const { FleetVehicle, FleetDriver } = Fleet();
  const key = (p) => require('../utils/plateKey').registryPlateKey(p);
  let vehicle = null;
  if (str(o.vehiclePlate)) {
    const k = key(o.vehiclePlate);
    const all = await FleetVehicle.find({}).select('plate trailerType supervisor supervisorName').lean();
    vehicle = all.find((v) => key(v.plate) === k) || null;
  }
  const driver = str(o.driverName) ? await FleetDriver.findOne({ name: str(o.driverName) }).select('_id phone').lean() : null;
  let supervisorName = '';
  if (vehicle && vehicle.supervisor && !vehicle.supervisorName) {
    const u = await require('../models/User').findById(vehicle.supervisor).select('firstName lastName').lean();
    supervisorName = u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '';
  }
  return { vehicle, driver, supervisorName: (vehicle && vehicle.supervisorName) || supervisorName };
}

/** Order → fleet load: creates, updates or removes the linked load. */
async function orderToFleet(orderId) {
  const { FleetShipment, FleetCustomer, FleetEvent } = Fleet();
  const o = await ShipmentOrder.findById(orderId).lean();
  const load = await FleetShipment.findOne({ shipmentOrder: orderId }).lean();
  if (!o || !isOurs(o)) {
    // No longer ours (supplier changed, or the order deleted): the mirror load goes with its log, so the fleet does not work a load another supplier carries.
    if (load) {
      await FleetEvent.deleteMany({ shipment: load._id });
      await FleetShipment.deleteOne({ _id: load._id });
      announce();
    }
    return null;
  }
  const refs = await fleetRefs(o);
  const cust = o.customer ? await FleetCustomer.findOne({ shipmentCustomer: o.customer }).select('_id').lean() : null;
  const wanted = {
    customer: cust ? cust._id : null,
    customerName: str(o.customerName),
    customerType: 'branch',
    fromCity: str(o.fromCity || o.addressFrom),
    toCity: str(o.toCity || o.addressTo),
    loadDate: o.pickupTime || o.createdAt || null,
    vehiclePlate: str(o.vehiclePlate),
    vehicle: refs.vehicle ? refs.vehicle._id : null,
    trailerType: str((refs.vehicle && refs.vehicle.trailerType) || o.truckType),
    driverName: str(o.driverName),
    driverPhone: str(o.driverPhone),
    driver: refs.driver ? refs.driver._id : null,
    blNumber: str(o.blNumber),
    containerNumber: str(o.containerNumber),
    loadType: str(o.cargoType),
    branch: str(o.branch),
    notes: str(o.notes),
  };
  if (FLEET_STATUSES.has(str(o.status))) wanted.status = str(o.status);
  // The order's purchase price is the fleet's price; an empty purchase price leaves what the fleet wrote.
  if (num(o.buyPrice) > 0) wanted.price = num(o.buyPrice);
  if (refs.vehicle && refs.vehicle.supervisor) { wanted.supervisor = refs.vehicle.supervisor; wanted.supervisorName = refs.supervisorName; }

  if (!load) {
    const created = await FleetShipment.create({
      ...wanted, shipmentOrder: o._id, waybillNumber: o.waybillNumber, createdBy: o.createdBy || null,
    }).catch(async (e) => {
      // The number is taken in the fleet series by an old load: the link is kept without it.
      if (e && e.code === 11000) return FleetShipment.create({ ...wanted, shipmentOrder: o._id, createdBy: o.createdBy || null });
      throw e;
    });
    await FleetEvent.create({ shipment: created._id, type: 'created', data: { from: 'shipment_orders', waybillNumber: o.waybillNumber }, byName: 'طلبات الشحنات' }).catch(() => {});
    announce();
    return { created: true };
  }
  const diff = Object.fromEntries(Object.entries(wanted).filter(([k, v]) => {
    if (v === null) return load[k] != null && String(load[k]) !== '';
    if (v && typeof v === 'object' && v._bsontype) return String(load[k] || '') !== String(v);
    return !same(load[k], v);
  }));
  if (!Object.keys(diff).length) return { changed: false };
  await FleetShipment.updateOne({ _id: load._id }, { $set: diff });
  if (diff.status) await FleetEvent.create({ shipment: load._id, type: 'status', data: { from: load.status, to: diff.status, via: 'shipment_orders' }, byName: 'طلبات الشحنات' }).catch(() => {});
  announce();
  return { changed: true };
}

/** Fleet load → order: what the fleet works (status, driver, truck, its price as the purchase price). */
async function fleetToOrder(loadId, actor) {
  const { FleetShipment } = Fleet();
  const load = await FleetShipment.findById(loadId).lean();
  if (!load || !load.shipmentOrder) return null;
  const o = await ShipmentOrder.findById(load.shipmentOrder).lean();
  if (!o) return null;
  const wanted = {
    driverName: str(load.driverName), driverPhone: str(load.driverPhone), vehiclePlate: str(load.vehiclePlate),
  };
  if (num(load.price) > 0) wanted.buyPrice = num(load.price);
  const set = Object.fromEntries(Object.entries(wanted).filter(([k, v]) => !same(o[k], v)));
  const push = {};
  if (str(load.status) && str(load.status) !== str(o.status)) {
    set.status = str(load.status);
    push.statusLog = { from: o.status, to: load.status, note: 'من إدارة الأسطول', at: new Date(), by: actor?._id || null, byName: actorName(actor) };
  }
  if (!Object.keys(set).length && !push.statusLog) return { changed: false };
  await ShipmentOrder.updateOne({ _id: o._id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(push.statusLog ? { $push: push } : {}) });
  // The order owns the workflow row and the request copy: both follow.
  require('./shipmentOrderWorkflowLink').mirrorSoon(o._id);
  if (o.shipmentRequest) {
    const placed = { 'placed.$.driverName': str(load.driverName), 'placed.$.vehiclePlate': str(load.vehiclePlate) };
    await require('../models/ShipmentRequest').updateOne({ _id: o.shipmentRequest, 'placed.order': o._id }, { $set: placed }).catch(() => {});
    try { require('../websocket/socketManager').emitToAll('shipmentRequests:changed', { id: String(o.shipmentRequest) }); } catch (_) { /* */ }
  }
  announceOrders(o._id);
  return { changed: true };
}

const actorName = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.name || '' : '');

/** A follow-up written on either side is written on the other. */
async function followUpToOrder(loadId, data, actor) {
  const { FleetShipment } = Fleet();
  const load = await FleetShipment.findById(loadId).select('shipmentOrder').lean();
  if (!load || !load.shipmentOrder) return;
  const o = await ShipmentOrder.findById(load.shipmentOrder).select('status').lean();
  if (!o) return;
  const text = [data.currentLocation && `الموقع: ${data.currentLocation}`, data.note].filter(Boolean).join(' — ') || 'متابعة';
  await ShipmentOrder.updateOne({ _id: o._id }, { $push: { statusLog: { from: o.status, to: o.status, note: `${text} (إدارة الأسطول)`, at: data.contactTime || new Date(), by: actor?._id || null, byName: actorName(actor) } } });
  announceOrders(o._id);
}
async function noteToFleet(orderId, note, actor) {
  const { FleetShipment, FleetEvent } = Fleet();
  const load = await FleetShipment.findOne({ shipmentOrder: orderId }).select('_id lastContactAt').lean();
  if (!load) return;
  const now = new Date();
  await FleetEvent.create({ shipment: load._id, type: 'followup', data: { contactTime: now, currentLocation: '', note: `${note} (طلبات الشحنات)`, expectedArrival: null }, by: actor?._id || null, byName: actorName(actor) });
  await FleetShipment.updateOne({ _id: load._id }, { $set: { lastContactAt: now } });
  announce();
}

const soon = (fn, ...args) => setImmediate(() => fn(...args).catch((e) => console.error('[fleet-order-link]', e.message)));
module.exports = {
  isOurs, orderToFleet, fleetToOrder, followUpToOrder, noteToFleet,
  orderToFleetSoon: (id) => id && soon(orderToFleet, id),
  fleetToOrderSoon: (id, actor) => id && soon(fleetToOrder, id, actor),
};
