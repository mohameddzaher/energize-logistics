/**
 * The people behind a load, read from its shipment: the sales rep who brought it, the operations person who sourced
 * the truck and the colleague who helped. Workflow rows and the loads board carry only the link
 * (`shipmentOrder`), so the names are attached at read time and always match the shipment.
 */
const ShipmentOrder = require('../models/ShipmentOrder');

async function attachShipmentPeople(rows) {
  const ids = [...new Set((rows || []).map((r) => r && r.shipmentOrder).filter(Boolean).map(String))];
  if (!ids.length) return rows;
  const orders = await ShipmentOrder.find({ _id: { $in: ids } })
    .select('salesRepName sourcingRepName sourcingHelperName requestNumber').lean();
  const byId = new Map(orders.map((o) => [String(o._id), o]));
  for (const r of rows) {
    const o = r && r.shipmentOrder ? byId.get(String(r.shipmentOrder)) : null;
    if (!o) continue;
    r.salesRepName = o.salesRepName || '';
    r.sourcingRepName = o.sourcingRepName || '';
    r.sourcingHelperName = o.sourcingHelperName || '';
    if (o.requestNumber) r.requestNumber = o.requestNumber;
  }
  return rows;
}

module.exports = { attachShipmentPeople };
