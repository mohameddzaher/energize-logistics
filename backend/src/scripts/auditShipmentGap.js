require('dotenv').config();
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');
const FILE = path.join(__dirname, '../../../collection files/Financial Collections    9-2026.xlsx');
const wb = XLSX.readFile(FILE);
const serial = (n) => { const v = Number(n); return Number.isFinite(v) && v > 0 ? new Date(Math.round((v - 25569) * 86400000)) : null; };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const CollectionInvoice = require('../models/CollectionInvoice');
  const CollectionsParty = require('../models/CollectionsParty');
  const OperationsWorkflow = require('../models/OperationsWorkflow');

  // ── Shipment Report ─────────────────────────────────────────────────────
  const sr = XLSX.utils.sheet_to_json(wb.Sheets['Shipment Report'], { header: 1, defval: '', blankrows: false });
  const rows = [];
  for (let i = 5; i < sr.length; i += 1) {
    const r = sr[i]; if (!r) continue;
    const no = String(r[5] ?? '').trim();
    if (!no || !/^\d+$/.test(no)) continue;
    rows.push({ code: String(r[0] ?? '').trim(), owner: String(r[1] ?? '').trim(), name: String(r[2] ?? '').trim(),
      no, total: Number(r[6]) || 0, payDate: serial(r[9]), delDate: serial(r[11]), colDate: serial(r[13]), status: String(r[14] ?? '').trim() });
  }
  const sum = rows.reduce((a, r) => a + r.total, 0);
  console.log(`══ Shipment Report: ${rows.length} شحنةً برقم · إجمالي ${Math.round(sum).toLocaleString()} ريال`);
  const st = {}; rows.forEach((r) => { st[r.status || '(بلا حالة)'] = (st[r.status || '(بلا حالة)'] || 0) + 1; });
  console.log('   الحالات:', Object.entries(st).map(([k, v]) => `${k}=${v}`).join(' · '));

  const nums = [...new Set(rows.map((r) => r.no))];
  const inLedger = await CollectionInvoice.countDocuments({ invoiceNumber: { $in: nums.slice(0, 10000) } });
  console.log(`   منها في دفتر الفواتير عندنا: ${inLedger}`);
  const inWf = await OperationsWorkflow.countDocuments({ reportNumber: { $in: nums.slice(0, 10000) } });
  console.log(`   ومنها كأرقام كشوفٍ في سير عمل التشغيل: ${inWf}`);
  console.log('   مثال:', rows.slice(0, 3).map((r) => `${r.no}/${r.name}/${r.total}`).join(' · '));

  // ── Aging Shipment: مسؤولو التحصيل ──────────────────────────────────────
  const ag = XLSX.utils.sheet_to_json(wb.Sheets['Aging Shipment'], { header: 1, defval: '', blankrows: false });
  const off = new Map();
  for (let i = 5; i < ag.length; i += 1) {
    const r = ag[i]; if (!r) continue;
    const code = String(r[0] ?? '').trim(); const o = String(r[2] ?? '').trim();
    if (code && o) off.set(code, { officer: o, name: String(r[1] ?? '').trim() });
  }
  console.log(`\n══ Aging Shipment: ${off.size} حسابًا له مسؤول`);
  const byO = {}; [...off.values()].forEach((v) => { byO[v.officer] = (byO[v.officer] || 0) + 1; });
  console.log('   التوزيع:', Object.entries(byO).map(([k, v]) => `${k}=${v}`).join(' · '));

  const parties = await CollectionsParty.find({ kind: 'customer' }).select('code name collectionOfficer').lean();
  const byCode = new Map(parties.filter((p) => p.code).map((p) => [String(p.code).trim(), p]));
  let same = 0; const wrong = []; const absent = [];
  for (const [code, v] of off) {
    const p = byCode.get(code);
    if (!p) { absent.push({ code, ...v }); continue; }
    if (String(p.collectionOfficer || '').trim() === v.officer) same += 1;
    else wrong.push({ code, name: v.name, sheet: v.officer, db: p.collectionOfficer || '(فارغ)' });
  }
  console.log(`   ✓ متطابق: ${same} · ✗ مختلف: ${wrong.length} · ? بلا سجلٍّ عندنا: ${absent.length}`);
  wrong.slice(0, 15).forEach((w) => console.log(`      ${w.code} ${w.name.slice(0, 26).padEnd(26)} ورقة=${w.sheet.padEnd(9)} قاعدة=${w.db}`));
  absent.slice(0, 10).forEach((a) => console.log(`      ؟ ${a.code} ${a.name.slice(0, 30)} → ${a.officer}`));
  await mongoose.disconnect();
})();
