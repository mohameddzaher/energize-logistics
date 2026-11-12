/**
 * Restore fleet «إيجار السيارة» (price) wiped on 2026-11-10, when the workflow purchase (still 0) was read back into
 * the fleet. Input: a JSON map { loadId: { price } } built from the 2026-11-09/10 03:00 backups.
 * Only loads whose price is still 0 are touched; their linked workflow row gets purchaseValue = price when it has none.
 * Selling prices are not changed. Dry run by default; --apply writes a JSON backup first.
 * Usage: node src/scripts/fleetRestoreWipedPrices.js <map.json> [--apply]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

(async () => {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const apply = process.argv.includes('--apply');
  if (!file) throw new Error('map file required');
  const map = JSON.parse(fs.readFileSync(file, 'utf8'));
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const { FleetShipment } = require('../models/FleetModels');
  const OperationsWorkflow = require('../models/OperationsWorkflow');

  const ids = Object.keys(map).filter((id) => mongoose.isValidObjectId(id));
  const loads = await FleetShipment.find({ _id: { $in: ids }, $or: [{ price: { $lte: 0 } }, { price: null }] })
    .select('price fullRent waybillNumber customerType status').lean();
  const rows = await OperationsWorkflow.find({ fleetShipment: { $in: loads.map((l) => l._id) } })
    .select('fleetShipment purchaseValue sellingValue reportNumber').lean();
  const rowOf = new Map(rows.map((r) => [String(r.fleetShipment), r]));
  const zeroNow = await FleetShipment.countDocuments({ status: { $ne: 'cancelled' }, $or: [{ price: { $lte: 0 } }, { price: null }] });

  const plan = loads.map((l) => {
    const r = rowOf.get(String(l._id));
    return { id: l._id, waybill: l.waybillNumber, price: Number(map[String(l._id)].price), row: r ? r._id : null, rowBuy: r ? Number(r.purchaseValue) || 0 : null, rowSell: r ? Number(r.sellingValue) || 0 : null };
  });
  const sum = plan.reduce((a, p) => a + p.price, 0);
  console.log(JSON.stringify({
    loadsWithoutRentNow: zeroNow, restorable: plan.length, restoredTotal: sum,
    workflowRowsToFill: plan.filter((p) => p.row && !(p.rowBuy > 0)).length,
    notRestorable: zeroNow - plan.filter((p) => true).length,
  }, null, 1));
  for (const p of plan.slice(0, 8)) console.log(`  ${p.waybill}  rent ${p.price}  workflow buy ${p.rowBuy} sell ${p.rowSell}`);
  if (!apply) { console.log('Dry run (pass --apply to write).'); process.exit(0); }

  const dir = fs.existsSync('/opt/energize/backups') ? '/opt/energize/backups' : path.join(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const bk = path.join(dir, `fleet-wiped-prices-before-restore-${Date.now()}.json`);
  fs.writeFileSync(bk, JSON.stringify({ loads, rows }));

  let nLoads = 0; let nRows = 0;
  for (const p of plan) {
    // Re-checks the zero so a rent typed meanwhile is never overwritten.
    const r = await FleetShipment.updateOne({ _id: p.id, $or: [{ price: { $lte: 0 } }, { price: null }] }, { $set: { price: p.price } });
    nLoads += r.modifiedCount;
    if (p.row && !(p.rowBuy > 0)) {
      const w = await OperationsWorkflow.updateOne({ _id: p.row, $or: [{ purchaseValue: { $lte: 0 } }, { purchaseValue: null }] }, { $set: { purchaseValue: p.price } });
      nRows += w.modifiedCount;
    }
  }
  try { require('../utils/ttlCache').clear('fleet:'); } catch (e) { /* the TTL is enough */ }
  console.log(`Restored ${nLoads} loads, filled ${nRows} workflow purchases · backup: ${bk}`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
