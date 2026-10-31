/* eslint-disable no-console */
// Makes the customers page the owner's approved list. A missing approved name takes
// over the old row its alias points at, keeping routes, prices and contacts, or
// gets a new row. Platform accounts not on the list are hidden, never deleted, so
// their shipments keep reading. Rows people added stay. Dry run unless --apply.
//   node src/scripts/applyApprovedCustomers.js [--apply] [--backup-dir=/opt/energize/archive]
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const mongoose = require('mongoose');
const approved = require('../config/approvedCustomers');
const { fold } = require('../models/CollectionsParty');

const { EJSON } = mongoose.mongo.BSON;
const argOf = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || dflt;

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const { db } = mongoose.connection;
  const col = db.collection('shipmentordercustomers');
  const rows = await col.find({}).toArray();
  const parties = await db.collection('collectionsparties').find({ kind: 'customer' }).project({ name: 1, nameKey: 1, aliasKeys: 1, code: 1, phone: 1 }).toArray();
  const wanted = new Map(approved.map((n) => [fold(n), String(n).trim()]));

  const byKey = new Map();
  rows.forEach((r) => { const k = fold(r.name); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); });
  const partyOf = (k) => parties.find((p) => (p.nameKey || fold(p.name)) === k || (p.aliasKeys || []).includes(k));

  const plan = { keep: 0, spelling: [], takeover: [], create: [], hide: [] };
  const used = new Set();
  for (const [k, name] of wanted) {
    const same = byKey.get(k) || [];
    if (same.length) {
      const best = same.sort((a, b) => (b.routes?.length || 0) - (a.routes?.length || 0))[0];
      used.add(String(best._id));
      if (best.name !== name) plan.spelling.push({ row: best, name }); else plan.keep += 1;
      continue;
    }
    const p = partyOf(k);
    const olds = p ? [p.nameKey || fold(p.name), ...(p.aliasKeys || [])].flatMap((a) => (wanted.has(a) ? [] : byKey.get(a) || [])) : [];
    const free = olds.filter((r) => !used.has(String(r._id))).sort((a, b) => (b.routes?.length || 0) - (a.routes?.length || 0));
    if (free[0]) { used.add(String(free[0]._id)); plan.takeover.push({ row: free[0], name }); } else plan.create.push({ name, code: p?.code || '', phone: p?.phone || '' });
  }
  for (const r of rows) {
    if (used.has(String(r._id)) || r.isActive === false) continue;
    if (wanted.has(fold(r.name))) { plan.hide.push(r); continue; }
    const manual = !r.externalId || r.nameManual;
    if (!manual) plan.hide.push(r);
  }
  console.log({ approved: wanted.size, keep: plan.keep, spelling: plan.spelling.length, takeover: plan.takeover.length, create: plan.create.length, hide: plan.hide.length });
  console.log('takeover sample', plan.takeover.slice(0, 12).map((t) => `${t.row.name} -> ${t.name}`));
  console.log('hide with routes', plan.hide.filter((r) => r.routes?.length).length);
  if (!apply) { console.log('dry run: nothing written'); await mongoose.disconnect(); return; }

  const dir = argOf('backup-dir', '/opt/energize/archive');
  const file = path.join(dir, `customers-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`);
  fs.writeFileSync(file, zlib.gzipSync(EJSON.stringify(rows)), { mode: 0o600 });
  if (EJSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString()).length !== rows.length) throw new Error('backup incomplete, nothing changed');
  console.log(`backup ${file}`);

  const now = new Date();
  for (const { row, name } of [...plan.spelling, ...plan.takeover]) {
    await col.updateOne({ _id: row._id }, { $set: { name, isActive: true, nameManual: true, updatedAt: now } });
  }
  if (plan.create.length) {
    await col.insertMany(plan.create.map((c) => ({
      name: c.name, phone: c.phone, customerCode: c.code, routes: [], defaults: {}, isActive: true, nameManual: true, externalId: '', createdAt: now, updatedAt: now,
    })));
  }
  await col.updateMany({ _id: { $in: plan.hide.map((r) => r._id) } }, { $set: { isActive: false, hiddenReason: 'not_on_approved_list', updatedAt: now } });
  console.log(`active now ${await col.countDocuments({ isActive: { $ne: false } })}, total ${await col.countDocuments()}`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
