/**
 * backfillPayingBranch: the paying branch for manifests paid from custody whose branch was not written.
 * Usage: node src/scripts/backfillPayingBranch.js --dry | (no flag to write)
 * The branch was read from the employee account, which often has none, so date and amount filled but branch stayed empty. Source now: the custody wallet, which always knows its branch.
 * An existing branch is never overwritten.
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

  // The name is Arabic as in the column
  // Branch records are English and the column is Arabic. It is translated through the same reference list used when the field is picked by hand; otherwise "Jeddah" would sit beside its Arabic name and split one branch into two values in every report.
  // Same matching the wallet writes with (utils/payingBranch), including heavy transport.
  const { matchPayingBranch, resolvePayingBranch } = require('../utils/payingBranch');
  const Lookup = require('../models/Lookup');
  const lookup = await Lookup.find({ type: 'workflow_paying_branch', deleted: { $ne: true } }).select('key nameEn nameAr').lean();
  const branches = new Map();
  const unmapped = new Set();
  for (const b of await Branch.find({}).select('name').lean()) {
    branches.set(String(b._id), b.name);
    if (!matchPayingBranch(b.name, lookup)) unmapped.add(b.name);
  }
  if (unmapped.size) console.log(`فروعٌ لا نظيرَ لها في القائمة المرجعيّة (تُترك فارغةً): ${[...unmapped].join('، ')}`);

  const txs = await WalletTransaction.find({
    type: { $in: ['purchase', 'tax_invoice'] },
    $or: [
      { purchaseDeliveryStatementNumber: { $nin: [null, ''] } },
      { receivedDocNumber: { $nin: [null, ''] } },
    ],
  }).select('purchaseDeliveryStatementNumber receivedDocNumber wallet branch date user').lean();
  console.log(`حركاتُ عهدةٍ تحمل رقمَ كشف: ${txs.length}`);

  const walletIds = [...new Set(txs.map((t) => String(t.wallet)).filter(Boolean))];
  const wallets = new Map((await DailyWallet.find({ _id: { $in: walletIds } }).select('branch').lean())
    .map((w) => [String(w._id), String(w.branch)]));

  const User = require('../models/User');
  const roles = new Map((await User.find({ _id: { $in: [...new Set(txs.map((t) => String(t.user)).filter(Boolean))] } })
    .select('role').lean()).map((u) => [String(u._id), u.role]));
  const allNums = [...new Set(txs.map((t) => String(t.purchaseDeliveryStatementNumber || t.receivedDocNumber || '').trim()).filter(Boolean))];
  const sheetOf = new Map();
  for (let i = 0; i < allNums.length; i += 1000) {
    for (const s of await OW.find({ reportNumber: { $in: allNums.slice(i, i + 1000) } }).select('reportNumber fleetShipment branch').lean()) sheetOf.set(s.reportNumber, s);
  }

  // Manifest number -> branch name; the latest movement wins when there are several.
  const branchOf = new Map();
  let noBranch = 0;
  for (const t of txs.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const no = String(t.purchaseDeliveryStatementNumber || t.receivedDocNumber || '').trim();
    if (!no) continue;
    const bid = wallets.get(String(t.wallet)) || (t.branch && String(t.branch));
    const name = resolvePayingBranch({ branchName: bid && branches.get(bid), role: roles.get(String(t.user)), workflow: sheetOf.get(no) }, lookup);
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

  // Fleet rows mirrored before the owner column existed: the periodic pass reads recent edits only.
  const ownerless = { fleetShipment: { $type: 'objectId' }, $or: [{ carOwner: '' }, { carOwner: null }, { carOwner: { $exists: false } }] };
  console.log(`\nصفوفُ أسطولٍ بلا مالك: ${await OW.countDocuments(ownerless)}`);
  if (!DRY) await OW.updateMany(ownerless, { $set: { carOwner: 'شركة تنشيط', ownerName: 'شركة تنشيط' } });

  const gap = await OW.countDocuments({
    paymentDate: { $ne: null },
    $or: [{ payingBranch: '' }, { payingBranch: null }, { payingBranch: { $exists: false } }],
  });
  console.log(`\nكشوفٌ لها تاريخُ سدادٍ ولا فرعَ مسدِّدٍ (من كلّ مصدر): ${gap}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
