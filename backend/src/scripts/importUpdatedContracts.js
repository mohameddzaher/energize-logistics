/**
 * Imports the updated employee contracts file, which supersedes the previous one.
 * Usage: node src/scripts/importUpdatedContracts.js --dry | --yes
 * The sheet is the newest source, so its values overwrite; fields it does not carry (salary, allowances, notes, carried balance) are untouched. Matching is by identity number, since Arabic names are written in many forms.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const DRY = !process.argv.includes('--yes');
const FILE = path.join(__dirname, '../../..', 'final hr data', 'ملف عقود الموظفين المحدث.xlsx');
const SHEET = 'ورقة1';
const HEADER_ROW = 1;                       // First row is a counter, second holds the headers.

const EMPTY = new Set(['', '-', '#n/a', 'n/a', 'na', 'null', 'undefined']);
const str = (v) => {
  if (v == null) return '';
  const s = String(v).trim();
  return EMPTY.has(s.toLowerCase()) ? '' : s;
};
// Excel date epoch, computed in UTC so the device timezone cannot shift a day.
const XLS_EPOCH = Date.UTC(1899, 11, 30);
const iso = (v) => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 1) {
    return new Date(XLS_EPOCH + Math.round(v * 86400000)).toISOString().slice(0, 10);
  }
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) ? s.slice(0, 10) : '';
};
/** A numeric value and a text value are kept distinct, never substituted for each other. */
const numOrText = (v) => {
  const s = str(v);
  if (!s) return { n: null, text: '' };
  const n = Number(s);
  return Number.isFinite(n) ? { n, text: '' } : { n: null, text: s };
};
// Active means a running contract and terminated means ended; the renewed status never comes from the sheet.
const readStatus = (v) => {
  const s = str(v);
  if (!s) return '';
  if (/انهاء|منته|منتهي/.test(s)) return 'terminated';
  if (/ساري|نشط/.test(s)) return 'active';
  return '';
};

