require('dotenv').config();
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');
const FILE = path.join(__dirname, '../../../collection files/Financial Collections    9-2026.xlsx');
const fold = (s) => String(s || '').toLowerCase()
  .replace(/[أإآٱ]/g, 'ا').replace(/[ىئ]/g, 'ي').replace(/[ةه]/g, 'ه').replace(/ؤ/g, 'و')
  .replace(/[ً-ْـ]/g, '').replace(/[()\-_.,]/g, ' ').replace(/\s+/g, ' ').trim();
const SHEETS = [['Aging',4,0,1],['Aging Shipment',4,0,1],['Daily Invoice Report',5,0,1],['Shipment Report',4,0,2],['JP',6,0,1]];
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const wb = XLSX.readFile(FILE);
  const byCode = new Map();
  for (const [sheet, h, cCode, cName] of SHEETS) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '', blankrows: false });
    for (let i = h + 1; i < rows.length; i += 1) {
      const r = rows[i]; if (!r) continue;
      const code = String(r[cCode] ?? '').trim(); const name = String(r[cName] ?? '').trim();
      if (!code || !name) continue;
      if (!byCode.has(code)) byCode.set(code, new Map());
      const m = byCode.get(code);
      const k = fold(name);
      if (!m.has(k)) m.set(k, { name, sheets: new Set() });
      m.get(k).sheets.add(sheet);
    }
  }
  const multi = [...byCode.entries()].filter(([, m]) => m.size > 1);
  console.log(`أكوادٌ يحمل كلٌّ منها أكثرَ من اسمٍ مطويّ: ${multi.length} من ${byCode.size}\n`);
  multi.slice(0, 12).forEach(([code, m]) => {
    console.log(`  ${code}:`);
    [...m.values()].forEach((v) => console.log(`     «${v.name}»  [${[...v.sheets].join(', ')}]`));
  });

  // وأسماءٌ عندنا فيها كلماتٌ إنجليزيّةٌ محشورةٌ وسط العربيّ
  const P = require('../models/CollectionsParty');
  const all = await P.find({}).select('name code kind').lean();
  const bad = all.filter((p) => /[؀-ۿ]/.test(p.name) && /[A-Za-z]{3,}/.test(p.name));
  console.log(`\nأسماءٌ عربيّةٌ فيها كلمةٌ لاتينيّة: ${bad.length}`);
  bad.slice(0, 15).forEach((p) => console.log(`   ${(p.code || '—').padEnd(11)} ${p.kind.padEnd(9)} ${p.name}`));
  await mongoose.disconnect();
})();
