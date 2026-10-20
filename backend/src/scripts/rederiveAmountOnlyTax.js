/**
 * rederiveAmountOnlyTax — كشوفٌ صارت «ضريبيًّا» بمبلغٍ لا برقم فاتورة، تُعاد إلى قاعدتها.
 *
 *   node src/scripts/rederiveAmountOnlyTax.js            ← عرضٌ فقط (لا يكتب شيئًا)
 *   node src/scripts/rederiveAmountOnlyTax.js --apply    ← يكتب
 *   node src/scripts/rederiveAmountOnlyTax.js --list     ← ومعه أرقامُ الكشوف
 *
 * ── لماذا ───────────────────────────────────────────────────────────────────
 * كان «عليه فاتورةٌ ضريبيّة» يُقرأ من ثلاثة: رقمِ الفاتورة، أو ضريبةٍ محسوبة، أو
 * صافٍ. والصافي يكتبه المسارُ النقديُّ نفسُه (مبلغُ السداد يُنسَخ إليه)، فكان كلُّ
 * كشفٍ نقديٍّ له مبلغُ سدادٍ ينقلب «ضريبيًّا» في أوّل مزامنة.
 *
 * وقرارُ صاحب الشركة (٢٠٢٦/١٠/٢٠): «الضريبي لازم رقم فاتورة» — والصافي والضريبةُ
 * وحدَهما لا يجعلان الكشفَ ضريبيًّا. فالقاعدةُ صُحِّحت (utils/paymentType)،
 * وهذا السكربتُ يعيد اشتقاقَ ما قلبه الدليلُ القديم:
 *
 *   • نوعُه «ضريبي»، ومصدرُه مشتقّ (`auto` أو فارغ) — لا يُمسّ اختيارُ اليد
 *     (`manual`) ولا التوحيد (`unified`)؛
 *   • ولا رقمَ فاتورةٍ حقيقيٍّ عليه؛
 *   • وعليه صافٍ أو ضريبة (هذا وحدَه ما جعله ضريبيًّا)؛
 *   • ويُشتقّ بالقاعدة الجديدة (صفةُ العميل، وطريقةُ دفع المنصّة للجديد) إلى
 *     غير «ضريبي».
 *
 * ولا تُمَسّ المبالغُ: الصافي والضريبةُ والإجماليّ تبقى كما هي («عادي لو كاش
 * يتكتب صافي فاتورة ويتحسب الفات»). ولا قيدَ في دفتر الفواتير يتأثّر: لا رقمَ
 * فاتورةٍ عليها أصلًا.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const LIST = process.argv.includes('--list');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const CollectionsParty = require('../models/CollectionsParty');
  const { derivePaymentTypeFor, ISSUED_INVOICE_QUERY, underNewRule, methodIsCash } = require('../utils/paymentType');

  const parties = await CollectionsParty.find({ kind: 'customer' }).select('name nameKey paymentType').lean();
  const card = new Map();
  for (const p of parties) {
    const k = p.nameKey || CollectionsParty.fold(p.name || '');
    if (k && !card.has(k)) card.set(k, p.paymentType || '');
  }

  const rows = await OperationsWorkflow.find({
    paymentType: 'tax',
    paymentTypeSource: { $nin: ['manual', 'unified'] },
    $nor: [ISSUED_INVOICE_QUERY],
    $or: [{ netInvoice: { $gt: 0 } }, { tax: { $gt: 0 } }],
  }).select('reportNumber username reportDate paymentMethod paymentType paymentTypeSource invoiceNumber netInvoice tax totalInvoice paymentAmount').lean();

  const moves = {}; const why = {}; const ops = []; const sample = [];
  let stays = 0;
  for (const w of rows) {
    const cardType = card.get(CollectionsParty.fold(w.username || '')) || '';
    const next = derivePaymentTypeFor(w, cardType);
    if (!next || next === 'tax') {
      stays += 1;
      const k = !next ? 'لا صفةَ لعميله ولا تقول المنصّةُ «cash» — يبقى ضريبيًّا' : 'يبقى ضريبيًّا بصفة عميله';
      why[k] = (why[k] || 0) + 1;
      continue;
    }
    const k = `tax → ${next}`;
    moves[k] = (moves[k] || 0) + 1;
    const reason = underNewRule(w) && methodIsCash(w.paymentMethod) ? 'المنصّةُ تقول cash (كشفٌ من سبتمبر فما بعد)' : `صفةُ العميل «${cardType}»`;
    why[reason] = (why[reason] || 0) + 1;
    if (sample.length < 15) sample.push(`${w.reportNumber} · ${w.username} · صافي ${w.netInvoice || 0} ضريبة ${w.tax || 0} مبلغ سداد ${w.paymentAmount || 0} · ${reason}`);
    ops.push({ updateOne: { filter: { _id: w._id, paymentType: 'tax', paymentTypeSource: w.paymentTypeSource ?? { $exists: false } },
      update: { $set: { paymentType: next, paymentTypeSource: 'auto' } } } });
    if (LIST) console.log(`  ${w.reportNumber}  ${w.username}  → ${next}`);
  }

  console.log(`كشوفٌ «ضريبي» بلا رقم فاتورةٍ وعليها مبلغ (مصدرُها مشتقّ): ${rows.length}`);
  console.log(`  تُعاد إلى قاعدتها: ${ops.length}`, moves);
  console.log(`  تبقى «ضريبي»: ${stays}`);
  console.log('  الأسباب:', why);
  if (sample.length) console.log(`\nأمثلة:\n  ${sample.join('\n  ')}`);

  if (APPLY && ops.length) {
    let changed = 0;
    for (let i = 0; i < ops.length; i += 500) {
      const r = await OperationsWorkflow.bulkWrite(ops.slice(i, i + 500), { ordered: false });
      changed += r.modifiedCount || 0;
    }
    console.log(`\n✓ كُتب ${changed} كشفًا. أعد تحميل الخادم أو انتظر انتهاء ذاكرة wf:/colledger: (٢٠–٦٠ ثانية).`);
  } else if (!APPLY) {
    console.log('\n(عرضٌ فقط — أضف --apply للكتابة)');
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
