/**
 * purgeAuditWalletLeftovers — ما تركه الفحصُ في عهدةِ فرعٍ حقيقيّ.
 *
 *   node src/scripts/purgeAuditWalletLeftovers.js --dry
 *
 * ── الواقعة ────────────────────────────────────────────────────────────────
 * سويتُ `auditWalletToCollections` تُنشئ حسابَها وكشوفَها وتحذفها، لكنّها كانت
 * تترك حركاتِ العهدة التي قيّدتها: مشترياتٍ بثمانمئةٍ وتحصيلاتٍ بألفٍ وثمانمئة
 * في محفظة فرع الرياض الحقيقيّة، تتراكم مع كلّ تشغيل. أربعٌ وأربعون حركةً
 * بثمانيةَ عشرَ ألفًا وأربعمئة ريال من مالٍ لا وجودَ له في دفترٍ يُقرأ.
 *
 * ── وكيف تُعرَف ────────────────────────────────────────────────────────────
 * صاحبُها حسابٌ لم يعد موجودًا: السويت تحذف حسابَها في النهاية، فتبقى حركاتُها
 * بمرجعٍ لا يُقابله مستخدم. وهذا وحدَه لا يكفي — قد يُحذف حسابُ موظّفٍ حقيقيّ
 * وتبقى حركاتُه، وهي حركاتٌ صحيحةٌ يجب ألّا تُمَسّ. فيُشترط معه أثرُ السويت
 * نفسِها: مبالغُها المعروفة وأرقامُ كشوفها ونصوصُها.
 *
 * وتُعاد بعدها مجاميعُ اليوم من حركاته الباقية، وإلّا بقي الرصيدُ محسوبًا على
 * مالٍ حُذف.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

/** أثرُ السويت: ما تكتبه هي ولا يكتبه موظّف. */
const isAuditRow = (t) => {
  if (String(t.itemName || '') === 'zz') return true;
  const rpt = String(t.purchaseDeliveryStatementNumber || t.deliveryStatementNumber || '');
  if (/^RPT-\d+$/.test(rpt) || /^ZZ/i.test(rpt)) return true;
  if (/^ZZ-SAND/i.test(String(t.purchaseReceiptNumber || ''))) return true;
  // تحصيلاتُ السويت: ألفٌ وثمانمئةٍ بلا وصفٍ ولا عميلٍ ولا كشف.
  if (t.type === 'collection' && t.amount === 1800 && !t.description && !t.customer && !rpt) return true;
  // قيدُ استلام فاتورةٍ ضريبيّة: إمّا بلا كشوفٍ ولا مالٍ أصلًا، وإمّا يحمل
  // أرقامَ السويت نفسِها (RPT-0000x و«zz-لا-وجود-له»).
  if (t.type === 'tax_invoice') {
    const list = (t.receivedReportNumbers || []).map(String);
    if (!t.amount && !list.length && !t.receivedDocNumber) return true;
    if (list.some((n) => /^RPT-\d+$/.test(n) || /zz/i.test(n))) return true;
    if (/^RPT-\d+$/.test(String(t.receivedDocNumber || '')) || /zz/i.test(String(t.receivedDocNumber || ''))) return true;
  }
  return false;
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const WalletTransaction = require('../models/WalletTransaction');
  const DailyWallet = require('../models/DailyWallet');
  const User = require('../models/User');
  const Branch = require('../models/Branch');

  console.log(DRY ? '— تجربة، بلا حذف —\n' : '');
  const users = new Set((await User.find({}).select('_id').lean()).map((u) => String(u._id)));
  const all = await WalletTransaction.find({}).lean();
  // الشرطان معًا: صاحبُها غيرُ موجود **و** عليها أثرُ السويت.
  const doomed = all.filter((t) => t.user && !users.has(String(t.user)) && isAuditRow(t));
  const orphanOnly = all.filter((t) => t.user && !users.has(String(t.user)) && !isAuditRow(t));

  console.log(`حركاتُ العهدة كلُّها: ${all.length}`);
  console.log(`  صاحبُها حسابٌ محذوف وعليها أثرُ السويت (تُحذف): ${doomed.length}`);
  console.log(`  صاحبُها حسابٌ محذوف بلا أثرِ سويت (تبقى — قد تكون حركاتِ موظّفٍ غادر): ${orphanOnly.length}`);

  const byWallet = new Map();
  for (const t of doomed) {
    const k = `${t.branch}|${t.date}`;
    if (!byWallet.has(k)) byWallet.set(k, []);
    byWallet.get(k).push(t);
  }
  const branches = new Map((await Branch.find({}).select('name').lean()).map((b) => [String(b._id), b.name]));
  for (const [k, list] of byWallet) {
    const [b, d] = k.split('|');
    const sum = list.reduce((s, t) => s + (t.amount || 0), 0);
    console.log(`  · ${(branches.get(b) || b).padEnd(14)} ${d}  ${String(list.length).padStart(3)} حركة  ${sum.toLocaleString()} ر.س`);
  }

  if (!DRY && doomed.length) {
    await WalletTransaction.deleteMany({ _id: { $in: doomed.map((t) => t._id) } });
    console.log(`\n✓ حُذفت ${doomed.length} حركة`);

    // ── وتُعاد المجاميعُ من الحركات الباقية ────────────────────────────────
    for (const k of byWallet.keys()) {
      const [b, d] = k.split('|');
      const w = await DailyWallet.findOne({ branch: b, date: d });
      if (!w) continue;
      const rest = await WalletTransaction.find({ branch: b, date: d }).lean();
      const sum = (type) => rest.filter((t) => t.type === type).reduce((s, t) => s + (t.amount || 0), 0);
      w.totalCollections = sum('collection');
      w.totalExpenses = sum('expense');
      w.totalPurchases = sum('purchase');
      const closing = Math.round((w.openingBalance + w.totalCollections - w.totalExpenses - w.totalPurchases) * 100) / 100;
      // الفرقُ المعدود واقعةٌ تبقى؛ والنقدُ المعدود ينتقل مع الختاميّ إن كان مساويًا له.
      if (w.actualCash != null && Math.round(w.actualCash * 100) === Math.round(w.closingBalance * 100)) {
        w.actualCash = closing; w.cashDifference = 0;
      }
      w.closingBalance = closing;
      await w.save();
      console.log(`  أُعيد حسابُ ${branches.get(b) || b} ${d}: تحصيل ${w.totalCollections} · مشتريات ${w.totalPurchases} · ختامي ${closing}`);
    }
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
