/**
 * إنشاءُ أوامر التشغيل من واقع الداتا.
 *
 *   node src/scripts/seedLightTransportOrders.js            # تقريرٌ بلا كتابة
 *   node src/scripts/seedLightTransportOrders.js --write    # يكتب
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * الحالةُ القائمةُ اليوم واقعٌ لا يُكتب باليد: مئةٌ وإحدى وخمسون موظّفًا يركبون
 * مركبات، ولكلٍّ مشروعُه وفرعُه ومشرفُه، ولمركبته تفويضٌ بتاريخٍ ورقم. فإنشاءُ
 * هذه الأوامر واحدًا واحدًا من الشاشة مئةٌ وإحدى وخمسون نافذة.
 *
 * فتُقرأ من الشيتين وتُكتب أمرًا ساريًا لكلّ راكب — فيصير للنظام نقطةُ بدايةٍ
 * صحيحةٌ، وكلُّ نقلٍ بعدها يُقيَّد فوقها.
 *
 * ── وما يُحتَرس منه ──────────────────────────────────────────────────────────
 * ① **المفوَّضُ ليس دائمًا القائدَ الفعليّ.** في أربعةَ عشرَ مركبةً الورقةُ باسم
 *    واحدٍ والراكبُ غيرُه، وهي حالةٌ صحيحةٌ لا خطأ. فالأمرُ يُسجَّل **للقائد
 *    الفعليّ** — هو من يعمل عليها — ويُذكَر في الأمر أنّ التفويضَ باسمٍ آخر،
 *    ولا يُنقَل التفويضُ ولا يُستبدَل: الورقةُ لا تُغيَّر من سكربتٍ استيراد.
 * ② **لا يُكتب تفويضٌ في سجلّ المركبات من هنا.** هو مكتوبٌ فيه أصلًا (استُورد
 *    مع المركبات)، وإعادةُ كتابته تفتح بابَ الخلاف بين السجلّين.
 * ③ **مَن أُنهيت خدمتُه لا يُشغَّل.** أمرٌ سارٍ لمن ليس عندنا يعني مركبةً
 *    مسجَّلةً على غائب.
 * ④ **يُعاد تشغيلُه بلا ضرر**: من له أمرٌ سارٍ يُتجاوَز ولا يُنشأ له ثانٍ.
 */
require('dotenv').config({ quiet: true });
const path = require('path');
const mongoose = require('mongoose');
const XLSX = require('xlsx');

const WRITE = process.argv.includes('--write');
const DIR = path.join(__dirname, '..', '..', '..', 'b2c files');
const VEH_FILE = 'المركبات تحديث 27-سبتمبر 2026 (1).xlsx';

