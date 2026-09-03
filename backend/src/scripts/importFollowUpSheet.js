/**
 * importFollowUpSheet — شيتُ المتابعة يُفرَّغ في الكشوف، لا بجانبها.
 *
 *   node --max-old-space-size=8192 src/scripts/importFollowUpSheet.js --dry
 *   node --max-old-space-size=8192 src/scripts/importFollowUpSheet.js
 *
 * المصدر: «operation files/اخر تحديث شيت المتابعه 2026.xlsx»، ورقةُ «2026» —
 * تسعةٌ وعشرون ألفَ صفٍّ بثلاثين عمودًا، فيها ما لم يصل نظامَنا قطّ: تواريخُ
 * التحصيل، وملاحظاتُ الفواتير، وصوافيها وضرائبها، وتواريخُ الإرسال والتسليم.
 *
 * ── والمطابقةُ برقم الكشف ─────────────────────────────────────────────────
 * رقمُ الكشف هو الهويّة: يُكتب في الشيت ويُكتب عندنا، ولا يتكرّر. فلا يُبتكر
 * صفٌّ من الشيت ولا يُنشأ كشفٌ لا وجودَ له في المنصّة — يُملأ الموجودُ ويُعَدّ
 * المفقود.
 *
 * ── ولا يُكتب فوق ما كُتب ─────────────────────────────────────────────────
 * القاعدةُ الوحيدةُ الآمنة: يُملأ الفارغُ فقط. ما في نظامنا كتبه موظّفٌ فيه بعد
 * أن صار النظامُ هو مكانَ العمل، والشيتُ صورةٌ من يوم ٣٠ أغسطس. فالجديدُ لا
 * يُدهَس بالقديم — ويُعَدّ الخلافُ ويُعرَض ليُنظر فيه، لا يُطبَّق بصمت.
 *
 * ── والتاريخُ يُقرأ رقمًا لا كائنًا ────────────────────────────────────────
 * إكسل يخزّن التاريخَ رقمًا: أيّامًا منذ ٣٠ ديسمبر ١٨٩٩. ومكتبةُ القراءة تحوّله
 * إلى كائنٍ **بتوقيت الجهاز**، ومبدؤها سنةَ ١٨٩٩ حيث الرياضُ على ٣:٠٠:٥٢ لا على
 * ٣:٠٠ — فيخرج «٨ يناير» ٢٠٢٦-٠١-٠٧T٢٠:٥٩:٠٨Z، ومَن قرأ يومَه بغرينتش وجده
 * السابعَ. يومٌ كاملٌ ضائعٌ في كلّ تاريخٍ في الملفّ.
 *
 * فيُقرأ الرقمُ نفسُه ويُحسب منه اليومُ بغرينتش مباشرةً: لا توقيتَ جهازٍ في
 * الطريق، فلا فرقَ بين مَن يشغّله في الرياض ومَن يشغّله في لندن.
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
// الملفُّ يُمرَّر: تصل نسخةٌ أحدث كلَّ بضعة أسابيع، وتثبيتُ اسمٍ في السكربت
// يعني تعديلَه في كلّ مرّة — أو استيرادَ نسخةٍ قديمةٍ ولا يُلاحَظ.
const FILE = process.argv.find((a) => a.endsWith('.xlsx'))
  || path.join(__dirname, '..', '..', '..', 'operation files', 'شيت المتابعه 2026 بتاريخ 3 سبتمبر 2026.xlsx');
const SHEET = '2026';
const HEADER_ROW = 4;

// العمودُ في الشيت ← الحقلُ عندنا. الترتيبُ ترتيبُ الشيت نفسِه.
const COLUMNS = [
  ['reportNumber', 'text'], ['reportDate', 'date'], ['fromLocation', 'text'], ['toLocation', 'text'],
  ['branch', 'text'], ['carOwner', 'text'], ['carNumber', 'text'], ['ownerType', 'text'],
  ['executionStatus', 'text'], ['applicationStatus', 'text'], ['paymentMethod', 'text'], ['username', 'text'],
  ['taxIndicator', 'text'], ['purchaseValue', 'num'], ['sellingValue', 'num'], ['operationsReview', 'text'],
  ['paymentDate', 'date'], ['payingBranch', 'text'], ['finalReportDestination', 'text'], ['documentNumber', 'text'],
  ['sendingDate', 'date'], ['deliveryDate', 'date'], ['accountingReview', 'text'], ['invoiceNumber', 'text'],
  ['netInvoice', 'num'], ['tax', 'num'], ['totalInvoice', 'num'], ['invoiceDate', 'date'],
  ['invoiceNotes', 'text'], ['collectionDate', 'date'],
];

// ── ما لا يُستورَد ─────────────────────────────────────────────────────────
// أعمدةُ المنصّة تُسحب منها حيّةً كلَّ دقيقة؛ ونسخةُ الشيت منها صورةٌ قديمة.
// فلو مُلئ فارغٌ منها من الشيت لصار الصفُّ نصفَه من المنصّة ونصفَه من ورقةٍ
// عمرُها شهر، ولا يُعرف بعدها أيُّهما يُقرأ.
const SKIP = new Set(['reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch',
  'carOwner', 'carNumber', 'ownerType', 'executionStatus', 'applicationStatus', 'paymentMethod', 'username']);

/** مبدأُ تأريخ إكسل — ٣٠ ديسمبر ١٨٩٩ بغرينتش. */
const XLS_EPOCH = Date.UTC(1899, 11, 30);
/** اليومُ كما كتبه إكسل، منتصفَ ليلِه بغرينتش، بلا مرورٍ بتوقيت الجهاز. */
const readDate = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 1) return null;
    const dt = new Date(XLS_EPOCH + Math.round(v * 86400000));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  }
  const s = String(v).trim();
  if (!s) return null;
  // «١٨/٠١/٢٠٢٦» و«1/1/26» — اليومُ أوّلًا كما تكتبه الورقة.
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m.map(Number);
    if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
};
const readNum = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) && n !== 0 ? n : null;
};
const readText = (v) => {
  if (v == null) return null;
  if (v instanceof Date) return null;               // تاريخٌ في خانةٍ نصّيّة — يُترك
  const s = typeof v === 'number' ? String(v) : String(v).trim();
  if (s === '') return null;
  // ── ولا يُنقَل النائبُ عن الفراغ من ورقةٍ إلى قاعدة ────────────────────
  // «no inv» في الورقة تعني «لا فاتورة»، لا أنّها قيمةٌ تُكتب. ولمّا صار
  // النائبُ يُقرأ فراغًا عندنا، كادت الورقةُ تكتبه فوق ألفٍ وتسعمئة كشفٍ
  // يحملونه أصلًا — كتابةٌ لا تغيّر شيئًا وتُحسب ألفًا وتسعمئة تعديل.
  return PLACEHOLDER.test(s) ? null : s;
};
const READ = { text: readText, num: readNum, date: readDate };

