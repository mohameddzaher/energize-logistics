const XLSX = require('xlsx');
const f = process.argv[2];
const wb = XLSX.readFile(f, { cellDates: true });
console.log('SHEETS:', wb.SheetNames);
for (const n of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' });
  console.log(`\n═══ ${n} — ${rows.length} rows`);
  if (!rows.length) continue;
  const cols = Object.keys(rows[0]);
  console.log('COLUMNS (%d):', cols.length);
  for (const c of cols) {
    const vals = rows.map(r => r[c]).filter(v => v !== '' && v != null);
    const ex = vals.slice(0, 2).map(v => v instanceof Date ? v.toISOString().slice(0,10) : String(v).slice(0,32));
    console.log(`   ${String(vals.length).padStart(6)}/${rows.length}  ${JSON.stringify(c)}  →  ${JSON.stringify(ex)}`);
  }
}
