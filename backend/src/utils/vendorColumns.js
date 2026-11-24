/**
 * The workflow's two supplier columns, derived from the shipment's supplier and its kind in the register:
 *   vendorLabel (the "supplier" column)      the company's name, or FREELANCER_LABEL for an individual;
 *   vendorName  (the "supplier name" column) the company's or the freelancer's own name.
 * The vehicle owner column (carOwner) is separate and is not touched here.
 * Written by the shipment→workflow mirror, refreshed when a supplier is renamed, retyped or merged, and backfilled once at boot.
 */
const FREELANCER_LABEL = 'فريلانسر';

const str = (v) => String(v == null ? '' : v).trim();

/** Columns for a supplier name and its register kind ('freelancer' or anything else = company). */
function columnsOf(name, type) {
  const n = str(name);
  if (!n) return { vendorKind: '', vendorLabel: '', vendorName: '' };
  const free = type === 'freelancer';
  return { vendorKind: free ? 'freelancer' : 'vendor', vendorLabel: free ? FREELANCER_LABEL : n, vendorName: n };
}

/** Kind of a supplier name as text (platform rows): the live register row with that exact name decides. */
async function typeByName(names) {
  const Supplier = require('../models/ShipmentOrderSupplier');
  const list = [...new Set(names.map(str).filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < list.length; i += 2000) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await Supplier.find({ name: { $in: list.slice(i, i + 2000) }, mergedInto: null }).select('name type').lean();
    for (const r of rows) if (!out.has(r.name) || r.type === 'freelancer') out.set(r.name, r.type || 'company');
  }
  return out;
}

/**
 * After a supplier's name or kind changed: its shipments take the new kind, and every workflow row of those shipments, or carrying
 * its old or new name as text, is recomputed. Returns the number of workflow rows changed.
 */
async function refreshSupplier(supplierId, oldName = '') {
  const Supplier = require('../models/ShipmentOrderSupplier');
  const ShipmentOrder = require('../models/ShipmentOrder');
  const Workflow = require('../models/OperationsWorkflow');
  const sup = await Supplier.findById(supplierId).select('name type').lean();
  if (!sup) return 0;
  const type = sup.type === 'freelancer' ? 'freelancer' : 'company';
  await ShipmentOrder.updateMany({ supplier: sup._id, supplierType: { $ne: type } }, { $set: { supplierType: type } });
  const orderIds = await ShipmentOrder.find({ supplier: sup._id }).distinct('_id');
  const names = [...new Set([sup.name, oldName].map(str).filter(Boolean))];
  const cols = columnsOf(sup.name, type);
  const r = await Workflow.updateMany(
    { $or: [{ shipmentOrder: { $in: orderIds } }, { vendorName: { $in: names } }] },
    { $set: cols },
  );
  if (r.modifiedCount) require('../services/shipmentOrderWorkflowLink').announceRename();
  return r.modifiedCount || 0;
}

/**
 * One-time fill for rows written before the columns existed (`vendorName` absent): orders take their register kind, workflow rows
 * linked to an order follow it, the rest read their supplier from carOwner. Idempotent and safe on both workers.
 */
async function backfill() {
  const Supplier = require('../models/ShipmentOrderSupplier');
  const ShipmentOrder = require('../models/ShipmentOrder');
  const Workflow = require('../models/OperationsWorkflow');
  let orders = 0;
  let rows = 0;

  const free = await Supplier.find({ type: 'freelancer' }).distinct('_id');
  orders += (await ShipmentOrder.collection.updateMany({ supplierType: { $exists: false }, supplier: { $in: free } }, { $set: { supplierType: 'freelancer' } })).modifiedCount || 0;
  orders += (await ShipmentOrder.collection.updateMany({ supplierType: { $exists: false }, supplier: { $ne: null } }, { $set: { supplierType: 'company' } })).modifiedCount || 0;
  await ShipmentOrder.collection.updateMany({ supplierType: { $exists: false } }, { $set: { supplierType: '' } });

  const todo = await Workflow.collection.find({ vendorName: { $exists: false } }, { projection: { shipmentOrder: 1, carOwner: 1 } }).toArray();
  if (!todo.length) return { orders, rows };
  const soIds = todo.map((w) => w.shipmentOrder).filter(Boolean);
  const so = new Map();
  for (let i = 0; i < soIds.length; i += 5000) {
    // eslint-disable-next-line no-await-in-loop
    const list = await ShipmentOrder.find({ _id: { $in: soIds.slice(i, i + 5000) } }).select('supplierName supplierType costCenter').lean();
    for (const o of list) so.set(String(o._id), o);
  }
  const kinds = await typeByName(todo.filter((w) => !w.shipmentOrder).map((w) => w.carOwner));
  const ops = todo.map((w) => {
    const o = w.shipmentOrder && so.get(String(w.shipmentOrder));
    const set = o
      ? { ...columnsOf(o.supplierName, o.supplierType), costCenter: str(o.costCenter) }
      : columnsOf(w.carOwner, kinds.get(str(w.carOwner)));
    return { updateOne: { filter: { _id: w._id, vendorName: { $exists: false } }, update: { $set: set } } };
  });
  for (let i = 0; i < ops.length; i += 2000) {
    // eslint-disable-next-line no-await-in-loop
    const r = await Workflow.collection.bulkWrite(ops.slice(i, i + 2000), { ordered: false });
    rows += r.modifiedCount || 0;
  }
  return { orders, rows };
}

module.exports = { FREELANCER_LABEL, columnsOf, refreshSupplier, backfill };
