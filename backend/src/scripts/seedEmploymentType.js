/**
 * seedEmploymentType — قائمةُ «النوع» وتعبئتُها من العلامة القائمة.
 *
 *   node src/scripts/seedEmploymentType.js          تجربة
 *   node src/scripts/seedEmploymentType.js --yes    تنفيذ
 *
 * تُنشأ قائمةُ «نوع الارتباط» في القوائم المنسدلة (تُدار من إعدادات القسم)،
 * ويُملأ حقلُ كلّ موظّفٍ من `isFreelancer` القائمة — فلا يبدأ الحقلُ فارغًا.
 * ومن كان عملًا حرًّا تصير بياناتُ عقده «غير مطلوبة» — راجع applyEmploymentType.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { SPONSORED, FREELANCER, applyEmploymentType } = require('../utils/employmentType');

const YES = process.argv.includes('--yes');
const TYPE = 'hr_employment_type';
const OPTIONS = [
  { key: SPONSORED, nameAr: 'على الكفالة', nameEn: 'Sponsored', order: 1 },
  { key: FREELANCER, nameAr: 'عمل حر (فريلانسر)', nameEn: 'Freelancer', order: 2 },
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Lookup = require('../models/Lookup');
  const Employee = require('../models/Employee');

  console.log(YES ? '── تنفيذ ──\n' : '── تجربة، بلا كتابة ──\n');

  for (const o of OPTIONS) {
    const exists = await Lookup.findOne({ type: TYPE, key: o.key }).lean();
    console.log(`  قائمة: «${o.nameAr}» ${exists ? '(موجودة)' : '(تُنشأ)'}`);
    if (YES && !exists) await Lookup.create({ type: TYPE, ...o, isActive: true });
  }

  const free = await Employee.countDocuments({ isFreelancer: true });
  const rest = await Employee.countDocuments({ isFreelancer: { $ne: true } });
  const already = await Employee.countDocuments({ employmentType: { $nin: ['', null] } });
  console.log(`\nموظّفون: عملٌ حرّ=${free} · على الكفالة=${rest} · لهم نوعٌ مكتوبٌ سلفًا=${already}`);

  if (!YES) { console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  // لا يُكتب فوق نوعٍ مكتوبٍ بيد.
  const f = await Employee.updateMany({ isFreelancer: true, employmentType: { $in: ['', null] } }, { $set: applyEmploymentType(FREELANCER) });
  const s = await Employee.updateMany({ isFreelancer: { $ne: true }, employmentType: { $in: ['', null] } }, { $set: applyEmploymentType(SPONSORED) });
  console.log(`\n✓ عملٌ حرّ: ${f.modifiedCount} · على الكفالة: ${s.modifiedCount}`);
  try { require('../utils/ttlCache').clear('hrm:'); } catch (_) {}
  await mongoose.disconnect();
})();
