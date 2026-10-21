/**
 * convertTaxToDeferredInvoice — «ضريبي» بلا نوعٍ يصير «آجل - فاتورة».
 *
 *   node src/scripts/convertTaxToDeferredInvoice.js           تجربة (لا كتابة)
 *   node src/scripts/convertTaxToDeferredInvoice.js --apply   تنفيذ
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * قرارُ صاحب الشركة (٢٠٢٦/١٠/٢١): «ضريبي» و«آجل - فاتورة» شيءٌ واحد. والأنواعُ
 * الأربعة حلّت محلَّ «ضريبي»/«كاش» في الاختيار، فبقيت الكشوفُ القائمةُ على
 * «ضريبي» بلا نوع — قيمةٌ سابعةٌ في العمود والفلتر لا تُختار بعد اليوم.
 *
 * فيُكتب لكلّ كشفٍ عائلتُه `tax` ونوعُه فارغ: `paymentSubtype = 'deferred_invoice'`.
 * العائلةُ لا تتغيّر، فلا تتحرّك أيُّ قاعدةٍ تسأل `paymentType` (الفوترة، شاشتا
 * التحصيل، المحفظة، البطاقات).
 *
 * ── وما لا يُلمَس ───────────────────────────────────────────────────────────
 * `paymentTypeSource` يبقى كما هو: المشتقُّ يبقى مشتقًّا فتظلّ المزامنةُ وصفحةُ
 * «أنواع الدفع» تعيدان اشتقاقَه — وانتقالٌ آليٌّ داخلَ العائلة نفسِها يُبقي
 * النوعَ (راجع subtypeAfterAuto). والكشفُ يبقى يُعدَّل كأيّ كشف.
 *
 * ويُعاد تشغيلُه بلا ضرر: الشرطُ «ضريبيٌّ بلا نوع»، وما كُتب لا يطابقه ثانية.
 *
 * ── والذاكرةُ المؤقّتة ──────────────────────────────────────────────────────
 * السكربتُ عمليّةٌ منفصلة لا ذاكرةَ لها؛ يكتب أختامَ الإبطال في القاعدة
 * (ttlCache.clearShared) فيمسح العاملان ذاكرتَهما في الحال. ولو تعذّر ذلك
 * فالمهلةُ تنقضي وحدَها، أو `pm2 reload`.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

const FILTER = {
  paymentType: 'tax',
  $or: [{ paymentSubtype: { $exists: false } }, { paymentSubtype: null }, { paymentSubtype: '' }],
};

// مَن يقرأ نوعَ الدفع ويحفظ ما قرأ — سير العمل وقسمُ التحصيل والصفحةُ الخاصّة.
const CACHE_PREFIXES = ['wf:', 'wfparty:', 'collections-dept:', 'cdr:', 'colledger:', 'opsprivate:'];

async function run({ apply = APPLY, log = console.log } = {}) {
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const { TAX_SUBTYPE } = require('../utils/paymentType');

  const [total, bySource] = await Promise.all([
    OperationsWorkflow.countDocuments(FILTER),
    OperationsWorkflow.aggregate([
      { $match: FILTER },
      { $group: { _id: { $ifNull: ['$paymentTypeSource', ''] }, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
  ]);

  log(apply ? '── تنفيذ ──' : '── تجربة، بلا كتابة ──');
  log(`كشوفٌ «ضريبي» بلا نوع: ${total}`);
  for (const s of bySource) log(`  مصدرُ النوع ${s._id || '(فارغ)'}: ${s.n}`);

  if (!apply || !total) {
    if (!apply) log('— تجربةٌ فقط. أضف --apply للتنفيذ.');
    return { total, modified: 0, bySource };
  }

  const r = await OperationsWorkflow.updateMany(FILTER, { $set: { paymentSubtype: TAX_SUBTYPE } });
  const modified = r.modifiedCount || 0;
  log(`✓ كُتب «آجل - فاتورة» على ${modified} كشفًا`);

  const cache = require('../utils/ttlCache');
  for (const p of CACHE_PREFIXES) {
    try { await cache.clearShared(p); } catch (e) { log(`  تعذّر ختمُ ${p}: ${e.message} — المهلةُ أو pm2 reload`); }
  }
  log(`  أُبطلت الذاكرة: ${CACHE_PREFIXES.join(' ')}`);
  return { total, modified, bySource };
}

module.exports = { run, FILTER };

if (require.main === module) {
  (async () => {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
    try { await run(); } finally { await mongoose.disconnect(); }
  })().catch((e) => { console.error(e); process.exit(1); });
}
