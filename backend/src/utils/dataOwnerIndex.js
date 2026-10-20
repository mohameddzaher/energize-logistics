/**
 * «مسؤول البيانات» في سير عمل التشغيل — فلترُه على ما يُعرض لا على حقلٍ واحد.
 *
 * ── لماذا عمودٌ افتراضيّ ────────────────────────────────────────────────────
 * الخانةُ تُقرأ من ثلاثة مصادرَ بترتيب (راجع getWorkflows): من كتب تاريخَ
 * السداد عندنا (`paymentDateByName`)، فمن سجّل الشراءَ في المحفظة، وإلّا فمصدرُ
 * الاستيراد («منقول من منصّة الأوبريشن»). والحقلُ الأوّل مكتوبٌ في خمسمئةِ صفٍّ
 * من تسعةٍ وثلاثين ألفًا — فقائمةٌ تُبنى عليه وحدَه تعرض «(فارغ)» لثمانيةٍ
 * وثلاثين ألفًا كُتب في خاناتها اسمٌ أو «منقول»، ويختار المستخدمُ اسمًا يراه في
 * الجدول فلا يجده في القائمة.
 *
 * فالعمودُ `dataOwnerShown` يُفلتَر بالترتيب نفسِه: الاسمُ المكتوب، ثمّ مسجّلُ
 * المحفظة لكشفٍ بلا اسم، ثمّ مصدرُ الاستيراد لما بقي.
 *
 * ── ولماذا لقطةٌ في الذاكرة ─────────────────────────────────────────────────
 * مشترياتُ المحفظة بضعةُ آلافٍ لا أكثر، وشرطُ الفلترة يُبنى في دالّةٍ متزامنة
 * (`buildWorkflowFilter`) يقرؤها الجدولُ والإحصاءاتُ والتصدير. فتُحمَّل الخريطةُ
 * قبل الطلب (`ensure`) وتُقرأ في الشرط (`current`). ولكلّ عاملٍ لقطتُه، وعمرُها
 * ثلاثون ثانية — عمرُ قائمة القيم نفسِها تقريبًا.
 */
const { walletRecorderMap } = require('./walletPayment');
const { normKey, textMatcher, BLANK_VALUES } = require('./colFilter');

const MAX_AGE_MS = 30 * 1000;
const OPS_LABEL = 'منقول من منصّة الأوبريشن';

/** النصُّ المعروض لكشفٍ لا اسمَ عليه ولا مشترياتِ محفظة — بحسب مصدره. */
const importLabel = (externalSource) => {
  const ext = String(externalSource || '').trim();
  if (!ext) return '';
  return ext === 'ops_upl' ? OPS_LABEL : `مستورَد (${ext})`;
};

/** عكسُ `importLabel`: النصُّ ← المصدر، أو `null` إن لم يكن نصَّ استيراد. */
const sourceOfLabel = (label) => {
  if (label === OPS_LABEL) return 'ops_upl';
  const m = /^مستورَد \((.+)\)$/.exec(String(label || ''));
  return m ? m[1] : null;
};

let snap = null;          // { byName: Map<name, rn[]>, rns: string[] }
let at = 0;
let inflight = null;

async function load() {
  const WalletTransaction = require('../models/WalletTransaction');
  const raw = await WalletTransaction.distinct('purchaseDeliveryStatementNumber', { type: 'purchase' });
  // الخريطةُ نفسُها التي يقرؤها الجدول — فلا يختلف الفلترُ عن الخانة في اسمٍ واحد.
  const map = await walletRecorderMap(raw);
  const byName = new Map();
  for (const [rn, raw] of map) {
    const name = normKey(raw);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(rn);
  }
  return { byName, rns: [...map.keys()], map };
}

