/* eslint-disable no-console */
/**
 * setWalletOpeningBalance — ضبط الرصيد الافتتاحي لمحفظة موظّف في يومٍ بعينه.
 *
 *   node src/scripts/setWalletOpeningBalance.js --email wael@energize.com --amount 13340 --dry
 *   node src/scripts/setWalletOpeningBalance.js --email wael@energize.com --amount 13340 --yes
 *   … [--date 2026-08-23]   الافتراضي: اليوم
 *
 * ── لماذا سكربت لا تعديلٌ مباشر ─────────────────────────────────────────────
 * الرصيد الافتتاحي رقمٌ ماليّ: يُبنى عليه رصيد اليوم، ورصيد اليوم يصير افتتاحيَّ
 * الغد. تعديله بيدٍ في قاعدة البيانات يترك سطرًا لا أحد يعرف من كتبه ولا لماذا.
 * هنا يُكتب مرةً واحدة، ويُسجَّل في سجلّ التدقيق باسم منفّذه وسببه، ويُعاد حساب
 * رصيد الإقفال فورًا.
 *
 * ── وما لا يفعله ────────────────────────────────────────────────────────────
 * لا يمسّ حركات اليوم (تحصيل/مصروف/مشتريات) — رصيد الإقفال يُحسب منها ومن
 * الافتتاحي، لا يُكتب. ولا يعدّل أيامًا سابقة: لو كان لليوم السابق محفظة، فرصيد
 * إقفاله هو الافتتاحيُّ الطبيعي، وتجاوزُه قرارٌ يُعلَن لا يُدسّ.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const DRY = !argv.includes('--yes');
const EMAIL = arg('email');
const AMOUNT = Number(arg('amount'));
const DATE = arg('date') || new Date().toISOString().slice(0, 10);
const REASON = arg('reason') || 'ضبط الرصيد الافتتاحي بطلب الإدارة';
// سجلّ التدقيق يشترط منفِّذًا — والحقيقة أنّ التنفيذ تمّ بسكربت صيانة. تُنسَب
// العملية لحساب المسؤول المذكور، ويُكتب في السبب أنها بسكربت، فلا يبدو أحدٌ
// كأنه ضغط زرًّا لم يضغطه.
const AS = arg('as') || 'mohamedzaher.dev@gmail.com';

(async () => {
  if (!EMAIL || !Number.isFinite(AMOUNT)) {
    console.error('الاستعمال: --email <بريد> --amount <رقم> [--date YYYY-MM-DD] [--yes]');
    process.exit(2);
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const Branch = require('../models/Branch');
  const DailyWallet = require('../models/DailyWallet');
  const WalletTransaction = require('../models/WalletTransaction');
  const logAudit = require('../utils/auditLogger');

  const user = await User.findOne({ email: new RegExp(`^${EMAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean();
  if (!user) { console.error(`لا مستخدم ببريد ${EMAIL}`); process.exit(1); }

  const branchId = user.branch;
  if (!branchId) { console.error('المستخدم بلا فرع — المحفظة تتطلّب فرعًا'); process.exit(1); }
  const branch = await Branch.findById(branchId).lean();

  console.log(`المستخدم: ${user.firstName || ''} ${user.lastName || ''} · ${user.email} · ${user.role}`);
  console.log(`الفرع:    ${branch?.nameAr || branch?.name || branchId}`);
  console.log(`التاريخ:  ${DATE}\n`);

  // اليوم السابق — رصيد إقفاله هو الافتتاحيُّ الطبيعي، فنُظهر الفرق صراحةً.
  const prev = await DailyWallet.findOne({ user: user._id, date: { $lt: DATE } }).sort({ date: -1 }).lean();
  if (prev) {
    console.log(`آخر محفظة سابقة: ${prev.date} · رصيد إقفالها ${prev.closingBalance}`);
    if (prev.closingBalance !== AMOUNT) {
      console.log(`⚠ الرصيد المطلوب (${AMOUNT}) يخالف رصيد إقفال ${prev.date} (${prev.closingBalance}) — تجاوزٌ معلَن.`);
    }
  } else console.log('لا محفظة سابقة لهذا المستخدم — هذا أول رصيد افتتاحي له.');

  let wallet = await DailyWallet.findOne({ user: user._id, date: DATE });
  const before = wallet ? wallet.openingBalance : null;

  // حركات اليوم — رصيد الإقفال يُحسب منها لا يُكتب.
  const txs = await WalletTransaction.find({ user: user._id, date: DATE, isDeleted: { $ne: true } }).lean();
  const sumOf = (t) => txs.filter((x) => x.type === t).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const collections = sumOf('collection');
  const expenses = sumOf('expense');
  const purchases = sumOf('purchase');
  const closing = AMOUNT + collections - expenses - purchases;

  console.log(`\nالمحفظة: ${wallet ? `موجودة · افتتاحيّها الآن ${before}` : 'غير موجودة — ستُنشأ'}`);
  console.log(`حركات اليوم: تحصيل ${collections} · مصروفات ${expenses} · مشتريات ${purchases}  (${txs.length} حركة)`);
  console.log(`\nالافتتاحي → ${AMOUNT}   ورصيد الإقفال المحسوب → ${closing}`);

  if (DRY) { console.log('\n(تجربة) — للتنفيذ أضف --yes'); process.exit(0); }

  if (!wallet) {
    wallet = await DailyWallet.create({
      user: user._id, branch: branchId, date: DATE,
      openingBalance: AMOUNT, closingBalance: closing,
      totalCollections: collections, totalExpenses: expenses, totalPurchases: purchases,
    });
  } else {
    if (wallet.isClosed) {
      console.error('المحفظة مُقفَلة — لا تُعدَّل. تُفتح من الشاشة أولًا ثم يُعاد التشغيل.');
      process.exit(1);
    }
    wallet.set({
      openingBalance: AMOUNT, closingBalance: closing,
      totalCollections: collections, totalExpenses: expenses, totalPurchases: purchases,
    });
    await wallet.save();
  }

  const actor = await User.findOne({ email: new RegExp(`^${AS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
    .select('_id email firstName lastName').lean()
    || await User.findOne({ role: 'super_admin' }).select('_id email firstName lastName').lean();
  if (!actor) console.error('⚠ لا حساب مسؤول لنسب العملية إليه — لن تُسجَّل في التدقيق');

  if (actor) await logAudit({
    user: actor._id,
    action: 'set_opening_balance',
    entity: 'DailyWallet',
    entityId: wallet._id,
    changes: {
      user: user.email, date: DATE,
      before, after: AMOUNT, closingBalance: closing,
      previousDayClosing: prev ? prev.closingBalance : null,
      reason: `${REASON} — نُفِّذت بسكربت setWalletOpeningBalance باسم ${actor.email}`,
    },
  }).catch((e) => console.error('تعذّر تسجيل التدقيق:', e.message));

  const check = await DailyWallet.findById(wallet._id).lean();
  console.log(`\n✓ ${check.date} · الافتتاحي ${check.openingBalance} · الإقفال ${check.closingBalance}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
