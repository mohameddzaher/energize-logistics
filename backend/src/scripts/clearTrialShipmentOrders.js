/* eslint-disable no-console */
// Removes the trial shipments created before the system took over from the
// platform (`source: 'system'` without a manifest number) and moves the counter
// onto the manifest series. Nothing is deleted until the backup reads back
// complete. Dry run unless --apply.
//   node src/scripts/clearTrialShipmentOrders.js [--apply] [--backup-dir=/opt/energize/archive]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const mongoose = require('mongoose');

const { EJSON } = mongoose.mongo.BSON;
const argOf = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || dflt;

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const { db } = mongoose.connection;
  const orders = db.collection('shipmentorders');
  const counters = db.collection('shipmentordercounters');
  const trial = await orders.find({ source: 'system', graduationNumber: null }).toArray();
  const [top] = await orders.find({ source: 'platform', graduationNumber: { $ne: null } }).sort({ graduationNumber: -1 }).limit(1).toArray();
  const counter = await counters.findOne({ _id: 'waybill' });
  console.log(`trial orders ${trial.length}: ${trial.map((o) => o.waybillNumber).join(' ')}`);
  console.log(`counter ${counter?.seq} -> ${top.graduationNumber}, next ${top.graduationNumber + 1}`);
  if (!apply) { console.log('dry run: nothing written'); await mongoose.disconnect(); return; }

  const dir = argOf('backup-dir', '/opt/energize/archive');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `trial-shipment-orders-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`);
  fs.writeFileSync(file, zlib.gzipSync(EJSON.stringify({ trial, counter })), { mode: 0o600 });
  const back = EJSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());
  if (back.trial.length !== trial.length) throw new Error('backup incomplete, nothing deleted');
  console.log(`backup ${file}, read back ok`);

  const del = await orders.deleteMany({ _id: { $in: trial.map((o) => o._id) } });
  await counters.updateOne({ _id: 'waybill' }, { $max: { seq: top.graduationNumber } }, { upsert: true });
  console.log(`deleted ${del.deletedCount}; counter ${(await counters.findOne({ _id: 'waybill' })).seq}`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
