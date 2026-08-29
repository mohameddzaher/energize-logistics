/**
 * استيراد «ملفّ عقود الموظفين» إلى مجموعة العقود.
 *
 *   node src/scripts/importEmployeeContracts.js --dry
 *   node src/scripts/importEmployeeContracts.js --yes
 *
 * ── لماذا الهويّة هي المفتاح ────────────────────────────────────────────────
 * الأسماء العربيّة تُكتب بصورٍ شتّى — همزةٌ تُهمَل ولقبٌ يُختصر — فالمطابقةُ
 * بها تُخطئ صامتةً فتُلصق عقدُ رجلٍ برجلٍ آخر. ورقمُ الهويّة لا يشبه غيرَه:
 * ٢٦٩ رقمًا في الملفّ، ٢٦٩ فريدة، و٢٦٩ منها وجدت موظّفَها.
 *
 * ── وما لا يُدهَس ───────────────────────────────────────────────────────────
 * الملفُّ لقطةٌ من ورق، والشاشةُ قد صحّحت بعده. فالراتبُ والبدلاتُ والملاحظات
 * لا تُمسّ — الملفُّ لا يحملها أصلًا — ولا يُكتب فوق قيمةٍ قائمةٍ إلّا إن كان
 * الملفُّ يحمل لها قيمةً غيرَ فارغة، وبعلَمِ `--overwrite`.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const path = require('path');
const mongoose = require('mongoose');
const { readSheet, excelDate } = require('./lib/xlsxStream');
const Employee = require('../models/Employee');
const Contract = require('../models/Contract');

const DRY = !process.argv.includes('--yes');
const OVERWRITE = process.argv.includes('--overwrite');
const FILE = path.join(__dirname, '../seeds/data/hr-2026-08/ملف عقود الموظفين.xlsx');
const HEADER_ROW = 2;

const EMPTY = new Set(['', '-', '#n/a', 'n/a', 'na', 'null', 'undefined']);
const str = (v) => {
  const s = String(v ?? '').trim();
  return EMPTY.has(s.toLowerCase()) ? '' : s;
};
const iso = (v) => {
  const d = excelDate(v);
  return d ? d.toISOString().slice(0, 10) : '';
};

/** «٢١» رقمٌ و«غير مطلوب» نصّ — ولا يُحشر أحدُهما مكانَ الآخر. */
const numOrText = (v) => {
  const s = str(v);
  if (!s) return { n: null, text: '' };
  const n = Number(s);
  return Number.isFinite(n) ? { n, text: '' } : { n: null, text: s };
};

