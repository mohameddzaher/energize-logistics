/**
 * syncWalletPayments — يطابق «مبلغ السداد» على كلّ كشفٍ له مشترياتٌ في المحفظة.
 *
 *   node src/scripts/syncWalletPayments.js          يعرض الفروق فقط
 *   node src/scripts/syncWalletPayments.js --apply  يكتبها
 *
 * لماذا: كانت المحفظةُ تملأ الخانةَ مرّةً إن كانت فارغة، فمسحها حفظُ الكشف من
 * سير عمل التشغيل أو بقيت على مبلغٍ قبل تعديل العهدة. راجع utils/walletPayment.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env'), quiet: true });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  require('../models/WalletTransaction');
  require('../models/OperationsWorkflow');
  const { walletPaidMap, syncSheetPayment } = require('../utils/walletPayment');
  const WalletTransaction = mongoose.model('WalletTransaction');
  const OperationsWorkflow = mongoose.model('OperationsWorkflow');
  const nums = (await WalletTransaction.distinct('purchaseDeliveryStatementNumber', { type: 'purchase' })).map((x) => String(x || '').trim()).filter(Boolean);
  const paid = await walletPaidMap(nums);
  const sheets = await OperationsWorkflow.find({ reportNumber: { $in: nums } }).select('reportNumber paymentAmount').lean();
  const diffs = sheets.filter((s) => Math.abs((Number(s.paymentAmount) || 0) - (paid.get(String(s.reportNumber).trim()) || 0)) >= 0.01);
  console.log(`كشوف لها مشتريات: ${sheets.length} · مختلفة عن المحفظة: ${diffs.length}`);
  for (const s of diffs) console.log(`  ${s.reportNumber}: الكشف ${Number(s.paymentAmount) || 0} ← المحفظة ${paid.get(String(s.reportNumber).trim())}`);
  if (APPLY) {
    let n = 0;
    for (const s of diffs) { if (await syncSheetPayment(s.reportNumber)) n += 1; }
    console.log(`✓ صُحِّح ${n}`);
  }
  process.exit(0);
})();
