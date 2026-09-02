const XLSX = require('xlsx');
const wb = XLSX.readFile(process.argv[2], { cellDates: true, sheetRows: 0 });
const only = process.argv[3];
for (const n of wb.SheetNames) {
  if (only && n !== only) continue;
  const ws = wb.Sheets[n];
  const ref = ws['!ref'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: false });
  console.log(`\n═══ ${n}  ref=${ref}  rows=${rows.length}`);
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    console.log(`  [${i}] ${JSON.stringify(rows[i].slice(0, 30))}`);
  }
}
