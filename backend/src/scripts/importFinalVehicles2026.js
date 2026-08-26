/* eslint-disable no-console */
/**
 * importFinalVehicles2026 — الماستر النهائي لقسم المركبات (أغسطس ٢٠٢٦).
 *
 *   node src/scripts/importFinalVehicles2026.js --dry                  خطّة بلا كتابة
 *   node src/scripts/importFinalVehicles2026.js --yes                  تنفيذ
 *   node src/scripts/importFinalVehicles2026.js --yes --replace        + إخراج ما ليس في الملف
 *   node src/scripts/importFinalVehicles2026.js --yes --replace --hard + محوُه نهائيًّا
 *
 * المصدر: seeds/data/vehicles-2026-08/final-vehicles.xlsx — ثلاث صفحات:
 * «Vehicles» (٣٣٥ مركبة، العناوين في الصف الثاني)، «وثائق عامة» (٣ وثائق على
 * مستوى الشركة)، «Accidents» (٢٥ واقعة ومطالباتها).
 *
 * ── وهذا الملف يُحلّ محلّ ما قبله ───────────────────────────────────────────
 * القسم أعلنه مصدرَ الحقيقة، فما في قاعدة البيانات وليس فيه ليس مركبةً منسيّة
 * بل مركبةٌ خرجت. لكنّ الخروج لا يقع في صمت أبدًا: يُطبَع في التجربة لوحةً
 * لوحة، ولا يُنفَّذ إلا بـ`--replace` صراحةً. و`--replace` وحده **يُعطِّل**
 * (isActive:false) فيختفي من كل شاشات القسم ويبقى سجلّ تجديداته وحوادثه
 * قابلًا للرجوع؛ و`--hard` معه هو الذي يمحو المستند. حذفُ مركبةٍ يمحو تاريخَ
 * تجديداتها معها، وذلك ما لا يُسترجَع بإعادة تشغيل الاستيراد.
 *
 * ── ما يُخزَّن وما لا يُخزَّن ───────────────────────────────────────────────
 * أعمدة «الايام المتبقية علي …» السبعة لا تُخزَّن. هي فرقٌ بين تاريخ الانتهاء
 * ويوم كتابة الملف، ويُحسَب لحظةَ العرض (config/vehicleDocuments.js). تخزينُه
 * يعني أن تقول الشاشة «باقٍ ١٣٣ يومًا» بعد أربعة أشهر — وهي حينها منتهية.
 *
 * ولها فائدةٌ أخرى: طرحُ «المتبقّي» من تاريخ الانتهاء يعطي **يوم كتابة الملف**
 * بالضبط. ١٥٧٤ زوجًا في هذا الملف تتّفق كلها على ٢٦ أغسطس ٢٠٢٦ بلا شذوذ، وهو
 * التاريخ الذي يُقاس عليه «هل جدَّد موظفٌ هذا المستند بعد لقطة الملف؟».
 *
 * ── والعمود الهجريّ ليس هجريًّا ────────────────────────────────────────────
 * «تاريخ انتهاء رخصة السير هجري» يساوي الميلاديَّ حرفًا بحرف في ٣١٣ صفًّا من
 * ٣١٤، و«تاريخ انتهاء الفحص هجري» في ٢٨٠ من ٢٨٠ — أي أنه معادلةٌ تعكس الخانة
 * المجاورة لا تاريخٌ هجريّ. فلا يُخزَّن إلا حين يختلف فعلًا (صفٌّ واحد)، ويُطبَع
 * حينها. تخزينُه كما هو كان يملأ الشاشة بتواريخ هجرية كاذبة.
 *
 * ── والملف لا يدوس على شغل بني آدم ─────────────────────────────────────────
 * (نفس قاعدة a348299b في قسم LS2.) الشيت لقطةٌ من ورق، ومن فتح الشاشة كان
 * ينظر إلى المركبة. فقاعدتان:
 *   ① تاريخٌ جدَّده موظف بعد لقطة الملف يبقى، ويُطبَع ما تُرك ومَن جدَّده.
 *   ② مركبةٌ `updatedAt` فيها أحدثُ من `lastImportAt` لمسها إنسان: حينئذٍ لا
 *      تمحو خانةٌ فارغة في الشيت قيمةً موجودة عندنا. الشيت يزيد ولا ينقص.
 * وما لا يحمله الشيت أصلًا (نواقص منصّة لوجستي، حالة الفحص النصّية، معرّف جهاز
 * التتبّع، شريحة الاتصال، المسمّى الوظيفي للمفوَّض) لا يُكتب أبدًا فلا يُمسّ.
 *
 * ── وسبب غياب القيمة قيمةٌ بذاته ───────────────────────────────────────────
 * الماستر يكتب السبب **مكان القيمة**: «مطلوب» في خانة رقم التفويض، «غير مطلوب»
 * في خانة شركة التأمين، «ملكية بنك الراجحي» في خانة قيمة التأمين. نقلُها كما
 * هي يجعل «مطلوب» تظهر شركةَ تأمينٍ لها عشراتُ المركبات. فتُفرَّغ الخانة ويبقى
 * السبب رمزًا في `statusCode` وبندًا في `missingItems` — و«غير مطلوب» لا يُعدّ
 * نقصًا، لأنها حالةٌ سليمة لا عملٌ مطلوب.
 *
 * الاستيراد فعّالٌ متكرّر (idempotent): إعادةُ تشغيله لا تغيّر شيئًا.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const ARGV = process.argv.slice(2);
const DRY = ARGV.includes('--dry') || !ARGV.includes('--yes');
const REPLACE = ARGV.includes('--replace');
const HARD = ARGV.includes('--hard');
const FILE = path.join(__dirname, '..', 'seeds', 'data', 'vehicles-2026-08', 'final-vehicles.xlsx');

// ── قراءة الخانات ────────────────────────────────────────────────────────────
const S = (v) => (v === null || v === undefined ? '' : String(v).trim().replace(/\s+/g, ' '));
const AR_DIGITS = (t) => String(t).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

/** رقمٌ حقيقي أو null. النصّ الذي لا يقرأ رقمًا ليس صفرًا — هو لا رقم. */
const N = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = AR_DIGITS(String(v)).replace(/[,\s٬]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

// ── الأرقام التسلسلية للتواريخ ───────────────────────────────────────────────
// إكسل يكتب التاريخ عددًا: ٤٦٢٦٠ = ٢٦ أغسطس ٢٠٢٦. مبدؤه ٣٠ ديسمبر ١٨٩٩ لا
// ١ يناير ١٩٠٠ — بسبب سنةٍ كبيسةٍ وهميّة في ١٩٠٠ ورثها عن لوتس ١-٢-٣. الطرحُ
// من المبدأ الخاطئ يزيح كل تاريخٍ في الملف يومًا كاملًا.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86400000;
// حدٌّ للعقل: ٢٠٠٠٠ ≈ ١٩٥٤ و٧٥٠٠٠ ≈ ٢١٠٥. رقمُ إقامةٍ أو رقمُ لوحةٍ سقط في خانة
// تاريخٍ يخرج عن هذا المدى، وقبولُه يصنع تاريخًا في القرن الخامس والعشرين.
const serialToDate = (n) => {
  if (!Number.isFinite(n) || n < 20000 || n > 75000) return null;
  const d = new Date(EXCEL_EPOCH + Math.round(n) * DAY);
  return Number.isNaN(d.getTime()) ? null : d;
};
const D = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const n = N(v);
  if (n !== null) return serialToDate(n);
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

const get = (o, p) => p.split('.').reduce((c, k) => (c == null ? c : c[k]), o);
const filled = (v) => !(v === '' || v === null || v === undefined);

(async () => {
  if (!fs.existsSync(FILE)) { console.error(`الملف غير موجود: ${FILE}`); process.exit(1); }

  const VDOC = require('../config/vehicleDocuments');
  // مفتاح **سجل المركبات** (حروف + أرقام) لا مفتاح الأرقام وحدها. الأرقام
  // تتصادم هنا: «ل أ 1080» دراجة و«أ ص ر 1080» تريلا — أحد عشر تصادمًا في هذا
  // الملف بالضبط، وصفرٌ بهذا المفتاح. التفصيل في utils/plateKey.js.
  const { registryPlateKey: plateKey } = require('../utils/plateKey');

  const wb = XLSX.readFile(FILE);
  const sheet = (name) => {
    const ws = wb.Sheets[name];
    if (!ws) { console.error(`الصفحة «${name}» غير موجودة في الملف`); process.exit(1); }
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  };
  const VEH = sheet('Vehicles');
  const GEN = sheet('وثائق عامة');
  const ACC = sheet('Accidents');

  // عناوين صفحة المركبات في الصف الثاني — الصف الأول عدّادات كتبها الملف لنفسه.
  const HEAD = (VEH[1] || []).map((h) => S(h));
  const C = {}; HEAD.forEach((h, i) => { if (h && C[h] === undefined) C[h] = i; });
  const need = ['رقم اللوحة', 'رقم الهيكل', 'تاريخ انتهاء التأمين'];
  const absent = need.filter((h) => C[h] === undefined);
  if (absent.length) { console.error(`أعمدة مفقودة في صفحة Vehicles: ${absent.join(' · ')}`); process.exit(1); }
  const col = (row, name) => (C[name] === undefined ? null : row[C[name]]);

  // ── يوم كتابة الملف، مأخوذًا من الملف نفسه ─────────────────────────────────
  // كل زوج (تاريخ انتهاء، أيام متبقية) يعطي التاريخ بالطرح. الإجماع هو الجواب،
  // وأيّ خلافٍ يُطبَع: ملفٌ لم تُحدَّث معادلاته يكذب على قاعدة «ما جدَّده موظف».
  const PAIRS = [
    ['تاريخ نهاية التفويض', 'الايام المتبقية علي نهاية التفويض'],
    ['تاريخ انتهاء التأمين', 'الايام المتبقية علي انتهاء التأمين'],
    ['تاريخ انتهاء ال GPS', 'الايام المتبقية علي انتهاء ال GPS'],
    ['تاريخ انتهاء بطاقة التشغيل', 'الايام المتبقية علي انتهاء بطاقة التشغيل'],
    ['تاريخ انتهاء رخصة السير ميلادي', 'الايام المتبقية علي انتهاء رخصة السير'],
    ['تاريخ انتهاء الفحص ميلادي', 'الايام المتبقية علي انتهاء الفحص'],
  ];
  const votes = new Map();
  for (const row of VEH.slice(2)) {
    if (!row) continue;
    for (const [dh, nh] of PAIRS) {
      const d = N(col(row, dh)); const k = N(col(row, nh));
      if (d === null || k === null || d < 20000) continue;
      votes.set(d - k, (votes.get(d - k) || 0) + 1);
    }
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const SNAPSHOT = (ranked.length && serialToDate(ranked[0][0])) || new Date(fs.statSync(FILE).mtime);
  const agree = ranked.length ? ranked[0][1] : 0;
  const disagree = ranked.slice(1).reduce((t, [, c]) => t + c, 0);

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const { VehicleMaster, CorporatePolicy, VehicleInsurancePolicy } = require('../models/VehicleMaster');
  const VehicleClaim = require('../models/VehicleClaim');

  console.log(`المصدر: ${path.basename(FILE)}`);
  console.log(`لقطة الملف: ${iso(SNAPSHOT)}  (${agree} زوجًا متّفقًا${disagree ? ` · ${disagree} مخالفًا` : ''})`);
  console.log(DRY ? '\n═══ تجربة — لن يُكتب شيء ═══\n' : `\n═══ تنفيذ${REPLACE ? (HARD ? ' + محو ما ليس في الملف' : ' + تعطيل ما ليس في الملف') : ''} ═══\n`);

  const sum = {
    vehiclesCreated: 0, vehiclesUpdated: 0, vehiclesUnchanged: 0,
    keptUserRenewals: 0, keptUserFields: 0,
    policiesCreated: 0, policiesUpdated: 0, linkedToPolicy: 0,
    corporateCreated: 0, corporateUpdated: 0,
    claimsCreated: 0, claimsUpdated: 0,
    missingItems: 0, hijriKept: 0,
    staleVehicles: 0, stalePolicies: 0, staleClaims: 0, staleCorporate: 0, removed: 0,
  };
  const skipped = [];   // صفوف لم تُقرأ، ولماذا
  const kept = [];      // ما تُرك لأن إنسانًا كتبه
  const notes = [];

  // نصّ الخانة: قيمةٌ حقيقية أم سببُ غياب؟ الاثنان لا يجتمعان في خانة واحدة.
  const cell = (row, name) => {
    const raw = col(row, name);
    const code = VDOC.mapSentinelAr(raw);
    return { raw, code, value: code ? '' : S(raw) };
  };
  // خانة تاريخ: التاريخ إن كان، وإلا سببُ غيابه.
  const dcell = (row, name) => {
    const raw = col(row, name);
    const code = VDOC.mapSentinelAr(raw);
    return { date: code ? null : D(raw), code };
  };
  // خانة رقم: الرقم إن كان، وإلا سببُ غيابه — و«النصّ الحرّ» ليس سببًا معروفًا.
  const ncell = (row, name) => {
    const raw = col(row, name);
    const code = VDOC.mapSentinelAr(raw);
    if (code) return { num: null, code, text: '' };
    const n = N(raw);
    return { num: n, code: '', text: n === null ? S(raw) : '' };
  };

  // ════════════════════════════════════════════════════════════════════════
  //  ① قراءة صفحة المركبات
  // ════════════════════════════════════════════════════════════════════════
  const parsed = [];
  const seenKeys = new Map();
  VEH.slice(2).forEach((row, i) => {
    const sheetRow = i + 3;                     // رقم الصفّ كما يراه من يفتح إكسل
    if (!row || !row.some((c) => c !== null && c !== '')) return;   // صفٌّ فارغ تمامًا
    const plate = S(col(row, 'رقم اللوحة'));
    if (!plate) {
      // صفٌّ فيه أثرُ كتابةٍ بلا لوحة — لا مركبةَ فيه ولا مفتاح. يُعلَن ولا يُخترع له مفتاح.
      const junk = row.map((c) => S(c)).filter(Boolean).join(' | ').slice(0, 60);
      skipped.push(`صف ${sheetRow}: بلا رقم لوحة${junk ? ` (${junk})` : ''} — لا مفتاح للمركبة`);
      return;
    }
    const key = plateKey(plate);
    if (!key) { skipped.push(`صف ${sheetRow}: اللوحة «${plate}» لا تُنتِج مفتاحًا`); return; }
    if (seenKeys.has(key)) {
      skipped.push(`صف ${sheetRow}: اللوحة «${plate}» تكرّرت (الصف ${seenKeys.get(key)}) — الأولى هي المعتمدة`);
      return;
    }
    seenKeys.set(key, sheetRow);

    const ins = dcell(row, 'تاريخ انتهاء التأمين');
    const gpsX = dcell(row, 'تاريخ انتهاء ال GPS');
    const opX = dcell(row, 'تاريخ انتهاء بطاقة التشغيل');
    const licX = dcell(row, 'تاريخ انتهاء رخصة السير ميلادي');
    const insX = dcell(row, 'تاريخ انتهاء الفحص ميلادي');
    const authX = dcell(row, 'تاريخ نهاية التفويض');
    const authS = dcell(row, 'تاريخ بداية التفويض');

    // الهجريّ لا يُخزَّن إلا حين يختلف عن الميلاديّ فعلًا — وإلا فهو انعكاسُه.
    const hijri = (gregName, hijriName) => {
      const g = N(col(row, gregName)); const h = N(col(row, hijriName));
      if (g === null || h === null || g === h) return '';
      sum.hijriKept++;
      notes.push(`${plate}: «${hijriName}» يخالف الميلاديّ (${iso(serialToDate(h))} مقابل ${iso(serialToDate(g))}) — حُفِظ كما هو`);
      return iso(serialToDate(h));
    };

    const consType = cell(row, 'نوع الاستهلاك');
    const consLimit = ncell(row, 'حد الاستهلاك');
    const fuelStatus = cell(row, 'حالة الشريحة');
    const premium = ncell(row, 'قيمة التأمين');
    const open = /^opened?$/i.test(S(consType.raw)) || /^opened?$/i.test(S(consLimit.text));

    // ── سببُ الغياب يصير بندَ عمل ────────────────────────────────────────────
    // «غير مطلوب» ليست نقصًا — هي حالةٌ سليمة تُعَدّ وحدها (isGap تستثنيها).
    const missingItems = [];
    const gap = (item, docKey, code) => {
      if (VDOC.isGap(code)) { missingItems.push({ item, docKey, reason: code }); sum.missingItems++; }
    };
    gap('التأمين', 'insurance', ins.code);
    gap('بطاقة التشغيل', 'operatingCard', opX.code);
    gap('رخصة السير', 'vehicleLicense', licX.code);
    gap('الفحص الدوري', 'inspection', insX.code);
    gap('اشتراك GPS', 'gps', gpsX.code);
    gap('التفويض', 'authorization', authX.code);
    gap('شريحة الوقود', 'fuelCard', VDOC.mapSentinelAr(col(row, 'شريحة بترو اب')));
    gap('السجل التجاري', '', VDOC.mapSentinelAr(col(row, 'السجل')));

    // ── هل تعمل؟ ─────────────────────────────────────────────────────────────
    // «مسروق» تُكتب في خانة القطاع، و«غير مستخدم» في خانة الإدارة أو المدينة.
    // كلاهما حالةُ تشغيلٍ لا اسمُ قطاعٍ ولا اسمُ إدارة، فتُقرأ من موضعها وتُخزَّن
    // في حقلها — وإلا ضاع الرقم الذي تسأل عنه الإدارة أولَ ما تسأل.
    const sectorRaw = S(col(row, 'القطاع'));
    const idle = [cell(row, 'القسم').code, cell(row, 'المدينة').code].includes('not_in_use');
    const service = sectorRaw === 'مسروق'
      ? { ar: 'مسروقة', code: 'stolen' }
      : idle ? { ar: 'غير مستخدمة', code: 'idle' }
        : { ar: 'في الخدمة', code: 'in_service' };

    const tam = cell(row, 'حالة تم');
    const TAM_CODE = { 'مالك': 'owner', 'مستخدم': 'user' };
    const FUEL_CODE = { 'نشط': 'active', 'غير نشط': 'inactive' };
    const CONS_CODE = { 'monthly': 'monthly', 'opened': 'open' };

    parsed.push({
      sheetRow, plate, key,
      chassis: cell(row, 'رقم الهيكل').value,
      dates: {
        'insurance.expiryDate': { d: ins.date, doc: 'insurance' },
        'gps.expiryDate': { d: gpsX.date, doc: 'gps' },
        'operatingCard.expiryDate': { d: opX.date, doc: 'operatingCard' },
        'vehicleLicense.expiryDate': { d: licX.date, doc: 'vehicleLicense' },
        'inspection.expiryDate': { d: insX.date, doc: 'inspection' },
        'authorizedPerson.expiryDate': { d: authX.date, doc: 'authorization' },
        // بداية التفويض ليست مستندًا يُجدَّد — لا يُقاس عليها سجلّ تجديد.
        'authorizedPerson.startDate': { d: authS.date, doc: null },
      },
      fields: {
        source_row: sheetRow,
        plateNumber: plate,
        plateKey: key,
        chassisNumber: cell(row, 'رقم الهيكل').value,
        serialNumber: cell(row, 'الرقم التسلسلي').value,

        sectorAr: cell(row, 'القطاع').value,
        departmentAr: cell(row, 'القسم').value,
        cityAr: cell(row, 'المدينة').value,
        registrationTypeAr: cell(row, 'نوع التسجيل').value,
        brandAr: cell(row, 'ماركة المركبة').value,
        modelAr: cell(row, 'طراز المركبة').value,
        modelYear: N(col(row, 'الموديل')),
        colorAr: cell(row, 'اللون').value,

        serviceStatusAr: service.ar,
        serviceStatusCode: service.code,

        ownerNameAr: cell(row, 'المالك').value,
        commercialRegistration: cell(row, 'السجل').value,
        // ── «حالة تم» و«حالة الحيازة» عمودٌ واحد لا عمودان ──────────────────
        // الملف يكتبه مرةً واحدة (مالك / مستخدم)، والقسم بناه في حقلين قبل هذا
        // الملف: `tamStatusAr` تقرؤه صفحة المركبة، و`possessionStatusAr` يقرؤه
        // فلترُ الحيازة وبطاقتُه في النظرة الشاملة. ملءُ أحدهما وحده يُفرِغ
        // شاشةً كاملة، فيُكتب في كليهما من العمود نفسه.
        tamStatusAr: tam.value,
        tamStatusCode: TAM_CODE[tam.value] || (tam.code === 'not_required' ? 'none' : ''),
        possessionStatusAr: tam.value,

        'authorizedPerson.name': cell(row, 'اسم المفوض').value,
        'authorizedPerson.iqamaNumber': cell(row, 'رقم الاقامة').value,
        'authorizedPerson.authorizationNumber': cell(row, 'رقم التفويض').value,
        'authorizedPerson.statusCode': authX.code,

        'insurance.policyNumber': cell(row, 'رقم وثيقة التأمين').value,
        'insurance.companyAr': cell(row, 'شركة التأمين').value,
        'insurance.coverageTypeAr': cell(row, 'نوع التأمين').value,
        'insurance.premiumSar': premium.num,
        // ── ولماذا نصُّ «ملكية بنك الراجحي» ولا نصُّ «مطلوب» ───────────────────
        // الأولى تقول إن القسط قائمٌ ويدفعه المموِّل — فالمركبة مؤمَّنة ورقمُها
        // ليس عندنا. والثانية تقول إنه ناقص، وهذا بندُ عملٍ مكانُه missingItems
        // لا خانةُ القيمة. خلطُهما يجعل مركبةً مؤمَّنةً تُقرأ «ينقصها تأمين».
        'insurance.premiumStatusAr': ['with_bank', 'with_aljabr'].includes(premium.code)
          ? S(col(row, 'قيمة التأمين')) : premium.text,
        'insurance.statusCode': ins.code,

        'fuelCard.provider': 'بترو اب',
        'fuelCard.cardNumber': cell(row, 'شريحة بترو اب').value,
        'fuelCard.plateOnInvoiceAr': cell(row, 'رقم اللوحة في فاتورة بترو اب').value,
        // عمودُ حالةٍ: «غير مطلوب» فيه حالةٌ حقيقية لا سببُ فراغ، فتبقى نصًّا.
        'fuelCard.statusAr': S(fuelStatus.raw),
        'fuelCard.statusCode': FUEL_CODE[S(fuelStatus.raw)] || fuelStatus.code,
        'fuelCard.consumptionTypeAr': consType.value,
        'fuelCard.consumptionTypeCode': CONS_CODE[S(consType.value).toLowerCase()] || '',
        'fuelCard.limitSar': consLimit.num,
        'fuelCard.limitStatus': open ? 'open' : '',

        'gps.deviceModel': cell(row, 'جهاز GPS').value,
        'gps.deviceStatusAr': S(col(row, 'حالة جهاز GPS')),
        'gps.provider': cell(row, 'شركة ال GPS').value,
        'gps.serialImei': cell(row, 'سريال GPS').value,
        'gps.statusCode': gpsX.code,

        'operatingCard.cardNumber': cell(row, 'بطاقة التشغيل').value,
        'operatingCard.statusCode': opX.code,

        'vehicleLicense.expiryDateHijri': hijri('تاريخ انتهاء رخصة السير ميلادي', 'تاريخ انتهاء رخصة السير هجري'),
        'vehicleLicense.statusCode': licX.code,

        'inspection.expiryDateHijri': hijri('تاريخ انتهاء الفحص ميلادي', 'تاريخ انتهاء الفحص هجري'),
        'inspection.statusCode': insX.code,

        notesAr: cell(row, 'الملاحظات').value,
        missingItems,
        isActive: true,
        sourceFile: path.basename(FILE),
      },
    });
  });

  console.log(`صفحة Vehicles: ${parsed.length} مركبة مقروءة`
    + `${skipped.length ? ` · ${skipped.length} صفًّا لم يُقرأ` : ''}`);

  // ════════════════════════════════════════════════════════════════════════
  //  ② وثائق التأمين — الوثيقة كيانٌ واحد تشير إليه مئاتُ المركبات
  // ════════════════════════════════════════════════════════════════════════
  // لا صفحةَ وثائق في هذا الملف، فتُستخرج الوثيقة من مركباتها: رقمُها وشركتُها
  // ونوعُها وتاريخُ انتهائها وعددُ من تغطّيهم. وحين تختلف مركبتان في تاريخ
  // وثيقةٍ واحدة يُؤخَذ الأكثر شيوعًا ويُعلَن الخلاف — الوثيقة الواحدة لا
  // تنتهي مرتين، والاختلافُ خطأُ إدخالٍ يجب أن يراه أحد.
  const byPolicy = new Map();
  for (const v of parsed) {
    const num = v.fields['insurance.policyNumber'];
    if (!num) continue;
    if (!byPolicy.has(num)) byPolicy.set(num, { num, vehicles: [], expiries: new Map(), companies: new Map(), types: new Map(), premium: 0 });
    const p = byPolicy.get(num);
    p.vehicles.push(v.plate);
    const e = v.dates['insurance.expiryDate'].d;
    if (e) p.expiries.set(+e, (p.expiries.get(+e) || 0) + 1);
    const c = v.fields['insurance.companyAr']; if (c) p.companies.set(c, (p.companies.get(c) || 0) + 1);
    const t = v.fields['insurance.coverageTypeAr']; if (t) p.types.set(t, (p.types.get(t) || 0) + 1);
    p.premium += Number(v.fields['insurance.premiumSar']) || 0;
  }
  const top = (m) => (m.size ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : null);
  const policyByNumber = new Map();
  for (const p of byPolicy.values()) {
    if (p.expiries.size > 1) {
      notes.push(`وثيقة ${p.num}: ${p.expiries.size} تواريخ انتهاء مختلفة على ${p.vehicles.length} مركبة — أُخذ الأكثر شيوعًا`);
    }
    const doc = {
      policyNumber: p.num,
      companyAr: top(p.companies) || '',
      coverageTypeAr: top(p.types) || '',
      expiryDate: top(p.expiries) ? new Date(top(p.expiries)) : null,
      totalPremiumSar: Math.round(p.premium) || null,
      vehicleCount: p.vehicles.length,
      isActive: true,
    };
    const found = await VehicleInsurancePolicy.findOne({ policyNumber: p.num });
    if (DRY) {
      // في التجربة تُبنى الخريطة بمعرّفٍ وهميّ، وإلا بدت كلُّ مركبةٍ بلا وثيقة
      // وكان تقرير الربط كاذبًا.
      policyByNumber.set(p.num, found ? found._id : 'dry');
      found ? sum.policiesUpdated++ : sum.policiesCreated++;
      continue;
    }
    if (found) {
      // تاريخٌ جدَّده موظف على الوثيقة بعد لقطة الملف لا يُداس عليه — تجديدُ
      // الوثيقة يمسّ مئات المركبات دفعةً واحدة، فدَوسُه أغلى من دَوس مركبة.
      const renewal = (found.renewals || [])
        .filter((r) => r.at && new Date(r.at) > SNAPSHOT)
        .sort((a, b) => new Date(b.at) - new Date(a.at))[0];
      const { expiryDate, ...rest } = doc;
      found.set(rest);
      if (renewal) {
        kept.push(`وثيقة ${p.num}: الملف ${iso(expiryDate)} · جدَّدها ${renewal.byName || 'موظف'} إلى ${iso(renewal.newExpiry)}`);
        sum.keptUserRenewals++;
      } else if (expiryDate) found.expiryDate = expiryDate;
      await found.save();
      sum.policiesUpdated++;
      policyByNumber.set(p.num, found._id);
    } else {
      const made = await VehicleInsurancePolicy.create(doc);
      sum.policiesCreated++;
      policyByNumber.set(p.num, made._id);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ③ المركبات
  // ════════════════════════════════════════════════════════════════════════
  const liveIds = [];
  for (const v of parsed) {
    // المطابقة بمفتاح اللوحة أولًا — هو مفتاح القسم. والهيكل احتياطٌ لحالةٍ
    // واحدة: مركبةٌ بُدِّلت لوحتُها. حينها لا تُخلَق مركبةٌ ثانية بل تُحدَّث
    // لوحةُ القائمة، ويُطبَع التبديل لأنه ليس تفصيلًا.
    let existing = await VehicleMaster.findOne({ plateKey: v.key });
    if (!existing && v.chassis) {
      existing = await VehicleMaster.findOne({ chassisNumber: v.chassis });
      if (existing) notes.push(`${v.plate}: نفس الهيكل ${v.chassis} مسجَّل باللوحة «${existing.plateNumber}» — حُدِّثت اللوحة`);
    }

    const polNum = v.fields['insurance.policyNumber'];
    if (polNum && policyByNumber.has(polNum)) { v.fields.insurancePolicy = policyByNumber.get(polNum); sum.linkedToPolicy++; }

    if (!existing) {
      if (!DRY) {
        const made = new VehicleMaster({ ...v.fields, lastImportAt: new Date() });
        for (const [p, { d }] of Object.entries(v.dates)) if (d) made.set(p, d);
        await made.save();
        liveIds.push(String(made._id));
      }
      sum.vehiclesCreated++;
      continue;
    }
    liveIds.push(String(existing._id));

    // هل لمسها إنسان بعد آخر استيراد؟ حينئذٍ خانةُ الشيت الفارغة لا تمحو قيمة.
    const touched = existing.lastImportAt
      ? new Date(existing.updatedAt) > new Date(existing.lastImportAt)
      : false;

    const before = JSON.stringify(existing.toObject());
    for (const [p, val] of Object.entries(v.fields)) {
      if (touched && !filled(val) && filled(get(existing.toObject(), p))) {
        kept.push(`${v.plate} · ${p}: الشيت فارغ · وعندنا «${get(existing.toObject(), p)}»`);
        sum.keptUserFields++;
        continue;
      }
      existing.set(p, val);
    }
    for (const [p, { d, doc }] of Object.entries(v.dates)) {
      const renewal = doc ? (existing.renewals || [])
        .filter((r) => r.document === doc && r.at && new Date(r.at) > SNAPSHOT)
        .sort((a, b) => new Date(b.at) - new Date(a.at))[0] : null;
      if (renewal) {
        kept.push(`${v.plate} · ${doc}: الملف ${iso(d)} · جدَّده ${renewal.byName || 'موظف'} إلى ${iso(renewal.newExpiry)}`);
        sum.keptUserRenewals++;
        continue;
      }
      if (touched && !d && get(existing.toObject(), p)) {
        kept.push(`${v.plate} · ${p}: الشيت بلا تاريخ · وعندنا ${iso(get(existing.toObject(), p))}`);
        sum.keptUserFields++;
        continue;
      }
      existing.set(p, d);
    }
    const changed = JSON.stringify(existing.toObject()) !== before;
    if (changed) sum.vehiclesUpdated++; else sum.vehiclesUnchanged++;
    if (!DRY && changed) { existing.lastImportAt = new Date(); await existing.save(); }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ④ الوثائق العامة (وثائق عامة) — على مستوى الشركة لا المركبة
  // ════════════════════════════════════════════════════════════════════════
  const gHead = (GEN[0] || []).map((h) => S(h));
  const gi = (name) => gHead.indexOf(name);
  const G = {
    doc: gi('الوثيقة'), owner: gi('المالك'), num: gi('رقم الوثيقة'), exp: gi('تاريخ الانتهاء'),
    party: gi('الطرف الاخر'), status: gi('الحالة'), value: gi('القيمة'),
  };
  const genScopes = [];
  for (let i = 1; i < GEN.length; i++) {
    const row = GEN[i];
    if (!row || !row.some((c) => c !== null && c !== '')) continue;
    const scope = S(row[G.doc]);
    if (!scope) { skipped.push(`وثائق عامة صف ${i + 1}: بلا اسم وثيقة`); continue; }
    genScopes.push(scope);
    // «القيمة» رقمٌ أحيانًا ونصٌّ أحيانًا («ايجار شهري»). النصّ ليس صفرًا:
    // وضعُه في خانة المبلغ يجعل عقدًا قائمًا يُقرأ بقيمةِ صفر في تقرير التكلفة.
    const val = row[G.value];
    const num = N(val);
    const doc = {
      scopeAr: scope,
      policyholderAr: S(row[G.owner]),
      policyNumbers: S(row[G.num]) ? [S(row[G.num])] : [],
      companyAr: S(row[G.party]),
      expiryDate: D(row[G.exp]),
      premiumSar: num,
      statusAr: S(row[G.status]),
      notesAr: num === null ? S(val) : '',
      isActive: true,
    };
    const found = await CorporatePolicy.findOne({ scopeAr: scope });
    if (DRY) { found ? sum.corporateUpdated++ : sum.corporateCreated++; continue; }
    if (found) {
      const renewal = (found.renewals || [])
        .filter((r) => r.at && new Date(r.at) > SNAPSHOT)
        .sort((a, b) => new Date(b.at) - new Date(a.at))[0];
      const { expiryDate, ...rest } = doc;
      found.set(rest);
      if (renewal) {
        kept.push(`وثيقة عامة «${scope}»: الملف ${iso(expiryDate)} · جدَّدها ${renewal.byName || 'موظف'} إلى ${iso(renewal.newExpiry)}`);
        sum.keptUserRenewals++;
      } else found.expiryDate = expiryDate;
      await found.save();
      sum.corporateUpdated++;
    } else { await CorporatePolicy.create(doc); sum.corporateCreated++; }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ⑤ الحوادث والمطالبات
  // ════════════════════════════════════════════════════════════════════════
  const aHead = (ACC[0] || []).map((h) => S(h));
  const ai = (name) => aHead.indexOf(name);
  const A = {
    plate: ai('رقم السيارة'), type: ai('النوع'), owner: ai('سجل المالك'),
    party: ai('اسم طرف الحادث'), partyId: ai('رقم الهوية'), fault: ai('نسبة الخطأ'),
    date: ai('تاريخ الحادث'), via: ai('مباشرة الحادث'), num: ai('رقم الحادث'),
    report: ai('رقم التقرير / التقدير'), insurer: ai('الشركة المطالبة'), claimNum: ai('رقم المطالبة'),
    notes: ai('ملاحظات المطالبة'), lastNote: ai('تاريخ اخر ملاحظة'), lastInsurer: ai('تاريخ اخر موقف مع شركة التامين'),
    estimate: ai('قيمة التقدير'), expected: ai('المتوقع تحصيلة'), status: ai('الحالة'),
  };
  // «-» في هذه الصفحة تعني «لا شيء» لا نصًّا. نقلُها كما هي يجعل شركةَ التأمين
  // تُدعى «-» في ثمانية سجلّات ويظهر «-» خيارًا في فلتر شركات التأمين.
  const dash = (v) => { const t = S(v); return (!t || t === '-' || t === '—') ? '' : t; };
  const dashN = (v) => { const t = S(v); if (!t || t === '-' || t === '—') return null; if (/^zero$/i.test(t)) return 0; return N(v); };
  const plateByKey = new Map(parsed.map((v) => [v.key, v]));
  const seenClaims = [];

  for (let i = 1; i < ACC.length; i++) {
    const row = ACC[i];
    if (!row || !row.some((c) => c !== null && c !== '')) continue;
    const sheetRow = i + 1;
    const subject = S(row[A.plate]);
    if (!subject) { skipped.push(`Accidents صف ${sheetRow}: بلا رقم سيارة ولا موضوع`); continue; }
    const key = plateKey(subject);
    const veh = key ? plateByKey.get(key) : null;
    const accDate = D(row[A.date]);
    const accNum = dash(row[A.num]);
    if (!accDate && !accNum) { skipped.push(`Accidents صف ${sheetRow} («${subject}»): بلا تاريخ ولا رقم حادث — لا مفتاح ثابت له`); continue; }

    // ── مفتاحٌ ثابت للحادث، مأخوذٌ من الحادث نفسه ─────────────────────────
    // الملف لا يحمل معرِّفًا. لو اشتُقّ من رقم الصفّ لتغيّر كلُّ المعرّفات بإدراج
    // صفٍّ واحد في المنتصف، فتُخلَق خمسةٌ وعشرون حادثًا جديدًا فوق القديمة.
    // رقمُ الحادث (أو اللوحة + تاريخه) لا يتغيّر بترتيب الصفوف.
    const claimId = accNum ? `FV26-${accNum.replace(/\s+/g, '')}` : `FV26-${key || 'X'}-${iso(accDate)}`;
    const est = dashN(row[A.estimate]);
    const rec = dashN(row[A.expected]);
    const fault = dashN(row[A.fault]);
    const statusRaw = S(row[A.status]);
    const doc = {
      claimId,
      sourceRow: sheetRow,
      // واقعةٌ ليست على مركبة («تلف بضاعة» — مطالبةُ بضاعةٍ لا حادثُ مركبة).
      // بلا هذا الفصل تظهر في عدّاد حوادث الأسطول وتشوّه نسبة الحوادث لكل مركبة.
      isVehicleIncident: !!veh,
      incidentSubjectAr: subject,
      vehiclePlate: veh ? veh.plate : '',
      vehiclePlateKey: veh ? veh.key : '',
      vehicleTypeAr: dash(row[A.type]),
      ownerRegistrationAr: dash(row[A.owner]),
      counterpartyNameAr: dash(row[A.party]).replace(/[\r\n]+/g, ' '),
      counterpartyNationalId: dash(row[A.partyId]),
      // الملف يكتبها كسرًا (٠ · ٠٫٥ · ١)؛ والشاشات تقرأ نسبةً مئوية.
      faultRatio: fault,
      faultPercent: fault === null ? null : Math.round(fault <= 1 ? fault * 100 : fault),
      accidentDate: accDate,
      reportedViaAr: dash(row[A.via]),
      reportedViaCode: /najm/i.test(S(row[A.via])) ? 'najm' : '',
      accidentNumber: accNum,
      reportOrEstimateNumber: dash(row[A.report]),
      claim: {
        insurerAr: dash(row[A.insurer]),
        claimNumber: dash(row[A.claimNum]),
        notesAr: dash(row[A.notes]).replace(/[\r\n]+/g, ' '),
        lastNoteDate: D(row[A.lastNote]),
        lastInsurerUpdateDate: D(row[A.lastInsurer]),
        estimatedAmountSar: est,
        expectedRecoverySar: rec,
        // الفجوة بين المقدَّر والمتوقَّع استردادُه = الخسارة الصافية المتوقَّعة.
        recoveryGapSar: est !== null && rec !== null ? Math.round(est - rec) : null,
      },
      statusAr: statusRaw,
      statusCode: /wait|انتظار|قيد/i.test(statusRaw) ? 'pending' : /قفل|مغلق|closed/i.test(statusRaw) ? 'closed' : '',
      isActive: true,
    };
    if (!veh && key) notes.push(`حادث ${claimId}: «${subject}» لا تطابق أيّ مركبة في الملف`);

    // مطابقةُ الموجود بمفتاحه الطبيعيّ لا بمعرِّفنا وحده: استيرادٌ سابق سجَّله
    // بمعرّفٍ آخر (ACC-001)، ولولا هذه المطابقة لتضاعف الحادث نسخةً ثانية.
    // ── والمطابقةُ تفضّل الحيَّ على المتقاعد ────────────────────────────────
    // في القاعدة تسعةٌ وأربعون حادثًا، خمسةٌ وعشرون منها نشطة وأربعةٌ وعشرون
    // أُحيلت إلى التقاعد في استيرادٍ سابق. والبحثُ بلا تمييزٍ كان يُصيب
    // المتقاعد أوّلًا في أربعةٍ وعشرين صفًّا من خمسةٍ وعشرين: فيُحييه، ويبقى
    // الحيُّ بلا مطابق فيُعَدّ مهجورًا — ومع `--replace` يُحذف. أي أن الاستيراد
    // كان سيقلب الحيّ ميتًا والميت حيًّا في الاتجاهين معًا.
    const live = { isActive: { $ne: false } };
    const pick = async (q) => (await VehicleClaim.findOne({ ...q, ...live }))
      || (await VehicleClaim.findOne(q));
    let found = await pick({ claimId });
    if (!found && accNum) found = await pick({ accidentNumber: accNum });
    // `veh` لا `key`: خانة اللوحة قد تحمل ما ليس لوحةً («تلف بضاعة») فيُشتقّ
    // منها مفتاحٌ نصّيّ يطابق سجلًّا متقاعدًا يحمل المفتاح نفسه — فيُصاب
    // المتقاعد قبل أن يُجرَّب ما تحته. المطابقةُ باللوحة لا تصحّ إلا حين تكون
    // اللوحة لوحةَ مركبةٍ معروفة.
    if (!found && veh && accDate) found = await pick({ vehiclePlateKey: key, accidentDate: accDate });
    // ── مطالبةٌ ليست عن مركبة ───────────────────────────────────────────────
    // «تلف بضاعة» تُكتب في خانة اللوحة، فيُشتقّ منها مفتاحٌ نصّيّ («تلفبضاعه»)
    // بينما السجلّ الموجود يحفظ مفتاحًا فارغًا — فلا يلتقيان أبدًا. تُطابَق
    // بتاريخها ومبلغها، وإلا عُدَّت الموجودة مهجورةً وأُنشئ لها نظيرٌ ثانٍ،
    // فصار في التقارير حادثان حيث وقع واحد.
    if (!found && !veh && accDate) {
      // لا شرطَ على المفتاح: للحادث الواحد هنا نسختان — متقاعدةٌ تحمل مفتاحًا
      // نصّيًّا («تلفبضاعه») وحيّةٌ بلا مفتاح. واشتراطُ أحد الشكلين يستبعد
      // الحيّة فيُصاب المتقاعد. التاريخ والمبلغ يكفيان للتمييز، و`pick` يفضّل
      // الحيّ متى وُجد الاثنان.
      found = await pick({
        accidentDate: accDate,
        'claim.estimatedAmountSar': doc.claim?.estimatedAmountSar,
      });
    }
    seenClaims.push(found ? String(found._id) : claimId);
    if (DRY) { found ? sum.claimsUpdated++ : sum.claimsCreated++; continue; }
    if (found) {
      // معرِّفُ الحادث القديم يبقى — تغييرُه يقطع أيَّ رابطٍ خارجيّ إليه.
      const { claimId: _drop, ...rest } = doc;
      found.set(rest);
      await found.save();
      sum.claimsUpdated++;
    } else { await VehicleClaim.create(doc); sum.claimsCreated++; }
  }

  // عدّاد حوادث المركبة محسوبٌ من مطالباتها الفعّالة، لا مخزَّنًا يدويًّا.
  if (!DRY) {
    await VehicleMaster.updateMany({}, { $set: { accidentCount: 0 } });
    const keys = [...new Set((await VehicleClaim.find({ isActive: true }).select('vehiclePlateKey').lean())
      .map((c) => c.vehiclePlateKey).filter(Boolean))];
    for (const k of keys) {
      const n = await VehicleClaim.countDocuments({ vehiclePlateKey: k, isActive: true });
      await VehicleMaster.updateMany({ plateKey: k }, { $set: { accidentCount: n } });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ⑥ ما في النظام وليس في الملف
  // ════════════════════════════════════════════════════════════════════════
  const sheetKeys = new Set(parsed.map((v) => v.key));
  const staleVehicles = (await VehicleMaster.find({ isActive: { $ne: false } })
    .select('plateNumber plateKey chassisNumber renewals accidentCount').lean())
    .filter((v) => !sheetKeys.has(v.plateKey));
  sum.staleVehicles = staleVehicles.length;

  const sheetPolicies = new Set(byPolicy.keys());
  const stalePolicies = (await VehicleInsurancePolicy.find({ isActive: { $ne: false } }).select('policyNumber').lean())
    .filter((p) => !sheetPolicies.has(p.policyNumber));
  sum.stalePolicies = stalePolicies.length;

  const genSet = new Set(genScopes);
  const staleCorporate = (await CorporatePolicy.find({ isActive: { $ne: false } }).select('scopeAr').lean())
    .filter((c) => !genSet.has(c.scopeAr));
  sum.staleCorporate = staleCorporate.length;

  const seenClaimSet = new Set(seenClaims);
  const staleClaims = (await VehicleClaim.find({ isActive: { $ne: false } }).select('claimId incidentSubjectAr').lean())
    .filter((c) => !seenClaimSet.has(String(c._id)) && !seenClaimSet.has(c.claimId));
  sum.staleClaims = staleClaims.length;

  if (REPLACE && !DRY) {
    const ids = staleVehicles.map((v) => v._id);
    if (HARD) {
      await VehicleMaster.deleteMany({ _id: { $in: ids } });
      await VehicleInsurancePolicy.deleteMany({ _id: { $in: stalePolicies.map((p) => p._id) } });
      await CorporatePolicy.deleteMany({ _id: { $in: staleCorporate.map((c) => c._id) } });
      await VehicleClaim.deleteMany({ _id: { $in: staleClaims.map((c) => c._id) } });
    } else {
      await VehicleMaster.updateMany({ _id: { $in: ids } }, { $set: { isActive: false } });
      await VehicleInsurancePolicy.updateMany({ _id: { $in: stalePolicies.map((p) => p._id) } }, { $set: { isActive: false } });
      await CorporatePolicy.updateMany({ _id: { $in: staleCorporate.map((c) => c._id) } }, { $set: { isActive: false } });
      await VehicleClaim.updateMany({ _id: { $in: staleClaims.map((c) => c._id) } }, { $set: { isActive: false } });
    }
    sum.removed = ids.length + stalePolicies.length + staleCorporate.length + staleClaims.length;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  التقرير
  // ════════════════════════════════════════════════════════════════════════
  console.log('\nالنتيجة:', JSON.stringify(sum, null, 1));

  if (skipped.length) {
    console.log(`\nصفوف لم تُقرأ (${skipped.length}) — ولماذا:`);
    skipped.forEach((s) => console.log('   ' + s));
  }
  if (kept.length) {
    console.log(`\nتُرك كما هو — شغل موظف أحدث من الملف (${kept.length}):`);
    kept.slice(0, 25).forEach((k) => console.log('   ' + k));
    if (kept.length > 25) console.log(`   … و${kept.length - 25} غيرها`);
  }
  if (staleVehicles.length) {
    console.log(`\nفي النظام وليست في الملف — ${staleVehicles.length} مركبة`
      + `${REPLACE ? (HARD ? ' · ستُمحى نهائيًّا' : ' · ستُعطَّل') : ' · لن تُمسّ (أضف --replace)'}:`);
    staleVehicles.slice(0, 40).forEach((v) => console.log(`   ${v.plateNumber || '—'} (${v.plateKey})`
      + `${v.renewals?.length ? ` · ${v.renewals.length} تجديدًا في سجلّها` : ''}`
      + `${v.accidentCount ? ` · ${v.accidentCount} حادثًا` : ''}`));
    if (staleVehicles.length > 40) console.log(`   … و${staleVehicles.length - 40} غيرها`);
  }
  if (stalePolicies.length) console.log(`\nوثائق تأمين ليست في الملف (${stalePolicies.length}): ${stalePolicies.map((p) => p.policyNumber).slice(0, 20).join(' · ')}`);
  if (staleCorporate.length) console.log(`\nوثائق عامة ليست في الملف (${staleCorporate.length}): ${staleCorporate.map((c) => c.scopeAr).join(' · ')}`);
  if (staleClaims.length) console.log(`\nحوادث ليست في الملف (${staleClaims.length}): ${staleClaims.map((c) => c.claimId).slice(0, 20).join(' · ')}`);
  if (notes.length) {
    console.log(`\nملاحظات (${notes.length}):`);
    [...new Set(notes)].slice(0, 25).forEach((n) => console.log('   ' + n));
  }

  if (DRY) {
    console.log('\nلم يُكتب شيء. للتنفيذ:');
    console.log('   node src/scripts/importFinalVehicles2026.js --yes');
    if (staleVehicles.length) console.log('   node src/scripts/importFinalVehicles2026.js --yes --replace   (لإخراج ما ليس في الملف)');
  } else {
    console.log(`\nفي النظام الآن: ${await VehicleMaster.countDocuments({ isActive: { $ne: false } })} مركبة`
      + ` · ${await VehicleInsurancePolicy.countDocuments({ isActive: { $ne: false } })} وثيقة تأمين`
      + ` · ${await VehicleClaim.countDocuments({ isActive: true })} حادثًا`
      + ` · ${await CorporatePolicy.countDocuments({ isActive: true })} وثيقة عامة`);
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
