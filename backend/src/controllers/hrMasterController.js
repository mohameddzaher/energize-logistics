/**
 * hrMasterController - the HR overview: a card per column, and a work list.
 * The dashboard is not a display of numbers but a work list. Each 'required' number is something missing the team must collect, and clicking it opens exactly those people so they can fill it in there.
 * That is why required and not-required are separate in every counter: a Saudi with no residency is not 'missing a residency', and listing him falsifies the list and wastes time.
 */
const Employee = require('../models/Employee');
const { startOfDay, endOfDay, daysUntil } = require('../utils/companyDay');
const H = require('../config/hrFields');
const { textIn, normKey } = require('../utils/colFilter');
const cache = require('../utils/ttlCache');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

/**
 * Edits from the master reach the rest of the department. It used to broadcast only `hr:master`, which master screens hear, while employee, contract and license screens hear `hr:employee`, so the employee list stayed stale after a master edit. bustEmployeeCaches in hrController already broadcasts both.
 * So broadcast both here and clear all three department caches, not just the master's; otherwise the dashboard shows pre-edit numbers for a full minute.
 */
/** Clear the cache, then announce. Broadcasting before clearing made listeners refetch the stale cache, leaving the screen exactly one change behind (a filled passport number still read as required until another change). See [[announce-before-invalidate]]. */
const emit = () => {
  cache.clear('hrm:');
  try { cache.clear('hr:employees:'); cache.clear('dash:hr:'); } catch (e) { /* */ }
  try { emitToAll('hr:master', {}); } catch (e) { /* */ }
  try { emitToAll('hr:employee', {}); } catch (e) { /* */ }
  // Contract fields are written on the contract itself (models/Employee), so the contracts page hears the change.
  try { emitToAll('hr:contract', {}); } catch (e) { /* */ }
};
const filled = (v) => !(v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length));
const rx = (s) => new RegExp(String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/**
 * State of a field for an employee: required / not required / none / entered.
 * An existing value takes precedence over the admin flag: a field with a written residency date is not required whatever the flag says; the flag is a leftover from before it was filled, and keeping it lists a name with nothing to do.
 * Not-required and cash salary stay as they are: they are administrative decisions, not missing data, and a present value does not override them.
 */
// Contract fields are not required of freelancers or trainees (no contract).
const CONTRACT_KEYS = new Set((H.GROUPS.find((g) => g.key === 'contract')?.fields || []).filter((f) => !f.derived).map((f) => f.key));
const statusOf = (emp, fieldKey) => {
  // Read the value with `H.valueOf`, not the column directly: ID/residency number is two columns, and reading one marks a Saudi who has a number as missing.
  const val = H.valueOf(emp, fieldKey);
  // Freelancers and trainees have no contract: their contract fields are not-required unless filled. One rule read by both the dashboard and group pages, so the dashboard does not say 18 while the page counts freelancer contracts.
  if (CONTRACT_KEYS.has(fieldKey) && !require('../utils/hrEngagement').contractRequired(emp)) {
    return filled(val) ? 'filled' : 'not_required';
  }
  const st = emp.fieldStatus?.[H.statusKeyOf(fieldKey)];
  if (st === 'required' && filled(val)) return 'filled';
  if (st) return st;
  return filled(val) ? 'filled' : 'none';
};

// Alert thresholds, same idea as vehicles. If they become editable later, this is the place that changes.
const ALERT = { warnDays: 60, criticalDays: 30 };

/**
 * Whose documents are followed?
 * The strip's expiries number was 568 while its page opened on 443: each counted different people. The strip and cards counted the whole file including 104 whose service ended (a residency of someone who left a year ago is expired forever and needs no work), while the page counted only on-duty staff, dropping those on leave or suspended, exactly the people whose documents get missed.
 * One rule, written here once and read by all three: unless asked otherwise, expiries count everyone whose service has not ended. An explicit employment status choice wins, and `employment=all` returns the whole file including leavers.
 * The scope is sent with the numbers (`expiryScope`) so links carry it: the number and the table it opens read the same condition by construction.
 */
// The archive is the boundary. The scope used to be those whose service has not ended; now it is everyone not in the archive. Archived people get no alert or number, and one returned from the archive gets his alert back with nothing to do. The archive is already excluded in `buildFilter` for every screen, so no extra condition remains here: the scope is empty.
const EXPIRY_SCOPE = {};
// Inactive is also a field state (inactive), so the group page sends `statusKind=cell` and its state is not read as an employment status. Without this, 'inactive 2' opened everyone not on duty.
const legacyEmploymentStatus = (q) => (q.statusKind !== 'cell' && ['active', 'inactive'].includes(q.status) ? q.status : '');
const hasEmploymentFilter = (q) => !!q.employment || !!legacyEmploymentStatus(q);
const expiryScopeOf = (q) => (hasEmploymentFilter(q || {}) ? {} : EXPIRY_SCOPE);
// A derived column is neither counted nor queried. Each date has a Hijri twin in the definition (config/hrFields) that is derived, not stored; in the count lists it would read as empty in the database and count as required (twelve phantom missing fields per employee). This is the real list.
const storedFields = (g) => g.fields.filter((f) => !f.derived);
const storedKeys = () => [...new Set(H.GROUPS.flatMap((g) => storedFields(g).map((f) => f.key)))];
/** Hijri twins are derived on read and sent with the row. See utils/hijri. */
const { toHijri } = require('../utils/hijri');
const hijriFields = () => H.ALL_FIELDS.filter((f) => f.type === 'hijri');


// Fields allowed for filtering, derived from the field definitions: any field added there and marked `groupable` becomes filterable here with no change.
const FILTERABLE = [...new Set([
  ...H.GROUPS.flatMap((g) => g.fields.filter((x) => x.groupable).map((x) => x.key)),
  'department', 'branchName', 'project', 'nationality', 'workStatusText', 'bank',
  'licenseType', 'insuranceCompany', 'directManagerName', 'iqamaProfession', 'idType',
  'gender', 'driverCardStatus', 'insuranceClass', 'contractStatusText', 'systemStatus',
])].filter((k) => !['isOutsideKingdom', 'isFreelancer'].includes(k));

// Date fields that accept a range (from/to), also derived from the field definitions. This was a hand-written list, so any date field added there stayed unfilterable until someone remembered it, found not by an error but by a user typing a range and seeing nothing change. Derivation makes forgetting impossible.
const DATE_FILTERABLE = H.ALL_FIELDS.filter((f) => f.type === 'date').map((f) => f.key);

// Boolean fields. The dashboard shows their values as read (yes/no), and they are excluded from FILTERABLE above because $in on a string does not match a BSON boolean. They arrived at the server and were ignored: clicking freelancer changed nothing, with no explanation. They are translated to true/false here before becoming a condition.
const BOOL_FILTERABLE = ['isOutsideKingdom', 'isFreelancer'];
const asBool = (v) => {
  const t = String(v ?? '').trim();
  if (['نعم', 'true', '1'].includes(t)) return true;
  if (['لا', 'false', '0'].includes(t)) return false;
  return null;
};

const ENG = require('../utils/hrEngagement');
/** Each counter has two twins, `__s` sponsored and `__f` freelancer, in the same aggregation. */
const ENG_EXPR = {
  s: { $regexMatch: { input: { $ifNull: ['$registerNumber', ''] }, regex: ENG.ENGAGEMENT_MATCH.sponsored.registerNumber.$regex } },
  f: { $regexMatch: { input: { $ifNull: ['$registerNumber', ''] }, regex: ENG.ENGAGEMENT_MATCH.freelance.registerNumber.$regex, options: 'i' } },
};
// directManagerName follows the manager chosen in the employee form (models/Employee).
const FV = require('../utils/hrFilterValue');
const LOCKED_FIELDS = new Set(['workStatusText', 'systemStatus', 'employmentStatus', 'directManagerName']);
const CONTRACT_SCOPE = { $nor: [ENG.ENGAGEMENT_MATCH.freelance, ENG.ENGAGEMENT_MATCH.trainee] };
function splitExprs(exprs) {
  const out = {};
  for (const [k, e] of Object.entries(exprs)) {
    const base = e === true ? { $literal: true } : e;
    out[k] = base;
    out[`${k}__s`] = { $and: [base, ENG_EXPR.s] };
    out[`${k}__f`] = { $and: [base, ENG_EXPR.f] };
  }
  return out;
}

function buildFilter(q) {
  // Auto-created login account records are not employees; excluded from every counter and list here.
  const f = { isHrRecord: { $ne: false } };
  // The archive is outside every screen except its page. Someone whose service ended and who left the system (or an ended freelancer) appears in no number or list, except with `archived=1` (the archive page). See utils/hrEngagement.
  f.$and = [q.archived === '1' ? ENG.ARCHIVED : ENG.NOT_ARCHIVED];
  // Sponsored / freelancer / trainee / unspecified, from the commercial register number.
  const eng = String(q.engagement || '');
  if (ENG.ENGAGEMENT_MATCH[eng]) f.$and.push(ENG.ENGAGEMENT_MATCH[eng]);
  if (eng === 'none') f.$and.push({ $nor: Object.values(ENG.ENGAGEMENT_MATCH) });
  // The contracts group does not apply to freelancers or trainees: with no contract they are not counted as missing.
  if (q.contractScope === '1') f.$and.push(CONTRACT_SCOPE);
  // The master includes every employee. The default scope used to be those in the imported master file (`inCurrentMaster`), a flag only the import sets, so an employee added from the employees page after import showed there but not here, uncounted and unfindable by name or residency. The master is the department's full picture and reads exactly what the employees page reads; employment status (on duty / ended) is a filter, not a scope. `scope=master` keeps the old read for those who need it.
  if (q.scope === 'master') f.inCurrentMaster = true;
  // Created from another department (light transport register); see `createdVia` in models/Employee.
  if (q.createdVia) { f.createdVia = String(q.createdVia); f.hrPending = true; }
  // Employment status is read from `employment`. It was named `status`, the same name the group page uses for a field's state (required/not required), so 'Jeddah + on duty' reached the table as a field state named active and returned zero. The old name is still accepted because saved links use it.
  const employment = q.employment || legacyEmploymentStatus(q);
  if (employment === 'active') f.employmentStatus = 'active';
  // Not on duty means ended service plus suspended in sponsorship transfer. Someone on leave is still on duty and is not read as having left.
  if (employment === 'inactive') f.employmentStatus = { $in: ['terminated', 'suspended'] };
  // On duty as the dashboard defines it: working or on leave.
  if (employment === 'onduty') f.employmentStatus = { $in: ['active', 'on_leave'] };
  if (employment === 'leave') f.employmentStatus = 'on_leave';
  // The three work states and the two not-working states - dashboard cards (see utils/hrEngagement).
  if (employment === 'working') f.$and.push({ employmentStatus: { $in: ['active', 'on_leave'] }, sisterCompany: { $ne: true } });
  if (employment === 'sister') f.$and.push({ employmentStatus: { $ne: 'terminated' }, sisterCompany: true });
  if (employment === 'transfer') f.$and.push({ employmentStatus: 'terminated', terminationKind: 'transfer_pending' });
  if (employment === 'final_exit') f.$and.push({ employmentStatus: 'terminated', terminationKind: 'final_exit' });
  // Not working inside the system with no specific state (and the old suspended state with it) - the rest of not-working.
  if (employment === 'nokind') f.$and.push({ $or: [{ employmentStatus: 'terminated', terminationKind: { $nin: ['transfer_pending', 'final_exit'] } }, { employmentStatus: 'suspended' }] });
  // On the workforce is not the same as on duty. Someone on leave or suspended is not on duty today but is a current employee whose residency and license are renewed. `inactive` groups him with those whose service ended, so it cannot answer 'whose documents are followed?'. This value does: everyone whose service has not ended. See EXPIRY_SCOPE.
  if (employment === 'current') f.employmentStatus = { $ne: 'terminated' };
  if (employment === 'terminated') f.employmentStatus = 'terminated';
  // Filtering by several values and several fields at once: 'Pakistanis and Indians, male, in heavy transport, in Jeddah and Makkah' is one question, not four; each field used to accept a single value.
  // Values arrive comma-separated, and a dash means the empty cell, a real category ('who has no nationality recorded' is a question, not an error).
  const multi = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  for (const k of FILTERABLE) {
    const vals = multi(q[k]);
    if (!vals.length) continue;
    // A value is matched as read. It was `$in` on strings, Mongoose trims, and the import wrote 'Jeddah ' with a trailing space, so choosing 'Jeddah 40' returned only the unpadded ones. The value is a pattern accepting all whitespace, and the dash covers only the empty value. See utils/colFilter.
    const c = textIn(k, vals.map((x) => (x === '—' ? '' : x)));
    if (k === 'workStatusText') {
      const blanks = vals.map(FV.blankStatusMatch).filter(Boolean);
      if (c && blanks.length) { f.$and.push({ $or: [{ [k]: c[k] }, ...blanks] }); continue; }
    }
    const statusPath = `fieldStatus.${H.statusKeyOf(k)}`;
    const answers = FV.ANSWER_CODES.filter((code) => vals.includes(H.STATUS_LABELS[code].ar));
    // «Not set» leaves out what cannot be set, and an answer also matches a blank marked with it.
    if (vals.includes('—')) {
      f.$and.push({ $or: [{ [statusPath]: { $nin: FV.ANSWER_CODES } }, { [k]: { $nin: [null, ''] } }] });
      if (k === 'staffCategory') f.$and.push({ department: { $in: FV.CATEGORY_DEPARTMENTS } });
    }
    if (c && answers.length) f.$and.push({ $or: [{ [k]: c[k] }, { [statusPath]: { $in: answers } }] });
    else if (c) f[k] = c[k];
  }
  // Boolean fields under their real names, as the filter panel sends them.
  for (const field of BOOL_FILTERABLE) {
    const vals = [...new Set(multi(q[field]).map(asBool).filter((v) => v !== null))];
    // Both values together means no condition: yes-or-no covers everyone, and a condition covering everyone only slows the query.
    if (vals.length !== 1) continue;
    f[field] = vals[0] ? true : { $ne: true };
  }
  // The screen's ready-made buttons send a short name; the explicit one is more specific and applies after it.
  for (const [qk, field] of [['outsideKingdom', 'isOutsideKingdom'], ['freelancer', 'isFreelancer']]) {
    if (q[qk] === '1') f[field] = true;
    else if (q[qk] === '0') f[field] = { $ne: true };
  }
  // The date range is not applied here - see dateRangePred below. Date fields in this file are stored as strings carrying administrative words beside the date (required, not required), so $gte/$lte against a Date object compares different BSON types and returns unrelated rows. It is applied to the value after reading it as a real date. The three identity columns are filtered as displayed. The master table shows three pinned columns not in `FILTERABLE`: employee, ID/residency number, custody count. Ticking a person in their funnel used to be silently ignored, which reads as a broken filter, worse than rejection. None of them is a database field: - employee = `arabicName` or first + last name composed. - ID/residency number = `iqamaNumber` or `nationalId` by identity type (see the memory on the identity number in two columns). - custody count is computed from the asset register and applied in `exports.grid`.
  const multiRaw = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const names = multiRaw(q.name);
  if (names.length) {
    const full = { $trim: { input: { $concat: [{ $ifNull: ['$firstName', ''] }, ' ', { $ifNull: ['$lastName', ''] }] } } };
    f.$and = [...(f.$and || []), { $or: [
      { arabicName: { $in: names } },
      { $expr: { $in: [full, names] } },
    ] }];
  }
  const ids = multiRaw(q.iqamaNumber);
  if (ids.length) {
    // A dash in the funnel means no number: a real category (whose identity is not recorded).
    const wantsBlank = ids.includes('—');
    const rest = ids.filter((x) => x !== '—');
    const keys = H.searchKeysOf('iqamaNumber');
    const or = rest.length ? keys.map((k) => ({ [k]: { $in: rest } })) : [];
    if (wantsBlank) or.push({ $and: keys.map((k) => ({ [k]: { $in: ['', null] } })) });
    if (or.length) f.$and = [...(f.$and || []), { $or: or }];
  }

  if (q.q && q.q.trim()) {
    const r = rx(q.q);
    // Search both identity number columns together; someone who typed a Saudi's number could not find him.
    f.$or = [{ arabicName: r }, { firstName: r }, { lastName: r }, { employeeNumber: r },
      ...H.searchKeysOf('iqamaNumber').map((k) => ({ [k]: r })),
      { passportNumber: r }, { companyNumber: r }, { absherNumber: r }];
  }
  return f;
}

/**
 * Date-range predicate, applied to rows after fetch.
 * The value may be a stored date or a word (required). A word is not a date outside the range but has no date, so it leaves any range and only the dash filter returns it.
 */
const asDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
};
// Fields asked about in years, not dates. 'Ages between 25 and 30' is asked daily and needed two birth dates worked out by hand. Age changes with time and a date does not, so a years filter stays right tomorrow while a written date range ages.
const YEAR_SPAN_FIELDS = { dateOfBirth: 'age', hireDate: 'tenure' };
// Expiry fields are asked about in days remaining ('expiring within thirty days'). They are by definition document expiry dates, so read from them, not typed beside them.
const DAYS_LEFT_FIELDS = H.DOCUMENT_GROUPS.map((g) => g.expiryField).filter(Boolean);

