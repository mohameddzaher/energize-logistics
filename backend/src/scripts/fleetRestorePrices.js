/**
 * Restores «إيجار السيارة» on fleet loads that an empty workflow purchase price zeroed, from a list of [waybillNumber, price]
 * (taken from the nightly backup), then re-mirrors each load to its workflow row. Only loads whose price is still 0 are touched.
 * Usage: node src/scripts/fleetRestorePrices.js '<json>' [--apply]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
(async () => {
  const list = JSON.parse(process.argv[2] || '[]');
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  require('../models/VehicleMaster');
  const { FleetShipment } = require('../models/FleetModels');
  const OW = require('../models/OperationsWorkflow');
  const link = require('../services/shipmentOrderWorkflowLink');
  const rows = [];
  for (const [wb, price] of list) {
    const l = await FleetShipment.findOne({ waybillNumber: Number(wb) }).select('price fullRent').lean();
    if (!l || Number(l.price) !== 0) { console.log(wb, 'skip', l ? l.price : 'missing'); continue; }
    rows.push({ l, price: Number(price) });
  }
  console.log(`to restore ${rows.length}:`, rows.map((r) => r.price).join(', '));
  if (!apply) { console.log('dry run'); process.exit(0); }
  const dir = '/opt/energize/backups'; const file = path.join(fs.existsSync(dir) ? dir : process.cwd(), `fleet-restore-prices-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ loads: rows.map((r) => r.l), rows: await OW.find({ fleetShipment: { $in: rows.map((r) => r.l._id) } }).lean() }));
  for (const { l, price } of rows) {
    await FleetShipment.updateOne({ _id: l._id }, { $set: { price } });
    await link.mirrorFleet(l._id);
    // Same rule as the rest: with no full rent the selling price is left to sales, so a selling equal to the vehicle rent is cleared.
    if (!(Number(l.fullRent) > 0)) await OW.updateOne({ fleetShipment: l._id, sellingValue: price }, { $set: { sellingValue: 0 } });
  }
  try { require('../utils/ttlCache').clear('fleet:'); } catch (_) { /* */ }
  console.log('applied; backup', file);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
