/* eslint-disable no-console */
// تحديث بيانات الموظفين من hr_master_employees.json — يطابق الموجودين (بالإيميل
// الشخصي ← إيميل الشركة ← رقم الموظف ← الهوية) ويحدّثهم في المكان (يحافظ على _id
// والعهد المرتبطة)، ويضيف الجدد فقط. لا يحذف أحدًا. يضبط فقط الحقول غير الفارغة.
//   node src/scripts/importHrMaster.js [--commit]
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const Employee = require('../models/Employee');

const COMMIT = process.argv.includes('--commit');
const norm = (s) => String(s || '').trim().toLowerCase();
const val = (x) => (x === null || x === undefined || String(x).trim() === '' ? undefined : x);

function mapRow(r) {
  const id = r.identity || {}; const ct = r.contact || {}; const em = r.employment || {};
  const con = r.contract || {}; const bk = r.banking || {}; const iq = r.iqama || {};
  const pp = r.passport || {}; const mi = r.medical_insurance || {}; const go = r.gosi || {};
  const dc = r.driver_card || {}; const dl = r.driving_license || {}; const vi = r.visa || {}; const fc = r.file_completeness || {};
  const patch = {
    arabicName: val(id.full_name_ar),
    employeeNumber: val(r.employee_number),
    nationalId: val(id.national_id),
    iqamaNumber: val(id.national_id),
    gender: val(id.gender && id.gender.code),
    dateOfBirth: val(id.date_of_birth),
    nationality: val(id.nationality_ar),
    email: val(ct.personal_email) ? norm(ct.personal_email) : undefined,
    phone: val(ct.company_phone),
    absherNumber: val(ct.absher_phone),
    originCountryNumber: val(ct.home_country_phone),
    address: val(ct.national_address),
    department: val(em.department_ar),
    project: val(em.project_ar),
    jobTitle: val(em.job_title_ar),
    systemStatus: val(em.system_status_ar),
    workStatusText: val(em.work_status_ar),
    hireDate: val(em.hire_date),
    qiwaContractNumber: val(con.number),
    contractStatusText: val(con.status_ar),
    contractStartDate: val(con.start_date),
    contractEndDate: val(con.end_date),
    iban: val(bk.iban),
    bank: val(bk.bank_code),
    iqamaExpiry: val(iq.expiry_date),
    iqamaProfession: val(iq.occupation_ar),
    passportNumber: val(pp.number),
    passportExpiry: val(pp.expiry_date),
    insuranceCompany: val(mi.company_ar),
    insuranceExpiry: val(mi.expiry_date),
    socialInsuranceStatus: val(go.status_ar),
    driverCardNumber: val(dc.number),
    driverCardType: val(dc.type_ar),
    driverCardExpiry: val(dc.expiry_date),
    driverCardStatus: val(dc.availability_ar),
    licenseType: val(dl.type_ar),
    licenseExpiry: val(dl.expiry_date),
    visaExpiry: val(vi.expiry_date),
    fileStatus: val(fc.status_ar),
  };
  // employmentStatus من is_active (الروستر المُحدَّث مرجعي).
  if (em.is_active === true) patch.employmentStatus = 'active';
  else if (em.is_active === false) patch.employmentStatus = 'terminated';
  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);
  return patch;
}

// الفروع في قاعدة البيانات بأسماء إنجليزية؛ الملف عربي — نربطهما.
const BRANCH_AR2EN = {
  'الدمام': 'Al Dammam', 'جدة': 'Jeddah', 'جازان': 'Jazan', 'حوطة سدير': 'Sudair',
  'ينبع': 'Yanbu', 'الرياض': 'Riyadh', 'رابغ': 'Rabigh', 'مكه': 'Makkah', 'مكة': 'Makkah',
};

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const raw = require(path.join(__dirname, '..', 'data', 'masters', 'hr_master_employees.json'));
  const rows = Array.isArray(raw) ? raw : (raw.employees || raw.records || []);

  const Branch = require('../models/Branch');
  const branches = await Branch.find({}).select('name nameAr').lean();
  const branchByName = new Map();
  for (const b of branches) { if (b.name) branchByName.set(norm(b.name), b._id); if (b.nameAr) branchByName.set(norm(b.nameAr), b._id); }
  const resolveBranch = (ar) => {
    if (!ar) return undefined;
    const en = BRANCH_AR2EN[String(ar).trim()];
    return (en && branchByName.get(norm(en))) || branchByName.get(norm(ar)) || undefined;
  };

  const emps = await Employee.find({}).select('email employeeNumber nationalId iqamaNumber employmentStatus').lean();
  const byEmail = new Map(); const byNum = new Map(); const byNat = new Map(); const byIq = new Map();
  for (const e of emps) {
    if (e.email) byEmail.set(norm(e.email), e);
    if (e.employeeNumber) byNum.set(norm(e.employeeNumber), e);
    if (e.nationalId) byNat.set(norm(e.nationalId), e);
    if (e.iqamaNumber) byIq.set(norm(e.iqamaNumber), e);
  }
  const findExisting = (r) => {
    const pe = norm(r.contact && r.contact.personal_email);
    const ce = norm(r.contact && r.contact.company_email);
    const nat = norm(r.identity && r.identity.national_id);
    const num = norm(r.employee_number);
    return (pe && byEmail.get(pe)) || (ce && byEmail.get(ce)) || (num && byNum.get(num)) || (nat && (byNat.get(nat) || byIq.get(nat))) || null;
  };

  let updated = 0; let created = 0; let willTerminate = 0;
  const usedIds = new Set();
  let branchResolved = 0; let branchUnresolved = 0;
  for (const r of rows) {
    const patch = mapRow(r);
    const bId = resolveBranch(r.employment && r.employment.branch_ar);
    if (bId) { patch.branch = bId; branchResolved++; } else if (r.employment && r.employment.branch_ar) branchUnresolved++;
    const ex = findExisting(r);
    if (ex) {
      if (patch.employmentStatus === 'terminated' && ex.employmentStatus !== 'terminated') willTerminate++;
      usedIds.add(String(ex._id));
      if (COMMIT) await Employee.updateOne({ _id: ex._id }, { $set: patch });
      updated++;
    } else {
      const name = (r.identity && r.identity.full_name_ar) || 'موظف';
      const parts = String(name).trim().split(/\s+/);
      const doc = { ...patch, firstName: parts[0], lastName: parts.slice(1).join(' ') || parts[0] };
      if (COMMIT) await Employee.create(doc);
      created++;
    }
  }
  const notInFile = emps.filter((e) => !usedIds.has(String(e._id))).length;
  console.log(`${COMMIT ? 'COMMITTED' : 'DRY RUN'} — new rows: ${rows.length}`);
  console.log(`updated (matched, _id preserved): ${updated}`);
  console.log(`created (new employees): ${created}`);
  console.log(`existing NOT in file (left untouched — may hold custody): ${notInFile}`);
  console.log(`would set to terminated (were active/other): ${willTerminate}`);
  console.log(`branch resolved: ${branchResolved} | branch unresolved: ${branchUnresolved}`);
  await mongoose.disconnect();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