/** Whole years between a date and today: age or tenure. */
const yearsSince = (d) => {
  const now = new Date();
  let y = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) y -= 1;
  return y;
};
// The old `daysUntil` measured from server midnight (GMT here) and came up a day short in the first three hours of the Riyadh day. It is now from `utils/companyDay`, comparing calendar days, not instants.

function dateRangePred(q) {
  const tests = [];

  // 1. A specific day: `<key>On=YYYY-MM-DD`. A from-to range of the same day works but makes the user type the date twice for one question.
  for (const key of DATE_FILTERABLE) {
    const on = String(q[`${key}On`] ?? '').trim();
    if (!on) continue;
    tests.push((e) => {
      const d = asDate(e[key]);
      return !!d && d.toISOString().slice(0, 10) === on;
    });
  }

  // 2. A range in years: `ageFrom/ageTo` and `tenureFrom/tenureTo`.
  for (const [key, name] of Object.entries(YEAR_SPAN_FIELDS)) {
    const lo = q[`${name}From`] === '' || q[`${name}From`] == null ? null : Number(q[`${name}From`]);
    const hi = q[`${name}To`] === '' || q[`${name}To`] == null ? null : Number(q[`${name}To`]);
    if (lo == null && hi == null) continue;
    tests.push((e) => {
      const d = asDate(e[key]);
      if (!d) return false;
      const y = yearsSince(d);
      return (lo == null || y >= lo) && (hi == null || y <= hi);
    });
  }

  // 3. A range in days remaining: `<key>DaysFrom/DaysTo`. Negative is past, so expired a month ago through expiring in a month is -30 to 30.
  for (const key of DAYS_LEFT_FIELDS) {
    const lo = q[`${key}DaysFrom`] === '' || q[`${key}DaysFrom`] == null ? null : Number(q[`${key}DaysFrom`]);
    const hi = q[`${key}DaysTo`] === '' || q[`${key}DaysTo`] == null ? null : Number(q[`${key}DaysTo`]);
    if (lo == null && hi == null) continue;
    tests.push((e) => {
      const d = asDate(e[key]);
      if (!d) return false;
      const n = daysUntil(d);
      return (lo == null || n >= lo) && (hi == null || n <= hi);
    });
  }

  for (const key of DATE_FILTERABLE) {
    // A dash on a date field means no readable date (empty or an administrative word).
    if (String(q[key] ?? '').split(',').map((x) => x.trim()).includes('—')) {
      tests.push((e) => asDate(e[key]) === null);
      continue;
    }
    const from = q[`${key}From`]; const to = q[`${key}To`];
    if (!from && !to) continue;
    const lo = from ? startOfDay(from) : null;
    const hi = to ? endOfDay(to) : null;
    tests.push((e) => {
      const d = asDate(e[key]);
      if (!d) return false;
      return (!lo || d >= lo) && (!hi || d <= hi);
    });
  }
  return tests.length ? (e) => tests.every((t) => t(e)) : null;
}

// Exported for the general employee list, so filtering has one language across the department: what the HR dashboard writes the list understands, and what the site understands the app understands. Two filter languages inevitably give two numbers for the same question.
exports._buildFilter = buildFilter;
exports._dateRangePred = dateRangePred;
// The date field list is exported too: the range predicate applies to the value after fetch, so a field not fetched looks undated and silently drops out of every range. Anyone deriving his own projection forgets a newly added field, found not by an error but by a user typing a range and getting an empty screen.
exports._DATE_FILTERABLE = DATE_FILTERABLE;

/** Fetch employees with all query conditions: database conditions, then date conditions. */
async function findEmployees(q, select) {
  let query = Employee.find(buildFilter(q));
  // Columns that derived fields read from are always pulled (see H.READ_DEPS). Five queries here select specific columns, and forgetting a column in one makes the screen say none about a written value. The commercial register number is always included: it tells who has no contract (see statusOf).
  if (select) query = query.select([select, ...H.READ_DEPS, 'registerNumber'].join(' '));
  // No hint: forcing the planner onto a specific index makes every query fail if that index is missing on the cluster, which happened here. Indexes are created by scripts/addHrIndexes.js and the planner picks what fits each query.
  const rows = await query.lean();
  const pred = dateRangePred(q);
  return pred ? rows.filter(pred) : rows;
}

/**
 * Database condition equivalent to all query filters, plus the date range.
 * Counting moved to the database (see utils/hrCounts) while the date range stayed a post-fetch condition in the node. The dashboard counted with `buildFilter` alone: choosing age 25 to 30 showed 54 in the filter counter while the cards stayed on 441, a filter that looks applied and moves no number. So when a range exists, matching is resolved first to an id list, and that is what gets counted.
 */
async function matchFor(q) {
  const match = buildFilter(q);
  const pred = dateRangePred(q);
  if (!pred) return match;
  const rows = await Employee.find(match).select(['_id', ...DATE_FILTERABLE].join(' ')).lean();
  return { _id: { $in: rows.filter(pred).map((r) => r._id) } };
}

