/**
 * b2cBoard: B2C section board definitions read by the board and both lists, so a clickable card number and the list it opens always agree.
 * Work status is today's operational state (working, on leave, suspended, accident): HR alone writes employment, so HR leave wins, the rest is the section's `opStatus`, and ended staff are not counted.
 * Authorization is read only through `authOf` from VehicleMaster.authorizedPerson.
 */
const mongoose = require('mongoose');
const { fold: foldAr } = require('./b2cSupervisors');
const ENG = require('./hrEngagement');

const S = (v) => String(v == null ? '' : v).trim();
/** Filter values separated by commas, like the HR quick filters. */
const vals = (v) => S(v).split(',').map((x) => x.trim()).filter(Boolean);

// Work status.
const ENDED = 'إنهاء خدمة';
const WORKING = 'يعمل';
const LEAVE = 'إجازة';
const SUSPENDED = 'موقوف';
const ACCIDENT = 'حادث';
const WORK_STATES = [WORKING, LEAVE, SUSPENDED, ACCIDENT];
/** What the section writes (`opStatus`) to its name; empty means working. */
const OP_STATUS = { leave: LEAVE, suspended: SUSPENDED, accident: ACCIDENT };
// `suspended` in HR is a sponsorship-transfer stage, not suspended here.
const HR_STATUS_AR = { terminated: ENDED, suspended: WORKING, active: WORKING, on_leave: LEAVE };
/** Legacy spellings of the same status, for saved links and old app versions. */
const normStatus = (v) => {
  const x = S(v);
  if (x === 'متوقف') return SUSPENDED;
  if (x === 'اجازه' || x === 'في إجازة') return LEAVE;
  return x;
};

const hrOf = (row) => (row && row.employee && typeof row.employee === 'object' ? row.employee : null);

/**
 * Displayed status, in this order:
 * 1. HR service end: excluded from every number.
 * 2. Accident or suspended: section opStatus only; HR suspended (sponsorship transfer) is not read as suspended here.
 * 3. Leave: HR leave (on_leave or approved leave covering today, row._hrLeave) or section leave; no HR file uses the last legacy value; else working.
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
/** Who set the status: the section (`opStatus`), HR (its leave and service end), or nobody. */
function statusSource(row) {
  if (OP_STATUS[row.opStatus]) return 'section';
  const es = hrOf(row)?.employmentStatus;
  if (es === 'terminated' || es === 'on_leave' || row._hrLeave) return 'hr';
  return '';
}

/** People with an approved HR leave covering today, marked `_hrLeave`. One query for all rows (not per row), with today in company time. */
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

// Category: rep, administrative, technical.
/** Category from the HR job category (administrative, driver, technical) when written (driver there means rep here), otherwise from the job in the section register, otherwise from the title in the file. A driver in the section register is field staff, not office, so counts with reps. `none` is for someone nothing is known about: shown as a small number to fill in rather than hidden inside another. */
const REP_RX = /مندوب|سائق|سايق|rep|driver|courier/i;
const TECH_RX = /فني|ميكانيك|كهرب|سمكر|tech|mechanic/i;
const kindOfTitle = (t) => {
  const x = S(t);
  if (!x) return '';
  if (REP_RX.test(x)) return 'rep';
  if (TECH_RX.test(x)) return 'tech';
  return 'admin';
};
const CATEGORY_OF_HR = { 'سائق': 'rep', 'مندوب': 'rep', 'مندوب توصيل': 'rep', 'مشرف': 'admin', 'فني': 'tech', 'إداري': 'admin', 'اداري': 'admin' };
function categoryOf(row) {
  const hr = hrOf(row);
  const c = CATEGORY_OF_HR[S(hr?.staffCategory)];
  if (c) return c;
  return kindOfTitle(row.jobTitleAr) || kindOfTitle(hr?.jobTitle) || 'none';
}
const CATEGORY_AR = { rep: 'مندوب', admin: 'إداري', tech: 'فني', none: 'غير مصنَّف' };

