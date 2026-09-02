/**
 * backfillPayingBranch — الفرعُ المسدِّد لما سُدِّد من العهدة ولم يُكتب فرعُه.
 *
 *   node src/scripts/backfillPayingBranch.js --dry
 *   node src/scripts/backfillPayingBranch.js
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * تسجيلُ مشترياتٍ برقم كشفٍ يملأ الكشفَ من نفسِه: المبلغُ والتاريخُ والفرع.
 * وكان الفرعُ يُقرأ من حساب الموظّف — وسبعةٌ وثلاثون من اثنين وخمسين حسابًا
 * نشطًا بلا فرعٍ عليه. فيمتلئ التاريخُ والمبلغُ ويبقى الفرعُ فارغًا بلا خطأ.
 *
 * وسكربتُ الربط الأوّل لم يكتب الفرعَ أصلًا: `paymentAmount` و`paymentDate`
 * وحدَهما.
 *
 * فبقيت كشوفٌ لها تاريخُ سدادٍ من العهدة ولا فرعَ لها — والتقاريرُ التي تُقرأ
 * بالفرع تُسقطها كلَّها.
 *
 * ── والمصدر ────────────────────────────────────────────────────────────────
 * العهدةُ نفسُها: كلُّ محفظةٍ تعرف فرعَها (مئةٌ وواحدٌ وأربعون، ولا واحدةَ بلا
 * فرع). والمالُ خرج من عهدة فرعٍ بعينه — فذلك هو الفرعُ الذي سدّد.
 *
 * ولا يُكتب فوق فرعٍ مكتوب: مَن صحّحه بيده يجده كما تركه.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const WalletTransaction = require('../models/WalletTransaction');
  const DailyWallet = require('../models/DailyWallet');
  const Branch = require('../models/Branch');
  const OW = require('../models/OperationsWorkflow');

  console.log(DRY ? '── تجربة، بلا كتابة ──\n' : '── تنفيذ ──\n');

  // ── والاسمُ عربيٌّ كما في العمود ──────────────────────────────────────
  // سجلاتُ الفروع إنجليزيّةٌ والعمودُ عربيّ. فيُترجَم عبر القائمة المرجعيّة
  // نفسِها التي تُملأ منها الخانةُ حين تُختار بيد — وإلّا دخل «Jeddah» إلى
  // جانب «جده» فانقسم الفرعُ الواحد قيمتين في كلّ تقرير.
  const { foldEn } = require('../utils/payingBranch');
  const Lookup = require('../models/Lookup');
  const lookup = await Lookup.find({ type: 'workflow_paying_branch' }).select('nameEn nameAr').lean();
  const arOf = new Map(lookup.map((r) => [foldEn(r.nameEn), r.nameAr]));
  const branches = new Map();
  const unmapped = new Set();
  for (const b of await Branch.find({}).select('name').lean()) {
    const ar = arOf.get(foldEn(b.name));
    if (ar) branches.set(String(b._id), ar);
    else unmapped.add(b.name);
  }
  if (unmapped.size) console.log(`فروعٌ لا نظيرَ لها في القائمة المرجعيّة (تُترك فارغةً): ${[...unmapped].join('، ')}`);

  const txs = await WalletTransaction.find({
    type: { $in: ['purchase', 'tax_invoice'] },
    $or: [
      { purchaseDeliveryStatementNumber: { $nin: [null, ''] } },
      { receivedDocNumber: { $nin: [null, ''] } },
    ],
  }).select('purchaseDeliveryStatementNumber receivedDocNumber wallet branch date').lean();
  console.log(`حركاتُ عهدةٍ تحمل رقمَ كشف: ${txs.length}`);

  const walletIds = [...new Set(txs.map((t) => String(t.wallet)).filter(Boolean))];
  const wallets = new Map((await DailyWallet.find({ _id: { $in: walletIds } }).select('branch').lean())
    .map((w) => [String(w._id), String(w.branch)]));

  // رقمُ الكشف ← اسمُ الفرع. وأحدثُ حركةٍ تفوز حين تعدّدت.
  const branchOf = new Map();
  let noBranch = 0;
  for (const t of txs.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const no = String(t.purchaseDeliveryStatementNumber || t.receivedDocNumber || '').trim();
    if (!no) continue;
    const bid = wallets.get(String(t.wallet)) || (t.branch && String(t.branch));
    const name = bid && branches.get(bid);
    if (!name) { noBranch += 1; continue; }
    branchOf.set(no, name);
  }
  console.log(`  أرقامُ كشوفٍ لها فرعٌ معروف: ${branchOf.size}`);
  if (noBranch) console.log(`  حركاتٌ لا يُعرف فرعُها (تُترك): ${noBranch}`);

  const nums = [...branchOf.keys()];
  const rows = [];
  for (let i = 0; i < nums.length; i += 1000) {
    rows.push(...await OW.find({ reportNumber: { $in: nums.slice(i, i + 1000) } })
      .select('reportNumber payingBranch paymentDate').lean());
  }
  console.log(`  منها كشوفٌ عندنا: ${rows.length}`);

  const ops = [];
  let already = 0;
  for (const r of rows) {
    if (r.payingBranch && String(r.payingBranch).trim()) { already += 1; continue; }
    const name = branchOf.get(r.reportNumber);
    if (!name) continue;
    ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { payingBranch: name } } } });
  }
  console.log(`  عليها فرعٌ مكتوبٌ فلا تُمَسّ: ${already}`);
  console.log(`\nكشوفٌ يُكتب لها الفرعُ المسدِّد: ${ops.length}`);

  const tally = {};
  for (const r of rows) if (!r.payingBranch) { const n = branchOf.get(r.reportNumber); if (n) tally[n] = (tally[n] || 0) + 1; }
  for (const [n, c] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`    ${String(c).padStart(5)}  ${n}`);

  if (!DRY && ops.length) {
    let done = 0;
    for (let i = 0; i < ops.length; i += 500) {
      const r = await OW.bulkWrite(ops.slice(i, i + 500), { ordered: false });
      done += r.modifiedCount || 0;
    }
    console.log(`\n✓ كُتب الفرعُ على ${done} كشفًا`);
  }

  const gap = await OW.countDocuments({
    paymentDate: { $ne: null },
    $or: [{ payingBranch: '' }, { payingBranch: null }, { payingBranch: { $exists: false } }],
  });
  console.log(`\nكشوفٌ لها تاريخُ سدادٍ ولا فرعَ مسدِّدٍ (من كلّ مصدر): ${gap}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
