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
 * هل على هذا الكشف فاتورةٌ ضريبيّةٌ صادرة؟
 *
 * رقمُ فاتورةٍ أو ضريبةٌ محسوبة. والكشفُ النقديُّ تُصفَّر أعمدةُ فاتورته بالقفل
 * (راجع CASH_LOCKED_FIELDS)، فوجودُ أيٍّ منهما دليلٌ لا صدفة.
 */
// ── وما ليس رقمَ فاتورة ─────────────────────────────────────────────────────
// «no inv» و«بدون» يكتبها الناسُ في الشيت. و**«0»** يكتبها القفلُ النقديُّ نفسُه:
// كشفٌ يصير كاشًا تُملأ أعمدةُ فاتورته بصفرٍ (راجع cashLockedValues في
// workflowController) — فقراءتُها فاتورةً تقلب الكشفَ إلى ضريبيٍّ في أوّل حفظةٍ
// بعدها، ثمّ يُقفل فيُكتب «0» من جديد. دورةٌ تُخرج الكشفَ من شاشة الكاش بلا سبب
// ظاهر.
const NO_INVOICE_RX = /^\s*(0|no\s*inv|بدون|لا\s*يوجد|-|—|ىى)\s*$/i;
const hasTaxInvoice = (w = {}) => {
  const no = String(w.invoiceNumber || '').trim();
  if (no && !NO_INVOICE_RX.test(no)) return true;
  return Number(w.tax) > 0 || Number(w.netInvoice) > 0;
};

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

module.exports = {
  derivePaymentType, derivePaymentTypeFor, paymentTypeReason,
  hasTaxInvoice, methodIsCash, mayAutoSet,
  AUTO_RULE_FROM, underNewRule, reachesCollections,
};