// Engagement type.
/** Sponsored, freelancer or trainee from the commercial register number in HR (utils/hrEngagement), and the section's field for someone with no file. A rented-out user is a section of its own, and `none` is for someone with nothing written. */
function engagementOf(row) {
  // An active rental linked to the row first, contract type as fallback; see utils/ltRental.
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

/** Commercial register: from the HR file, otherwise the section field. */
const registerOf = (row) => {
  const hr = hrOf(row);
  return S(hr ? hr.registerNumber : row.registerNumber) || '—';
};

// Project.
const UNSET = '(غير محدد)';
/** Two spellings of the Hungerstation name are one project. */
const projectKey = (p) => (S(p) === UNSET ? '' : foldAr(S(p)).replace(/\s+/g, '').replace(/ق/g, 'ج'));

// Authorization, from the vehicle register (the reference).
const AUTH_AR = { authorized: 'مفوَّض', expired: 'تفويض منتهٍ', none: 'بلا تفويض' };
/** Vehicle authorization state: `authorized` | `expired` | `none`, with the same meaning as the light transport vehicles page (authorized person name or authorization number, and end date). The only place that reads the authorization source; change it here if the source changes. */
function authOf(v, today = new Date().toISOString().slice(0, 10)) {
  const a = (v && v.authorizedPerson) || {};
  const has = !!(S(a.name) || S(a.authorizationNumber));
  if (!has) return 'none';
  const end = a.expiryDate ? new Date(a.expiryDate).toISOString().slice(0, 10) : '';
  if (end && end < today) return 'expired';
  return 'authorized';
}

// Section vehicles.
/** Every vehicle the vehicles section attributes to light transport, by its sector (the light transport name or its code) or by its department (one of the section's projects), plus every vehicle with a rider from the section register. Authorized or not: authorization is a counted state, not an entry condition. */
const LT_VEHICLE_PROJECTS = /^(كيتا|هنجرستيشن|هنقرستيشن|امازون|أمازون|نينجا)$/;
const UNUSED_PROJECT = 'غير مستخدمة';
const vehicleScope = (riddenIds = []) => ({
  isActive: { $ne: false },
  $or: [
    { sectorAr: /خفيف/ }, { sectorCode: 'light_transport' }, { departmentAr: LT_VEHICLE_PROJECTS },
    // A section vehicle parked as unused stays on the section's list; heavy trucks marked the same do not join it.
    { departmentAr: UNUSED_PROJECT, sectorAr: { $not: /ثقيل/ }, sectorCode: { $ne: 'heavy_transport' } },
    ...(riddenIds.length ? [{ _id: { $in: riddenIds.map((x) => new mongoose.Types.ObjectId(String(x))) } }] : []),
  ],
});

// Filters.
/**
 * The board's quick filters in order; the keys are the same ones used in both lists' URLs.
 * project, rep, vehicle, auth, cr (register), engagement, category, city, status
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
/** Keys that concern the person only; a vehicle passes through them via its rider. */
const PERSON_ONLY = ['rep', 'cr', 'engagement', 'category', 'status', 'jobTitle', 'contractType', 'register',
  'staffKind', 'supervisor', 'housing', 'contractKind'];

const idOf = (x) => S(x && typeof x === 'object' ? x._id : x);

/** Person tests: `(row, skip) => boolean`. The row is decorated (`workStatusShown`, `vehicleTypeShown`, `authState` for his vehicle's authorization state). Each key accepts comma-separated values; a single value works as before. */
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
  // Keys of the previous board (breakdowns and their links).
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

/** Vehicle tests. `vr` = { _id, project, city, typeKey, auth, riders: [rows] }. Person keys pass through the rider: a vehicle passes if any of its riders passes. */
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

/** Builds `people.only(r, k)`, a single-key test (a vehicle passes through its rider). */
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
