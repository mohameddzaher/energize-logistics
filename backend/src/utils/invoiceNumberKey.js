/**
 * invoiceNumberKey — مطابقةُ رقم الفاتورة بين دفتر التحصيل وكشوف التشغيل.
 *
 * الرقمُ نفسُه يُكتب في المكانين بصورتين: «٨٨٩١» و«08891» و«8891 » و«88-91».
 * فيُطوى قبل المقارنة: تُزال المسافاتُ والفواصلُ والأصفارُ البادئة، ويُرفَع ما
 * بقي من حروفٍ إلى الكبير.
 *
 * و«لا فاتورة» ليست رقمًا: الكشفُ الذي كُتب في خانة فاتورته «بدون» أو «no inv»
 * أو صفرٌ لم يُفوتَر بعد. ولو عُومل نصًّا لتجمّعت آلافُ الكشوف تحت «فاتورةٍ»
 * اسمُها «بدون» — راجع ذاكرة «no inv placeholder».
 */
const NO_INVOICE = /^\s*(?:no\s*inv(?:oice)?|noinv|no-inv|none|n\/a|na|-|—|ىى|0|بدون(?:\s*فاتورة)?|لا\s*يوجد|لا\s*توجد|غير\s*مفوتر(?:ة)?)\s*$/i;

function invoiceNumberKey(v) {
  const raw = v == null ? '' : String(v).trim();
  if (!raw || NO_INVOICE.test(raw)) return '';
  const s = raw.replace(/[\s\-_/\\]+/g, '');
  if (!s) return '';
  const digits = s.match(/^0*(\d+)$/);
  return digits ? digits[1] : s.toUpperCase();
}

module.exports = { invoiceNumberKey, NO_INVOICE };
