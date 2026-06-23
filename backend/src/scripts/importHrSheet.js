/**
 * Import the HR sheet (employees + their current vehicle authorizations).
 *
 * Usage:
 *   1. Save the FULL sheet JSON (the { "employees": [ ... ] } object the user
 *      provides) to a file, e.g. backend/src/scripts/hr-sheet.json
 *   2. From the backend folder run:
 *        node src/scripts/importHrSheet.js src/scripts/hr-sheet.json
 *      Add --dry to preview without writing:
 *        node src/scripts/importHrSheet.js src/scripts/hr-sheet.json --dry
 *
 * It is idempotent: employees are upserted by iqama (then employee number), and
 * a vehicle + its active authorization are created/kept in sync from the
 * "المركبه" column. Re-running updates rather than duplicates.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Employee = require('../models/Employee');
const Branch = require('../models/Branch');
const Vehicle = require('../models/Vehicle');
const VehicleAuthorization = require('../models/VehicleAuthorization');

const DRY = process.argv.includes('--dry');
const fileArg = process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) || 'src/scripts/hr-sheet.json';

// ── value cleaners ──────────────────────────────────────────────────────────
const BAD = new Set(['#n/a', 'n/a', '00:00:00', '', '0']);
const str = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return BAD.has(s.toLowerCase()) ? '' : s;
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const date = (v) => {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
};
const hasArabic = (s) => /[؀-ۿ]/.test(s || '');

const G = (row, key) => row[key];

// Map the work-status free text to the employmentStatus enum.
const mapEmploymentStatus = (txt) => {
  const s = str(txt);
  if (s.includes('اجاز')) return 'on_leave';
  if (s.includes('موقوف') || s.includes('إيقاف') || s.includes('ايقاف')) return 'suspended';
  if (s.includes('منتهي') || s.includes('استقال') || s.includes('انهاء')) return 'terminated';
  return 'active';
};

// Infer a vehicle type from the driving-license type / iqama profession text.
const inferVehicleType = (licenseType, profession) => {
  const s = `${str(licenseType)} ${str(profession)}`;
  if (s.includes('ثقيل') || s.includes('شاحنة') || s.includes('مقطورة')) return 'heavy_truck';
  if (s.includes('دراجة') || s.includes('نارية') || s.includes('الية') || s.includes('آلية')) return 'motorcycle';
  return 'car';
};

const splitName = (full) => {
  const s = str(full).replace(/\s+/g, ' ').trim();
  if (!s) return { firstName: '—', lastName: '' };
  const parts = s.split(' ');
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || parts[0] };
};

async function run() {
  const abs = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
  if (!fs.existsSync(abs)) {
    console.error(`Data file not found: ${abs}\nSave the sheet JSON there first (see header of this script).`);
    process.exit(1);
  }
  const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const rows = Array.isArray(parsed) ? parsed : (parsed.employees || []);
  if (!rows.length) { console.error('No employee rows found in the file.'); process.exit(1); }

  await connectDB();
  const branches = await Branch.find({}).lean();
  const branchByName = (name) => {
    const s = str(name);
    if (!s) return null;
    const b = branches.find((x) => x.name && (x.name === s || x.name.includes(s) || s.includes(x.name)));
    return b ? b._id : null;
  };

  let created = 0, updated = 0, vehicles = 0, auths = 0, skippedAuth = 0;

  for (const row of rows) {
    const iqama = str(G(row, 'رقم الهوية'));
    const empNo = str(G(row, 'الرقم الوظيفي'));
    const { firstName, lastName } = splitName(G(row, 'الاسم'));
    const fullName = str(G(row, 'الاسم'));

    const fields = {
      firstName, lastName,
      arabicName: hasArabic(fullName) ? fullName : '',
      employeeNumber: empNo,
      idType: 'iqama',
      iqamaNumber: iqama,
      iqamaExpiry: date(G(row, 'تاريخ انتهاء الاقامه')),
      dateOfBirth: date(G(row, 'تاريخ الميلاد')),
      hireDate: date(G(row, 'تاريخ التعيين')),
      nationality: str(G(row, 'الجنسيه')),
      department: str(G(row, 'القسم')),
      workLocation: str(G(row, 'الفرع')),
      jobTitle: str(G(row, 'المسمي الوظيفي')),
      email: str(G(row, 'الايميل')).toLowerCase(),
      passportNumber: str(G(row, 'رقم جواز السفر')),
      passportExpiry: date(G(row, 'تاريخ الانتهاء (رقم جواز السفر)')),
      employmentStatus: mapEmploymentStatus(G(row, 'حاله العمل')),
      workStatusText: str(G(row, 'حاله العمل')),
      // Banking
      iban: str(G(row, 'الايبان')),
      bank: str(G(row, 'البنك')),
      // Extra
      fileStatus: str(G(row, 'حاله الملف')),
      absherNumber: str(G(row, 'رقم ابشر')),
      absherStatus: str(G(row, 'رقم ابشر')) ? 'مسجل' : '',
      companyNumber: str(G(row, 'رقم الشركه')),
      originCountryNumber: str(G(row, 'رقم دوله الأصل')),
      project: str(G(row, 'المشروع')),
      registerNumber: str(G(row, 'رقم السجل')),
      systemStatus: str(G(row, 'حاله النظام')),
      penaltyClause: num(G(row, 'الشرط الجزائي')),
      iqamaProfession: str(G(row, 'المهنه في الاقامه')),
      classification: str(G(row, 'التصنيف')),
      insuranceCompany: str(G(row, 'شركه التامين')),
      insuranceExpiry: date(G(row, 'تاريخ انتهاء التامين')),
      socialInsuranceStatus: str(G(row, 'حاله التامينات الاجتماعيه')),
      visaExpiry: date(G(row, 'انتهاء التأشيرة')),
      lastTravelDate: date(G(row, 'تاريخ السفر 2025')) || date(G(row, 'تاريخ السفر 2024')),
      lastReturnDate: date(G(row, 'تاريخ الرجوع 2025')) || date(G(row, 'تاريخ الرجوع 2024')),
      // Driving / vehicle
      vehiclePlate: str(G(row, 'المركبه')),
      licenseType: str(G(row, 'نوع الرخصه قياده')),
      licenseExpiry: date(G(row, 'انتهاء الرخصه القياده')),
      driverCardStatus: str(G(row, 'حاله كارت السائق')),
      driverCardNumber: str(G(row, 'رقم كارت السائق')),
      driverCardType: str(G(row, 'نوعه')),
      driverCardExpiry: date(G(row, 'تاريخ الانتهاء (نوعه)')),
      workCard: str(G(row, 'كارت العمل')),
      ajeerStatus: str(G(row, 'حاله اجير')),
      ajeerExpiry: date(G(row, 'تاريخ الانتهاء (حاله اجير)')),
    };
    const branchId = branchByName(G(row, 'الفرع'));
    if (branchId) fields.branch = branchId;
    // Drop empty strings so we don't overwrite good data with blanks on re-run.
    Object.keys(fields).forEach((k) => { if (fields[k] === '' || fields[k] === undefined) delete fields[k]; });

    // Upsert employee by iqama (the unique identity). Only fall back to employee
    // number when the row has NO iqama — employee numbers can repeat across rows,
    // and matching on them would wrongly merge two distinct people.
    let emp = null;
    if (iqama) emp = await Employee.findOne({ iqamaNumber: iqama });
    else if (empNo) emp = await Employee.findOne({ employeeNumber: empNo });

    if (DRY) {
      console.log(`${emp ? 'UPDATE' : 'CREATE'} ${fields.firstName} ${fields.lastName || ''} (iqama ${iqama || '—'}) plate=${fields.vehiclePlate || '—'}`);
    } else if (emp) {
      Object.assign(emp, fields);
      await emp.save();
      updated++;
    } else {
      emp = await Employee.create(fields);
      created++;
    }

    // Vehicle + active authorization from the plate column.
    const plate = fields.vehiclePlate;
    if (plate && !DRY && emp) {
      let veh = await Vehicle.findOne({ plateNumber: plate });
      if (!veh) {
        veh = await Vehicle.create({
          plateNumber: plate,
          type: inferVehicleType(fields.licenseType, fields.iqamaProfession),
          department: fields.department || '',
          project: fields.project || '',
          branch: branchId || undefined,
          status: 'available',
        });
        vehicles++;
      }
      const activeAny = await VehicleAuthorization.findOne({ vehicle: veh._id, status: 'active' });
      if (!activeAny) {
        const auth = await VehicleAuthorization.create({
          vehicle: veh._id, employee: emp._id,
          startDate: fields.hireDate || new Date().toISOString().slice(0, 10),
          authorizationType: 'تفويض قيادة',
          notes: 'مستورد من شيت الموارد البشرية',
        });
        await Vehicle.findByIdAndUpdate(veh._id, { currentAuthorization: auth._id, currentEmployee: emp._id, status: 'authorized' });
        auths++;
      } else if (String(activeAny.employee) !== String(emp._id)) {
        skippedAuth++;
        console.warn(`Plate ${plate}: already actively authorized to another employee — left as-is.`);
      }
    }
  }

  console.log(`\nDone. employees created=${created} updated=${updated} | vehicles created=${vehicles} authorizations created=${auths} skipped=${skippedAuth}${DRY ? ' (DRY RUN — nothing written)' : ''}`);
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((e) => { console.error('Import failed:', e); process.exit(1); });
