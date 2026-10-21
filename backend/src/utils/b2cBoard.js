/**
 * b2cBoard — لوحةُ قسم الأفراد (B2C): تعريفاتٌ واحدةٌ تقرؤها اللوحةُ والقائمتان.
 *
 * ── لماذا ملفٌّ واحد ────────────────────────────────────────────────────────
 * طلبُ صاحب الشركة (٢٠٢٦/١٠/٢١): كلُّ رقمٍ في اللوحة يُضغَط فيفتح أصحابَه —
 * الناسَ في «موظفو النقل الخفيف» والمركباتِ في «مركبات النقل الخفيف». فإن حسبت
 * اللوحةُ «مفوَّض» بمعنى وحسبته القائمةُ بمعنى آخر، قال الكارتُ ثلاثين وفتح
 * ثمانيةً وعشرين. فالمعاني هنا مرّةً واحدة: حالةُ العمل، والفئةُ، ونوعُ
 * الارتباط، والسجلّ، وحالةُ التفويض، ومركباتُ القسم — وفلاترُها.
 *
 * ── حالةُ العمل: أربعٌ تُجمَع إلى الإجمالي ──────────────────────────────────
 * يعمل · في إجازة · موقوف · حادث. وهي حالةُ اليوم التشغيليّة لا حالةُ التوظيف:
 *   · الموارد البشريّة وحدَها تكتب التوظيفَ وإنهاءَ الخدمة (قاعدةُ ٢٠٢٦/١٠/١٩) —
 *     فإجازتُها (`on_leave`) وإيقافُها (`suspended`) يغلبان هنا ولا يُعدَّلان من القسم.
 *   · وما سوى ذلك يكتبه القسمُ في سجلّه (`LightTransportEmployee.opStatus`): مندوبٌ
 *     أُوقف عن التوصيل أو وقع له حادثٌ أو أُذن له بإجازةٍ قصيرة — ولا يمسّ ملفَّه
 *     في الموارد البشريّة. ولا يُنسَخ إليها: «موقوف» هناك معناه «في مرحلة نقل
 *     الكفالة»، فنسخُه يقول عن مندوبٍ أوقفه مشرفُه إنّه ينقل كفالتَه.
 *   · ومن انتهت خدمتُه لا يُعَدّ (قاعدةُ «ended staff»).
 *
 * ── التفويضُ يُقرأ من سجلّ المركبات ──────────────────────────────────────────
 * `VehicleMaster.authorizedPerson` هو المرجع. ويُقرأ هنا عبر `authOf` وحدَها كي
 * يُستبدَل مصدرُه في موضعٍ واحدٍ إن توحّدت سجلّاتُ التفويض.
 */
const mongoose = require('mongoose');
const { fold: foldAr } = require('./b2cSupervisors');
const ENG = require('./hrEngagement');

const S = (v) => String(v == null ? '' : v).trim();
/** قيمُ الفلتر مفصولةً بفاصلة — كفلاتر الموارد البشريّة السريعة. */
const vals = (v) => S(v).split(',').map((x) => x.trim()).filter(Boolean);

// ── حالةُ العمل ─────────────────────────────────────────────────────────────
const ENDED = 'إنهاء خدمة';
const WORKING = 'يعمل';
const LEAVE = 'إجازة';
const SUSPENDED = 'موقوف';
const ACCIDENT = 'حادث';
const WORK_STATES = [WORKING, LEAVE, SUSPENDED, ACCIDENT];
/** ما يكتبه القسمُ (`opStatus`) ← اسمُه. والفراغُ «يعمل». */
const OP_STATUS = { leave: LEAVE, suspended: SUSPENDED, accident: ACCIDENT };
// و`suspended` في الموارد البشريّة مرحلةُ نقل كفالة — ليس «موقوفًا» هنا.
const HR_STATUS_AR = { terminated: ENDED, suspended: WORKING, active: WORKING, on_leave: LEAVE };
/** صيغٌ قديمةٌ للحالة نفسِها — روابطُ محفوظةٌ ونسخُ تطبيقٍ قديمة. */
const normStatus = (v) => {
  const x = S(v);
  if (x === 'متوقف') return SUSPENDED;
  if (x === 'اجازه' || x === 'في إجازة') return LEAVE;
  return x;
};

