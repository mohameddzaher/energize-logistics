/**
 * Login accounts that became employees but are not.
 * Usage: node src/scripts/unmakeLoginEmployees.js (preview) | --yes (apply)
 * Creating a login also creates a self-service file (utils/ensureSelfEmployee) so the user can request leave; it is flagged isHrRecord: false and is not counted as an employee. Two such shadow records had the flag true and appeared in HR as full employees, though they are not in the employee master (inCurrentMaster: false). The row is not deleted because the login and self-service still work; the flag is set back to false so they leave every HR list and counter. Rule: not in the master, has a login, and HR did not enter them from its screen. An employee number alone is not evidence, which misled repairEmployeeVisibility into restoring them.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const YES = process.argv.includes('--yes');
const NUMBERS = process.argv.includes('--numbers')
  ? process.argv[process.argv.indexOf('--numbers') + 1].split(',')
  : ['EMP-0434', 'EMP-0419'];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');
  const User = require('../models/User');

  console.log(YES ? '── تنفيذ ──\n' : '── تجربة، بلا كتابة ──\n');
  const rows = await Employee.find({ employeeNumber: { $in: NUMBERS } }).lean();
  if (!rows.length) { console.log('لا سجلّات مطابقة.'); await mongoose.disconnect(); return; }

  for (const e of rows) {
    const u = e.user ? await User.findById(e.user).select('email role').lean() : null;
    const name = (e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`).trim();
    console.log(`${e.employeeNumber} · ${name}`);
    console.log(`   في الماستر: ${e.inCurrentMaster ? 'نعم' : 'لا'} · القسم: ${e.department || '—'} · الحالة: ${e.employmentStatus}`);
    console.log(`   حسابُ الدخول: ${u ? `${u.email} (${u.role}) — يبقى كما هو` : 'لا يوجد'}`);
    // Records in the master are never touched: the master is the source of employees, and anyone in it is an employee regardless of appearance.
    if (e.inCurrentMaster) console.log('   ⚠︎ هذا في الماستر — لن يُمسّ.');
  }

  const targets = rows.filter((e) => !e.inCurrentMaster);
  console.log(`\nيُخرَج من الموارد البشريّة: ${targets.length} من ${rows.length}`);
  if (!YES) { console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  const r = await Employee.updateMany(
    { _id: { $in: targets.map((e) => e._id) } },
    { $set: { isHrRecord: false, inCurrentMaster: false } },
  );
  console.log(`✓ أُخرج ${r.modifiedCount} سجلًّا — الحساباتُ تعمل كما هي`);
  console.log(`الموظّفون الظاهرون الآن: ${await Employee.countDocuments({ isHrRecord: { $ne: false } })}`);
  await mongoose.disconnect();
})();
