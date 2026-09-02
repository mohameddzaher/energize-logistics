const XLSX = require('xlsx');
const wb = XLSX.readFile(process.argv[2], { cellDates: true });
for (const name of ['2026', '2026 (2)', 'Sheet2']) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, blankrows: false, raw: true });
  const hi = name === '2026' ? 4 : name === '2026 (2)' ? 2 : -1;
  console.log(`\n═══ ${name}: ${rows.length} rows, header@${hi}`);
  if (hi >= 0) console.log('  hdr:', rows[hi].map(h => String(h||'').trim()).join(' | '));
  const data = rows.slice(hi + 1);
  console.log(`  data rows: ${data.length}`);
  // types per column
  const n = Math.max(...data.slice(0,500).map(r=>r.length));
  for (let c = 0; c < n; c++) {
    const vals = data.map(r => r[c]).filter(v => v !== null && v !== undefined && v !== '');
    if (!vals.length) { console.log(`   c${c} EMPTY`); continue; }
    const types = [...new Set(vals.slice(0,3000).map(v => v instanceof Date ? 'Date' : typeof v))];
    const ex = vals.slice(0,3).map(v => v instanceof Date ? v.toISOString().slice(0,10) : String(v).slice(0,26));
    console.log(`   c${String(c).padStart(2)} ${String(vals.length).padStart(6)}  ${types.join('/')}  ${JSON.stringify(ex)}`);
  }
}
