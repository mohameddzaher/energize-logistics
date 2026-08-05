/**
 * rebuildHrFromMaster — مسح بيانات الموارد البشرية القديمة بالكامل وإعادة بنائها
 * من الماستر النهائي وحده.
 *
 *   node src/scripts/rebuildHrFromMaster.js --dry      # يقول هيعمل إيه من غير ما يعمل
 *   node src/scripts/rebuildHrFromMaster.js --yes      # ينفّذ
 *
 * الفرق بينه وبين importHrMasterFinal: الاستيراد بيحدّث فوق الموجود ويحاول
 * يوفّق بين الشيت واللي اتظبط بالإيد. ده بيقول من الأول: الماستر هو كل الحقيقة،
 * واللي مش فيه مالوش وجود. بعد التشغيل ده عدد الموظفين = عدد صفوف الملف بالضبط،
 * وكل قيمة في السيستم أصلها سطر في الملف.
 *
 * ── تلات حاجات ماكانش ينفع الاختصار فيهم ───────────────────────────────────
 *
 * ١) نسخة احتياطية قبل أي مسح. بتتكتب في backend/backups/hr-rebuild-<وقت>/،
 *    كل مجموعة في ملف JSON لوحدها، والاسترجاع منها ممكن بـ mongoimport. من غيرها
 *    الأمر ده طريق باتجاه واحد.
 *
 * ٢) **الـ _id بيتحافظ عليه**. لو مسحنا الموظفين وعملناهم من جديد بأرقام داخلية
 *    جديدة، كل حاجة بتشاور عليهم في الأقسام التانية بتتكسر في نفس اللحظة:
 *    تفاويض المركبات، الحوادث، العهد، إيميلات الشركة، تقييمات الأداء، وحسابات
 *    الدخول. فبنمسك رقم الهوية → الـ _id القديم، وبنعيد إنشاء الموظف **بنفس
 *    الـ _id**. النتيجة: الداتا اتغيّرت، والروابط زي ما هي.
 *
 * ٣) اللي مالوش مقابل في الماستر بيتشال من الموارد البشرية — بس لو قسم تاني
 *    لسه بيشاور عليه (عهدة IT، تفويض مركبة، حادث، إيميل شركة) بيتساب **سجل
 *    أرشيفي بالاسم ورقم الهوية وبس**: لا تواريخ ولا مستندات ولا حالات حقول.
 *    فما بيظهرش في أي عدّاد ولا تنبيه في الموارد البشرية — كل استعلامات القسم
 *    بتستثني isHrRecord:false — وفي نفس الوقت سجل العهدة أو التفويض بيفضل
 *    مكتوب عليه اسم بني آدم بدل ما يبقى فاضي. اللي مفيش حاجة بتشاور عليه
 *    بيتمسح خالص.
 *
 * إجازات العمل عن بُعد (RemoteLeaveRequest) مش هنا: دي بتاعة قسم العمل عن بُعد
 * ومربوطة بحسابات الدخول مش بسجلات الموظفين، فمالهاش علاقة بالماستر ده.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const DRY = !process.argv.includes('--yes');

// مجموعات قسم الموارد البشرية — دي اللي بتتمسح بالكامل.
const WIPE = ['Employee', 'LeaveRequest', 'EmployeeDocument', 'EmployeeRenewal', 'HRRequest', 'Contract'];

// كل مكان في السيستم بيشاور على موظف. بنستعملها مرتين: نتأكد إن الروابط عدّت،
// وننضّف اللي بقى معلّق.
const REFS = [
  ['User', 'linkedEmployee'], ['PerfEvaluation', 'employee'], ['Asset', 'employee'],
  ['AssetEvent', 'fromEmployee'], ['AssetEvent', 'toEmployee'], ['CompanyEmail', 'employee'],
  ['ItTicket', 'requester'], ['Vehicle', 'currentEmployee'], ['VehicleAccident', 'employee'],
  ['VehicleAuthorization', 'employee'], ['VehicleAuthorization', 'transferredTo'],
  ['VehicleAuthorization', 'transferredFrom'],
];

const AR = '٠١٢٣٤٥٦٧٨٩';
const digits = (v) => String(v || '').replace(/[٠-٩]/g, (x) => AR.indexOf(x)).replace(/[^0-9]/g, '');
const nz = (v) => digits(v).replace(/^0+/, '');
const d = (v) => { if (!v) return null; const x = new Date(v); return isNaN(x) ? null : x; };
const s = (v) => (v === null || v === undefined ? '' : String(v).trim());
const GENDER = { 'ذكر': 'male', 'أنثى': 'female', 'انثى': 'female' };

/** صف الماستر → مستند الموظف + حالة كل حقل. نفس منطق importHrMasterFinal. */
function build(e, H) {
  const id = e.identity || {}; const c = e.contact || {}; const em = e.employment || {};
  const iq = e.iqama || {}; const pp = e.passport || {}; const ct = e.contract || {};
  const mi = e.medical_insurance || {}; const hc = e.health_certificate || {};
  const dc = e.driver_card || {}; const dl = e.driving_license || {};
  const full = s(id.full_name);
  const parts = full.split(/\s+/).filter(Boolean);

  const doc = {
    employeeNumber: s(e.employee_number),
    arabicName: full, firstName: parts[0] || full || '—', lastName: parts.slice(1).join(' ') || '—',
    iqamaNumber: s(id.id_number), idType: s(id.id_type),
    gender: GENDER[s(id.gender_ar)] || '', nationality: s(id.nationality_ar), dateOfBirth: d(id.date_of_birth),
    email: s(c.personal_email), companyEmail: s(c.company_email), absherNumber: s(c.absher_phone),
    companyNumber: s(c.company_phone), originCountryNumber: s(c.home_country_phone), address: s(c.national_address),
    employerNumber: s(em.employer_number), project: s(em.business_unit_ar), department: s(em.department_ar),
    branchName: s(em.branch_ar), directManagerName: s(em.line_manager_ar), workStatusText: s(em.work_status_ar),
    systemStatus: s(em.system_status_ar), hireDate: d(em.hire_date),
    isOutsideKingdom: !!em.is_outside_kingdom, isFreelancer: !!em.is_freelancer,
    employmentStatus: em.is_active === false ? 'terminated' : 'active',
    gosiNumber: s(e.gosi?.number), iban: s(e.banking?.iban), bank: s(e.banking?.bank_code),
    iqamaIssueDate: d(iq.issue_date), iqamaExpiry: d(iq.expiry_date_gregorian),
    iqamaExpiryHijri: s(iq.expiry_date_hijri), iqamaProfession: s(iq.occupation_ar),
    passportNumber: s(pp.number), passportExpiry: d(pp.expiry_date),
    contractStatusText: s(ct.status_ar), qiwaContractNumber: s(ct.number),
    contractOccupation: s(ct.occupation_ar), contractStartDate: d(ct.start_date), contractEndDate: d(ct.end_date),
    insuranceCompany: s(mi.company_ar), insuranceClass: s(mi.class), insuranceExpiry: d(mi.expiry_date),
    healthCertNumber: s(hc.number), healthCertExpiry: d(hc.expiry_date),
    driverCardStatus: s(dc.availability_ar), driverCardNumber: s(dc.number), driverCardExpiry: d(dc.expiry_date),
    licenseType: s(dl.type_ar), licenseExpiry: d(dl.expiry_date),
    notes: s(e.notes_ar),
    isHrRecord: true, inCurrentMaster: true,
  };

  const st = {};
  const put = (k, code) => { if (code) st[H.statusKeyOf(k)] = code; };
  put('employeeNumber', e.employee_number_status);
  put('gender', id.gender_status); put('nationality', id.nationality_status); put('dateOfBirth', id.date_of_birth_status);
  put('email', c.personal_email_status); put('companyEmail', c.company_email_status);
  put('absherNumber', c.absher_phone_status); put('companyNumber', c.company_phone_status);
  put('originCountryNumber', c.home_country_phone_status); put('address', c.national_address_status);
  put('employerNumber', em.employer_status); put('project', em.business_unit_status);
  put('department', em.department_status); put('branchName', em.branch_status);
  put('directManagerName', em.line_manager_status); put('hireDate', em.hire_date_status);
  put('gosiNumber', e.gosi?.number_status);
  put('iban', e.banking?.iban_status); put('bank', e.banking?.bank_status);
  put('iqamaExpiry', iq.expiry_status); put('iqamaProfession', iq.occupation_status);
  put('passportNumber', pp.number_status); put('passportExpiry', pp.expiry_status);
  put('contractStatusText', ct.status_sentinel); put('qiwaContractNumber', ct.number_status);
  put('contractOccupation', ct.occupation_status); put('contractEndDate', ct.end_date_status);
  put('insuranceCompany', mi.company_status); put('insuranceClass', mi.class_status); put('insuranceExpiry', mi.expiry_status);
  put('healthCertNumber', hc.number_status); put('healthCertExpiry', hc.expiry_status);
  put('driverCardStatus', dc.availability_status); put('driverCardNumber', dc.number_status); put('driverCardExpiry', dc.expiry_status);
  put('licenseType', dl.type_status); put('licenseExpiry', dl.expiry_status);
  return { doc, st };
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  // لازم كل موديل يتحمّل قبل ما يتنادى بالاسم، وإلا mongoose.model بترمي.
  for (const m of [...WIPE, ...REFS.map((r) => r[0])]) {
    try { require(`../models/${m}`); } catch { /* موديل مش موجود */ }
  }
  const Employee = require('../models/Employee');
  const H = require('../config/hrFields');
  const src = require(path.join(__dirname, '..', 'data', 'masters', 'hr_master_final.json'));

  console.log(`الماستر: ${src.employees.length} موظف${DRY ? '     (تجربة — مفيش حاجة هتتغيّر)' : ''}\n`);

  // ── ١) اللي موجود دلوقتي ────────────────────────────────────────────────────
  const old = await Employee.find({}).lean();
  const counts = {};
  for (const m of WIPE) {
    try { counts[m] = await mongoose.model(m).countDocuments({}); } catch { counts[m] = 0; }
  }
  console.log('اللي هيتمسح:');
  for (const m of WIPE) console.log(`     ${m.padEnd(20)} ${counts[m]}`);

  // ── ٢) خريطة رقم الهوية → الـ _id القديم ────────────────────────────────────
  // ده اللي بيخلّي الروابط تعيش. لو نفس الهوية على أكتر من سجل، بنقدّم اللي
  // مربوط بحساب دخول — هو اللي بيتشاور عليه أكتر.
  const linkedIds = new Set((await mongoose.model('User').find({ linkedEmployee: { $ne: null } })
    .select('linkedEmployee').lean()).map((u) => String(u.linkedEmployee)));
  const idToOld = new Map(); const numToOld = new Map();
  for (const e of old) {
    for (const [map, key] of [[idToOld, nz(e.iqamaNumber)], [numToOld, nz(e.employeeNumber)]]) {
      if (!key) continue;
      const cur = map.get(key);
      if (!cur || (linkedIds.has(String(e._id)) && !linkedIds.has(String(cur)))) map.set(key, e._id);
    }
  }

  // ── ٣) نبني الـ ٣٧٨ ونشوف مين هيحتفظ بالـ _id بتاعه ─────────────────────────
  const built = []; const reused = new Set();
  for (const row of src.employees) {
    const { doc, st } = build(row, H);
    const keep = idToOld.get(nz(doc.iqamaNumber)) || numToOld.get(nz(doc.employeeNumber)) || null;
    if (keep && !reused.has(String(keep))) { doc._id = keep; reused.add(String(keep)); }
    built.push({ doc, st });
  }
  const orphaned = old.filter((e) => !reused.has(String(e._id)));
  console.log(`\nالربط: ${reused.size} موظف هيفضل بنفس رقمه الداخلي (روابطه سليمة)`
    + ` · ${built.length - reused.size} جديد · ${orphaned.length} سجل قديم مالوش مقابل في الماستر`);

  // ── ٤) الروابط اللي هتبقى معلّقة ────────────────────────────────────────────
  const orphanIds = orphaned.map((e) => e._id);
  const refCount = new Map();   // _id → عدد المراجع عليه
  const dangling = [];
  for (const [model, field] of REFS) {
    try {
      const rows = await mongoose.model(model).find({ [field]: { $in: orphanIds } }).select(field).lean();
      if (rows.length) dangling.push({ model, field, n: rows.length });
      rows.forEach((r) => refCount.set(String(r[field]), (refCount.get(String(r[field])) || 0) + 1));
    } catch { /* الموديل مش محمّل */ }
  }
  // اليتيم اللي حد بيشاور عليه بيتحوّل أرشيف، واللي محدش بيشاور عليه بيتمسح.
  const archive = orphaned.filter((e) => refCount.has(String(e._id)));
  const purge = orphaned.filter((e) => !refCount.has(String(e._id)));
  if (dangling.length) {
    console.log('\nمراجع من أقسام تانية على سجلات مش في الماستر (هتفضل شغّالة بالأرشيف):');
    dangling.forEach((x) => console.log(`     ${`${x.model}.${x.field}`.padEnd(36)} ${x.n}`));
  }
  const show = (e) => `     ${(e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`).trim().slice(0, 34).padEnd(36)}`
    + `#${e.employeeNumber || '—'}`.padEnd(11) + `${e.iqamaNumber || '—'}`.padEnd(13)
    + (linkedIds.has(String(e._id)) ? 'له حساب دخول  ' : '')
    + (refCount.get(String(e._id)) ? `${refCount.get(String(e._id))} مرجع` : '');
  console.log(`\n► أرشيف (بيتشال من الموارد البشرية، الاسم بيفضل للأقسام التانية): ${archive.length}`);
  archive.forEach((e) => console.log(show(e)));
  console.log(`\n► مسح نهائي (محدش بيشاور عليه): ${purge.length}`);
  purge.forEach((e) => console.log(show(e)));

  if (DRY) { console.log('\n(تجربة) — للتنفيذ: node src/scripts/rebuildHrFromMaster.js --yes'); process.exit(0); }

  // ── ٥) نسخة احتياطية ────────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(__dirname, '..', '..', 'backups', `hr-rebuild-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const m of WIPE) {
    try {
      const docs = await mongoose.model(m).find({}).lean();
      fs.writeFileSync(path.join(dir, `${m}.json`), JSON.stringify(docs, null, 1));
    } catch { /* skip */ }
  }
  // والروابط كمان — عشان لو حد رجّع النسخة يعرف كانت رايحة لمين.
  const refDump = {};
  for (const [model, field] of REFS) {
    try {
      refDump[`${model}.${field}`] = await mongoose.model(model).find({ [field]: { $ne: null } })
        .select(`_id ${field}`).lean();
    } catch { /* skip */ }
  }
  fs.writeFileSync(path.join(dir, '_references.json'), JSON.stringify(refDump, null, 1));
  console.log(`\n✓ نسخة احتياطية: ${path.relative(path.join(__dirname, '..', '..'), dir)}`);

  // ── ٦) الأرشفة — قبل أي مسح ─────────────────────────────────────────────────
  // الترتيب مقصود: لو الخطوة دي وقعت، تبقى مفيش حاجة اتمسحت لسه والداتا زي ما
  // هي. الأرشيف بياخد الاسم ورقم الهوية والقسم وبس؛ أي تاريخ أو مستند بيتفضّى
  // عشان ما يطلعش في تنبيه «منتهي» ولا في عدّاد بيانات ناقصة.
  const archiveIds = archive.map((e) => e._id);
  if (archiveIds.length) {
    const SET = {
      isHrRecord: false, inCurrentMaster: false, employmentStatus: 'terminated', fieldStatus: {},
      terminationReason: 'مش في الماستر النهائي — سجل أرشيفي لمراجع الأقسام التانية بس',
    };
    const KEEP = ['_id', 'employeeNumber', 'arabicName', 'firstName', 'lastName', 'iqamaNumber',
      'nationalId', 'department', 'project', 'jobTitle', 'user', 'createdAt', 'updatedAt', '__v'];
    // نفس الحقل ما ينفعش يبقى في $set و$unset — مونجو بترفض العملية كلها. والـ
    // Map بيتقرا من السكيما كـ `fieldStatus.$*`، فالمقارنة لازم تبقى على أول
    // جزء من المسار مش على المسار كامل.
    const root = (k) => k.split('.')[0];
    const paths = [...new Set(Object.keys(Employee.schema.paths).map(root))]
      .filter((k) => !KEEP.includes(k) && !(k in SET));
    await Employee.updateMany({ _id: { $in: archiveIds } },
      { $unset: Object.fromEntries(paths.map((k) => [k, ''])), $set: SET });
    console.log(`   اتأرشف ${archiveIds.length} سجل (اسم + رقم هوية وبس)`);
  }

  // ── ٧) المسح ────────────────────────────────────────────────────────────────
  for (const m of WIPE) {
    try {
      // الأرشيف بيتساب في مكانه بنفس الـ _id — اتنضّف فوق، مش بيتعاد إنشاؤه.
      const q = m === 'Employee' ? { _id: { $nin: archiveIds } } : {};
      const r = await mongoose.model(m).deleteMany(q);
      console.log(`   اتمسح ${m}: ${r.deletedCount}`);
    } catch { /* skip */ }
  }

  // ── ٨) البناء من الماستر ────────────────────────────────────────────────────
  let created = 0; const failures = [];
  for (const { doc, st } of built) {
    try {
      const made = new Employee(doc);
      made.fieldStatus = new Map(Object.entries(st));
      await made.save();
      created++;
    } catch (err) {
      failures.push(`${doc.employeeNumber || doc.iqamaNumber || doc.arabicName}: ${err.message.split('\n')[0]}`);
    }
  }
  console.log(`\n✓ اتعمل ${created} موظف من الماستر`);
  if (failures.length) { console.log(`✗ ${failures.length} صف فشل:`); failures.forEach((f) => console.log('     ' + f)); }

  // ── ٩) تنضيف الروابط المعلّقة ───────────────────────────────────────────────
  const live = new Set((await Employee.find({}).select('_id').lean()).map((e) => String(e._id)));
  console.log(`   سجلات موجودة بعد البناء: ${live.size} (${created} من الماستر + ${archiveIds.length} أرشيف)`);
  for (const [model, field] of REFS) {
    try {
      const M = mongoose.model(model);
      const rows = await M.find({ [field]: { $ne: null } }).select(`_id ${field}`).lean();
      const bad = rows.filter((r) => !live.has(String(r[field]))).map((r) => r._id);
      if (bad.length) {
        await M.updateMany({ _id: { $in: bad } }, { $unset: { [field]: '' } });
        console.log(`   اتفضّى ${model}.${field}: ${bad.length}`);
      }
    } catch { /* skip */ }
  }

  // ── ١٠) التأكيد ──────────────────────────────────────────────────────────────
  const HR = { isHrRecord: { $ne: false } };
  const total = await Employee.countDocuments(HR);
  const active = await Employee.countDocuments({ ...HR, employmentStatus: 'active' });
  const inMaster = await Employee.countDocuments({ inCurrentMaster: true });
  let required = 0;
  for (const e of await Employee.find(HR).select('fieldStatus').lean()) {
    required += Object.values(e.fieldStatus || {}).filter((v) => v === 'required').length;
  }
  console.log(`\nالنتيجة: ${total} موظف · على رأس العمل ${active} · في الماستر ${inMaster} · بيانات مطلوبة ${required}`);
  console.log(`المتوقّع من الملف: ${src.employees.length} موظف`
    + ` · على رأس العمل ${src.employees.filter((e) => e.employment?.is_active !== false).length}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
