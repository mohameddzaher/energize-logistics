/**
 * syncOfficersFromSheet — الورقةُ هي المرجع في مَن يتولّى أيَّ حساب.
 *
 *   node src/scripts/syncOfficersFromSheet.js          تجربة
 *   node src/scripts/syncOfficersFromSheet.js --yes    تنفيذ
 *
 * تُقرأ ورقتا «Aging» و«Aging Shipment» — لكلٍّ منهما عمودُ Collection Officer —
 * ويُطابَق الحسابُ بكوده. ولا يُكتب إلّا ما اختلف.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');

const YES = process.argv.includes('--yes');
const FILE = path.join(__dirname, '../../../collection files/Financial Collections    9-2026.xlsx');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const CollectionsParty = require('../models/CollectionsParty');
  const wb = XLSX.readFile(FILE);

  // كودُ الحساب ← المسؤول، من الورقتين. والثانيةُ تُكتب فوق الأولى عند التكرار
  // لأنّها أخصُّ (حسابات الشحنات).
  const want = new Map();
  for (const [sheet, headerRow] of [['Aging', 4], ['Aging Shipment', 4]]) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '', blankrows: false });
    const H = rows[headerRow].map((h) => String(h).trim());
    const iCode = H.indexOf('Code'), iName = H.indexOf('Account name'), iOff = H.indexOf('Collection Officer');
    let n = 0;
    for (let i = headerRow + 1; i < rows.length; i += 1) {
      const r = rows[i]; if (!r) continue;
      const code = String(r[iCode] ?? '').trim();
      const off = String(r[iOff] ?? '').trim();
      if (!code || !off) continue;
      want.set(code, { officer: off, name: String(r[iName] ?? '').trim(), sheet });
      n += 1;
    }
    console.log(`«${sheet}»: ${n} صفًّا له كودٌ ومسؤول`);
  }
  console.log(`أكوادٌ فريدة: ${want.size}\n`);

  const parties = await CollectionsParty.find({ kind: 'customer', code: { $gt: '' } })
    .select('code name collectionOfficer').lean();
  const byCode = new Map(parties.map((p) => [String(p.code).trim(), p]));

  const changes = [];
  let same = 0, absent = 0;
  for (const [code, v] of want) {
    const p = byCode.get(code);
    if (!p) { absent += 1; continue; }
    const cur = String(p.collectionOfficer || '').trim();
    if (cur === v.officer) { same += 1; continue; }
    changes.push({ id: p._id, code, name: p.name, from: cur || '(فارغ)', to: v.officer, sheet: v.sheet });
  }
  console.log(`متطابق: ${same} · مختلف: ${changes.length} · بلا سجلٍّ عندنا: ${absent}\n`);
  changes.forEach((c) => console.log(`  ${c.code} ${String(c.name).slice(0, 30).padEnd(30)} ${c.from.padEnd(10)} → ${c.to.padEnd(10)} [${c.sheet}]`));

  if (!YES) { console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }
  for (const c of changes) await CollectionsParty.updateOne({ _id: c.id }, { $set: { collectionOfficer: c.to } });
  try { require('../controllers/collectionsLedgerController').invalidate(); } catch (_) {}
  console.log(`\n✓ حُدِّث ${changes.length} حسابًا`);
  await mongoose.disconnect();
})();
