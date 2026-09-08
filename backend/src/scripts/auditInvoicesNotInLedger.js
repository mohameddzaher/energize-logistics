/** أرقامُ فواتيرَ مكتوبةٌ على كشوف التشغيل ولا قيدَ لها في دفتر الفواتير. */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const CollectionInvoice = require('../models/CollectionInvoice');
  const { NO_INVOICE_RX } = (() => { try { return require('../utils/paymentType'); } catch (e) { return {}; } })();

  const nums = await OperationsWorkflow.distinct('invoiceNumber', { invoiceNumber: { $nin: [null, ''] } });
  const clean = nums.map((n) => String(n).trim()).filter((n) => n && !/^(0|no\s*inv|بدون|لا\s*يوجد|-|—|ىى)$/i.test(n));
  console.log(`أرقامُ فواتيرَ على الكشوف: ${clean.length}`);

  const inLedger = new Set((await CollectionInvoice.find({ invoiceNumber: { $in: clean } }).select('invoiceNumber').lean())
    .map((x) => String(x.invoiceNumber).trim()));
  const missing = clean.filter((n) => !inLedger.has(n));
  console.log(`منها في الدفتر: ${inLedger.size} · وليست فيه: ${missing.length}`);

  if (missing.length) {
    const rows = await OperationsWorkflow.find({ invoiceNumber: { $in: missing } })
      .select('reportNumber invoiceNumber username paymentType netInvoice totalInvoice invoiceDate reportDate').lean();
    console.log('\nأمثلة:');
    rows.slice(0, 20).forEach((r) => console.log(`   فاتورة ${String(r.invoiceNumber).padEnd(8)} كشف ${String(r.reportNumber).padEnd(7)} ${String(r.username || '').slice(0, 26).padEnd(26)} ${r.paymentType || '—'} إجمالي=${r.totalInvoice || 0}`));
    const byType = {};
    rows.forEach((r) => { byType[r.paymentType || '—'] = (byType[r.paymentType || '—'] || 0) + 1; });
    console.log('\nحسب النوع:', JSON.stringify(byType));
  }

  console.log(`\nالفاتورة 11855 على كشف؟ ${await OperationsWorkflow.countDocuments({ invoiceNumber: '11855' })}`);
  console.log(`الفاتورة 11855 في الدفتر؟ ${await CollectionInvoice.countDocuments({ invoiceNumber: '11855' })}`);
  const near = await CollectionInvoice.find({ invoiceNumber: { $in: ['11848', '11849', '11854', '11856'] } }).select('invoiceNumber partyName').lean();
  console.log('جوارُها في الدفتر:', JSON.stringify(near.map((x) => x.invoiceNumber)));
  await mongoose.disconnect();
})();
