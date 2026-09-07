require('dotenv').config();
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');
const FILE = path.join(__dirname, '../../../collection files/Financial Collections    9-2026.xlsx');
const wb = XLSX.readFile(FILE);

for (const name of ['Shipment Report', 'Aging Shipment']) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false });
  let best = -1, bestN = 0;
  for (let i = 0; i < Math.min(12, rows.length); i += 1) {
    const n = rows[i].filter((c) => typeof c === 'string' && c.trim().length > 1).length;
    if (n > bestN) { bestN = n; best = i; }
  }
  console.log(`\n══ «${name}» — ${rows.length} صفًّا · ترويسة في ${best}`);
  rows[best].forEach((c, j) => { if (String(c).trim()) console.log(`   [${j}] ${c}`); });
  console.log('   مثالان:');
  for (const k of [best + 1, best + 2]) if (rows[k]) console.log('   ' + rows[k].slice(0, 16).map((c) => String(c).slice(0, 16) || '·').join(' | '));
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const CollectionsParty = require('../models/CollectionsParty');
  const all = await CollectionsParty.countDocuments({ kind: 'customer' });
  const withCode = await CollectionsParty.countDocuments({ kind: 'customer', code: { $gt: '' } });
  const withOff = await CollectionsParty.countDocuments({ kind: 'customer', collectionOfficer: { $gt: '' } });
  const withBoth = await CollectionsParty.countDocuments({ kind: 'customer', code: { $gt: '' }, collectionOfficer: { $gt: '' } });
  console.log(`\n══ العملاء عندنا: ${all} · لهم كود: ${withCode} · لهم مسؤول: ${withOff} · الاثنان: ${withBoth}`);
  const byOff = await CollectionsParty.aggregate([
    { $match: { kind: 'customer' } },
    { $group: { _id: { $ifNull: ['$collectionOfficer', ''] }, n: { $sum: 1 }, withCode: { $sum: { $cond: [{ $gt: ['$code', ''] }, 1, 0] } } } },
    { $sort: { n: -1 } },
  ]);
  byOff.forEach((r) => console.log(`   «${r._id || '(بلا مسؤول)'}» → ${r.n} (منهم ${r.withCode} لهم كود)`));
  await mongoose.disconnect();
})();