(async () => {
  console.log('\n' + '='.repeat(70));
  console.log(DRY ? '  استيراد عقود الموظفين — تجربةٌ فقط' : '  استيراد عقود الموظفين — تنفيذ');
  console.log('='.repeat(70));

  const rows = readSheet(FILE, 'xl/worksheets/sheet1.xml')
    .filter((r) => r.r > HEADER_ROW && str(r.cells.A));
  console.log(`  صفوفٌ لها هويّة: ${rows.length}`);

  await mongoose.connect(process.env.MONGODB_URI);
  const emps = await Employee.find({}).select('iqamaNumber nationalId firstName lastName employeeNumber hireDate contractStartDate').lean();
  const byId = new Map();
  for (const e of emps) {
    for (const k of [e.iqamaNumber, e.nationalId]) {
      const v = str(k);
      if (v && !byId.has(v)) byId.set(v, e);
    }
  }

  const contracts = await Contract.find({}).lean();
  // أحدثُ عقدٍ لكلّ موظّف هو العقدُ الجاري — والملفُّ يصف الجاري.
  const byEmp = new Map();
  for (const c of contracts.sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')))) {
    const k = String(c.employee);
    if (!byEmp.has(k)) byEmp.set(k, c);
  }

  const plan = [];
  const noEmployee = [];
  const noStart = [];
  /** تاريخُ الموظّف قد يكون Date أو نصًّا — والعقدُ يخزّنه YYYY-MM-DD. */
  const dstr = (v) => {
    if (!v) return '';
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
    const s2 = String(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s2) ? s2 : '';
  };
  const fieldHits = {};
  for (const { cells } of rows) {
    const iq = str(cells.A);
    const emp = byId.get(iq);
    if (!emp) { noEmployee.push(iq); continue; }

    const leave = numOrText(cells.F);
    const prob = numOrText(cells.G);
    const src = {
      iqamaNumber: iq,
      employeeNameAr: str(cells.B),
      contractProfession: str(cells.C),
      startDate: iso(cells.D),
      endDate: iso(cells.E),
      annualLeaveDays: leave.n,
      annualLeaveText: leave.text,
      probationText: prob.text,
      sponsorRegistration: str(cells.H),
    };

    const cur = byEmp.get(String(emp._id));
    const set = {};
    for (const [k, v] of Object.entries(src)) {
      if (v === null || v === '') continue;
      const now = cur ? cur[k] : undefined;
      const isBlank = now === undefined || now === null || now === '' || (k === 'annualLeaveDays' && now === 0);
      if (isBlank || (OVERWRITE && String(now) !== String(v))) {
        set[k] = v;
        fieldHits[k] = (fieldHits[k] || 0) + 1;
      }
    }
    if (!cur) {
      // ── والعقدُ بلا تاريخ بداية ─────────────────────────────────────────
      // أربعةُ صفوفٍ في الملفّ تكتب في خانة البداية «غير مطلوب» أو صفرًا.
      // ولا يُخترَع لها تاريخ: يُؤخَذ تاريخُ مباشرة الموظّف من ملفّه إن وُجد
      // — وهو مصدرٌ لا اختراع — ويُقيَّد ذلك في الملاحظات كي يعرف من يقرأ
      // العقد من أين جاء تاريخُه. وما لا مباشرةَ له يُترك ويُقال.
      const fallback = src.startDate || dstr(emp.contractStartDate) || dstr(emp.hireDate);
      if (!fallback) { noStart.push(`${emp.firstName || ''} ${emp.lastName || ''}`.trim() || iq); continue; }
      const note = src.startDate ? '' : 'تاريخ البداية من تاريخ المباشرة — ملفّ العقود لا يحمله';
      plan.push({
        create: true, employee: emp._id, name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
        set: { ...src, startDate: fallback, annualLeaveDays: src.annualLeaveDays ?? 21, ...(note ? { notes: note } : {}) },
      });
    } else if (Object.keys(set).length) {
      plan.push({ _id: cur._id, name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(), set });
    }
  }

  console.log(`  طُوبقت بالهويّة: ${rows.length - noEmployee.length}/${rows.length}`);
  if (noEmployee.length) console.log(`  بلا موظّفٍ في النظام: ${noEmployee.length} — ${noEmployee.slice(0, 5).join(', ')}`);
  if (noStart.length) console.log(`  بلا تاريخ بداية في الملفّ ولا مباشرةٍ في ملفّ الموظّف — لم يُنشأ عقدُها: ${noStart.length} — ${noStart.join('، ')}`);
  console.log(`\n  عقودٌ تُنشأ: ${plan.filter((p) => p.create).length} · تُحدَّث: ${plan.filter((p) => !p.create).length}`);
  console.log('\n  ما سيُملأ بالحقل:');
  Object.entries(fieldHits).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`    ${k.padEnd(22)} ${n}`));

  if (DRY) { console.log('\n  — تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  let created = 0; let updated = 0; let failed = 0;
  for (const p of plan) {
    try {
      if (p.create) {
        await Contract.create({ employee: p.employee, type: 'fixed', status: 'active', ...p.set });
        created += 1;
      } else {
        await Contract.updateOne({ _id: p._id }, { $set: p.set });
        updated += 1;
      }
    } catch (e) { failed += 1; console.error(`  ! ${p.name}: ${e.message}`); }
  }
  console.log(`\n  ✓ أُنشئ ${created} · حُدِّث ${updated}${failed ? ` · فشل ${failed}` : ''}`);

  const filled = async (k) => Contract.countDocuments({ [k]: { $nin: ['', null] } });
  console.log('\n  الحالة الآن:');
  for (const k of ['iqamaNumber', 'contractProfession', 'sponsorRegistration', 'startDate', 'endDate', 'annualLeaveText', 'probationText']) {
    // eslint-disable-next-line no-await-in-loop
    console.log(`    ${k.padEnd(22)} ${await filled(k)} / ${await Contract.countDocuments()}`);
  }
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
