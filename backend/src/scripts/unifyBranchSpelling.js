/* eslint-disable no-console */
// One spelling for every branch: the variant spelling of Jeddah is unified to the standard one, and stray spaces are removed. Row ids are saved first so the change can be undone. Dry run unless --apply.
// Usage: node src/scripts/unifyBranchSpelling.js [--apply] [--backup-dir=/opt/energize/archive]
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const mongoose = require('mongoose');

const { EJSON } = mongoose.mongo.BSON;
const argOf = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || dflt;
const TARGETS = [
  ['operationsworkflows', 'branch'], ['operationsworkflows', 'payingBranch'], ['operationsworkflows', 'finalReportDestination'],
  ['shipmentorders', 'branch'], ['shipmentordercustomers', 'defaults.branch'],
];

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const { db } = mongoose.connection;
  const plan = [];
  for (const [col, field] of TARGETS) {
    const groups = await db.collection(col).aggregate([{ $group: { _id: `$${field}`, n: { $sum: 1 } } }]).toArray();
    for (const { _id: value, n } of groups) {
      if (typeof value !== 'string' || !value) continue;
      const trimmed = value.trim();
      const next = trimmed === 'جده' ? 'جدة' : trimmed;
      if (next !== value) plan.push({ col, field, from: value, to: next, n });
    }
  }
  plan.forEach((p) => console.log(`${p.col}.${p.field}: «${p.from}» -> «${p.to}» (${p.n})`));
  if (!apply) { console.log('dry run: nothing written'); await mongoose.disconnect(); return; }

  const saved = [];
  for (const p of plan) saved.push({ ...p, ids: (await db.collection(p.col).find({ [p.field]: p.from }).project({ _id: 1 }).toArray()).map((r) => r._id) });
  const users = await db.collection('users').find({ shipmentBranches: 'جده' }).project({ shipmentBranches: 1 }).toArray();
  const lookups = await db.collection('lookups').find({ nameAr: 'جده' }).project({ type: 1, nameAr: 1 }).toArray();
  const file = path.join(argOf('backup-dir', '/opt/energize/archive'), `branch-spelling-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`);
  fs.writeFileSync(file, zlib.gzipSync(EJSON.stringify({ saved, users, lookups })), { mode: 0o600 });
  console.log(`backup ${file}`);

  await db.collection('lookups').updateMany({ nameAr: 'جده' }, { $set: { nameAr: 'جدة' } });
  for (const u of users) await db.collection('users').updateOne({ _id: u._id }, { $set: { shipmentBranches: u.shipmentBranches.map((b) => (b === 'جده' ? 'جدة' : b)) } });
  for (const p of plan) {
    const r = await db.collection(p.col).updateMany({ [p.field]: p.from }, { $set: { [p.field]: p.to } });
    console.log(`${p.col}.${p.field} «${p.from}»: ${r.modifiedCount}`);
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
