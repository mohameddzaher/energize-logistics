/**
 * backfillContracts: contract written on the employee record with no contract document.
 * Usage: node src/scripts/backfillContracts.js (dry run) | --yes
 * Cause: a contract has two sources, fields on the employee (contractStartDate/contractEndDate) and the separate Contract collection. The profile page reads the collection, so an employee whose contract is only on his record opens his file and sees no contract, though he is active on his record.
 * Four such employees, one active. A contract document is created from each record so both sources agree.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const YES = process.argv.includes('--yes');

// Status text on the record -> document status.
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
      // State the document's origin: it was born from the employee record, not entered on the contracts page.
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
