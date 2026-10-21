/**
 * نوعُ الدفع، ومتى يصل الكشفُ قسمَ التحصيل.
 *
 * ── نوعُ الدفع: أربعةُ مصادر، ترتيبُها هو القاعدة ────────────────────────────
 *
 *  ① اليد. موظّفٌ اختار النوعَ على الكشف من شاشة سير عمل التشغيل — لا يُغيَّر بعدها.
 *  ② رقمُ الفاتورة. متى كُتب فالكشفُ ضريبيٌّ قطعًا: كتابةُ الرقم هي إصدارُ
 *    الفاتورة نفسُه، ولا تُكتب لغير ضريبيّ.
 *  ③ طريقةُ الدفع من المنصّة. متى قالت `cash` صار الكشفُ نقديًّا ولو كان العميلُ
 *    ضريبيًّا — العميلُ الضريبيُّ يدفع حمولةً بعينها نقدًا، والمنصّةُ أخذت الطلبَ
 *    فتعرف.
 *  ④ صفةُ العميل من صفحة «أنواع الدفع». وهي الأصل والحالةُ العامّة.
 *
 * ── ولماذا ② فوق ③ ──────────────────────────────────────────────────────────
 * `payment_method` في المنصّة قيمتان: `cash` و`late` — شروطُ سدادٍ لا نوعُ
 * فاتورة. وفي البيانات: من أحدَ عشرَ ألفًا وستِّمئةٍ وأربعةٍ وخمسين كشفًا تقول
 * عنها `cash`، سبعُمئةٍ وتسعٌ وأربعون لها ضريبةٌ محسوبةٌ وستُّمئةٍ وخمسٌ وسبعون
 * محصَّلةٌ بفواتيرها — ويقع ذلك للعميل الواحد: أركتك ألفٌ وستُّمئةٍ وستٌّ وعشرون
 * كشفًا `cash`، منها ثمانيةٌ وخمسون بضريبةٍ وسبعةٌ وخمسون محصَّلة.
 *
 * فالفاتورةُ الصادرة تعلو طريقةَ الدفع: ورقةٌ خرجت للعميل بضريبةٍ لا ينقضها
 * حقلُ شروطِ سداد.
 *
 * ── والقاعدةُ تسري على الجديد وحدَه ─────────────────────────────────────────
 * `AUTO_RULE_FROM` — الكشوفُ السابقة لهذا التاريخ تبقى كما هي: صُنِّفت في شيت
 * المتابعة وفُوتِر أكثرُها وحُصِّل. وإعادةُ تصنيفها بقاعدةٍ جديدة تنقل فواتيرَ
 * صدرت وحُصِّلت من شاشةٍ إلى شاشة.
 */

/** أوّلُ الشهر الذي بدأت فيه القاعدةُ الجديدة. ما قبله يبقى على حاله. */
const AUTO_RULE_FROM = new Date('2026-09-01T00:00:00.000Z');

/** أهذا الكشفُ داخلٌ في القاعدة الجديدة؟ */
const underNewRule = (workflow = {}) => {
  const d = workflow.reportDate ? new Date(workflow.reportDate) : null;
  return !!d && !Number.isNaN(d.getTime()) && d >= AUTO_RULE_FROM;
};

/** هل تقول المنصّةُ إنّ هذه الحمولةَ نقديّة؟ */
const methodIsCash = (paymentMethod) => /^\s*cash\s*$/i.test(String(paymentMethod || ''));

/**
 * ── «الضريبيُّ لازم رقمُ فاتورة» ─────────────────────────────────────────────
 *
 * قرارُ صاحب الشركة (٢٠٢٦/١٠/٢٠): «عادي لو كاش يتكتب صافي فاتورة ويتحسب الفات،
 * لكن ملهاش رقم فاتورة. لكن الضريبي لازم رقم فاتورة».
 *
 * فالدليلُ على أنّ الكشفَ فُوتِر ضريبيًّا **رقمُ فاتورةٍ حقيقيّ وحدَه**. وكان
 * الصافي والضريبةُ دليلين أيضًا — والصافي يكتبه المسارُ النقديُّ نفسُه
 * (`deriveCashTotals`: مبلغُ السداد يُنسَخ إلى الصافي والإجماليّ)، فكان كلُّ كشفٍ
 * نقديٍّ يُكتب له مبلغُ سدادٍ ينقلب «ضريبيًّا» في أوّل مزامنة: ثلاثُمئةٍ وثمانيةٌ
 * وستّون كشفًا صافيها مبلغُ سدادها وضريبتُها صفر ولا رقمَ لها، كلُّها «ضريبي».
 */
