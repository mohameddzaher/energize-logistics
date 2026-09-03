/**
 * repairEmployeeVisibility — موظّفون حقيقيّون اختفوا من كلّ قائمة.
 *
 *   node src/scripts/repairEmployeeVisibility.js --dry
 *   node src/scripts/repairEmployeeVisibility.js --yes
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * `isHrRecord: false` معناها «هذا ليس موظّفًا — سجلُّ خدمةٍ ذاتيّةٍ أُنشئ لحسابِ
 * دخولٍ ليطلب إجازة». وكلُّ قائمةٍ وكلُّ عدّادٍ في الموارد البشريّة يستثنيه.
 *
 * وحمل العَلَمَ اثنان وثلاثون سجلًّا، تسعةٌ منها موظّفون حقيقيّون بأرقامٍ
 * وظيفيّةٍ وأقسامٍ وأرقام هويّة — فاختفوا من البحث ومن القوائم ومن العدّ، وهم
 * في القاعدة كما تركهم أهلُهم. سُئل عنهم فقيل «محذوفون»، ولم يُحذف أحد.
 *
 * ── وكيف يُفرَّق الحقيقيُّ من الظلّ ────────────────────────────────────────
 * سجلُّ الخدمة الذاتيّة يُنشأ باسمٍ وبريدٍ فقط — لا رقمَ وظيفيَّ له ولا قسمَ
 * ولا هويّة، و`inCurrentMaster: false`. فمن حمل واحدةً من هذه فهو موظّف.
 *
 * والدليلُ الأقوى تناقضٌ صريح: `inCurrentMaster: true` مع `isHrRecord: false` —
 * كشفُ الموظّفين يقول إنّه على رأس القائمة والعَلَمُ يقول إنّه ليس موظّفًا.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = !process.argv.includes('--yes');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');
  const User = require('../models/User');

  console.log(DRY ? '── تجربة، بلا كتابة ──\n' : '── تنفيذ ──\n');
  const hidden = await Employee.find({ isHrRecord: false }).lean();
  console.log(`سجلّاتٌ مُعلَّمة «ليست موظّفًا»: ${hidden.length}`);

  const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
  const isReal = (e) => e.inCurrentMaster === true
    || has(e.employeeNumber) || has(e.department) || has(e.iqamaNumber) || has(e.nationalId);

  const restore = hidden.filter(isReal);
  console.log(`\nموظّفون حقيقيّون يُعادون إلى الظهور: ${restore.length}`);
  for (const e of restore) {
    const nm = e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim();
    console.log(`   ${nm}  ·  رقم ${e.employeeNumber || '—'}  ·  ${e.department || '—'}  ·  ${e.iqamaNumber || e.nationalId || '—'}  ·  ${e.employmentStatus}`);
  }

  // ── وظلالٌ يتيمة: حسابُها زال وبياناتُها فارغة ────────────────────────────
  // سجلُّ خدمةٍ ذاتيّةٍ أُنشئ لحسابٍ ثمّ حُذف الحساب — فبقي صفٌّ لا يشير إلى
  // أحدٍ ولا يحمل شيئًا. أكثرُها من حسابات الفحص عندي، وقد حُذفت حساباتُها
  // ونُسيت ظلالُها. تُحذف: ليست أثرًا لأحد.
  const shadows = hidden.filter((e) => !isReal(e));
  const userIds = shadows.map((e) => e.user).filter(Boolean);
  const alive = new Set((await User.find({ _id: { $in: userIds } }).select('_id').lean()).map((u) => String(u._id)));
  const orphans = shadows.filter((e) => !e.user || !alive.has(String(e.user)));
  console.log(`\nظلالٌ لحساباتٍ لم تعد موجودة (تُحذف): ${orphans.length}`);
  for (const e of orphans) console.log(`   ${`${e.firstName || ''} ${e.lastName || ''}`.trim()} <${e.email || '—'}>`);
  console.log(`ظلالٌ لحساباتٍ قائمة (تبقى كما هي): ${shadows.length - orphans.length}`);

  if (DRY) { console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  if (restore.length) {
    const r = await Employee.updateMany({ _id: { $in: restore.map((e) => e._id) } }, { $set: { isHrRecord: true } });
    console.log(`\n✓ أُعيد ${r.modifiedCount} موظّفًا إلى القوائم`);
  }
  if (orphans.length) {
    const r = await Employee.deleteMany({ _id: { $in: orphans.map((e) => e._id) } });
    console.log(`✓ حُذف ${r.deletedCount} ظلًّا يتيمًا`);
  }

  const visible = await Employee.countDocuments({ isHrRecord: { $ne: false } });
  console.log(`\nموظّفون ظاهرون الآن: ${visible} من ${await Employee.countDocuments()}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