// Derived analytics
// Many columns hold a raw date that says nothing by eye. These functions turn dates into slices a reader understands, and attach to each slice the exact filter that reproduces it, so clicking opens its rows without the UI re-deriving the condition (it might differ one day).
const iso = (d) => d.toISOString().slice(0, 10);
const shiftYears = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return iso(d); };
const nextDay = (isoStr) => { const d = new Date(`${isoStr}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const shiftDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

/** Age / tenure slices: two year bounds on a date field. */
const yearBands = (rows, key, bands) => bands.map((b) => {
  // Older means the earlier date. The `from` bound is shifted one day because the previous slice ends on the same date; without the shift someone at exactly the boundary falls into both slices.
  const from = b.max == null ? null : nextDay(shiftYears(b.max));
  const to = b.min == null ? null : shiftYears(b.min);
  const f = {};
  if (from) f[`${key}From`] = from;
  if (to) f[`${key}To`] = to;
  const count = rows.filter((r) => {
    const v = r[key] instanceof Date ? r[key] : (r[key] ? new Date(r[key]) : null);
    if (!v || isNaN(v)) return false;
    const s = iso(v);
    return (!from || s >= from) && (!to || s <= to);
  }).length;
  return { label: b.ar, labelEn: b.en, count, filter: f };
});

/** Document expiry horizons: expired / within 30 / 31-60 / 61-90 / later / no date. */
const expiryHorizon = (rows, key) => {
  const today = iso(new Date());
  const mk = (ar, en, from, to) => {
    const f = {};
    if (from) f[`${key}From`] = from;
    if (to) f[`${key}To`] = to;
    const count = rows.filter((r) => {
      const v = r[key] ? new Date(r[key]) : null;
      if (!v || isNaN(v)) return false;
      const s = iso(v);
      return (!from || s >= from) && (!to || s <= to);
    }).length;
    return { label: ar, labelEn: en, count, filter: f };
  };
  const out = [
    // Expired ends yesterday and within-30 starts today. If they overlapped on one day, someone expiring today would be counted twice and the slices would exceed the employee count.
    mk('منتهٍ', 'Expired', null, shiftDays(-1)),
    mk('خلال ٣٠ يومًا', 'Within 30d', today, shiftDays(30)),
    mk('٣١ إلى ٦٠ يومًا', '31–60d', shiftDays(31), shiftDays(60)),
    mk('٦١ إلى ٩٠ يومًا', '61–90d', shiftDays(61), shiftDays(90)),
    mk('أبعد من ٩٠ يومًا', 'Beyond 90d', shiftDays(91), null),
  ];
  const dated = rows.filter((r) => r[key] && !isNaN(new Date(r[key]))).length;
  out.push({ label: 'بلا تاريخ مسجَّل', labelEn: 'No date', count: rows.length - dated, filter: { [key]: '—' } });
  return out;
};

const AGE_BANDS = [
  { ar: 'أقل من ٢٥', en: 'Under 25', min: null, max: 25 },
  { ar: '٢٥ إلى ٣٤', en: '25–34', min: 25, max: 35 },
  { ar: '٣٥ إلى ٤٤', en: '35–44', min: 35, max: 45 },
  { ar: '٤٥ إلى ٥٤', en: '45–54', min: 45, max: 55 },
  { ar: '٥٥ فأكثر', en: '55+', min: 55, max: null },
];
const TENURE_BANDS = [
  { ar: 'أقل من سنة', en: 'Under 1y', min: null, max: 1 },
  { ar: 'سنة إلى سنتين', en: '1–2y', min: 1, max: 3 },
  { ar: '٣ إلى ٥ سنوات', en: '3–5y', min: 3, max: 6 },
  { ar: '٦ إلى ١٠ سنوات', en: '6–10y', min: 6, max: 11 },
  { ar: 'أكثر من ١٠ سنوات', en: 'Over 10y', min: 11, max: null },
];
// Expiry horizons: one document group is one horizon card, derived from the group definitions. A group added there used to stay without a horizon here until someone remembered.
const HORIZON_DOCS = H.DOCUMENT_GROUPS.map((g) => ({ key: g.expiryField, ar: `انتهاء ${g.ar}`, en: `${g.en} expiry` }));

const buildAnalytics = (rows) => {
  const out = [];
  out.push({ key: 'age', ar: 'الفئات العمرية', en: 'Age bands', kind: 'bar', items: yearBands(rows, 'dateOfBirth', AGE_BANDS) });
  out.push({ key: 'tenure', ar: 'مدة الخدمة', en: 'Tenure', kind: 'bar', items: yearBands(rows, 'hireDate', TENURE_BANDS) });
  for (const d of HORIZON_DOCS) {
    out.push({ key: `hz:${d.key}`, ar: d.ar, en: d.en, kind: 'horizon', field: d.key, items: expiryHorizon(rows, d.key) });
  }
  return out;
};

// Available filters and their values
// The screen needs: which fields to filter by, the possible values of each, and how many rows lie behind each value after the other applied filters.
// The last is the point: counts over the whole file would show 'India 40', then picking heavy transport shows 3, and the user thinks the screen lies. Count on the actually filtered set, except the field itself: computing nationality values applies every filter but nationality, or only the selected value would show and no one could add a second nationality.
exports.filterOptions = async (req, res) => {
  try {
    const key = `hrm:filters:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    // Each filter's definition: its key, name and group.
    const defs = [];
    for (const g of H.GROUPS) {
      for (const fld of g.fields) {
        if (!fld.groupable) continue;
        defs.push({ key: fld.key, ar: fld.ar, en: fld.en, groupAr: g.ar, groupEn: g.en, groupKey: g.key });
      }
    }

    const tally = (rows, key) => {
      // An empty cell in a boolean field is not a third category. 'Outside the kingdom' is yes or no, and an unwritten field was counted as a dash, so the list said 'no: 409' while the table returned 414: the 'no' filter is `{ $ne: true }`, which includes unwritten. An unwritten value is counted as no, as it is filtered, so what is read equals what is returned.
      const isBool = BOOL_FILTERABLE.includes(key);
      const counts = new Map();
      for (const r of rows) {
        const raw = r[key];
        if (!FV.applies(r, key)) continue;
        const v = raw === true ? 'نعم'
          : isBool ? 'لا'
            : (raw === false ? 'لا' : (normKey(Array.isArray(raw) ? raw.join(', ') : raw) || FV.derivedOf(r, key) || FV.answerOf(r, key) || '—'));
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
    };

    // All filters except one field only really differ for currently filtered fields; the rest, always the majority, share one set. So one query for all of them plus one per active filter instead of eighteen per dashboard open (with five active filters: 6 queries instead of 18).
    const isActive = (k) => {
      const v = req.query[k];
      return (v != null && v !== '') || req.query[`${k}From`] || req.query[`${k}To`];
    };
    const active = defs.filter((d) => isActive(d.key));
    const passive = defs.filter((d) => !isActive(d.key));

    const shared = passive.length
      ? await findEmployees(req.query, [...new Set([...passive.map((d) => d.key), ...DATE_FILTERABLE, 'department', 'fieldStatus', ...FV.STATUS_DEPS.split(' ')])].join(' '))
      : [];

    const perActive = await Promise.all(active.map(async (d) => {
      const others = { ...req.query };
      delete others[d.key]; delete others[`${d.key}From`]; delete others[`${d.key}To`];
      return [d.key, await findEmployees(others, [...new Set([d.key, ...DATE_FILTERABLE, 'department', 'fieldStatus', ...FV.STATUS_DEPS.split(' ')])].join(' '))];
    }));
    const byActive = new Map(perActive);

    // Order stays the definition order so fields do not jump around on the dashboard between opens.
    const filters = defs.map((d) => ({
      ...d,
      values: tally(byActive.get(d.key) || shared, d.key),
    }));

    const body = { filters, dateFields: DATE_FILTERABLE };
    cache.set(key, body, 20000);
    res.json(body);
  } catch (e) {
    console.error('hr filterOptions', e);
    res.status(500).json({ message: 'تعذّر تحميل الفلاتر' });
  }
};

// Overview
exports.overview = async (req, res) => {
  try {
    const key = `hrm:ov:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    // A partial projection to reduce transfer, with `fieldStatus` first in it. It was omitted, and it is the field each cell's state is read from; without it every cell became filled-or-nothing and the whole required column collapsed to zero, a dashboard saying no work waits while the database had 5262 cells waiting. Reducing transfer must not drop the field the computation rests on.
    const requiredFields = [...new Set([
      'fieldStatus',
      'employeeNumber', 'arabicName', 'firstName', 'lastName', 'employmentStatus',
      'isOutsideKingdom', 'isFreelancer', 'iban', 'gosiNumber', 'inCurrentMaster',
      ...FILTERABLE, ...DATE_FILTERABLE,
      ...H.GROUPS.flatMap((g) => [g.expiryField, ...storedFields(g).map((f) => f.key)]).filter(Boolean),
    ])].join(' ');
    // Counting happens in the database. The dashboard used to read all employees with all fields and count in the node. Measured in production, the cluster delivers about 95 KB per second and everything scales linearly with that: one MB of employees is eleven seconds on every strip open. The counting itself in the database is ten milliseconds, so the problem is transfer, not computation.
    // So counts, distributions and expiry states are computed there and only the answer is transferred. The result was compared with the old computation field by field and state by state with an exact match (see auditHrCountsParity and auditHrStatesParity).
    const { statusCounts, valueDistributions, boolCounts, docStateCounts, filledExpr } = require('../utils/hrCounts');
    const match = await matchFor(req.query);
    // Expiry states count those whose service has not ended. See EXPIRY_SCOPE.
    const expiryScope = expiryScopeOf(req.query);
    const docMatch = expiryScope.employment ? { $and: [match, buildFilter(expiryScope)] } : match;
    const allKeys = storedKeys();
    const groupableKeys = [...new Set(H.GROUPS.flatMap((g) => g.fields.filter((f) => f.groupable).map((f) => f.key)))];

    const [counts, dists, states, sums] = await Promise.all([
      statusCounts(Employee, match, allKeys),
      valueDistributions(Employee, match, groupableKeys),
      docStateCounts(Employee, docMatch, H.GROUPS, ALERT),
      boolCounts(Employee, match, splitExprs({
        all: true,
        // Working excludes the sister company, which has its own card.
        active: { $and: [{ $eq: ['$employmentStatus', 'active'] }, { $ne: ['$sisterCompany', true] }] },
        onLeave: { $and: [{ $eq: ['$employmentStatus', 'on_leave'] }, { $ne: ['$sisterCompany', true] }] },
        onDuty: { $and: [{ $in: ['$employmentStatus', ['active', 'on_leave']] }, { $ne: ['$sisterCompany', true] }] },
        sister: { $and: [{ $ne: ['$employmentStatus', 'terminated'] }, { $eq: ['$sisterCompany', true] }] },
        finalExit: { $and: [{ $eq: ['$employmentStatus', 'terminated'] }, { $eq: ['$terminationKind', 'final_exit'] }] },
        noKind: { $or: [
          { $and: [{ $eq: ['$employmentStatus', 'terminated'] }, { $not: [{ $in: [{ $ifNull: ['$terminationKind', ''] }, ['transfer_pending', 'final_exit']] }] }] },
          { $eq: ['$employmentStatus', 'suspended'] },
        ] },
        notActive: { $in: ['$employmentStatus', ['terminated', 'suspended']] },
        terminated: { $eq: ['$employmentStatus', 'terminated'] },
        transfer: { $and: [{ $eq: ['$employmentStatus', 'terminated'] }, { $eq: ['$terminationKind', 'transfer_pending'] }] },
        outsideKingdom: { $eq: ['$isOutsideKingdom', true] },
        gosiRegistered: filledExpr('gosiNumber'),
        cashPayroll: { $eq: [{ $ifNull: ['$fieldStatus.ibanStatus', ''] }, 'cash_payroll'] },
      })),
    ]);
    const employeeCount = sums.total;
    // The contracts group counts those who need a contract. Freelancers and trainees have no contract, so their contract fields are not counted as required nor their contract as expired or incomplete.
    const contractGroup = H.GROUPS.find((g) => g.key === 'contract');
    if (contractGroup) {
      const cKeys = storedFields(contractGroup).map((x) => x.key);
      const [cCounts, cStates] = await Promise.all([
        statusCounts(Employee, { $and: [match, CONTRACT_SCOPE] }, cKeys),
        docStateCounts(Employee, { $and: [docMatch, CONTRACT_SCOPE] }, [contractGroup], ALERT),
      ]);
      for (const k of cKeys) counts[k] = cCounts[k] || {};
      if (cStates.contract) states.contract = cStates.contract;
    }

    // Ids of matching employees, needed by the leave, request and custody counters.
    // Plus the analytics dates: when counting moved to the database this query was restricted to `_id`, while `buildAnalytics` still reads birth, hire and expiry dates from it, so it read empty: every slice zero and no-date equal to all employees. Eleven short dates per employee is a small payload, and without them the whole section is false.
    const empIdRows = await Employee.find(match)
      .select(['_id', 'dateOfBirth', 'hireDate', ...HORIZON_DOCS.map((x) => x.key)].join(' ')).lean();
    const employees = empIdRows;

    // A card per field. The four counters are the ones requested by name: required, not required, entered and total, each with the filter that opens exactly those people.
    const countsOf = (key) => counts[key] || {};
    const groups = H.GROUPS.map((g) => {
      const fields = g.fields.map((f) => {
        const counts = { required: 0, not_required: 0, none: 0, filled: 0, cash_payroll: 0, inactive: 0, unparseable: 0 };
        // The Hijri twin is derived: its state is its Gregorian source's state (as the group page counts it). It used to be counted by its own key and came out zero in all four, a line with no number on the dashboard while its numbers are complete on the page it opens.
        Object.assign(counts, countsOf(f.of || f.key));
        // Distribution in the card: top values, not all. Columns with a unique value per employee (email, employee number, Absher mobile) give a 360-line distribution of ones, not readable and hundreds of KB transferred on every dashboard open for nothing shown. The card shows twenty, so twenty-five are sent with the real value count, so the title does not say 'distribution (25)' when there are 82. The full list belongs in the filter panel, where it is searched and chosen.
        const dist = f.groupable ? dists[f.key] : null;
        return {
          key: f.key, ar: f.ar, en: f.en, type: f.type, group: g.key,
          total: employeeCount,
          counts,
          // Required is the actionable number, so it moves up in the order. A derived field is excluded from the total: its gap is its source's gap and would be counted twice.
          required: f.derived ? 0 : counts.required,
          values: dist ? dist.list : undefined,
          valuesTotal: dist ? dist.total : undefined,
        };
      });
      const out = {
        key: g.key, ar: g.ar, en: g.en, icon: g.icon, document: !!g.document,
        fields,
        required: fields.reduce((n, f) => n + f.required, 0),
      };
      // Groups with a document that has an expiry date also get the date states.
      if (g.document) {
        const st = states[g.key] || { states: {}, nearest: null };
        const nearest = st.nearest ?? null;
        out.states = { valid: 0, warning: 0, critical: 0, expired: 0, missing: 0, not_applicable: 0, ...st.states };
        out.expiryField = g.expiryField;
        out.needsAttention = out.states.expired + out.states.critical + out.states.warning;
        out.nearestDays = nearest;
      }
      return out;
    });

    // Every number on this dashboard is computed on what the filter shows. Employees and on-duty used to come from the whole file whatever the filter, on the grounds that headcount is a fixed fact. On screen: choose a nationality of 72 and read Employees 378 above numbers all computed on the 72, a dashboard half answering your question and half another, with nothing saying which. The file total stays available: lift the filter and it shows.
    const rosterFilter = { isHrRecord: { $ne: false }, $and: [ENG.NOT_ARCHIVED] };
    // Not restricted to the import file - see buildFilter.
    if (req.query.scope === 'master') rosterFilter.inCurrentMaster = true;
    const rosterTotal = await Employee.countDocuments(rosterFilter);

    /** Each card has two halves: sponsored and freelancer. The type comes from the commercial register number (see utils/hrEngagement): the big number, and under it how many are sponsored and how many freelancers. Trainees and unspecified are in the big number but in neither half. Missing fields and documents are counted per type with the same count on its half. */
    const halfOf = (name) => ({ sponsored: sums[`${name}__s`] || 0, freelance: sums[`${name}__f`] || 0 });
    const [reqS, reqF, stS, stF, archived] = await Promise.all([
      statusCounts(Employee, { $and: [match, ENG.ENGAGEMENT_MATCH.sponsored] }, allKeys),
      statusCounts(Employee, { $and: [match, ENG.ENGAGEMENT_MATCH.freelance] }, allKeys),
      docStateCounts(Employee, { $and: [docMatch, ENG.ENGAGEMENT_MATCH.sponsored] }, H.GROUPS, ALERT),
      docStateCounts(Employee, { $and: [docMatch, ENG.ENGAGEMENT_MATCH.freelance] }, H.GROUPS, ALERT),
      boolCounts(Employee, { isHrRecord: { $ne: false }, ...ENG.ARCHIVED }, splitExprs({ all: true })),
    ]);
    // The freelancer half excludes the contracts group, as freelancers have no contract.
    const requiredOf = (c, skip = '') => H.GROUPS.filter((g) => g.key !== skip).reduce((n, g) => n + g.fields.reduce((m, f) => m + (f.derived ? 0 : ((c[f.of || f.key] || {}).required || 0)), 0), 0);
    const attentionOf = (st, skip = '') => H.GROUPS.filter((g) => g.document && g.key !== skip).reduce((n, g) => {
      const x = (st[g.key] || {}).states || {};
      return n + (x.expired || 0) + (x.critical || 0) + (x.warning || 0);
    }, 0);
    const activeCount = sums.onDuty;

    const totals = {
      employees: employeeCount,
      // On duty = working + on leave; detail is in `onDutyDetail`.
      active: activeCount,
      // Not on duty = ended service + in sponsorship transfer stage, excluding leave.
      notActive: sums.notActive,
      terminated: sums.terminated,
      // Not working inside the system (waiting to exit) in both states; the archive has its own card.
      transfer: sums.transfer,
      finalExit: sums.finalExit,
      noKind: sums.noKind,
      sister: sums.sister,
      archived: archived.all,
      halves: {
        employees: halfOf('all'), active: halfOf('onDuty'), notActive: halfOf('notActive'),
        transfer: halfOf('transfer'), outsideKingdom: halfOf('outsideKingdom'), gosiRegistered: halfOf('gosiRegistered'),
        finalExit: halfOf('finalExit'), sister: halfOf('sister'), noKind: halfOf('noKind'),
        archived: { sponsored: archived.all__s || 0, freelance: archived.all__f || 0 },
        required: { sponsored: requiredOf(reqS), freelance: requiredOf(reqF, 'contract') },
        expiringSoon: { sponsored: attentionOf(stS), freelance: attentionOf(stF, 'contract') },
      },
      // Clicking half of on-duty: how many working and how many on leave.
      onDutyDetail: {
        sponsored: { working: sums.active__s || 0, leave: sums.onLeave__s || 0 },
        freelance: { working: sums.active__f || 0, leave: sums.onLeave__f || 0 },
      },
      // Total of the employment file, shown beside the filtered number so it is clear what it was cut from, not to replace it.
      roster: rosterTotal,
      // What the current filter shows; the numbers below are all computed on it.
      filtered: employeeCount,
      // Required fields = sum of required over fields without duplicates (a field in two groups counts once) and without Hijri twins, which is exactly the sum of the cards on the required-data page.
      required: (() => { const seen = new Set(); let n = 0; for (const g of groups) for (const f of g.fields) { if (seen.has(f.key)) continue; seen.add(f.key); n += f.required || 0; } return n; })(),
      expiringSoon: groups.reduce((n, g) => n + (g.needsAttention || 0), 0),
      // And its breakdown by its three stages, from the same groups, so their sum is the number by construction.
      expiringStates: ['expired', 'critical', 'warning'].reduce((o, k) => {
        o[k] = groups.reduce((n, g) => n + ((g.needsAttention && g.states?.[k]) || 0), 0);
        return o;
      }, {}),
      outsideKingdom: sums.outsideKingdom,
      // Freelancer comes from the commercial register number, not the old type field.
      freelancers: sums.all__f || 0,
      cashPayroll: sums.cashPayroll,
      gosiRegistered: sums.gosiRegistered,
    };

    // Daily work, computed on what is shown. These numbers used to come from a general call that ignored the filter, so choosing a branch read '335 custody', the whole company's custody. They are now computed on matching employees only, and a whole call went away from each page open.
    const LeaveRequest = require('../models/LeaveRequest');
    const HRRequest = require('../models/HRRequest');
    const Asset = require('../models/Asset');
    const empIds = employees.map((e) => e._id);
    const [pendingLeaves, openRequests, assignedAssets] = await Promise.all([
      LeaveRequest.countDocuments({ employee: { $in: empIds }, status: { $in: ['pending_manager', 'pending_hr'] } }),
      HRRequest.countDocuments({ employee: { $in: empIds }, status: { $in: ['open', 'in_progress'] } }),
      Asset.countDocuments({ employee: { $in: empIds }, status: 'assigned' }),
    ]);
    const work = { pendingLeaves, openRequests, assignedAssets };

    // The 12 most-missing fields - the 'start here' list.
    const topRequired = groups
      .flatMap((g) => g.fields.map((f) => ({ ...f, groupAr: g.ar, groupKey: g.key })))
      .filter((f) => f.required > 0)
      .sort((a, b) => b.required - a.required)
      .slice(0, 12);

    const body = {
      totals, work, groups, topRequired, analytics: buildAnalytics(employees), alert: ALERT,
      // The condition the expiries were counted with; links carry it so the number opens its rows.
      expiryScope,
      statuses: H.STATUS_LABELS, states: H.STATE_LABELS,
    };
    // Cache TTL raised from 20s to 60s to cut repeated computation.
    cache.set(key, body, 60000);
    res.json(body);
  } catch (e) {
    console.error('hr overview', e);
    res.status(500).json({ message: 'تعذّر تحميل نظرة الموارد البشرية' });
  }
};

// Each group's page - residencies, licenses, insurance ...
/**
 * GET /records/:group?field=&status=required&state=expired&withinDays=30&sort=&dir=
 * Returns employees plus only this group's fields and each field's state, so the screen shows what is missing and lets the user fill it from the same place.
 */
exports.records = async (req, res) => {
  try {
    // The group and expiries tables had no cache at all and are the heaviest in the department: under forty concurrent users they hit 6.2 and 6.6 seconds at p95. `wrap` ensures an answer is computed once however many ask at the same moment.
    const ck = `hrm:rec:${req.params.group}:${JSON.stringify(req.query || {})}`;
    const cached = cache.get(ck);
    if (cached !== undefined) return res.json(cached);
    const g = H.getGroup(req.params.group);
    if (!g) return res.status(404).json({ message: 'المجموعة غير معروفة' });

    // iqamaNumber is always returned even if not a group field: every table in the department shows the employee next to his ID number, which people search by.
    const employees = await findEmployees(req.params.group === 'contract' ? { ...req.query, contractScope: '1' } : req.query,
      [...new Set(['employeeNumber', 'arabicName', 'firstName', 'lastName', 'iqamaNumber',
        'department', 'branchName', 'project', 'employmentStatus', 'workStatusText', 'fieldStatus', 'registerNumber',
        ...DATE_FILTERABLE, ...storedFields(g).map((f) => f.key)])].join(' '));

    const field = req.query.field || '';
    // active/inactive is an employment status, not a field state; it is applied in buildFilter and must not be read here as a nonexistent field state, which would empty the table.
    const wantStatus = legacyEmploymentStatus(req.query) ? '' : (req.query.status || '');
    const wantState = req.query.state || '';
    const withinDays = req.query.withinDays === '' || req.query.withinDays == null ? null : Number(req.query.withinDays);
    // 'Expiring within 30 days' also returned those expired a year ago, since -365 is less than 30. Expired is a different thing, so it is now an explicit choice instead of riding on this filter.
    const includeExpired = req.query.includeExpired !== '0';

    let rows = employees.map((e) => {
      const values = {};
      const statuses = {};
      for (const f of g.fields) {
        if (f.derived) continue;
        values[f.key] = H.valueOf(e, f.key) ?? null;
        statuses[f.key] = statusOf(e, f.key);
      }
      // The Hijri twin derives from the Gregorian one: its state is its source's state.
      for (const f of g.fields.filter((x) => x.type === 'hijri')) {
        values[f.key] = values[f.of] ? toHijri(values[f.of]) : null;
        statuses[f.key] = statuses[f.of];
      }
      const doc = g.document
        ? H.stateOf(e[g.expiryField], statuses[g.expiryField] === 'filled' ? '' : statuses[g.expiryField], ALERT)
        : null;
      return {
        _id: e._id,
        employeeNumber: e.employeeNumber, name: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
        iqamaNumber: H.valueOf(e, 'iqamaNumber') || '',
        department: e.department, branchName: e.branchName, project: e.project,
        // The commercial register he is on, exported beside name and identity.
        registerNumber: e.registerNumber || '',
        workStatusText: e.workStatusText, employmentStatus: e.employmentStatus,
        values, statuses,
        state: doc?.state || null, daysRemaining: doc?.days ?? null,
        // What this person is missing, by name, so the screen does not recompute it. The Hijri twin is not a second field: its gap is its source's gap, so it is not listed twice.
        missing: g.fields.filter((f) => !f.derived && statuses[f.key] === 'required').map((f) => ({ key: f.key, ar: f.ar })),
      };
    });

    const statusPass = (r) => {
      if (!wantStatus) return true;
      if (field) return r.statuses[field] === wantStatus;
      return g.fields.some((f) => r.statuses[f.key] === wantStatus);
    };
    // 'Needs attention' is a state requested by name. The strip shows expired, critical and near as one number (`needsAttention`); without a value that groups them, clicking the number cannot open its rows, so the user reads one number and opens a table with another, the origin of the complaint.
    const ATTENTION = ['expired', 'critical', 'warning'];
    const statePass = (r) => {
      if (!wantState) return true;
      return wantState === 'attention' ? ATTENTION.includes(r.state) : r.state === wantState;
    };
    if (withinDays !== null && g.document) {
      rows = rows.filter((r) => r.daysRemaining != null && r.daysRemaining <= withinDays
        && (includeExpired || r.daysRemaining >= 0));
    }
    // A counter does not filter itself. The summary used to be computed on rows after clicking a counter: clicking required 4 in contract status shrank the card to 'required 4' and hid 'not required 78' and 'entered 333', while the other cards counted the four. You could not move from one counter to its neighbor without lifting the first, and the four no longer summed to the headcount.
    // So each family of counters is computed with all filters except its own, the same rule as the filter panel values (see filterOptions): status counters are not moved by choosing a status, and expiry cards are not moved by choosing an expiry. The clicked number stays exactly the number of rows it opens.
    const forStatusCounts = rows.filter(statePass);
    const forStateCounts = rows.filter(statusPass);
    rows = forStatusCounts.filter(statusPass);

    // Order: nearest expiry first by default for documents, by name for others.
    const dir = req.query.dir === 'desc' ? -1 : 1;
    const sort = req.query.sort || (g.document ? 'daysRemaining' : 'name');
    rows.sort((a, b) => {
      const av = sort === 'daysRemaining' ? (a.daysRemaining ?? 1e9) : (a[sort] ?? a.values?.[sort] ?? '');
      const bv = sort === 'daysRemaining' ? (b.daysRemaining ?? 1e9) : (b[sort] ?? b.values?.[sort] ?? '');
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), 'ar') * dir;
    });

    // `population` is the denominator of the status counters: the sum of any field's states always equals it.
    const summary = { total: rows.length, population: forStatusCounts.length };
    for (const f of g.fields) {
      summary[f.key] = { required: 0, not_required: 0, none: 0, filled: 0 };
      for (const r of forStatusCounts) summary[f.key][r.statuses[f.key]] = (summary[f.key][r.statuses[f.key]] || 0) + 1;
    }
    if (g.document) {
      summary.states = { valid: 0, warning: 0, critical: 0, expired: 0, missing: 0, not_applicable: 0 };
      for (const r of forStateCounts) if (r.state) summary.states[r.state] += 1;
    }

    const body = {
      group: { key: g.key, ar: g.ar, en: g.en, icon: g.icon, document: !!g.document, expiryField: g.expiryField || null, fields: g.fields },
      rows: rows.slice(0, 1000),
      summary,
    };
    cache.set(ck, body, 60000);
    res.json(body);
  } catch (e) {
    console.error('hr records', e);
    res.status(500).json({ message: 'تعذّر تحميل السجلات' });
  }
};

// Master - one row per employee, with everything
/**
 * GET /master/grid?page=&limit=&sort=&dir=&...same filters
 * Why one page for all groups: department pages are split by document (residencies, passports, contracts ...), right for daily work. But 'show me this employee completely' or 'export the whole file with columns I pick' is answered by none of them, and today means opening thirteen screens and pasting results into Excel.
 * Paged: the cluster delivers about 95 KB per second, so 400 employees with all fields is eleven seconds. Fifty rows per page transfer in under half a second, and export fetches them page by page when asked, not on every open.
 */

// A master row as sent and its cell as read. The row is built here once and read by both the table and the column filter: the cell filtered on is the text drawn verbatim (see cellOf on the master page; this is its counterpart).
function gridRow(e, custodyCount, allFields) {
  const row = {
    _id: e._id,
    employeeNumber: e.employeeNumber,
    name: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
    employmentStatus: e.employmentStatus,
    custodyCount: custodyCount || 0,
    values: {},
    statuses: {},
  };
  for (const k of allFields) {
    const v = H.valueOf(e, k);
    // Empty values are not sent: 54 keys per row, mostly empty, would double the payload on a 95 KB/s link.
    if (v !== null && v !== undefined && v !== '') row.values[k] = v;
    const st = statusOf(e, k);
    // Filled is the usual state, so it is implied by silence and only the others are sent.
    if (st !== 'filled') row.statuses[k] = st;
  }
  // The Hijri twin is derived here, not in the browser. Computed on screen it would run once in web and once in the app with two libraries, and the day would differ between them. One source: utils/hijri.
  for (const f of hijriFields()) {
    const g = row.values[f.of];
    if (g) row.values[f.key] = toHijri(g);
  }
  return row;
}

/** Text of a table cell, line by line the counterpart of `cellOf` on the master page. Booleans read yes/no (and `cellMatches` accepts the English). */
function gridCell(row, key) {
  if (key === 'employeeNumber') return row.employeeNumber || '—';
  if (key === 'name') return row.name || '—';
  if (key === 'custodyCount') return row.custodyCount || 0;
  if (key === 'iqamaNumber') return row.values.iqamaNumber || row.values.nationalId || '';
  // `<date>__days`: days until the date by company day; empty stays empty, not zero.
  const days = /^(.+)__days$/.exec(key);
  if (days) {
    const d = row.values[days[1]];
    const x = d ? new Date(d) : null;
    if (!x || Number.isNaN(x.getTime())) return '';
    return require('../utils/companyDay').daysUntil(x);
  }
  // The `<date>Hijri` the screen generates when the server does not send it.
  if (row.values[key] === undefined) {
    const h = /^(.+)Hijri$/.exec(key);
    if (h && row.values[h[1]]) return toHijri(row.values[h[1]]) || '';
  }
  const v = row.values[key];
  if (v === true) return 'نعم';
  if (v === false) return 'لا';
  return v ?? '';
}
const YES_NO = { yes: 'نعم', no: 'لا' };
/** Readable cell key; the dash and '(empty)' are one thing. */
const cellKey = (row, key) => {
  const k = normKey(gridCell(row, key));
  return k === '—' ? '' : k;
};
/** Selected values as received (Arabic or English) to readable keys. */
const wantedKeys = (vals) => new Set(vals.map((v) => {
  const k = normKey(v);
  if (k === '—') return '';
  return YES_NO[k.toLowerCase()] || k;
}));
/** `cf_<column>` from the query: { column: [values] }; values are repeated params, not comma-separated. */
const gridColFilters = (q, skip = '') => {
  const out = {};
  for (const [k, raw] of Object.entries(q || {})) {
    if (!k.startsWith('cf_')) continue;
    const key = k.slice(3);
    if (!key || key === skip) continue;
    const vals = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v ?? ''));
    if (vals.length) out[key] = wantedKeys(vals);
  }
  return out;
};
const passesCols = (row, cf) => Object.entries(cf).every(([key, want]) => want.has(cellKey(row, key)));

/** Master response body: a page of rows and the column definitions. */
function gridBody(out, total, page, limit) {
  return {
    rows: out,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    // Column definitions are sent with the data: the screen does not rewrite them, and any field added in `config/hrFields` appears here with no UI change.
    // Headers come from the flattened list, not the raw groups. They used to be built from `H.GROUPS` with `f.ar` as written, which is meant for the group page where the group name sits above it: 'expiry date' is clear inside 'residencies'. Here all groups stand in one row, so 'Gregorian expiry date' appeared seven times with no way to tell which, on screen or in Excel.
    // `ALL_FIELDS` is the same list with repeated labels qualified by group name (see `qualifyDuplicateLabels` in config/hrFields) and carries the group. The group page keeps its short title and the flat table takes the qualified one, from one source.
    columns: H.ALL_FIELDS.map((f) => ({
      key: f.key, ar: f.ar, en: f.en, type: f.type, group: f.group, groupAr: f.groupAr, groupEn: f.groupEn,
      // `of` tells the screen which Gregorian date this is the Hijri twin of, so it reads the value from its source and does not convert Hijri text again.
      of: f.of || null,
      choice: !!f.choice, cashPayroll: !!f.cashPayroll,
    })),
  };
}

/** Custody count per employee: one query, not one per row. */
async function custodyCounts(ids) {
  const custody = new Map();
  if (!ids.length) return custody;
  const Asset = require('../models/Asset');
  const agg = await Asset.aggregate([
    { $match: { employee: { $in: ids }, status: 'assigned' } },
    { $group: { _id: '$employee', n: { $sum: 1 } } },
  ]);
  agg.forEach((a) => custody.set(String(a._id), a.n));
  return custody;
}

exports.grid = async (req, res) => {
  try {
    const ck = `hrm:grid:${JSON.stringify(req.query || {})}`;
    const cached = cache.get(ck);
    if (cached !== undefined) return res.json(cached);

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));

    const allFields = storedKeys();
    const select = [...new Set([
      'employeeNumber', 'arabicName', 'firstName', 'lastName', 'employmentStatus',
      'department', 'branchName', 'project', 'fieldStatus', 'employmentType', 'isFreelancer',
      ...allFields, ...DATE_FILTERABLE,
    ])].join(' ');

    // Filtering and sorting are in the database; the derived date range applies after, as in the other screens (see findEmployees).
    const filter = buildFilter(req.query);

    // Custody count is a computed column filtered here. It is not a field on the employee file but the count of his assets in the asset register, so `buildFilter` does not know it, and ticking it in the funnel was silently ignored. The requested count is turned into an employee list: those with three are exactly those, and 0 is those with no custody, the most asked.
    const custodyWanted = String(req.query.custodyCount ?? '').split(',').map((x) => x.trim()).filter((x) => x !== '');
    if (custodyWanted.length) {
      const AssetModel = require('../models/Asset');
      const byEmp = await AssetModel.aggregate([
        { $match: { employee: { $ne: null }, status: 'assigned' } },
        { $group: { _id: '$employee', n: { $sum: 1 } } },
      ]);
      const wanted = new Set(custodyWanted.map((x) => Number(x)).filter((n) => Number.isFinite(n)));
      const withCount = byEmp.filter((r) => wanted.has(r.n)).map((r) => r._id);
      if (wanted.has(0)) {
        // Zero is a negation, not a value: everyone not in the custody register.
        const held = byEmp.map((r) => r._id);
        filter.$and = [...(filter.$and || []), { $or: [{ _id: { $nin: held } }, ...(withCount.length ? [{ _id: { $in: withCount } }] : [])] }];
      } else {
        filter.$and = [...(filter.$and || []), { _id: { $in: withCount } }];
      }
    }

    const pred = dateRangePred(req.query);
    const sortKey = String(req.query.sort || 'employeeNumber');
    const dir = req.query.dir === 'desc' ? -1 : 1;

    // Column filters on displayed text. Each column's funnel used to send `<column>=<value>` and the server read only `FILTERABLE` columns, so ticking passport number, expiry date or duration in days changed no row and said nothing. Now `cf_<column>` arrives and is applied to the cell as drawn (gridCell), and the list is counted with the same function (gridOptions).
    const cf = gridColFilters(req.query);
    if (Object.keys(cf).length) {
      const all = (await Employee.find(filter).select(select).sort({ [sortKey]: dir }).lean())
        .filter((e) => !pred || pred(e));
      const custodyAll = await custodyCounts(all.map((e) => e._id));
      const built = all.map((e) => gridRow(e, custodyAll.get(String(e._id)) || 0, allFields)).filter((r) => passesCols(r, cf));
      const body = gridBody(built.slice((page - 1) * limit, page * limit), built.length, page, limit);
      cache.set(ck, body, 30000);
      return res.json(body);
    }

    let rows; let total;
    if (pred) {
      // A condition not expressible in the database: the match is read, then sliced.
      const all = await Employee.find(filter).select(select).sort({ [sortKey]: dir }).lean();
      const kept = all.filter(pred);
      total = kept.length;
      rows = kept.slice((page - 1) * limit, page * limit);
    } else {
      [rows, total] = await Promise.all([
        Employee.find(filter).select(select).sort({ [sortKey]: dir })
          .skip((page - 1) * limit).limit(limit).lean(),
        Employee.countDocuments(filter),
      ]);
    }

    // Custody count per employee on the page: one query, not one per row.
    const custody = await custodyCounts(rows.map((r) => r._id));

    const out = rows.map((e) => gridRow(e, custody.get(String(e._id)) || 0, allFields));

    const body = gridBody(out, total, page, limit);
    cache.set(ck, body, 30000);
    res.json(body);
  } catch (e) {
    console.error('hr grid', e);
    res.status(500).json({ message: 'تعذّر تحميل ماستر الموارد البشرية' });
  }
};

/**
 * GET /api/hr/master/grid/options?field=<column> - a column funnel's values with counts.
 * The screen used to pull the whole master and count values itself, then the server filtered by another rule (or not at all). Now counted by the cell the filter uses (gridCell), under the other filters except the column's own, like Excel.
 */
exports.gridOptions = async (req, res) => {
  try {
    const field = String(req.query.field || '');
    if (!field) return res.status(400).json({ message: 'field مطلوب' });
    const ck = `hrm:gridopts:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(ck);
    if (hit !== undefined) return res.json(hit);
    const allFields = storedKeys();
    const select = [...new Set([
      'employeeNumber', 'arabicName', 'firstName', 'lastName', 'employmentStatus',
      'department', 'branchName', 'project', 'fieldStatus', 'employmentType', 'isFreelancer',
      ...allFields, ...DATE_FILTERABLE,
    ])].join(' ');
    const pred = dateRangePred(req.query);
    const all = (await Employee.find(buildFilter(req.query)).select(select).lean()).filter((e) => !pred || pred(e));
    const custody = await custodyCounts(all.map((e) => e._id));
    const cf = gridColFilters(req.query, field);
    const m = new Map();
    for (const e of all) {
      const row = gridRow(e, custody.get(String(e._id)) || 0, allFields);
      if (!passesCols(row, cf)) continue;
      const k = cellKey(row, field) || '—';
      m.set(k, (m.get(k) || 0) + 1);
    }
    const body = { values: [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count) };
    cache.set(ck, body, 30000);
    res.json(body);
  } catch (e) {
    console.error('hr gridOptions', e);
    res.status(500).json({ message: 'تعذّر تحميل قيم العمود' });
  }
};

// Filling missing data from anywhere
/**
 * PATCH /employees/:id/fields { fields: { iqamaExpiry: '2027-01-01', ... } }
 * Only fields defined in config/hrFields are allowed, so the screen cannot write to a field it has no business with. The required state clears itself in the model's pre-save, so the dashboard counter drops with no extra step.
 */
/**
 * GET /api/hr/master/employees/:id/fields - all master fields for one employee.
 * The employee file showed only some (company email and mobile were missing), so data written in the master was said not to exist. Now the file shows the same groups with the same fields and states and writes through the same path (`updateFields`), so an edit here shows there immediately, and vice versa.
 */
exports.employeeFields = async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id).lean();
    if (!emp) return res.status(404).json({ message: 'الموظف غير موجود' });
    let b2cProject = false;
    try {
      const { LightTransportEmployee } = require('../models/LightTransport');
      b2cProject = !!(await LightTransportEmployee.exists({ employee: emp._id }));
    } catch (_) { /* */ }
    const seen = new Set();
    const groups = H.GROUPS.filter((g) => !g.virtual).map((g) => ({
      key: g.key, ar: g.ar, en: g.en, icon: g.icon,
      // Job category is editable for every employee; it only counts as missing in B2C and heavy transport.
      fields: g.fields.filter((f) => !seen.has(f.key) && seen.add(f.key) && (f.key === 'staffCategory' || FV.applies(emp, f.key))).map((f) => {
        const base = f.type === 'hijri' ? f.of : f.key;
        const raw = f.type === 'hijri' ? (H.valueOf(emp, base) ? toHijri(H.valueOf(emp, base)) : null) : (H.valueOf(emp, f.key) ?? null);
        return {
          ...f, value: raw, status: statusOf(emp, base),
          locked: LOCKED_FIELDS.has(f.key) || !!f.derived || !!f.readOnly,
          ...(f.key === 'project' && b2cProject ? { note: 'من سجل B2C — ويُكتب فيه' } : {}),
        };
      }),
    }));
    res.json({ groups, b2cProject });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل بيانات الموظف' }); }
};

