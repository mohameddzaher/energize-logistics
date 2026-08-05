/**
 * mergeDuplicateEmployees — دمج سجلين لنفس الموظف (نفس رقم الهوية).
 *
 *   node src/scripts/mergeDuplicateEmployees.js --dry
 *   node src/scripts/mergeDuplicateEmployees.js
 *
 * إزاي حصل التكرار: نفس الشخص اتسجّل مرتين برقمين وظيفيين مختلفين (مرة بالاسم
 * العربي ومرة باللاتيني مثلاً)، فالاستيراد اللي بيدوّر بالرقم الوظيفي شافهم
 * اتنين. ورقم الهوية هو اللي بيكشف إنهم واحد.
 *
 * أيهم يفضل: صاحب حساب الدخول أولًا (الحساب مربوط بيه ومش عايزينه يقع)، وإلا
 * الأقدم. الباقي بيتنقل منه أي حقل ناقص في اللي هيفضل، وبتتحوّل له المراجع
 * (تفاويض المركبات، الإجازات، العهد)، وبعدين بس بيتشال.
 *
 * ما بيلمسش الحالات اللي فيها **رقم وظيفي** متكرّر لشخصين بأسماء مختلفة — دي
 * مش تكرار، دي تعارض بيانات محتاج بني آدم يقرّر فيه.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const AR = '٠١٢٣٤٥٦٧٨٩';
const digits = (s) => String(s || '').replace(/[٠-٩]/g, (d) => AR.indexOf(d)).replace(/[^0-9]/g, '');
const nz = (s) => digits(s).replace(/^0+/, '');
const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);

const REFS = [
  ['LeaveRequest', 'employee'], ['RemoteLeaveRequest', 'employee'], ['Asset', 'assignedTo'],
  ['VehicleAuthorization', 'employee'], ['VehicleAccident', 'employee'], ['CompanyLicense', 'employee'],
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const Employee = require('../models/Employee');
  const User = require('../models/User');
  // أرقام الماستر — هو المرجع، فالسجل اللي رقمه فيه هو اللي يفضل.
  const master = require('../data/masters/hr_master_final.json');
  const masterNums = new Set(master.employees.map((e) => nz(e.employee_number)).filter(Boolean));

  const all = await Employee.find({ isHrRecord: { $ne: false } }).lean();
  const byId = new Map();
  for (const e of all) {
    const k = nz(e.iqamaNumber);
    if (!k) continue;
    if (!byId.has(k)) byId.set(k, []);
    byId.get(k).push(e);
  }
  const dupes = [...byId.entries()].filter(([, v]) => v.length > 1);
  if (!dupes.length) { console.log('مفيش تكرار — كل رقم هوية ليه سجل واحد.'); process.exit(0); }

  console.log(`${dupes.length} رقم هوية متكرّر${DRY ? '   (تجربة)' : ''}\n`);
  let merged = 0; let movedRefs = 0; let movedFields = 0;

  for (const [id, list] of dupes) {
    // الأولوية: صاحب حساب الدخول (عشان الحساب ما يقعش)، وبعده اللي رقمه
    // الوظيفي موجود في الماستر (الماستر هو المرجع)، وبعده الأقدم.
    const inMaster = (e) => (masterNums.has(nz(e.employeeNumber)) ? 1 : 0);
    const sorted = [...list].sort((a, b) => {
      if (!!b.user - !!a.user) return !!b.user - !!a.user;
      if (inMaster(b) - inMaster(a)) return inMaster(b) - inMaster(a);
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
    const [keep, ...drop] = sorted;
    console.log(`رقم الهوية ${id}`);
    console.log(`  يفضل: ${(keep.arabicName || keep.firstName || '').slice(0, 32)}  #${keep.employeeNumber || '—'}${keep.user ? '  (له حساب دخول)' : ''}${masterNums.has(nz(keep.employeeNumber)) ? '  (رقمه في الماستر)' : ''}`);

    for (const old of drop) {
      console.log(`  يُدمج ويُشال: ${(old.arabicName || old.firstName || '').slice(0, 32)}  #${old.employeeNumber || '—'}`);
      const patch = {};
      for (const [k, v] of Object.entries(old)) {
        if (['_id', '__v', 'createdAt', 'updatedAt', 'user', 'fieldStatus'].includes(k)) continue;
        if (isEmpty(keep[k]) && !isEmpty(v)) { patch[k] = v; movedFields++; }
      }
      if (Object.keys(patch).length) console.log(`      ← ${Object.keys(patch).length} حقل ناقص: ${Object.keys(patch).slice(0, 8).join(', ')}`);

      if (!DRY) {
        if (Object.keys(patch).length) await Employee.updateOne({ _id: keep._id }, { $set: patch });
        for (const [model, field] of REFS) {
          try {
            const M = require(`../models/${model}`);
            const r = await M.updateMany({ [field]: old._id }, { $set: { [field]: keep._id } });
            if (r.modifiedCount) { console.log(`      ← ${r.modifiedCount} من ${model}`); movedRefs += r.modifiedCount; }
          } catch (e) { /* الموديل مش موجود */ }
        }
        const u = await User.updateMany({ linkedEmployee: old._id }, { $set: { linkedEmployee: keep._id } });
        if (u.modifiedCount) { console.log(`      ← ${u.modifiedCount} حساب مستخدم`); movedRefs += u.modifiedCount; }
        await Employee.deleteOne({ _id: old._id });
      }
      merged++;
    }
    console.log('');
  }

  console.log(`${merged} سجل مكرّر اتشال · ${movedFields} حقل اتنقل · ${movedRefs} مرجع اتحوّل`);

  // تعارض الرقم الوظيفي — بنقوله بس، مش بنقرّر فيه.
  const byNum = new Map();
  for (const e of await Employee.find({ isHrRecord: { $ne: false } }).select('employeeNumber arabicName firstName').lean()) {
    const k = nz(e.employeeNumber);
    if (!k) continue;
    if (!byNum.has(k)) byNum.set(k, []);
    byNum.get(k).push(e);
  }
  const clashes = [...byNum.entries()].filter(([, v]) => v.length > 1);
  if (clashes.length) {
    console.log(`\n⚠ ${clashes.length} رقم وظيفي على أكتر من شخص — تعارض بيانات محتاج قرار بشري:`);
    clashes.forEach(([n, v]) => console.log(`    #${n} → ${v.map((x) => (x.arabicName || x.firstName || '').slice(0, 26)).join('  |  ')}`));
  }

  if (!DRY) {
    console.log(`\n✓ سجلات موارد بشرية: ${await Employee.countDocuments({ isHrRecord: { $ne: false } })} · على رأس العمل: ${await Employee.countDocuments({ isHrRecord: { $ne: false }, employmentStatus: 'active' })}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
