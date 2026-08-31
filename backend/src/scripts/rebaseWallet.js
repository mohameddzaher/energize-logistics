/**
 * rebaseWallet — بدايةٌ جديدةٌ لمحفظةِ مستخدمٍ من يومٍ بعينه.
 *
 *   node src/scripts/rebaseWallet.js --user <id> --from 2026-08-31 --opening 1580 [--yes]
 *
 * تُزال يوميّاتُ ما قبل اليوم المطلوب وحركاتُها، ويُثبَّت رصيدُ ذلك اليوم
 * الافتتاحيُّ رقمًا يدويًّا، ثمّ تُعاد سلسلةُ الأرصدة إلى الأمام بالقاعدة نفسِها
 * التي يستعملها القسم: الختاميُّ = الافتتاحيُّ + التحصيلات − المصروفات −
 * المشتريات، وافتتاحيُّ الغدِ ختاميُّ اليوم.
 *
 * ولماذا سكربتٌ لا تعديلٌ مباشر: اليوميّاتُ سلسلةٌ لا أرقامٌ مستقلّة، فتغييرُ
 * رقمٍ واحدٍ بلا إعادةِ بناءِ ما بعده يترك المحفظةَ تقول رقمين مختلفين لليوم
 * نفسِه. والنسخةُ تُحفظ قبل المسّ لأنّ الممسوحَ هنا مالٌ لا صفوف.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const DailyWallet = require('../models/DailyWallet');
const WalletTransaction = require('../models/WalletTransaction');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--yes');
const USER = arg('user');
const FROM = arg('from');
const OPENING = Number(arg('opening'));

(async () => {
  if (!USER || !FROM || !Number.isFinite(OPENING)) {
    console.error('  الاستعمال: --user <id> --from YYYY-MM-DD --opening <رقم> [--yes]');
    process.exit(1);
  }
  console.log('\n' + '='.repeat(70));
  console.log(APPLY ? '  إعادةُ تأسيس المحفظة — تنفيذ' : '  إعادةُ تأسيس المحفظة — فحصٌ فقط');
  console.log('='.repeat(70));
  await mongoose.connect(process.env.MONGODB_URI);

  const before = await DailyWallet.find({ user: USER, date: { $lt: FROM } }).sort({ date: 1 }).lean();
  const start = await DailyWallet.findOne({ user: USER, date: FROM });
  if (!start) { console.error(`  ✗ لا توجد يوميّةٌ بتاريخ ${FROM} لهذا المستخدم`); process.exit(1); }

  const oldTx = before.length
    ? await WalletTransaction.find({ wallet: { $in: before.map((w) => w._id) } }).lean()
    : [];

  const span = before.length ? ` (${before[0].date} → ${before[before.length - 1].date})` : '';
  console.log(`  يوميّاتٌ قبل ${FROM}: ${before.length}${span}`);
  console.log(`  حركاتُها: ${oldTx.length}`);
  console.log(`  يوميّةُ ${FROM}: افتتاحي ${start.openingBalance} → ${OPENING}`);
  console.log(`    تحصيلات ${start.totalCollections} · مصروفات ${start.totalExpenses} · مشتريات ${start.totalPurchases}`);
  const newClosing = OPENING + start.totalCollections - start.totalExpenses - start.totalPurchases;
  console.log(`    ختاميّها يصير: ${newClosing}`);
  const after = await DailyWallet.find({ user: USER, date: { $gt: FROM } }).sort({ date: 1 }).lean();
  let prev = newClosing;
  after.forEach((d) => {
    const c = prev + d.totalCollections - d.totalExpenses - d.totalPurchases;
    console.log(`    ${d.date}: افتتاحي ${d.openingBalance}→${prev} · ختامي ${d.closingBalance}→${c}`);
    prev = c;
  });

  if (!APPLY) { console.log('\n  فحصٌ فقط — أضِف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  const dir = path.join(__dirname, '../../backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `wallet-${USER}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const chain = await DailyWallet.find({ user: USER }).sort({ date: 1 }).lean();
  fs.writeFileSync(backup, JSON.stringify({ at: new Date(), user: USER, from: FROM, opening: OPENING, wallets: chain, removedTransactions: oldTx }, null, 1));
  console.log(`\n  نسخةٌ محفوظة: ${path.relative(process.cwd(), backup)}`);

  if (oldTx.length) await WalletTransaction.deleteMany({ _id: { $in: oldTx.map((t) => t._id) } });
  if (before.length) await DailyWallet.deleteMany({ _id: { $in: before.map((w) => w._id) } });
  start.openingBalance = OPENING;
  start.closingBalance = newClosing;
  await start.save();

  // السلسلةُ إلى الأمام بالقاعدة نفسِها التي يستعملها القسم.
  let p = newClosing;
  for (const d of await DailyWallet.find({ user: USER, date: { $gt: FROM } }).sort({ date: 1 })) {
    d.openingBalance = p;
    d.closingBalance = p + d.totalCollections - d.totalExpenses - d.totalPurchases;
    await d.save();
    p = d.closingBalance;
  }
  console.log(`  مُسح ${before.length} يوميّةً و${oldTx.length} حركة · وأُعيد بناءُ السلسلة\n`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
