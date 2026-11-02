/* eslint-disable no-console */
/**
 * Repairs the one-way link between a login account and the employee record.
 * Usage: node src/scripts/repairEmployeeUserLinks.js [--dry]
 * The link has two ends, `User.linkedEmployee` and `Employee.user`, and one code path wrote only one of them, so the users page says 'linked' while the employee file says 'not linked'. Fixed from the account side: it is the end that was written; the other is the one that was lost.
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
    if (!emp) { orphans.push(u.email); continue; }          // points to a deleted employee
    if (String(emp.user || '') === String(u._id)) continue;  // healthy
    fixes.push({ email: u.email, empId: emp._id, name: emp.arabicName || emp.firstName || '', had: emp.user ? String(emp.user) : null });
  }

  console.log(`حسابات مرتبطة: ${users.length}`);
  console.log(`سليمة الاتجاهين: ${users.length - fixes.length - orphans.length}`);
  console.log(`تحتاج إصلاحًا  : ${fixes.length}`);
  if (orphans.length) console.log(`تشير إلى موظّف محذوف: ${orphans.length} — ${orphans.slice(0, 5).join(', ')}`);

  // An end pointing to a different account is a conflict, not a lost write: reported, not overwritten.
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
