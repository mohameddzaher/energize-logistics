/**
 * restoreDeletedWalletTx — يُعيد حركةَ مشترياتٍ حُذفت خطأً يوم ١٦ سبتمبر ٢٠٢٦.
 *
 *   node src/scripts/restoreDeletedWalletTx.js --dry
 *   node src/scripts/restoreDeletedWalletTx.js --apply
 *
 * ── ما جرى ──────────────────────────────────────────────────────────────────
 * اختبارٌ لصلاحيّات المحفظة نادى `deleteTransaction` بدور «مدير النظام» ليرى
 * أيُسمَح له — فسُمح له، وحذفَ حركةً حقيقيّة. الاختبارُ كان يجب أن يجري على
 * حركةٍ مصطنعةٍ أو بلقطةٍ تسبقه، ولم يفعل.
 *
 * ── وكيف عُرفت ─────────────────────────────────────────────────────────────
 * قيدُ المراجعة حفظ `{type:'purchase', amount:1000}` والمعرّف — ولم يحفظ بقيّةَ
 * الحقول. فجُمعت من موضعين:
 *   • نسخةُ `DailyWallet` المحفوظة يوم ١٤ سبتمبر: مشترياتُ الدمّام في ١ سبتمبر
 *     نقصت ألفًا بالضبط، فتعيّن الفرعُ واليوم.
 *   • كشفُ التخريج نفسُه: كشفٌ واحدٌ سُدِّد بألفٍ ذلك اليوم من الدمّام — رقمُه
 *     ٨٦٠٠١، سائقُه «ماجد علي عوضه» — وهو الوحيدُ الذي لا حركةَ تقابله.
 *
 * وتُعاد بمعرّفها الأصليّ لا بمعرّفٍ جديد: أيُّ إحالةٍ إليها في مكانٍ آخر تعود
 * صحيحةً، والقيدُ في سجلّ المراجعة يبقى يشير إلى الشيء نفسِه.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const TX_ID = '6a96a1e84ca8948ef78e0732';
const WALLET_ID = '6a966414a2fdefbdb3b8515c';   // الدمّام · 2026-09-01
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

  // ── ثمّ يُعاد الحسابُ لهذا اليوم ولكلّ يومٍ بعده ─────────────────────────
  // ختاميُّ اليوم افتتاحيُّ الذي يليه، فحركةٌ تعود في أوّل سبتمبر تُزحزح كلَّ
  // أرصدة الفرع بعدها. والمعدودُ يثبت ويُعاد اشتقاقُ الفرق منه — كما في
  // setWalletOpening، لا يُغيَّر ما وُجد في الدرج لأنّ الدفتر صُحِّح.
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