exports.updateFields = async (req, res) => {
  try {
    const incoming = req.body.fields || {};
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ message: 'الموظف غير موجود' });

    const applied = {}; const rejected = [];
    for (const [rawKey, rawVal] of Object.entries(incoming)) {
      // Writing in Hijri writes the same date. The Hijri column is derived, not stored (see config/hrFields and utils/hijri): what arrives is converted to Gregorian and written into its twin, so someone reading in Gregorian sees a Hijri renewal at the same moment, with no sync.
      let k = rawKey; let v = rawVal;
      if (H.isHijriKey(k)) {
        const base = H.baseOfHijri(k);
        if (!H.getField(base)) { rejected.push(k); continue; }
        if (v === '' || v === null) { k = base; v = ''; } else {
          const greg = require('../utils/hijri').fromHijriString(String(v).trim());
          if (!greg) { rejected.push(`${k} (تاريخٌ هجريٌّ غير صحيح)`); continue; }
          k = base; v = greg;
        }
      }
      const f = H.getField(k);
      if (!f) { rejected.push(k); continue; }
      if (f.derived) { rejected.push(k); continue; }
      // Vehicle is a snapshot from the vehicle register, changed by authorization there, not from here.
      if (f.readOnly) { rejected.push(`${k} (يُقرأ من سجل المركبات)`); continue; }
      // Work status and system status are not written from a field; only through termination and system exit.
      if (LOCKED_FIELDS.has(k)) { rejected.push(`${k} (تتغيّر بإنهاء الخدمة أو الخروج من النظام فقط)`); continue; }
      // Department, nationality, city and project come only from their lists. See utils/hrLists.
      {
        const LISTS = require('../utils/hrLists');
        const err = await LISTS.fieldError(k, v, emp[k]) || (k === 'project' ? await LISTS.projectError(emp, v) : null)
          || (k === 'staffCategory' ? await LISTS.categoryError(incoming.department ?? emp.department, v) : null);
        if (err) return res.status(400).json({ message: err });
      }
      if (f.type === 'date') {
        if (v === '' || v === null) { emp[k] = null; applied[k] = null; continue; }
        // A Hijri year written in the Gregorian field is converted, not saved as is. '1415-06-13' there is not Gregorian 1415 but a Hijri date in the wrong field (that is how 39 employees' birth dates came from their papers). It is read as Hijri and its Gregorian written; the Hijri column shows it as written.
        if (/^1[34]\d\d-\d{1,2}-\d{1,2}$/.test(String(v).trim())) {
          const g = require('../utils/hijri').fromHijriString(String(v).trim());
          if (g) v = g;
        }
        const dt = new Date(v);
        if (isNaN(dt)) { rejected.push(k); continue; }
        // Most date fields here are **strings** in the schema in YYYY-MM-DD form (see models/Employee), and assigning a Date object to a string field stores the full `Date.toString()` output ('Fri Jan 01 2027 03:00:00 GMT+0300 (...)'). It still reads on screen but does not compare: string ordering breaks, import matching on the standard format fails, and exports show a line in another language. The fault is silent until the file is asked something that depends on the format. So write in the field's own format, and keep the Date object for what the schema defines as a real date.
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim())
          ? String(v).trim() : dt.toISOString().slice(0, 10);
        emp[k] = Employee.schema.path(k)?.instance === 'String' ? iso : dt;
        applied[k] = emp[k];
      } else if (f.type === 'bool') {
        emp[k] = v === true || v === 'true' || v === '1'; applied[k] = emp[k];
      } else if (f.type === 'number') {
        // The amount is a number in the schema: Arabic digits are read, separators dropped, and empty becomes zero (the schema default, read as blank; see numberField in config/hrFields).
        const txt = String(v ?? '').trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[,،\s]/g, '');
        const n = txt === '' ? 0 : Number(txt);
        if (!Number.isFinite(n)) { rejected.push(`${k} (رقمٌ غير صحيح)`); continue; }
        emp[k] = n; applied[k] = n;
      } else {
        // Written to the column matching the identity type; otherwise a Saudi's number goes into the residency field, which the master reads and the employee file does not.
        const target = H.writeKeyOf(emp, k);
        emp[target] = String(v ?? '').trim(); applied[k] = emp[target];
      }
    }
    if (!Object.keys(applied).length) {
      return res.status(400).json({ message: rejected.length ? `حقول غير معروفة: ${rejected.join(', ')}` : 'لم تُرسل أي حقول' });
    }

    // Changing the type carries the contract data with it. Someone not on our sponsorship has no contract with us, so his contract data is not required rather than missing. The rule is applied on the server, not the screen, so it holds whether the type changes from the master or the employee file; conversely, someone moved onto sponsorship gets his contract data required again.
    if (Object.prototype.hasOwnProperty.call(applied, 'employmentType')) {
      const { applyEmploymentType } = require('../utils/employmentType');
      const set = applyEmploymentType(applied.employmentType);
      emp.isFreelancer = set.isFreelancer;
      for (const [key, val] of Object.entries(set)) {
        if (!key.startsWith('fieldStatus.')) continue;
        const sk = key.slice('fieldStatus.'.length);
        if (val) emp.fieldStatus.set(sk, val);
        else emp.fieldStatus.delete(sk);
      }
      applied.isFreelancer = emp.isFreelancer;
    }

    // Not-required is an administrative decision; if the user marks a field that way, record it explicitly.
    for (const [k, code] of Object.entries(req.body.markStatus || {})) {
      if (!H.getField(k)) continue;
      if (code === 'clear') emp.fieldStatus.delete(H.statusKeyOf(k));
      else if (['required', 'not_required', 'none', 'inactive'].includes(code)) emp.fieldStatus.set(H.statusKeyOf(k), code);
    }

    await emp.save();   // pre-save clears required from any field that got filled.
    // A B2C employee's project is also written to the B2C record. See utils/hrLists.
    if (applied.project !== undefined) await require('../utils/hrLists').projectToB2C(emp, emp.project).catch(() => {});
    // Moving to the B2C department from the master adds him to the department register, as from his file (hrController). The master alone did not, leaving him in B2C by HR with no row in the department.
    if (applied.department !== undefined) {
      const { syncEmployeeToLightTransport } = require('../utils/lightTransportSync');
      if (await syncEmployeeToLightTransport(emp, req.user)) {
        try { require('../utils/ttlCache').clear('lt:'); require('../websocket/socketManager').emitToAll('lt:updated', {}); } catch (_) { /* */ }
      }
    }

    // The driver card is written to the vehicle register, which is the reference; edits here go there and the snapshot comes back from it.
    if (['driverCardNumber', 'driverCardExpiry', 'driverCardType'].some((k) => k in applied)) {
      try { await require('../utils/driverCardSync').pushEmployeeToCard(emp, { userId: req.user?._id, emit: false }); } catch (e) { console.error('HR → driver card:', e.message); }
    }

    logAudit({
      user: req.user, action: 'update_employee_fields', entity: 'Employee', entityId: emp._id,
      changes: { after: applied }, ipAddress: req.ip,
    }).catch(() => {});

    emit();
    const fresh = await Employee.findById(emp._id).lean();
    const statuses = {};
    for (const k of Object.keys(applied)) statuses[k] = statusOf(fresh, k);
    res.json({ employee: { _id: fresh._id, ...applied }, statuses, rejected });
  } catch (e) {
    if (e.name === 'ValidationError') {
      const first = Object.values(e.errors || {})[0];
      return res.status(400).json({ message: first?.message || 'بيانات غير صالحة' });
    }
    console.error('hr updateFields', e);
    res.status(500).json({ message: 'تعذّر حفظ البيانات' });
  }
};