const hrOf = (row) => (row && row.employee && typeof row.employee === 'object' ? row.employee : null);

/**
 * الحالةُ المعروضة (تصحيحُ صاحب الشركة، ٢٠٢٦/١٠/٢١). الترتيبُ هو القاعدة:
 *   ١. إنهاءُ الخدمة في الموارد البشريّة — يُستثنى من كلّ رقم.
 *   ٢. حادث · موقوف — من القسم وحدَه (`opStatus`): «موقوف» توقّفٌ تشغيليّ (لا يعمل
 *      على مركبة)، لا إيقافُ الموارد البشريّة. و`suspended` هناك (مرحلةُ نقل الكفالة)
 *      لا يُقرأ «موقوفًا» هنا.
 *   ٣. إجازة — من أيّ الجهتين: إجازةُ الموارد البشريّة (`on_leave` أو إجازةٌ معتمَدةٌ
 *      تشمل اليوم — `row._hrLeave`) أو إجازةُ القسم (`opStatus = leave`).
 *   ٤. مَن لا ملفَّ له: آخرُ ما كُتب في السجلّ القديم (إجازة/موقوف).
 *   ٥. وإلّا: يعمل.
 */
function shownStatus(row) {
  const hr = hrOf(row);
  const es = hr ? hr.employmentStatus : null;
  if (es === 'terminated') return ENDED;
  if (!hr && /انهاء|إنهاء/.test(S(row.workStatusAr))) return ENDED;
  if (row.opStatus === 'accident') return ACCIDENT;
  if (row.opStatus === 'suspended') return SUSPENDED;
  if (row.opStatus === 'leave' || es === 'on_leave' || row._hrLeave) return LEAVE;
  if (!hr) {
    const legacy = normStatus(row.workStatusAr);
    if (legacy === LEAVE || legacy === SUSPENDED) return legacy;
  }
  return WORKING;
}
/** مَن قال الحالة: القسم (`opStatus`) أو الموارد البشريّة (إجازتُها وإنهاءُ الخدمة) أو لا أحد. */
function statusSource(row) {
  if (OP_STATUS[row.opStatus]) return 'section';
  const es = hrOf(row)?.employmentStatus;
  if (es === 'terminated' || es === 'on_leave' || row._hrLeave) return 'hr';
  return '';
}

/**
 * مَن عليه إجازةٌ معتمَدةٌ في الموارد البشريّة تشمل اليوم — يُعلَّم `_hrLeave`. سؤالٌ
 * واحدٌ لكلّ الصفوف (لا سؤالٌ لكلّ صفّ)، واليومُ بتوقيت الشركة.
 */
async function markHrLeave(rows) {
  const ids = rows.map((r) => hrOf(r)?._id).filter(Boolean);
  if (!ids.length) return rows;
  const today = require('./companyDay').todayKey();
  const LeaveRequest = require('../models/LeaveRequest');
  const on = await LeaveRequest.find({ employee: { $in: ids }, status: 'approved', startDate: { $lte: today }, endDate: { $gte: today } })
    .select('employee').lean();
  const set = new Set(on.map((l) => String(l.employee)));
  for (const r of rows) if (set.has(String(hrOf(r)?._id || ''))) r._hrLeave = true;
  return rows;
}

// ── الفئة: مندوب · إداري · فني ─────────────────────────────────────────────
/**
 * الفئةُ من «الفئة الوظيفية» في الموارد البشريّة (إداري · سائق · فني) متى كُتبت
 * — و«سائق» هناك هو المندوبُ هنا — وإلّا من الوظيفة في سجلّ القسم، وإلّا من
 * المسمّى في الملفّ. والسائقُ في سجلّ القسم ميدانٌ لا مكتب، فيُعَدّ مع المناديب.
 * و`none` لمن لا يُعرَف عنه شيء: يُعرَض رقمًا صغيرًا يُملأ لا يذوب في غيره.
 */
