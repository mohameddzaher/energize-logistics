/**
 * backfillPaymentType — الكشفُ الذي يحمل رقمَ فاتورةٍ كان ضريبيًّا.
 *
 *   node src/scripts/backfillPaymentType.js --dry     يقول ولا يكتب
 *   node src/scripts/backfillPaymentType.js           ينفّذ
 *
 * ── لماذا ──────────────────────────────────────────────────────────────────
 * «نوع الدفع» عمودٌ جديد، وما قبله لا يحمله — فلا يصل قسمَ التحصيل شيءٌ من
 * أربعةٍ وثلاثين ألفَ كشفٍ قديم، وفيها فواتيرُ حقيقيّةٌ لم تُحصَّل بعد.
 *
 * والاستنتاجُ هنا آمنٌ لأنّه من داخل البيانات لا من خارجها: الفاتورةُ لا تُكتب
 * إلّا لعميلٍ ضريبيّ — عميلُ الكاش يدفع في يده بلا فاتورة. فرقمُ الفاتورة
 * إقرارٌ بأنّ الكشف كان ضريبيًّا.
 *
 * ── وما لا يُستنتَج لا يُكتب ───────────────────────────────────────────────
 * الكشفُ بلا رقم فاتورةٍ لا يُقال عنه «نقديّ»: قد يكون ضريبيًّا لم يُفوتَر
 * بعد. وغيابُ الدليل ليس دليلَ الغياب — تُترك فارغةً ليختارها من يعرف.
 *
 * ولا يُكتب فوق اختيارٍ قائم: من اختار نوعًا بيده يجده كما تركه.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

// ما يعني «لا فاتورة» ليس رقمَ فاتورة — النصُّ نفسُه الذي تستثنيه صفحةُ
// الفواتير، فلا يفترق الاستيرادُ عن العرض.
const NO_INVOICE_TOKENS = [
  'no inv', 'no invoice', 'noinv', 'no-inv', 'none', 'n/a', 'na', '-', '—', '0',
  'بدون', 'بدون فاتورة', 'لا يوجد', 'لا توجد', 'غير مفوتر', 'غير مفوترة',
];
const NO_INVOICE_RX = new RegExp(
  `^\\s*(?:${NO_INVOICE_TOKENS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*$`,
  'i',
);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const OW = require('../models/OperationsWorkflow');

  console.log(DRY ? '— تجربة، بلا كتابة —\n' : '');

  const filter = {
    invoiceNumber: { $nin: [null, ''], $not: NO_INVOICE_RX },
    $or: [{ paymentType: { $in: [null, ''] } }, { paymentType: { $exists: false } }],
  };

  const [n, invoices, already, noInvoice] = await Promise.all([
    OW.countDocuments(filter),
    OW.distinct('invoiceNumber', filter),
    OW.countDocuments({ paymentType: { $in: ['cash', 'tax'] } }),
    OW.countDocuments({
      $or: [
        { invoiceNumber: { $in: [null, ''] } },
        { invoiceNumber: NO_INVOICE_RX },
      ],
    }),
  ]);

  console.log(`كشوفٌ تحمل رقمَ فاتورةٍ ولا نوعَ دفعٍ لها: ${n}`);
  console.log(`  تحتها ${invoices.length} فاتورةً مختلفة`);
  console.log(`نوعُ دفعها مُختارٌ من قبل فلا تُمَسّ: ${already}`);
  console.log(`بلا رقم فاتورة — تُترك فارغةً ليختارها من يعرف: ${noInvoice}`);

  if (!DRY && n) {
    const r = await OW.updateMany(filter, { $set: { paymentType: 'tax' } });
    console.log(`\n✓ كُتب «ضريبي» على ${r.modifiedCount} كشفًا`);
  }

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
