require('dotenv').config();
const XLSX = require('xlsx');
const path = require('path');
const FILE = path.join(__dirname, '../../../collection files/Financial Collections    9-2026.xlsx');
const fold = (s) => String(s || '').toLowerCase()
  .replace(/[أإآٱ]/g, 'ا').replace(/[ىئ]/g, 'ي').replace(/[ةه]/g, 'ه').replace(/ؤ/g, 'و')
  .replace(/[ً-ْـ]/g, '').replace(/[()\-_.,]/g, ' ').replace(/\s+/g, ' ').trim();

// أوراقُ الهويّة: الحسابُ وصاحبُه ومسؤولُه.  |  أوراقُ الحركة: فواتيرُ وشحنات.
const MASTER = [['Aging', 4, 0, 1], ['Aging Shipment', 4, 0, 1], ['JP', 6, 0, 1]];
const TXN = [['Daily Invoice Report', 5, 0, 1], ['Shipment Report', 4, 0, 2]];
const wb = XLSX.readFile(FILE);
const collect = (defs) => {
  const m = new Map();
  for (const [sheet, h, cCode, cName] of defs) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '', blankrows: false });
    for (let i = h + 1; i < rows.length; i += 1) {
      const r = rows[i]; if (!r) continue;
      const code = String(r[cCode] ?? '').trim(); const name = String(r[cName] ?? '').trim();
      if (!code || !name) continue;
      if (!m.has(code)) m.set(code, new Map());
      const k = fold(name);
      if (!m.get(code).has(k)) m.get(code).set(k, { name, sheets: new Set() });
      m.get(code).get(k).sheets.add(sheet);
    }
  }
  return m;
};
const master = collect(MASTER);
const txn = collect(TXN);
console.log(`أكوادٌ في أوراق الهويّة: ${master.size} · في أوراق الحركة: ${txn.size}`);
const clash = [...master.entries()].filter(([, m]) => m.size > 1);
console.log(`\nأكوادٌ باسمين مختلفين داخل أوراق الهويّة نفسِها: ${clash.length}`);
clash.forEach(([code, m]) => {
  console.log(`  ${code}:`);
  [...m.values()].forEach((v) => console.log(`     «${v.name}»  [${[...v.sheets].join(', ')}]`));
});
// أسماءٌ تظهر في الحركة ولا تُعرَف في الهويّة لنفس الكود
let mism = 0;
for (const [code, tm] of txn) {
  const mm = master.get(code); if (!mm) continue;
  for (const [k, v] of tm) if (!mm.has(k)) mism += 1;
}
console.log(`\nأسماءٌ في أوراق الحركة تخالف اسمَ الكود في أوراق الهويّة: ${mism}`);
console.log('(هذه أخطاءُ إدخالٍ في الورقة، لا حساباتٌ جديدة — ولا تُتَّخذ ألقابًا)');
