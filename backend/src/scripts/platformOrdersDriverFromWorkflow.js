/**
 * Platform shipments whose driver name is a bare number (an import read the wrong field) take the driver name and phone from their workflow row.
 * Dry run by default; --apply writes a JSON backup first.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const orders = await db.collection('shipmentorders').find({ source: 'platform', driverName: { $regex: /^\s*[0-9٠-٩]*\s*$/ } }).project({ externalId: 1, driverName: 1, driverPhone: 1, graduationNumber: 1 }).toArray();
  const ops = []; const backup = [];
  for (const o of orders) {
    if (!o.externalId) continue;
    const w = await db.collection('operationsworkflows').findOne({ externalSource: 'ops_upl', externalId: String(o.externalId) }, { projection: { driverName: 1, driverPhone: 1 } });
    const name = String((w && w.driverName) || '').trim();
    if (!name || /^[0-9٠-٩]+$/.test(name)) continue;
    const set = { driverName: name };
    if (w.driverPhone && !String(o.driverPhone || '').trim()) set.driverPhone = String(w.driverPhone).trim();
    backup.push(o); ops.push({ updateOne: { filter: { _id: o._id }, update: { $set: set } } });
  }
  console.log(`numeric/empty driver names: ${orders.length} · fixable from workflow: ${ops.length}`);
  if (!apply) { console.log('dry run'); process.exit(0); }
  const dir = fs.existsSync('/opt/energize/backups') ? '/opt/energize/backups' : path.join(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `platform-orders-driver-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(backup));
  if (ops.length) await db.collection('shipmentorders').bulkWrite(ops, { ordered: false });
  try { require('../utils/ttlCache').clear('so:'); } catch (_) { /* */ }
  console.log('applied; backup', file);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
