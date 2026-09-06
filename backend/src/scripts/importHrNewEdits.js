/**
 * importHrNewEdits — تحديثُ الموارد البشريّة من ملفّات «new edits».
 *
 *   node src/scripts/importHrNewEdits.js            تجربة، بلا كتابة
 *   node src/scripts/importHrNewEdits.js --yes      تنفيذ
 *
 * ── أربعةُ ملفّات، ومفتاحٌ واحد ──────────────────────────────────────────────
 *   الإقامات        → تاريخ الإصدار والانتهاء والهجريّ والمهنة في الإقامة
 *   بطاقات السائقين → توفّرُها ورقمُها وتاريخُ انتهائها
 *   الجوازات        → رقمُ الجواز وتاريخُ انتهائه
 *   العقود          → حالتُه ومهنتُه ورقمُه ومدّتُه والإجازةُ والتجربةُ والسجلّ
 *
 * والمطابقةُ برقم الهويّة وحدَه: الأسماءُ تُكتب بصورٍ، والرقمُ لا. ومَن لا يُطابَق
 * يُعرَض ولا يُخترَع له سجلّ — إنشاءُ موظّفٍ من ملفِّ تحديثٍ يصنع موظّفين وهميّين.
 *
 * ── و«غير مطلوب» ليست خانةً فارغة ────────────────────────────────────────────
 * هي قرارٌ إداريٌّ ألّا نجمع هذا الحقلَ لهذا الموظّف — سائقٌ سعوديٌّ لا إقامةَ له،
 * وعاملٌ لا يُطلَب جوازُه. وعدُّها نقصًا يجعل شاشةَ النواقص تطالب بما لا يُطلَب،
 * فيُهمَل الرقمُ كلُّه. تُكتب `not_required` في `fieldStatus` فتخرج من العدّ
 * وتُقرأ على الشاشة «غير مطلوب».
 *
 * و«مطلوب» عكسُها: الحقلُ مطلوبٌ وناقصٌ فعلًا، فيُعَدّ.
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');
const H = require('../config/hrFields');

const YES = process.argv.includes('--yes');
const DIR = path.join(__dirname, '..', '..', '..', 'final hr data', 'new edits');

// ── قراءةُ إكسل ─────────────────────────────────────────────────────────────
// التواريخُ تُقرأ أرقامًا خامًا لا كائناتِ تاريخ: `cellDates` يبني التاريخَ
// بتوقيت الجهاز على مبدأ ١٨٩٩، فيسقط يومٌ من كلّ تاريخ. راجع xlsx-date-epoch-trap.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86400000;
const AR_DIGITS = (s) => String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const S = (v) => (v === null || v === undefined ? '' : String(v).trim());
const N = (v) => { const n = Number(AR_DIGITS(S(v))); return Number.isFinite(n) && S(v) !== '' ? n : null; };
const serialToDate = (n) => {
  if (!Number.isFinite(n) || n < 20000 || n > 75000) return null;
  const d = new Date(EXCEL_EPOCH + Math.round(n) * DAY);
  return Number.isNaN(d.getTime()) ? null : d;
};
const D = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const n = N(v);
  if (n !== null) return serialToDate(n);
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const idKey = (v) => AR_DIGITS(S(v)).replace(/[\s\-_ـ.]/g, '');

/** سببُ غياب القيمة، أو '' إن كانت الخانة تحمل قيمةً حقيقية. */
const sentinel = (raw) => {
  const t = S(raw).replace(/ـ/g, '');
  if (t === '' || t === '0' || t === '-' || t === '—' || t === '_') return 'required';
  if (/^غير\s*مطلوب$/.test(t)) return 'not_required';
  if (/^مطلوب$/.test(t)) return 'required';
  if (/^لا\s*يوجد$/.test(t)) return 'none';
  return '';
};

const sheet = (file, range) => {
  const wb = XLSX.readFile(path.join(DIR, file));
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: true, ...(range != null ? { range } : {}) });
};

