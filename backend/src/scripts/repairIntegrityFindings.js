/**
 * repairIntegrityFindings: fixes for what the integrity check found. Usage: node --max-old-space-size=8192 src/scripts/repairIntegrityFindings.js --dry Three fixes only, each printed before it is written: 1) The custody ledger is
 * recomputed from its movements. A day had a purchases total with no purchase movement behind it. Totals are recomputed per day from movements, then openings are chained from the first day of each branch, since a day's closing is
 * the next day's opening. 2) A cash statement must not carry invoice amounts. Flipping payment type from a script writes only that field, unlike the screen (applyBillingRules), leaving cash statements with invoice net, tax and total.
 * They are cleared exactly as the screen clears them. 3) The text 'not required' is not a job number. Six ended employees had that sheet phrase in the number field and so shared one 'number'. Empty is the truthful value.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const DW = require('../models/DailyWallet');
  const WT = require('../models/WalletTransaction');
  const Branch = require('../models/Branch');
  const OW = require('../models/OperationsWorkflow');
  const Employee = require('../models/Employee');
  const logAudit = require('../utils/auditLogger');

  console.log(DRY ? '— تجربة، بلا كتابة —\n' : '');

  // 1) Custody ledger
  console.log('① دفترُ العهدة — يُعاد من حركاته ثمّ يُسلسَل');
  let fixedTotals = 0; let fixedChain = 0;
  for (const b of await Branch.find({}).select('name').lean()) {
    const days = await DW.find({ branch: b._id }).sort({ date: 1 });
    let carry = null;
    for (const w of days) {
      const ts = await WT.find({ branch: b._id, date: w.date }).select('type amount').lean();
      const sum = (t) => r2(ts.filter((x) => x.type === t).reduce((a, x) => a + (x.amount || 0), 0));
      const col = sum('collection'); const exp = sum('expense'); const pur = sum('purchase');
      const totalsWrong = col !== r2(w.totalCollections) || exp !== r2(w.totalExpenses) || pur !== r2(w.totalPurchases);

      // An opening follows the previous closing, except the first day of a branch and openings corrected by hand on the owner's order.
      const keepOpening = carry === null || w.date === '2026-09-01';
      const opening = keepOpening ? r2(w.openingBalance) : carry;
      const chainWrong = !keepOpening && r2(w.openingBalance) !== carry;
      const closing = r2(opening + col - exp - pur);

      if (totalsWrong || chainWrong || closing !== r2(w.closingBalance)) {
        console.log(`   ${b.name.padEnd(14)} ${w.date}` +
          (totalsWrong ? `  مجاميع: ${w.totalCollections}/${w.totalExpenses}/${w.totalPurchases} → ${col}/${exp}/${pur}` : '') +
          (chainWrong ? `  افتتاحي: ${w.openingBalance} → ${opening}` : '') +
          `  ختامي: ${w.closingBalance} → ${closing}`);
        if (totalsWrong) fixedTotals += 1;
        if (chainWrong) fixedChain += 1;
        if (!DRY) {
          w.totalCollections = col; w.totalExpenses = exp; w.totalPurchases = pur;
          w.openingBalance = opening;
          // The counted cash moves with the closing when equal to it (zero difference); a real counted difference is a fact and stays.
          if (w.actualCash != null && r2(w.actualCash) === r2(w.closingBalance)) { w.actualCash = closing; w.cashDifference = 0; }
          w.closingBalance = closing;
          await w.save();
        }
      }
      carry = closing;
    }
  }
  console.log(`   ${DRY ? 'سيُصحَّح' : 'صُحِّح'}: ${fixedTotals} مجموعًا · ${fixedChain} افتتاحيًّا\n`);

  // 2) Cash statement
  console.log('② الكشفُ النقديُّ لا يحمل مبالغَ فاتورة');
  const cash = await OW.find({
    paymentType: 'cash',
    $or: [{ netInvoice: { $gt: 0 } }, { tax: { $gt: 0 } }, { totalInvoice: { $gt: 0 } }],
  }).select('reportNumber netInvoice tax totalInvoice invoiceNumber username').lean();
  for (const c of cash) {
    console.log(`   كشف ${c.reportNumber}  صافي ${c.netInvoice} · ضريبة ${c.tax} · إجمالي ${c.totalInvoice} → أصفار   ${c.username || ''}`);
  }
  if (!DRY && cash.length) {
    await OW.updateMany({ _id: { $in: cash.map((c) => c._id) } },
      { $set: { netInvoice: 0, tax: 0, totalInvoice: 0 } });
  }
  console.log(`   ${DRY ? 'سيُفرَّغ' : 'فُرِّغ'}: ${cash.length} كشفًا\n`);

  // 3) Job number
  console.log('③ «غير مطلوب» ليست رقمًا وظيفيًّا');
  const bad = await Employee.find({ employeeNumber: /^\s*غير\s*مطلوب\s*$/ })
    .select('employeeNumber arabicName englishName employmentStatus').lean();
  for (const e of bad) console.log(`   ${(e.arabicName || e.englishName || '?').slice(0, 34).padEnd(36)} «${e.employeeNumber}» → (فارغ)   ${e.employmentStatus}`);
  if (!DRY && bad.length) {
    await Employee.updateMany({ _id: { $in: bad.map((e) => e._id) } }, { $set: { employeeNumber: '' } });
  }
  console.log(`   ${DRY ? 'سيُفرَّغ' : 'فُرِّغ'}: ${bad.length} رقمًا\n`);

  if (!DRY) {
    await logAudit({
      bySystem: true, action: 'repair_integrity', entity: 'System',
      changes: { walletTotals: fixedTotals, walletChain: fixedChain, cashInvoiceCleared: cash.length, employeeNumberCleared: bad.length },
      ipAddress: 'script',
    });
    try { const c = require('../utils/ttlCache'); c.clear('wf:'); c.clear('colledger:'); c.clear('wallet:'); } catch (_) {}
    console.log('✓ قُيِّد في سجلّ المراجعة.');
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