// ── وما ليس رقمَ فاتورة ─────────────────────────────────────────────────────
// «no inv» و«بدون» وأخواتُها يكتبها الناسُ في الشيت (في القاعدة اليومَ «no inv»
// ألفٌ وستُّمئةٍ وأربعون مرّة). و**«0»** كان يكتبه القفلُ النقديُّ القديم. والقائمةُ
// هي نفسُها التي يقرؤها قسمُ التحصيل (كانت هناك نسخةٌ أوسع — راجع
// collectionsDeptController.NO_INVOICE_TOKENS)، فلا يكون رقمٌ «فاتورةً» هنا ولا يكونها هناك.
const NO_INVOICE_TOKENS = [
  '0', 'no inv', 'no invoice', 'noinv', 'no-inv', 'none', 'n/a', 'na', '-', '—', 'ىى',
  'بدون', 'بدون فاتورة', 'لا يوجد', 'لا توجد', 'غير مفوتر', 'غير مفوترة',
];
const tokenAlt = NO_INVOICE_TOKENS
  .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*'))
  .join('|');
/** نصٌّ لا يكون رقمَ فاتورة (بلا الفارغ). */
const NO_INVOICE_RX = new RegExp(`^\\s*(?:${tokenAlt})\\s*$`, 'i');
// الفارغُ والمسافاتُ والعناصرُ النائبة — «ليس رقمَ فاتورة».
const NOT_AN_INVOICE_RX = new RegExp(`^\\s*(?:${tokenAlt})?\\s*$`, 'i');

/** هل على هذا الكشف رقمُ فاتورةٍ حقيقيّ؟ — الدليلُ الوحيدُ على الضريبيّ. */
const hasTaxInvoice = (w = {}) => !NOT_AN_INVOICE_RX.test(String(w.invoiceNumber == null ? '' : w.invoiceNumber));
// الاسمُ الذي كتبه التوحيد — صار الشرطُ نفسَه، فهو هو.
const hasIssuedInvoice = hasTaxInvoice;
/** الشرطُ نفسُه استعلامًا (لـ`find`/`updateMany`). */
const ISSUED_INVOICE_QUERY = { invoiceNumber: { $ne: null, $not: NOT_AN_INVOICE_RX } };
/** والشرطُ نفسُه تعبيرًا (لـ`$group` و`$cond` وخطوط التحديث). */
const ISSUED_INVOICE_EXPR = {
  $not: [{ $regexMatch: { input: { $toString: { $ifNull: ['$invoiceNumber', ''] } }, regex: NOT_AN_INVOICE_RX } }],
};

/**
 * ── مَن يقرّر نوعَ الكشف، ومَن لا يُنقَض قرارُه ────────────────────────────
 *
 *  • `manual`  — اختارته يدٌ على هذا الكشف بعينه. لا يمسّه شيءٌ بعدها.
 *  • `unified` — وحّده أحدٌ على صفة عميله من صفحة «أنواع الدفع»، بعد أن رأى العدد.
 *    قرارٌ صريحٌ على العميل يعلو الاشتقاقَ (طريقةَ دفع المنصّة وصفةَ العميل)،
 *    ولا يعلو فاتورةً ضريبيّةً تصدر بعده (`hasIssuedInvoice`).
 *  • `auto`    — مشتقٌّ، ويُعاد اشتقاقُه في كلّ مزامنة.
 *
 * كان التوحيدُ يكتب `auto` — فتأتي المزامنةُ بعد دقيقةٍ فتشتقّ من جديد وتعيد
 * الكشوفَ إلى ما كانت عليه، ويعود عددُ «المخالف» كما كان.
 */
const isUnified = (w) => String(w?.paymentTypeSource || '') === 'unified';

/**
 * النوعُ المشتقُّ تلقائيًّا لكشفٍ بعينه.
 *
 * @param {object} workflow      الكشف — يُقرأ منه `paymentMethod` ودليلُ الفاتورة
 * @param {string} customerType  صفةُ العميل: 'cash' | 'tax' | ''
 * @returns {'cash'|'tax'|''}    و`''` تعني «لا يُعرَف» فلا يُكتب شيء
 */
