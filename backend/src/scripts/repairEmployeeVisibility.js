/**
 * repairEmployeeVisibility: real employees that vanished from every list.
 * Usage: node src/scripts/repairEmployeeVisibility.js [--dry|--yes]
 * `isHrRecord: false` means 'not an employee, a self-service record created for a login to request leave', and every HR list and counter excludes it. Some real employees carried the flag, so they disappeared from search, lists and counts while still in the database.
 * Real vs shadow: a self-service record is created with only name and email (no job number, department or identity) and `inCurrentMaster: false`. Having any of those means a real employee. The strongest evidence is `inCurrentMaster: true` with `isHrRecord: false`, a direct contradiction.
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

  // Orphan shadows: the account is gone and the data is empty.
  // A self-service record was created for an account that was then deleted, leaving a row that points to no one and holds nothing (mostly leftovers of test accounts). Deleted: they are nobody's trace.
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
