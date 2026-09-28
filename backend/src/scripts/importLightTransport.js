/**
 * استيرادُ موظّفي النقل الخفيف ومركباتهم من شيتَي القسم.
 *
 *   node src/scripts/importLightTransport.js            # تقريرٌ بلا كتابة
 *   node src/scripts/importLightTransport.js --write    # يكتب
 *
 * ── الشيتان ─────────────────────────────────────────────────────────────────
 *   «شيت_مشروع_B2C_sep.xlsx» → ورقة «مشروع B2C»، ترويستُها في الصفّ السادس
 *      (فوقها ملخّصٌ من صفَّين)، وفيها مئةٌ وواحدٌ وستّون موظّفًا.
 *   «المركبات تحديث …» → ورقة Sheet1، ترويستُها في الصفّ الثاني، وفيها أربعَ
 *      عشرةَ ومئتا مركبةٍ مع تفويضها وقائدها الفعليّ.
 *
 * ── وما يُحتَرس منه ──────────────────────────────────────────────────────────
 * ① **التواريخُ أرقامٌ تسلسليّة** (45928) لا نصوص. تُقرأ أرقامًا وتُحوَّل يدويًّا —
 *    راجع `serialToDate`. وقراءتُها بـ`cellDates` تُنقص يومًا على هذا الجهاز.
 * ② **«غير مفوض» مكتوبةٌ في خانات التواريخ** في أربعةٍ وخمسين صفًّا. فهي ليست
 *    تاريخًا ولا صفرًا: هي «لا تفويضَ لهذه المركبة».
 * ③ **الاسمُ الواحدُ بصيغ**: المدينةُ «جدة» و«جده»، والمشروعُ «غير مستخدم» و
 *    «غيرمستخدم» بلا مسافة و«صيانه  النقل» بمسافتين. فلو أُخذت كما هي صارت في
 *    التقارير مدنًا ومشاريعَ وهميّةً تُقسَم عليها الأعداد. تُطوى قبل الكتابة.
 * ④ **المشرفُ يُكتب مختصرًا**: «إسلام سرور» في الشيت و«اسلام وحيد محمد ثروت
 *    سرور» في الموارد البشريّة. فالربطُ بتضمين كلّ كلماته لا بالتساوي.
 * ⑤ **الهويّةُ هي المفتاح** لا الاسم — راجع تعليقَ الموديل.
 */
require('dotenv').config({ quiet: true });
const path = require('path');
const mongoose = require('mongoose');
const XLSX = require('xlsx');

const WRITE = process.argv.includes('--write');
const DIR = path.join(__dirname, '..', '..', '..', 'b2c files');
const EMP_FILE = 'شيت_مشروع_B2C_sep.xlsx';
const VEH_FILE = 'المركبات تحديث 27-سبتمبر 2026 (1).xlsx';

// ── أدواتُ القراءة ──────────────────────────────────────────────────────────
const S = (v) => String(v == null ? '' : v).replace(/[ ‎‏]/g, ' ').replace(/\s+/g, ' ').trim();

/** يطوي صورَ الحروف والمسافات — للمقارنة فقط، لا للعرض. */
const fold = (v) => S(v).replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و')
  .replace(/\s+/g, '').toLowerCase();

/** «لايوجد» و«غير مفوض» و«غير مستخدم» ليست قيمًا — هي غيابُ قيمة. */
const ABSENT = new Set(['لايوجد', 'لا يوجد', 'غيرمفوض', 'غير مفوض', 'غيرمستخدم', 'غير مستخدم', '-', '—', '']);
const real = (v) => (ABSENT.has(fold(v)) || ABSENT.has(S(v)) ? '' : S(v));