const REP_RX = /مندوب|سائق|سايق|rep|driver|courier/i;
const TECH_RX = /فني|ميكانيك|كهرب|سمكر|tech|mechanic/i;
const kindOfTitle = (t) => {
  const x = S(t);
  if (!x) return '';
  if (REP_RX.test(x)) return 'rep';
  if (TECH_RX.test(x)) return 'tech';
  return 'admin';
};
const CATEGORY_OF_HR = { 'سائق': 'rep', 'مندوب': 'rep', 'فني': 'tech', 'إداري': 'admin', 'اداري': 'admin' };
function categoryOf(row) {
  const hr = hrOf(row);
  const c = CATEGORY_OF_HR[S(hr?.staffCategory)];
  if (c) return c;
  return kindOfTitle(row.jobTitleAr) || kindOfTitle(hr?.jobTitle) || 'none';
}
const CATEGORY_AR = { rep: 'مندوب', admin: 'إداري', tech: 'فني', none: 'غير مصنَّف' };

// ── نوعُ الارتباط ──────────────────────────────────────────────────────────
/**
 * على الكفالة / فريلانسر / متدرّب من «رقم السجل التجاري» في الموارد البشريّة
 * (utils/hrEngagement)، وخانةُ القسم لمن لا ملفَّ له. واليوزرُ المؤجَّرُ قسمٌ
 * قائمٌ بذاته، و`none` لمن لم يُكتب له شيء.
 */
function engagementOf(row) {
  // تأجيرٌ ساري مربوطٌ بالصفّ أوّلًا، ونوعُ العقد احتياطًا — utils/ltRental.
  if (require('./ltRental').isRented(row)) return 'users';
  const hr = hrOf(row);
  if (hr) return ENG.engagementOf(hr) || 'none';
  const v = foldAr(S(row.contractTypeAr)).replace(/\s+/g, '');
  if (!v) return 'none';
  if (v.includes('فريلانسر')) return 'freelance';
  if (/تدريب|متدرب/.test(v)) return 'trainee';
  return 'sponsored';
}
const ENGAGEMENT_AR = { sponsored: 'على الكفالة', freelance: 'فريلانسر', trainee: 'متدرّب', users: 'يوزرات', none: 'غير محدد' };

/** السجلُّ التجاريّ: من ملفّ الموارد البشريّة، وإلّا خانةُ القسم. */
const registerOf = (row) => {
  const hr = hrOf(row);
  return S(hr ? hr.registerNumber : row.registerNumber) || '—';
};

// ── المشروع ────────────────────────────────────────────────────────────────
const UNSET = '(غير محدد)';
/** «هنقرستيشن» و«هنجرستيشن» مشروعٌ واحد. */
const projectKey = (p) => (S(p) === UNSET ? '' : foldAr(S(p)).replace(/\s+/g, '').replace(/ق/g, 'ج'));

// ── التفويض — من سجلّ المركبات (المرجع) ────────────────────────────────────
const AUTH_AR = { authorized: 'مفوَّض', expired: 'تفويض منتهٍ', none: 'بلا تفويض' };
/**
 * حالةُ تفويض المركبة: `authorized` | `expired` | `none` — بالمعنى نفسِه الذي
 * تعرضه صفحةُ «مركبات النقل الخفيف» (اسمُ المفوَّض أو رقمُ التفويض، والنهايةُ).
 * الموضعُ الوحيدُ الذي يقرأ مصدرَ التفويض — يُبدَّل هنا إن تبدّل.
 */
function authOf(v, today = new Date().toISOString().slice(0, 10)) {
  const a = (v && v.authorizedPerson) || {};
  const has = !!(S(a.name) || S(a.authorizationNumber));
  if (!has) return 'none';
  const end = a.expiryDate ? new Date(a.expiryDate).toISOString().slice(0, 10) : '';
  if (end && end < today) return 'expired';
  return 'authorized';
}

