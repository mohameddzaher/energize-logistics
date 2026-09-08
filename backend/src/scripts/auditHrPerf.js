require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');
  const hrm = require('../controllers/hrMasterController');

  let t = Date.now();
  const all = await Employee.find({}).lean();
  console.log(`كلُّ الموظّفين بلا مشروع: ${all.length} في ${Date.now() - t}ms`);
  const size = Buffer.byteLength(JSON.stringify(all));
  console.log(`   حجمُ الحمولة: ${(size / 1024 / 1024).toFixed(2)} ميجابايت`);

  t = Date.now();
  await Employee.find({}).select('employeeNumber arabicName fieldStatus').lean();
  console.log(`بمشروعٍ ضيّق (٣ حقول): ${Date.now() - t}ms`);

  // أضخمُ الحقول
  const one = all[0];
  const sizes = Object.entries(one || {}).map(([k, v]) => [k, Buffer.byteLength(JSON.stringify(v ?? null))]).sort((a, b) => b[1] - a[1]);
  console.log('\nأضخمُ الحقول في مستندٍ واحد:');
  sizes.slice(0, 8).forEach(([k, n]) => console.log(`   ${k.padEnd(24)} ${n} بايت`));

  // كم مرّةً يُقرأ الموظّفون في نداءٍ واحد؟
  t = Date.now();
  const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json() {} };
  await hrm.overview({ query: {}, params: {}, user: { role: 'super_admin' } }, res);
  console.log(`\noverview كاملًا: ${Date.now() - t}ms`);
  t = Date.now();
  await hrm.overview({ query: {}, params: {}, user: { role: 'super_admin' } }, res);
  console.log(`overview ثانيةً (مخزَّن؟): ${Date.now() - t}ms`);
  await mongoose.disconnect();
})();