/** رقمُ إكسل التسلسليُّ → تاريخ. لا `cellDates`: تُنقص يومًا على هذا الجهاز. */
const serialToDate = (v) => {
  const n = Number(S(v));
  if (!Number.isFinite(n) || n <= 0 || n > 80000) return null;
  // مبدأُ تقويم إكسل ٣٠ ديسمبر ١٨٩٩، والحسابُ بالـUTC كي لا تتدخّل المنطقة.
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** مفتاحُ اللوحة المطويّ — نفسُ منطق قسم المركبات، فالجانبان يتطابقان. */
const plateKey = (p) => {
  if (p == null) return null;
  const w = S(p).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و');
  const digits = (w.match(/\d+/g) || []).join('');
  const letters = (w.match(/[ء-يA-Za-z]/g) || []).map((c) => c.toUpperCase()).sort().join('');
  const k = `${digits}|${letters}`;
  return k === '|' ? null : k;
};

/**
 * ── توحيدُ المدن والمشاريع ──────────────────────────────────────────────────
 * الصيغةُ المكتوبةُ في شيت الموظّفين هي المعتمدة (هي الأصحُّ رسمًا)، وما في شيت
 * المركبات يُطوى إليها. وما لا يُعرَف يُترك كما كُتب ويُذكَر في التقرير — لا
 * يُخترَع له اسم.
 */
const CANON_CITY = { جده: 'جدة', جدة: 'جدة', مكهالمكرمه: 'مكة المكرمة', مكةالمكرمة: 'مكة المكرمة', مكه: 'مكة المكرمة', مكة: 'مكة المكرمة' };
/**
 * ── وصياغةٌ واحدةٌ لكلّ قيمة ─────────────────────────────────────────────────
 * الشيتُ يكتب «اجازه» و«متوقف» و«دراجه ناريه»، والقوائمُ المُدارةُ في إعدادات
 * القسم تُكتب بالرسم الصحيح. فلو خُزِّن ما في الشيت كما هو صار للحالة الواحدة
 * صياغتان: تُفلتَر الشاشةُ على «إجازة» فتجد صفرًا وفي السجلّ ثلاثة.
 */
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

  // ── ① الموظّفون ───────────────────────────────────────────────────────────
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

  // ── ② المركبات: التفويضُ والقائدُ الفعليّ ─────────────────────────────────
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

  // ── ③ الربطُ بالسجلّات القائمة ────────────────────────────────────────────
  const hrAll = await Employee.find({}).select('nationalId iqamaNumber arabicName firstName lastName employmentStatus phone department').lean();
  const hrById = new Map();
  for (const e of hrAll) {
    for (const k of [e.nationalId, e.iqamaNumber]) { const s = S(k); if (s) hrById.set(s, e); }
  }
  /** المشرفُ يُكتب مختصرًا، فيُطابَق بتضمين كلّ كلماته في الاسم الكامل. */
  const findByWords = (full) => {
    const words = S(full).split(' ').map(fold).filter(Boolean);
    if (!words.length) return null;
    const hits = hrAll.filter((e) => {
      const n = fold(e.arabicName) || fold(`${e.firstName || ''} ${e.lastName || ''}`);
      return words.every((w) => n.includes(w));
    });
    return hits.length === 1 ? hits[0] : null;   // الغامضُ لا يُربَط
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

    // المركبةُ: من لوحة شيت الموظّفين، وإلّا من شيت المركبات بهويّة القائد.
    let plate = s.vehiclePlate;
    if (!plate) { const byDrv = vehByDriverId.get(s.idNumber); if (byDrv) plate = byDrv.plate; }
    const vm = plate ? vmByPlate.get(plateKey(plate)) : null;
    if (plate && vm) report.vehicleLinked += 1;
    else if (plate) report.vehicleMissing.push(`${s.name} → ${plate}`);

    // المشروعُ والمدينةُ: شيتُ الموظّفين أوّلًا، وشيتُ المركبات يكمل الناقص.
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
     * ── حالةُ العمل: الموارد البشريّة تغلب حين تقول «لا» ────────────────────
     * خانةُ الشيت تخلط أمرين: حالةَ التوظيف (يعمل / إنهاء خدمة) وحالةَ اليوم
     * (إجازة). والموارد البشريّةُ تسجّل الإجازةَ في سجلّ طلباتها لا في حالة
     * الملفّ، فملفٌّ حالتُه `active` لا يعني أنّ صاحبَه في العمل اليوم.
     *
     * فلو أُخذت الموارد البشريّةُ مرجعًا في كلّ حال لمُحيت معلومةٌ صحيحة: ثلاثةٌ
     * كتب القسمُ أنّهم في إجازةٍ وواحدٌ متوقّف، وملفّاتُهم `active` — فتصير
     * حالتُهم «يعمل» وهم ليسوا في العمل.
     *
     * والذي طُلب هو ألّا يبقى منتهي الخدمة معروضًا عاملًا. فالموارد البشريّةُ
     * تغلب حين تنفي (إنهاء خدمة أو إيقاف) — وهو خبرٌ أقوى من أيّ خانة — وتُترك
     * حالةُ القسم فيما سوى ذلك.
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
   * ── ⑤ قادةٌ في شيت المركبات وليسوا في شيت الموظّفين ──────────────────────
   * الشيتان لا يتطابقان: سبعةُ سائقين يقودون مركباتِنا اليوم — أسماؤهم
   * وهويّاتُهم مكتوبةٌ في شيت المركبات — ولا صفَّ لهم في شيت الموظّفين. وقراءةُ
   * الأوّلِ وحدَه تُسقطهم، فتُبحَث لوحاتُهم في القسم فلا تُوجَد، والمركبةُ عندنا
   * ورجلٌ يقودها.
   *
   * وهم في الموارد البشريّة كلُّهم (أقسامُهم B2C)، فليسوا غرباء: هم نقصٌ في
   * الشيت لا في الشركة. فيُقرأ الشيتان معًا، ويُبنى صفُّ مَن سقط ممّا في شيت
   * المركبات — واسمُه وقسمُه ومركبتُه كلُّها فيه.
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
      // مَن يقود دراجةً في مشروع توصيل مندوب. والوظيفةُ تُقرأ من الموارد
      // البشريّة متى وُجدت، فلا تُخمَّن وهي مكتوبة.
      jobTitleAr: hr && S(hr.jobTitle).includes('سائق') ? 'مندوب' : (S(hr?.jobTitle) || 'مندوب'),
      cityAr: v.cityAr,
      projectAr: v.projectAr,
      vehiclePlate: v.plate,
      // لا يُخمَّن ما ليس في الشيت: نوعُ التعاقد وحالةُ العمل والسجلُّ تُترك
      // فارغةً ليملأها القسم — وقيمةٌ مخترعةٌ تُقرأ حقيقةً ولا يُعلَم أنّها ظنّ.
      contractTypeAr: '',
      registerNumber: '',
      workStatusAr: '',
      nationalityAr: '',
      supervisorName: '',
      hireDate: null,
      notesAr: 'أُضيف من شيت المركبات — قائدٌ فعليٌّ لا صفَّ له في شيت الموظفين',
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

  // ── ④ التقرير ─────────────────────────────────────────────────────────────
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

  // ── ⑤ الكتابة — تُعاد بلا ضرر: المفتاحُ الهويّة ───────────────────────────
  let created = 0; let updated = 0;
  for (const d of docs) {
    const existing = await LightTransportEmployee.findOne({ idNumber: d.idNumber });
    if (!existing) {
      const doc = new LightTransportEmployee({
        ...d,
        history: [{ kind: 'created', byName: 'استيراد شيت القسم', note: 'أُنشئ من شيت مشروع B2C' }],
      });
      await doc.save();
      created += 1;
    } else {
      // لا يُطمَس ما كُتب في النظام بعد الاستيراد — تُملأ الخاناتُ الفارغةُ فقط.
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

  // ── ⑥ سكنان مبدئيّان بالسعتين المطلوبتين ─────────────────────────────────
  for (const h of [{ name: 'سكن ١', declaredCapacity: 110 }, { name: 'سكن ٢', declaredCapacity: 70 }]) {
    const found = await LightTransportHousing.findOne({ name: h.name });
    if (!found) { await LightTransportHousing.create(h); console.log(`أُنشئ ${h.name} بسعة ${h.declaredCapacity}`); }
  }

  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