const derivePaymentTypeFor = (workflow = {}, customerType) => {
  if (hasTaxInvoice(workflow)) return 'tax';
  // طريقةُ الدفع تنقض صفةَ العميل للكشوف الجديدة وحدَها — راجع AUTO_RULE_FROM.
  if (underNewRule(workflow) && methodIsCash(workflow.paymentMethod)) return 'cash';
  const t = String(customerType || '').trim().toLowerCase();
  return t === 'cash' || t === 'tax' ? t : '';
};

/** الصيغةُ القديمة بوسيطين — تُبقي نداءاتٍ قائمةً تعمل. */
const derivePaymentType = (paymentMethod, customerType) =>
  derivePaymentTypeFor({ paymentMethod }, customerType);

/**
 * أعلى مصدرٍ يقرّر هذا الكشف — يُقرأ في الشاشة لتفسير النوع.
 * 'manual' | 'invoice' | 'customer' | ''
 */
const paymentTypeReason = (workflow = {}, customerType) => {
  if (String(workflow.paymentTypeSource || '') === 'manual') return 'manual';
  if (isUnified(workflow)) return hasIssuedInvoice(workflow) ? 'invoice' : 'customer';
  if (hasTaxInvoice(workflow)) return 'invoice';
  const t = String(customerType || '').trim().toLowerCase();
  return t === 'cash' || t === 'tax' ? 'customer' : '';
};

/** أيُغيَّر هذا الكشفُ تلقائيًّا؟ لا، إن كان النوعُ مكتوبًا باليد. */
const mayAutoSet = (workflow) => String(workflow?.paymentTypeSource || '') !== 'manual';

/**
 * أوصلَ الكشفُ قسمَ التحصيل؟ ولماذا لا، إن لم يصل.
 *
 * ── الشرطُ تغيّر ─────────────────────────────────────────────────────────────
 * كان: تاريخُ سدادٍ ونوعُ دفعٍ فيمضي. وصار بابين لا غير:
 *
 *   • **رقمُ الفاتورة** → الفواتيرُ الضريبيّة، فورًا. كتابةُ الرقم هي إصدارُ
 *     الفاتورة، ولا تصل الشاشةَ الضريبيّةَ فاتورةٌ بلا رقم أبدًا.
 *   • **مراجعةُ التشغيل** مع نوعٍ نقديٍّ وتاريخِ سداد → فواتيرُ الكاش، فورًا.
 *     والنوعُ الضريبيُّ ينتظر رقمَه ولو روجع.
 *
 * ويسري على كشوف القاعدة الجديدة وحدَها: عمودُ المراجعة فارغٌ في تسعةٍ وعشرين
 * ألفًا وسبعِمئةٍ وخمسةَ عشرَ كشفًا سابقًا، فاشتراطُه عليها يُفرغ شاشةَ التحصيل
 * من كلّ ما تعمل عليه اليوم.
 */
const reachesCollections = (workflow = {}) => {
  if (hasTaxInvoice(workflow)) return { ok: true, screen: 'tax' };
  const type = String(workflow.paymentType || '');
  if (type !== 'cash') {
    return { ok: false, reason: 'awaiting_invoice', ar: 'بانتظار رقم الفاتورة' };
  }
  if (!workflow.paymentDate) return { ok: false, reason: 'no_payment_date', ar: 'بلا تاريخ سداد' };
  if (underNewRule(workflow) && !String(workflow.accountingReview || '').trim()) {
    return { ok: false, reason: 'awaiting_review', ar: 'بانتظار مراجعة التشغيل' };
  }
  return { ok: true, screen: 'cash' };
};


/**
 * ── أنواعُ الدفع الأربعة الجديدة — «آجل» و«نقدي» ───────────────────────────
 *
 * قرارُ صاحب الشركة (٢٠٢٦/١٠/٢١): عمودُ «نوع الدفع» يأخذ أربعةَ اختياراتٍ تحلّ
 * محلَّ «ضريبي» و«كاش» في الاختيار: «آجل - فاتورة» مكانَ الضريبيّ، والثلاثةُ
 * الأخرى مكانَ الكاش. «كأنّي استبدلتُهما».
 *
 * ── ولماذا حقلٌ ثانٍ لا قيمٌ جديدةٌ في `paymentType` ─────────────────────────
 * كلُّ قاعدةٍ في النظام تسأل `paymentType === 'cash'` أو `'tax'`: قفلُ رقم
 * الفاتورة، وصفحتا التحصيل، وتحصيلُ المحفظة، والاشتقاقُ، والتوحيد، وبطاقاتُ
 * «سندات لم تصل»… فبقي `paymentType` **العائلةَ** ('cash' | 'tax')، وصار
 * `paymentSubtype` النوعَ المختار. واختيارُ نوعٍ يكتب الاثنين معًا، فتبقى كلُّ
 * قاعدةٍ قائمةٍ كما هي وتسري على النوع الجديد بعائلته.
 *
 * والكشوفُ القائمةُ لا يُعاد تصنيفُها: «ضريبي» و«كاش» يبقيان يُعرَضان ويُفلتَر
 * بهما حتى يغيّرهما أحد — ولا يُعرَضان اختيارًا بعد اليوم.
 */
