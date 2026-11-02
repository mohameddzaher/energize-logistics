/**
 * Corrects one opening balance and recomputes every later day.
 * Usage: node src/scripts/setWalletOpening.js --branch Riyadh --date 2026-09-01 --amount 9580.96 [--dry]
 * A day's closing is the next day's opening, so fixing one day alone leaves later days built on a stale number. Movements stay untouched and are re-summed over the new opening.
 * The counted cash is a physical fact and stays fixed; the difference is re-derived from the new closing (same as syncCashCount in the controller). Days with actualCash == null are skipped.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const arg = (name, def = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const DRY = process.argv.includes('--dry');
const BRANCH = arg('branch');
const DATE = arg('date');
const AMOUNT = arg('amount');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

(async () => {
  if (!BRANCH || !DATE || AMOUNT == null) {
    console.error('الاستعمال: --branch <اسم أو معرّف> --date YYYY-MM-DD --amount <رقم> [--dry]');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const Branch = require('../models/Branch');
  const DailyWallet = require('../models/DailyWallet');

  const branch = mongoose.isValidObjectId(BRANCH)
    ? await Branch.findById(BRANCH).lean()
    : await Branch.findOne({ name: new RegExp(`^${BRANCH}$`, 'i') }).lean();
  if (!branch) { console.error(`لا فرعَ باسم «${BRANCH}»`); process.exit(1); }

  const days = await DailyWallet.find({ branch: branch._id, date: { $gte: DATE } }).sort({ date: 1 });
  if (!days.length) { console.error(`لا يوميّاتٍ للفرع «${branch.name}» من ${DATE}`); process.exit(1); }
  if (days[0].date !== DATE) console.log(`ملاحظة: لا يوميّةَ بتاريخ ${DATE} بالضبط — أوّلُ يومٍ بعده ${days[0].date}`);

  console.log(DRY ? '— تجربة، بلا كتابة —\n' : '');
  console.log(`الفرع: ${branch.name} · من ${days[0].date} إلى ${days[days.length - 1].date} · ${days.length} يومًا\n`);
  console.log('  اليوم        افتتاحي قديم → جديد        الحركات                 ختامي قديم → جديد');
  console.log('  ' + '─'.repeat(92));

  let opening = r2(AMOUNT);
  for (const w of days) {
    const moves = r2((w.totalCollections || 0) - (w.totalExpenses || 0) - (w.totalPurchases || 0));
    const closing = r2(opening + moves);
    // Counted cash stays fixed; the difference is re-derived from the new closing (see header).
    // Sign follows the server convention (closing minus counted: positive is a shortage, negative a surplus), as closeDay writes it.
    const counted = w.actualCash == null ? null : r2(w.actualCash);
    const oldDiff = counted == null ? null : r2((w.closingBalance || 0) - counted);
    const newDiff = counted == null ? null : r2(closing - counted);

    console.log(`  ${w.date}   ${String(w.openingBalance).padStart(10)} → ${String(closing === opening ? opening : opening).padStart(10)}`
      + `   ${String(moves).padStart(11)}   ${String(w.closingBalance).padStart(10)} → ${String(closing).padStart(10)}`
      + (counted == null ? '   (لم يُعَدّ)' : `   (معدود ${counted} ثابت · الفرق ${oldDiff} → ${newDiff})`));

    if (!DRY) {
      w.openingBalance = opening;
      w.closingBalance = closing;
      // actualCash is not written: it is a physical fact that a ledger correction does not move.
      if (counted != null) w.cashDifference = newDiff;
      await w.save();
    }
    opening = closing;
  }

  console.log(`\n  ${DRY ? 'سيصير' : 'صار'} الرصيدُ بعد آخر يوم: ${opening}`);
  if (!DRY) {
    try {
      const { emitToAll } = require('../websocket/socketManager');
      emitToAll('wallet:updated', { branch: String(branch._id) });
    } catch (_) { /* Usually runs outside the server */ }
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
