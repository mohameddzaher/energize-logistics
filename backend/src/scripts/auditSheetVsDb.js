/** يقرأ الشيت كما هو ويقارنه بالقاعدة — بلا كتابة. */
require('dotenv').config();
const XLSX = require('xlsx');
const path = require('path');
const FILE = path.join(__dirname, '../../../collection files/Financial Collections    9-2026.xlsx');
const wb = XLSX.readFile(FILE);
console.log('الأوراق:', wb.SheetNames.join(' | '));
for (const name of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false });
  console.log(`\n── «${name}» — ${rows.length} صفًّا`);
  rows.slice(0, 3).forEach((r, i) => console.log(`   [${i}] ${r.slice(0, 14).map((c) => String(c).slice(0, 22)).join(' | ')}`));
}
