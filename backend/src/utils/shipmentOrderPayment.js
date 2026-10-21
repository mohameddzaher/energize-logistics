/**
 * «نوع الدفع» على طلب الشحنة — الأنواعُ الأربعةُ نفسُها التي على كشف التشغيل.
 *
 * ── لماذا الأربعةُ نفسُها ────────────────────────────────────────────────────
 * قرارُ صاحب الشركة (٢٠٢٦/١٠/٢١): خانةُ «نوع تأجير السائق» في إنشاء الشحنة
 * تصير «نوع الدفع» بأربعة اختيارات: «آجل - كاش» و«آجل - فاتورة» و«نقدي - 3PL»
 * و«نقدي - HT». وهي مفاتيحُ سير عمل التشغيل بأعيانها (`utils/paymentType`
 * → `PAYMENT_SUBTYPES`) — تُقرأ من هناك ولا تُكتب هنا ثانيةً، فلا يصير للنوع
 * الواحد اسمان في شاشتين.
 *
 * ── وطريقةُ الدفع تتبعه ولا تُختار ──────────────────────────────────────────
 * `paymentMethod` على الطلب («آجل» / «نقدي») تقرؤه البوليصةُ لتعرف أتطبع سعرَ
 * النقل (السائقُ يقبض عند التسليم) أم لا، ويُفلتَر به الجدول. فيُشتقّ من النوع
 * في الخادم: «آجل - …» ⇒ آجل، و«نقدي - …» ⇒ نقدي — ولا يُترَك لاختيارٍ يناقضه.
 * والجدولُ صريحٌ لا يُستخرَج من الاسم: تعديلُ اسمٍ معروضٍ لا يُغيّر ما تطبعه
 * البوليصة.
 */
const { PAYMENT_SUBTYPES, SUBTYPE_KEYS, isSubtype } = require('./paymentType');

/** شروطُ السداد لكلّ نوع — ما يُكتب في `paymentMethod` على الطلب. */
const TERMS_BY_SUBTYPE = {
  deferred_cash: 'آجل',
  deferred_invoice: 'آجل',
  cash_3pl: 'نقدي',
  cash_ht: 'نقدي',
};
// نوعٌ يُزاد في سير العمل ولا يُزاد هنا يُكتشَف عند الإقلاع لا في بوليصةٍ مطبوعة.
SUBTYPE_KEYS.forEach((k) => {
  if (!TERMS_BY_SUBTYPE[k]) throw new Error(`shipmentOrderPayment: no terms for payment subtype "${k}"`);
});

/** «آجل» | «نقدي» | '' */
const termsOfSubtype = (k) => (isSubtype(k) ? TERMS_BY_SUBTYPE[k] : '');

/** أيقبض السائقُ عند التسليم؟ — `null` حين لا نوعَ على الطلب (يُرجَع إلى القاعدة القديمة). */
const collectsOnDelivery = (k) => (isSubtype(k) ? TERMS_BY_SUBTYPE[k] === 'نقدي' : null);

/** اسمُ النوع كما يُقرأ. */
const subtypeLabel = (k, lang = 'ar') => (isSubtype(k) ? PAYMENT_SUBTYPES[k][lang === 'en' ? 'en' : 'ar'] : '');

/** خياراتُ خانة «نوع الدفع» في نموذج الإنشاء — الأربعةُ بترتيب صاحب الشركة. */
const paymentSubtypeOptions = () => SUBTYPE_KEYS.map((k) => ({
  key: k,
  ar: PAYMENT_SUBTYPES[k].ar,
  en: PAYMENT_SUBTYPES[k].en,
  paymentMethod: TERMS_BY_SUBTYPE[k],
}));

module.exports = {
  TERMS_BY_SUBTYPE, termsOfSubtype, collectsOnDelivery, subtypeLabel, paymentSubtypeOptions,
};
