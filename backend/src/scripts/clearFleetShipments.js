/* eslint-disable no-console */
// Clears the trial period from Fleet Management: shipments, their events and the
// waybill counter. Drivers, seats, vehicles and customers are never written; a
// fingerprint of them is compared before and after. Nothing is deleted until the
// backup reads back complete. Dry run unless --apply.
//   node src/scripts/clearFleetShipments.js [--apply] [--backup-dir=/opt/energize/archive]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const mongoose = require('mongoose');

const { EJSON } = mongoose.mongo.BSON;
const argOf = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || dflt;

async function fingerprint(db) {
  const out = {};
  for (const name of ['fleetdrivers', 'fleetvehicles', 'fleetcustomers', 'fleetconfigs']) {
    const rows = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
    out[name] = `${rows.length}:${crypto.createHash('sha256').update(EJSON.stringify(rows)).digest('hex').slice(0, 16)}`;
  }
  return JSON.stringify(out);
}

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const { db } = mongoose.connection;
  const [shipments, events, counters] = await Promise.all(['fleetshipments', 'fleetevents', 'fleetcounters']
    .map((n) => db.collection(n).find({}).toArray()));
  const before = await fingerprint(db);
  console.log(`shipments ${shipments.length}, events ${events.length}, counter ${counters.map((c) => `${c._id}=${c.seq}`).join(' ')}`);
  console.log(`kept: ${before}`);
  if (!apply) { console.log('dry run: nothing written'); await mongoose.disconnect(); return; }

  const dir = argOf('backup-dir', '/opt/energize/archive');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `fleet-shipments-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`);
  fs.writeFileSync(file, zlib.gzipSync(EJSON.stringify({ shipments, events, counters })), { mode: 0o600 });
  const back = EJSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());
  if (back.shipments.length !== shipments.length || back.events.length !== events.length) throw new Error('backup incomplete, nothing deleted');
  console.log(`backup ${file} (${fs.statSync(file).size} bytes), read back ok`);

  const ids = shipments.map((s) => s._id);
  const delEvents = await db.collection('fleetevents').deleteMany({ shipment: { $in: ids } });
  const delShipments = await db.collection('fleetshipments').deleteMany({ _id: { $in: ids } });
  // A shipment created after the read above keeps its number: reset only on an empty list.
  const left = await db.collection('fleetshipments').countDocuments();
  if (!left) await db.collection('fleetcounters').updateOne({ _id: 'waybill' }, { $set: { seq: 100000 } }, { upsert: true });
  const after = await fingerprint(db);
  console.log(`deleted ${delShipments.deletedCount} shipments, ${delEvents.deletedCount} events; left ${left}; counter ${left ? 'unchanged' : 'reset'}`);
  console.log(after === before ? 'kept data identical' : `KEPT DATA CHANGED: ${after}`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
