/**
 * backfillPurchasePayments: wallet purchases fill the payment amount on their manifests.
 * Usage: node src/scripts/backfillPurchasePayments.js --dry | (no flag to write) | --from 2026-09-01
 * Earlier purchases stayed only in the wallet; they are carried over instead of keyed by hand.
 * Limited to --from onward because earlier manifests are closed and locked; only empty values are filled.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { flexSpaceRegex } = require('../utils/plateKey');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const iF = argv.indexOf('--from');
const FROM = iF >= 0 && argv[iF + 1] ? argv[iF + 1] : '2026-09-01';

const money = (n) => (Number(n) || 0).toLocaleString('en-US');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const WalletTransaction = require('../models/WalletTransaction');
  const OperationsWorkflow = require('../models/OperationsWorkflow');

  console.log(DRY ? '— تجربة، بلا كتابة —' : '');
  console.log(`المدى: من ${FROM} حتى اليوم\n`);

  // The movement's date is a YYYY-MM-DD string, so string comparison is correct and more exact than converting to a Date (no time zone involved).
  const txns = await WalletTransaction.find({
    type: 'purchase',
    date: { $gte: FROM },
    purchaseDeliveryStatementNumber: { $nin: [null, ''] },
  }).select('date amount purchaseDeliveryStatementNumber user branch').sort({ date: 1 }).lean();

  console.log(`مشترياتٌ برقم كشف: ${txns.length}\n`);
  if (!txns.length) { await mongoose.disconnect(); return; }

  // Manifests are read in one batch: a round trip per movement would be hundreds of trips on a cluster with ~90 ms latency.
  const numbers = [...new Set(txns.map((t) => String(t.purchaseDeliveryStatementNumber).trim()))];
  const reports = await OperationsWorkflow.find({
    $or: numbers.map((n) => ({ reportNumber: flexSpaceRegex(n) })),
  }).select('reportNumber paymentAmount paymentDate purchaseValue').lean();

  const byNumber = new Map();
  for (const r of reports) byNumber.set(String(r.reportNumber || '').replace(/\s+/g, '').toLowerCase(), r);
  const find = (n) => byNumber.get(String(n).replace(/\s+/g, '').toLowerCase());

  const ops = [];
  let filled = 0; let already = 0; let missing = 0; let mismatched = 0;
  const notFound = []; const differences = [];

  for (const t of txns) {
    const num = String(t.purchaseDeliveryStatementNumber).trim();
    const r = find(num);
    if (!r) { missing += 1; notFound.push({ num, date: t.date, amount: t.amount }); continue; }

    const patch = {};
    if (!r.paymentAmount) patch.paymentAmount = t.amount;
    if (!r.paymentDate) patch.paymentDate = new Date(t.date);
    if (!Object.keys(patch).length) { already += 1; continue; }

    // A difference is reported but does not block: the agreed amount may differ from what is recorded in the platform.
    const expected = Number(r.purchaseValue) || 0;
    if (expected > 0 && Math.abs(expected - t.amount) > 0.5) {
      mismatched += 1;
      differences.push({ num: r.reportNumber, expected, paid: t.amount, diff: Math.round((t.amount - expected) * 100) / 100 });
    }

    ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: patch } } });
    filled += 1;
  }

  if (ops.length && !DRY) {
    for (let i = 0; i < ops.length; i += 500) {
      await OperationsWorkflow.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    }
  }

  console.log(`مُلئ: ${filled}`);
  console.log(`فيها مبلغٌ من قبل فلم تُمَسّ: ${already}`);
  console.log(`رقمُ كشفٍ لا يقابله كشف: ${missing}`);
  if (notFound.length) {
    console.log('\n  أرقامٌ لم تُوجَد:');
    for (const n of notFound.slice(0, 20)) console.log(`    ${n.date}  ${n.num}  ${money(n.amount)}`);
    if (notFound.length > 20) console.log(`    … و${notFound.length - 20} غيرها`);
  }
  if (differences.length) {
    console.log(`\n  اختلافُ سعر الشراء (${differences.length}) — تُعلَّم ولا تُمنع:`);
    for (const d of differences.slice(0, 20)) {
      console.log(`    ${d.num}  المسجَّل ${money(d.expected)}  المدفوع ${money(d.paid)}  فرق ${money(d.diff)}`);
    }
    if (differences.length > 20) console.log(`    … و${differences.length - 20} غيرها`);
  }

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
