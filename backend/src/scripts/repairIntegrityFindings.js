/**
 * repairIntegrityFindings — ما وجده فحصُ السلامة، يُصلَح هنا.
 *
 *   node --max-old-space-size=8192 src/scripts/repairIntegrityFindings.js --dry
 *
 * ثلاثةُ إصلاحاتٍ لا رابعَ لها، وكلٌّ منها يُطبَع قبل أن يُكتب:
 *
 *  ① دفترُ العهدة يُعاد حسابُه من حركاته.
 *    وُجد يومٌ في الدمّام مجموعُ مشترياته ٧٥٠ ولا حركةَ شراءٍ فيه — مبلغٌ يدخل
 *    الرصيدَ ولا سطرَ يفسّره. تُعاد المجاميعُ من الحركات لكلّ يوم، ثمّ تُسلسَل
 *    الافتتاحيّاتُ من أوّل يومٍ في كلّ فرع — إذ ختاميُّ اليوم افتتاحيُّ ما بعده،
 *    فتصحيحُ يومٍ بلا تسلسلٍ يترك ما بعده محسوبًا على رقمٍ زال.
 *
 *  ② الكشفُ النقديُّ لا يحمل مبالغَ فاتورة.
 *    قلبُ نوعِ الدفع من الشاشة يُفرّغ خاناتِ الفاتورة (applyBillingRules)، أمّا
 *    القلبُ بسكربتٍ فيكتب الحقلَ وحدَه. فبقيت أربعةُ كشوفٍ نقديّةٍ تحمل صافيَ
 *    فاتورةٍ وضريبةً وإجماليًّا — أرقامٌ تُجمَع في تقارير الضريبة عن كشوفٍ لا
 *    فاتورةَ لها. تُفرَّغ كما تُفرَّغ من الشاشة تمامًا.
 *
 *  ③ «غير مطلوب» ليست رقمًا وظيفيًّا.
 *    ستّةُ موظّفين (كلُّهم منتهُو الخدمة) رقمُهم الوظيفيُّ النصُّ «غير مطلوب» —
 *    عبارةٌ من ورقة المصدر وقعت في خانة الرقم، فصاروا يتشاركون «رقمًا» واحدًا.
 *    والفراغُ هو الصادق: لا رقمَ لهم.
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

  // ═══ ① دفترُ العهدة ════════════════════════════════════════════════════
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

      // الافتتاحيُّ يتبع ختاميَّ ما قبله — إلّا أوّلَ يومٍ في الفرع، وإلّا
      // الافتتاحيّاتِ التي صُحِّحت يدًا بأمرِ صاحب الشركة (١ سبتمبر).
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
          // النقدُ المعدود ينتقل مع الختاميّ متى كان مساويًا له (فرقٌ صفر)؛
          // وفرقٌ معدودٌ حقيقيٌّ واقعةٌ تبقى.
          if (w.actualCash != null && r2(w.actualCash) === r2(w.closingBalance)) { w.actualCash = closing; w.cashDifference = 0; }
          w.closingBalance = closing;
          await w.save();
        }
      }
      carry = closing;
    }
  }
  console.log(`   ${DRY ? 'سيُصحَّح' : 'صُحِّح'}: ${fixedTotals} مجموعًا · ${fixedChain} افتتاحيًّا\n`);

  // ═══ ② الكشفُ النقديّ ══════════════════════════════════════════════════
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

  // ═══ ③ الرقمُ الوظيفيّ ═════════════════════════════════════════════════
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