// ── مركباتُ القسم ──────────────────────────────────────────────────────────
/**
 * كلُّ مركبةٍ يَنسبها قسمُ المركبات إلى النقل الخفيف — بقطاعها («النقل الخفيف»
 * أو رمزه) أو بإدارتها (أحد مشاريع القسم) — ومعها كلُّ مركبةٍ عليها راكبٌ من
 * سجلّ القسم. مفوَّضةً كانت أو لا: التفويضُ حالةٌ تُعَدّ لا شرطُ دخول.
 */
const LT_VEHICLE_PROJECTS = /^(كيتا|هنجرستيشن|هنقرستيشن|امازون|أمازون|نينجا)$/;
const vehicleScope = (riddenIds = []) => ({
  isActive: { $ne: false },
  $or: [
    { sectorAr: /خفيف/ }, { sectorCode: 'light_transport' }, { departmentAr: LT_VEHICLE_PROJECTS },
    ...(riddenIds.length ? [{ _id: { $in: riddenIds.map((x) => new mongoose.Types.ObjectId(String(x))) } }] : []),
  ],
});

// ── الفلاتر ────────────────────────────────────────────────────────────────
/**
 * فلاترُ اللوحة السريعة بترتيبها — مفاتيحُها نفسُها في رابط القائمتين.
 *   project · rep · vehicle · auth · cr (السجل) · engagement · category · city · status
 */
const QUICK = [
  { key: 'project', ar: 'المشروع', en: 'Project' },
  { key: 'rep', ar: 'المندوب', en: 'Rep' },
  { key: 'vehicle', ar: 'المركبة', en: 'Vehicle' },
  { key: 'auth', ar: 'التفويض', en: 'Authorisation' },
  { key: 'cr', ar: 'السجل التجاري', en: 'Commercial register' },
  { key: 'engagement', ar: 'كفالة / فريلانسر', en: 'Engagement' },
  { key: 'category', ar: 'الفئة', en: 'Category' },
  { key: 'city', ar: 'المدينة', en: 'City' },
  { key: 'status', ar: 'حالة العمل', en: 'Work status' },
];
/** مفاتيحُ تخصّ الإنسانَ وحدَه — المركبةُ تمرّ بها براكبها. */
const PERSON_ONLY = ['rep', 'cr', 'engagement', 'category', 'status', 'jobTitle', 'contractType', 'register',
  'staffKind', 'supervisor', 'housing', 'contractKind'];

const idOf = (x) => S(x && typeof x === 'object' ? x._id : x);

/**
 * اختباراتُ الإنسان: `(row, skip) => boolean`. الصفُّ مزخرَفٌ (`workStatusShown`
 * و`vehicleTypeShown` و`authState` — حالةُ تفويض مركبته).
 * كلُّ مفتاحٍ يقبل قيمًا مفصولةً بفاصلة؛ والقيمةُ الواحدةُ كما كانت.
 */