const PAYMENT_SUBTYPES = {
  deferred_cash: { family: 'cash', ar: 'آجل - كاش', en: 'Deferred – cash' },
  deferred_invoice: { family: 'tax', ar: 'آجل - فاتورة', en: 'Deferred – invoice' },
  cash_3pl: { family: 'cash', ar: 'نقدي - 3PL', en: 'Cash – 3PL' },
  cash_ht: { family: 'cash', ar: 'نقدي - HT', en: 'Cash – HT' },
};
const SUBTYPE_KEYS = Object.keys(PAYMENT_SUBTYPES);
/** النوعُ الضريبيُّ الوحيد — إليه يذهب كلُّ انتقالٍ آليٍّ إلى الضريبيّ. */
const TAX_SUBTYPE = 'deferred_invoice';
const isSubtype = (k) => Object.prototype.hasOwnProperty.call(PAYMENT_SUBTYPES, String(k || ''));
/** عائلةُ النوع: 'cash' | 'tax' | '' */
const subtypeFamily = (k) => (isSubtype(k) ? PAYMENT_SUBTYPES[k].family : '');

/** الأسماءُ الستّة كما تُقرأ في العمود. */
const PAYMENT_KIND_AR = {
  tax: 'ضريبي', cash: 'كاش',
  ...Object.fromEntries(SUBTYPE_KEYS.map((k) => [k, PAYMENT_SUBTYPES[k].ar])),
};

/** ما يُعرَض في العمود: النوعُ إن وُجد، وإلّا العائلة. */
const paymentKindOf = (w = {}) => (isSubtype(w.paymentSubtype) ? w.paymentSubtype : String(w.paymentType || ''));
const paymentKindLabel = (w = {}) => PAYMENT_KIND_AR[paymentKindOf(w)] || '';

/** الشيءُ نفسُه تعبيرًا (لـ`$group` في قائمة قيم العمود). */
const PAYMENT_KIND_EXPR = {
  $cond: [
    { $in: [{ $ifNull: ['$paymentSubtype', ''] }, SUBTYPE_KEYS] },
    '$paymentSubtype',
    { $ifNull: ['$paymentType', ''] },
  ],
};

/**
 * شرطُ فلتر العمود على القيم الستّ (والفارغ).
 * «ضريبي»/«كاش» تعني ما بقي عليهما بلا نوعٍ جديد — لا العائلةَ كلَّها: العمودُ
 * يعرض ستَّ قيمٍ، والفلترُ يُرجع ما تعرضه الخانة.
 */
function paymentKindCondition(values = []) {
  const BLANK_SUB = { paymentSubtype: { $in: ['', null] } };
  const or = [];
  for (const raw of values) {
    const v = String(raw == null ? '' : raw).trim();
    if (isSubtype(v)) or.push({ paymentSubtype: v });
    else if (v === 'cash' || v === 'tax') or.push({ $and: [{ paymentType: v }, BLANK_SUB] });
    else if (v === '') or.push({ paymentType: { $in: ['', null] } });
  }
  if (!or.length) return { _id: { $exists: false } };
  return or.length === 1 ? or[0] : { $or: or };
}

/**
 * النوعُ بعد انتقالٍ **آليّ** للعائلة (اشتقاق، رقمُ فاتورة، مزامنة، توحيد).
 *
 *  • انتقالٌ إلى الضريبيّ ← «آجل - فاتورة»: هو الضريبيُّ الوحيد اليوم
 *    (توضيحُ صاحب الشركة). وكشفٌ كان ضريبيًّا قبلُ يبقى على ما هو عليه —
 *    فلا تُعاد كتابةُ سبعةٍ وثلاثين ألفَ «ضريبي» قائم.
 *  • انتقالٌ إلى الكاش ← «كاش» بلا نوع: ثلاثةُ أنواعٍ نقديّة، فيختار إنسان.
 *    ويُرفع نوعٌ ضريبيٌّ لم يعد يوافق عائلته.
 * واختيارُ اليد لا يمرّ من هنا أصلًا — المشتقُّ لا يمسّ كشفًا يدويًّا.
 */
