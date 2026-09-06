require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const User = require('../models/User');
  const Employee = require('../models/Employee');
  const users = await User.find({ role: { $in: ['workshop_manager', 'workshop_employee'] } })
    .select('username email firstName lastName role isActive branch createdAt lastLogin').lean();
  console.log('المستخدمون بأدوارِ ورشةٍ لم تعد موجودة:', users.length, '\n');
  for (const u of users) {
    const emp = await Employee.findOne({ user: u._id }).select('employeeNumber name department jobTitle isHrRecord employmentStatus').lean();
    console.log(`  ${u.firstName || ''} ${u.lastName || ''}`.trim());
    console.log(`    username: ${u.email || u.username || '—'} · الدور: ${u.role} · ${u.isActive === false ? 'موقوف' : 'نشط'}`);
    console.log(`    آخر دخول: ${u.lastLogin ? new Date(u.lastLogin).toISOString().slice(0, 10) : 'لم يدخل'}`);
    console.log(`    ملفُّ موظّف: ${emp ? `${emp.employeeNumber} · ${emp.department || '—'} · ${emp.jobTitle || '—'} · ${emp.isHrRecord === false ? 'ظِلّيّ (ليس سجلَّ HR)' : 'سجلُّ HR'}` : 'لا يوجد'}`);
    console.log('');
  }
  // ولا يُمنَح دورٌ إلّا وهو موجود
  const { ALL_ROLE_DEFS } = require('../config/roles');
  const ls = (ALL_ROLE_DEFS || []).filter((r) => /^location_/.test(r.key));
  console.log('أدوارُ لوكيشن سوليوشن المتاحة:', ls.map((r) => `${r.key} (${r.ar})`).join(' | '));
  await mongoose.disconnect();
})();
