/**
 * purgeFutureWalletDays — يحذف يوميّاتِ العهدة التي لم يأتِ يومُها بعد.
 *
 *   node src/scripts/purgeFutureWalletDays.js --dry
 *   node src/scripts/purgeFutureWalletDays.js --apply
 *
 * ── من أين تأتي يوميّةٌ في المستقبل ─────────────────────────────────────────
 * من بابين: إقفالُ اليوم يجهّز يوميّةَ الغد بالرصيد المنقول — وهذا صحيحٌ في
 * ذاته وسيعود غدًا؛ ومن فتح الشاشةَ على تاريخٍ بعيد فأنشأته `getOrCreateWallet`
 * لمجرّد الطلب. الثاني هو العطب، وقد أُغلق بابُه في `config/walletStart`.
 *
 * وأثرُ الصفِّ الزائد ليس صفًّا زائدًا وحده: عرضُ الشهر يعدّ اليوميّات، فيقول
 * «١٣ يومًا» في الثاني عشر من الشهر — ورقمٌ يناقض التقويمَ على الشاشة يجعل
 * كلَّ رقمٍ بجانبه موضعَ شكّ.
 *
 * ── ولا يُحذَف إلّا الفارغُ المفتوح ─────────────────────────────────────────
 * يوميّةٌ في المستقبل عليها حركةٌ أو مبلغٌ أو أُقفلت ليست صفًّا تلقائيًّا: هي
 * شيءٌ فعله إنسانٌ بقصد، ولو بتاريخٍ خاطئ. حذفُها صامتًا يمحو عملَه ويترك
 * الرصيدَ ناقصًا بلا أثر. فتُطبَع وتُترَك لصاحبها.
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

  // ويومُ الغدِ ليس هدفًا: إقفالُ اليوم يجهّزه بالرصيد المنقول، والقيدُ بعد
  // منتصف الليل يقع فيه بحقّ. الهدفُ ما بعده — أيّامٌ لا عملَ فيها بحال.
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
    try { require('../websocket/socketManager').emitToAll('wallet:updated', {}); } catch (_) { /* خارج الخادم */ }
  } else if (!APPLY) {
    console.log('\n  لم يُحذَف شيء. أضف --apply للتنفيذ.');
  }
  console.log('');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
