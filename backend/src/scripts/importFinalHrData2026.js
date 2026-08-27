/* eslint-disable no-console */
/**
 * importFinalHrData2026 — الملفّ الوظيفيّ النهائيّ (أغسطس ٢٠٢٦).
 *
 *   node src/scripts/importFinalHrData2026.js --dry     خطّة كاملة بلا كتابة
 *   node src/scripts/importFinalHrData2026.js --yes     تنفيذ
 *
 * المصدر: seeds/data/hr-2026-08/ — ثلاثة عشر ملفًّا، كلٌّ منها عمودٌ أو عمودان
 * على مفتاحٍ واحد: «رقم الهوية». أحدَ عشَرَ منها تحمل الـ٣٦٠ نفسها بلا زيادةٍ ولا
 * نقص، واثنان (رخص العمل والعقود) يحملان مجموعةً أضيق فيها اسمان خارج الـ٣٦٠،
 * فالمجموع اثنان وستّون وثلاثمئة رقم هوية.
 *
 * ── المفتاح، ولماذا يُطبَّع قبل المقارنة ────────────────────────────────────
 * إكسل يكتب رقم الهوية عددًا، وقاعدتنا تحفظه نصًّا، وقد تصل الأرقام هندية
 * («٢٦١٩٦٠٨٣٧١») أو بمسافةٍ في طرفها. والمقارنة النصّية الساذجة تجعل الموظّف
 * الواحد اثنين: واحدٌ في القاعدة وآخرُ «جديد» يُنشَأ فوقه. فيُطبَّع الطرفان إلى
 * أرقامٍ لاتينية متلاصقة قبل أن يلتقيا.
 *
 * ── «مطلوب» و«غير مطلوب» — وهما بيت القصيد ─────────────────────────────────
 * الخانة واحدةٌ من ثلاث لا رابعَ لها:
 *   ① قيمةٌ حقيقية      → تُخزَّن، ويُمحى عنها أيُّ عَلَمِ حالةٍ قديم.
 *   ② «مطلوب»           → نقصٌ على الموارد البشرية أن تجمعه → `<field>Status=required`
 *   ③ «غير مطلوب»       → قرارٌ إداريّ ألّا نجمعه أصلًا → `<field>Status=not_required`
 * والخانة الفارغة — أو التي كتب فيها إكسل صفرًا مكان الفراغ — «مطلوبٌ» أيضًا:
 * غيابُ البيانات شغلٌ ينتظر ما لم يقل أحدٌ صراحةً إنه غير مطلوب.
 *
 * والفرق بين ② و③ ليس تفصيلًا: سعوديٌّ لا جوازَ له في ملفّنا ليس «ناقصَ جواز»،
 * ووضعُه في قائمة عمل الموارد البشرية يجعلها كذبًا يضيّع وقت مَن يفتحها. لذلك
 * لا تُلفَّق الحالة هنا، بل تُكتب بالآلية القائمة نفسها في config/hrFields.js
 * وcontrollers/hrMasterController.js — لا آليةَ ثانية بجانبها.
 *
 * ── وسببُ الغياب لا يمحو قيمةً عندنا ────────────────────────────────────────
 * حين تقول الخانة «غير مطلوب» ويكون عندنا رقمُ جوازٍ مخزَّن، يبقى الرقم ويُكتب
 * العَلَم بجانبه. `statusOf` مصمَّمةٌ على ذلك: تُبقي «غير مطلوب» مهما وُجدت
 * قيمة، وتُرجِّح القيمةَ الموجودة على عَلَمِ «مطلوب» القديم. ومحوُ الرقم كان
 * يفقدنا بيانًا صحيحًا لا يعيده الشيتُ أبدًا لأنه لا يحمله أصلًا.
 *
 * ── والملف لا يدوس على شغل بني آدم ─────────────────────────────────────────
 * (نفس قاعدة a348299b، وكما نفّذها importFinalVehicles2026.js.) الشيت لقطةٌ من
 * ورق، ومَن فتح الشاشة بعده كان ينظر إلى الموظّف نفسه. فقاعدتان:
 *   ① تاريخُ انتهاءٍ جدَّده موظّفٌ بعد لقطة الملف يبقى — يُقرأ من EmployeeRenewal
 *      ويُطبَع مَن جدَّده وإلى أيّ تاريخ. تجديدٌ مسجَّلٌ بأثرِه أصدقُ من ورقةٍ
 *      كُتبت قبله.
 *   ② سجلٌّ `updatedAt` فيه أحدثُ من `lastImportAt` لمسَه إنسان، فلا يُكتب فيه
 *      شيءٌ لم يحمله الشيت. الشيت يزيد ولا ينقص.
 * وما لا تحمله هذه الملفات أصلًا (الراتب، الآيبان، التأمين الطبيّ، بطاقة
 * السائق، رخصة القيادة، تاريخ الميلاد، تاريخ التعيين…) لا يُكتب أبدًا فلا
 * يُمسّ: ملفُّ جوازاتٍ لا يقول شيئًا عن راتب.
 *
 * ── وما في القاعدة وليس في الملفات لا يُحذف ────────────────────────────────
 * أربعةٌ وأربعون موظّفًا في القاعدة لا ذكرَ لهم في هذه الملفات. لا `--replace`
 * هنا ولا حذفَ ولا تعطيل: غيابُ اسمٍ عن ورقةٍ ليس دليلَ خروجٍ من العمل، وقد
 * يكون سهوًا. يُطبَعون بأسمائهم وأرقامهم ليقرّر فيهم إنسان.
 *
 * ── حالة التوظيف لا يحرّكها هذا الاستيراد ──────────────────────────────────
 * عمود «حاله العمل» نصٌّ إداريّ يُكتب في `workStatusText`، ولا يُترجَم إلى
 * `employmentStatus` لمن هو في القاعدة أصلًا: «تم اصدار خروج نهائي» قرارٌ له
 * إجراءٌ كامل (إنهاء الخدمة، إرجاع العهد، مخالصة) ولا يصحّ أن يقع صامتًا من
 * سكربتِ استيراد. يُطبَع الخلافُ ليُتَّخذ القرار على الشاشة. أمّا المُنشأون
 * الجدد فلا حالةَ لهم أصلًا، فتُقرأ لهم من العمود عند الإنشاء وحده.
 *
 * الاستيراد فعّالٌ متكرّر (idempotent): إعادةُ تشغيله لا تغيّر شيئًا.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const H = require('../config/hrFields');

const ARGV = process.argv.slice(2);
const DRY = ARGV.includes('--dry') || !ARGV.includes('--yes');
const DIR = path.join(__dirname, '..', 'seeds', 'data', 'hr-2026-08');

// ── قراءة الخانات ────────────────────────────────────────────────────────────
const S = (v) => (v === null || v === undefined ? '' : String(v).trim().replace(/\s+/g, ' '));
const AR_DIGITS = (t) => String(t)
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

/** رقمٌ حقيقيّ أو null. النصّ الذي لا يُقرأ رقمًا ليس صفرًا — هو لا رقم. */
const N = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = AR_DIGITS(String(v)).replace(/[,\s٬]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

// ── الأرقام التسلسلية للتواريخ ───────────────────────────────────────────────
// إكسل يكتب التاريخ عددًا: ٤٦٣١١ = ١٦ أكتوبر ٢٠٢٦. ومبدؤه ٣٠ ديسمبر ١٨٩٩ لا
// ١ يناير ١٩٠٠، بسبب سنةٍ كبيسةٍ وهميّة في ١٩٠٠ ورثها عن لوتس ١-٢-٣. الطرحُ من
// المبدأ الخاطئ يزيح كلّ تاريخٍ في الملفّ يومًا كاملًا.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86400000;
// حدٌّ للعقل: ٢٠٠٠٠ ≈ ١٩٥٤ و٧٥٠٠٠ ≈ ٢١٠٥. رقمُ هويةٍ سقط في خانة تاريخٍ يخرج عن
// هذا المدى، وقبولُه يصنع تاريخًا في القرن الخامس والعشرين.
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
/** يومٌ بصيغة YYYY-MM-DD بتوقيت UTC — نفس ما تحفظه حقول التواريخ النصّية. */
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const show = (v) => (v === '' || v === null || v === undefined ? '—' : (v instanceof Date ? iso(v) : String(v)));

/**
 * مفتاح المطابقة: أرقامٌ لاتينية متلاصقة.
 * وبغيره يصير الموظّف الواحد اثنين — انظر رأس الملف.
 */
const idKey = (v) => AR_DIGITS(S(v)).replace(/[\s\-_ـ]/g, '');

const filled = (v) => !(v === '' || v === null || v === undefined
  || (v instanceof Date && Number.isNaN(v.getTime())));

/**
 * سببُ غياب القيمة، أو '' إن كانت الخانة تحمل قيمةً حقيقية.
 *
 * الصفر معاملَتُه معاملةَ الفراغ عن قصد: إكسل يكتبه مكان الخانة الخالية في
 * أعمدةٍ رقميّة كثيرة هنا (العنوان الوطنيّ، المدير المباشر، رقم السجلّ…)،
 * ونقلُه كما هو كان يجعل «٠» عنوانًا وطنيًّا لمئةٍ واثنين وثلاثين موظّفًا
 * وخيارًا في فلتر العناوين.
 */
const sentinel = (raw) => {
  const t = S(raw).replace(/ـ/g, '');
  if (t === '' || t === '0' || t === '-' || t === '—' || t === '_') return 'required';
  if (/^غير\s*مطلوب$/.test(t)) return 'not_required';
  if (/^مطلوب$/.test(t)) return 'required';
  if (/^لا\s*يوجد$/.test(t)) return 'none';
  return '';
};

// ═══════════════════════════════════════════════════════════════════════════
//  خريطة الأعمدة — كلُّ عمودٍ في كلّ ملفّ، وأين يذهب
// ═══════════════════════════════════════════════════════════════════════════
//
// `status:false` تعني عمودًا لا مكانَ فيه لـ«مطلوب/غير مطلوب»: عمود «النوع»
// قيمتُه صفرٌ أو «فري لانسر»، والصفر فيه **جوابٌ صريح** («ليس عملًا حرًّا») لا
// خانةٌ فارغة. ولو عُومل كالفراغ لصار ثلاثةَ عشرَ وثلاثمئة موظّفٍ «ينقصهم نوع».
const SHEETS = [
  {
    file: 'ارقام ابشر موظفين.xlsx',
    cols: [{ header: 'رقم ابشر', field: 'absherNumber', kind: 'phone' }],
  },
  {
    file: 'الارقام الوظيفية للموظفين.xlsx',
    cols: [{ header: 'الرقم الوظيفي', field: 'employeeNumber', kind: 'digits' }],
  },
  {
    file: 'الاقامة والمهنة للموظفين.xlsx',
    cols: [
      { header: 'تاريخ انتهاء الاقامه', field: 'iqamaExpiry', kind: 'date' },
      { header: 'المهنه في الاقامه', field: 'iqamaProfession', kind: 'text' },
    ],
  },
  {
    file: 'الجنسيات للموظفين.xlsx',
    cols: [{ header: 'الجنسيه', field: 'nationality', kind: 'text' }],
  },
  {
    file: 'السجل للموظفين.xlsx',
    cols: [{ header: 'رقم السجل', field: 'registerNumber', kind: 'digits' }],
  },
  {
    file: 'العنوان الوطني للموظفين.xlsx',
    cols: [{ header: 'العنوان الوطني', field: 'address', kind: 'text' }],
  },
  {
    file: 'القسم والمسمى الوظيفي للموظفين.xlsx',
    cols: [
      { header: 'القسم', field: 'department', kind: 'text' },
      { header: 'الفرع', field: 'branchName', kind: 'text' },
      { header: 'المدير المباشر', field: 'directManagerName', kind: 'text' },
      { header: 'المسمى الوظيفي', field: 'jobTitle', kind: 'text' },
      // «النوع» عمودٌ منطقيّ لا نصّيّ — انظر التعليق فوق.
      { header: 'النوع', field: 'isFreelancer', kind: 'freelancer', status: false },
    ],
  },
  {
    file: 'ايميلات الموظفين.xlsx',
    cols: [{ header: 'الايميل', field: 'email', kind: 'email' }],
  },
  {
    file: 'جنس الموظفين.xlsx',
    cols: [{ header: 'الجنس', field: 'gender', kind: 'gender' }],
  },
  {
    file: 'جواز السفر للموظفين.xlsx',
    cols: [
      { header: 'رقم جواز السفر', field: 'passportNumber', kind: 'text' },
      { header: 'تاريخ الانتهاء', field: 'passportExpiry', kind: 'date' },
    ],
  },
  {
    file: 'حالة العمل للموظفين.xlsx',
    cols: [{ header: 'حاله العمل', field: 'workStatusText', kind: 'text' }],
  },
  {
    file: 'رخص عمل الموظفين.xlsx',
    cols: [{ header: 'تاريخ انتهاء رخصة العمل', field: 'workPermitExpiry', kind: 'date' }],
  },
  {
    // العقود: صفٌّ لكلّ عقد. أعمدتُه تُقرأ هنا لقطةً على الموظّف، وتُقرأ مرّةً
    // ثانيةً في القسم ③ لتصير وثيقةَ عقدٍ قائمةً بذاتها.
    file: 'ملف عقود الموظفين.xlsx',
    contracts: true,
    cols: [
      { header: 'المهنة في العقد', field: 'contractOccupation', kind: 'text' },
      { header: 'تاريخ بداية العقد', field: 'contractStartDate', kind: 'date' },
      { header: 'تاريخ نهاية العقد', field: 'contractEndDate', kind: 'date' },
      { header: 'الاجازه السنوية', field: 'annualLeaveDays', kind: 'digits' },
      { header: 'فترة التجربة', field: 'probationPeriod', kind: 'text' },
      // عمودُ السجلّ هنا يُقرأ للمقارنة والسدّ، لا ليكون المرجع — انظر ما تحت قراءة الملفّات.
      { header: 'السجل', field: 'registerNumber', kind: 'digits', fallbackOnly: true },
    ],
  },
];

/** حالة التوظيف من نصّ «حاله العمل» — تُقرأ للمُنشَأ حديثًا وحده. */
const employmentFromText = (t) => {
  const s = S(t);
  if (!s) return 'active';
  if (/^اجازة$/.test(s)) return 'on_leave';
  if (/خروج نهائي|استقالة|لا يعمل|نقل الكفالة|انهاء العقد|تغيب/.test(s)) return 'terminated';
  return 'active';
};

/** قيمة الخانة بحسب نوع عمودها. */
function readCell(kind, raw) {
  switch (kind) {
    case 'date': {
      const d = D(raw);
      return d ? iso(d) : null;
    }
    case 'digits': {
      const t = AR_DIGITS(S(raw)).replace(/[\s,]/g, '');
      return /^\d+$/.test(t) ? t : (t || null);
    }
    case 'phone': {
      // إكسل يقرأ «٠٥٩٥٠٠١٠٦١» عددًا فيبتلع صفرَه الأول. ونقلُه كما عاد يغيّر
      // كلَّ جوّالٍ في النظام إلى تسع خاناتٍ لا يتّصل بها أحد.
      const t = AR_DIGITS(S(raw)).replace(/[\s+\-()]/g, '');
      if (/^5\d{8}$/.test(t)) return `0${t}`;
      return t || null;
    }
    case 'email': {
      const t = S(raw).toLowerCase();
      return /@/.test(t) ? t : null;
    }
    case 'gender': {
      // مخزون القاعدة `male`/`female` (enum في الموديل)، والشيت يكتبها عربيّة.
      // الترجمة هنا لا هناك: تغييرُ الـenum يكسر كلّ ما كُتب قبله.
      const t = S(raw);
      if (/^(ذكر|male|m)$/i.test(t)) return 'male';
      if (/^(انثى|أنثى|female|f)$/i.test(t)) return 'female';
      return null;
    }
    case 'freelancer':
      return /فري\s*لانسر|freelanc/i.test(S(raw));
    default:
      return S(raw) || null;
  }
}

// ── قراءة ملفّ ───────────────────────────────────────────────────────────────
/**
 * صفوفُ ملفٍّ مع صفّ عناوينه.
 *
 * صفُّ العناوين ليس الأوّل دائمًا: ملفّ العقود صفُّه الأوّل عدّاداتٌ كتبها
 * الملفّ لنفسه («٤٦» مكرَّرة) وعناوينُه في الثاني. فيُبحث عن الصفّ الذي فيه
 * «الهوية» بدل أن يُفترَض موضعُه — والافتراض هنا يقرأ العدّادات عناوينَ فلا
 * يُطابَق عمودٌ واحد.
 */
function readSheet(file) {
  const full = path.join(DIR, file);
  if (!fs.existsSync(full)) return { missing: true, head: [], body: [], headerRow: 0 };
  const wb = XLSX.readFile(full);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  let hi = 0;
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    if ((rows[i] || []).some((c) => /الهوية/.test(S(c)))) { hi = i; break; }
  }
  const head = (rows[hi] || []).map(S);
  const body = [];
  rows.slice(hi + 1).forEach((r, i) => {
    // الصفوف الفارغة تمامًا ليست صفوفًا: ملفّ العقود مساحتُه ٩٢٩ صفًّا وفيه
    // ٢٦٩ عقدًا فقط، والباقي فراغُ ورقةٍ ممتدّة. عدُّها صفوفًا ناقصةً يملأ
    // التقرير بستّمئةٍ وستّين «صفًّا بلا هوية» لا وجودَ لها.
    if (!r || !r.some((c) => c !== null && c !== '')) return;
    body.push({ row: r, sheetRow: hi + i + 2 });
  });
  return { missing: false, head, body, headerRow: hi + 1 };
}

