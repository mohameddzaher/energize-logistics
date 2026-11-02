require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const wf = require('../controllers/workflowController');
  const OperationsWorkflow = require('../models/OperationsWorkflow');

  // The rule is tested directly through the exported function if present, otherwise through save.
  const sample = await OperationsWorkflow.findOne({ paymentType: 'cash', paymentAmount: { $gt: 0 } })
    .select('reportNumber paymentAmount netInvoice tax totalInvoice deliveryDate collectionDate invoiceNumber').lean();
  console.log('كشفٌ نقديٌّ عليه مبلغُ سداد:');
  console.log('  ', JSON.stringify(sample, null, 0));

  const cash = await OperationsWorkflow.countDocuments({ paymentType: 'cash' });
  const withAmt = await OperationsWorkflow.countDocuments({ paymentType: 'cash', paymentAmount: { $gt: 0 } });
  const zeroed = await OperationsWorkflow.countDocuments({ paymentType: 'cash', paymentAmount: { $gt: 0 }, netInvoice: 0 });
  console.log(`\nكشوفٌ نقديّة: ${cash} · منها بمبلغِ سداد: ${withAmt} · ومنها صافي الفاتورة صفر: ${zeroed}`);
  console.log('   (هذه هي التي كان القفلُ يُصفِّرها وستُملأ بما دُفع عند أوّل حفظ)');

  // Where did the payment amount come from? The wallet fills it.
  const DailyWallet = require('../models/DailyWallet');
  const wallets = await DailyWallet.countDocuments({});
  console.log(`\nمحافظُ العهدة: ${wallets}`);
  await mongoose.disconnect();
})();