// Expiries across all documents
/** Counts do not move under the one clicking. Document counts (residencies 183, passports 7 ...) used to be computed after applying the chosen document and state: clicking residencies zeroed the rest, and clicking critical changed the document counts, with buttons jumping because their width follows their numbers. So each group of numbers is computed without its own filter (faceted counts): - document counts: by period and filters, without document or state. - state cards: by period, filters and document, without state; their sum equals the chosen document's number above. - table: everything. Filter lists (register, department, project ...) are built from the employees themselves with the number of documents per value in the period, so no value opens an empty table without reason. */
const EXPIRY_FACETS = ['registerNumber', 'department', 'project', 'nationality', 'branchName'];
exports.expiring = async (req, res) => {
  try {
    const ck = `hrm:exp:${JSON.stringify(req.query || {})}`;
    const cached = cache.get(ck);
    if (cached !== undefined) return res.json(cached);
    const withinDays = req.query.withinDays === '' || req.query.withinDays == null ? null : Math.max(0, Number(req.query.withinDays) || 0);
    const wanted = (req.query.doc || '').split(',').map((x) => x.trim()).filter(Boolean);
    const includeExpired = req.query.includeExpired !== '0';
    const wantState = req.query.state || '';
    const multi = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    // Page filters are applied here in memory (so their lists are computed without them); everything else (the overview filter carried in the link) goes to the query as before.
    const facetWant = Object.fromEntries(EXPIRY_FACETS.map((k) => [k, multi(req.query[k])]));
    const engWant = String(req.query.engagement || '');
    // Working / not working, where not working is termination as everywhere in the department.
    const workWant = ['working', 'notWorking'].includes(req.query.workState) ? req.query.workState : '';
    const needle = String(req.query.q || '').trim().toLowerCase();
    const baseQuery = { ...req.query };
    for (const k of [...EXPIRY_FACETS, 'engagement', 'workState', 'q']) delete baseQuery[k];

    // The same scope the strip number was counted with. See EXPIRY_SCOPE.
    const scope = expiryScopeOf(req.query);
    const employees = await findEmployees({ ...baseQuery, ...scope },
      [...new Set(['employeeNumber', 'arabicName', 'firstName', 'lastName', 'iqamaNumber', 'nationalId', 'idType',
        'department', 'branchName', 'project', 'nationality', 'registerNumber', 'fieldStatus', 'isFreelancer',
        'employmentType', 'employmentStatus', ...DATE_FILTERABLE,
        ...H.DOCUMENT_GROUPS.map((g) => g.expiryField)])].join(' '));

    const workOf = (e) => (e.employmentStatus === 'terminated' ? 'notWorking' : 'working');
    const blankKey = (v) => (String(v ?? '').trim() || '—');
    const engOf = (e) => { try { return ENG.engagementOf(e) || 'none'; } catch (_) { return 'none'; } };
    const passes = (e, skip) => {
      for (const k of EXPIRY_FACETS) {
        if (k === skip || !facetWant[k].length) continue;
        if (!facetWant[k].includes(blankKey(e[k]))) return false;
      }
      if (skip !== 'engagement' && engWant && engOf(e) !== engWant) return false;
      if (skip !== 'workState' && workWant && workOf(e) !== workWant) return false;
      if (needle) {
        const hay = `${e.arabicName || ''} ${e.firstName || ''} ${e.lastName || ''} ${e.employeeNumber || ''} ${H.valueOf(e, 'iqamaNumber') || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    };

    // Every document in the period per employee, before document and state.
    const all = [];
    for (const e of employees) {
      for (const g of H.DOCUMENT_GROUPS) {
        const stCode = statusOf(e, g.expiryField);
        const st = H.stateOf(e[g.expiryField], stCode === 'filled' ? '' : stCode, ALERT);
        if (st.state === 'not_applicable' || st.state === 'missing') continue;
        if (!includeExpired && st.state === 'expired') continue;
        if (withinDays !== null && st.days > withinDays) continue;
        all.push({ e, g, st });
      }
    }
    const stateOk = (st) => (wantState === 'attention' ? ['expired', 'critical', 'warning'].includes(st) : (!wantState || st === wantState));
    const docOk = (g) => !wanted.length || wanted.includes(g.key);

    const inFilters = all.filter((x) => passes(x.e));
    const byDocCount = {};
    for (const x of inFilters) byDocCount[x.g.key] = (byDocCount[x.g.key] || 0) + 1;
    const summary = { total: 0, expired: 0, critical: 0, warning: 0, valid: 0 };
    for (const x of inFilters) if (docOk(x.g)) { summary[x.st.state] = (summary[x.st.state] || 0) + 1; summary.total += 1; }

    const rows = inFilters.filter((x) => docOk(x.g) && stateOk(x.st.state)).map(({ e, g, st }) => ({
      employeeId: e._id, employeeNumber: e.employeeNumber,
      name: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
      iqamaNumber: H.valueOf(e, 'iqamaNumber') || '',
      department: e.department, branchName: e.branchName, project: e.project || '', registerNumber: e.registerNumber || '',
      docKey: g.key, docAr: g.ar, docEn: g.en, expiryField: g.expiryField,
      expiryDate: e[g.expiryField], daysRemaining: st.days, state: st.state,
    }));
    rows.sort((a, b) => (a.daysRemaining ?? 1e9) - (b.daysRemaining ?? 1e9));

    // Filter lists: each value with its document count (the chosen document and state are applied).
    const options = {};
    for (const k of [...EXPIRY_FACETS, 'engagement', 'workState']) {
      const counts = new Map();
      for (const x of all) {
        if (!docOk(x.g) || !stateOk(x.st.state) || !passes(x.e, k)) continue;
        const v = k === 'engagement' ? engOf(x.e) : k === 'workState' ? workOf(x.e) : blankKey(x.e[k]);
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      options[k] = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'ar'))
        .map(([value, count]) => ({ value, count }));
    }

    const body = {
      rows: rows.slice(0, 3000), shown: rows.length, summary,
      byDoc: H.DOCUMENT_GROUPS.map((g) => ({ key: g.key, ar: g.ar, en: g.en, count: byDocCount[g.key] || 0 })),
      options,
      withinDays,
      alert: ALERT, expiryScope: scope,
    };
    cache.set(ck, body, 60000);
    res.json(body);
  } catch (e) {
    console.error('hr expiring', e);
    res.status(500).json({ message: 'تعذّر تحميل الانتهاءات' });
  }
};

/** Group and field definitions; the UI builds pages and filters from them. */
/**
 * GET /master/choices - the values of each choice field as used in the file.
 * License type, bank and insurance state were free text, so one bank was written five ways (Rajhi variants) and the filter became five values for one thing. The list is built from values actually present (no invented vocabulary), ordered by most used, and the writer can still add a new value.
 */
exports.choices = async (req, res) => {
  try {
    const body = await cache.wrap('hrm:choices', 60000, async () => {
      const fields = H.ALL_FIELDS.filter((f) => f.choice);
      const rows = await Employee.find({ isHrRecord: { $ne: false } }).select(fields.map((f) => f.key).join(' ')).lean();
      const out = {};
      for (const f of fields) {
        const counts = new Map();
        for (const r of rows) {
          const v = String(r[f.key] ?? '').trim();
          if (!v || /^(مطلوب|غير مطلوب|لا يوجد|لايوجد|-|—)$/.test(v)) continue;
          counts.set(v, (counts.get(v) || 0) + 1);
        }
        out[f.key] = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
        // The closed lists (department, nationality, city, project) come from their own rows in their order, not from what was written in files. See utils/hrLists.
        if (f.strict) {
          const names = await require('../utils/hrLists').optionsFor(f.key);
          out[f.key] = names.map((value) => ({ value, count: counts.get(value) || 0 }));
        }
      }
      return { choices: out };
    });
    res.json(body);
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل القوائم' }); }
};

exports.fieldConfig = (req, res) => {
  res.json({
    groups: H.GROUPS.map((g) => ({
      key: g.key, ar: g.ar, en: g.en, icon: g.icon,
      document: !!g.document, expiryField: g.expiryField || null, fields: g.fields,
    })),
    statuses: H.STATUS_LABELS, states: H.STATE_LABELS, alert: ALERT,
  });
};

// Renewal, single and bulk
// Why it is here: the document pages (residencies, passports, contracts, medical insurance, health certificates, driver cards, driving licenses) had no renewal. The only way was to open the expiry date and overwrite it, losing who renewed, when and from which date to which, the first thing asked in any audit.
// Bulk renewal is not a luxury: dozens of residencies renew at once with the same date, and doing them row by row means dozens of windows and the chance of missing one in the middle.
const EmployeeRenewal = require('../models/EmployeeRenewal');
const { _RENEWAL_FIELDS: RENEWAL_FIELDS, _GROUP_DOC_TYPE: GROUP_DOC_TYPE } = require('./hrController');

/** A valid date in YYYY-MM-DD form, or null. */
const asIsoDay = (v) => {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : s;
};

/**
 * Renewal date, written in Gregorian or Hijri.
 * The stored value is always one Gregorian (see utils/hijri), so a sent `newExpiryHijri` is converted here, with no second database field and no sync.
 * The year separates them unambiguously: Hijri is now 1448 and Gregorian 2026, so even a Hijri date written in the Gregorian field would not read as a plausible date. Still it is not guessed: the field the user sent is the one read.
 */
const renewalDay = (body, prefix = 'newExpiry') => {
  const hijri = String(body?.[`${prefix}Hijri`] ?? '').trim();
  if (hijri) {
    const greg = require('../utils/hijri').fromHijriString(hijri);
    return greg ? asIsoDay(greg) : null;
  }
  return asIsoDay(body?.[prefix]);
};

/** Group or document type to field map. Accepts both names, so the caller does not matter. */
const renewalMapOf = (docTypeOrGroup) => {
  const key = GROUP_DOC_TYPE[docTypeOrGroup] || docTypeOrGroup;
  const map = RENEWAL_FIELDS[key];
  return map && map.expiry ? { key, map } : null;
};

/**
 * POST /master/renew
 * { employee, docType|group, newExpiry, documentNumber?, notes? }
 */
exports.renew = async (req, res) => {
  try {
    const resolved = renewalMapOf(req.body.docType || req.body.group);
    if (!resolved) return res.status(400).json({ message: 'نوع المستند غير معروف' });
    const newExpiry = renewalDay(req.body);
    if (!newExpiry) {
      return res.status(400).json({
        message: req.body?.newExpiryHijri ? 'التاريخُ الهجريُّ غير صحيح' : 'أدخل تاريخ الانتهاء الجديد',
      });
    }

    const emp = await Employee.findById(req.body.employee);
    if (!emp) return res.status(404).json({ message: 'الموظف غير موجود' });

    const { key, map } = resolved;
    const previousExpiry = emp[map.expiry] || '';
    emp[map.expiry] = newExpiry;
    const docNum = String(req.body.documentNumber ?? '').trim();
    if (map.number && docNum) emp[map.number] = docNum;
    await emp.save();
    // A driver card renewed from HR is also written to the vehicle register.
    if (resolved?.key === 'driverCard' || /driverCard/.test(String(resolved?.expiry || ''))) {
      try { await require('../utils/driverCardSync').pushEmployeeToCard(emp, { userId: req.user?._id, emit: false }); } catch (e) { console.error('HR renew → driver card:', e.message); }
    }

    const renewal = await EmployeeRenewal.create({
      employee: emp._id, docType: key,
      previousExpiry, newExpiry, documentNumber: docNum,
      notes: String(req.body.notes ?? '').trim(),
      renewedBy: req.user._id, renewedAt: new Date(),
    });

    logAudit({
      user: req.user._id, action: 'renew_document', entity: 'Employee', entityId: emp._id,
      changes: { before: { docType: key, expiry: previousExpiry }, after: { expiry: newExpiry, documentNumber: docNum } },
      ipAddress: req.ip,
    }).catch(() => {});
    emit();
    res.status(201).json({ employee: { _id: emp._id, [map.expiry]: newExpiry }, renewal });
  } catch (e) {
    console.error('hr renew', e);
    res.status(500).json({ message: 'تعذّر تسجيل التجديد' });
  }
};

/**
 * POST /master/renew-bulk
 * { items: [{ employee, docType|group }], newExpiry, notes? }
 * All or nothing. If one row fails validation no row is written, because a partial renewal is worse than a failure: the batch seems done while some are not renewed and nobody says which.
 */
exports.renewBulk = async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ message: 'اختر مستندًا واحدًا على الأقل' });
    if (items.length > 500) return res.status(400).json({ message: 'أقصى ٥٠٠ سطر في المرة الواحدة' });

    const sharedExpiry = renewalDay(req.body);
    const notes = String(req.body.notes ?? '').trim();

    // 1. Validate every line before writing any.
    const errors = [];
    const plan = [];
    const ids = [...new Set(items.map((r) => String(r.employee || r.id || '')).filter(Boolean))];
    const found = await Employee.find({ _id: { $in: ids } });
    const byId = new Map(found.map((e) => [String(e._id), e]));

    items.forEach((row, i) => {
      const line = i + 1;
      const resolved = renewalMapOf(row.docType || row.group);
      if (!resolved) return errors.push({ line, message: 'نوع المستند غير معروف' });
      const newExpiry = renewalDay(row) || sharedExpiry;
      if (!newExpiry) return errors.push({ line, message: 'تاريخ الانتهاء الجديد ناقص أو غير صالح' });
      const emp = byId.get(String(row.employee || row.id || ''));
      if (!emp) return errors.push({ line, message: 'الموظف غير موجود' });
      plan.push({ emp, key: resolved.key, map: resolved.map, newExpiry, documentNumber: String(row.documentNumber ?? '').trim() });
    });

    if (errors.length) {
      return res.status(400).json({ message: 'رُفضت العملية كاملةً — لم يُجدَّد أي مستند', errors });
    }

    // 2. Write.
    const renewed = [];
    const history = [];
    for (const p of plan) {
      const previousExpiry = p.emp[p.map.expiry] || '';
      p.emp[p.map.expiry] = p.newExpiry;
      if (p.map.number && p.documentNumber) p.emp[p.map.number] = p.documentNumber;
      await p.emp.save();
      if (/driverCard/.test(JSON.stringify(p.resolved || p.map || {}))) {
        try { await require('../utils/driverCardSync').pushEmployeeToCard(p.emp, { userId: req.user?._id, emit: false }); } catch (e) { console.error('HR bulk renew → driver card:', e.message); }
      }
      history.push({
        employee: p.emp._id, docType: p.key,
        previousExpiry, newExpiry: p.newExpiry, documentNumber: p.documentNumber,
        notes, renewedBy: req.user._id, renewedAt: new Date(),
      });
      renewed.push({
        employee: p.emp._id,
        name: p.emp.arabicName || `${p.emp.firstName || ''} ${p.emp.lastName || ''}`.trim(),
        docType: p.key, previousExpiry, newExpiry: p.newExpiry,
      });
    }
    if (history.length) await EmployeeRenewal.insertMany(history);

    logAudit({
      user: req.user._id, action: 'renew_documents_bulk', entity: 'Employee',
      changes: { after: { count: renewed.length, newExpiry: sharedExpiry } }, ipAddress: req.ip,
    }).catch(() => {});
    emit();

    res.json({
      renewed,
      summary: { count: renewed.length, employees: new Set(renewed.map((r) => String(r.employee))).size },
    });
  } catch (e) {
    console.error('hr renewBulk', e);
    res.status(500).json({ message: 'تعذّر تسجيل التجديد الجماعي' });
  }
};

// Analysis by department

/**
 * GET /master/by-department - one row per department with all its numbers.
 * Why a table, not only a filter: the dashboard filtered by department says everything about one department, but the HR head's question is not how operations is doing but which departments are worst, which needs all departments side by side on one screen; otherwise the dashboard is opened twenty times with twenty filters and the result written on paper.
 * Per department: headcount (on duty / ended), missing fields, expired and near documents, contracts, current leaves and custody. Counting is in the database in two queries, not transferring 400 employees to count in the node (see the comment in `overview` for why).
 * Each number has a ready filter: the screen opens its rows with the same department, so no number is read whose sheet is not seen.
 */
exports.byDepartment = async (req, res) => {
  try {
    // The table is not filtered by its own department. Clicking a department name restricts the dashboard to it, which used to shrink the table itself to one row and hide every other department, and switching required lifting the first. So it counts with all filters except department (faceted counts, like `expiring`): all departments remain, the chosen one is marked, and its number is the dashboard's.
    const { department: _ownFacet, ...facetQuery } = req.query || {};
    const key = `hrm:bydept:${JSON.stringify(facetQuery)}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const match = await matchFor(facetQuery);
    const allKeys = storedKeys();
    // Missing is read with the same rule the dashboard reads. `statusExpr` is the field-state definition in the database (see utils/hrCounts): required is an empty field not marked not-required. A second condition with its meaning written here would one day differ from the dashboard cards with no one knowing why.
    const { statusExpr } = require('../utils/hrCounts');

    const missingExpr = {
      $add: allKeys.map((k) => ({ $cond: [{ $eq: [statusExpr(k), 'required'] }, 1, 0] })),
    };

    // Expired documents are counted by the dashboard rule too. Seven of the eight expiry fields are strings, not dates, and some cannot be read as dates at all ('Fri Sep 03 2027 03:00:00 GMT+0300...'), so `$toDate` would fail the whole query at the first one. The rule in `docStateCounts` converts with `$convert` and `onError: null`: what cannot be read as a date counts as missing. So it is read here letter for letter.
    const docGroups = H.GROUPS.filter((g) => g.document && g.expiryField);
    const docDays = (g) => ({
      $let: {
        vars: { dd: { $convert: { input: `$${g.expiryField}`, to: 'date', onError: null, onNull: null } } },
        in: { $cond: [{ $eq: ['$$dd', null] }, null, { $dateDiff: { startDate: '$$NOW', endDate: '$$dd', unit: 'day' } }] },
      },
    });
    // Expired is a past date, near is under the alert threshold; a document not required of its holder is not counted (a Saudi with no residency is not expired).
    const applicable = (g) => ({ $not: [{ $in: [statusExpr(g.expiryField), ['not_required', 'none']] }] });
    const expiredExpr = {
      $add: docGroups.map((g) => ({
        $cond: [{ $and: [applicable(g), { $lt: [docDays(g), 0] }] }, 1, 0],
      })),
    };
    const soonExpr = {
      $add: docGroups.map((g) => ({
        $cond: [{
          $and: [applicable(g), { $gte: [docDays(g), 0] }, { $lte: [docDays(g), ALERT.warnDays] }],
        }, 1, 0],
      })),
    };

    const rows = await Employee.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $ifNull: ['$department', ''] },
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$employmentStatus', 'active'] }, 1, 0] } },
          ended: { $sum: { $cond: [{ $eq: ['$employmentStatus', 'active'] }, 0, 1] } },
          saudi: { $sum: { $cond: [{ $eq: ['$nationality', 'سعودي'] }, 1, 0] } },
          outside: { $sum: { $cond: ['$isOutsideKingdom', 1, 0] } },
          freelancers: { $sum: { $cond: ['$isFreelancer', 1, 0] } },
          missing: { $sum: missingExpr },
          peopleWithMissing: { $sum: { $cond: [{ $gt: [missingExpr, 0] }, 1, 0] } },
          docsExpired: { $sum: expiredExpr },
          docsSoon: { $sum: soonExpr },
          salary: { $sum: { $ifNull: ['$basicSalary', 0] } },
        },
      },
      { $sort: { total: -1 } },
    ]).allowDiskUse(true);

    // Leaves, custody and contracts live in other collections, so they are counted there and joined by department, not read per department.
    const Asset = require('../models/Asset');
    const LeaveRequest = require('../models/LeaveRequest');
    const Contract = require('../models/Contract');
    const deptOf = new Map((await Employee.find(match).select('department').lean())
      .map((e) => [String(e._id), e.department || '']));

    const tallyBy = (docs, pick) => {
      const m = new Map();
      for (const d of docs) {
        const dep = deptOf.get(String(pick(d)));
        if (dep === undefined) continue;        // Employee outside the current filter.
        m.set(dep, (m.get(dep) || 0) + 1);
      }
      return m;
    };
    const [assets, leaves, contracts] = await Promise.all([
      Asset.find({ status: 'assigned' }).select('employee').lean().catch(() => []),
      LeaveRequest.find({ status: { $in: ['pending', 'approved'] } }).select('employee status').lean().catch(() => []),
      Contract.find({ status: 'active' }).select('employee').lean().catch(() => []),
    ]);
    const custodyBy = tallyBy(assets, (a) => a.employee);
    const leavePendingBy = tallyBy(leaves.filter((l) => l.status === 'pending'), (l) => l.employee);
    const leaveApprovedBy = tallyBy(leaves.filter((l) => l.status === 'approved'), (l) => l.employee);
    const contractsBy = tallyBy(contracts, (c) => c.employee);

    const departments = rows.map((r) => ({
      department: r._id || '',
      total: r.total,
      active: r.active,
      ended: r.ended,
      saudi: r.saudi,
      outside: r.outside,
      freelancers: r.freelancers,
      missing: r.missing,
      peopleWithMissing: r.peopleWithMissing,
      // Completeness is the share of all the department's fields that are filled: one number that compares departments with each other whatever their sizes.
      completeness: r.total && allKeys.length
        ? Math.round((1 - r.missing / (r.total * allKeys.length)) * 1000) / 10
        : 100,
      docsExpired: r.docsExpired,
      docsSoon: r.docsSoon,
      contracts: contractsBy.get(r._id || '') || 0,
      custody: custodyBy.get(r._id || '') || 0,
      leavesPending: leavePendingBy.get(r._id || '') || 0,
      leavesApproved: leaveApprovedBy.get(r._id || '') || 0,
      salary: Math.round(r.salary),
    }));

    const body = {
      departments,
      fieldsPerEmployee: allKeys.length,
      totals: departments.reduce((s, d) => ({
        total: s.total + d.total, active: s.active + d.active, ended: s.ended + d.ended,
        missing: s.missing + d.missing, docsExpired: s.docsExpired + d.docsExpired,
        docsSoon: s.docsSoon + d.docsSoon, custody: s.custody + d.custody,
        leavesPending: s.leavesPending + d.leavesPending, leavesApproved: s.leavesApproved + d.leavesApproved,
        contracts: s.contracts + d.contracts, salary: s.salary + d.salary,
      }), { total: 0, active: 0, ended: 0, missing: 0, docsExpired: 0, docsSoon: 0, custody: 0, leavesPending: 0, leavesApproved: 0, contracts: 0, salary: 0 }),
    };
    cache.set(key, body, 20000);
    res.json(body);
  } catch (e) {
    console.error('hr byDepartment', e);
    res.status(500).json({ message: 'تعذّر تحميل تحليل الأقسام' });
  }
};
