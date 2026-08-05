/**
 * importHrMasterFinal — ماستر الموارد البشرية v2.0 من data/masters/hr_master_final.json.
 *
 *   node src/scripts/importHrMasterFinal.js --dry
 *   node src/scripts/importHrMasterFinal.js
 *
 * ٣٧٨ موظف · ٥١ عمود. الهوية: الرقم الوظيفي أولًا، وبعده رقم الهوية/الإقامة —
 * الرقم الوظيفي ممكن يتغيّر أو يكون «مطلوب»، ورقم الهوية هو الثابت.
 *
 * الحاجة اللي الاستيراد ده مبني عليها: **حالة كل حقل بتتخزّن**. الملف بيقول لكل
 * حقل «مطلوب» (ناقص ولازم يتجمّع) ولا «غير مطلوب» (لا ينطبق) — والفرق ده هو
 * اللي بيحوّل الداشبورد من أرقام لقايمة شغل. لو خزّنّا القيمة الفاضية وبس، كنا
 * هنخسر السبب.
 *
 * idempotent، وما بيمسحش شغل بني آدم: أي حقل الموارد البشرية ملّته من الشاشة
 * والماستر لسه بيقول عليه «مطلوب» **بيتساب زي ما هو** — الشيت أقدم من التعديل.
 */
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const d = (v) => { if (!v) return null; const x = new Date(v); return isNaN(x) ? null : x; };
const s = (v) => (v === null || v === undefined ? '' : String(v).trim());
const filled = (v) => !(v === null || v === undefined || v === '');
// الموديل بيخزّن الجنس بالإنجليزي (enum)، والملف بالعربي. الترجمة هنا مش في
// الموديل عشان العرض يفضل بالعربي من مصدر واحد (config/hrFields).
const GENDER = { 'ذكر': 'male', 'أنثى': 'female', 'انثى': 'female' };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const Employee = require('../models/Employee');
  const H = require('../config/hrFields');

  const src = require(path.join(__dirname, '..', 'data', 'masters', 'hr_master_final.json'));
  console.log(`المصدر: ${src.employees.length} موظف · ${src.meta.column_count} عمود${DRY ? '   (تجربة)' : ''}\n`);

  let created = 0; let updated = 0; let keptEdits = 0; let cleared = 0;
  const failures = [];
  const statusTally = {};

  for (const e of src.employees) {
    const id = e.identity || {}; const c = e.contact || {}; const em = e.employment || {};
    const iq = e.iqama || {}; const pp = e.passport || {}; const ct = e.contract || {};
    const mi = e.medical_insurance || {}; const hc = e.health_certificate || {};
    const dc = e.driver_card || {}; const dl = e.driving_license || {};

    // الاسم: الملف بيدّي اسم واحد كامل، والموديل عنده first/last منفصلين.
    const full = s(id.full_name);
    const parts = full.split(/\s+/).filter(Boolean);

    const doc = {
      employeeNumber: s(e.employee_number),
      arabicName: full,
      firstName: parts[0] || full || '—',
      lastName: parts.slice(1).join(' ') || '—',
      iqamaNumber: s(id.id_number),
      idType: s(id.id_type),
      gender: GENDER[s(id.gender_ar)] || '',
      nationality: s(id.nationality_ar),
      dateOfBirth: d(id.date_of_birth),

      email: s(c.personal_email),
      companyEmail: s(c.company_email),
      absherNumber: s(c.absher_phone),
      companyNumber: s(c.company_phone),
      originCountryNumber: s(c.home_country_phone),
      address: s(c.national_address),

      employerNumber: s(em.employer_number),
      project: s(em.business_unit_ar),
      department: s(em.department_ar),
      branchName: s(em.branch_ar),
      directManagerName: s(em.line_manager_ar),
      workStatusText: s(em.work_status_ar),
      systemStatus: s(em.system_status_ar),
      hireDate: d(em.hire_date),
      isOutsideKingdom: !!em.is_outside_kingdom,
      isFreelancer: !!em.is_freelancer,
      employmentStatus: em.is_active === false ? 'terminated' : 'active',

      gosiNumber: s(e.gosi?.number),
      iban: s(e.banking?.iban),
      bank: s(e.banking?.bank_code),

      iqamaIssueDate: d(iq.issue_date),
      iqamaExpiry: d(iq.expiry_date_gregorian),
      iqamaExpiryHijri: s(iq.expiry_date_hijri),
      iqamaProfession: s(iq.occupation_ar),

      passportNumber: s(pp.number),
      passportExpiry: d(pp.expiry_date),

      contractStatusText: s(ct.status_ar),
      qiwaContractNumber: s(ct.number),
      contractOccupation: s(ct.occupation_ar),
      contractStartDate: d(ct.start_date),
      contractEndDate: d(ct.end_date),

      insuranceCompany: s(mi.company_ar),
      insuranceClass: s(mi.class),
      insuranceExpiry: d(mi.expiry_date),

      healthCertNumber: s(hc.number),
      healthCertExpiry: d(hc.expiry_date),

      driverCardStatus: s(dc.availability_ar),
      driverCardNumber: s(dc.number),
      driverCardExpiry: d(dc.expiry_date),

      licenseType: s(dl.type_ar),
      licenseExpiry: d(dl.expiry_date),

      notes: s(e.notes_ar),
      inCurrentMaster: true,   // الصف ده في الماستر الحالي
    };

    // ── حالة كل حقل ──────────────────────────────────────────────────────────
    // الملف بيحط الحالة في `<x>_status` جنب الحقل. بنترجمها لمفاتيح الموديل.
    const st = {};
    const put = (fieldKey, code) => { if (code) { st[H.statusKeyOf(fieldKey)] = code; statusTally[code] = (statusTally[code] || 0) + 1; } };
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

    if (DRY) { created++; continue; }

    // الهوية: الرقم الوظيفي، وبعده رقم الإقامة — الاتنين ممكن يكونوا «مطلوب».
    let existing = null;
    if (doc.employeeNumber) existing = await Employee.findOne({ employeeNumber: doc.employeeNumber });
    if (!existing && doc.iqamaNumber) existing = await Employee.findOne({ iqamaNumber: doc.iqamaNumber });

    try {
    if (existing) {
      // ── القاعدة اللي اتصلحت ────────────────────────────────────────────────
      // الماستر لما يقول «مطلوب» يبقى معناه الحقل **فاضي فعلاً**، والقيمة اللي
      // عندنا بايتة من استيراد قديم ولازم تتمسح. كانت القاعدة القديمة بتحافظ
      // على أي قيمة موجودة، فطلع عندنا موظف الماستر بيقول إن إقامته «مطلوبة»
      // وإحنا بنعرض تاريخ ٢٠٠٥ ونقول «متأخر ٧٨٦٢ يوم». ٧٥٠ حقل كانوا كده.
      //
      // خانة فاضية من غير حالة حاجة تانية: دي ممكن تكون الشيت مش شايلها، فبنسيب
      // اللي عندنا. الفرق إن «مطلوب» **تصريح** إن الحقل ناقص، مش سكوت.
      const requiredNow = new Set(Object.keys(st).filter((k) => st[k] === 'required').map((k) => k.replace(/Status$/, '')));
      for (const [k, v] of Object.entries(doc)) {
        if (requiredNow.has(k)) {
          if (filled(existing[k])) cleared++;
          existing[k] = (v === null || typeof v === 'object') ? null : (typeof v === 'boolean' ? v : '');
          continue;
        }
        const incomingEmpty = !filled(v);
        const weHaveIt = filled(existing[k]);
        if (incomingEmpty && weHaveIt) { keptEdits++; continue; }
        existing[k] = v;
      }
      existing.fieldStatus = existing.fieldStatus || new Map();
      for (const [k, v] of Object.entries(st)) existing.fieldStatus.set(k, v);
      await existing.save();
      updated++;
    } else {
      const made = new Employee(doc);
      made.fieldStatus = new Map(Object.entries(st));
      await made.save();
      created++;
    }
    } catch (err) {
      // صف واحد فيه قيمة غريبة ما يوقّفش الـ ٣٧٨ — نسجّله ونكمّل، وفي الآخر
      // نطبع القايمة عشان تتصلّح.
      failures.push(`${doc.employeeNumber || doc.iqamaNumber || full}: ${err.message.split('\n')[0]}`);
    }
  }

  console.log(`الموظفون: ${created} جديد · ${updated} محدَّث${failures.length ? ` · ${failures.length} فشل` : ''}`);
  if (failures.length) { console.log('\nصفوف فشلت:'); failures.forEach((f) => console.log('    ' + f)); }
  if (cleared) console.log(`حقول بايتة اتمسحت (الماستر بيقول «مطلوب»): ${cleared}`);
  if (keptEdits) console.log(`حقول اتسابت زي ما هي (الشيت مش شايلها ومفيش حالة): ${keptEdits}`);
  console.log(`\nحالات الحقول في الملف: ${Object.entries(statusTally).map(([k, v]) => `${H.statusLabel(k)} ${v}`).join(' · ')}`);

  if (!DRY) {
    const total = await Employee.countDocuments({});
    const req = await Employee.countDocuments({ 'fieldStatus.employeeNumberStatus': 'required' });
    console.log(`\nالإجمالي في السيستم: ${total} موظف`);
    console.log(`مثال: ${req} موظف رقمه الوظيفي «مطلوب»`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
