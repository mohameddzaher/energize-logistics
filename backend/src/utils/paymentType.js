/**
 * نوعُ الدفع — كيف يُقرَّر، ومَن يغلب مَن.
 *
 * ── ثلاثةُ مصادر، ترتيبُها هو القاعدة ────────────────────────────────────────
 *
 *  ① اليد. موظّفٌ اختار النوعَ على الكشف نفسِه من شاشة سير عمل التشغيل، فلا
 *    يُغيَّر بعده تلقائيًّا أبدًا. والعميلُ الواحد «ممكن في حمولات يقولنا
 *    هنحاسبكوا عليها كاش وساعات ضريبي» — فالاستثناءُ على حمولةٍ بعينها يُكتب
 *    هنا، وهذا موضعُه.
 *
 *  ② الفاتورةُ الصادرة. كشفٌ يحمل رقمَ فاتورةٍ أو ضريبةً محسوبةً فقد فُوتِر
 *    ضريبيًّا فعلًا. والورقةُ التي خرجت للعميل أقوى من أيّ اشتقاق.
 *
 *  ③ صفةُ العميل من صفحة «أنواع الدفع». وهي الأصل: كشوفُ العميل تتبع صفتَه.
 *
 * ── ولماذا لا تدخل «طريقةُ الدفع» في القرار ─────────────────────────────────
 * كانت قاعدةً رابعة: متى قالت المنصّةُ `cash` صار الكشفُ نقديًّا ولو كان العميلُ
 * ضريبيًّا. وقياسُها على البيانات الحيّة أسقطها:
 *
 *   • `payment_method` في المنصّة قيمتان لا ثالثَ لهما: `cash` و`late` — أي
 *     أنّها **شروطُ السداد** (نقدًا أم آجلًا) لا نوعُ الفاتورة.
 *   • ومن أحدَ عشرَ ألفًا وستِّمئةٍ وأربعةٍ وخمسين كشفًا تقول عنها `cash`، تسعةُ
 *     آلافٍ وأربعُمئةٍ وسبعةٌ وأربعون مصنَّفةٌ ضريبيّة، وفيها سبعُمئةٍ وتسعٌ
 *     وأربعون بضريبةٍ محسوبةٍ وستُّمئةٍ وخمسٌ وسبعون محصَّلةٌ بها.
 *   • والحجّةُ القاطعة أنّ ذلك يقع **للعميل الواحد**: أركتك ألفٌ وستُّمئةٍ
 *     وستٌّ وعشرون كشفًا طريقةُ دفعها `cash`، منها ثمانيةٌ وخمسون بضريبةٍ
 *     محسوبةٍ وسبعةٌ وخمسون محصَّلة — والباقي لم يُفوتَر بعدُ لا أكثر. فلو
 *     نقضت طريقةُ الدفعِ صفةَ العميل لانتقل ألفٌ وخمسُمئةٍ وأربعةٌ وستّون كشفًا
 *     لعميلٍ ضريبيٍّ إلى شاشة الكاش، فلا تُكتب لها فاتورةٌ أبدًا.
 *
 * فالاستثناءُ على حمولةٍ بعينها يبقى مطلوبًا، ومحلُّه ① — يُكتب على الكشف من
 * شاشة سير عمل التشغيل فيُختَم «يدويًّا» ولا يُمسّ بعدها.
 */

/** هل تقول المنصّةُ إنّ هذه الحمولةَ نقديّة؟ */
const methodIsCash = (paymentMethod) => /^\s*cash\s*$/i.test(String(paymentMethod || ''));

/**
 * هل على هذا الكشف فاتورةٌ ضريبيّةٌ صادرة؟
 *
 * رقمُ فاتورةٍ أو ضريبةٌ محسوبة. والكشفُ النقديُّ تُصفَّر أعمدةُ فاتورته بالقفل
 * (راجع CASH_LOCKED_FIELDS)، فوجودُ أيٍّ منهما دليلٌ لا صدفة.
 */
const NO_INVOICE_RX = /^\s*(no\s*inv|بدون|لا\s*يوجد|-|—|ىى)\s*$/i;
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

module.exports = { derivePaymentType, derivePaymentTypeFor, paymentTypeReason, hasTaxInvoice, methodIsCash, mayAutoSet };
