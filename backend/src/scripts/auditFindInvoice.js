require('dotenv').config();
const XLSX = require('xlsx');
const path = require('path');
const FILE = path.join(__dirname, '../../../collection files/Financial Collections    9-2026.xlsx');
const wb = XLSX.readFile(FILE);
const TARGETS = ['11855', '11849', '11854'];
for (const name of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false });
  for (let i = 0; i < rows.length; i += 1) {
    const line = rows[i].map((c) => String(c).trim());
    for (const t of TARGETS) {
      if (line.includes(t)) {
        const filled = line.filter((c) => c !== '').length;
        console.log(`«${name}» صفّ ${i} يحوي ${t} — ${filled} خانة ممتلئة`);
        console.log(`   ${line.slice(0, 14).map((c) => c.slice(0, 20) || '·').join(' | ')}`);
      }
    }
  }
}

// كم صفًّا في ورقة الفواتير له رقمٌ بلا اسمِ حساب؟
const inv = XLSX.utils.sheet_to_json(wb.Sheets['Daily Invoice Report'], { header: 1, defval: '', blankrows: false });
let withNo = 0, noName = 0, noNameButDated = 0;
for (let i = 6; i < inv.length; i += 1) {
  const r = inv[i]; if (!r) continue;
  const no = String(r[2] ?? '').trim();
  if (!no) continue;
  withNo += 1;
  const nm = String(r[1] ?? '').trim();
  if (!nm) {
    noName += 1;
    if (String(r[6] ?? '').trim() || String(r[8] ?? '').trim() || String(r[9] ?? '').trim()) noNameButDated += 1;
  }
}
console.log(`\nصفوفٌ برقم فاتورة: ${withNo}`);
console.log(`   منها بلا اسمِ حساب: ${noName}`);
console.log(`   ومنها بلا اسمٍ ولكن لها تاريخُ تسليمٍ أو تحصيلٍ أو حالة: ${noNameButDated}`);
