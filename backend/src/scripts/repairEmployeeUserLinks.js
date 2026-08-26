/* eslint-disable no-console */
/**
 * إصلاح الرابط أحاديّ الاتجاه بين حساب الدخول وسجلّ الموظّف.
 *
 *   node src/scripts/repairEmployeeUserLinks.js --dry   # معاينة بلا كتابة
 *   node src/scripts/repairEmployeeUserLinks.js         # تنفيذ
 *
 * الرابط طرفان: `User.linkedEmployee` و`Employee.user`. وكان يُكتب في مسارٍ
 * واحدٍ طرفٌ منهما فقط، فتقرأ صفحة المستخدمين «مرتبط» ويقرأ ملفُّ الموظّف «غير
 * مرتبط بحساب دخول» — نقيضان، وكلُّ شاشةٍ صادقةٌ فيما تنظر إليه.
 *
 * يُصلَح من جهة الحساب: هو الطرف الذي كُتب فعلًا، والآخر هو الذي سقط.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../models/User');
  const Employee = require('../models/Employee');

  const users = await User.find({ linkedEmployee: { $ne: null } })
    .select('email linkedEmployee').lean();

  const fixes = [];
  const orphans = [];
  for (const u of users) {
    const emp = await Employee.findById(u.linkedEmployee).select('user arabicName firstName').lean();
    if (!emp) { orphans.push(u.email); continue; }          // يشير إلى موظّف محذوف
    if (String(emp.user || '') === String(u._id)) continue;  // سليم
    fixes.push({ email: u.email, empId: emp._id, name: emp.arabicName || emp.firstName || '', had: emp.user ? String(emp.user) : null });
  }

  console.log(`حسابات مرتبطة: ${users.length}`);
  console.log(`سليمة الاتجاهين: ${users.length - fixes.length - orphans.length}`);
  console.log(`تحتاج إصلاحًا  : ${fixes.length}`);
  if (orphans.length) console.log(`تشير إلى موظّف محذوف: ${orphans.length} — ${orphans.slice(0, 5).join(', ')}`);

  // الطرف الذي يشير إلى حسابٍ آخر ليس سقوطًا بل تعارض — يُعلَن ولا يُكتب فوقه.
  const conflicts = fixes.filter((f) => f.had);
  if (conflicts.length) {
    console.log(`\n⚠ تعارض (الموظّف مرتبطٌ بحسابٍ آخر) — لن يُلمس: ${conflicts.length}`);
    for (const c of conflicts) console.log(`   ${c.email} → ${c.name}`);
  }

  const safe = fixes.filter((f) => !f.had);
  console.log(`\nسيُكتَب: ${safe.length}`);
  for (const f of safe.slice(0, 40)) console.log(`   ${f.email.padEnd(32)} → ${f.name}`);
  if (safe.length > 40) console.log(`   … و${safe.length - 40} غيرها`);

  if (DRY) { console.log('\nمعاينة — لم يُكتب شيء.'); process.exit(0); }
  for (const f of safe) await Employee.updateOne({ _id: f.empId }, { $set: { user: (await User.findOne({ email: f.email }).select('_id').lean())._id } });
  console.log(`\n✓ أُصلح ${safe.length} رابطًا.`);
  process.exit(0);
})();
