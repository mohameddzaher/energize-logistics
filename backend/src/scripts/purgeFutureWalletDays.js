/**
 * Deletes wallet days whose date has not arrived.
 * Usage: node src/scripts/purgeFutureWalletDays.js --dry | --apply
 * Future days come from day closing preparing tomorrow with the carried balance (correct, and returns tomorrow), and from opening the screen on a far date, where getOrCreateWallet created one on request; that is the defect and is closed in config/walletStart. An extra row skews the month view's day count against the calendar.
 * Only empty open days are deleted; a future day with an entry, amount or closing was a deliberate human action, so it is printed and left.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const { lastWritableDay } = require('../config/walletStart');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const DailyWallet = require('../models/DailyWallet');
  const WalletTransaction = require('../models/WalletTransaction');
  require('../models/Branch');

  // Tomorrow is not a target: day closing prepares it with the carried balance, and an after-midnight entry legitimately lands there. The target is days after it, which never have work.
  const T = lastWritableDay();
  const future = await DailyWallet.find({ date: { $gt: T } }).populate('branch', 'name').sort({ date: 1 });
  console.log(`\n  آخرُ يومٍ مسموح ${T}${APPLY ? '' : '   — تجربة، بلا حذف —'}\n`);
  if (!future.length) { console.log('  لا يوميّاتٍ أبعدَ من الغد.\n'); await mongoose.disconnect(); return; }

  const empty = [];
  const kept = [];
  for (const w of future) {
    const n = await WalletTransaction.countDocuments({ wallet: w._id });
    const money = (w.totalCollections || 0) + (w.totalExpenses || 0) + (w.totalPurchases || 0);
    ((n || money || w.isClosed) ? kept : empty).push({ w, n, money });
  }

  console.log('  الفرع'.padEnd(16) + 'اليوم'.padStart(13) + 'حركات'.padStart(8) + 'مبالغ'.padStart(10) + '   المصير');
  console.log('  ' + '─'.repeat(66));
  for (const { w, n, money } of [...empty, ...kept]) {
    const doomed = empty.some((x) => String(x.w._id) === String(w._id));
    console.log('  ' + String(w.branch?.name || '—').padEnd(14) + String(w.date).padStart(13)
      + String(n).padStart(8) + String(money).padStart(10)
      + (doomed ? '   يُحذَف (فارغ ومفتوح)' : '   يبقى — عليه عملٌ حقيقيّ، يُراجَع'));
  }

  if (APPLY && empty.length) {
    await DailyWallet.deleteMany({ _id: { $in: empty.map((x) => x.w._id) } });
    console.log(`\n  ✔ حُذفت ${empty.length} يوميّة.`);
    try { require('../websocket/socketManager').emitToAll('wallet:updated', {}); } catch (_) { /* Outside the server. */ }
  } else if (!APPLY) {
    console.log('\n  لم يُحذَف شيء. أضف --apply للتنفيذ.');
  }
  console.log('');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