/** تُحمَّل اللقطةُ إن قدُمت. لا ترمي — الفشلُ يُبقي آخرَ لقطةٍ (أو لا شيء). */
async function ensure(maxAgeMs = MAX_AGE_MS) {
  if (snap && Date.now() - at < maxAgeMs) return snap;
  if (!inflight) {
    inflight = load()
      .then((s) => { snap = s; at = Date.now(); return s; })
      .catch((e) => { console.error('[dataOwnerIndex]', e.message); return snap; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

const current = () => snap || { byName: new Map(), rns: [], map: new Map() };

const BLANK_NAME = { paymentDateByName: { $in: BLANK_VALUES } };

/**
 * شرطُ الفلترة لقيمٍ اختارها المستخدم من قائمة «مسؤول البيانات».
 * القيمُ نصوصٌ كما تُعرض: اسمٌ، أو نصُّ استيراد، أو '' للفارغ.
 */
function ownerCondition(values) {
  const { byName, rns } = current();
  const names = []; const sources = []; let blank = false;
  for (const v of values) {
    if (!normKey(v)) { blank = true; continue; }
    const src = sourceOfLabel(v);
    if (src) sources.push(src); else names.push(v);
  }
  const or = [];
  if (names.length) {
    or.push({ paymentDateByName: { $in: names.map(textMatcher) } });
    const walletRns = names.flatMap((n) => byName.get(normKey(n)) || []);
    if (walletRns.length) or.push({ $and: [BLANK_NAME, { reportNumber: { $in: walletRns } }] });
  }
  if (sources.length || blank) {
    const ext = [...sources, ...(blank ? ['', null] : [])];
    or.push({ $and: [BLANK_NAME, { reportNumber: { $nin: rns } }, { externalSource: { $in: ext } }] });
  }
  // لا شيءَ يطابق القيمَ المختارة — شرطٌ لا يُرجع صفًّا، لا شرطٌ يُسقَط فيُرجع الكلّ.
  if (!or.length) return { _id: { $exists: false } };
  return or.length === 1 ? or[0] : { $or: or };
}

/**
 * قيمُ القائمة وعددُ كلٍّ — بالترتيب نفسِه الذي تُملأ به الخانة.
 * `match` هو شرطُ بقيّة الفلاتر (بلا فلتر هذا العمود).
 */
async function ownerOptions(OperationsWorkflow, match) {
  const { map, rns } = await ensure();
  const and = (...c) => ({ $and: [match, ...c] });
  const [named, wallet, imported] = await Promise.all([
    OperationsWorkflow.aggregate([
      { $match: and({ paymentDateByName: { $nin: BLANK_VALUES } }) },
      { $group: { _id: '$paymentDateByName', count: { $sum: 1 } } },
    ]),
    rns.length ? OperationsWorkflow.aggregate([
      { $match: and(BLANK_NAME, { reportNumber: { $in: rns } }) },
      { $group: { _id: '$reportNumber', count: { $sum: 1 } } },
    ]) : [],
    OperationsWorkflow.aggregate([
      { $match: and(BLANK_NAME, { reportNumber: { $nin: rns } }) },
      { $group: { _id: '$externalSource', count: { $sum: 1 } } },
    ]),
  ]);
  const counts = new Map();
  const add = (k, n) => counts.set(k, (counts.get(k) || 0) + n);
  for (const r of named) add(normKey(r._id), r.count);
  for (const r of wallet) add(normKey(map.get(String(r._id || '').trim())), r.count);
  for (const r of imported) add(importLabel(r._id), r.count);
  return [...counts.entries()].map(([value, count]) => ({ value, count }));
}

/**
 * وسيطٌ يُحمّل اللقطةَ قبل أيّ طلبٍ يحمل فلترَ هذا العمود — لأنّ الشرطَ يُبنى
 * متزامنًا في `buildWorkflowFilter` (الجدول والإحصاءات والتصدير والصفحة الخاصّة).
 */
const preload = (req, _res, next) => {
  if (req.query && req.query.cf_dataOwnerShown !== undefined) ensure().then(() => next(), () => next());
  else next();
};

module.exports = { ensure, current, ownerCondition, ownerOptions, importLabel, preload, OPS_LABEL };
