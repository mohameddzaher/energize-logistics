/**
 * ensureCollectionsParty — العميلُ الجديد يدخل قسمَ التحصيل بكوده من أوّل كشف.
 *
 * ── الثغرة التي يسدُّها ─────────────────────────────────────────────────────
 * كان سجلُّ أطراف التحصيل يُملأ بسكربتٍ يُشغَّل باليد (`seedCollectionsParties`).
 * فمن أنشأت له العمليّاتُ كشفًا اليومَ لا يظهر في قسم التحصيل حتّى يتذكّر أحدٌ
 * تشغيلَ السكربت — وحتّى يظهر، لا كودَ له.
 *
 * وأثرُه ليس صفًّا ناقصًا في قائمة: قسمُ التحصيل يعمل بالكود — به تُنسَب
 * الفاتورةُ، وبه يُطابَق الدفتر، وبه تُقرأ المديونيّة. فالعميلُ بلا كودٍ عميلٌ
 * لا يُحصَّل منه: تُشحَن له حمولاتٌ ولا يدخل قائمةَ أحد.
 *
 * ── الكودُ من سلسلة نوعه ───────────────────────────────────────────────────
 * في الدفتر سلسلتان: الضريبيُّ `1104xxxx` والنقديُّ `Cxxxx` — و`nextPartyCode`
 * تقرأ أكبرَ موجودٍ وتزيد واحدًا، فلا عدّادَ يفترق عن الواقع.
 *
 * ونوعُ العميل يُشتقّ من الكشف نفسِه بالقاعدة المعروفة (`derivePaymentType`):
 * فاتورةٌ صادرةٌ ⇒ ضريبيّ، وطريقةُ دفعٍ نقديّةٌ ⇒ نقديّ. ومتى لم يُعرَف فلا
 * يُخمَّن نوعٌ: يُنشأ الطرفُ بلا نوعٍ وبلا كود، ويظهر في القسم ليُصنَّف — وكودٌ
 * من السلسلة الخطأ أسوأُ من لا كود، لأنّه يُقرأ في الدفتر حسابًا آخر.
 *
 * ── ولا يُنشأ طرفٌ من اسمٍ لا يُعرَف ───────────────────────────────────────
 * أسماءُ العملاء تصل من منصّة التشغيل كما كتبها موظّفُ الطلب، وفيها ما ليس
 * عميلًا: فراغٌ، وشرطة، و«الإجمالي». فما لا يبلغ حرفين لا يصير سجلًّا.
 */
const MIN_NAME = 2;
const JUNK = /^\s*(?:-|—|_|n\/a|na|none|null|undefined|test|الإجمالي|الاجمالي|المجموع|total)\s*$/i;

/**
 * يُعيد سجلَّ الطرف — قائمًا كان أو مُنشأً الآن.
 *
 * @param {string} name        اسمُ العميل كما وصل
 * @param {object} opts
 * @param {'cash'|'tax'|''} opts.paymentType  نوعُه إن عُرف
 * @param {string} opts.source  من أيّ قسمٍ جاء (`operations_workflow` …)
 * @returns {Promise<object|null>}
 */
async function ensureCollectionsParty(name, opts = {}) {
  const CollectionsParty = require('../models/CollectionsParty');
  const { fold } = CollectionsParty;
  const clean = String(name || '').trim();
  if (clean.length < MIN_NAME || JUNK.test(clean)) return null;

  const key = fold(clean);
  if (!key) return null;

  // الاسمُ يُطابَق مطويًّا وباسمٍ بديل: العميلُ الواحد يُكتب بالهمزة وبدونها،
  // وإنشاءُ سجلٍّ ثانٍ له يقسم مديونيّتَه على صفَّين.
  const found = await CollectionsParty.findOne({
    kind: 'customer', $or: [{ nameKey: key }, { aliasKeys: key }],
  }).lean();
  if (found) return found;

  const paymentType = opts.paymentType === 'cash' || opts.paymentType === 'tax' ? opts.paymentType : '';
  // بلا نوعٍ لا كود — راجع الترويسة.
  let code = '';
  if (paymentType) {
    const { nextPartyCode } = require('./partyCode');
    code = await nextPartyCode(paymentType);
  }

  try {
    return await CollectionsParty.findOneAndUpdate(
      { kind: 'customer', nameKey: key },
      {
        $setOnInsert: {
          kind: 'customer', name: clean, nameKey: key, paymentType, code,
          source: opts.source || 'operations_workflow', isActive: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (e) {
    // سباقٌ بين مزامنتين على الاسم نفسِه: الفهرسُ الفريد يمنع الثانية، فتُقرأ
    // التي سبقت بدل أن يُردّ النداءُ ويسقط الكشفُ كلُّه.
    if (e && e.code === 11000) {
      return CollectionsParty.findOne({ kind: 'customer', nameKey: key }).lean();
    }
    throw e;
  }
}

module.exports = { ensureCollectionsParty };