function subtypeAfterAuto(prevType, nextType, subtype) {
  const prev = String(prevType || ''); const next = String(nextType || '');
  if (next === 'tax') {
    if (prev !== 'tax') return TAX_SUBTYPE;
    return subtypeFamily(subtype) === 'tax' ? subtype : '';
  }
  if (next === 'cash') return subtypeFamily(subtype) === 'cash' ? subtype : '';
  return '';
}

/** الشيءُ نفسُه تعبيرًا لخطّ تحديث (المزامنة). */
const subtypeAfterAutoExpr = (prevExpr, nextExpr, subExpr) => {
  const famOf = (e) => ({
    $switch: {
      branches: SUBTYPE_KEYS.map((k) => ({ case: { $eq: [e, k] }, then: PAYMENT_SUBTYPES[k].family })),
      default: '',
    },
  });
  return {
    $switch: {
      branches: [
        {
          case: { $eq: [nextExpr, 'tax'] },
          then: { $cond: [{ $ne: [prevExpr, 'tax'] }, TAX_SUBTYPE, { $cond: [{ $eq: [famOf(subExpr), 'tax'] }, subExpr, ''] }] },
        },
        { case: { $eq: [nextExpr, 'cash'] }, then: { $cond: [{ $eq: [famOf(subExpr), 'cash'] }, subExpr, ''] } },
      ],
      default: '',
    },
  };
};

/**
 * يُطبِّع اختيارَ نوع الدفع في تعديلٍ قادم — قبل أيّ قاعدةٍ أخرى.
 *
 *  • `paymentType` أحدُ الأربعة → يُكتب النوعُ وعائلتُه معًا.
 *  • `paymentSubtype` وحدَه → تتبعه عائلتُه.
 *  • `paymentType` «ضريبي»/«كاش» بيد → يُرفع النوع (اختارت اليدُ العائلةَ وحدَها).
 *  • `paymentType` مشتقٌّ (`__derivedPaymentType`) → `subtypeAfterAuto`.
 * ويُعاد `true` إن مسّ التعديلُ النوعَ أو عائلتَه.
 */
function normalizePaymentChoice(patch, current = {}) {
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);
  if (!has('paymentType') && !has('paymentSubtype')) return false;
  const sub = has('paymentSubtype') ? String(patch.paymentSubtype || '').trim() : null;
  if (has('paymentType')) {
    const v = String(patch.paymentType || '').trim();
    if (isSubtype(v)) {
      patch.paymentSubtype = v;
      patch.paymentType = subtypeFamily(v);
    } else if (patch.__derivedPaymentType) {
      patch.paymentSubtype = subtypeAfterAuto(current.paymentType, v, current.paymentSubtype);
    } else if (sub && isSubtype(sub)) {
      patch.paymentSubtype = sub;
      patch.paymentType = subtypeFamily(sub);
    } else {
      patch.paymentSubtype = '';
    }
  } else if (isSubtype(sub)) {
    patch.paymentSubtype = sub;
    patch.paymentType = subtypeFamily(sub);
  } else {
    // نوعٌ فارغٌ أو غيرُ معروف: يُرفع النوعُ وتبقى العائلة.
    patch.paymentSubtype = '';
  }
  return true;
}

module.exports = {
  NO_INVOICE_TOKENS, NO_INVOICE_RX, NOT_AN_INVOICE_RX,
  hasIssuedInvoice, ISSUED_INVOICE_QUERY, ISSUED_INVOICE_EXPR, isUnified,
  derivePaymentType, derivePaymentTypeFor, paymentTypeReason,
  hasTaxInvoice, methodIsCash, mayAutoSet,
  AUTO_RULE_FROM, underNewRule, reachesCollections,
  PAYMENT_SUBTYPES, SUBTYPE_KEYS, TAX_SUBTYPE, isSubtype, subtypeFamily, PAYMENT_KIND_AR,
  paymentKindOf, paymentKindLabel, PAYMENT_KIND_EXPR, paymentKindCondition,
  subtypeAfterAuto, subtypeAfterAutoExpr, normalizePaymentChoice,
};