(async () => {
  const missingFiles = SHEETS.filter((s) => !fs.existsSync(path.join(DIR, s.file)));
  if (missingFiles.length) {
    console.error(`ملفات غير موجودة في ${DIR}:\n  ${missingFiles.map((s) => s.file).join('\n  ')}`);
    process.exit(1);
  }

  // ── لقطة الملفّات ──────────────────────────────────────────────────────────
  // لا عمودَ «أيام متبقّية» في هذه الملفّات يُستخرج منه يومُ كتابتها كما في
  // ملفّ المركبات، فيُؤخَذ أحدثُ تعديلٍ على الملفّات نفسها. وعليه يُقاس «هل
  // جدَّد موظّفٌ مستندًا بعد لقطة الملفّ؟».
  const SNAPSHOT = new Date(Math.max(...SHEETS.map((s) => +fs.statSync(path.join(DIR, s.file)).mtime)));

  const skipped = [];   // صفوفٌ لم تُقرأ، ولماذا
  const notes = [];     // ملاحظاتٌ على البيانات نفسها
  const kept = [];      // ما تُرك لأنّ إنسانًا كتبه بعد الملفّ
  const sheetStats = [];

  // ════════════════════════════════════════════════════════════════════════
  //  ① قراءة الملفّات الثلاثة عشر إلى خطّةٍ واحدة على مفتاح الهوية
  // ════════════════════════════════════════════════════════════════════════
  /** key → { key, names:Set, fields:{}, statuses:{}, fallback:{}, sources:Set } */
  const plan = new Map();
  const of = (key) => {
    if (!plan.has(key)) plan.set(key, { key, names: new Set(), fields: {}, statuses: {}, fallback: {}, sources: new Set() });
    return plan.get(key);
  };
  const contractRows = [];

  for (const spec of SHEETS) {
    const { head, body, headerRow } = readSheet(spec.file);
    const idIdx = head.findIndex((h) => /الهوية/.test(h));
    const nameIdx = head.findIndex((h) => /^الاسم/.test(h));
    if (idIdx < 0) { skipped.push(`${spec.file}: لا عمود «رقم الهوية» — لا مفتاح لصفوفه`); continue; }

    const idx = {};
    for (const c of spec.cols) {
      const i = head.indexOf(c.header);
      if (i < 0) { skipped.push(`${spec.file}: العمود «${c.header}» غير موجود`); continue; }
      idx[c.header] = i;
    }

    const seen = new Map();
    let rowsRead = 0; let dup = 0;
    for (const { row, sheetRow } of body) {
      const key = idKey(row[idIdx]);
      if (!key) {
        const junk = row.map(S).filter(Boolean).join(' | ').slice(0, 60);
        skipped.push(`${spec.file} صف ${sheetRow}: بلا رقم هوية${junk ? ` (${junk})` : ''}`);
        continue;
      }
      const p = of(key);
      p.sources.add(spec.file);
      const nm = nameIdx >= 0 ? S(row[nameIdx]) : '';
      if (nm) p.names.add(nm);
      rowsRead++;

      if (spec.contracts) {
        // ملفّ العقود يقبل أكثر من صفٍّ للشخص الواحد — هو تاريخُ عقودٍ لا صفٌّ
        // لكلّ موظّف. لا تُرفَض التكرارات هنا؛ يُرفَض تكرارُ العقد نفسه في ③.
        contractRows.push({ key, sheetRow, row, idx, head });
      } else if (seen.has(key)) {
        dup++;
        skipped.push(`${spec.file} صف ${sheetRow}: الهوية «${key}» مكرّرة (الصف ${seen.get(key)}) — الأولى هي المعتمدة`);
        continue;
      }
      if (!spec.contracts) seen.set(key, sheetRow);

      // ── لقطةُ العقد على الموظّف تُؤخذ من أحدث عقدٍ بدايةً ────────────────────
      // ترتيبُ الصفوف في الورقة ليس ترتيبًا زمنيًّا، فـ«آخرُ صفٍّ يفوز» يضع على
      // الموظّف عقدًا قديمًا انتهى ويُخفي السارِيَ — فتقرأ الشاشةُ عقدًا منتهيًا
      // لمن عقدُه سارٍ. والوثائق كلُّها تُسجَّل على أيّ حال في القسم ③.
      if (spec.contracts) {
        const si = idx['تاريخ بداية العقد'];
        const st = si === undefined ? null : D(row[si]);
        const stamp = st ? +st : -1;
        if (p.contractStamp !== undefined && stamp <= p.contractStamp) continue;
        p.contractStamp = stamp;
      }

      for (const c of spec.cols) {
        if (idx[c.header] === undefined) continue;
        const raw = row[idx[c.header]];
        const code = c.status === false ? '' : sentinel(raw);
        const value = code ? null : readCell(c.kind, raw);
        // خانةٌ ليست سببَ غيابٍ ولا تُقرأ قيمةً: تاريخٌ لا يُقرأ، بريدٌ بلا @،
        // جنسٌ بكلمةٍ غير معروفة. تُعلَن ولا تُخترَع لها قيمة.
        if (!code && value === null) {
          skipped.push(`${spec.file} صف ${sheetRow} · ${c.header}: «${S(raw)}» لا تُقرأ ${c.kind} — تُرِكت`);
          continue;
        }
        const bucket = c.fallbackOnly ? p.fallback : p.fields;
        if (code) { if (!c.fallbackOnly) p.statuses[c.field] = code; continue; }
        // صفوفُ العقود مُنِعت فوق إلا أحدثَها بدايةً، فما يصل هنا منها هو
        // العقد الحاليّ لا آخرُ صفٍّ في الورقة.
        bucket[c.field] = value;
      }
    }
    sheetStats.push({ file: spec.file, headerRow, rows: rowsRead, dup, ids: spec.contracts ? new Set(contractRows.map((r) => r.key)).size : seen.size });
  }

  // ── السجلّ التجاريّ: المرجع ملفّه، والعقود تسدّ فراغه ──────────────────────
  // الملفّان في الحزمة نفسها ويقولان الشيء نفسه، لكنّ ملفّ السجلّ يترك خمسةً
  // وخمسين خانةً فارغة ويحمل ملفُّ العقود لبعضها رقمًا. تركُها «مطلوبةً» ونحن
  // نملك جوابها في الحزمة ذاتها يضع أسماءً في قائمة عملٍ لا عملَ فيها. المرجع
  // يبقى ملفَّ السجلّ حين ينطق، والخلافُ يُطبَع ولا يُبتلَع.
  let regFilled = 0; const regConflict = [];
  for (const p of plan.values()) {
    const fb = p.fallback.registerNumber;
    if (!fb) continue;
    if (!filled(p.fields.registerNumber)) {
      p.fields.registerNumber = fb;
      delete p.statuses.registerNumber;
      regFilled++;
    } else if (p.fields.registerNumber !== fb) {
      regConflict.push(`${p.key}: «السجل» ${p.fields.registerNumber} · «ملف عقود» ${fb} — اعتُمد الأول`);
    }
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const Employee = require('../models/Employee');
  const Contract = require('../models/Contract');
  const EmployeeRenewal = require('../models/EmployeeRenewal');

  console.log(`المصدر: ${path.basename(DIR)} — ${SHEETS.length} ملفًّا`);
  console.log(`لقطة الملفّات: ${iso(SNAPSHOT)}`);
  console.log(DRY ? '\n═══ تجربة — لن يُكتب شيء ═══\n' : '\n═══ تنفيذ ═══\n');

  console.log('الملفّات المقروءة:');
  for (const s of sheetStats) {
    console.log(`   ${s.file.padEnd(38, '·')} عناوينه في الصف ${s.headerRow} · ${s.rows} صفًّا · ${s.ids} هوية${s.dup ? ` · ${s.dup} مكرّرة` : ''}`);
  }
  console.log(`   الإجمالي: ${plan.size} هوية مميّزة\n`);

  // ════════════════════════════════════════════════════════════════════════
  //  ② المطابقة بقاعدة البيانات
  // ════════════════════════════════════════════════════════════════════════
  const all = await Employee.find({}).lean();
  const byIqama = new Map();
  for (const e of all) {
    const k = idKey(e.iqamaNumber);
    // الأول يفوز: سجلٌّ مكرَّرُ الهوية موجودٌ في القاعدة، والكتابةُ في الثاني
    // تجعل الشاشةَ تعرض الأول بلا تحديث فيبدو الاستيراد وكأنه لم يعمل.
    if (k && !byIqama.has(k)) byIqama.set(k, e);
  }

  // نوعُ كلّ حقلٍ يُقرأ من المخطَّط نفسه لا من قائمةٍ مكتوبة باليد: بعضُ تواريخ
  // هذا الموديل نصوصٌ (iqamaExpiry) وبعضُها تواريخٌ حقيقية (healthCertExpiry)،
  // وكتابةُ Date في مسارٍ نصّيّ تُخزِّن «Fri Oct 16 2026 …» فلا يقرؤها فلتر.
  const instanceOf = (k) => (Employee.schema.path(k) || {}).instance || 'String';
  const coerce = (k, v) => {
    if (v === null || v === undefined) return v;
    switch (instanceOf(k)) {
      case 'Date': return v instanceof Date ? v : (D(v) || null);
      case 'Number': { const n = N(v); return n === null ? undefined : n; }
      case 'Boolean': return v === true || v === 'true' || v === 1 || v === '1';
      default: return v instanceof Date ? iso(v) : String(v);
    }
  };

  /**
   * ختمُ «آخر استيراد» — يُكتب **بعد** الحفظ وبكتابةٍ لا تحرّك `updatedAt`.
   *
   * لو كُتب مع الحفظ لصار `updatedAt` أحدثَ منه بجزءٍ من الثانية (mongoose يضعه
   * في الحفظة نفسها)، فيُقرأ كلُّ سجلٍّ في التشغيل التالي «لمسه إنسان» فلا يُكتب
   * فيه شيءٌ أبدًا بعد اليوم — أي أنّ الاستيراد يشلّ نفسه من أوّل مرّة.
   */
  const stampImport = (id) => Employee.updateOne(
    { _id: id }, { $set: { lastImportAt: new Date() } }, { timestamps: false });

  // تجديداتٌ سجّلها موظّفٌ بعد لقطة الملفّ — أحدثُ من الورق فتسبقه.
  const DOC_OF_FIELD = {
    iqamaExpiry: 'iqama', passportExpiry: 'passport',
    workPermitExpiry: 'workPermit', contractEndDate: 'contract',
  };
  const freshRenewals = new Map();  // `${empId}:${docType}` → renewal
  for (const r of await EmployeeRenewal.find({ renewedAt: { $gt: SNAPSHOT } }).sort({ renewedAt: 1 }).lean()) {
    freshRenewals.set(`${r.employee}:${r.docType}`, r);
  }

  const sum = {
    employeesCreated: 0, employeesUpdated: 0, employeesUnchanged: 0,
    valuesWritten: 0, statusRequired: 0, statusNotRequired: 0, statusCleared: 0,
    keptUserRenewals: 0, keptUserFields: 0, keptOverSentinel: 0,
    namesDiffer: 0,
    contractsCreated: 0, contractsUpdated: 0, contractsUnchanged: 0, contractsSkipped: 0,
    contractsRetired: 0,
  };
  const created = [];
  const workStatusDrift = [];
  const empByKey = new Map();   // key → مستند الموظّف بعد الحفظ (يحتاجه القسم ③)

  for (const p of [...plan.values()]) {
    const name = [...p.names][0] || '';
    let emp = byIqama.get(p.key);
    const isNew = !emp;

    if (isNew) {
      // الاسم يُشَقّ: أوّلُ كلمةٍ اسمٌ أوّل والباقي اسمٌ أخير — والموديل يشترط
      // الاثنين. واسمٌ من كلمةٍ واحدة يأخذ الكلمة نفسها في الطرفين حتى لا
      // يسقط الصفّ كلّه على حقلٍ لا يقرؤه أحد.
      const parts = name.split(' ').filter(Boolean);
      if (!name) { skipped.push(`الهوية ${p.key}: جديدة وبلا اسمٍ في أيّ ملف — لم تُنشَأ`); continue; }
      const doc = {
        iqamaNumber: p.key,
        arabicName: name,
        firstName: parts[0],
        lastName: parts.slice(1).join(' ') || parts[0],
        // الهويّة السعودية تبدأ بـ١ والإقامة بـ٢ — قاعدةٌ حكوميّة تنطبق على
        // الـ٣٦٠ كلّها هنا بلا شذوذ. وبغيرها يظهر السعوديّ «ناقصَ إقامة».
        idType: /^1/.test(p.key) ? 'national_id' : 'iqama',
        isHrRecord: true,
        inCurrentMaster: true,
        // حالةُ التوظيف تُقرأ عند الإنشاء وحده — انظر رأس الملف.
        employmentStatus: employmentFromText(p.fields.workStatusText),
      };
      created.push({ key: p.key, name, status: doc.employmentStatus, work: p.fields.workStatusText || '—' });
      if (DRY) {
        sum.employeesCreated++;
        // معرّفٌ وهميّ في التجربة، وإلا بدا كلُّ عقدٍ لموظّفٍ جديد «صفًّا بلا
        // موظّف» فكانت خطّةُ العقود تُخفي ما ستفعله فعلًا عند التنفيذ.
        empByKey.set(p.key, { _id: new mongoose.Types.ObjectId(), __dry: true });
      } else {
        emp = new Employee(doc);
        for (const [k, v] of Object.entries(p.fields)) {
          if (!Employee.schema.path(k)) continue;
          const cv = coerce(k, v);
          if (cv !== undefined) { emp.set(k, cv); sum.valuesWritten++; }
        }
        for (const [k, code] of Object.entries(p.statuses)) {
          if (!H.getField(k)) continue;
          emp.fieldStatus.set(H.statusKeyOf(k), code);
          if (code === 'required') sum.statusRequired++; else if (code === 'not_required') sum.statusNotRequired++;
        }
        await emp.save();
        await stampImport(emp._id);
        sum.employeesCreated++;
        empByKey.set(p.key, emp);
      }
      continue;
    }

    // ── موظّفٌ قائم ──────────────────────────────────────────────────────────
    const doc = DRY ? null : await Employee.findById(emp._id);
    const current = emp;                              // لقطةٌ قبل الكتابة
    const touched = current.lastImportAt
      ? new Date(current.updatedAt) > new Date(current.lastImportAt)
      : false;
    let changed = false;

    // ── العضويّة في الملفّ الوظيفيّ الحاليّ ──────────────────────────────────
    // وجودُ الاسم في هذه الملفّات **هو** تعريفُ «في الماستر الحاليّ»، وعليه يقوم
    // النطاقُ الافتراضيّ لكلّ شاشةٍ في القسم. فمَن كان خارجَه وعاد فيه يبقى
    // مخفيًّا عن كلّ عدّادٍ وقائمة حتى يُرفَع الفلتر — وهو موجودٌ يعمل.
    if (!current.inCurrentMaster) {
      if (!DRY) doc.set('inCurrentMaster', true);
      changed = true;
      notes.push(`${p.key} · ${name}: كان خارج الماستر الحاليّ وهو في الملفّات — أُعيد إليه`);
    }

    // ── الاسم يُقارَن ولا يُكتَب ────────────────────────────────────────────
    // عمود «الاسم» في هذه الملفّات وسيلةُ تعرُّفٍ على الصفّ لا موضوعَه — موضوعُ
    // كلِّ ملفٍّ عمودُه الأخير. والأسماء العربية تُكتب بأكثر من رسم («عبدالرحمن»
    // و«عبد الرحمن»)، فالكتابةُ فوقها تقلب مئات الأسماء ذهابًا وإيابًا مع كلّ
    // تسليمٍ بلا أن يطلب ذلك أحد. الخلافُ يُطبَع ليُصحَّح حيث يجب.
    if (name && S(current.arabicName) && S(current.arabicName) !== name) {
      sum.namesDiffer++;
      notes.push(`اسمٌ مختلف — ${p.key}: الملفّ «${name}» · وعندنا «${S(current.arabicName)}» (لم يُغيَّر)`);
    }

    // «حاله العمل» تُكتب نصًّا ولا تحرّك enum التوظيف — يُطبَع الخلاف ليُقرَّر.
    const wantEmployment = employmentFromText(p.fields.workStatusText);
    if (p.fields.workStatusText && wantEmployment !== current.employmentStatus) {
      workStatusDrift.push(`${p.key} · ${name}: الشيت «${p.fields.workStatusText}» (${wantEmployment}) · وعندنا ${current.employmentStatus}`);
    }

    for (const [k, v] of Object.entries(p.fields)) {
      if (!Employee.schema.path(k)) { notes.push(`الحقل «${k}» ليس في موديل الموظّف — لم يُكتب`); continue; }
      const before = current[k];
      const cv = coerce(k, v);
      if (cv === undefined) continue;

      // (أ) تجديدٌ سجّله موظّفٌ بعد لقطة الملفّ يسبق الورق.
      const docType = DOC_OF_FIELD[k];
      const ren = docType ? freshRenewals.get(`${current._id}:${docType}`) : null;
      if (ren) {
        kept.push(`${p.key} · ${name} · ${k}: الملفّ ${show(cv)} · جُدِّد إلى ${show(ren.newExpiry)} بعد اللقطة`);
        sum.keptUserRenewals++;
        continue;
      }
      if (String(before ?? '') === String(cv ?? '')) continue;

      // (ب) سجلٌّ لمسه إنسانٌ بعد آخر استيراد: الشيت يملأ الفارغ ولا يكتب فوق
      //    المكتوب. لقطةُ ورقٍ أُخذت قبل أن يفتح الموظّف الشاشة ليست أحدثَ ممّا
      //    كتبه وهو ينظر إلى الشخص. وما يُترك يُطبَع باسمه وقيمتيه ليُقرَّر فيه.
      if (touched && filled(before)) {
        kept.push(`${p.key} · ${name} · ${k}: الملفّ «${show(cv)}» · وكتب موظّفٌ «${show(before)}» بعد آخر استيراد — بقيت`);
        sum.keptUserFields++;
        continue;
      }
      if (!DRY) doc.set(k, cv);
      changed = true; sum.valuesWritten++;
    }

    // (ج) والحالةُ لا تمحو قيمةً — تُكتب بجانبها.
    for (const [k, code] of Object.entries(p.statuses)) {
      if (!H.getField(k)) continue;
      if (filled(current[k])) {
        // خانةٌ بلا قيمةٍ في الشيت وعندنا قيمة: تبقى قيمتنا. و`statusOf` تُرجّح
        // القيمة على عَلَم «مطلوب»، وتُبقي «غير مطلوب» قرارًا إداريًّا فوقها.
        kept.push(`${p.key} · ${name} · ${k}: الشيت «${H.statusLabel(code)}» · وعندنا «${show(current[k])}» — بقيت`);
        sum.keptOverSentinel++;
        // ولا يُكتب «مطلوب» فوق حقلٍ مملوء: `pre-save` في الموديل يمسحه في
        // اللحظة نفسها (وهو محقّ — الحقل ليس ناقصًا)، فكتابتُه تجعل كلّ تشغيلٍ
        // يكتب ويُمسح فلا يستقرّ الاستيراد على حالٍ ولا يصير تكرارُه بلا أثر.
        // أمّا «غير مطلوب» فقرارٌ إداريّ يبقى فوق القيمة، فتُكتب.
        if (code === 'required') continue;
      }
      if (String(current.fieldStatus?.[H.statusKeyOf(k)] ?? '') === code) continue;
      if (!DRY) doc.fieldStatus.set(H.statusKeyOf(k), code);
      changed = true;
      if (code === 'required') sum.statusRequired++; else if (code === 'not_required') sum.statusNotRequired++;
    }
    // (د) قيمةٌ حقيقية وصلت من الشيت تمحو أيَّ عَلَمِ حالةٍ قديم على حقلها.
    for (const k of Object.keys(p.fields)) {
      if (!H.getField(k)) continue;
      if (!(H.statusKeyOf(k) in (current.fieldStatus || {}))) continue;
      if (!DRY) doc.fieldStatus.delete(H.statusKeyOf(k));
      changed = true; sum.statusCleared++;
    }

    if (changed) {
      sum.employeesUpdated++;
      if (!DRY) { await doc.save(); await stampImport(doc._id); }
    } else sum.employeesUnchanged++;
    empByKey.set(p.key, DRY ? null : (doc || emp));
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ③ العقود — وثيقةٌ لكلّ صفّ، ومطابقةٌ لا تتضاعف بإعادة التشغيل
  // ════════════════════════════════════════════════════════════════════════
  //
  // ملفّ العقود مساحتُه ٩٢٩ صفًّا وفيه ٢٦٩ عقدًا حقيقيًّا لـ٢٦٩ شخصًا — أي أنّه
  // اليومَ عقدٌ واحدٌ لكلّ موظّف لا تاريخُ عقود. لكنّ النموذج يقبل التاريخ:
  // المفتاح الثابت هو **(الموظّف + تاريخ البداية)** لا رقمُ الصفّ، فلو أضافت
  // الموارد البشرية عقدًا ثانيًا لشخصٍ غدًا انضمّ إلى تاريخه ولم يَدُس على
  // سابقه. ولو اشتُقّ المفتاح من ترتيب الصفوف لتغيّرت المفاتيح كلّها بإدراج
  // صفٍّ واحد في المنتصف، فتُنشَأ مئتان وتسعةٌ وستّون عقدًا فوق القديمة.
  //
  // والراتبُ والبدلات لا يمسّها هذا الاستيراد أبدًا: الملفّ لا يحملها، وعقدٌ
  // قائمٌ في القاعدة فيه راتبٌ مكتوب أصدقُ من صفرٍ نخترعه.
  const today = iso(new Date());
  const byEmployeeContracts = new Map();
  for (const cr of contractRows) {
    const emp = empByKey.get(cr.key) || byIqama.get(cr.key);
    if (!emp) {
      skipped.push(`عقود صف ${cr.sheetRow}: الهوية «${cr.key}» بلا موظّف — لم يُسجَّل العقد`);
      sum.contractsSkipped++;
      continue;
    }
    const cell = (h) => (cr.idx[h] === undefined ? null : cr.row[cr.idx[h]]);
    const startD = sentinel(cell('تاريخ بداية العقد')) ? null : D(cell('تاريخ بداية العقد'));
    const endD = sentinel(cell('تاريخ نهاية العقد')) ? null : D(cell('تاريخ نهاية العقد'));
    if (!startD) {
      // بلا تاريخ بدايةٍ لا مفتاحَ ثابتًا للعقد ولا يقبله الموديل أصلًا — تُترك
      // لقطةُ العقد على الموظّف (القسم ①) ولا تُخترَع وثيقةٌ بتاريخٍ ملفَّق.
      skipped.push(`عقود صف ${cr.sheetRow} (${cr.key}): «${show(S(cell('تاريخ بداية العقد')))}» ليست تاريخ بداية — لا مفتاح للعقد`);
      sum.contractsSkipped++;
      continue;
    }
    const leave = N(cell('الاجازه السنوية'));
    const startDate = iso(startD);
    const endDate = endD ? iso(endD) : '';
    const doc = {
      employee: emp._id,
      type: endDate ? 'fixed' : 'unlimited',
      startDate,
      endDate,
      // المدّة محسوبةٌ من تاريخَي الملفّ نفسه لا مفترَضةً اثني عشر شهرًا.
      durationMonths: endD ? Math.max(1, Math.round((endD - startD) / DAY / 30.4375)) : 0,
      // الافتراضُ ٢١ هو افتراضُ الموديل نفسه، وهو حقلٌ إلزاميّ فيه.
      annualLeaveDays: leave === null ? 21 : leave,
      jobTitle: sentinel(cell('المهنة في العقد')) ? '' : S(cell('المهنة في العقد')),
    };
    if (!byEmployeeContracts.has(String(emp._id))) byEmployeeContracts.set(String(emp._id), []);
    byEmployeeContracts.get(String(emp._id)).push({ doc, sheetRow: cr.sheetRow, key: cr.key, endDate });

    const found = await Contract.findOne({ employee: emp._id, startDate });
    if (!found) {
      // «سارٍ» أو «منتهٍ» حقيقةٌ تقرؤها من التاريخ، لا قرارًا نتّخذه.
      const body = { ...doc, status: endDate && endDate < today ? 'expired' : 'active' };
      if (!DRY) await Contract.create(body);
      sum.contractsCreated++;
      continue;
    }
    const before = JSON.stringify(found.toObject());
    found.set(doc);
    // «مُنهًى» قرارُ إنسانٍ له إجراؤه (مخالصة، إرجاع عهدة) — لا يعيده تاريخُ
    // انتهاءٍ مكتوبٌ في ورقة، وإحياؤه يعيد إلى القوائم مَن خرج فعلًا.
    if (found.status !== 'terminated') found.status = endDate && endDate < today ? 'expired' : 'active';
    // المقارنة قبل/بعد هي ما يجعل إعادة التشغيل بلا أثر: بغيرها يُحفظ كلُّ عقدٍ
    // في كلّ مرّة فيتحرّك `updatedAt` لمئتين وتسعةٍ وستّين عقدًا بلا تغييرٍ فيها.
    if (before === JSON.stringify(found.toObject())) { sum.contractsUnchanged++; continue; }
    if (!DRY) await found.save();
    sum.contractsUpdated++;
  }

  // ── العقد الأحدث هو لقطةُ الموظّف، والأقدمُ المنتهي لا يبقى «ساريًا» ────────
  for (const [empId, list] of byEmployeeContracts) {
    const newest = list.slice().sort((a, b) => (a.doc.startDate < b.doc.startDate ? 1 : -1))[0];
    if (!newest) continue;
    // عقدٌ آخرُ في القاعدة مضى تاريخُ انتهائه ومازال مكتوبًا «ساريًا» ليس رأيًا
    // نغيّره بل خطأٌ يصحّحه التاريخ — والموديل ينصّ على عقدٍ ساري واحد للموظّف.
    const others = await Contract.find({ employee: empId, status: 'active', startDate: { $ne: newest.doc.startDate } }).lean();
    for (const o of others) {
      if (!o.endDate || o.endDate >= today) continue;
      if (!DRY) await Contract.updateOne({ _id: o._id }, { $set: { status: 'expired' } });
      notes.push(`عقدٌ سابق (${o.startDate} → ${o.endDate}) كان «ساريًا» وقد انتهى — صار «منتهيًا»`);
      sum.contractsRetired++;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ④ في القاعدة وليس في الملفّات — يُطبَع ولا يُمَسّ
  // ════════════════════════════════════════════════════════════════════════
  const sheetKeys = new Set(plan.keys());
  const dbOnly = all
    .filter((e) => e.isHrRecord !== false && !sheetKeys.has(idKey(e.iqamaNumber)))
    .map((e) => ({
      id: e.iqamaNumber || '—',
      name: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim() || '—',
      status: e.employmentStatus, master: !!e.inCurrentMaster,
    }));

  // ════════════════════════════════════════════════════════════════════════
  //  التقرير
  // ════════════════════════════════════════════════════════════════════════
  console.log('النتيجة:', JSON.stringify(sum, null, 1));

  if (created.length) {
    console.log(`\nموظّفون جدد — ليسوا في القاعدة (${created.length}):`);
    created.forEach((c) => console.log(`   ${c.key} · ${c.name} · حالة العمل «${c.work}» → ${c.status}`));
  }
  if (regFilled || regConflict.length) {
    console.log(`\nالسجلّ التجاريّ: ${regFilled} خانةً فارغةً في «ملف السجل» سدّها «ملف عقود الموظفين»`
      + `${regConflict.length ? ` · ${regConflict.length} خلافًا` : ''}`);
    regConflict.slice(0, 15).forEach((c) => console.log('   ' + c));
  }
  if (workStatusDrift.length) {
    console.log(`\n«حاله العمل» تخالف حالة التوظيف عندنا (${workStatusDrift.length}) — لم تُغيَّر، تُقرَّر على الشاشة:`);
    workStatusDrift.slice(0, 30).forEach((w) => console.log('   ' + w));
    if (workStatusDrift.length > 30) console.log(`   … و${workStatusDrift.length - 30} غيرها`);
  }
  if (kept.length) {
    console.log(`\nتُرك كما هو — أحدثُ من الملفّ أو أصدقُ منه (${kept.length}):`);
    kept.slice(0, 30).forEach((k) => console.log('   ' + k));
    if (kept.length > 30) console.log(`   … و${kept.length - 30} غيرها`);
  }
  if (skipped.length) {
    console.log(`\nصفوف/خانات لم تُقرأ (${skipped.length}) — ولماذا:`);
    skipped.slice(0, 40).forEach((s) => console.log('   ' + s));
    if (skipped.length > 40) console.log(`   … و${skipped.length - 40} غيرها`);
  }
  if (dbOnly.length) {
    console.log(`\nفي القاعدة وليسوا في الملفّات — ${dbOnly.length} موظّفًا · لن يُمَسّوا (لا حذف ولا تعطيل):`);
    dbOnly.forEach((e) => console.log(`   ${e.id} · ${e.name} · ${e.status}${e.master ? ' · في الماستر' : ''}`));
  }
  if (notes.length) {
    console.log(`\nملاحظات (${notes.length}):`);
    [...new Set(notes)].slice(0, 30).forEach((n) => console.log('   ' + n));
  }

  if (DRY) {
    console.log('\nلم يُكتب شيء. للتنفيذ:');
    console.log('   node src/scripts/importFinalHrData2026.js --yes');
  } else {
    console.log(`\nفي النظام الآن: ${await Employee.countDocuments({ isHrRecord: { $ne: false } })} موظّفًا`
      + ` · ${await Contract.countDocuments({})} عقدًا`);
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
