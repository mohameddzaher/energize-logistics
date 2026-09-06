require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');
  const rows = await Employee.aggregate([
    { $match: { employmentStatus: { $ne: 'terminated' }, isHrRecord: { $ne: false } } },
    { $group: { _id: '$department', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  console.log('أقسامُ الموظفين كما هي مكتوبة:');
  rows.forEach((r) => console.log(`  «${r._id ?? '—'}» → ${r.n}`));
  console.log('\nمفاتيحُ أقسام النظام:');
  console.log('  ' + require('../config/sections').SECTION_KEYS.join(' | '));
  await mongoose.disconnect();
})();
