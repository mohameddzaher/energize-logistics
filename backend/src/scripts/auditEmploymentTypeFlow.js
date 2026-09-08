require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');
  const hrm = require('../controllers/hrMasterController');
  const H = require('../config/hrFields');

  const emp = await Employee.findOne({ employmentType: 'sponsored', contractEndDate: { $nin: [null, ''] } }).lean();
  console.log(`الموظّف ${emp.employeeNumber} — النوع الآن: ${emp.employmentType}`);
  const show = async (label) => {
    const f = await Employee.findById(emp._id).lean();
    const st = ['contractStartDate', 'contractEndDate', 'annualLeaveDays'].map((k) => `${k}=${f.fieldStatus?.[k + 'Status'] || '(فارغ)'}`);
    console.log(`  ${label}: نوع=${f.employmentType} حر=${f.isFreelancer} · ${st.join(' · ')}`);
  };
  await show('قبل');

  const call = (fields) => new Promise((r) => {
    const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { r({ code: this.statusCode, body: b }); } };
    hrm.updateFields({ params: { id: String(emp._id) }, body: { fields }, user: { _id: emp._id, role: 'super_admin' }, ip: '' }, res).catch((e) => r({ code: 500, body: { err: e.message } }));
  });

  let r = await call({ employmentType: 'freelancer' });
  console.log(`→ حُوِّل إلى فريلانسر (${r.code})`);
  await show('بعد');

  r = await call({ employmentType: 'sponsored' });
  console.log(`→ أُعيد إلى الكفالة (${r.code})`);
  await show('بعد الرجوع');
  await mongoose.disconnect();
})();
