require('dotenv').config();
const XLSX = require('xlsx');
const path = require('path');
const FILE = path.join(__dirname, '../../../collection files/Financial Collections    9-2026.xlsx');
const wb = XLSX.readFile(FILE);
const TARGET = '11855';

console.log('══ كلُّ خانةٍ فيها 11855 في أيّ ورقة ══');
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: true });
  for (let i = 0; i < rows.length; i += 1) {
    const hit = rows[i].some((c) => String(c).trim() === TARGET);
    if (!hit) continue;
    const filled = rows[i].map((c, j) => [j, String(c).trim()]).filter(([, v]) => v !== '');
    console.log(`\n«${name}» صفّ ${i} — ${filled.length} خانة ممتلئة:`);
    filled.forEach(([j, v]) => console.log(`    عمود ${j}: «${v}»`));
  }
}

console.log('\n\n══ الفواتير من 11845 إلى 11870 في ورقة الفواتير ══');
const inv = XLSX.utils.sheet_to_json(wb.Sheets['Daily Invoice Report'], { header: 1, defval: '', blankrows: false });
for (let i = 6; i < inv.length; i += 1) {
  const no = String(inv[i]?.[2] ?? '').trim();
  const n = Number(no);
  if (!Number.isFinite(n) || n < 11845 || n > 11870) continue;
  const code = String(inv[i][0] ?? '').trim();
  const nm = String(inv[i][1] ?? '').trim();
  const amt = inv[i][3];
  const st = String(inv[i][9] ?? '').trim();
  console.log(`  ${no.padEnd(7)} كود=${(code || '—').padEnd(10)} اسم=${(nm || '(فارغ)').slice(0, 30).padEnd(30)} مبلغ=${amt === '' ? '(فارغ)' : amt} حالة=${st || '—'}`);
}

console.log('\n══ آخرُ أرقام الفواتير في الورقة ══');
const nums = [];
for (let i = 6; i < inv.length; i += 1) {
  const n = Number(String(inv[i]?.[2] ?? '').trim());
  if (Number.isFinite(n) && n > 0) nums.push(n);
}
nums.sort((a, b) => a - b);
console.log(`  أصغر=${nums[0]} · أكبر=${nums[nums.length - 1]} · العدد=${nums.length}`);
