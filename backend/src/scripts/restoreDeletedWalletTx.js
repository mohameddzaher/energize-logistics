/**
 * restoreDeletedWalletTx: restore a purchase movement deleted by mistake. Usage: node src/scripts/restoreDeletedWalletTx.js [--dry|--apply] What happened: a wallet-permission test called `deleteTransaction` with
 * the system-admin role to see if it was allowed, and deleted a real movement. How it was identified: the audit entry kept only `{type:'purchase', amount:1000}` and the id. The rest was recovered from two places:
 * - the saved `DailyWallet` copy from the 14th: Dammam purchases on the 1st were short by exactly 1000, giving branch and day. - the statement itself: one statement was paid 1000 from Dammam that day (number 86001,
 * driver Majid Ali Awadh) and is the only one with no matching movement. Restored with its original id so any reference elsewhere stays valid and the audit entry still points to the same thing.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const TX_ID = '6a96a1e84ca8948ef78e0732';
const WALLET_ID = '6a966414a2fdefbdb3b8515c';   // Dammam, 2026-09-01
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const WalletTransaction = require('../models/WalletTransaction');
  const DailyWallet = require('../models/DailyWallet');
  const OperationsWorkflow = require('../models/OperationsWorkflow');

  if (await WalletTransaction.findById(TX_ID)) {
    console.log('\n  الحركةُ موجودةٌ بالفعل — لا شيء يُفعَل.\n');
    await mongoose.disconnect();
    return;
  }

  const sib = await WalletTransaction.findOne({ wallet: WALLET_ID, type: 'purchase' }).lean();
  if (!sib) { console.error('لا حركةَ شقيقةٌ تُقاس عليها الحقولُ المشتركة'); process.exit(1); }
  const sheet = await OperationsWorkflow.findOne({ reportNumber: '86001' })
    .select('paymentAmount driverName payingBranch paymentDate').lean();

  const doc = {
    _id: new mongoose.Types.ObjectId(TX_ID),
    wallet: sib.wallet, user: sib.user, branch: sib.branch,
    date: '2026-09-01', type: 'purchase', amount: 1000, collectionSource: 'client',
    purchaseDeliveryStatementNumber: '86001',
    purchaseInvoiceAmount: 1000,
    purchaseDriverName: sheet?.driverName || 'ماجد علي عوضه',
    purchaseBranch: sheet?.payingBranch || 'الدمام',
    mismatchReason: null, receivedDocType: '', receivedDocNumber: '',
    receivedReportNumbers: [], receivedReports: [], isFlagged: false,
  };

  const w = await DailyWallet.findById(WALLET_ID);
  console.log(`\n  المحفظة: الدمّام · ${w.date}${APPLY ? '' : '   — تجربة، بلا كتابة —'}`);
  console.log(`  قبل:  مشتريات ${w.totalPurchases} · ختامي ${w.closingBalance}`);
  console.log(`  تُعاد: كشف ${doc.purchaseDeliveryStatementNumber} · ${doc.amount} · ${doc.purchaseDriverName}`);
  console.log(`  بعد:  مشتريات ${r2(w.totalPurchases + 1000)} · ختامي ${r2(w.closingBalance - 1000)}`);

  if (!APPLY) { console.log('\n  لم يُكتب شيء. أضف --apply للتنفيذ.\n'); await mongoose.disconnect(); return; }

  await WalletTransaction.create(doc);

  // Then recompute that day and every day after it. A day's closing is the next day's opening, so a movement returning on the 1st shifts all later balances of the branch. The counted cash stays and its difference is re-derived, as in setWalletOpening; what was found in the drawer is not changed because the ledger was corrected.
  const days = await DailyWallet.find({ branch: w.branch, date: { $gte: w.date } }).sort({ date: 1 });
  let opening = days[0].openingBalance;
  for (const d of days) {
    const txs = await WalletTransaction.find({ wallet: d._id }).select('type amount').lean();
    const sum = (t) => txs.filter((x) => x.type === t).reduce((a, x) => a + (x.amount || 0), 0);
    d.totalCollections = r2(sum('collection'));
    d.totalExpenses = r2(sum('expense'));
    d.totalPurchases = r2(sum('purchase'));
    d.openingBalance = r2(opening);
    d.closingBalance = r2(opening + d.totalCollections - d.totalExpenses - d.totalPurchases);
    if (d.actualCash != null) d.cashDifference = r2(d.closingBalance - d.actualCash);
    await d.save();
    opening = d.closingBalance;
  }
  console.log(`\n  ✔ أُعيدت الحركة، وأُعيد حسابُ ${days.length} يومًا للفرع.`);
  const after = await DailyWallet.findById(WALLET_ID).lean();
  console.log(`  الآن: مشتريات ${after.totalPurchases} · ختامي ${after.closingBalance}\n`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
