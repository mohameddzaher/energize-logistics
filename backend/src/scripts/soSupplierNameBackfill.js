/**
 * soSupplierNameBackfill: shipment orders saved with a supplier id but no supplier name get the name, then their workflow row is mirrored so its owner column fills.
 * Shows only; --apply writes.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const ShipmentOrder = require('../models/ShipmentOrder');
  const ShipmentOrderSupplier = require('../models/ShipmentOrderSupplier');
  const rows = await ShipmentOrder.find({ supplier: { $ne: null }, $or: [{ supplierName: '' }, { supplierName: null }, { supplierName: { $exists: false } }] })
    .select('_id supplier').lean();
  const names = new Map((await ShipmentOrderSupplier.find({ _id: { $in: [...new Set(rows.map((r) => String(r.supplier)))] } }).select('name').lean())
    .map((s) => [String(s._id), s.name || '']));
  const todo = rows.filter((r) => names.get(String(r.supplier)));
  console.log(`طلبات بلا اسم مورد: ${rows.length} · يُكتب لها: ${todo.length}`);
  if (!APPLY) { console.log('(عرضٌ فقط — أضِف --apply للتنفيذ)'); process.exit(0); }
  const { mirrorOrder } = require('../services/shipmentOrderWorkflowLink');
  let mirrored = 0;
  for (const r of todo) {
    await ShipmentOrder.updateOne({ _id: r._id }, { $set: { supplierName: names.get(String(r.supplier)) } }); // eslint-disable-line no-await-in-loop
    if (await mirrorOrder(r._id).catch(() => null)) mirrored += 1; // eslint-disable-line no-await-in-loop
  }
  console.log(`Applied: ${todo.length} · workflow rows: ${mirrored}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
