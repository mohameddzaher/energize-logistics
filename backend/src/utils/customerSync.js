/**
 * One customer list for shipment orders, sales, operations and the fleet (owner, 2026-11-10).
 * The shipment-orders customer (ShipmentOrderCustomer) is the identity: name, phone, email, address, code. The fleet keeps
 * a linked FleetCustomer per customer (`shipmentCustomer`) only for what is its own (customer type, rating, routes,
 * agreed payment type). Whatever screen edits a customer writes the shipment customer; the fleet row mirrors it.
 * Names also reach the CRM company it is linked to, and the CRM rename reaches back (renameCustomer).
 */
const fold = (v) => require('../models/CollectionsParty').fold(String(v || ''));
const { nameKey } = require('./nameKey');
const S = (v) => String(v == null ? '' : v).trim();

const Fleet = () => require('../models/FleetModels').FleetCustomer;
const Shipment = () => require('../models/ShipmentOrderCustomer');

/** Fields the fleet row copies from the shipment customer. */
const mirrorOf = (s) => ({
  name: s.name, nameKey: nameKey(s.name), phone: S(s.phone), email: S(s.email), address: S(s.address),
  crmCompany: s.crmCompany || null, customerCode: S(s.customerCode), isActive: s.isActive !== false,
});

/** Writes the shipment customer's identity onto its fleet row (creating or linking it). Returns the fleet row id. */
async function mirrorShipmentToFleet(s) {
  if (!s || !s._id) return null;
  const F = Fleet();
  let row = await F.findOne({ shipmentCustomer: s._id }).select('_id name shipmentCustomer').lean();
  if (!row) {
    // An existing fleet customer of the same company is linked rather than duplicated: same CRM company, else same folded name.
    const key = fold(s.name);
    const candidates = await F.find({ shipmentCustomer: null, $or: [...(s.crmCompany ? [{ crmCompany: s.crmCompany }] : []), { nameKey: nameKey(s.name) }] })
      .select('_id name crmCompany').lean();
    row = candidates.find((c) => s.crmCompany && String(c.crmCompany) === String(s.crmCompany)) || candidates.find((c) => fold(c.name) === key) || null;
  }
  const patch = mirrorOf(s);
  if (row) {
    if (!row.shipmentCustomer) await linkFleetRow(row._id, s._id);
    await F.updateOne({ _id: row._id }, { $set: { ...patch, shipmentCustomer: s._id } });
    if (row.name !== patch.name) await require('../models/FleetModels').FleetShipment.updateMany({ customer: row._id }, { $set: { customerName: patch.name } });
    return row._id;
  }
  try {
    const created = await F.collection.insertOne({ ...patch, shipmentCustomer: s._id, customerType: 'heavy', rating: 0, paymentType: '', taxNumber: '', routes: [], notes: '', createdAt: new Date(), updatedAt: new Date() });
    return created.insertedId;
  } catch (e) {
    // Another worker linked it at the same moment (unique index): update that row instead.
    if (e && e.code === 11000) {
      const again = await F.findOneAndUpdate({ shipmentCustomer: s._id }, { $set: patch }, { new: true }).select('_id').lean();
      return again ? again._id : null;
    }
    throw e;
  }
}

/** The shipment customer behind a fleet row; created from the fleet row when the company is only in the fleet. */
async function shipmentForFleet(fleetRow) {
  const SC = Shipment();
  if (fleetRow.shipmentCustomer) {
    const s = await SC.findById(fleetRow.shipmentCustomer);
    if (s) return s;
  }
  const key = fold(fleetRow.name);
  const pool = await SC.find({ $or: [...(fleetRow.crmCompany ? [{ crmCompany: fleetRow.crmCompany }] : []), { name: fleetRow.name }] });
  let s = pool.find((x) => fleetRow.crmCompany && String(x.crmCompany) === String(fleetRow.crmCompany)) || pool.find((x) => fold(x.name) === key);
  if (!s) {
    const all = await SC.find({}).select('_id name').lean();
    const hit = all.find((x) => fold(x.name) === key);
    if (hit) s = await SC.findById(hit._id);
  }
  if (!s) {
    s = await SC.create({ name: fleetRow.name, phone: S(fleetRow.phone), email: S(fleetRow.email), address: S(fleetRow.address), crmCompany: fleetRow.crmCompany || undefined });
  }
  await linkFleetRow(fleetRow._id, s._id);
  return s;
}

