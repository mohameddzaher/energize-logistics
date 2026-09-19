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
  const paymentType = opts.paymentType === 'cash' || opts.paymentType === 'tax' ? opts.paymentType : '';
  // ── طرفٌ قائمٌ بلا كود يأخذه متى عُرف نوعُ حمولته ─────────────────────────
  // كان الطرفُ يُنشأ بلا كودٍ إن جهل النوعَ أوّلَ مرّة، ثمّ لا يعود إليه شيء:
  // مئةٌ وثمانيةٌ وأربعون عميلًا لهم حمولاتٌ بلا كود، فلا يدخلون الأعمار.
  if (found) {
    if (!found.code && found.isActive !== false) {
      try { await classifyCodelessParty(found, { apply: true, paymentType }); } catch (_) { /* */ }
      return CollectionsParty.findById(found._id).lean();
    }
    return found;
  }
  // الكودُ لا يُمنح عند الإنشاء مباشرةً: يُسأل أوّلًا أهو حسابٌ قائمٌ باسمٍ
  // آخر — راجع classifyCodelessParty.
  const code = '';

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
    ).lean().then(async (doc) => {
      if (doc && !doc.code) {
        try { await classifyCodelessParty(doc, { apply: true, paymentType }); } catch (_) { /* */ }
        return CollectionsParty.findById(doc._id).lean();
      }
      return doc;
    });
  } catch (e) {
    // سباقٌ بين مزامنتين على الاسم نفسِه: الفهرسُ الفريد يمنع الثانية، فتُقرأ
    // التي سبقت بدل أن يُردّ النداءُ ويسقط الكشفُ كلُّه.
    if (e && e.code === 11000) {
      return CollectionsParty.findOne({ kind: 'customer', nameKey: key }).lean();
    }
    throw e;
  }
}

/**
 * طرفٌ بلا كود: أهو حسابٌ قائمٌ باسمٍ آخر، أم عميلٌ جديد؟
 *
 *   auto    — حسابٌ واحدٌ لا لبسَ فيه ⇒ يُدمَج فيه كما يدمج «ربط» مدير التحصيل:
 *             اسمُه صيغةٌ أخرى للحساب، ويُعطَّل السجلُّ المكرَّر ولا يُحذف.
 *   review  — شبيهٌ غيرُ قاطع ⇒ اقتراحٌ في طابور الربط، ولا كودَ حتّى يُقرَّر:
 *             كودٌ جديدٌ لعميلٍ قائمٍ يقسم دَينَه على حسابين، وهذا لا يُصلَح بعدها.
 *   none    — لا شبيه ⇒ كودٌ جديدٌ من سلسلة نوع حمولاته (ضريبيّ 1104… / نقديّ C…).
 *   unknown — لا يُعرف نوعُه من حمولاته ولا من ملفّه ⇒ يبقى حتّى يُعرَف.
 *
 * والنوعُ: المكتوبُ على الطرف، وإلّا الغالبُ في حمولاته.
 */
async function classifyCodelessParty(party, { apply = false, paymentType = '' } = {}) {
  const CollectionsParty = require('../models/CollectionsParty');
  const PartyLinkSuggestion = require('../models/PartyLinkSuggestion');
  const { matchAccount } = require('./partyMatch');
  const mongoose = require('mongoose');
  const names = [party.name, ...(party.aliases || [])].filter(Boolean);

  const accounts = await CollectionsParty.find({
    kind: 'customer', isActive: { $ne: false }, code: { $gt: '' }, _id: { $ne: party._id },
  }).select('name code paymentType').lean();
  const m = matchAccount(party.name, accounts);

  if (m.level === 'auto') {
    if (apply) {
      const keys = names.map((n) => CollectionsParty.fold(n)).filter(Boolean);
      await CollectionsParty.updateOne({ _id: m.best._id }, { $addToSet: { aliases: { $each: names }, aliasKeys: { $each: keys } } });
      await CollectionsParty.updateOne({ _id: party._id }, { $set: { isActive: false, notes: `دُمج في الحساب ${m.best.code}` } });
      await PartyLinkSuggestion.updateOne({ code: m.best.code, candidate: party._id }, { $setOnInsert: {
        code: m.best.code, accountName: m.best.name, kind: m.best.paymentType === 'cash' ? 'cash' : 'tax',
        candidate: party._id, candidateName: party.name, score: m.score,
        decision: 'linked', decidedHow: 'auto', decidedAt: new Date(), party: m.best._id,
      } }, { upsert: true }).catch(() => {});
    }
    return { level: 'auto', best: m.best, score: m.score };
  }

  if (m.level === 'review') {
    // قرارٌ سابقٌ بأنّهما منفصلان يُحترَم: فلا يُسأل مرّتين، ويُعامَل جديدًا.
    const prior = await PartyLinkSuggestion.findOne({ code: m.best.code, candidate: party._id }).lean();
    const saidSeparate = prior && prior.decision === 'separate';
    if (!saidSeparate) {
      if (apply && !prior) {
        await PartyLinkSuggestion.create({
          code: m.best.code, accountName: m.best.name, kind: m.best.paymentType === 'cash' ? 'cash' : 'tax',
          candidate: party._id, candidateName: party.name, score: m.score, decision: 'pending', party: m.best._id,
        }).catch(() => {});
      }
      return { level: 'review', best: m.best, score: m.score, queued: !prior };
    }
  }

  let type = party.paymentType === 'cash' || party.paymentType === 'tax' ? party.paymentType : '';
  if (!type && (paymentType === 'cash' || paymentType === 'tax')) type = paymentType;
  if (!type) {
    const agg = await mongoose.connection.collection('operationsworkflows').aggregate([
      { $match: { username: { $in: names }, paymentType: { $in: ['cash', 'tax'] } } },
      { $group: { _id: '$paymentType', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 1 },
    ]).toArray();
    type = agg[0]?._id || '';
  }
  if (!type) return { level: 'unknown' };
  let code = '';
  if (apply) {
    const { nextPartyCode } = require('./partyCode');
    // سباقٌ على الكود التالي: الفهرسُ الفريد يردّ الثاني فيُعاد بالتالي.
    for (let i = 0; i < 5 && !code; i += 1) {
      const next = await nextPartyCode(type);
      try {
        const r = await CollectionsParty.updateOne(
          { _id: party._id, $or: [{ code: '' }, { code: null }, { code: { $exists: false } }] },
          { $set: { code: next, paymentType: type } },
        );
        if (r.modifiedCount) code = next; else break;
      } catch (e) { if (e.code !== 11000) throw e; }
    }
    try { require('../controllers/collectionsLedgerController').invalidate(); } catch (_) { /* */ }
  }
  return { level: 'none', code, type };
}

module.exports = { ensureCollectionsParty, classifyCodelessParty };
