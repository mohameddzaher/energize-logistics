/**
 * setWalletOpening — يُصحَّح رصيدٌ افتتاحيٌّ واحد، وتتبعه الأيّامُ كلُّها.
 *
 *   node src/scripts/setWalletOpening.js --branch Riyadh --date 2026-09-01 --amount 9580.96 [--dry]
 *
 * ── ولماذا سكربتٌ لا تعديلٌ بالإيد ─────────────────────────────────────────
 * الرصيدُ الافتتاحيّ ليس خانةً قائمةً بذاتها: ختاميُّ اليوم هو افتتاحيُّ الذي
 * بعده. فتصحيحُ يومٍ واحدٍ في القاعدة يترك الأيّامَ التالية محسوبةً على رقمٍ
 * لم يعد موجودًا — دفترٌ كلُّ سطرٍ فيه صحيحٌ وحدَه وخاطئٌ في مجموعه، وهو أسوأ
 * من رقمٍ خاطئٍ ظاهر.
 *
 * فيُكتب الرقمُ مرّةً ويُعاد الحسابُ إلى آخر يوم: الحركاتُ لا تُمَسّ، وإنّما
 * يُعاد جمعُها فوق الافتتاحيّ الجديد.
 *
 * والفرقُ المعدود يُحفَظ: يومٌ عُدَّ نقدُه فوُجد أقلَّ من الدفتر بمئة يبقى ناقصًا
 * مئةً بعد التصحيح — الفرقُ واقعةٌ حدثت، لا نتيجةُ حساب. ويومٌ فرقُه صفرٌ يبقى
 * صفرًا، فينتقل «النقدُ المعدود» مع الختاميّ الجديد.
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
    // الفرقُ المعدود ينتقل كما هو — هو واقعةٌ لا نتيجةُ حساب.
    const delta = w.actualCash == null ? null : r2(w.actualCash - (w.closingBalance || 0));
    const newActual = delta == null ? null : r2(closing + delta);

    console.log(`  ${w.date}   ${String(w.openingBalance).padStart(10)} → ${String(closing === opening ? opening : opening).padStart(10)}`
      + `   ${String(moves).padStart(11)}   ${String(w.closingBalance).padStart(10)} → ${String(closing).padStart(10)}`
      + (delta ? `   (فرقٌ معدود ${delta} يبقى)` : ''));

    if (!DRY) {
      w.openingBalance = opening;
      w.closingBalance = closing;
      if (newActual != null) { w.actualCash = newActual; w.cashDifference = delta; }
      await w.save();
    }
    opening = closing;
  }

  console.log(`\n  ${DRY ? 'سيصير' : 'صار'} الرصيدُ بعد آخر يوم: ${opening}`);
  if (!DRY) {
    try {
      const { emitToAll } = require('../websocket/socketManager');
      emitToAll('wallet:updated', { branch: String(branch._id) });
    } catch (_) { /* السكربت يعمل خارج الخادم غالبًا */ }
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
