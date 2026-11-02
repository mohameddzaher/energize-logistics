/**
 * Makes wallets per branch instead of per employee.
 * Usage: node src/scripts/mergeWalletsByBranch.js [--yes]
 * Each employee had a daily wallet, so branch cash was split across wallets only readable by summing. The merge moves all entries into one branch daily record per day and recomputes totals from entries rather than copying them. The balance chain is rebuilt from the branch's first day to the last (opening equals previous closing), so the final number matches the dashboard.
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

  // Branch and day to the daily records to be merged.
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

  // 1. Merge.
  let removed = 0; let moved = 0;
  for (const [, g] of groups) {
    // The survivor is the oldest: it was created first for that day.
    g.sort((a, b) => String(a._id).localeCompare(String(b._id)));
    const keep = g[0]; const drop = g.slice(1);
    if (drop.length) {
      const r = await WalletTransaction.updateMany(
        { wallet: { $in: drop.map((d) => d._id) } },
        { $set: { wallet: keep._id } },
      );
      moved += r.modifiedCount || 0;
      // Anything closed in any of them stays closed; closing is an acknowledgment the merge must not undo.
      const anyClosed = g.some((w) => w.isClosed);
      // Opening is the sum of the openings, not one of them. Branch cash in the morning is what all employees hold; taking only the first wallet drops the rest. Matters most on the branch's first day, the chain head.
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

  // 2. Recompute totals and the chain per branch.
  for (const bId of new Set(wallets.map((w) => String(w.branch)))) {
    const days = await DailyWallet.find({ branch: bId }).sort({ date: 1 });
    let prev = null;
    for (const d of days) {
      const tx = await WalletTransaction.find({ wallet: d._id }).select('type amount').lean();
      d.totalCollections = tx.filter((t) => t.type === 'collection').reduce((s, t) => s + n(t.amount), 0);
      d.totalExpenses = tx.filter((t) => t.type === 'expense').reduce((s, t) => s + n(t.amount), 0);
      d.totalPurchases = tx.filter((t) => t.type === 'purchase').reduce((s, t) => s + n(t.amount), 0);
      // The branch's first day keeps its own opening: it is the chain head with no predecessor.
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
