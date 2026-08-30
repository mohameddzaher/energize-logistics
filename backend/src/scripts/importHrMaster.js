/**
 * استيراد «ماستر الموارد البشريّة» — المرجعُ الوحيد لبيانات الموظّفين.
 *
 *   node src/scripts/importHrMaster.js --dry
 *   node src/scripts/importHrMaster.js --yes
 *   node src/scripts/importHrMaster.js --yes --overwrite   # الماستر يصحّح لا يملأ فقط
 *
 * المصدر: src/seeds/data/hr-2026-08/master-of-hr.xlsx — ٣٧٨ موظّفًا، ٥١ عمودًا،
 * والترويسةُ في الصفّ الثالث. وحوله ثلاثةَ عشرَ شيتًا تفصيليًّا يكمّله.
 *
 * ── «مطلوب» ليست قيمة ───────────────────────────────────────────────────────
 * في الملفّ ٧٨٣٩ خليّةً مكتوبٌ فيها «مطلوب»، ومعناها: هذه الخانة **ناقصة**
 * ويجب استخراجُها — لا أنّ قيمتها كلمةُ «مطلوب». وكتابتُها كما هي تملأ النظام
 * ببياناتٍ كاذبة: مهنةٌ اسمها «مطلوب»، ومدينةٌ اسمها «مطلوب». فتُقرأ فراغًا.
 *
 * و«غير مطلوب» و«لا يوجد» على النقيض: حالتان سليمتان (لا تأمينَ مطلوبٌ لهذا،
 * ولا كارتَ سائقٍ لذاك) — تُحفظ في الخانات النصّيّة التي تصفُ حالة، وتُهمَل في
 * خانات التواريخ والأرقام.
 *
 * ── ولا يُدهَس عملُ الإنسان ─────────────────────────────────────────────────
 * الافتراضُ ملءُ الفارغ وحده. ومع `--overwrite` يصحّح الماستر ما خالفه — وهو
 * الصواب حين يكون الماستر أحدثَ من الشاشة، لا قبلَ ذلك.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const path = require('path');
const mongoose = require('mongoose');
const { readSheet, excelDate } = require('./lib/xlsxStream');
const Employee = require('../models/Employee');

const DRY = !process.argv.includes('--yes');
const OVERWRITE = process.argv.includes('--overwrite');
const FILE = path.join(__dirname, '../seeds/data/hr-2026-08/master-of-hr.xlsx');
const HEADER_ROW = 3;

// «مطلوب» = ناقص. أمّا «غير مطلوب» و«لا يوجد» فحالتان تُقالان حيث يقبلهما الحقل.
const MISSING = new Set(['', '-', '#n/a', 'n/a', 'na', 'null', 'undefined', 'مطلوب', '0']);
const STATE_WORDS = new Set(['غير مطلوب', 'لا يوجد']);

const str = (v) => {
  const s = String(v ?? '').trim();
  return MISSING.has(s.toLowerCase()) ? '' : s;
};
/** نصٌّ يصف حالة: يقبل «غير مطلوب» و«لا يوجد». */
const text = (v) => str(v);
/** نصٌّ يجب أن يكون قيمةً حقيقيّة: يرفض كلماتِ الحالة. */
const value = (v) => { const s = str(v); return STATE_WORDS.has(s) ? '' : s; };
const num = (v) => { const s = value(v); if (!s) return null; const n = Number(s.replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : null; };

/**
 * تاريخٌ بثلاث صور في هذا الملفّ: رقمٌ تسلسليّ (46304)، ونصٌّ ميلاديّ
 * ('2008-11-17')، ونصٌّ هجريّ ('1448-02-11'). والهجريُّ يُرفض: تخزينُه في خانة
 * ميلاديّةٍ يجعل الإقامةَ تنتهي سنة ١٤٤٨ ميلاديّة.
 */
const date = (v) => {
  const s = value(v);
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) { const d = excelDate(s); return d ? d.toISOString().slice(0, 10) : null; }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Number(iso[1]) < 1900 ? null : `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
  return null;
};
const bool = (v) => { const s = value(v); if (!s) return null; return /^(نعم|yes|true|1)$/i.test(s) ? true : (/^(لا|no|false)$/i.test(s) ? false : null); };
const gender = (v) => { const s = value(v); if (!s) return ''; return /ذكر|male/i.test(s) ? 'male' : (/انثى|أنثى|female/i.test(s) ? 'female' : ''); };

// عمود الماستر → [حقلُ النموذج، المحوِّل]
const MAP = {
  A: ['employeeNumber', value],
  B: ['iqamaNumber', value],
  C: ['arabicName', value],
  D: ['gender', gender],
  E: ['nationality', value],
  G: ['passportNumber', value],
  H: ['passportExpiry', date],
  I: ['iqamaIssueDate', date],
  J: ['iqamaExpiry', date],
  L: ['dateOfBirth', date],
  M: ['isOutsideKingdom', bool],
  O: ['employerNumber', value],
  P: ['gosiNumber', value],
  Q: ['department', value],
  R: ['workStatusText', text],
  S: ['workLocation', value],
  T: ['notes', value],
  U: ['iban', text],           // «cash» قيمةٌ حقيقيّة هنا: يُصرف نقدًا
  V: ['bank', text],
  W: ['email', value],
  X: ['companyEmail', value],
  Y: ['absherNumber', value],
  Z: ['companyNumber', value],
  AA: ['originCountryNumber', value],
  AB: ['address', value],
  AC: ['contractStatusText', text],
  AE: ['qiwaContractNumber', value],
  AF: ['contractStartDate', date],
  AG: ['contractEndDate', date],
  AI: ['hireDate', date],
  AK: ['branchName', value],
  AL: ['directManagerName', value],
  AM: ['systemStatus', text],
  AN: ['workStatusText', text],
  AO: ['iqamaProfession', value],
  AP: ['insuranceCompany', text],
  AQ: ['classification', value],
  AR: ['insuranceExpiry', date],
  AS: ['healthCertNumber', value],
  AT: ['healthCertExpiry', date],
  AU: ['driverCardStatus', text],
  AV: ['driverCardNumber', value],
  AW: ['driverCardExpiry', date],
  AX: ['licenseType', text],
  AY: ['licenseExpiry', date],
};
// المهنة في العقد تعيش على العقد لا على الموظّف (F و AD نفسُ العمود مكرّرًا).
const CONTRACT_PROFESSION_COLS = ['F', 'AD'];

// ── صفوفٌ يستثنيها صاحبُ الشركة ────────────────────────────────────────────
// «محمد شمين محمد ميا» (الصفّ ٥٠) ليس شخصًا: هو نفسُ «shamim mia» (#116)
// مكتوبًا بالعربيّة برقم إقامةٍ فيه غلطةُ رقمٍ واحد (2677457951 بدل
// 2577457951). أكّد صاحبُ الشركة أنّه غيرُ موجود، فلا يُنشأ هنا مهما تكرّر
// الاستيراد. ويبقى في ملفّ الماستر نفسِه حتى يُحذف منه — وحينها يُحذف هذا
// السطر أيضًا.
const EXCLUDED_IQAMAS = new Set(['2677457951']);

// ── هويّاتٌ في الماستر بها غلطةُ رقم ────────────────────────────────────────
// الماستر يكتب هويّة «محمد اسامه محمد عاشور» ‎2621086423، والصحيحُ ‎2621086426
// (أكّده صاحبُ الشركة، وهو ما تقوله الشيتاتُ التفصيليّة الثلاثةَ عشرَ كلُّها،
// وعليه سجلُّه #128). وبغير هذا التصحيح لا يطابق الصفُّ سجلَّه فيُنشأ له سجلٌّ
// ثانٍ في كلّ استيراد. يُحذف السطرُ متى صُحِّح الرقمُ في الملفّ.
const IQAMA_FIXES = { 2621086423: '2621086426' };
const fixIqama = (v) => IQAMA_FIXES[v] || v;

// ── الأسبقيّة: الشيتات الثلاثةَ عشرَ فوق الماستر ─────────────────────────────
// قرارُ صاحب الشركة: «الداتا في الـ١٤ شيت هي الأصحّ، والماستر يُؤخذ منه ما ليس
// فيها». وليست هذه أفضليّةً بلا سبب: الشيتُ التفصيليّ عمودٌ واحدٌ يُصدَّر من
// مصدره (أبشر، التأمينات، الجوازات)، والماسترُ جدولٌ يُجمَّع باليد فيشيخ فيه
// العمودُ ولا يُلاحَظ. وقد قيس الفرقُ فعلًا: ستُّ خاناتِ أبشرَ مختلفة، وجنسيّةٌ
// مكتوبةٌ «غير سعودي» بدل «مصر»، وعنوانٌ وطنيٌّ لا يطابق.
//
// فهذه الحقولُ يملكها الشيتُ: يملؤها الماسترُ إن كانت فارغةً، ولا يكتب فوقها
// أبدًا — ولا حتى مع `--overwrite`. وما عداها (الآيبان والبنك والتصنيف ونوع
// الرخصة…) لا شيتَ له، فالماسترُ مصدرُه الوحيد ويصحّحه.
const SHEET_OWNED = new Set([
  'employeeNumber', 'absherNumber', 'nationality', 'email', 'gender', 'address',
  'employerNumber', 'gosiNumber', 'department', 'passportNumber', 'passportExpiry',
  'workStatusText', 'iqamaExpiry', 'iqamaProfession', 'arabicName', 'iqamaNumber',
  // «القسم والمسمى الوظيفي» يحمل خمسةً منها: القسم والفرع والمدير المباشر
  // والمسمّى ونوع التعاقد.
  'branchName', 'directManagerName', 'jobTitle', 'classification',
  'contractStartDate', 'contractEndDate', 'contractStatusText', 'hireDate',
]);

const DATE_FIELDS = new Set(['passportExpiry', 'iqamaIssueDate', 'iqamaExpiry', 'dateOfBirth',
  'contractStartDate', 'contractEndDate', 'hireDate', 'insuranceExpiry', 'healthCertExpiry', 'driverCardExpiry', 'licenseExpiry']);

const isBlank = (v) => v === undefined || v === null || v === '' || (v instanceof Date && Number.isNaN(v.getTime()));
const asComparable = (v) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'boolean') return v;
  return String(v ?? '').trim();
};

(async () => {
  console.log('\n' + '='.repeat(72));
  console.log(DRY ? '  ماستر الموارد البشريّة — تجربةٌ فقط' : `  ماستر الموارد البشريّة — تنفيذ${OVERWRITE ? ' (يصحّح المخالف — عدا ما تملكه الشيتات)' : ' (يملأ الفارغ)'}`);
  console.log('  الأسبقيّة: الشيتات الثلاثةَ عشرَ فوق الماستر — يملأ ما ليس فيها ولا يكتب فوقه.');
  console.log('='.repeat(72));

  const allRows = readSheet(FILE, 'xl/worksheets/sheet1.xml').filter((r) => r.r > HEADER_ROW && str(r.cells.B));
  const rows = allRows.filter((r) => !EXCLUDED_IQAMAS.has(str(r.cells.B)));
  const fixed = rows.filter((r) => IQAMA_FIXES[str(r.cells.B)]).length;
  if (fixed) console.log(`  هويّاتٌ صُحِّحت عن الملفّ: ${fixed}`);
  console.log(`  صفوفٌ لها رقم هويّة: ${allRows.length}${allRows.length !== rows.length ? ` (استُثني ${allRows.length - rows.length})` : ''}`);

  await mongoose.connect(process.env.MONGODB_URI);
  const emps = await Employee.find({}).lean();
  const byIq = new Map();
  for (const e of emps) {
    for (const k of [e.iqamaNumber, e.nationalId]) { const v = str(k); if (v && !byIq.has(v)) byIq.set(v, e); }
  }
  const byNum = new Map();
  for (const e of emps) { const v = str(e.employeeNumber); if (v && !byNum.has(v)) byNum.set(v, e); }

  const plan = [];
  const creates = [];
  const fieldHits = {};
  const professions = new Map();   // iqama -> المهنة في العقد

  for (const { cells } of rows) {
    const iq = fixIqama(str(cells.B));
    const emp = byIq.get(iq) || byNum.get(str(cells.A)) || null;

    const src = {};
    for (const [col, [field, conv]] of Object.entries(MAP)) {
      const v = conv(cells[col]);
      if (v === null || v === '' || v === undefined) continue;
      // العمودان المكرّران (Q/AJ، R/AN): الأوّلُ لا يُدهَس بفارغِ الثاني.
      if (src[field] === undefined) src[field] = v;
    }
    for (const c of CONTRACT_PROFESSION_COLS) {
      const p = value(cells[c]);
      if (p && !professions.has(iq)) professions.set(iq, p);
    }

    if (!emp) { creates.push({ iq, src }); continue; }

    const set = {};
    for (const [k, v] of Object.entries(src)) {
      const now = emp[k];
      const blank = isBlank(now);
      // الشيتُ يملك حقلَه: يُملأ الفارغُ ولا يُكتب فوق المملوء، مهما طُلب.
      const mayOverwrite = OVERWRITE && !SHEET_OWNED.has(k);
      if (blank || (mayOverwrite && asComparable(now) !== asComparable(v))) {
        set[k] = v;
        fieldHits[k] = (fieldHits[k] || 0) + 1;
      }
    }
    if (Object.keys(set).length) plan.push({ _id: emp._id, name: emp.arabicName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim(), set });
  }

  console.log(`  طُوبق: ${rows.length - creates.length}/${rows.length} · بلا سجلٍّ في النظام: ${creates.length}`);
  if (creates.length) creates.slice(0, 10).forEach((c) => console.log(`     + ${c.src.arabicName || c.iq} (#${c.src.employeeNumber || '—'})`));
  console.log(`\n  سجلّاتٌ ستُحدَّث: ${plan.length}`);
  console.log('\n  ما سيُكتب بالحقل:');
  Object.entries(fieldHits).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`    ${k.padEnd(24)} ${n}`));

  if (DRY) { console.log('\n  — تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  let updated = 0; let created = 0; let failed = 0;
  for (const p of plan) {
    try {
      // التواريخ تُكتب نصًّا أو Date حسب ما يقبله المخطّط — mongoose يحوّل.
      await Employee.updateOne({ _id: p._id }, { $set: p.set });
      updated += 1;
    } catch (e) { failed += 1; console.error(`  ! ${p.name}: ${e.message}`); }
  }
  for (const c of creates) {
    try {
      // المخطّطُ يوجب الاسمَ الأوّل والأخير، والماستر يكتب الاسمَ كاملًا في
      // خانةٍ واحدة. يُشقّ: أوّلُ كلمةٍ اسمٌ أوّل وما بقي اسمٌ أخير — ويبقى
      // الاسمُ الكامل في arabicName كما كُتب، فهو المعروضُ في كلّ مكان.
      const full = String(c.src.arabicName || '').trim().replace(/\s+/g, ' ');
      const parts = full ? full.split(' ') : [];
      const firstName = parts[0] || c.iq;
      const lastName = parts.slice(1).join(' ') || parts[0] || c.iq;
      await Employee.create({ ...c.src, iqamaNumber: c.iq, firstName, lastName });
      created += 1;
    } catch (e) { failed += 1; console.error(`  ! ${c.iq}: ${e.message}`); }
  }
  console.log(`\n  ✓ حُدِّث ${updated} · أُنشئ ${created}${failed ? ` · فشل ${failed}` : ''}`);

  // المهنةُ في العقد تُكتب على العقد الجاري لا على الموظّف.
  const Contract = require('../models/Contract');
  let profs = 0;
  for (const [iq, prof] of professions) {
    // eslint-disable-next-line no-await-in-loop
    const e = await Employee.findOne({ $or: [{ iqamaNumber: iq }, { nationalId: iq }] }).select('_id').lean();
    if (!e) continue;
    // eslint-disable-next-line no-await-in-loop
    const r = await Contract.updateMany(
      { employee: e._id, $or: [{ contractProfession: '' }, { contractProfession: { $exists: false } }] },
      { $set: { contractProfession: prof, iqamaNumber: iq } },
    );
    profs += r.modifiedCount;
  }
  console.log(`  ✓ المهنة في العقد: ${profs} عقدًا`);

  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