// ── الملفّات وأعمدتُها ───────────────────────────────────────────────────────
// كلُّ سطرٍ: عمودُ الملفّ → حقلُ الموظّف، ونوعُه.
const FILES = [
  {
    file: 'الاقامات بعد المراجعة .xlsx', label: 'الإقامات', idCol: 'رقم الهوية',
    map: [
      ['تاريخ الإصدار', 'iqamaIssueDate', 'date'],
      ['تاريخ الانتهاء', 'iqamaExpiry', 'date'],
      ['الانتهاء (هجري)', 'iqamaExpiryHijri', 'text'],
      ['المهنة في الإقامة', 'iqamaProfession', 'text'],
    ],
  },
  {
    file: 'بطاقات السائقيين تحديث مطلوب و غير مطلوب .xlsx', label: 'بطاقات السائقين', range: 1, idCol: 'رقم الهوية',
    map: [
      ['توفّر البطاقة', 'driverCardStatus', 'text'],
      ['رقم البطاقة', 'driverCardNumber', 'text'],
      ['تاريخ الانتهاء', 'driverCardExpiry', 'date'],
    ],
  },
  {
    file: 'بيانات الجوازات مطلوب وغير مطلوب بعد المراجعة .xlsx', label: 'الجوازات', idCol: 'رقم الهوية',
    map: [
      ['رقم الجواز', 'passportNumber', 'text'],
      ['تاريخ الانتهاء', 'passportExpiry', 'date'],
    ],
  },
  {
    file: 'ملف عقود الموظفين (2).xlsx', label: 'العقود', range: 1, idCol: 'الهوية',
    map: [
      ['حالة العقد', 'contractStatusText', 'text'],
      ['المهنة في العقد', 'contractOccupation', 'text'],
      ['رقم العقد', 'qiwaContractNumber', 'text'],
      ['تاريخ بداية العقد', 'contractStartDate', 'date'],
      ['تاريخ نهاية العقد', 'contractEndDate', 'date'],
      ['الاجازه السنوية ', 'annualLeaveDays', 'number'],
      ['فترة التجربة ', 'probationPeriod', 'text'],
    ],
  },
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');

  console.log(YES ? '── تنفيذ ──\n' : '── تجربة، بلا كتابة ──\n');

  // فهرسُ الموظّفين بالهويّة — الإقامةُ والهويّةُ الوطنيّةُ كلتاهما مفتاح.
  const emps = await Employee.find({ isHrRecord: { $ne: false } })
    .select('firstName lastName arabicName employeeNumber iqamaNumber nationalId fieldStatus '
      + FILES.flatMap((f) => f.map.map((m) => m[1])).join(' ')).lean();
  const byId = new Map();
  for (const e of emps) {
    for (const k of [idKey(e.iqamaNumber), idKey(e.nationalId)]) if (k) byId.set(k, e);
  }
  console.log(`موظّفون في النظام: ${emps.length}\n`);

  const ops = new Map();       // id → { $set, $unset }
  const totals = { matched: 0, missed: 0, values: 0, notRequired: 0, required: 0, unchanged: 0 };
  const missedRows = [];

  for (const F of FILES) {
    const rows = sheet(F.file, F.range);
    let matched = 0; let missed = 0; let vals = 0; let nr = 0; let rq = 0;

    for (const r of rows) {
      const key = idKey(r[F.idCol]);
      if (!key) continue;
      const emp = byId.get(key);
      if (!emp) { missed += 1; missedRows.push(`${F.label}: ${S(r['الاسم'] || r['الاسم '] || '—')} · ${key}`); continue; }
      matched += 1;

      const bucket = ops.get(String(emp._id)) || { $set: {}, $unset: {}, name: emp.arabicName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim() };
      for (const [col, field, kind] of F.map) {
        const raw = r[col];
        const mark = sentinel(raw);
        const statusKey = H.statusKeyOf(field);

        if (mark) {
          // «غير مطلوب» أو «مطلوب» أو «لا يوجد» — حالةٌ لا قيمة.
          const cur = emp.fieldStatus?.[statusKey];
          if (String(cur ?? '') !== mark) bucket.$set[`fieldStatus.${statusKey}`] = mark;
          if (mark === 'not_required') nr += 1; else rq += 1;
          continue;
        }

        // قيمةٌ حقيقيّة: تُكتب، وتُرفَع عنها أيُّ حالةِ نقصٍ سابقة.
        let value;
        if (kind === 'date') { const d = D(raw); if (!d) continue; value = d; }
        else if (kind === 'number') { const n = N(raw); if (n === null) continue; value = n; }
        else { value = S(raw); if (!value) continue; }

        const before = emp[field];
        const same = kind === 'date'
          ? iso(before) === iso(value)
          : String(before ?? '') === String(value);
        if (same) { totals.unchanged += 1; } else { bucket.$set[field] = value; vals += 1; }
        if (emp.fieldStatus?.[statusKey]) bucket.$unset[`fieldStatus.${statusKey}`] = 1;
      }
      ops.set(String(emp._id), bucket);
    }

    console.log(`${F.label.padEnd(18)} ${String(rows.length).padStart(4)} صفًّا · طوبق ${String(matched).padStart(4)} · بلا مطابقة ${String(missed).padStart(3)} · قيم ${String(vals).padStart(4)} · غير مطلوب ${String(nr).padStart(4)} · مطلوب ${String(rq).padStart(3)}`);
    totals.matched += matched; totals.missed += missed; totals.values += vals;
    totals.notRequired += nr; totals.required += rq;
  }

  const touched = [...ops.values()].filter((b) => Object.keys(b.$set).length || Object.keys(b.$unset).length);
  console.log(`\nالمجموع: ${totals.values} قيمة · ${totals.notRequired} «غير مطلوب» · ${totals.required} «مطلوب» · ${totals.unchanged} بلا تغيير`);
  console.log(`موظّفون يُمَسّون: ${touched.length}`);
  if (missedRows.length) {
    console.log(`\nصفوفٌ بلا موظّفٍ مطابق (${missedRows.length}) — لا يُنشَأ لها سجلّ:`);
    missedRows.slice(0, 12).forEach((m) => console.log('  ', m));
    if (missedRows.length > 12) console.log(`   … و${missedRows.length - 12} غيرها`);
  }

  // ── والعقدُ سجلٌّ قائمٌ بذاته، لا مرآةٌ على الموظّف ────────────────────────
  // رصيدُ الإجازات يُحسب من **بداية العقد النشط وأيّامه** لا من حقول الموظّف
  // (راجع utils/leaveBalance). فتحديثُ المرآة وحدَها يترك الرصيدَ على أرقامٍ
  // قديمة — يُقرأ في الملفّ رقمٌ جديدٌ ويُحسب الرصيدُ بالقديم.
  const Contract = require('../models/Contract');
  const contractFile = FILES.find((f) => f.label === 'العقود');
  const cRows = sheet(contractFile.file, contractFile.range);
  const active = await Contract.find({ status: 'active' })
    .select('employee iqamaNumber startDate endDate annualLeaveDays contractProfession contractNumber').lean();
  const cByEmp = new Map(active.map((c) => [String(c.employee), c]));

  const cWrites = []; let cTouched = 0; let cMissing = 0;
  for (const r of cRows) {
    const emp = byId.get(idKey(r[contractFile.idCol]));
    if (!emp) continue;
    const c = cByEmp.get(String(emp._id));
    if (!c) { cMissing += 1; continue; }
    const $set = {};
    const start = D(r['تاريخ بداية العقد']);
    const end = D(r['تاريخ نهاية العقد']);
    const days = N(r['الاجازه السنوية ']);
    const prof = S(r['المهنة في العقد']);
    const num = S(r['رقم العقد']);
    if (start && iso(c.startDate) !== iso(start)) $set.startDate = start;
    if (end && iso(c.endDate) !== iso(end)) $set.endDate = end;
    if (days !== null && Number(c.annualLeaveDays) !== days) $set.annualLeaveDays = days;
    if (prof && !sentinel(prof) && c.contractProfession !== prof) $set.contractProfession = prof;
    if (num && !sentinel(num) && String(c.contractNumber || '') !== num) $set.contractNumber = num;
    if (Object.keys($set).length) { cWrites.push({ updateOne: { filter: { _id: c._id }, update: { $set } } }); cTouched += 1; }
  }
  console.log(`\nالعقودُ النشطة: ${active.length} · تُحدَّث ${cTouched}` + (cMissing ? ` · بلا عقدٍ نشط ${cMissing}` : ''));

  if (!YES) { console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  const writes = [];
  for (const [id, b] of ops) {
    const update = {};
    if (Object.keys(b.$set).length) update.$set = b.$set;
    if (Object.keys(b.$unset).length) update.$unset = b.$unset;
    if (Object.keys(update).length) writes.push({ updateOne: { filter: { _id: id }, update } });
  }
  let changed = 0;
  for (let i = 0; i < writes.length; i += 500) {
    const r = await Employee.bulkWrite(writes.slice(i, i + 500), { ordered: false });
    changed += r.modifiedCount || 0;
  }
  console.log(`\n✓ حُدِّث ${changed} موظّفًا`);
  let cChanged = 0;
  for (let i = 0; i < cWrites.length; i += 500) {
    const r = await Contract.bulkWrite(cWrites.slice(i, i + 500), { ordered: false });
    cChanged += r.modifiedCount || 0;
  }
  if (cChanged) console.log(`✓ وحُدِّث ${cChanged} عقدًا نشطًا — ورصيدُ الإجازات يُحسب منها`);
  try { require('../utils/ttlCache').clear('hr:'); } catch (_) {}
  await mongoose.disconnect();
})();