// ── والنائبُ عن الفراغ فراغ ───────────────────────────────────────────────
// «no inv» و«بدون» و«—» ليست أرقامَ فواتير — هي طريقةُ الموظّف في قول «لا
// فاتورةَ لهذا الكشف». وكانت تُعَدّ قيمةً مكتوبةً فتمنع الشيتَ من كتابة الرقم
// الحقيقيّ فوقها: كشفان يحملان «no inv» والشيتُ يعرف لهما الفاتورة ١٠٩١٨.
//
// فالنائبُ عن الفراغ يُعامَل فراغًا: يُملأ ولا يُحسب خلافًا.
const PLACEHOLDER = /^\s*(?:no\s*inv(?:oice)?|noinv|no-inv|none|n\/a|na|-|—|بدون(?:\s*فاتورة)?|لا\s*يوجد|لا\s*توجد|غير\s*مفوتر(?:ة)?)\s*$/i;
const isEmpty = (v) => v == null || v === ''
  || (typeof v === 'string' && (v.trim() === '' || PLACEHOLDER.test(v)));

// ── «ض / غ ض» تُغذّي نوعَ الدفع، ولا تحكم عليه ─────────────────────────────
//
// عمودُ الشيت يقول عن الحمولة أضريبيّةٌ هي أم لا، وهو أفضلُ ما نملك لثلاثين
// ألفَ كشفٍ لا نوعَ دفعٍ لها عندنا أصلًا. لكنّه لا يحكم: «العميل ممكن في حمولات
// يقولنا هحاسبكوا عليها كاش وساعات ضريبي» — فالنوعُ قرارٌ يُتَّخذ على الكشف
// نفسِه ويُحفَظ تاريخُه معه.
//
// فالقاعدةُ هي قاعدةُ هذا الملفّ كلِّه: يُملأ الفارغُ ولا يُدهَس المكتوب. ما
// اختاره موظّفٌ في الشاشة يبقى، وما لم يُختَر بعدُ يأخذ جوابَ الورقة.
const readPaymentType = (v) => {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return null;
  if (/^(cash|كاش|نقد|غ\s*ض|غير\s*ضريب)/.test(s)) return 'cash';
  if (/^(tax|ضريب|ض)$|ضريب/.test(s)) return 'tax';
  return null;      // صياغةٌ لم نرَها — تُترك ولا تُخمَّن
};
const sameDay = (a, b) => a && b && new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const OW = require('../models/OperationsWorkflow');

  console.log(DRY ? '── تجربة، بلا كتابة ──\n' : '── تنفيذ ──\n');
  // `cellDates: false` — تبقى التواريخُ أرقامًا كما هي في الملفّ، فتُقرأ بغرينتش.
  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true });
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { header: 1, defval: null, blankrows: false, raw: true });
  const rows = raw.slice(HEADER_ROW + 1);
  console.log(`صفوفُ الورقة «${SHEET}»: ${rows.length}`);

  // ── الشيتُ يُقرأ أوّلًا، ويُطوى على رقم الكشف ────────────────────────────
  const bySheet = new Map();
  let noNumber = 0; let dupes = 0;
  for (const r of rows) {
    const no = readText(r[0]) || (r[0] != null ? String(r[0]).trim() : '');
    if (!no || !/^\d+$/.test(no)) { noNumber += 1; continue; }
    const vals = {};
    COLUMNS.forEach(([field, kind], i) => {
      if (SKIP.has(field)) return;
      const v = READ[kind](r[i]);
      if (v !== null) vals[field] = v;
      // ونوعُ الدفع يُشتقّ من العمود نفسِه، فيُملأ به ما لا نوعَ له عندنا.
      if (field === 'taxIndicator') {
        const pt = readPaymentType(r[i]);
        if (pt) vals.paymentType = pt;
      }
    });
    if (bySheet.has(no)) dupes += 1;
    bySheet.set(no, vals);               // الأحدثُ في الورقة يفوز
  }
  console.log(`  بلا رقم كشفٍ صالح: ${noNumber}`);
  console.log(`  أرقامٌ مكرّرة (يُؤخذ آخرُها): ${dupes}`);
  console.log(`  أرقامٌ فريدة: ${bySheet.size}\n`);

  // ── ثمّ كشوفُنا، على دفعات ─────────────────────────────────────────────
  // ثلاثون ألفَ رقمٍ في `$in` واحدة تقطع الاتّصالَ بالعنقود المشترك قبل أن
  // يردّ. فتُسأل على دفعاتٍ صغيرةٍ يمرّ كلٌّ منها على فهرس «رقم الكشف».
  const FIELDS = [...COLUMNS.map(([f]) => f).filter((f) => !SKIP.has(f)), 'paymentType'];
  const SELECT = ['reportNumber', ...FIELDS].join(' ');
  const keys = [...bySheet.keys()];
  const ours = [];
  for (let i = 0; i < keys.length; i += 1000) {
    const part = await OW.find({ reportNumber: { $in: keys.slice(i, i + 1000) } })
      .select(SELECT).lean();
    ours.push(...part);
    process.stdout.write(`\r  قُرئ ${Math.min(i + 1000, keys.length)}/${keys.length}…`);
  }
  console.log(`\nمنها في نظامنا: ${ours.length}`);
  console.log(`لا وجودَ لها عندنا (تُترك، لا تُنشأ): ${bySheet.size - ours.length}\n`);

  const filled = {}; const conflict = {}; const same = {};
  for (const f of FIELDS) { filled[f] = 0; conflict[f] = 0; same[f] = 0; }
  const ops = [];
  let rowsTouched = 0;

  for (const doc of ours) {
    const v = bySheet.get(doc.reportNumber);
    if (!v) continue;
    const patch = {};
    for (const f of FIELDS) {
      if (!(f in v)) continue;
      const mine = doc[f];
      if (isEmpty(mine) || mine === 0) { patch[f] = v[f]; filled[f] += 1; continue; }
      const equal = v[f] instanceof Date ? sameDay(mine, v[f]) : String(mine).trim() === String(v[f]).trim();
      if (equal) same[f] += 1; else conflict[f] += 1;
    }
    if (Object.keys(patch).length) {
      rowsTouched += 1;
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: patch } } });
    }
  }

  console.log('العمود                        يُملأ   مطابق   مختلف (يُترك)');
  console.log('─'.repeat(62));
  for (const f of FIELDS) {
    if (!filled[f] && !conflict[f] && !same[f]) continue;
    console.log(`  ${f.padEnd(26)} ${String(filled[f]).padStart(6)} ${String(same[f]).padStart(7)} ${String(conflict[f]).padStart(8)}`);
  }
  console.log('─'.repeat(62));
  console.log(`\nكشوفٌ ستتغيّر: ${rowsTouched}`);

  if (!DRY && ops.length) {
    let done = 0;
    for (let i = 0; i < ops.length; i += 500) {
      const r = await OW.bulkWrite(ops.slice(i, i + 500), { ordered: false });
      done += r.modifiedCount || 0;
      process.stdout.write(`\r  كُتب ${done}/${ops.length}…`);
    }
    console.log(`\n✓ عُدِّل ${done} كشفًا`);
  }

  const after = await OW.countDocuments({ collectionDate: { $ne: null } });
  console.log(`\nكشوفٌ لها تاريخُ تحصيلٍ الآن: ${after}`);
  const pt = await OW.aggregate([{ $group: { _id: '$paymentType', n: { $sum: 1 } } }, { $sort: { n: -1 } }]);
  console.log('نوعُ الدفع في السجلّ الآن:');
  for (const x of pt) console.log(`  ${String(x.n).padStart(6)}  ${x._id || '(بلا نوع)'}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
