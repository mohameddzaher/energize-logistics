/**
 * startWalletFrom — يجعل دفترَ العهدة يبدأ من يومٍ بعينه، وما قبله لا وجودَ له.
 *
 *   node src/scripts/startWalletFrom.js --dry
 *   node src/scripts/startWalletFrom.js --apply
 *   node src/scripts/startWalletFrom.js --apply --date 2026-09-01
 *
 * ── ما يفعله ────────────────────────────────────────────────────────────────
 * ① يحفظ نسخةً كاملةً ممّا سيُحذَف في ملفّ JSON قبل أن يمسّ شيئًا.
 * ② يحذف كلَّ حركةٍ وكلَّ يوميّةٍ قبل يوم البداية، في الفروع كلِّها.
 * ③ يطبع ما بقي: أوّلُ يومٍ لكلّ فرع ورصيدُه الافتتاحيّ.
 *
 * ── ولماذا النسخةُ الاحتياطيّة أوّلًا ──────────────────────────────────────
 * الحذفُ هنا يمسّ ألفَيْ حركةٍ ومئةً وثلاثين يوميّةً في بياناتٍ حقيقيّة، ولا
 * تراجعَ عنه في القاعدة. والملفُّ ليس رفاهيّةً: هو الجوابُ الوحيد لسؤالٍ
 * يُسأل بعد شهر — «كم كان مصروفُ جدّة في أغسطس؟» — بعد أن صار الدفترُ لا يعرف
 * أغسطس.
 *
 * ── ولماذا لا يُمَسّ الرصيدُ الافتتاحيُّ ليوم البداية ──────────────────────
 * هو رقمٌ مُقَرٌّ لا محسوب: «ما كان في الخزنة ذلك الصباح». حذفُ ما قبله لا
 * يغيّره، وتصحيحُه فعلٌ آخرُ له سكربتُه — `setWalletOpening.js` — لأنّه يجرّ
 * وراءه إعادةَ حساب كلِّ يومٍ بعده.
 *
 * والمنعُ الدائمُ ليس هنا: هو في `config/walletStart.js` الذي يردّ كلَّ قراءةٍ
 * وكتابةٍ قبل البداية. هذا السكربتُ ينظّف ما مضى مرّةً، وذاك يمنع عودتَه.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const arg = (name, def = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
};
const APPLY = process.argv.includes('--apply');
const { WALLET_START_DATE } = require('../config/walletStart');
const CUT = arg('date', WALLET_START_DATE);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const Branch = require('../models/Branch');
  const DailyWallet = require('../models/DailyWallet');
  const WalletTransaction = require('../models/WalletTransaction');

  const branches = await Branch.find({}).select('name').lean();
  const byId = new Map(branches.map((b) => [String(b._id), b.name]));

  const wallets = await DailyWallet.find({ date: { $lt: CUT } }).lean();
  const txs = await WalletTransaction.find({ date: { $lt: CUT } }).lean();

  console.log(`\n  بدايةُ الدفتر: ${CUT}${APPLY ? '' : '   — تجربة، بلا حذف —'}\n`);
  console.log('  الفرع'.padEnd(18) + 'يوميّاتٌ تُحذَف'.padStart(16) + 'حركاتٌ تُحذَف'.padStart(15) + '   أقدمُ يوم');
  console.log('  ' + '─'.repeat(68));
  for (const b of branches) {
    const w = wallets.filter((x) => String(x.branch) === String(b._id));
    const t = txs.filter((x) => String(x.branch) === String(b._id));
    if (!w.length && !t.length) continue;
    const oldest = w.map((x) => x.date).sort()[0] || t.map((x) => x.date).sort()[0];
    console.log('  ' + b.name.padEnd(16) + String(w.length).padStart(16) + String(t.length).padStart(15) + `   ${oldest}`);
  }
  // حركةٌ تشير إلى فرعٍ محذوف تبقى مرئيّةً في العدّ ولا تظهر في أيّ سطرٍ أعلاه.
  const stray = txs.filter((x) => !byId.has(String(x.branch))).length
    + wallets.filter((x) => !byId.has(String(x.branch))).length;
  if (stray) console.log(`  (و${stray} سجلًّا على فرعٍ لم يعد موجودًا — تُحذَف معها)`);
  console.log('  ' + '─'.repeat(68));
  console.log('  ' + 'المجموع'.padEnd(16) + String(wallets.length).padStart(16) + String(txs.length).padStart(15));

  if (!wallets.length && !txs.length) {
    console.log('\n  لا شيءَ قبل البداية — الدفترُ يبدأ من مكانه.\n');
    await mongoose.disconnect();
    return;
  }

  // ① النسخةُ الاحتياطيّة — قبل أيّ حذف، وباسمٍ يقول متى أُخذت وممّ.
  const dir = path.join(__dirname, '..', '..', 'backups');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `wallet-before-${CUT}-${stamp}.json`);
  if (APPLY) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      takenAt: new Date().toISOString(), cutoff: CUT,
      branches: branches.map((b) => ({ _id: b._id, name: b.name })),
      dailyWallets: wallets, walletTransactions: txs,
    }, null, 2));
    console.log(`\n  ✔ نسخةٌ احتياطيّة: ${file}`);
  } else {
    console.log(`\n  ستُحفَظ نسخةٌ احتياطيّة في backups/ قبل الحذف.`);
  }

  // ② الحذف
  if (APPLY) {
    const dt = await WalletTransaction.deleteMany({ date: { $lt: CUT } });
    const dw = await DailyWallet.deleteMany({ date: { $lt: CUT } });
    console.log(`  ✔ حُذفت ${dt.deletedCount} حركةً و${dw.deletedCount} يوميّة.`);
  }

  // ③ ما بقي
  console.log('\n  أوّلُ يومٍ بعد التنظيف:\n');
  console.log('  الفرع'.padEnd(18) + 'أوّلُ يوم'.padStart(14) + 'الافتتاحيّ'.padStart(16) + 'الأيّام'.padStart(9));
  console.log('  ' + '─'.repeat(60));
  for (const b of branches) {
    const first = await DailyWallet.findOne({ branch: b._id }).sort({ date: 1 }).lean();
    const count = await DailyWallet.countDocuments({ branch: b._id });
    console.log('  ' + b.name.padEnd(16) + String(first ? first.date : '—').padStart(14)
      + String(first ? first.openingBalance : '—').padStart(16) + String(count).padStart(9));
  }

  if (APPLY) {
    try {
      require('../websocket/socketManager').emitToAll('wallet:updated', {});
    } catch (_) { /* السكربت يعمل خارج الخادم غالبًا */ }
  } else {
    console.log('\n  لم يُحذَف شيء. أضف --apply للتنفيذ.');
  }
  console.log('');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