function personTests(q, { typeKey = (x) => S(x), contractKindOf } = {}) {
  const t = {};
  const has = (k) => vals(q[k]).length > 0;
  const set = (k, fn = (x) => x) => new Set(vals(q[k]).map(fn));
  if (has('project')) { const s = set('project', projectKey); t.project = (r) => s.has(projectKey(r.projectAr)); }
  if (has('city')) { const s = set('city'); t.city = (r) => s.has(S(r.cityAr) || '—'); }
  if (has('rep')) { const s = set('rep'); t.rep = (r) => s.has(S(r._id)); }
  if (has('vehicle')) { const s = set('vehicle'); t.vehicle = (r) => !!r.vehicle && s.has(idOf(r.vehicle)); }
  if (has('auth')) { const s = set('auth'); t.auth = (r) => !!r.vehicle && s.has(r.authState || 'none'); }
  if (has('cr')) { const s = set('cr'); t.cr = (r) => s.has(registerOf(r)); }
  if (has('engagement')) { const s = set('engagement'); t.engagement = (r) => s.has(engagementOf(r)); }
  if (has('category')) { const s = set('category'); t.category = (r) => s.has(categoryOf(r)); }
  if (has('status')) { const s = set('status', normStatus); t.status = (r) => s.has(r.workStatusShown); }
  // ── ومفاتيحُ اللوحة السابقة (التقسيمات وروابطُها) ─────────────────────────
  for (const [key, field] of [['jobTitle', 'jobTitleAr'], ['contractType', 'contractTypeAr'], ['register', 'registerNumber'], ['staffKind', 'staffKind']]) {
    if (has(key)) { const s = set(key); t[key] = (r) => s.has(S(r[field])); }
  }
  if (has('supervisor')) {
    const s = set('supervisor');
    t.supervisor = (r) => [...s].some((v) => (v === 'none' ? !r.supervisorUser
      : mongoose.isValidObjectId(v) ? idOf(r.supervisorUser) === v : S(r.supervisorName) === v));
  }
  if (has('housing')) {
    const s = set('housing');
    t.housing = (r) => [...s].some((v) => (v === 'none' ? !r.housing : idOf(r.housing) === v));
  }
  if (q.hasVehicle === 'yes') t.hasVehicle = (r) => !!r.vehicle;
  if (q.hasVehicle === 'no') t.hasVehicle = (r) => !r.vehicle;
  if (has('vehicleType')) { const s = set('vehicleType', typeKey); t.vehicleType = (r) => s.has(typeKey(r.vehicleTypeShown)); }
  if (has('contractKind') && contractKindOf) {
    const s = set('contractKind');
    t.contractKind = (r) => s.has(contractKindOf(r) || 'none');
  }
  const fn = (r, skip) => Object.entries(t).every(([k, f]) => k === skip || f(r));
  fn.keys = Object.keys(t);
  return fn;
}

/**
 * اختباراتُ المركبة. `vr` = { _id, project, city, typeKey, auth, riders: [صفوف] }.
 * مفاتيحُ الإنسان تمرّ بالراكب: مركبةٌ تمرّ إن كان أحدُ راكبيها يمرّ بها.
 */
function vehicleTests(q, people, { typeKey = (x) => S(x) } = {}) {
  const t = {};
  const has = (k) => vals(q[k]).length > 0;
  const set = (k, fn = (x) => x) => new Set(vals(q[k]).map(fn));
  if (has('project')) { const s = set('project', projectKey); t.project = (v) => s.has(projectKey(v.project)); }
  if (has('city')) { const s = set('city'); t.city = (v) => s.has(S(v.city) || '—'); }
  if (has('vehicle')) { const s = set('vehicle'); t.vehicle = (v) => s.has(S(v._id)); }
  if (has('auth')) { const s = set('auth'); t.auth = (v) => s.has(v.auth); }
  if (has('vehicleType')) { const s = set('vehicleType', typeKey); t.vehicleType = (v) => s.has(v.typeKey); }
  if (q.hasVehicle === 'no') t.hasVehicle = (v) => !v.riders.length;
  const personKeys = people.keys.filter((k) => PERSON_ONLY.includes(k));
  const fn = (v, skip) => {
    if (!Object.entries(t).every(([k, f]) => k === skip || f(v))) return false;
    const keys = personKeys.filter((k) => k !== skip);
    return !keys.length || v.riders.some((r) => keys.every((k) => people.only(r, k)));
  };
  fn.keys = Object.keys(t);
  return fn;
}

/** يبني `people.only(r, k)` — اختبارُ مفتاحٍ واحد (تمرّ به المركبةُ براكبها). */
function withOnly(q, opts) {
  const all = personTests(q, opts);
  const singles = {};
  for (const k of all.keys) singles[k] = personTests({ [k]: q[k] }, opts);
  all.only = (r, k) => (singles[k] ? singles[k](r) : true);
  return all;
}

module.exports = {
  S, vals,
  ENDED, WORKING, LEAVE, SUSPENDED, ACCIDENT, WORK_STATES, OP_STATUS, HR_STATUS_AR, normStatus,
  shownStatus, statusSource, markHrLeave,
  categoryOf, CATEGORY_AR, kindOfTitle,
  engagementOf, ENGAGEMENT_AR,
  registerOf, projectKey, UNSET,
  authOf, AUTH_AR,
  vehicleScope, LT_VEHICLE_PROJECTS,
  QUICK, PERSON_ONLY,
  personTests: withOnly, vehicleTests,
};