/**
 * Links a fleet row to a shipment customer. If another fleet row is already linked to it (an automatic mirror made before
 * the older fleet row was recognised as the same company), the two are merged: loads move to the older row, which keeps its
 * fleet fields, and the duplicate is removed.
 */
async function linkFleetRow(fleetId, shipmentId) {
  const F = Fleet();
  const other = await F.findOne({ shipmentCustomer: shipmentId, _id: { $ne: fleetId } }).select('_id').lean();
  if (other) {
    await require('../models/FleetModels').FleetShipment.updateMany({ customer: other._id }, { $set: { customer: fleetId } });
    await F.deleteOne({ _id: other._id });
  }
  await F.updateOne({ _id: fleetId }, { $set: { shipmentCustomer: shipmentId } });
  const s = await Shipment().findById(shipmentId).lean();
  if (s) await F.updateOne({ _id: fleetId }, { $set: mirrorOf(s) });
}

/**
 * Brings every shipment customer into the fleet list and refreshes names/contact (covers bulk writes that skip hooks).
 * Throttled per worker; `force` runs it now.
 */
let lastSweep = 0;
async function syncAll({ force = false } = {}) {
  if (!force && Date.now() - lastSweep < 60 * 1000) return null;
  lastSweep = Date.now();
  const SC = Shipment(); const F = Fleet();
  const [shipments, fleet] = await Promise.all([
    SC.find({}).select('name phone email address crmCompany customerCode isActive').lean(),
    F.find({}).select('name phone email address crmCompany customerCode isActive shipmentCustomer nameKey').lean(),
  ]);
  const byShip = new Map(fleet.filter((f) => f.shipmentCustomer).map((f) => [String(f.shipmentCustomer), f]));
  let created = 0; let refreshed = 0;
  for (const s of shipments) {
    const f = byShip.get(String(s._id));
    if (!f) { await mirrorShipmentToFleet(s); created += 1; continue; }
    const p = mirrorOf(s);
    const differs = Object.keys(p).some((k) => String(p[k] ?? '') !== String(f[k] ?? ''));
    if (differs) { await mirrorShipmentToFleet(s); refreshed += 1; }
  }
  // Fleet-only companies join the shared list.
  let joined = 0;
  for (const f of fleet.filter((x) => !x.shipmentCustomer)) {
    const fresh = await F.findById(f._id).lean();
    if (fresh && !fresh.shipmentCustomer) { await shipmentForFleet(fresh); joined += 1; }
  }
  if (created || refreshed || joined) {
    try { require('../websocket/socketManager').emitToAll('fleet:customers', {}); } catch (_) { /* */ }
  }
  return { created, refreshed, joined };
}

/**
 * A rename from any screen: the shipment customer (identity), its fleet row, the linked CRM company and every register
 * that keys by name (utils/renameOpsCustomer: operations reports, orders, fleet loads, customs, collections).
 */
async function renameCustomer(shipmentCustomerId, oldName, newName, { skipCrm = false } = {}) {
  const to = S(newName); const from = S(oldName);
  if (!to || to === from) return;
  const s = await Shipment().findById(shipmentCustomerId);
  if (!s) return;
  if (s.name !== to) { s.name = to; s.nameManual = true; await s.save(); }
  await require('../models/ShipmentOrder').updateMany({ customer: s._id }, { customerName: to });
  await mirrorShipmentToFleet(s.toObject());
  if (from) await require('./renameOpsCustomer').renameOpsCustomer(from, to).catch(() => {});
  if (!skipCrm && s.crmCompany) {
    const CrmCompany = require('../models/CrmCompany');
    const c = await CrmCompany.findById(s.crmCompany).select('name').lean();
    if (c && c.name !== to) await CrmCompany.updateOne({ _id: c._id }, { $set: { name: to, nameKey: fold(to) } });
  }
  try {
    const io = require('../websocket/socketManager');
    io.emitToAll('fleet:customers', {}); io.emitToAll('customers:changed', { origin: 'rename' });
  } catch (_) { /* */ }
}

module.exports = { mirrorShipmentToFleet, shipmentForFleet, syncAll, renameCustomer };
