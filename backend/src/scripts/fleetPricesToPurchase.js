/**
 * Fleet loads' workflow rows under the rule «إيجار السيارة» = purchase, «الإيجار كامل» = selling:
 * purchaseValue = price; sellingValue = fullRent when written, else cleared only when it is the vehicle rent the fleet wrote there
 * (a selling price someone typed stays). Linked shipment orders get buyPrice/sellPrice the same way.
 * Dry run by default; --apply writes a JSON backup first.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const { FleetShipment } = require('../models/FleetModels');
  const OW = require('../models/OperationsWorkflow');
  const ShipmentOrder = require('../models/ShipmentOrder');
  const num = (v) => Number(v) || 0;
  const loads = await FleetShipment.find({}).select('price fullRent shipmentOrder customerType waybillNumber').lean();
  const byId = new Map(loads.map((l) => [String(l._id), l]));
  const rows = await OW.find({ fleetShipment: { $in: loads.map((l) => l._id) } }).select('fleetShipment purchaseValue sellingValue reportNumber').lean();
  const rowOps = []; const before = [];
  const tally = { rows: rows.length, purchaseSet: 0, sellingToFull: 0, sellingCleared: 0, sellingKept: 0 };
  for (const w of rows) {
    const l = byId.get(String(w.fleetShipment));
    if (!l) continue;
    const set = {};
    if (num(w.purchaseValue) !== num(l.price)) { set.purchaseValue = num(l.price); tally.purchaseSet += 1; }
    if (num(l.fullRent) > 0) {
      if (num(w.sellingValue) !== num(l.fullRent)) { set.sellingValue = num(l.fullRent); tally.sellingToFull += 1; }
    } else if (num(w.sellingValue) > 0 && num(w.sellingValue) === num(l.price)) { set.sellingValue = 0; tally.sellingCleared += 1; }
    else if (num(w.sellingValue) > 0) tally.sellingKept += 1;
    if (Object.keys(set).length) { before.push(w); rowOps.push({ updateOne: { filter: { _id: w._id }, update: { $set: set } } }); }
  }
  const orderOps = []; const ordersBefore = [];
  for (const l of loads.filter((x) => x.shipmentOrder)) {
    const o = await ShipmentOrder.findById(l.shipmentOrder).select('buyPrice sellPrice').lean();
    if (!o) continue;
    const set = {};
    if (num(l.price) > 0 && num(o.buyPrice) !== num(l.price)) set.buyPrice = num(l.price);
    if (num(l.fullRent) > 0 && num(o.sellPrice) !== num(l.fullRent)) set.sellPrice = num(l.fullRent);
    if (Object.keys(set).length) { ordersBefore.push(o); orderOps.push({ updateOne: { filter: { _id: o._id }, update: { $set: set } } }); }
  }
  console.log(JSON.stringify({ ...tally, rowsChanged: rowOps.length, ordersChanged: orderOps.length }));
  if (!apply) { console.log('dry run'); process.exit(0); }
  const dir = fs.existsSync('/opt/energize/backups') ? '/opt/energize/backups' : path.join(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `fleet-prices-to-purchase-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ rows: before, orders: ordersBefore }));
  if (rowOps.length) await OW.bulkWrite(rowOps, { ordered: false });
  if (orderOps.length) await ShipmentOrder.bulkWrite(orderOps, { ordered: false });
  try { require('../utils/ttlCache').clear(''); } catch (_) { /* */ }
  console.log('applied; backup', file);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
