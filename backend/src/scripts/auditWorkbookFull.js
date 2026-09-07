/** يقرأ كلَّ ورقةٍ وكلَّ عمود، ويبحث عن عميلين بعينهما. لا يكتب شيئًا. */
require('dotenv').config();
const XLSX = require('xlsx');
const path = require('path');
const FILE = path.join(__dirname, '../../../collection files/Financial Collections    9-2026.xlsx');
const wb = XLSX.readFile(FILE);

const headerRowOf = (rows) => {
  let best = -1, n = 0;
  for (let i = 0; i < Math.min(12, rows.length); i += 1) {
    const c = rows[i].filter((x) => typeof x === 'string' && x.trim().length > 1).length;
    if (c > n) { n = c; best = i; }
  }
  return best;
};

for (const name of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false });
  const h = headerRowOf(rows);
  const cols = rows[h].map((c, j) => `[${j}] ${String(c).trim()}`).filter((x) => x.replace(/^\[\d+\]\s*/, ''));
  console.log(`\n══ «${name}» — ${rows.length} صفًّا · ترويسة ${h} · ${cols.length} عمودًا`);
  console.log('   ' + cols.join('  |  '));
}

console.log('\n\n══ البحثُ عن العميلين في كلّ الأوراق ══');
const TARGETS = ['كومباسيون', 'عابر الحديثة', 'عابر الحديثه'];
const fold = (s) => String(s || '').replace(/[أإآٱ]/g, 'ا').replace(/[ىئ]/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
for (const name of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false });
  const h = headerRowOf(rows);
  for (let i = 0; i < rows.length; i += 1) {
    const line = rows[i].map((c) => String(c));
    const joined = fold(line.join(' | '));
    if (TARGETS.some((t) => joined.includes(fold(t)))) {
      console.log(`\n«${name}» صفّ ${i}:`);
      rows[h].forEach((hdr, j) => {
        const v = String(rows[i][j] ?? '').trim();
        if (v && String(hdr).trim()) console.log(`     ${String(hdr).trim()}: ${v}`);
      });
    }
  }
}
