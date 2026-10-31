/* eslint-disable no-console */
// Read-only: finds duplicated tires. Writes nothing.
//   node src/scripts/auditLs2TireDuplicates.js [plate digits]
require('dotenv').config();
const mongoose = require('mongoose');
const Ls2TireAsset = require('../models/Ls2TireAsset');
const Ls2AssetEvent = require('../models/Ls2AssetEvent');

const norm = (s) => String(s || '').toUpperCase().replace(/[\s\-_.]/g, '');
const line = (t) => `${t.serial} | #${t.tireNumber || '-'} | ${t.status} | ${t.plate || '-'} pos ${t.positionNumber ?? '-'} ${t.section || ''} | trailer ${t.trailerNumber || '-'} | ${new Date(t.createdAt).toISOString().slice(0, 10)} | notes: ${t.notes || ''}`;
const groupBy = (rows, key) => {
  const m = new Map();
  for (const r of rows) { const k = key(r); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return [...m.entries()].filter(([, v]) => v.length > 1);
};
const report = (title, groups) => {
  console.log(`\n== ${title}: ${groups.length}`);
  for (const [k, v] of groups) { console.log(`  ${k}`); v.forEach((t) => console.log(`    ${line(t)}`)); }
};

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const digits = String(process.argv[2] || '').replace(/\D/g, '');
  const rows = await Ls2TireAsset.find({}).select('serial tireNumber status plate plateKey positionNumber section trailerNumber notes createdAt').lean();
  console.log(`tires: ${rows.length}`);

  const literal = rows.filter((t) => /dup/i.test(`${t.serial} ${t.tireNumber} ${t.notes} ${t.type} ${t.size}`));
  console.log(`\n== text containing "dup": ${literal.length}`);
  literal.forEach((t) => console.log(`  ${line(t)}`));

  report('same serial after normalising', groupBy(rows, (t) => norm(t.serial)));
  const mounted = rows.filter((t) => t.status === 'mounted' && t.plateKey && t.positionNumber != null);
  report('two mounted tires in one slot', groupBy(mounted, (t) => `${t.plateKey}#${t.positionNumber}`));

  if (digits) {
    const mine = rows.filter((t) => String(t.plateKey || '').includes(digits) || String(t.plate || '').includes(digits));
    console.log(`\n== on ${digits}: ${mine.length}`);
    mine.sort((a, b) => (a.positionNumber ?? 99) - (b.positionNumber ?? 99)).forEach((t) => console.log(`  ${line(t)}`));
    report('same tire number on this truck', groupBy(mine, (t) => norm(t.tireNumber)));
    const ev = await Ls2AssetEvent.find({ entityType: 'tire', refId: { $in: mine.map((t) => t._id) } }).sort({ createdAt: -1 }).limit(40).lean();
    console.log(`\n== last events: ${ev.length}`);
    ev.forEach((e) => console.log(`  ${new Date(e.createdAt).toISOString().slice(0, 16)} ${e.action} ${e.label} ${e.fromPlate || '-'} -> ${e.toPlate || '-'} ${e.toPosition || ''} | ${e.byName || e.userName || ''} | ${e.notes || ''}`));
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
