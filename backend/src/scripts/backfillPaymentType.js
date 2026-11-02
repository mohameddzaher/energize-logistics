/**
 * backfillPaymentType: a manifest carrying an invoice number was a tax one.
 * Usage: node src/scripts/backfillPaymentType.js --dry | (no flag to write)
 * Payment type is a new column, so old manifests lack it and never reach collections. An invoice is written only for tax customers, so an invoice number implies tax.
 * No invoice number is not called cash (absence of evidence); it stays empty, and an existing choice is never overwritten.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

// What means "no invoice" is not an invoice number; same text the invoices page excludes, so import and display do not diverge.
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
