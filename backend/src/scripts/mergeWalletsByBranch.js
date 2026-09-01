/**
 * mergeWalletsByBranch — المحفظةُ تصير للفرع لا للموظّف.
 *
 *   node src/scripts/mergeWalletsByBranch.js [--yes]
 *
 * ── لماذا الدمجُ لا الحذف ───────────────────────────────────────────────────
 * لكلّ موظّفٍ كانت يوميّتُه، والفرعُ الواحد فيه أكثرُ من موظّف. فنقدُ الفرع
 * موزَّعٌ على محافظَ لا تُقرأ إلّا بجمعها. والدمجُ يجمعها كما كانت تُجمع في
 * التقرير: الحركاتُ كلُّها تُنقَل إلى يوميّةٍ واحدةٍ للفرع في ذلك اليوم،
 * والمجاميعُ تُعاد من الحركات لا تُنسَخ.
 *
 * ── وسلسلةُ الأرصدة تُعاد بناؤها ────────────────────────────────────────────
 * الافتتاحيُّ ختاميُّ اليوم السابق. وبعد الدمج يختلف كلُّ يومٍ عمّا كان، فلا
 * يصحّ نقلُ الأرصدة كما هي: تُعاد من أوّل يومٍ للفرع إلى آخره، فيبقى الرقمُ
 * الأخيرُ هو ما تعرضه اللوحةُ اليوم بالضبط.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const DailyWallet = require('../models/DailyWallet');
const WalletTransaction = require('../models/WalletTransaction');
const Branch = require('../models/Branch');

const APPLY = process.argv.includes('--yes');
const n = (v) => Number(v) || 0;

(async () => {
  console.log('\n' + '='.repeat(74));
  console.log(APPLY ? '  دمجُ المحافظ بالفرع — تنفيذ' : '  دمجُ المحافظ بالفرع — فحصٌ فقط');
  console.log('='.repeat(74));
  await mongoose.connect(process.env.MONGODB_URI);

  const wallets = await DailyWallet.find({}).sort({ date: 1 }).lean();
  const branches = new Map((await Branch.find({}).select('name').lean()).map((b) => [String(b._id), b.name]));

  // فرع|يوم → اليوميّات التي ستُدمج
  const groups = new Map();
  for (const w of wallets) {
    const k = `${String(w.branch)}|${w.date}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(w);
  }
  const multi = [...groups.values()].filter((g) => g.length > 1);

  console.log(`\n  يوميّات: ${wallets.length} · بعد الدمج: ${groups.size}`);
  console.log(`  أيّامٌ فيها أكثرُ من محفظةٍ للفرع الواحد: ${multi.length}`);
  const byBranch = {};
  for (const [k, g] of groups) {
    const b = branches.get(k.split('|')[0]) || '—';
    byBranch[b] = byBranch[b] || { days: 0, merged: 0 };
    byBranch[b].days += 1;
    if (g.length > 1) byBranch[b].merged += g.length - 1;
  }
  Object.entries(byBranch).forEach(([b, v]) =>
    console.log(`     ${b.padEnd(14)} ${String(v.days).padStart(4)} يومًا · تُدمَج ${v.merged} يوميّة`));

  if (!APPLY) { console.log('\n  فحصٌ فقط — أضِف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  const dir = path.join(__dirname, '../../backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `walletMerge-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify({
    at: new Date(), wallets, transactions: await WalletTransaction.find({}).lean(),
  }, null, 1));
  console.log(`\n  نسخةٌ محفوظة: ${path.relative(process.cwd(), backup)}`);

  // ── ١ · الدمج ─────────────────────────────────────────────────────────────
  let removed = 0; let moved = 0;
  for (const [, g] of groups) {
    // الباقيةُ أقدمُها: هي التي أُنشئت أوّلًا لذلك اليوم.
    g.sort((a, b) => String(a._id).localeCompare(String(b._id)));
    const keep = g[0]; const drop = g.slice(1);
    if (drop.length) {
      const r = await WalletTransaction.updateMany(
        { wallet: { $in: drop.map((d) => d._id) } },
        { $set: { wallet: keep._id } },
      );
      moved += r.modifiedCount || 0;
      // ما أُقفل في أيٍّ منها يبقى مقفلًا: الإقفالُ إقرارٌ لا يُلغى بالدمج.
      const anyClosed = g.some((w) => w.isClosed);
      // ── والافتتاحيُّ مجموعُ افتتاحيّاتها لا واحدًا منها ────────────────────
      // نقدُ الفرع في صباح اليوم هو ما في أيدي موظّفيه مجتمعين. وأخذُ افتتاحيِّ
      // أوّلِ محفظةٍ وحدَه يُسقِط ما في يد الباقين. ويهمُّ هذا في أوّل يومٍ
      // للفرع خاصّةً — فهو رأسُ السلسلة، وما بعده يُشتقّ منه.
      await DailyWallet.updateOne({ _id: keep._id }, {
        $set: {
          isClosed: anyClosed,
          user: null,
          openingBalance: g.reduce((t, w) => t + n(w.openingBalance), 0),
        },
        ...(anyClosed ? {} : { $unset: { closedAt: 1, closedBy: 1 } }),
      });
      await DailyWallet.deleteMany({ _id: { $in: drop.map((d) => d._id) } });
      removed += drop.length;
    } else if (keep.user) {
      await DailyWallet.updateOne({ _id: keep._id }, { $set: { user: null } });
    }
  }
  console.log(`  دُمج: ${removed} يوميّةً · نُقل ${moved} حركة`);

  // ── ٢ · إعادةُ المجاميع والسلسلة لكلّ فرع ─────────────────────────────────
  for (const bId of new Set(wallets.map((w) => String(w.branch)))) {
    const days = await DailyWallet.find({ branch: bId }).sort({ date: 1 });
    let prev = null;
    for (const d of days) {
      const tx = await WalletTransaction.find({ wallet: d._id }).select('type amount').lean();
      d.totalCollections = tx.filter((t) => t.type === 'collection').reduce((s, t) => s + n(t.amount), 0);
      d.totalExpenses = tx.filter((t) => t.type === 'expense').reduce((s, t) => s + n(t.amount), 0);
      d.totalPurchases = tx.filter((t) => t.type === 'purchase').reduce((s, t) => s + n(t.amount), 0);
      // أوّلُ يومٍ للفرع يحتفظ بافتتاحيّه — هو رأسُ السلسلة ولا سابقَ له.
      if (prev !== null) d.openingBalance = prev;
      d.closingBalance = n(d.openingBalance) + d.totalCollections - d.totalExpenses - d.totalPurchases;
      await d.save();
      prev = d.closingBalance;
    }
    console.log(`     ${(branches.get(bId) || bId).padEnd(14)} ${days.length} يومًا · آخر رصيد: ${prev}`);
  }
  console.log('');
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
