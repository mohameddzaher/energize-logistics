require('dotenv').config();
const XLSX = require('xlsx');
const path = require('path');
const FILE = path.join(__dirname, '../../../collection files/Financial Collections    9-2026.xlsx');
const wb = XLSX.readFile(FILE);
for (const name of ['Aging', 'Daily Invoice Report']) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false });
  console.log(`\n══ «${name}» ══`);
  // صفُّ الترويسة: أكثرُ صفٍّ في أوّل ١٥ سطرًا يحمل خاناتٍ نصّيّةً غيرَ فارغة
  let best = -1, bestN = 0;
  for (let i = 0; i < Math.min(15, rows.length); i += 1) {
    const n = rows[i].filter((c) => typeof c === 'string' && c.trim().length > 1).length;
    if (n > bestN) { bestN = n; best = i; }
  }
  console.log(`صفُّ الترويسة المرجَّح: ${best} (${bestN} عمودًا)`);
  rows[best].forEach((c, j) => { if (String(c).trim()) console.log(`   [${j}] ${c}`); });
  console.log('   ── مثالان من البيانات:');
  for (const k of [best + 1, best + 2]) {
    if (!rows[k]) continue;
    console.log('   ' + rows[k].slice(0, 20).map((c) => String(c).slice(0, 18)).join(' | '));
  }
}