(async () => {
  console.log('\n' + '='.repeat(70));
  console.log(DRY ? '  عقود الموظفين المحدَّثة — تجربةٌ فقط' : '  عقود الموظفين المحدَّثة — تنفيذ');
  console.log('='.repeat(70));

  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true });
  const all = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { header: 1, defval: null, blankrows: false, raw: true });
  const rows = all.slice(HEADER_ROW + 1).filter((r) => str(r[0]));
  console.log(`  صفوفٌ لها هويّة: ${rows.length}`);

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');
  const Contract = require('../models/Contract');

  const emps = await Employee.find({}).select('iqamaNumber nationalId firstName lastName hireDate contractStartDate').lean();
  const byId = new Map();
  for (const e of emps) for (const k of [e.iqamaNumber, e.nationalId]) {
    const v = str(k); if (v && !byId.has(v)) byId.set(v, e);
  }

  // The latest contract per employee is the current one, and the sheet describes it.
  const contracts = await Contract.find({}).lean();
  const byEmp = new Map();
  // Second key by the same period, so no contract is created for a period that already has one.
  const bySpan = new Map();
  for (const c of contracts.sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')))) {
    const k = String(c.employee);
    if (!byEmp.has(k)) byEmp.set(k, c);
    const sk = `${k}|${c.startDate || ''}|${c.endDate || ''}`;
    if (!bySpan.has(sk)) bySpan.set(sk, c);
  }

  const plan = []; const noEmployee = []; const noStart = []; const suspect = [];
  const TODAY = new Date().toISOString().slice(0, 10);
  const changed = {}; const unchanged = {};
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

  for (const r of rows) {
    const iq = str(r[0]);
    const emp = byId.get(iq);
    if (!emp) { noEmployee.push(iq); continue; }

    const leave = numOrText(r[7]);
    const prob = numOrText(r[8]);
    const src = {
      iqamaNumber: iq,
      employeeNameAr: str(r[1]),
      contractProfession: str(r[3]),
      contractNumber: str(r[4]),
      startDate: iso(r[5]),
      endDate: iso(r[6]),
      annualLeaveDays: leave.n,
      annualLeaveText: leave.text,
      probationText: prob.text,
      sponsorRegistration: str(r[9]),
    };
    const status = readStatus(r[2]);
    if (status) src.status = status;

    // No contract is created for a period the employee already covers. Checking only for a current contract produced a second identical-period contract for employees whose dates differed, breaking leave balance. Look up by the exact period and update that contract.
    const spanKey = `${String(emp._id)}|${src.startDate}|${src.endDate}`;
    const sameSpan = bySpan.get(spanKey);
    const cur = sameSpan || byEmp.get(String(emp._id));
    const name = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || iq;

    if (!cur) {
      const start = src.startDate || str(emp.contractStartDate) || iso(emp.hireDate);
      if (!start) { noStart.push(name); continue; }
      plan.push({ create: true, employee: emp._id, name,
        set: { ...src, startDate: start, annualLeaveDays: src.annualLeaveDays ?? 21, type: 'fixed', status: src.status || 'active' } });
      continue;
    }

    // The sheet is newest: every value in it applies, anything absent is untouched, and the renewed status is not stripped from a contract renewed here after the sheet.
    // An active status with an end date already past contradicts itself, so it is not trusted: the contract is left as is and the name is reported for review, since reopening an ended contract would show it active everywhere.
    const endsAt = src.endDate || cur.endDate || '';
    const contradicts = src.status === 'active' && endsAt && endsAt < TODAY;
    if (contradicts) suspect.push(`${name} — «ساري» ونهايتُه ${endsAt}`);

    const set = {};
    for (const [k, v] of Object.entries(src)) {
      if (v === null || v === '') continue;
      if (k === 'status' && cur.status === 'renewed') { bump(unchanged, k); continue; }
      if (k === 'status' && contradicts) { bump(unchanged, k); continue; }
      if (String(cur[k] ?? '') === String(v)) { bump(unchanged, k); continue; }
      set[k] = v; bump(changed, k);
    }
    if (Object.keys(set).length) plan.push({ _id: cur._id, name, set, before: cur });
  }

  console.log(`  طُوبقت بالهويّة: ${rows.length - noEmployee.length}/${rows.length}`);
  if (noEmployee.length) console.log(`  بلا موظّفٍ في النظام: ${noEmployee.length} — ${noEmployee.slice(0, 6).join('، ')}`);
  if (noStart.length) console.log(`  بلا تاريخ بدايةٍ ولا مباشرة — لم يُنشأ عقدُها: ${noStart.length} — ${noStart.join('، ')}`);
  console.log(`\n  عقودٌ تُنشأ: ${plan.filter((p) => p.create).length} · تُحدَّث: ${plan.filter((p) => !p.create).length}`);

  console.log('\n  ما سيتغيّر بالحقل:');
  Object.entries(changed).sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`    ${k.padEnd(22)} ${String(n).padStart(4)}   ${DRY ? `(مطابقٌ سلفًا: ${unchanged[k] || 0})` : ''}`));

  if (suspect.length) {
    console.log(`\n  ⚠ «ساري» وتاريخُ النهاية ماضٍ — تُركت حالتُها كما هي لتُراجَع (${suspect.length}):`);
    for (const x of suspect) console.log(`    ${x}`);
  }

  const term = plan.filter((p) => p.set?.status === 'terminated');
  if (term.length) {
    console.log(`\n  عقودٌ تُقفَل «منتهية» (${term.length}):`);
    for (const p of term.slice(0, 20)) console.log(`    ${p.name}`);
    if (term.length > 20) console.log(`    … و${term.length - 20} غيرها`);
  }

  if (DRY) { console.log('\n  — تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  let created = 0; let updated = 0; let failed = 0;
  for (const p of plan) {
    try {
      if (p.create) { await Contract.create({ employee: p.employee, type: 'fixed', ...p.set }); created += 1; }
      else { await Contract.updateOne({ _id: p._id }, { $set: p.set }); updated += 1; }
    } catch (e) { failed += 1; console.error(`  ! ${p.name}: ${e.message}`); }
  }
  console.log(`\n  ✓ أُنشئ ${created} · حُدِّث ${updated}${failed ? ` · فشل ${failed}` : ''}`);

  const total = await Contract.countDocuments();
  console.log('\n  الحالة الآن:');
  for (const k of ['contractNumber', 'contractProfession', 'iqamaNumber', 'sponsorRegistration', 'startDate', 'endDate']) {
    // eslint-disable-next-line no-await-in-loop
    console.log(`    ${k.padEnd(22)} ${await Contract.countDocuments({ [k]: { $nin: ['', null] } })} / ${total}`);
  }
  const byStatus = await Contract.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  console.log('  بالحالة:', byStatus.map((x) => `${x._id}=${x.n}`).join(' · '));
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
