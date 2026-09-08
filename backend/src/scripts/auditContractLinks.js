require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Contract = require('../models/Contract');
  const Employee = require('../models/Employee');
  const total = await Contract.countDocuments({});
  const noEmp = await Contract.countDocuments({ $or: [{ employee: null }, { employee: { $exists: false } }] });
  console.log(`عقود: ${total} · بلا ربطٍ بموظّف: ${noEmp}`);

  const byStatus = await Contract.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }, { $sort: { n: -1 } }]);
  console.log('الحالات:', byStatus.map((x) => `${x._id}=${x.n}`).join(' · '));

  // عقودٌ مربوطةٌ بموظّفٍ لا وجودَ له
  const ids = await Contract.distinct('employee', { employee: { $ne: null } });
  const exist = new Set((await Employee.find({ _id: { $in: ids } }).select('_id').lean()).map((e) => String(e._id)));
  const orphan = ids.filter((i) => !exist.has(String(i)));
  console.log(`موظّفون مربوطون في العقود: ${ids.length} · منهم غيرُ موجود: ${orphan.length}`);

  // كم موظّفًا له عقدٌ ساري؟ ومقابلَه ما تقوله صفحةُ الموظّفين
  const activeC = await Contract.countDocuments({ status: 'active' });
  const empsWithActive = (await Contract.distinct('employee', { status: 'active', employee: { $ne: null } })).length;
  console.log(`عقودٌ سارية: ${activeC} · موظّفون لهم عقدٌ ساري: ${empsWithActive}`);

  // الموظّفون الذين يقول سجلُّهم إنّ لهم عقدًا لكن لا عقدَ مربوط
  const withEnd = await Employee.countDocuments({ contractEndDate: { $nin: [null, ''] } });
  console.log(`موظّفون لهم تاريخُ نهاية عقدٍ في سجلّهم: ${withEnd}`);
  const linked = new Set(ids.map(String));
  const rows = await Employee.find({ contractEndDate: { $nin: [null, ''] } }).select('employeeNumber arabicName contractEndDate').lean();
  const missing = rows.filter((e) => !linked.has(String(e._id)));
  console.log(`   منهم بلا عقدٍ مربوط: ${missing.length}`);
  missing.slice(0, 8).forEach((e) => console.log(`      ${e.employeeNumber} ${String(e.arabicName || '').slice(0, 26)} نهاية=${e.contractEndDate}`));
  await mongoose.disconnect();
})();
