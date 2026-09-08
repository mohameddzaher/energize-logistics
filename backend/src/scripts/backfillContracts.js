/**
 * backfillContracts — عقدٌ مكتوبٌ في سجلّ الموظّف بلا مستندِ عقد.
 *
 *   node src/scripts/backfillContracts.js          تجربة
 *   node src/scripts/backfillContracts.js --yes    تنفيذ
 *
 * ── العلّة ────────────────────────────────────────────────────────────────
 * للعقد مصدران: حقولٌ على سجلّ الموظّف (`contractStartDate`/`contractEndDate`)
 * ومجموعةٌ مستقلّة (`Contract`). وصفحةُ الملفّ تقرأ المجموعة، فموظّفٌ عقدُه
 * مكتوبٌ في سجلّه وحدَه يفتح ملفَّه فلا يجد عقدًا — وهو «ساري» في سجلّه.
 *
 * أربعةٌ كذلك، أحدُهم ساري. يُنشأ لكلٍّ منهم مستندُ عقدٍ من سجلّه، فيتّفق
 * المصدران ويظهر العقدُ حيث يُبحَث عنه.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const YES = process.argv.includes('--yes');

// نصُّ الحالة في السجلّ ← حالةُ المستند.
const STATUS = {
  'ساري': 'active',
  'غير ساري': 'expired',
  'تم انهاء العقد': 'terminated',
  'منتهي': 'expired',
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');
  const Contract = require('../models/Contract');

  const linked = new Set((await Contract.distinct('employee', { employee: { $ne: null } })).map(String));
  const rows = await Employee.find({ contractEndDate: { $nin: [null, ''] } }).lean();
  const missing = rows.filter((e) => !linked.has(String(e._id)));

  console.log(YES ? '── تنفيذ ──\n' : '── تجربة، بلا كتابة ──\n');
  console.log(`موظّفون بعقدٍ في سجلّهم بلا مستند: ${missing.length}\n`);

  const plan = [];
  for (const e of missing) {
    const start = String(e.contractStartDate || '').trim();
    if (!start) { console.log(`   ✗ ${e.employeeNumber} بلا تاريخ بداية — يُترك`); continue; }
    const status = STATUS[String(e.contractStatusText || '').trim()] || 'active';
    plan.push({
      employee: e._id,
      type: e.contractEndDate ? 'fixed' : 'unlimited',
      startDate: start,
      endDate: String(e.contractEndDate || '').trim(),
      status,
      jobTitle: e.jobTitle || '',
      basicSalary: Number(e.basicSalary) || 0,
      annualLeaveDays: Number(e.annualLeaveDays) || 21,
      employeeNameAr: e.arabicName || '',
      iqamaNumber: e.iqamaNumber || e.nationalId || '',
      // مصدرُ المستند يُقال: وُلد من سجلّ الموظّف لا من إدخالٍ في صفحة العقود.
      notes: 'أُنشئ من بيانات العقد في سجلّ الموظّف (backfillContracts)',
      _num: e.employeeNumber, _name: e.arabicName,
    });
  }
  plan.forEach((p) => console.log(`   ${String(p._num).padEnd(6)} ${String(p._name || '').slice(0, 28).padEnd(28)} ${p.startDate} → ${p.endDate || '—'}  ${p.status}`));

  if (!YES) { console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }
  for (const p of plan) {
    const { _num, _name, ...doc } = p;
    await Contract.create(doc);
  }
  console.log(`\n✓ أُنشئ ${plan.length} عقدًا`);
  await mongoose.disconnect();
})();