const S = (v) => String(v == null ? '' : v).replace(/[ ‎‏]/g, ' ').replace(/\s+/g, ' ').trim();
const fold = (v) => S(v).replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/\s+/g, '').toLowerCase();
const ABSENT = new Set(['لايوجد', 'لايوجد', 'غيرمفوض', 'غيرمستخدم', '-', '—', '']);
const real = (v) => (ABSENT.has(fold(v)) ? '' : S(v));
const serialToDate = (v) => {
  const n = Number(S(v));
  if (!Number.isFinite(n) || n <= 0 || n > 80000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return Number.isNaN(d.getTime()) ? null : d;
};
const plateKey = (p) => {
  if (p == null) return null;
  const w = S(p).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و');
  const digits = (w.match(/\d+/g) || []).join('');
  const letters = (w.match(/[ء-يA-Za-z]/g) || []).map((c) => c.toUpperCase()).sort().join('');
  const k = `${digits}|${letters}`;
  return k === '|' ? null : k;
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const { LightTransportEmployee, LightTransportOrder } = require('../models/LightTransport');
  const { VehicleMaster } = require('../models/VehicleMaster');
  const Employee = require('../models/Employee');

  // ── تفاويضُ الشيت: مفتاحُها اللوحة ────────────────────────────────────────
  const wb = XLSX.readFile(path.join(DIR, VEH_FILE));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, defval: '' });
  const head = rows[1].map(S);
  const ix = {};
  head.forEach((h, i) => { if (h && ix[h] === undefined) ix[h] = i; });
  const authByPlate = new Map();
  for (const r of rows.slice(2)) {
    const plate = S(r[ix['رقم اللوحه']]);
    if (!plate) continue;
    const k = plateKey(plate);
    if (k) {
      authByPlate.set(k, {
        authId: real(r[ix['رقم هوية المفوض']]),
        authName: real(r[ix['اسم المفوض']]),
        authNumber: real(r[ix['رقم التفويض']]),
        authStart: serialToDate(r[ix['بدايه التفويض']]),
        authEnd: serialToDate(r[ix['نهاية التفويض']]),
        driverId: real(r[ix['هوية القائد الفعلي']]),
      });
    }
  }

  const staff = await LightTransportEmployee.find({ isActive: { $ne: false } })
    .populate('employee', 'employmentStatus')
    .populate('vehicle', 'plateNumber registrationTypeAr')
    .lean();

  const existing = new Set((await LightTransportOrder.find({ status: 'active' }).select('ltEmployee').lean())
    .map((o) => String(o.ltEmployee)));

  const report = {
    total: staff.length, noVehicle: 0, terminated: 0, alreadyHasOrder: 0,
    toCreate: 0, authMismatch: [], noAuthPaper: 0, byProject: {},
  };
  const plan = [];

  for (const e of staff) {
    if (existing.has(String(e._id))) { report.alreadyHasOrder += 1; continue; }
    if (e.employee?.employmentStatus === 'terminated') { report.terminated += 1; continue; }
    if (!e.vehicle) { report.noVehicle += 1; continue; }

    const paper = authByPlate.get(plateKey(e.vehicle.plateNumber)) || {};
    // الورقةُ باسم غيره؟ يُذكَر ولا يُغيَّر — راجع الملاحظةَ ① أعلاه.
    const mismatch = !!paper.authId && S(paper.authId) !== S(e.idNumber);
    if (mismatch) report.authMismatch.push(`${e.name} (${e.idNumber}) يقود ${e.vehicle.plateNumber} والتفويضُ باسم ${paper.authName || paper.authId}`);
    if (!paper.authNumber) report.noAuthPaper += 1;

    report.byProject[e.projectAr || '—'] = (report.byProject[e.projectAr || '—'] || 0) + 1;
    report.toCreate += 1;
    plan.push({ e, paper, mismatch });
  }

  console.log('── أوامرُ التشغيل من واقع الداتا ─────────────────────────────');
  console.log('  موظّفون في السجلّ        :', report.total);
  console.log('  لهم أمرٌ سارٍ بالفعل      :', report.alreadyHasOrder, '(يُتجاوَزون)');
  console.log('  بلا مركبة               :', report.noVehicle, '(لا أمرَ لهم)');
  console.log('  أُنهيت خدمتُهم           :', report.terminated, '(لا يُشغَّلون)');
  console.log('  ستُنشأ لهم أوامر         :', report.toCreate);
  console.log('  منها بلا ورقةِ تفويض    :', report.noAuthPaper);
  console.log('  التفويضُ باسمٍ آخر       :', report.authMismatch.length, '(يُذكَر في الأمر ولا يُغيَّر)');
  report.authMismatch.slice(0, 6).forEach((x) => console.log('      ', x));
  console.log('  بالمشروع                :', Object.entries(report.byProject).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' · '));

  if (!WRITE) { console.log('\n(تقريرٌ فقط — أضِف --write للكتابة)'); process.exit(0); }

  const last = await LightTransportOrder.findOne({ orderNumber: /^LT-/ }).sort({ orderNumber: -1 }).select('orderNumber').lean();
  let n = last ? (Number(String(last.orderNumber).replace('LT-', '')) || 0) + 1 : 1;
  let created = 0;

  for (const { e, paper, mismatch } of plan) {
    // بدايةُ الأمر: بدايةُ التفويض إن عُرفت، وإلّا تاريخُ التعيين، وإلّا اليوم.
    const start = paper.authStart || e.hireDate || new Date();
    const order = await LightTransportOrder.create({
      orderNumber: `LT-${String(n).padStart(5, '0')}`,
      ltEmployee: e._id,
      employeeName: e.name,
      employeeIdNumber: e.idNumber,
      vehicle: e.vehicle._id,
      vehiclePlate: e.vehicle.plateNumber,
      vehicleTypeAr: e.vehicle.registrationTypeAr || e.vehicleTypeAr || '',
      projectAr: e.projectAr || '',
      cityAr: e.cityAr || '',
      supervisorName: e.supervisorName || '',
      housing: e.housing || null,
      housingRoom: e.housingRoom || '',
      startDate: start,
      status: 'active',
      // التفويضُ مقروءٌ من الورقة لا منقولٌ بها: `authorizationMoved` تعني
      // «نُقل من النظام»، وهذا لم يُنقل — هو قائمٌ كما هو.
      authorizationMoved: false,
      authorizationNumber: paper.authNumber || '',
      authorizationStart: paper.authStart || null,
      authorizationEnd: paper.authEnd || null,
      notesAr: mismatch
        ? `التفويضُ باسم ${paper.authName || paper.authId} والقائدُ الفعليُّ ${e.name} — من شيت المركبات`
        : 'أُنشئ من واقع الداتا (شيت المركبات)',
      createdByName: 'استيراد شيت القسم',
    });
    n += 1;
    created += 1;
    await LightTransportEmployee.updateOne({ _id: e._id }, {
      $push: {
        history: {
          kind: 'order', byName: 'استيراد شيت القسم', toValue: order.orderNumber,
          note: `الحالةُ القائمةُ عند الاستيراد — المركبة ${e.vehicle.plateNumber}`,
          at: new Date(),
        },
      },
    });
  }
  console.log(`\nأُنشئ ${created} أمرَ تشغيل (LT-00001 … LT-${String(n - 1).padStart(5, '0')})`);
  void Employee;
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
