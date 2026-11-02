/**
 * Aligns the payment amount on every statement that has wallet purchases.
 * Usage: node src/scripts/syncWalletPayments.js (shows differences) [--apply] (writes them)
 * Why: the wallet filled the field only once when empty, so a save from the operations workflow wiped it or it kept an amount from before a custody edit. See utils/walletPayment.
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
