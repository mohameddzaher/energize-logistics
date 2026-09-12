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
 * ── والنقدُ المعدودُ لا يتحرّك ──────────────────────────────────────────────
 *
 * على اليوم المقفول رقمان: **المعدود** وهو ما وجده الموظّف في الدرج بيده،
 * و**الختاميّ** وهو ما يقول الدفترُ إنّه ينبغي أن يكون. والفرقُ بينهما محسوبٌ
 * منهما: الختاميّ ناقص المعدود.
 *
 * وتصحيحُ رصيدٍ افتتاحيٍّ يحرّك الختاميَّ لكلّ يومٍ بعده. فأيُّ الرقمين يتبعه؟
 * كان السكربتُ يثبّت **الفرق** ويحرّك المعدود — فيوم عُدَّ درجُه فوُجد فيه
 * أربعةٌ وثلاثون ألفًا، ثمّ صُحّح افتتاحيُّ الشهر بعشرة آلاف، يُكتب معدودُه
 * أربعةً وأربعين ألفًا. وأحدٌ لم يعدّ أربعةً وأربعين ألفًا. تصحيحُ دفترٍ لا
 * يغيّر ما كان في الدرج.
 *
 * فالمعدودُ يثبت — هو الواقعةُ الماديّة الوحيدة في السطر — ويُعاد اشتقاقُ
 * الفرق من الختاميّ الجديد. وهو نفسُ ما يفعله `syncCashCount` في المتحكّم عند
 * كلّ تغيّرٍ في الختاميّ؛ ولو بقي السكربتُ على الاتّجاه المعاكس لأعطى اليومُ
 * الواحد رقمًا حين تُضاف إليه حركة ورقمًا آخر حين يُصحَّح افتتاحيُّه.
 *
 * واليومُ الذي لم يُعَدّ نقدُه (`actualCash == null`) لا يُمَسّ: لا معدودَ فيه
 * ولا فرق.
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
    // المعدودُ ثابت، والفرقُ يُعاد اشتقاقُه من الختاميّ الجديد — راجع الترويسة.
    // والإشارةُ اصطلاحُ الخادم: الختاميّ ناقص المعدود، موجبٌ عجزٌ وسالبٌ زيادة،
    // كما يكتبه `closeDay` وكما تقرؤه الشاشة.
    const counted = w.actualCash == null ? null : r2(w.actualCash);
    const oldDiff = counted == null ? null : r2((w.closingBalance || 0) - counted);
    const newDiff = counted == null ? null : r2(closing - counted);

    console.log(`  ${w.date}   ${String(w.openingBalance).padStart(10)} → ${String(closing === opening ? opening : opening).padStart(10)}`
      + `   ${String(moves).padStart(11)}   ${String(w.closingBalance).padStart(10)} → ${String(closing).padStart(10)}`
      + (counted == null ? '   (لم يُعَدّ)' : `   (معدود ${counted} ثابت · الفرق ${oldDiff} → ${newDiff})`));

    if (!DRY) {
      w.openingBalance = opening;
      w.closingBalance = closing;
      // `actualCash` لا يُكتب: واقعةٌ ماديّة لا يحرّكها تصحيحُ دفتر.
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
    } catch (_) { /* السكربت يعمل خارج الخادم غالبًا */ }
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
