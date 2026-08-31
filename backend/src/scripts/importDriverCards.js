/**
 * importDriverCards — «update for Vehicles.xlsx» → سجلُّ بطاقات السائقين.
 *
 *   node src/scripts/importDriverCards.js [--yes] [ملف.xlsx]
 *
 * يُطابَق بالهويّة في `iqamaNumber` و`nationalId` معًا وإلّا سقط السعوديّون.
 * ويُعاد تشغيلُه بأمان: المطابقةُ بالهويّة والكتابةُ `upsert`.
 */
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const xlsx = require('./lib/xlsxStream');
const DriverCard = require('../models/DriverCard');
const Employee = require('../models/Employee');

const APPLY = process.argv.includes('--yes');
const FILE = process.argv.find((a) => a.endsWith('.xlsx'))
  || path.join(__dirname, '../../../update for Vehicles.xlsx');

const n = (v) => (v === null || v === undefined ? '' : String(v).trim());
const ymd = (v) => {
  const s = n(v); if (!s) return '';
  const num = Number(s);
  if (Number.isFinite(num) && num > 1000 && num < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + num * 86400000).toISOString().slice(0, 10);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};
// رقمُ البطاقة يصل عددًا عشريًّا لأنّ إكسل خزّنه رقمًا — يُنظَّف ولا يُخترَع.
const cardNo = (v) => {
  const s = n(v); if (!s) return '';
  return /^\d+\.\d{6,}$/.test(s) ? String(Number(Number(s).toFixed(8))) : s;
};

(async () => {
  console.log('\n' + '='.repeat(70));
  console.log(APPLY ? '  استيرادُ بطاقات السائقين — تنفيذ' : '  استيرادُ بطاقات السائقين — فحصٌ فقط');
  console.log('='.repeat(70));
  console.log('  الملفّ:', path.basename(FILE));
  await mongoose.connect(process.env.MONGODB_URI);

  const sheets = require('child_process')
    .execSync(`unzip -Z1 ${JSON.stringify(FILE)} "xl/worksheets/sheet*.xml"`).toString().trim().split('\n');
  const rows = xlsx.readSheet(FILE, sheets[0]);
  const hdr = rows.find((r) => r.cells && Object.values(r.cells).some((v) => n(v) === 'رقم الهوية'));
  if (!hdr) { console.error('  ✗ لم يُعثر على عمود «رقم الهوية»'); process.exit(1); }
  const cols = {}; Object.entries(hdr.cells).forEach(([k, v]) => { cols[k] = n(v); });
  const col = (title) => Object.keys(cols).find((k) => cols[k] === title);

  const C = {
    id: col('رقم الهوية'), name: col('الاسم'), dob: col('تاريخ الميلاد'),
    absher: col('جوال ابشر'), reg: col('سجل لوجستي'),
    card: col(' بطاقة السائق') || col('بطاقة السائق'),
    type: col('نوع البطاقة'), exp: col('تاريخ انتهاء بطاقة السائق'),
  };

  const emps = await Employee.find({}).select('iqamaNumber nationalId').lean();
  const byId = new Map();
  for (const e of emps) for (const k of [e.iqamaNumber, e.nationalId]) if (n(k)) byId.set(n(k), e._id);

  const docs = []; let unmatched = 0;
  for (const r of rows) {
    if (r.r <= hdr.r || !r.cells) continue;
    const id = n(r.cells[C.id]); if (!id) continue;
    const emp = byId.get(id);
    if (!emp) unmatched += 1;
    docs.push({
      idNumber: id,
      employee: emp || undefined,
      name: n(r.cells[C.name]),
      dateOfBirth: ymd(r.cells[C.dob]),
      absherPhone: n(r.cells[C.absher]),
      logisticRegister: n(r.cells[C.reg]),
      cardNumber: cardNo(r.cells[C.card]),
      cardType: n(r.cells[C.type]),
      expiryDate: ymd(r.cells[C.exp]),
    });
  }

  console.log(`\n  بطاقات: ${docs.length} · مطابقةٌ لموظّفين: ${docs.length - unmatched} · بلا موظّف: ${unmatched}`);
  const regs = {}; docs.forEach((d) => { regs[d.logisticRegister || '—'] = (regs[d.logisticRegister || '—'] || 0) + 1; });
  console.log('  بالسجل اللوجستي:', Object.entries(regs).map(([k, v]) => `${k}:${v}`).join(' · '));
  const { startOfDay, todayKey } = require('../utils/companyDay');
  const today = startOfDay(todayKey());
  const expired = docs.filter((d) => d.expiryDate && startOfDay(d.expiryDate) < today).length;
  const soon = docs.filter((d) => {
    if (!d.expiryDate) return false;
    const left = Math.round((startOfDay(d.expiryDate) - today) / 86400000);
    return left >= 0 && left <= 60;
  }).length;
  console.log(`  منتهية: ${expired} · تنتهي خلال ٦٠ يومًا: ${soon}`);

  if (!APPLY) { console.log('\n  فحصٌ فقط — أضِف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  const r = await DriverCard.bulkWrite(docs.map((d) => ({
    updateOne: { filter: { idNumber: d.idNumber }, update: { $set: d }, upsert: true },
  })), { ordered: false });
  console.log(`\n  أُنشئ ${r.upsertedCount || 0} · حُدِّث ${r.modifiedCount || 0}\n`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
