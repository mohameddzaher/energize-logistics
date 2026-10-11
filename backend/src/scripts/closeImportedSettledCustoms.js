/**
 * closeImportedSettledCustoms — يُغلق ما استُورد من الماستر وهو منتهٍ.
 *
 *   node src/scripts/closeImportedSettledCustoms.js            ← تجربة، بلا كتابة
 *   node src/scripts/closeImportedSettledCustoms.js --apply
 *
 * المعاملاتُ التي دخلت النظامَ من شيت الماستر لم يُضغَط عليها «إنهاء» قطّ —
 * الزرُّ لم يكن موجودًا يومَ انتهت. فتظهر كلُّها «مفتوحة» في لوحة القسم، ومنها
 * ما سُدِّد وأُقفل دفترُه قبل شهور.
 *
 * والمنتهي منها يُعرَف من الماستر نفسِه: حالةُ فاتورته «خالص» — فُوترت وسُدِّدت.
 * فيُغلَق: مستورَدٌ (له `legacySerial`)، ليس قادمًا ولا ملغًى ولا مغلقًا، وحالةُ
 * فاتورته «خالص». ويُؤرَّخ إغلاقُه بآخر يومٍ من شهره في الماستر — لا باليوم،
 * كي لا يُعَدّ مئتا إغلاقٍ قديمٍ في «أُغلقت هذا الشهر». وباسم «سجلّ سابق» لا
 * باسم موظّف. وما لم يكن «خالصًا» يبقى مفتوحًا: فيه عملٌ أو مالٌ لم ينتهِ.
 *
 * يُعاد تشغيلُه بلا ضرر: لا يمسّ ما أُغلق.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const SETTLED = 'خالص';
const BY = 'سجلّ سابق';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const CustomsClearance = require('../models/CustomsClearance');
  const filter = {
    legacySerial: { $ne: null },
    upcoming: { $ne: true },
    cancelled: { $ne: true },
    isCompleted: { $ne: true },
    'billing.invoiceStatus': SETTLED,
  };
  const rows = await CustomsClearance.find(filter)
    .select('refNumber stage periodYear periodMonth createdAt').lean();

  const byStage = {};
  for (const r of rows) byStage[r.stage] = (byStage[r.stage] || 0) + 1;
  const open = await CustomsClearance.countDocuments({ upcoming: { $ne: true }, cancelled: { $ne: true }, isCompleted: { $ne: true } });
  console.log(`\n  مفتوحةٌ الآن: ${open} · منها مستورَدةٌ «${SETTLED}» تُغلَق: ${rows.length}`);
  console.log(`  بمرحلتها: ${Object.entries(byStage).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`);
  console.log(`  وتبقى مفتوحةً: ${open - rows.length}`);
  if (!APPLY) { console.log('  — تجربة، بلا كتابة. أضف --apply للتنفيذ.\n'); await mongoose.disconnect(); return; }

  // آخرُ يومٍ من شهر المعاملة في الماستر، ظهرًا بتوقيت الرياض؛ وما لا شهرَ له فبتاريخ إدخاله.
  const closedAt = (r) => (r.periodYear && r.periodMonth
    ? new Date(Date.UTC(r.periodYear, r.periodMonth, 0, 9, 0, 0))
    : new Date(r.createdAt));
  let done = 0;
  for (const r of rows) {
    const res = await CustomsClearance.updateOne(
      { _id: r._id, isCompleted: { $ne: true } },
      { $set: { isCompleted: true, completedAt: closedAt(r), completedBy: null, completedByName: BY } },
      { timestamps: false },
    );
    done += res.modifiedCount || 0;
  }
  try { require('../utils/ttlCache').clear('customs:'); } catch (_) { /* */ }
  const left = await CustomsClearance.countDocuments({ upcoming: { $ne: true }, cancelled: { $ne: true }, isCompleted: { $ne: true } });
  const closed = await CustomsClearance.countDocuments({ isCompleted: true });
  console.log(`  أُغلقت: ${done} · المغلقةُ الآن ${closed} · المفتوحةُ ${left}\n`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
