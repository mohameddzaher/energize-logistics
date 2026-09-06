/**
 * moveWorkshopUsersToLs2 — الورشةُ صارت لوكيشن سوليوشن، ومَن كان فيها يتبعها.
 *
 *   node src/scripts/moveWorkshopUsersToLs2.js          تجربة
 *   node src/scripts/moveWorkshopUsersToLs2.js --yes    تنفيذ
 *
 * ── لماذا ────────────────────────────────────────────────────────────────
 * أُزيل قسمُ الورشة لأنّ عملَه كلَّه — الصيانةُ والمستودعُ وأوامرُ الشغل — يجري
 * في لوكيشن سوليوشن. وبإزالته بقي ثلاثةُ مستخدمين يحملون دورًا لم يعد له
 * تعريف، فيدخلون ولا يرَون شيئًا: الدورُ المجهول يُقرأ «لا صلاحيّة» في كلّ قسم.
 *
 * والمستوى يُحفَظ كما هو: مديرٌ يبقى مديرًا وفنّيٌّ يبقى موظّفًا. الترقيةُ
 * والتنزيلُ قرارُ صاحب العمل لا أثرٌ جانبيٌّ لنقل قسم.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const YES = process.argv.includes('--yes');
const MAP = { workshop_manager: 'location_manager', workshop_employee: 'location_staff' };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const User = require('../models/User');
  const { ALL_ROLE_DEFS } = require('../config/roles');

  // ولا يُكتب دورٌ لا وجودَ له: خطأٌ مطبعيٌّ هنا يترك المستخدمَ بلا صلاحيّةٍ
  // كحاله الآن، فيبدو الإصلاحُ وقد جرى ولم يجرِ.
  const known = new Set((ALL_ROLE_DEFS || []).map((r) => r.key));
  for (const to of Object.values(MAP)) {
    if (!known.has(to)) { console.error(`الدورُ «${to}» غيرُ معرَّف — أُوقف.`); process.exit(1); }
  }

  console.log(YES ? '── تنفيذ ──\n' : '── تجربة، بلا كتابة ──\n');
  const users = await User.find({ role: { $in: Object.keys(MAP) } })
    .select('firstName lastName email role').lean();

  if (!users.length) { console.log('لا مستخدمَ بدورِ ورشة.'); await mongoose.disconnect(); return; }

  for (const u of users) {
    const to = MAP[u.role];
    console.log(`  ${`${u.firstName || ''} ${u.lastName || ''}`.trim().padEnd(22)} ${u.email.padEnd(24)} ${u.role} → ${to}`);
    if (YES) await User.updateOne({ _id: u._id }, { $set: { role: to } });
  }

  if (!YES) { console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  // صلاحيّاتُ الأدوار مخزَّنةٌ مؤقّتًا في العمّالَين — تُبطَل وإلّا بقي أحدُهما
  // يقرأ الدورَ القديم حتى تنتهي المهلة.
  try { require('../utils/ttlCache').clear('perm:'); } catch (_) {}
  console.log(`\n✓ نُقل ${users.length} مستخدمًا`);
  console.log('  (يلزمهم تسجيلُ خروجٍ ودخولٍ ليُقرأ الدورُ الجديد في المتصفّح)');
  await mongoose.disconnect();
})();
