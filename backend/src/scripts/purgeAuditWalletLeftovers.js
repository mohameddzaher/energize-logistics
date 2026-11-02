/**
 * Purges what the audit left in a real branch's custody.
 * Usage: node src/scripts/purgeAuditWalletLeftovers.js --dry
 * The auditWalletToCollections suite created and deleted its account and statements but left the custody entries it recorded in the real Riyadh branch wallet, piling up per run.
 * Identified by an owner account that no longer exists plus the suite's own traces (known amounts, statement numbers, texts), since a deleted real employee's entries must not be touched. Day totals are then recomputed from remaining entries.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

/** The suite's trace: what it writes and an employee does not. */
const isAuditRow = (t) => {
  if (String(t.itemName || '') === 'zz') return true;
  const rpt = String(t.purchaseDeliveryStatementNumber || t.deliveryStatementNumber || '');
  if (/^RPT-\d+$/.test(rpt) || /^ZZ/i.test(rpt)) return true;
  if (/^ZZ-SAND/i.test(String(t.purchaseReceiptNumber || ''))) return true;
  // The suite's collections: a fixed amount with no description, customer or statement.
  if (t.type === 'collection' && t.amount === 1800 && !t.description && !t.customer && !rpt) return true;
  // A tax invoice receipt entry: either no reports and no money at all, or carrying the suite's own numbers (RPT-0000x and a nonexistent marker).
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
  // Both conditions: the owner is missing and the suite's trace is present.
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

    // Recompute totals from the remaining entries.
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
      // A counted difference is a real event and stays; counted cash moves with the closing balance when equal to it.
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
