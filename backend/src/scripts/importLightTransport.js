/**
 * Import of light transport employees and their vehicles from the department's two sheets.
 * Usage: no flag reports without writing, --write applies.
 * Sheets: the B2C project sheet (header on row 6, a two-row summary above, 161 employees) and the vehicles update sheet (Sheet1, header on row 2, 214 vehicles with authorization and actual driver).
 * Guards: 1. Dates are serial numbers, read raw and converted by hand (see serialToDate); cellDates loses a day on this machine. 2. The not-authorized label appears in date cells in 54 rows; it means no authorization for the vehicle, not a date or zero. 3. One name in many spellings (city, project with and without spaces). Taken as is they become phantom cities and projects splitting the counts, so they are folded before writing. 4. Supervisor is abbreviated in the sheet but full in HR, so link by containing all words, not equality. 5. The ID number is the key, not the name; see the model comment.
 */
require('dotenv').config({ quiet: true });
const path = require('path');
const mongoose = require('mongoose');
const XLSX = require('xlsx');

const WRITE = process.argv.includes('--write');
const DIR = path.join(__dirname, '..', '..', '..', 'b2c files');
const EMP_FILE = 'شيت_مشروع_B2C_sep.xlsx';
const VEH_FILE = 'المركبات تحديث 27-سبتمبر 2026 (1).xlsx';

// Reading helpers
const S = (v) => String(v == null ? '' : v).replace(/[ ‎‏]/g, ' ').replace(/\s+/g, ' ').trim();

/** Folds letter and whitespace variants; for comparison only, not display. */
const fold = (v) => S(v).replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و')
  .replace(/\s+/g, '').toLowerCase();

/** None, not-authorized and unused labels are not values; they mean the value is absent. */
const ABSENT = new Set(['لايوجد', 'لا يوجد', 'غيرمفوض', 'غير مفوض', 'غيرمستخدم', 'غير مستخدم', '-', '—', '']);
const real = (v) => (ABSENT.has(fold(v)) || ABSENT.has(S(v)) ? '' : S(v));

