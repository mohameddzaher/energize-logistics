require('dotenv').config();
const XLSX = require('xlsx');
const path = require('path');
const FILE = path.join(__dirname, '../../../collection files/Financial Collections    9-2026.xlsx');
const wb = XLSX.readFile(FILE);
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Daily Invoice Report'], { header: 1, defval: '', blankrows: false });
console.log('إجمالي الصفوف:', rows.length);
console.log('\n── الصفوف حول 8990 (خام، أوّل ١٤ عمودًا) ──');
for (let i = 8984; i <= 9000 && i < rows.length; i += 1) {
  console.log(`[${i}] ${rows[i].slice(0, 14).map((c) => String(c).slice(0, 20)).join(' | ')}`);
}
console.log('\n── آخر ٥ صفوف ──');
for (let i = Math.max(0, rows.length - 5); i < rows.length; i += 1) {
  console.log(`[${i}] ${rows[i].slice(0, 14).map((c) => String(c).slice(0, 20)).join(' | ')}`);
}
