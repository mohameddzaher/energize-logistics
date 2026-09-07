require('dotenv').config();
const XLSX = require('xlsx');
const path = require('path');
const FILE = path.join(__dirname, '../../../collection files/Financial Collections    9-2026.xlsx');
const wb = XLSX.readFile(FILE);
const CODES = ['11040147', '11040170', '11040407', '11040413'];
for (const [sheet, h, cCode, cName, cOut, cOff] of [['Aging', 4, 0, 1, 10, 2], ['Aging Shipment', 4, 0, 1, 9, 2], ['JP', 6, 0, 1, null, 3]]) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '', blankrows: false });
  for (let i = h + 1; i < rows.length; i += 1) {
    const r = rows[i]; if (!r) continue;
    const code = String(r[cCode] ?? '').trim();
    if (!CODES.includes(code)) continue;
    console.log(`«${sheet}» ${code} | ${String(r[cName] ?? '').trim()} | مسؤول=${String(r[cOff] ?? '').trim() || '—'} | مستحق=${cOut != null ? (r[cOut] || 0) : '—'}`);
  }
}
// وكم فاتورةً لكلّ كود في ورقة الفواتير
const inv = XLSX.utils.sheet_to_json(wb.Sheets['Daily Invoice Report'], { header: 1, defval: '', blankrows: false });
const tally = {};
for (let i = 6; i < inv.length; i += 1) {
  const code = String(inv[i]?.[0] ?? '').trim();
  if (CODES.includes(code)) tally[code] = (tally[code] || 0) + 1;
}
console.log('\nفواتيرُ كلِّ كودٍ في Daily Invoice Report:', JSON.stringify(tally));