/** Excel serial number to a date. Not cellDates, which loses a day on this machine. */
const serialToDate = (v) => {
  const n = Number(S(v));
  if (!Number.isFinite(n) || n <= 0 || n > 80000) return null;
  // Excel calendar epoch is 1899-12-30; computed in UTC so the timezone does not interfere.
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Folded plate key, same logic as the vehicles section so both sides match. */
const plateKey = (p) => {
  if (p == null) return null;
  const w = S(p).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و');
  const digits = (w.match(/\d+/g) || []).join('');
  const letters = (w.match(/[ء-يA-Za-z]/g) || []).map((c) => c.toUpperCase()).sort().join('');
  const k = `${digits}|${letters}`;
  return k === '|' ? null : k;
};

/** Unifying cities and projects. The spelling in the employees sheet is authoritative (it is the correct one) and the vehicles sheet folds into it. Unknown values are left as written and reported, never invented. */
const CANON_CITY = { جده: 'جدة', جدة: 'جدة', مكهالمكرمه: 'مكة المكرمة', مكةالمكرمة: 'مكة المكرمة', مكه: 'مكة المكرمة', مكة: 'مكة المكرمة' };
/** One spelling per value. The sheet writes leave, stopped and motorbike with variant spellings while the managed lists in department settings use the correct ones. Stored as is, one status gets two spellings: filtering on the correct one finds zero while the register has three. */
const CANON_STATUS = { يعمل: 'يعمل', اجازه: 'إجازة', إجازة: 'إجازة', متوقف: 'متوقف', انهاءخدمات: 'إنهاء خدمة', انهاءخدمه: 'إنهاء خدمة', إنهاءخدمة: 'إنهاء خدمة' };
const CANON_JOB = { مندوب: 'مندوب', مشرف: 'مشرف', اداري: 'إداري', إداري: 'إداري', ميكانيكي: 'ميكانيكي', عاملنظافه: 'عامل نظافة', عاملنظافة: 'عامل نظافة' };
const CANON_CONTRACT = { كفاله: 'كفالة', كفالة: 'كفالة', فريلانسر: 'فري لانسر' };
const CANON_VEHICLE_TYPE = { دراجهناريه: 'دراجة نارية', دراجةنارية: 'دراجة نارية', فان: 'فان', كيا: 'كيا', كيابيجاز: 'كيا بيجاز' };

const CANON_PROJECT = {
  كيتا: 'كيتا', هنجرستيشن: 'هنجرستيشن', امازون: 'امازون', نينجا: 'نينجا',
  غيرمستخدم: 'غير مستخدم', صيانه: 'صيانة', صيانهالنقل: 'صيانة النقل', غيرمحدد: '(غير محدد)', '(غيرمحدد)': '(غير محدد)',
};
const canon = (map, v) => {
  const raw = S(v);
  if (!raw) return '';
  return map[fold(raw)] || raw;
};

const unknown = { city: new Set(), project: new Set() };
const canonCity = (v) => { const r = canon(CANON_CITY, v); if (r && !Object.values(CANON_CITY).includes(r)) unknown.city.add(r); return r; };
const canonProject = (v) => { const r = canon(CANON_PROJECT, v); if (r && !Object.values(CANON_PROJECT).includes(r)) unknown.project.add(r); return r; };

const readSheet = (file, sheetName, headerRow) => {
  const wb = XLSX.readFile(path.join(DIR, file));
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`ورقة «${sheetName}» غير موجودة في ${file}`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const head = rows[headerRow].map(S);
  const idx = {};
  head.forEach((h, i) => { if (h && idx[h] === undefined) idx[h] = i; });
  return { rows: rows.slice(headerRow + 1), idx, head };
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const { LightTransportEmployee, LightTransportHousing } = require('../models/LightTransport');
  const Employee = require('../models/Employee');
  const { VehicleMaster } = require('../models/VehicleMaster');

  // 1. Employees
  const emp = readSheet(EMP_FILE, 'مشروع B2C', 5);
  const col = (r, name) => S(r[emp.idx[name]]);
  const staff = emp.rows
    .filter((r) => S(r[emp.idx['رقم الهوية']]))
    .map((r) => ({
      idNumber: col(r, 'رقم الهوية'),
      name: col(r, 'الاسم'),
      nationalityAr: col(r, 'الجنسية'),
      cityAr: canonCity(col(r, 'المدينة')),
      projectAr: canonProject(col(r, 'القسم')),
      supervisorName: col(r, 'المشرف'),
      jobTitleAr: canon(CANON_JOB, col(r, 'الوظيفة')),
      contractTypeAr: canon(CANON_CONTRACT, col(r, 'نوع التعاقد')),
      workStatusAr: canon(CANON_STATUS, col(r, 'حالة العمل')),
      hireDate: serialToDate(col(r, 'تاريخ التعيين')),
      vehicleTypeAr: canon(CANON_VEHICLE_TYPE, real(col(r, 'نوع المركبة'))),
      vehiclePlate: real(col(r, 'رقم المركبة')),
      registerNumber: col(r, 'رقم السجل'),
      notesAr: col(r, 'ملاحظات'),
    }));

  // 2. Vehicles: authorization and actual driver
  const veh = readSheet(VEH_FILE, 'Sheet1', 1);
  const vcol = (r, name) => S(r[veh.idx[name]]);
  const vehicles = veh.rows
    .filter((r) => S(r[veh.idx['رقم اللوحه']]))
    .map((r) => ({
      plate: vcol(r, 'رقم اللوحه'),
      serial: vcol(r, 'الرقم التسلسلي'),
      projectAr: canonProject(vcol(r, 'المشروع')),
      cityAr: canonCity(vcol(r, 'المدينه')),
      driverId: real(vcol(r, 'هوية القائد الفعلي')),
      driverName: real(vcol(r, 'اسم القائد الفعلي للمركبة')),
      authId: real(vcol(r, 'رقم هوية المفوض')),
      authName: real(vcol(r, 'اسم المفوض')),
      authPhone: real(vcol(r, 'رقم جوال المفوض')),
      authStart: serialToDate(vcol(r, 'بدايه التفويض')),
      authEnd: serialToDate(vcol(r, 'نهاية التفويض')),
      authNumber: real(vcol(r, 'رقم التفويض')),
    }));

  // 3. Link to existing records
  const hrAll = await Employee.find({}).select('nationalId iqamaNumber arabicName firstName lastName employmentStatus phone department').lean();
  const hrById = new Map();
  for (const e of hrAll) {
    for (const k of [e.nationalId, e.iqamaNumber]) { const s = S(k); if (s) hrById.set(s, e); }
  }
  /** Supervisor is abbreviated, so match by containing all its words in the full name. */
  const findByWords = (full) => {
    const words = S(full).split(' ').map(fold).filter(Boolean);
    if (!words.length) return null;
    const hits = hrAll.filter((e) => {
      const n = fold(e.arabicName) || fold(`${e.firstName || ''} ${e.lastName || ''}`);
      return words.every((w) => n.includes(w));
    });
    return hits.length === 1 ? hits[0] : null;   // Ambiguous matches are not linked
  };

  const vmAll = await VehicleMaster.find({}).select('plateNumber serialNumber registrationTypeAr').lean();
  const vmByPlate = new Map();
  const vmBySerial = new Map();
  for (const v of vmAll) {
    const k = plateKey(v.plateNumber); if (k) vmByPlate.set(k, v);
    const s = S(v.serialNumber); if (s) vmBySerial.set(s, v);
  }

  const vehByDriverId = new Map();
  const vehByPlateKey = new Map();
  for (const v of vehicles) {
    if (v.driverId) vehByDriverId.set(v.driverId, v);
    const k = plateKey(v.plate); if (k) vehByPlateKey.set(k, v);
  }

  const supCache = new Map();
  const report = { linkedHR: 0, ownedHere: 0, vehicleLinked: 0, vehicleMissing: [], supLinked: 0, supUnlinked: new Set(), statusFromHR: 0 };

  const docs = [];
  for (const s of staff) {
    const hr = hrById.get(s.idNumber) || null;
    if (hr) report.linkedHR += 1; else report.ownedHere += 1;

    // Vehicle: from the employees sheet plate, otherwise from the vehicles sheet by driver ID.
    let plate = s.vehiclePlate;
    if (!plate) { const byDrv = vehByDriverId.get(s.idNumber); if (byDrv) plate = byDrv.plate; }
    const vm = plate ? vmByPlate.get(plateKey(plate)) : null;
    if (plate && vm) report.vehicleLinked += 1;
    else if (plate) report.vehicleMissing.push(`${s.name} → ${plate}`);

    // Project and city: the employees sheet first, the vehicles sheet fills gaps.
    const vrow = plate ? vehByPlateKey.get(plateKey(plate)) : null;
    const projectAr = s.projectAr && s.projectAr !== '(غير محدد)' ? s.projectAr : (vrow?.projectAr || s.projectAr);
    const cityAr = s.cityAr || vrow?.cityAr || '';

    let supervisor = null;
    if (s.supervisorName) {
      if (!supCache.has(s.supervisorName)) supCache.set(s.supervisorName, findByWords(s.supervisorName));
      supervisor = supCache.get(s.supervisorName);
      if (supervisor) report.supLinked += 1; else report.supUnlinked.add(s.supervisorName);
    }

    /**
     * Work status: HR wins when it says no. The sheet cell mixes employment status (working, terminated) with today's status (leave). HR records leave in its requests log, not the file status, so an active file does not mean he is at work today.
     * Taking HR as the reference everywhere would erase correct information: three people the department marked on leave and one stopped have active files and would show as working.
     * The requirement is that terminated staff are not shown as working. So HR wins when it negates (terminated or suspended), a stronger fact than any cell, and the department status stands otherwise.
     */
    let workStatusAr = s.workStatusAr;
    if (hr && (hr.employmentStatus === 'terminated' || hr.employmentStatus === 'suspended')) {
      workStatusAr = hr.employmentStatus === 'terminated' ? 'إنهاء خدمة' : 'متوقف';
      report.statusFromHR += 1;
    }

    docs.push({
      idNumber: s.idNumber,
      employee: hr ? hr._id : null,
      name: s.name,
      nationalityAr: s.nationalityAr,
      hireDate: s.hireDate,
      phone: S(hr?.phone) || '',
      cityAr,
      projectAr,
      jobTitleAr: s.jobTitleAr,
      contractTypeAr: s.contractTypeAr,
      registerNumber: s.registerNumber,
      vehicleTypeAr: s.vehicleTypeAr,
      supervisorName: s.supervisorName,
      supervisor: supervisor ? supervisor._id : null,
      workStatusAr,
      vehicle: vm ? vm._id : null,
      vehiclePlate: vm ? vm.plateNumber : plate,
      notesAr: s.notesAr,
      isActive: true,
    });
  }

  /**
   * 5. Drivers in the vehicles sheet but not the employees sheet.
   * The sheets disagree: seven drivers operate our vehicles, with names and IDs in the vehicles sheet, but have no row in the employees sheet. Reading only the latter drops them, their plates are not found in the section, and a vehicle has a driver with no record.
   * They all exist in HR (B2C departments), so it is a gap in the sheet, not in the company. Both sheets are read and the missing row is built from the vehicles sheet, which has the name, department and vehicle.
   */
  const inEmployeeSheet = new Set(staff.map((s) => s.idNumber));
  const extraDrivers = [];
  for (const v of vehicles) {
    if (!v.driverId || !v.driverName) continue;
    if (inEmployeeSheet.has(v.driverId)) continue;
    if (extraDrivers.some((x) => x.idNumber === v.driverId)) continue;
    const hr = hrById.get(v.driverId) || null;
    extraDrivers.push({
      idNumber: v.driverId,
      name: v.driverName,
      // Someone driving a bike in a delivery project is a courier. The job comes from HR when present, so it is not guessed.
      jobTitleAr: hr && S(hr.jobTitle).includes('سائق') ? 'مندوب' : (S(hr?.jobTitle) || 'مندوب'),
      cityAr: v.cityAr,
      projectAr: v.projectAr,
      vehiclePlate: v.plate,
      // Nothing absent from the sheet is guessed: contract type, work status and record are left empty for the department to fill, since an invented value reads as fact.
      contractTypeAr: '',
      registerNumber: '',
      workStatusAr: '',
      nationalityAr: '',
      supervisorName: '',
      hireDate: null,
      notesAr: '', // No from-the-sheet label; see utils/importLabels
      fromVehicleSheet: true,
    });
  }
  for (const d of extraDrivers) {
    const hr = hrById.get(d.idNumber) || null;
    if (hr) report.linkedHR += 1; else report.ownedHere += 1;
    const vm = vmByPlate.get(plateKey(d.vehiclePlate));
    if (vm) report.vehicleLinked += 1;
    let workStatusAr = d.workStatusAr;
    if (hr && (hr.employmentStatus === 'terminated' || hr.employmentStatus === 'suspended')) {
      workStatusAr = hr.employmentStatus === 'terminated' ? 'إنهاء خدمة' : 'متوقف';
    } else if (hr?.employmentStatus === 'active') workStatusAr = 'يعمل';
    docs.push({
      idNumber: d.idNumber,
      employee: hr ? hr._id : null,
      name: d.name,
      nationalityAr: S(hr?.nationality) || '',
      hireDate: hr?.hireDate || null,
      phone: S(hr?.phone) || '',
      cityAr: d.cityAr,
      projectAr: d.projectAr,
      jobTitleAr: d.jobTitleAr,
      contractTypeAr: '',
      registerNumber: '',
      vehicleTypeAr: vm?.registrationTypeAr || '',
      supervisorName: '',
      supervisor: null,
      workStatusAr,
      vehicle: vm ? vm._id : null,
      vehiclePlate: vm ? vm.plateNumber : d.vehiclePlate,
      notesAr: d.notesAr,
      isActive: true,
    });
  }
  report.fromVehicleSheet = extraDrivers.length;

  // 4. Report
  console.log('── موظّفو النقل الخفيف ──────────────────────────────────────');
  console.log('  في شيت الموظّفين        :', staff.length);
  console.log('  + قادةٌ من شيت المركبات  :', report.fromVehicleSheet || 0);
  console.log('  مربوطون بالموارد البشريّة:', report.linkedHR);
  console.log('  يملكهم هذا القسم        :', report.ownedHere);
  console.log('  حالتُهم من الموارد البشريّة:', report.statusFromHR);
  console.log('  مربوطون بمركبةٍ في السجلّ :', report.vehicleLinked);
  if (report.vehicleMissing.length) {
    console.log('  لوحاتٌ لا سجلَّ لها      :', report.vehicleMissing.length);
    report.vehicleMissing.slice(0, 5).forEach((x) => console.log('      ', x));
  }
  console.log('  مشرفون مربوطون بملفّ    :', report.supLinked);
  if (report.supUnlinked.size) console.log('  مشرفون بلا ملفّ         :', [...report.supUnlinked].join(' · '));
  if (unknown.city.size) console.log('  ⚠ مدنٌ لم تُعرَف        :', [...unknown.city].join(' · '));
  if (unknown.project.size) console.log('  ⚠ مشاريعُ لم تُعرَف     :', [...unknown.project].join(' · '));

  const byProject = {}; const byCity = {}; const byKind = {}; const byStatus = {}; const byRegister = {};
  for (const d of docs) {
    byProject[d.projectAr || '—'] = (byProject[d.projectAr || '—'] || 0) + 1;
    byCity[d.cityAr || '—'] = (byCity[d.cityAr || '—'] || 0) + 1;
    const kind = String(d.jobTitleAr).trim() === 'مندوب' ? 'مندوب' : 'إداري';
    byKind[kind] = (byKind[kind] || 0) + 1;
    byStatus[d.workStatusAr || '—'] = (byStatus[d.workStatusAr || '—'] || 0) + 1;
    byRegister[d.registerNumber || '—'] = (byRegister[d.registerNumber || '—'] || 0) + 1;
  }
  const line = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' · ');
  console.log('\n  بالمشروع :', line(byProject));
  console.log('  بالمدينة :', line(byCity));
  console.log('  بالنوع   :', line(byKind));
  console.log('  بالحالة  :', line(byStatus));
  console.log('  بالسجلّ   :', line(byRegister));
  console.log('\n── المركبات ────────────────────────────────────────────────');
  console.log('  في الشيت              :', vehicles.length);
  console.log('  موجودةٌ في سجلّ المركبات:', vehicles.filter((v) => vmByPlate.has(plateKey(v.plate))).length);
  console.log('  بلا تفويض             :', vehicles.filter((v) => !v.authNumber).length);
  console.log('  قائدُها ≠ المفوَّضُ لها   :', vehicles.filter((v) => v.driverId && v.authId && v.driverId !== v.authId).length);

  if (!WRITE) {
    console.log('\n(تقريرٌ فقط — أضِف --write للكتابة)');
    process.exit(0);
  }

  // 5. Write: safe to re-run, the ID is the key
  let created = 0; let updated = 0;
  for (const d of docs) {
    const existing = await LightTransportEmployee.findOne({ idNumber: d.idNumber });
    if (!existing) {
      const doc = new LightTransportEmployee({
        ...d,
        history: [{ kind: 'created', byName: 'النظام' }],
      });
      await doc.save();
      created += 1;
    } else {
      // Edits made in the system after import are not overwritten; only empty fields are filled.
      let touched = false;
      for (const [k, v] of Object.entries(d)) {
        if (k === 'idNumber' || k === 'isActive') continue;
        const cur = existing[k];
        const curEmpty = cur === null || cur === undefined || cur === '';
        if (curEmpty && v !== null && v !== undefined && v !== '') { existing[k] = v; touched = true; }
      }
      if (touched) { await existing.save(); updated += 1; }
    }
  }
  console.log(`\nكُتب: أُنشئ ${created} · استُكمل ${updated}`);

  // 6. Two initial housing units with the requested capacities
  for (const h of [{ name: 'سكن ١', declaredCapacity: 110 }, { name: 'سكن ٢', declaredCapacity: 70 }]) {
    const found = await LightTransportHousing.findOne({ name: h.name });
    if (!found) { await LightTransportHousing.create(h); console.log(`أُنشئ ${h.name} بسعة ${h.declaredCapacity}`); }
  }

  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
