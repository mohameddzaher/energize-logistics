/* eslint-disable no-console */
// استيراد جرد مخزن النقل الثقيل (heavy_transport_warehouse.json) — يمسح ويُدخل.
//   node src/scripts/importLs2Store.js
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const { Ls2StoreItem } = require('../models/Ls2Store');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('No MONGODB_URI');
  await mongoose.connect(uri);
  const raw = require(path.join(__dirname, '..', 'data', 'masters', 'heavy_transport_warehouse.json'));
  const rows = Array.isArray(raw) ? raw : (raw.items || raw.records || raw.rows || []);
  console.log(`Loaded ${rows.length} rows`);

  const docs = rows.filter((r) => r.name_ar).map((r) => ({
    code: r.item_code || '',
    name: r.name_ar,
    category: r.inferred_category || '',
    groupAr: r.group_ar || 'قطع غيار',
    quantity: Number(r.quantity) || 0,
    unit: (r.unit && r.unit.ar) || 'قطعة',
    unitPrice: Number(r.unit_cost_rounded_sar ?? r.unit_cost_sar) || 0,
    compatibleModels: Array.isArray(r.compatible_models) ? r.compatible_models : [],
    minQuantity: 0,
    isActive: true,
  }));

  const del = await Ls2StoreItem.deleteMany({});
  console.log(`Cleared ${del.deletedCount} existing store items`);
  const ins = await Ls2StoreItem.insertMany(docs, { ordered: false });
  console.log(`Inserted ${ins.length} items`);
  const totalValue = docs.reduce((s, d) => s + d.quantity * d.unitPrice, 0);
  const totalUnits = docs.reduce((s, d) => s + d.quantity, 0);
  console.log(`Total units: ${totalUnits} | total value: ${Math.round(totalValue)} SAR`);
  await mongoose.disconnect();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
