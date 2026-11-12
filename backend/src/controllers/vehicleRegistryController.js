const { VehicleMaster, VehicleRegistryConfig, CorporatePolicy, VehicleInsurancePolicy } = require('../models/VehicleMaster');
const { sendMongooseError, stripEmpty } = require('../utils/mongooseError');
const { startOfDay, endOfDay } = require('../utils/companyDay');
const VehicleClaim = require('../models/VehicleClaim');
const VDOC = require('../config/vehicleDocuments');
const logAudit = require('../utils/auditLogger');
const cache = require('../utils/ttlCache');
const { emitToAll } = require('../websocket/socketManager');
// Key of the vehicle registry (letters plus digits), not the digits-only key used by heavy transport. Digits alone collide here: a motorbike plate and a trailer plate can share the same number and would attach the bike's accident to the trailer. See utils/plateKey.
const { registryPlateKey: plateKey, flexSpaceRegex } = require('../utils/plateKey');
const { endedStaff, idNumberEnded, employeeEnded, employeeArchived, idNumberArchived } = require('../utils/endedStaff');
// A driver card whose HR service ended: matched by file reference if linked, otherwise by ID number. It stays listed but is not counted in any number, fuel card or expiry.
const cardEnded = (sets, c) => (c.employee ? employeeEnded(sets, c.employee) : idNumberEnded(sets, c.idNumber));
// An archived person is stricter: the card is not shown as a row at all, as if deleted.
const cardArchived = (sets, c) => (c.employee ? employeeArchived(sets, c.employee) : idNumberArchived(sets, c.idNumber));
// Is the person authorized on the vehicle paper archived? Matched by residency number, since the paper holds no file reference.
const holderArchived = (sets, v) => idNumberArchived(sets, v?.authorizedPerson?.iqamaNumber);

/**
 * Every change in the section broadcasts and invalidates the cache, including the report.
 * The vehicle report is cached for an hour when its period is closed, which is right for period figures, but it also carries today's document state (valid insurance, license expiring). A user who renews a document and then prints would get the stale paper, which goes to an outside party.
 * So the vehicle report is cleared on every write in the section (all eleven operations pass through here); caching still helps repeated opens with no edit between. See utils/ttlCache: invalidation also reaches the other worker.
 */
/**
 * The two sections hear each other.
 * Light transport vehicles are read by two sections: this registry and the individuals section (b2c), which is the light transport section. Authorization can be transferred from either, and the sector is written here so the vehicle becomes theirs.
 * Every change here is announced to both: clear their caches, then emit their event. Invalidate before announcing, otherwise the refetch reads pre-edit state. Transferring authorization from there does the same (see `emitBoth`).
 */
// The cache-key list lives in one shared place.
// There were five prefixes here and different lists in other write paths, so the fleet was cleared from here but not the old vehicles, and the reverse elsewhere. The list and the announcement are now in utils/vehicleAnnounce, which every vehicle write path uses.
const { announceVehicles } = require('../utils/vehicleAnnounce');
const emit = (event, payload = {}) => {
  if (event === 'vreg:updated') return announceVehicles(payload);
  announceVehicles({});
  try { emitToAll(event, payload); } catch (e) {}
};

// Documents that have an expiry date: key to date path and name.
// Single document definition in config/vehicleDocuments.js. A second copy here computed state without knowing 'not required', so a vehicle that needs no inspection counted as missing one.
const DOC_TYPES = VDOC.DOCUMENTS;

const DAY = 86400000;
const daysUntil = (date) => (date ? Math.floor((new Date(date).getTime() - Date.now()) / DAY) : null);
const getPath = (obj, path) => path.split('.').reduce((c, p) => (c == null ? c : c[p]), obj);

const { textIn, mergeOptions, normKey } = require('../utils/colFilter');
const _multi = (v) => (v == null ? [] : (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean));

// Cached: a findOneAndUpdate (write) on every request was slow on the throttled Atlas cluster.
const getConfig = async () => {
  const hit = cache.get('vreg:config');
  if (hit !== undefined) return hit;
  const cfg = await VehicleRegistryConfig.findOneAndUpdate(
    { key: 'vehicle-registry' }, { $setOnInsert: { key: 'vehicle-registry' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  cache.set('vreg:config', cfg, 60000);
  ALERTS = (cfg && cfg.alerts) || {};
  return cfg;
};
// Alert thresholds as the filters read them.
// 'Nearing expiry' in the filter equals 'nearing expiry' in the dashboard cards: critical or warning by each document's threshold from section settings (`VDOC.stateOf`), not a hard-coded 30 days. `buildFilter` is synchronous, so it reads the last settings loaded; every endpoint that uses it calls `getConfig` first.
let ALERTS = {};

// Document state against its threshold: expired / critical(<=30) / warning(<=warnDays) / valid / none.
// Thin wrapper around VDOC.stateOf so older code keeps the same response shape.
const docStatus = (date, alert, statusCode = '') => {
  const { state, days } = VDOC.stateOf(date, statusCode, alert || {});
  return { status: state === 'not_applicable' ? 'not_required' : state === 'missing' ? 'none' : state, days };
};

// 'Has a tracking device': one definition, not three.
// The filter and the card asked about `gps.deviceId`, which no import fills (devices arrive as serial number, model and provider), so the card showed zero while 240 vehicles had devices.
const HAS_GPS = { $or: [
  { 'gps.serialImei': { $nin: [null, ''] } },
  { 'gps.deviceModel': { $nin: [null, ''] } },
  { 'gps.deviceId': { $nin: [null, ''] } },
] };
const hasGps = (v) => !!(v?.gps?.serialImei || v?.gps?.deviceModel || v?.gps?.deviceId);

// Derived filters: what is not a table column but is asked every day.
/**
 * The filters above ask for a value stored in a field (city = Jeddah). These ask what is not stored in any field: which vehicles' insurance ends within a month, how many have no tracker, which have a premium above 5000.
 * These are management questions; answering them by exporting to Excel and sorting gave different numbers per person.
 * Each bucket carries its condition twice on purpose: `cond()` is the Mongo condition that opens its rows in the list, and `test()` is the same condition run in memory to compute the count next to it. Both derive from one definition so the displayed count never diverges from the rows it opens.
 * `cond` is a function, not an object, because the 'within 30 days' bounds are computed from today; built once at boot they would freeze at the start date.
 */
const dayStart = (n = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const _blank = (x) => x === null || x === undefined || x === '';

// Expiry horizon: same cuts for every document. Bounds are adjacent, not overlapping: 'expired' ends yesterday and 'within 30' starts today, otherwise a document expiring today is counted in both and the bucket sum exceeds the vehicle count.
const HORIZON_BANDS = [
  { value: 'منتهٍ', en: 'Expired', hi: -1 },
  { value: 'خلال ٣٠ يومًا', en: 'Within 30 days', lo: 0, hi: 30 },
  { value: '٣١ إلى ٦٠ يومًا', en: '31–60 days', lo: 31, hi: 60 },
  { value: '٦١ إلى ٩٠ يومًا', en: '61–90 days', lo: 61, hi: 90 },
  { value: 'أبعد من ٩٠ يومًا', en: 'Beyond 90 days', lo: 91 },
  // 'No date' is not a date out of range: no range matches it, so it needs its own bucket.
  { value: 'بلا تاريخ مسجَّل', en: 'No date on file', none: true },
];
const horizonOptions = (path) => HORIZON_BANDS.map((b) => ({
  value: b.value, en: b.en,
  cond: () => (b.none
    ? { $or: [{ [path]: null }, { [path]: { $exists: false } }] }
    : { [path]: Object.assign({ $ne: null },
      b.lo != null ? { $gte: dayStart(b.lo) } : {},
      b.hi != null ? { $lt: dayStart(b.hi + 1) } : {}) }),
  test: (v) => {
    const raw = getPath(v, path);
    if (b.none) return !raw;
    if (!raw) return false;
    const d = VDOC.daysLeft(raw);
    return (b.lo == null || d >= b.lo) && (b.hi == null || d <= b.hi);
  },
}));

// Numeric buckets (insurance premium, consumption cap, accident count, model year).
const numberOptions = (path, bands) => bands.map((b) => ({
  value: b.value, en: b.en,
  cond: () => (b.none
    ? { $or: [{ [path]: null }, { [path]: '' }, { [path]: { $exists: false } }] }
    : { [path]: Object.assign({ $ne: null },
      b.lo != null ? { $gte: b.lo } : {}, b.hi != null ? { $lte: b.hi } : {}) }),
  test: (v) => {
    const n = getPath(v, path);
    if (b.none) return _blank(n);
    if (_blank(n)) return false;
    const x = Number(n);
    return !Number.isNaN(x) && (b.lo == null || x >= b.lo) && (b.hi == null || x <= b.hi);
  },
}));

/** Yes/no question: the two buckets are always complementary, so together they cover all vehicles. */
const yesNo = (yes, no, cond, test) => ([
  { value: yes.ar, en: yes.en, cond: () => cond(), test },
  { value: no.ar, en: no.en, cond: () => ({ $nor: [cond()] }), test: (v) => !test(v) },
]);

const HAS_FUEL_CARD = () => ({ 'fuelCard.cardNumber': { $nin: [null, ''] } });
const HAS_AUTH = () => ({ $or: [
  { 'authorizedPerson.name': { $nin: [null, ''] } },
  { 'authorizedPerson.authorizationNumber': { $nin: [null, ''] } },
] });

// Document state uses the same rule as the cards.
// The filter and the dashboard number are one answer, so expired and nearing are computed as `VDOC.stateOf` does for the document cards: 'not required' never expires whatever its date, and 'nearing' is critical or warning by the document's threshold from settings.
const NOT_REQ_CODE = (dt) => ({ [dt.statusPath]: { $ne: 'not_required' } });
const dueDays = (key) => {
  const a = ALERTS[key] || {};
  return Math.max(Number(a.warnDays ?? 30), Number(a.criticalDays ?? 7));
};
const docExpiredC = (dt) => ({ $and: [{ [dt.path]: { $ne: null, $lt: dayStart(0) } }, NOT_REQ_CODE(dt)] });
const docDueC = (dt) => ({ $and: [{ [dt.path]: { $ne: null, $gte: dayStart(0), $lt: dayStart(dueDays(dt.key) + 1) } }, NOT_REQ_CODE(dt)] });
const docStateT = (v, dt) => VDOC.stateOf(getPath(v, dt.path), getPath(v, dt.statusPath) || '', ALERTS[dt.key] || {}).state;
const EXPIRED_ANY = () => ({ $or: DOC_TYPES.map(docExpiredC) });
const DUE_ANY = () => ({ $or: DOC_TYPES.map(docDueC) });
const expiredAnyT = (v) => DOC_TYPES.some((dt) => docStateT(v, dt) === 'expired');
const dueAnyT = (v) => DOC_TYPES.some((dt) => ['critical', 'warning'].includes(docStateT(v, dt)));
const AUTH_DOC = DOC_TYPES.find((d) => d.key === 'authorization');
const hasAuthT = (v) => !!(v.authorizedPerson?.name || v.authorizedPerson?.authorizationNumber);

const _year = () => new Date().getFullYear();

const DERIVED_DEFS = [
  // What expires and when, document by document.
  ...DOC_TYPES.map((dt) => ({
    key: `${dt.key}Horizon`, ar: `انتهاء ${dt.ar}`, en: `${dt.en} expiry`,
    groupAr: 'آفاق الانتهاء', groupEn: 'Expiry horizons',
    select: [dt.path], options: horizonOptions(dt.path),
  })),

  // How many vehicles have no operating card, and which ones.
  // This is a management question distinct from expiry, and cannot be read from the date: a vehicle without a date may not need the document (a motorbike has no operating card) or may need it and not have it extracted, which is a real difference. Mixing them makes the number report a shortage that does not exist.
  // The administrative state is recorded in `statusCode` since import: `required` means needed and not extracted, `not_required` means not needed. One bucket for each, per document.
  ...DOC_TYPES.map((dt) => {
    const NOT_REQ = ['not_required', 'not_in_use'];
    const ELSEWHERE = ['with_bank', 'with_aljabr', 'unknown', 'unmapped'];
    const noDate = () => ({ $or: [{ [dt.path]: null }, { [dt.path]: { $exists: false } }] });
    const code = (v) => String(getPath(v, dt.statusPath) || '');
    const hasDate = (v) => !!getPath(v, dt.path);
    return {
      key: `${dt.key}Need`, ar: `${dt.ar} — الوضع`, en: `${dt.en} — status`,
      groupAr: 'وجود المستندات', groupEn: 'Document presence',
      select: [dt.path, dt.statusPath],
      options: [
        {
          value: 'مطلوب — غير موجود', en: 'Required — missing',
          cond: () => ({ $and: [noDate(), { [dt.statusPath]: { $nin: [...NOT_REQ, ...ELSEWHERE] } }] }),
          test: (v) => !hasDate(v) && ![...NOT_REQ, ...ELSEWHERE].includes(code(v)),
        },
        {
          value: 'غير مطلوب', en: 'Not required',
          cond: () => ({ [dt.statusPath]: { $in: NOT_REQ } }),
          test: (v) => NOT_REQ.includes(code(v)),
        },
        {
          value: 'موجود', en: 'On file',
          cond: () => ({ [dt.path]: { $ne: null, $exists: true } }),
          test: (v) => hasDate(v),
        },
        {
          value: 'لدى جهةٍ أخرى', en: 'Held elsewhere',
          cond: () => ({ $and: [noDate(), { [dt.statusPath]: { $in: ELSEWHERE } }] }),
          test: (v) => !hasDate(v) && ELSEWHERE.includes(code(v)),
        },
      ],
    };
  }),

  // The whole vehicle in one question.
  // The three buckets are mutually exclusive on purpose: a vehicle with one expired and another nearing is counted in 'expired' only. Otherwise the bucket sum exceeds the fleet size, which is the first thing a reader notices and it destroys trust in the whole dashboard.
  {
    key: 'documentHealth', ar: 'صحّة المستندات', en: 'Document health',
    groupAr: 'المستندات', groupEn: 'Documents',
    // Uses the document-card rule; see `docStateT` above. A fixed 'within 30 days' used to count 'not required' as expired, so the filter disagreed with the card above it.
    select: DOC_TYPES.flatMap((dt) => [dt.path, dt.statusPath]),
    options: [
      { value: 'فيها مستند منتهٍ', en: 'Has an expired document', cond: EXPIRED_ANY, test: expiredAnyT },
      {
        value: 'فيها مستند قارب على الانتهاء', en: 'A document is due soon',
        cond: () => ({ $and: [DUE_ANY(), { $nor: [EXPIRED_ANY()] }] }),
        test: (v) => dueAnyT(v) && !expiredAnyT(v),
      },
      {
        value: 'لا منتهٍ ولا قارب', en: 'Nothing expired or due',
        cond: () => ({ $nor: [EXPIRED_ANY(), DUE_ANY()] }),
        test: (v) => !expiredAnyT(v) && !dueAnyT(v),
      },
    ],
  },
  {
    // Authorization: active, expired, none.
    // 'Has an authorized person' alone does not say whether the paper is valid for driving today.
    key: 'authState', ar: 'التفويض', en: 'Authorisation',
    groupAr: 'الملكية والتفويض', groupEn: 'Ownership',
    select: ['authorizedPerson.name', 'authorizedPerson.authorizationNumber', AUTH_DOC.path, AUTH_DOC.statusPath],
    options: [
      {
        value: 'تفويض ساري', en: 'Valid authorisation',
        cond: () => ({ $and: [HAS_AUTH(), { $nor: [docExpiredC(AUTH_DOC)] }] }),
        test: (v) => hasAuthT(v) && docStateT(v, AUTH_DOC) !== 'expired',
      },
      {
        value: 'تفويض منتهٍ', en: 'Expired authorisation',
        cond: () => ({ $and: [HAS_AUTH(), docExpiredC(AUTH_DOC)] }),
        test: (v) => hasAuthT(v) && docStateT(v, AUTH_DOC) === 'expired',
      },
      {
        value: 'بلا تفويض', en: 'No authorisation',
        cond: () => ({ $nor: [HAS_AUTH()] }),
        test: (v) => !hasAuthT(v),
      },
    ],
  },
  {
    key: 'completeness', ar: 'اكتمال البيانات', en: 'Data completeness',
    groupAr: 'المستندات', groupEn: 'Documents', select: ['missingItems'],
    options: yesNo(
      { ar: 'ينقصها بند أو أكثر', en: 'Missing something' }, { ar: 'مكتملة البيانات', en: 'Complete' },
      () => ({ 'missingItems.0': { $exists: true } }), (v) => !!(v.missingItems || []).length,
    ),
  },
  // Missing item and its reason: `buildFilter` already knows these two keys (and alone combines them in `$elemMatch` when both are requested), so no general condition is built for them here; the definition only displays their values and counts.
  {
    key: 'missingItem', ar: 'البند الناقص', en: 'Missing item',
    groupAr: 'المستندات', groupEn: 'Documents', select: ['missingItems'], handled: true,
    valuesOf: (v) => [...new Set((v.missingItems || []).map((m) => m.item).filter(Boolean))],
  },
  {
    key: 'missingReason', ar: 'سبب النقص', en: 'Reason missing',
    groupAr: 'المستندات', groupEn: 'Documents', select: ['missingItems'], handled: true,
    valuesOf: (v) => [...new Set((v.missingItems || []).map((m) => VDOC.statusLabel(m.reason, 'ar')).filter(Boolean))],
  },
  {
    key: 'logistiGap', ar: 'شرط لوجستي ناقص', en: 'Logisti requirement missing',
    groupAr: 'المستندات', groupEn: 'Documents', select: ['logistiGaps'], handled: true,
    valuesOf: (v) => [...new Set(v.logistiGaps || [])],
  },

  // Operation: what is actually on the vehicle.
  {
    key: 'gpsFitted', ar: 'جهاز التتبّع', en: 'Tracker fitted',
    groupAr: 'التشغيل', groupEn: 'Operations',
    select: ['gps.serialImei', 'gps.deviceModel', 'gps.deviceId'],
    options: yesNo(
      { ar: 'عليها جهاز تتبّع', en: 'Tracker fitted' }, { ar: 'بلا جهاز تتبّع', en: 'No tracker' },
      () => HAS_GPS, hasGps,
    ),
  },
  {
    key: 'fuelCardFitted', ar: 'شريحة الوقود', en: 'Fuel card',
    groupAr: 'التشغيل', groupEn: 'Operations', select: ['fuelCard.cardNumber'],
    options: yesNo(
      { ar: 'لها شريحة وقود', en: 'Has a fuel card' }, { ar: 'بلا شريحة وقود', en: 'No fuel card' },
      HAS_FUEL_CARD, (v) => !!v.fuelCard?.cardNumber,
    ),
  },
  {
    key: 'authorized', ar: 'التفويض بالقيادة', en: 'Driving authorisation',
    groupAr: 'الملكية والتفويض', groupEn: 'Ownership',
    select: ['authorizedPerson.name', 'authorizedPerson.authorizationNumber'],
    options: yesNo(
      { ar: 'عليها مفوَّض', en: 'Has an authorised driver' }, { ar: 'بلا مفوَّض', en: 'No authorised driver' },
      HAS_AUTH, (v) => !!(v.authorizedPerson?.name || v.authorizedPerson?.authorizationNumber),
    ),
  },
  {
    // Consumption cap: 'open' is not a high cap, it is no cap. Counting it with the numbers hides the vehicles with unlimited spend, the first thing a fuel review asks about.
    key: 'consumptionLimit', ar: 'سقف الاستهلاك', en: 'Fuel limit',
    groupAr: 'التشغيل', groupEn: 'Operations', select: ['fuelCard.limitSar', 'fuelCard.limitStatus'],
    options: [
      {
        value: 'مفتوح بلا سقف', en: 'Open — no ceiling',
        cond: () => ({ 'fuelCard.limitStatus': 'open' }),
        test: (v) => v.fuelCard?.limitStatus === 'open',
      },
      ...numberOptions('fuelCard.limitSar', [
        { value: '٣٠٠ ريال فأقل', en: 'Up to 300 SAR', hi: 300 },
        { value: '٣٠١ إلى ١٠٠٠ ريال', en: '301–1000 SAR', lo: 301, hi: 1000 },
        { value: '١٠٠١ إلى ٥٠٠٠ ريال', en: '1001–5000 SAR', lo: 1001, hi: 5000 },
        { value: 'أكثر من ٥٠٠٠ ريال', en: 'Over 5000 SAR', lo: 5001 },
        { value: 'بلا سقف مسجَّل', en: 'No limit recorded', none: true },
      ]),
    ],
  },

  // Insurance by money, not by date.
  {
    key: 'insuranceValue', ar: 'قيمة القسط', en: 'Premium band',
    groupAr: 'التأمين', groupEn: 'Insurance', select: ['insurance.premiumSar', 'insurance.premiumStatusAr'],
    options: [
      ...numberOptions('insurance.premiumSar', [
        { value: '١٠٠٠ ريال فأقل', en: 'Up to 1000 SAR', hi: 1000 },
        { value: '١٠٠١ إلى ٣٠٠٠ ريال', en: '1001–3000 SAR', lo: 1001, hi: 3000 },
        { value: '٣٠٠١ إلى ٥٠٠٠ ريال', en: '3001–5000 SAR', lo: 3001, hi: 5000 },
        { value: 'أكثر من ٥٠٠٠ ريال', en: 'Over 5000 SAR', lo: 5001 },
      ]),
      {
        // A vehicle whose premium is paid by the financier is not 'without premium'; it is insured and the number is held by the financier.
        value: 'يسدّده المموِّل', en: 'Paid by the financier',
        cond: () => ({ 'insurance.premiumStatusAr': { $nin: [null, ''] } }),
        test: (v) => !!v.insurance?.premiumStatusAr,
      },
      {
        value: 'بلا قسط مسجَّل', en: 'No premium recorded',
        cond: () => ({ $and: [{ $or: [{ 'insurance.premiumSar': null }, { 'insurance.premiumSar': { $exists: false } }] },
          { $or: [{ 'insurance.premiumStatusAr': null }, { 'insurance.premiumStatusAr': '' }] }] }),
        test: (v) => _blank(v.insurance?.premiumSar) && !v.insurance?.premiumStatusAr,
      },
    ],
  },

  // The vehicle itself: age and history.
  {
    // Model year is a number from which age is not readable by eye, and age is what the replacement decision is built on. Buckets are computed from the current year so they do not go stale.
    key: 'vehicleAge', ar: 'عمر المركبة', en: 'Vehicle age',
    groupAr: 'المركبة', groupEn: 'Vehicle', select: ['modelYear'],
    options: numberOptions('modelYear', [
      { value: 'أقل من ٣ سنوات', en: 'Under 3 years', lo: _year() - 2 },
      { value: '٣ إلى ٥ سنوات', en: '3–5 years', lo: _year() - 5, hi: _year() - 3 },
      { value: '٦ إلى ١٠ سنوات', en: '6–10 years', lo: _year() - 10, hi: _year() - 6 },
      { value: 'أكثر من ١٠ سنوات', en: 'Over 10 years', hi: _year() - 11 },
      { value: 'بلا سنة صنع', en: 'No model year', none: true },
    ]),
  },
  {
    key: 'accidentBand', ar: 'سجلّ الحوادث', en: 'Accident record',
    groupAr: 'المركبة', groupEn: 'Vehicle', select: ['accidentCount'],
    options: [{
      // 'No accidents' includes the empty field: the counter is filled after claims are linked, and a vehicle not yet counted is not unclassified, it has no accidents.
      value: 'بلا حوادث', en: 'No accidents',
      cond: () => ({ $or: [{ accidentCount: { $in: [null, 0] } }, { accidentCount: { $exists: false } }] }),
      test: (v) => !Number(v.accidentCount),
    }, ...numberOptions('accidentCount', [
      { value: 'حادث واحد', en: 'One accident', lo: 1, hi: 1 },
      { value: 'حادثان أو ثلاثة', en: '2–3 accidents', lo: 2, hi: 3 },
      { value: 'أكثر من ثلاثة حوادث', en: 'More than 3', lo: 4 },
    ])],
  },
];
const DERIVED_BY_KEY = new Map(DERIVED_DEFS.map((d) => [d.key, d]));

// Arabic state name to code. The screen shows the Arabic label, not `required`, and the filter accepts what the screen shows while still accepting the code so saved links keep working.
const REASON_BY_LABEL = Object.fromEntries(
  Object.entries(VDOC.STATUS_LABELS).map(([code, l]) => [l.ar, code]).filter(([ar]) => ar),
);

// Builds the Mongo filter from the query (multi-value, search, year range).
/**
 * Every text field on the vehicle is searchable; fields are read from the schema itself.
 * A hand-written field list meant each new model field was silently left out of search. The authorized person's ID number was one: typed into the box, the screen came back empty although it was stored, and empty reads as 'none' rather than 'not searched'.
 * Deriving from the schema makes the list grow with the model.
 */
const SEARCHABLE_PATHS = Object.entries(VehicleMaster.schema.paths)
  .filter(([path, def]) => def.instance === 'String' && !path.startsWith('_') && path !== '__v')
  .map(([path]) => path);

/**
 * Fields are requested, not whole documents.
 * The database link is capped at roughly 100 KB/s regardless of size, so screen time equals bytes pulled, not document count or query complexity: the engine runs the fleet query in a millisecond, then the result takes seconds to receive.
 * So a whole document is not read for a screen that uses a tenth of it. These fields are what the overview, expiry and section-register screens (which read the whole fleet) actually need; the payload drops from about 670 KB to about 80.
 * A field added to the model later and not here will not appear on those screens; that is the cost of a narrow projection.
 */
const DOC_PATHS = [...new Set(VDOC.DOCUMENTS.flatMap((d) => [
  d.path, d.statusPath, d.numberPath, d.startPath, ...(d.extra || []),
].filter(Boolean)))];

/** What the aggregation screens need: vehicle classification, and each document's state and date. */
const AGG_FIELDS = [...new Set([
  'plateNumber', 'plateKey', 'chassisNumber', 'serialNumber', 'sectorAr', 'sectorCode', 'registrationTypeAr',
  'ownerCompanyAr',
  'departmentAr', 'cityAr', 'possessionStatusAr', 'serviceStatusAr', 'serviceStatusCode',
  'brandAr', 'modelAr', 'modelYear', 'colorAr', 'ownerNameAr', 'commercialRegistration',
  'tamStatusAr', 'accidentCount', 'missingItems', 'logistiGaps', 'insurancePolicy',
  'isActive', 'notesAr',
  ...DOC_PATHS,
  // Fields the section registers read in their row details.
  'insurance.companyAr', 'insurance.coverageTypeAr', 'insurance.premiumSar', 'insurance.premiumStatusAr',
  'fuelCard.provider', 'fuelCard.cardNumber', 'fuelCard.statusAr', 'fuelCard.plateOnInvoiceAr',
  'fuelCard.consumptionTypeAr', 'fuelCard.limitSar', 'fuelCard.limitStatus',
  'gps.provider', 'gps.deviceModel', 'gps.deviceStatusAr', 'gps.serialImei', 'gps.simNumber',
  'authorizedPerson.name', 'authorizedPerson.iqamaNumber', 'authorizedPerson.jobTitleAr',
  'authorizedPerson.authorizationNumber', 'authorizedPerson.startDate',
  'operatingCard.cardNumber', 'inspection.statusAr',
  'vehicleLicense.expiryDateHijri', 'inspection.expiryDateHijri',
])].join(' ');

function buildFilter(q) {
  const f = { isActive: { $ne: false } };
  const and = [];
  const map = FIELD_MAP;
  for (const [qk, field] of Object.entries(map)) {
    const vals = _multi(q[qk]);
    if (!vals.length) continue;
    // A dash means the empty field, a real category people ask about: which vehicles have no registered owner is a business question, not an error, so it cannot drop out of the filter.
    // The value is matched as it is read in the list, with any surrounding whitespace, and the dash covers blank only. A `$in` on the text used to be trimmed by Mongoose. See utils/colFilter.
    const c = textIn(field, vals.map((x) => (x === '—' ? '' : x)));
    if (c) and.push(c);
  }
  return buildFilterRest(q, f, and);
}

// All filters use the Arabic name (the same as the distributions display): simpler and clearer.
const FIELD_MAP = {
    sector: 'sectorAr', registrationType: 'registrationTypeAr', ownerCompany: 'ownerCompanyAr', brand: 'brandAr',
    department: 'departmentAr', city: 'cityAr', possession: 'possessionStatusAr',
    gpsDeviceStatus: 'gps.deviceStatusAr',
    // Section register keys: each row opens its vehicles with these filters.
    authorizedPerson: 'authorizedPerson.name', authorizedPersonIqama: 'authorizedPerson.iqamaNumber',
    gpsProvider: 'gps.provider',
    gpsDevice: 'gps.deviceModel', fuelCard: 'fuelCard.cardNumber',
    owner: 'ownerNameAr', insuranceCompany: 'insurance.companyAr',
    coverageType: 'insurance.coverageTypeAr', fuelCardStatus: 'fuelCard.statusAr',
    inspectionStatus: 'inspection.statusAr', tamStatus: 'tamStatusAr', color: 'colorAr',
    // Columns of the final master sheet.
    // Operating state comes first: a large share of the fleet is stopped or stolen, and the answer was buried in the word 'unused' written in the place of the department name.
    serviceStatus: 'serviceStatusAr',
    model: 'modelAr',
    commercialRegistration: 'commercialRegistration',
    insurancePolicyNumber: 'insurance.policyNumber',
    premiumStatus: 'insurance.premiumStatusAr',
    consumptionType: 'fuelCard.consumptionTypeAr',
    gpsSerial: 'gps.serialImei',
    operatingCardNumber: 'operatingCard.cardNumber',
    authorizationNumber: 'authorizedPerson.authorizationNumber',
    // Backward compatibility with the codes:
    sectorCode: 'sectorCode', registrationTypeCode: 'registrationTypeCode',
    serviceStatusCode: 'serviceStatusCode',
    // 'Active fuel cards' on the dashboard is counted by code (`statusCode === 'active'`), so it opens by the same code rather than text that may be written in several forms.
    fuelCardStatusCode: 'fuelCard.statusCode',
};

/**
 * What counts as a vehicle filter.
 * Three places asked the same question with three lists: the dashboard counted any key, expiry only five keys, and accidents none. So a registration-type filter hid driver cards from the dashboard but kept them in expiry, and the dashboard counted the matching vehicles' accidents while the number opened the whole fleet's accidents.
 * Now there is one list, derived from what `buildFilter` itself understands.
 */
const VEHICLE_FILTER_KEYS = new Set([
  ...Object.keys(FIELD_MAP),
  'logistiGaps', 'logistiGap', 'missing', 'missingItem', 'missingReason', 'insurancePolicy', 'missingDocDate',
  'modelYear', 'yearFrom', 'yearTo', 'q', 'expiringDoc', 'expiringWithin', 'expiredDoc', 'missingDoc', 'hasGps',
  'expiryDoc', 'expiryFrom', 'expiryTo',
  ...DERIVED_DEFS.map((d) => d.key),
]);
const hasVehicleFilter = (q = {}, except = []) => Object.entries(q)
  .some(([k, v]) => VEHICLE_FILTER_KEYS.has(k) && !except.includes(k) && String(v ?? '').trim() !== '');
/** Only the vehicle-filter keys from a query that contains others. */
const vehicleQueryOf = (q = {}) => Object.fromEntries(Object.entries(q).filter(([k]) => VEHICLE_FILTER_KEYS.has(k)));

function buildFilterRest(q, f, and) {
  // Logisti platform gaps: 'show vehicles missing a requirement' and 'show who is missing this specific requirement' are two different questions, both work lists.
  if (q.logistiGaps === '1') and.push({ 'logistiGaps.0': { $exists: true } });
  if (q.logistiGaps === '0') and.push({ 'logistiGaps.0': { $exists: false } });
  const gapItems = _multi(q.logistiGap);
  if (gapItems.length) and.push({ logistiGaps: { $in: gapItems } });

  // Data gaps: show who is missing anything, or a specific item, or an item for a specific reason.
  if (q.missing === '1') and.push({ 'missingItems.0': { $exists: true } });
  const mItems = _multi(q.missingItem);
  const mReasons = _multi(q.missingReason).map((x) => REASON_BY_LABEL[x] || x);
  if (mItems.length && mReasons.length) {
    and.push({ missingItems: { $elemMatch: { item: { $in: mItems }, reason: { $in: mReasons } } } });
  } else if (mItems.length) and.push({ 'missingItems.item': { $in: mItems } });
  else if (mReasons.length) and.push({ 'missingItems.reason': { $in: mReasons } });
  if (q.insurancePolicy) and.push({ insurancePolicy: q.insurancePolicy });

  // 'No recorded date' for a specific document is not a date out of range but no date at all, so no range matches it and it needs its own category.
  if (q.missingDocDate) {
    const dt = DOC_TYPES.find((x) => x.key === q.missingDocDate);
    if (dt) and.push({ $or: [{ [dt.path]: null }, { [dt.path]: '' }, { [dt.path]: { $exists: false } }] });
  }

  const yearVals = _multi(q.modelYear);
  const wantsNoYear = yearVals.includes('—');
  const years = yearVals.map(Number).filter((x) => !Number.isNaN(x) && x);
  if (wantsNoYear && years.length) and.push({ $or: [{ modelYear: { $in: years } }, { modelYear: { $in: [null, 0, ''] } }, { modelYear: { $exists: false } }] });
  else if (wantsNoYear) and.push({ $or: [{ modelYear: { $in: [null, 0, ''] } }, { modelYear: { $exists: false } }] });
  else if (years.length) and.push({ modelYear: { $in: years } });
  if (q.yearFrom || q.yearTo) {
    const yr = {}; if (q.yearFrom) yr.$gte = Number(q.yearFrom); if (q.yearTo) yr.$lte = Number(q.yearTo);
    and.push({ modelYear: yr });
  }
  if (q.q && String(q.q).trim()) {
    // Search ignores the number of spaces; see flexSpaceRegex. A two-letter plate is copied from Absher with two spaces and stored here with one, so staff used to delete a space by hand to find it.
    const rx = flexSpaceRegex(q.q);
    and.push({ $or: SEARCHABLE_PATHS.map((f) => ({ [f]: rx })) });
  }
  // Filter for a document expiring within a period, already expired, or within a date range.
  if (q.expiringDoc && q.expiringWithin) {
    const dt = DOC_TYPES.find((x) => x.key === q.expiringDoc);
    if (dt) {
      const end = new Date(Date.now() + Number(q.expiringWithin) * DAY);
      and.push({ [dt.path]: { $ne: null, $lte: end, $gte: new Date() } });
    }
  }
  if (q.expiredDoc) {
    const dt = DOC_TYPES.find((x) => x.key === q.expiredDoc);
    if (dt) and.push({ [dt.path]: { $ne: null, $lt: new Date() } });
  }
  // 'Without document': vehicles missing this document (no date or no number).
  if (q.missingDoc) {
    // Authorization was missing from this map although it is a full sixth document, so 'show vehicles without authorization' silently fell through and opened the whole fleet.
    const paths = { insurance: 'insurance.expiryDate', operatingCard: 'operatingCard.cardNumber', vehicleLicense: 'vehicleLicense.expiryDate', inspection: 'inspection.expiryDate', gps: 'gps.deviceId', fuelCard: 'fuelCard.cardNumber', authorization: 'authorizedPerson.authorizationNumber' };
    if (q.missingDoc === 'gps') and.push({ $nor: [HAS_GPS] });
    else {
      const p = paths[q.missingDoc];
      if (p) and.push({ $or: [{ [p]: null }, { [p]: '' }] });
    }
  }
  // 'Has GPS': vehicles with a device fitted.
  if (q.hasGps === '1') and.push(HAS_GPS);
  if (q.hasGps === '0') and.push({ $nor: [HAS_GPS] });
  // Derived filters. Selected values within one field are OR, across fields AND: '(expired or within 30 days) and (no tracker)'. This is the only way the dashboard reads: picking two values in one field widens, picking another field narrows.
  for (const d of DERIVED_DEFS) {
    if (d.handled || !d.options) continue;
    const picked = _multi(q[d.key]);
    if (!picked.length) continue;
    const conds = d.options.filter((o) => picked.includes(o.value)).map((o) => o.cond());
    // A value the definition does not know (an old link or hand-typed) is not silently ignored, which would open the whole fleet as if the filter applied; it matches nothing.
    and.push(conds.length ? { $or: conds } : { _id: { $in: [] } });
  }

  if (q.expiryDoc && (q.expiryFrom || q.expiryTo)) {
    const dt = DOC_TYPES.find((x) => x.key === q.expiryDoc);
    if (dt) {
      const rng = {}; if (q.expiryFrom) rng.$gte = startOfDay(q.expiryFrom);
      // End of the requested day, not the next day: adding a full day would put what expires at the start of the next day into this bucket and the following one together.
      if (q.expiryTo) rng.$lte = endOfDay(q.expiryTo);
      and.push({ [dt.path]: rng });
    }
  }
  if (and.length) f.$and = and;
  return f;
}

// Vehicle list.
exports.list = async (req, res) => {
  try {
    const cacheKey = `vreg:list:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return res.json(hit);

    await getConfig(); // Alert thresholds for the document-state filters (see ALERTS)
    const filter = buildFilter(req.query);
    const limit = Math.min(Number(req.query.limit) || 500, 2000);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const sortBy = req.query.sortBy || 'plateNumber';
    const sortDir = req.query.sortDir === 'desc' ? -1 : 1;
    // The list carries every field except the heavy ones (renewal log, fuel-card log, import trace): an exclusion, not a name list.
    // A name list silently dropped new model fields (owner company, notes, document numbers), leaving table columns, column filters and the edit dialog empty although the data was saved.
    // `plateDigits` with `plateLettersAr` build the plate in the Tam export format (three letter positions, then the number).
    const LIST_FIELDS = '-renewals -fuelCard.history -source_row -sourceFile -lastImportAt -__v';
    const [vehicles, total] = await Promise.all([
      VehicleMaster.find(filter).select(LIST_FIELDS).sort({ [sortBy]: sortDir }).skip((page - 1) * limit).limit(limit).lean(),
      VehicleMaster.countDocuments(filter),
    ]);
    const cfg = await getConfig();
    // The authorized person's card is read with his row.
    // The link already exists by residency number: the authorization paper carries it and the driver card is keyed by it. What was missing was reading it: the authorization screen said who is authorized but not whether his card is valid or whether he is covered by the fidelity policy, both conditions for driving at all, so someone with an expired card could be authorized on a truck.
    // There are only about sixty cards in the whole registry, so reading them all is cheaper than any join.
    const cardsAll = await DriverCard.find({ isActive: { $ne: false } })
      .select('idNumber name cardNumber cardType expiryDate fidelity').lean();
    const cardById = new Map(cardsAll.map((c) => [String(c.idNumber || '').trim(), c]));
    /**
     * Light transport vehicle: where it works and with which project.
     * The light transport sector is the individuals section (b2c); city and project are managed there on the rider, not the vehicle, and a vehicle moves project when its rider moves. Copying them onto the vehicle row would diverge from the source after the first move.
     * So they are read from the section record at display time; an edit there shows here immediately, with no sync to forget.
     */
    const ltVehicleIds = vehicles
      .filter((v) => String(v.sectorAr || '').includes('خفيف'))
      .map((v) => v._id);
    const ltByVehicle = new Map();
    if (ltVehicleIds.length) {
      const { LightTransportEmployee } = require('../models/LightTransport');
      // An archived rider is not named on the vehicle, as if deleted.
      const AH = require('../utils/archivedHidden');
      const riders = await LightTransportEmployee.find(AH.andAll({ vehicle: { $in: ltVehicleIds }, isActive: { $ne: false } }, AH.notArchivedRow(await endedStaff())))
        .select('vehicle name idNumber cityAr projectAr supervisorName dutySupervisorName').lean();
      for (const r of riders) ltByVehicle.set(String(r.vehicle), r);
    }

    // Authorized person's residency and driving-license expiry, from his file (utils/personDocDates).
    const personDocs = await require('../utils/personDocDates').docDatesFor(
      vehicles.map((v) => ({ idNumber: v.authorizedPerson?.iqamaNumber })));
    const withStatus = vehicles.map((v) => {
      const row = decorate(v, cfg);
      if (String(v.authorizedPerson?.iqamaNumber || '').trim()) row.personDocs = personDocs({ idNumber: v.authorizedPerson.iqamaNumber });
      const lt = ltByVehicle.get(String(v._id));
      if (lt) {
        row.ltCityAr = lt.cityAr || '';
        row.ltProjectAr = lt.projectAr || '';
        row.ltRiderName = lt.name || '';
        row.ltRiderId = lt.idNumber || '';
        row.ltSupervisorName = lt.supervisorName || '';
      }
      const iq = String(v.authorizedPerson?.iqamaNumber || '').trim();
      const card = iq ? cardById.get(iq) : null;
      if (card) {
        const days = cardDaysLeft(card.expiryDate);
        row.driverCard = {
          _id: String(card._id),
          cardNumber: card.cardNumber || '',
          cardType: card.cardType || '',
          expiryDate: card.expiryDate || '',
          daysLeft: days,
          state: cardState(days, cfg.alerts?.driverCard),
          fidelityStatus: card.fidelity?.status || '',
        };
      }
      return row;
    });
    const body = { vehicles: withStatus, total, page, pages: Math.ceil(total / limit) };
    cache.set(cacheKey, body, 30000);
    res.json(body);
  } catch (e) { console.error('vreg list', e); res.status(500).json({ message: 'Failed to load vehicles' }); }
};

// Adds each document's state, the nearest expiry and the vehicle's worst state.
function decorate(v, cfg) {
  const a = cfg.alerts || {};
  const docs = {};
  for (const dt of DOC_TYPES) {
    docs[dt.key] = docStatus(getPath(v, dt.path), a[dt.key], getPath(v, dt.statusPath));
  }
  // 'Not required' is no worse than 'valid': it is not a problem at all, so it sorts last.
  const order = { expired: 0, critical: 1, warning: 2, valid: 3, none: 4, not_required: 5 };
  let worst = 'valid'; let worstDays = null;
  for (const [k, s] of Object.entries(docs)) {
    if (k === 'gps' && !a.gps?.enabled) continue;
    if (order[s.status] < order[worst]) { worst = s.status; worstDays = s.days; }
    else if (s.status === worst && s.days != null && (worstDays == null || s.days < worstDays)) worstDays = s.days;
  }
  return { ...v, docStatuses: docs, overallStatus: worst, overallDays: worstDays };
}

exports.getOne = async (req, res) => {
  try {
    // The profile also opens archived vehicles, read-only, from the archive page.
    const v = await VehicleMaster.findById(req.params.id).setOptions({ withArchived: true }).lean();
    if (!v) return res.status(404).json({ message: 'Vehicle not found' });
    const cfg = await getConfig();
    res.json({ vehicle: decorate(v, cfg) });
  } catch (e) { res.status(500).json({ message: 'Failed to load vehicle' }); }
};

// A bad field is the user's problem to fix, not a server fault: say WHICH field
// and return 400. These used to fall into the generic 500 handler below, so the
// form showed "Failed to create vehicle" with no idea what was wrong.
/** Duplicated field name as the user reads it, not its schema path. */
const FIELD_AR = {
  plateNumber: 'رقم اللوحة',
  chassisNumber: 'رقم الهيكل',
  serialNumber: 'الرقم التسلسلي',
  'operatingCard.cardNumber': 'رقم بطاقة التشغيل',
  'gps.serialImei': 'سريال جهاز التتبّع',
  'fuelCard.cardNumber': 'رقم شريحة الوقود',
  'authorizedPerson.authorizationNumber': 'رقم التفويض',
};

// Why `async`.
// The duplicate branch queries the database for the other vehicle to name it in the message. It used to return `true` immediately and let the reply be sent in a dangling promise; it normally arrived a tick later, but the function claimed it had handled the reply before replying. Now it is awaited, so the reply is guaranteed before the call returns.
const badInput = async (e, res) => {
  // A duplicate is named by field and value.
  // 'Plate or chassis number is duplicated' leaves the user guessing which and who holds it. Mongo returns the field and value in the error itself, so they are read from it and the other vehicle is looked up, giving 'this number is on vehicle X' instead of a generic error.
  if (e.code === 11000) {
    const field = Object.keys(e.keyPattern || {})[0] || '';
    const value = (e.keyValue || {})[field];
    const label = FIELD_AR[field] || field || 'أحد الأرقام الفريدة';
    let other = null;
    // The holder may be an archived vehicle, which no active query sees; name it as such.
    try { other = await VehicleMaster.findOne({ [field]: value }).setOptions({ withArchived: true }).select('plateNumber archived').lean(); } catch (_) { /* The generic message is enough */ }
    res.status(400).json({
      message: other
        ? `${label} «${value}» مسجَّلٌ على المركبة ${other.plateNumber}${other.archived ? ' (في الأرشيف — أعِدها من صفحة الأرشيف)' : ''} — ولا يتكرّر على مركبتين.`
        : `${label} «${value}» مكرَّر — ولا يتكرّر على مركبتين.`,
    });
    return true;
  }
  if (e.name === 'ValidationError') {
    const first = Object.values(e.errors || {})[0];
    res.status(400).json({ message: first?.message || 'بيانات غير صالحة' });
    return true;
  }
  if (e.name === 'CastError') { res.status(400).json({ message: `قيمة غير صالحة للحقل «${e.path}»` }); return true; }
  return false;
};

exports.create = async (req, res) => {
  try {
    // A vehicle registered with a Hijri date and no Gregorian one is born without alerts; see utils/hijri.
    const body = { ...req.body };
    try {
      const { fillHijriPairs } = require('../utils/hijri');
      const flat = {};
      for (const b of ['vehicleLicense', 'inspection']) {
        for (const f of ['expiryDate', 'expiryDateHijri']) {
          if (body[b] && body[b][f] !== undefined) flat[`${b}.${f}`] = body[b][f];
        }
      }
      fillHijriPairs(flat, {});
      for (const [k, val] of Object.entries(flat)) {
        const [b, f] = k.split('.');
        body[b] = { ...(body[b] || {}), [f]: val };
      }
    } catch (e) { /* Registration proceeds */ }
    // The authorized person is chosen from employees; the actual driver is a mirror and is not written. See personPatch.
    if (body.actualDriver && (String(body.actualDriver.name || '').trim() || String(body.actualDriver.idNumber || '').trim())) {
      return res.status(400).json({ message: 'القائدُ الفعليّ لا يُكتب هنا — يُختار من «مركبات النقل الخفيف» فيُربط الراكبُ بالمركبة' });
    }
    delete body.actualDriver;
    if (body.authorizedPerson && typeof body.authorizedPerson === 'object') {
      const a = body.authorizedPerson;
      const holder = await require('../utils/vehiclePerson').resolvePerson(
        { employeeId: a.employeeId, ltId: a.ltId, idNumber: a.iqamaNumber, name: a.name }, { label: 'المفوَّض' });
      const { employeeId, ltId, ...rest } = a; // eslint-disable-line no-unused-vars
      body.authorizedPerson = holder
        ? { ...rest, name: holder.name, iqamaNumber: holder.idNumber, phone: holder.phone, jobTitleAr: rest.jobTitleAr || holder.jobTitleAr }
        : { ...rest, name: '', iqamaNumber: '', phone: '' };
    }
    for (const k of ['archived', 'archive', 'archiveLog']) delete body[k];
    const v = await VehicleMaster.create({ ...body, isActive: true });
    // The plate key is derived on save (models/VehicleMaster), so its recorded accidents are counted.
    await syncAccidentCount(v.plateKey);
    emit('vreg:updated', {});
    res.status(201).json({ vehicle: v });
  } catch (e) {
    if (e.bad) return res.status(400).json({ message: e.message });
    if (await badInput(e, res)) return;
    return sendMongooseError(res, e, 'Failed to create vehicle');
  }
};

// Update merges, it does not replace.
// `$set: req.body` used to write the whole sub-object: sending `{ operatingCard: { expiryDate } }` erased `cardNumber` and `statusCode` with it, so a page editing two fields damaged fields it does not even display. The list projection is partial (it does not return `insurance.status` or `fuelCard.consumptionTypeCode`), so the client has nothing to resend to preserve them.
// Flattening is done here, not in the client, because `express-mongo-sanitize` strips any key containing a dot before it reaches the controller, so a dotted path sent from the browser vanishes silently: the user says 'saved' and nothing changed.
// The archive state is written only by end-service / restore (services/vehicleLifecycle), never by an edit.
const NEVER_SET = new Set(['_id', '__v', 'createdAt', 'updatedAt', 'docStatuses', 'overallStatus', 'overallDays', 'archived', 'archive', 'archiveLog']);

const flattenPatch = (src, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(src || {})) {
    if (!prefix && NEVER_SET.has(k)) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    // Arrays are written whole on purpose: `logistiGaps` and `missingItems` are lists that are replaced, not fields that are merged; merging items by index would keep a deleted item.
    const isPlain = v && typeof v === 'object' && !Array.isArray(v)
      && Object.getPrototypeOf(v) === Object.prototype;
    if (!isPlain) { out[path] = v; continue; }
    // An empty object means 'nothing here', not 'clear everything under it'. Writing `{}` used to wipe the whole sub-document on a vehicle where no edit was intended.
    if (Object.keys(v).length) flattenPatch(v, path, out);
  }
  return out;
};

/**
 * What actually changed between two documents on the sent paths, for the audit entry only.
 * The dialog sometimes sends the whole row, so the entry records what differs, not what was sent.
 */
const vehicleDiff = (before, after, paths) => {
  const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const norm = (x) => {
    if (x === undefined || x === null || x === '') return '';
    if (x instanceof Date) return x.toISOString();
    if (typeof x === 'object') return JSON.stringify(x);
    return String(x);
  };
  const out = { before: {}, after: {} };
  for (const p of paths) {
    if (Object.keys(out.after).length >= 40) break;
    const a = get(before, p); const b = get(after, p);
    if (norm(a) === norm(b)) continue;
    out.before[p] = a ?? '';
    out.after[p] = b ?? '';
  }
  return out;
};
exports._vehicleDiff = vehicleDiff;

exports.update = async (req, res) => {
  try {
    const $set = flattenPatch(req.body);
    if (!Object.keys($set).length) return res.status(400).json({ message: 'لا حقول للتعديل' });
    // A Hijri date yields its Gregorian one.
    // All calculation is on Gregorian, so a Hijri date without a Gregorian one is a document with no date and appears in no expiry or alert. Derivation is done here, not in the screen, because there are two screens (web and mobile) plus the import. See utils/hijri.
    const { fillHijriPairs } = require('../utils/hijri');
    // The full document before the edit: the Hijri date is derived from it and what changed is written onto it.
    const before = await VehicleMaster.findById(req.params.id).select('-renewals -fuelCard.history').lean();
    if (!before) return res.status(404).json({ message: 'Vehicle not found' });
    const person = await personPatch($set, before);
    const derived = fillHijriPairs($set, before);
    let v = Object.keys($set).length
      ? await VehicleMaster.findByIdAndUpdate(req.params.id, { $set }, { new: true, runValidators: true })
      : await VehicleMaster.findById(req.params.id);
    if (!v) return res.status(404).json({ message: 'Vehicle not found' });
    if (person.holderChange) {
      const r = await require('../utils/vehicleAuthorization').setHolder(v._id, person.holder, {
        userId: req.user?._id, byName: `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim(),
        note: person.holder ? 'فُوِّضت المركبة من سجل المركبات' : undefined, reason: person.holder ? '' : 'من سجل المركبات',
      });
      v = r.vehicle;
    }
    if ($set.plateNumber) await syncAccidentCount(v.plateKey);
    emit('vreg:updated', {});
    // An edit is audited field by field.
    // It was not audited at all: `/api/vehicle-registry` is outside the section prefixes in config/sections, so the global safety net (middleware/auditTrail) does not catch it and the controller wrote nothing. When someone said 'I saved and it did not save' there was no record of who saved what and when. The entry carries only what changed, before and after.
    try {
      const after = v.toObject();
      const changes = vehicleDiff(before, after, Object.keys($set));
      if (Object.keys(changes.after).length) {
        await logAudit({
          user: req.user?._id, action: 'update_vehicle', entity: 'VehicleMaster',
          entityId: v._id, entityKey: v.plateNumber, changes, ipAddress: req.ip,
        });
      }
    } catch (_) { /* An audit failure does not fail the save */ }
    // Derived values are reported too: the screen shows them so nobody is surprised by a date they did not type.
    res.json({ vehicle: v, ...(Object.keys(derived).length ? { derived } : {}) });
  } catch (e) {
    if (e.bad) return res.status(400).json({ message: e.message });
    if (await badInput(e, res)) return;
    return sendMongooseError(res, e, 'Failed to update vehicle');
  }
};

/**
 * Person fields on the vehicle are selected, not typed.
 * The authorized person is sent as a reference (`authorizedPerson.employeeId` / `ltId`) or an ID number and resolved by utils/vehiclePerson (the name alone only if it matches a single employee), then written with `setHolder` so the assignment log follows. A name matching no employee is rejected. The mobile number comes from the person's file, not the field.
 * The actual driver (`actualDriver`) mirrors the vehicle's rider from the light transport record and is not written here; it is chosen from the light transport vehicles (utils/ltRider).
 * Modifies `$set` in place and returns `{ holderChange, holder }`.
 */
async function personPatch($set, before) {
  const S2 = (x) => String(x == null ? '' : x).trim();
  const out = { holderChange: false, holder: null };
  for (const k of Object.keys($set)) {
    if (!k.startsWith('actualDriver')) continue;
    const cur = k === 'actualDriver' ? before.actualDriver : before.actualDriver?.[k.split('.')[1]];
    if (JSON.stringify(cur ?? '') === JSON.stringify($set[k] ?? '') || (typeof $set[k] === 'string' && S2(cur) === S2($set[k]))) { delete $set[k]; continue; }
    throw Object.assign(new Error('القائدُ الفعليّ لا يُكتب هنا — يُختار من «مركبات النقل الخفيف» فيُربط الراكبُ بالمركبة'), { bad: true });
  }
  const ap = before.authorizedPerson || {};
  const sent = (f) => $set[`authorizedPerson.${f}`] !== undefined;
  const refSent = sent('employeeId') || sent('ltId');
  const nameChanged = sent('name') && S2($set['authorizedPerson.name']) !== S2(ap.name);
  const idChanged = sent('iqamaNumber') && S2($set['authorizedPerson.iqamaNumber']).replace(/\s+/g, '') !== S2(ap.iqamaNumber).replace(/\s+/g, '');
  const input = {
    employeeId: $set['authorizedPerson.employeeId'], ltId: $set['authorizedPerson.ltId'],
    idNumber: sent('iqamaNumber') ? $set['authorizedPerson.iqamaNumber'] : ap.iqamaNumber,
    name: sent('name') ? $set['authorizedPerson.name'] : ap.name,
  };
  for (const f of ['employeeId', 'ltId', 'name', 'iqamaNumber', 'phone']) delete $set[`authorizedPerson.${f}`];
  if (!refSent && !nameChanged && !idChanged) return out;
  const holder = await require('../utils/vehiclePerson').resolvePerson(input, { label: 'المفوَّض' });
  if (holder && holder.idNumber === S2(ap.iqamaNumber) && holder.name === S2(ap.name)) return out;
  // The full paper for another person: number, term and title, from what was sent, otherwise from what existed.
  const take = (f) => { const k = `authorizedPerson.${f}`; const val = $set[k] !== undefined ? $set[k] : ap[f]; delete $set[k]; return val; };
  out.holderChange = true;
  if (!holder) { for (const k of Object.keys($set)) if (k.startsWith('authorizedPerson.')) delete $set[k]; return out; }
  out.holder = {
    employee: holder.employee || null, name: holder.name, idNumber: holder.idNumber, phone: holder.phone,
    jobTitleAr: take('jobTitleAr') || holder.jobTitleAr || '',
    authorizationNumber: take('authorizationNumber') || '',
    startDate: take('startDate') || null,
    expiryDate: take('expiryDate') || null,
  };
  delete $set['authorizedPerson.statusCode'];
  return out;
}
exports._personPatch = personPatch;

// GET /people?q=
exports.people = async (req, res) => {
  try {
    const people = await require('../utils/vehiclePerson').options({ scope: 'hr', q: req.query.q });
    res.json({ people });
  } catch (e) {
    console.error('vreg people:', e);
    res.status(500).json({ message: 'تعذّر تحميل قائمة الموظّفين' });
  }
};

/**
 * Fuel card fit and remove. POST /:id/fuel-card
 * A separate recorded action, not a field edit: removing the card is a condition of employee clearance, and a condition on an empty field proves nothing and leaves no trace of who removed it and when.
 * body: { action: 'assign'|'remove', cardNumber?, note? }
 */
exports.fuelCardAction = async (req, res) => {
  try {
    const v = await VehicleMaster.findById(req.params.id);
    if (!v) return res.status(404).json({ message: 'المركبة غير موجودة' });

    const action = String(req.body?.action || '').trim();
    if (!['assign', 'remove'].includes(action)) {
      return res.status(400).json({ message: 'الإجراء إمّا «تركيب» أو «نزع»' });
    }
    const byName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim();
    const note = String(req.body?.note || '').trim().slice(0, 500);
    v.fuelCard = v.fuelCard || {};

    if (action === 'assign') {
      const cardNumber = String(req.body?.cardNumber || '').trim();
      if (!cardNumber) return res.status(400).json({ message: 'رقم الشريحة مطلوب' });
      v.fuelCard.cardNumber = cardNumber;
      if (req.body.plateOnInvoiceAr !== undefined) v.fuelCard.plateOnInvoiceAr = String(req.body.plateOnInvoiceAr || '').trim();
      if (req.body.consumptionTypeAr !== undefined) v.fuelCard.consumptionTypeAr = String(req.body.consumptionTypeAr || '').trim();
      if (req.body.statusAr !== undefined) v.fuelCard.statusAr = String(req.body.statusAr || '').trim();
      if (req.body.limitSar !== undefined) v.fuelCard.limitSar = req.body.limitSar === '' || req.body.limitSar === null ? null : Number(req.body.limitSar);
      v.fuelCard.history.push({
        action: 'assigned', cardNumber, note, byName,
        holderName: v.authorizedPerson?.name || '', holderIqama: v.authorizedPerson?.iqamaNumber || '',
      });
    } else {
      const had = String(v.fuelCard.cardNumber || '').trim();
      if (!had) return res.status(409).json({ message: 'لا شريحةَ على هذه المركبة أصلًا' });
      v.fuelCard.history.push({
        action: 'removed', cardNumber: had, note, byName,
        holderName: v.authorizedPerson?.name || '', holderIqama: v.authorizedPerson?.iqamaNumber || '',
      });
      // Only what belongs to the card is removed.
      // The plate on the invoice and the spend cap are attributes of a card that no longer exists; leaving them makes the vehicle read as 'has a card with no number'. Consumption type stays: it is a vehicle attribute, not a card attribute.
      v.fuelCard.cardNumber = '';
      v.fuelCard.plateOnInvoiceAr = '';
      v.fuelCard.limitSar = null;
      v.fuelCard.limitStatus = '';
      v.fuelCard.statusAr = '';
      v.fuelCard.statusCode = '';
    }

    await v.save();
    emit('vreg:updated', {});
    await logAudit({
      user: req.user?._id, action: action === 'assign' ? 'assign_fuel_card' : 'remove_fuel_card',
      entity: 'VehicleMaster', entityId: v._id, entityKey: v.plateNumber,
      changes: { after: { cardNumber: v.fuelCard.cardNumber, note } }, ipAddress: req.ip,
    }).catch(() => {});

    res.json({
      vehicle: v,
      message: action === 'assign'
        ? `رُكِّبت الشريحة على المركبة ${v.plateNumber}`
        : `نُزعت الشريحة عن المركبة ${v.plateNumber}`,
    });
  } catch (e) {
    return sendMongooseError(res, e, 'تعذّر تنفيذ الإجراء على الشريحة');
  }
};

exports.remove = async (req, res) => {
  try {
    await VehicleMaster.findByIdAndDelete(req.params.id);
    emit('vreg:updated', {});
    res.json({ message: 'Vehicle deleted' });
  } catch (e) { res.status(500).json({ message: 'Failed to delete vehicle' }); }
};

// Analytics dashboard.
/** Driver-card summary for the section dashboard: a count per expiry bucket. */
async function driverCardSummary(alert) {
  try {
    const DriverCardModel = require('../models/DriverCard');
    const { startOfDay, todayKey } = require('../utils/companyDay');
    const today = startOfDay(todayKey());
    const [all, ended] = await Promise.all([
      DriverCardModel.find({ isActive: { $ne: false } }).select('expiryDate employee idNumber').lean(),
      endedStaff(),
    ]);
    const rows = all.filter((c) => !cardEnded(ended, c));
    const left = (d) => (d ? Math.round((startOfDay(d) - today) / 86400000) : null);
    // Three buckets, not two: 'upcoming' used to be dropped here and counted as valid, so the summary said the card is valid while the expiry screen said it is near.
    const out = { total: rows.length, expired: 0, critical: 0, warning: 0, upcoming: 0, valid: 0, unknown: 0 };
    for (const r of rows) {
      const st = cardState(left(r.expiryDate), alert);
      out[st] = (out[st] || 0) + 1;
    }
    return out;
  } catch (e) { return null; }
}

exports.dashboard = async (req, res) => {
  try {
    const cacheKey = `vreg:dash:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return res.json(hit);

    await getConfig();
    const filter = buildFilter(req.query);
    const DASH_FIELDS = [
      'plateNumber sectorAr registrationTypeAr ownerCompanyAr brandAr modelAr ownerNameAr colorAr tamStatusAr modelYear accidentCount',
      'insurance.companyAr insurance.coverageTypeAr insurance.expiryDate insurance.premiumSar insurance.statusCode insurance.policyNumber',
      'fuelCard.provider fuelCard.statusAr fuelCard.statusCode fuelCard.consumptionTypeAr fuelCard.limitSar fuelCard.limitStatus fuelCard.cardNumber',
      'gps.deviceModel gps.provider gps.status gps.statusCode gps.expiryDate gps.serialImei',
      'operatingCard.cardNumber operatingCard.expiryDate operatingCard.statusCode',
      'vehicleLicense.expiryDate vehicleLicense.statusCode',
      'inspection.statusAr inspection.statusCode inspection.expiryDate',
    ].join(' ');
    const [vehicles, cfg] = await Promise.all([VehicleMaster.find(filter).select(DASH_FIELDS).lean(), getConfig()]);

    const count = (fn) => vehicles.reduce((m, v) => { const k = fn(v) || '—'; m[k] = (m[k] || 0) + 1; return m; }, {});
    const toArr = (obj, extra = {}) => Object.entries(obj).map(([key, value]) => ({ key, count: value, ...(extra[key] || {}) })).sort((a, b) => b.count - a.count);

    // Distributions
    const bySector = count((v) => v.sectorAr);
    const byRegistrationType = count((v) => v.registrationTypeAr);
    const byBrand = count((v) => v.brandAr);
    const byOwner = count((v) => v.ownerNameAr);
    const byInsuranceCompany = count((v) => v.insurance?.companyAr);
    const byCoverageType = count((v) => v.insurance?.coverageTypeAr);
    const byFuelCardStatus = count((v) => v.fuelCard?.statusAr);
    const byInspectionStatus = count((v) => v.inspection?.statusAr);
    const byColor = count((v) => v.colorAr);
    const byTamStatus = count((v) => v.tamStatusAr);
    const byModelYear = count((v) => (v.modelYear ? String(v.modelYear) : '—'));

    // Amounts
    const premiums = vehicles.map((v) => Number(v.insurance?.premiumSar) || 0).filter((x) => x > 0);
    const totalPremium = premiums.reduce((a, b) => a + b, 0);
    const fuelLimits = vehicles.map((v) => Number(v.fuelCard?.limitSar) || 0).filter((x) => x > 0);
    const totalFuelLimit = fuelLimits.reduce((a, b) => a + b, 0);

    // Document state buckets per type.
    // The 'upcoming' bucket is one of them. It had no slot here while `stateOf` returns it, so `b['upcoming']` was `undefined += 1`, i.e. `NaN`: a non-numeric slot was planted in the object and no vehicle of that bucket counted in the dashboard bars, so the percentages fell short by the whole bucket. `+= 1` on an unknown slot also hides any error, so the sum is built with a readable key rather than a pre-set slot.
    const docBuckets = {};
    for (const dt of DOC_TYPES) {
      const b = { expired: 0, critical: 0, warning: 0, upcoming: 0, valid: 0, none: 0, not_required: 0 };
      const alert = cfg.alerts?.[dt.key];
      for (const v of vehicles) {
        const st = docStatus(getPath(v, dt.path), alert, getPath(v, dt.statusPath)).status;
        b[st] = (b[st] || 0) + 1;
      }
      docBuckets[dt.key] = b;
    }

    // Top indicators
    const withGps = vehicles.filter(hasGps).length;
    const missingInsurance = vehicles.filter((v) => !v.insurance?.expiryDate).length;
    const missingOperatingCard = vehicles.filter((v) => !v.operatingCard?.cardNumber).length;
    const activeFuelCards = vehicles.filter((v) => v.fuelCard?.statusCode === 'active').length;

    // Total alerts (expired + within threshold) across all enabled documents
    let expiredTotal = 0; let expiringTotal = 0;
    for (const dt of DOC_TYPES) {
      if (dt.key === 'gps' && !cfg.alerts?.gps?.enabled) continue;
      const b = docBuckets[dt.key];
      expiredTotal += b.expired;
      // 'Upcoming' counts as an alert: it is the last window in which a replacement is obtained without rush, and it used to be subtracted from the total so the count read lower than it is.
      expiringTotal += b.critical + b.warning + b.upcoming;
    }

    const body = {
      // Thresholds are sent with the dashboard: its buttons navigate to the list with them, so the 'critical' button does not jump with 30 days when critical was set to 10.
      alerts: cfg.alerts,
      totals: {
        vehicles: vehicles.length,
        totalPremium: Math.round(totalPremium),
        avgPremium: premiums.length ? Math.round(totalPremium / premiums.length) : 0,
        totalFuelLimit: Math.round(totalFuelLimit),
        activeFuelCards, withGps, missingInsurance, missingOperatingCard,
        expiredTotal, expiringTotal,
        sectors: Object.keys(bySector).length, brands: Object.keys(byBrand).length, owners: Object.keys(byOwner).length,
      },
      bySector: toArr(bySector), byRegistrationType: toArr(byRegistrationType), byBrand: toArr(byBrand),
      byOwner: toArr(byOwner), byInsuranceCompany: toArr(byInsuranceCompany), byCoverageType: toArr(byCoverageType),
      byFuelCardStatus: toArr(byFuelCardStatus), byInspectionStatus: toArr(byInspectionStatus),
      byColor: toArr(byColor), byTamStatus: toArr(byTamStatus), byModelYear: toArr(byModelYear),
      docBuckets,
      // Driver cards on the dashboard.
      // A card is a document that expires like the section's other documents, so it sits where document state is read, not on a page only those who remember it open.
      driverCards: await driverCardSummary(cfg.alerts?.driverCard),
    };
    cache.set(cacheKey, body, 30000);
    res.json(body);
  } catch (e) { console.error('vreg dashboard', e); res.status(500).json({ message: 'Failed to load dashboard' }); }
};

// Alerts: every document within its threshold or expired.
exports.alerts = async (req, res) => {
  try {
    const hit = cache.get('vreg:alerts');
    if (hit !== undefined) return res.json(hit);

    // The **same** computation as the expiry screen; alerts are only a filter over it, not a second calculation. A different function used to make the numbers differ between the two screens on the same data.
    const all = await buildExpiryRows({});
    // 'On the radar' enters alerts: 24 documents used to drop off the screen entirely because their expiry was beyond the warning threshold, then appeared suddenly already critical.
    const ALERT_STATES = ['expired', 'critical', 'warning', 'upcoming'];

    const items = all
      .filter((r) => ALERT_STATES.includes(r.state))
      .map((r) => ({
        vehicleId: r.vehicleId, plateNumber: r.plateNumber, brandAr: r.brandAr, modelAr: r.modelAr,
        sectorAr: r.sectorAr, ownerNameAr: r.ownerNameAr,
        docType: r.docKey, docAr: r.docAr, docEn: r.docEn,
        expiryDate: r.expiryDate, daysRemaining: r.daysRemaining, status: r.state,
        // A document whose alert is disabled stays visible and marked. It used to vanish silently, so an actually expired document was missing here yet visible in expiry.
        alertEnabled: r.alertEnabled,
      }));

    items.sort((a, b) => (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0));
    const byStatus = { expired: 0, critical: 0, warning: 0, upcoming: 0 };
    const byDoc = {};
    for (const it of items) { byStatus[it.status] += 1; byDoc[it.docType] = (byDoc[it.docType] || 0) + 1; }
    const muted = items.filter((i) => !i.alertEnabled).length;
    const body = {
      items, total: items.length, byStatus, byDoc,
      // So the screen can say how many of them have their alert disabled in settings.
      mutedCount: muted,
    };
    cache.set('vreg:alerts', body, 30000);
    res.json(body);
  } catch (e) { console.error('vreg alerts', e); res.status(500).json({ message: 'Failed to load alerts' }); }
};

/**
 * The threshold is shown with its effect.
 * A user set critical to 20, saved, and found critical 0, warning 0 and upcoming 0 on the vehicle insurance page, apparently unrelated to the setting.
 * The zeros were literally correct: the nearest valid insurance expires in eighty days and its 'upcoming' starts at sixty, so no vehicle is in any of the three buckets, while five are already expired. But the screen did not say so, and the owner could not tell 'threshold not saved' from 'nothing falls in this bucket today'.
 * Now the result is returned with the thresholds: how many documents fall in each bucket under these numbers, computed by the same function the pages use (`stateOf`). The effect is visible where it is set, and a real zero is distinguishable from a suspicious one.
 */
exports.getSettings = async (req, res) => {
  try {
    const cfg = await getConfig();
    const counts = {};
    const bump = (k, st) => { counts[k] = counts[k] || {}; counts[k][st] = (counts[k][st] || 0) + 1; };

    const vehicles = await VehicleMaster.find({}).select(
      DOC_TYPES.map((d) => `${d.path} ${d.statusPath || ''}`).join(' '),
    ).lean();
    for (const dt of DOC_TYPES) {
      const alert = cfg.alerts?.[dt.key];
      for (const v of vehicles) bump(dt.key, docStatus(getPath(v, dt.path), alert, getPath(v, dt.statusPath)).status);
    }

    // Driver cards and company documents are two other registers; their threshold is set here too.
    try {
      const cards = await require('../models/DriverCard').find({ isActive: { $ne: false } }).select('expiryDate').lean();
      for (const c of cards) bump('driverCard', cardState(cardDaysLeft(c.expiryDate), cfg.alerts?.driverCard));
    } catch (e) { /* The register may be empty */ }
    try {
      const pols = await VehicleInsurancePolicy.find({}).select('expiryDate').lean();
      for (const pl of pols) bump('corporatePolicy', VDOC.stateOf(pl.expiryDate, '', cfg.alerts?.corporatePolicy || {}).state);
    } catch (e) { /* Same */ }

    res.json({ config: { alerts: cfg.alerts }, counts });
  } catch (e) {
    console.error('getSettings error:', e);
    res.status(500).json({ message: 'Failed to load settings' });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    // Sanitize the input: known documents only, positive numbers, and 'critical' not greater than 'alert'; otherwise the orange alert would vanish and nobody would notice.
    const incoming = req.body.alerts || {};
    // The driver card is among them: the screen shows it, so it is accepted and saved. See `alerts` in models/VehicleMaster.
    const keys = [...VDOC.DOC_KEYS, 'corporatePolicy', 'driverCard'];
    const clean = {};
    const problems = [];
    for (const k of keys) {
      const a = incoming[k];
      if (!a) continue;
      const warn = Math.max(0, Math.min(3650, Number(a.warnDays)));
      const crit = Math.max(0, Math.min(3650, Number(a.criticalDays)));
      if (!Number.isFinite(warn) || !Number.isFinite(crit)) { problems.push(k); continue; }
      // 'On the radar' is a third horizon read by `stateOf`, and it used to be dropped here and replaced by its default on every save: a user sets the insurance horizon to 180 days, changes another threshold, and the horizon reverts to 90 untouched.
      const soonRaw = Number(a.soonDays);
      const soon = Number.isFinite(soonRaw) ? Math.max(0, Math.min(3650, soonRaw)) : 90;
      // Silent clipping reads as 'not saved'.
      // The rule is sound: critical is inside alert and the radar is wider. But a violating input was clipped without notice: the user typed critical 30 and alert 20, critical was saved as 20, the screen reopened with the number unchanged, and they concluded settings do not work.
      // So the request is rejected with the reason and the user corrects it.
      const label = (VDOC.getDoc(k) || {}).ar || k;
      if (crit > warn) { problems.push(`${label}: الحرج (${crit}) لا يتجاوز التنبيه (${warn})`); continue; }
      if (Number.isFinite(soonRaw) && soon < warn) { problems.push(`${label}: «على الرادار» (${soon}) لا يقلّ عن التنبيه (${warn})`); continue; }
      clean[k] = {
        enabled: a.enabled !== false,
        warnDays: warn,
        criticalDays: crit,
        soonDays: Math.max(soon, warn),
      };
    }
    if (problems.length) return res.status(400).json({ message: problems.join(' · ') });

    // Only what was sent is written.
    // `$set: { alerts: clean }` replaced the whole tree, so any key the browser did not send was deleted from the database. Reading with `.lean()` does not apply defaults, so a deleted key stays deleted and every reader falls back to the 7/30/90 hard-coded in the code, and its thresholds display switched off and uneditable.
    // So each key is written at its own path.
    const $set = { updatedBy: req.user?._id };
    for (const [k, val] of Object.entries(clean)) $set[`alerts.${k}`] = val;
    const cfg = await VehicleRegistryConfig.findOneAndUpdate(
      { key: 'vehicle-registry' },
      { $set, $setOnInsert: { key: 'vehicle-registry' } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();

    logAudit({
      user: req.user, action: 'update_vehicle_alert_settings', entity: 'VehicleRegistryConfig',
      entityKey: 'vehicle-registry', changes: { after: clean }, ipAddress: req.ip,
    }).catch(() => {});

    emit('vreg:updated', {});
    res.json({ config: { alerts: cfg.alerts } });
  } catch (e) { res.status(500).json({ message: 'Failed to save settings' }); }
};

// Overview: a card per column, all clickable.
/** Every master column becomes a card: the distribution with its values, and how many are 'required', 'not required' and 'none'. The idea is the owner looks once and sees everything, and any number clicked opens the page filtered on it, so each group returns a ready `filter` to send to the list. */
// Available filters, their values, and derived analytics.
// Same principle as HR: the screen does not hold its own filter list. The server says which fields exist, which values actually exist, and the count of each **after the other filters**, so what the menu shows is what clicking it returns, and an option with zero count never appears.
// When computing a field's values, all filters except that field are applied; otherwise only the selected value would remain visible and nobody could add a second value to the selection.
const FILTER_DEFS = [
  { key: 'sector', field: 'sectorAr', ar: 'القطاع', en: 'Sector', groupAr: 'التصنيف', groupEn: 'Classification' },
  { key: 'department', field: 'departmentAr', ar: 'الإدارة', en: 'Department', groupAr: 'التصنيف', groupEn: 'Classification' },
  { key: 'city', field: 'cityAr', ar: 'المدينة', en: 'City', groupAr: 'التصنيف', groupEn: 'Classification' },
  { key: 'registrationType', field: 'registrationTypeAr', ar: 'نوع التسجيل', en: 'Registration type', groupAr: 'التصنيف', groupEn: 'Classification' },
  // The group is two companies, and the fleet is shared in operation but separate in ownership, so 'show the Tanshit Al-Mustaqbal vehicles' is a management question, not a luxury classification.
  { key: 'ownerCompany', field: 'ownerCompanyAr', ar: 'الشركة المالكة', en: 'Owning company', groupAr: 'التصنيف', groupEn: 'Classification' },
  { key: 'possession', field: 'possessionStatusAr', ar: 'حالة الحيازة', en: 'Possession', groupAr: 'التصنيف', groupEn: 'Classification' },
  // Operating state: the first question management asks, and the last that used to have a screen answering it.
  { key: 'serviceStatus', field: 'serviceStatusAr', ar: 'حالة التشغيل', en: 'Service status', groupAr: 'التصنيف', groupEn: 'Classification' },
  { key: 'brand', field: 'brandAr', ar: 'الماركة', en: 'Brand', groupAr: 'المركبة', groupEn: 'Vehicle' },
  { key: 'model', field: 'modelAr', ar: 'الطراز', en: 'Model', groupAr: 'المركبة', groupEn: 'Vehicle' },
  { key: 'color', field: 'colorAr', ar: 'اللون', en: 'Colour', groupAr: 'المركبة', groupEn: 'Vehicle' },
  { key: 'modelYear', field: 'modelYear', ar: 'سنة الصنع', en: 'Model year', groupAr: 'المركبة', groupEn: 'Vehicle' },
  { key: 'owner', field: 'ownerNameAr', ar: 'المالك', en: 'Owner', groupAr: 'الملكية والتفويض', groupEn: 'Ownership' },
  { key: 'commercialRegistration', field: 'commercialRegistration', ar: 'السجل التجاري', en: 'Commercial register', groupAr: 'الملكية والتفويض', groupEn: 'Ownership' },
  { key: 'authorizedPerson', field: 'authorizedPerson.name', ar: 'المفوَّض', en: 'Authorised person', groupAr: 'الملكية والتفويض', groupEn: 'Ownership' },
  // The paper's number is a filter like its holder's name.
  // 'Give me the vehicle with this number' is the first question when a violation or invoice arrives: the paper is in hand with a number and the vehicle is the unknown. These numbers were accepted by `buildFilter` from the start but were absent from the dashboard, so only someone typing the link by hand could reach them.
  { key: 'authorizedPersonIqama', field: 'authorizedPerson.iqamaNumber', ar: 'رقم إقامة المفوَّض', en: 'Authorised person iqama', groupAr: 'الملكية والتفويض', groupEn: 'Ownership' },
  { key: 'authorizationNumber', field: 'authorizedPerson.authorizationNumber', ar: 'رقم التفويض', en: 'Authorisation number', groupAr: 'الملكية والتفويض', groupEn: 'Ownership' },
  { key: 'insuranceCompany', field: 'insurance.companyAr', ar: 'شركة التأمين', en: 'Insurer', groupAr: 'التأمين', groupEn: 'Insurance' },
  { key: 'coverageType', field: 'insurance.coverageTypeAr', ar: 'نوع التغطية', en: 'Coverage', groupAr: 'التأمين', groupEn: 'Insurance' },
  // A document number is a real filter: one policy covers 198 vehicles, and 'show everything this policy covers' is the question that precedes every renewal.
  { key: 'insurancePolicyNumber', field: 'insurance.policyNumber', ar: 'رقم وثيقة التأمين', en: 'Policy number', groupAr: 'التأمين', groupEn: 'Insurance' },
  { key: 'premiumStatus', field: 'insurance.premiumStatusAr', ar: 'جهة سداد القسط', en: 'Premium paid by', groupAr: 'التأمين', groupEn: 'Insurance' },
  { key: 'operatingCardNumber', field: 'operatingCard.cardNumber', ar: 'رقم بطاقة التشغيل', en: 'Operating card number', groupAr: 'المستندات', groupEn: 'Documents' },
  { key: 'inspectionStatus', field: 'inspection.statusAr', ar: 'حالة الفحص', en: 'Inspection status', groupAr: 'المستندات', groupEn: 'Documents' },
  { key: 'tamStatus', field: 'tamStatusAr', ar: 'حالة تم', en: 'TAM status', groupAr: 'المستندات', groupEn: 'Documents' },
  { key: 'fuelCardStatus', field: 'fuelCard.statusAr', ar: 'حالة بطاقة الوقود', en: 'Fuel card status', groupAr: 'التشغيل', groupEn: 'Operations' },
  { key: 'consumptionType', field: 'fuelCard.consumptionTypeAr', ar: 'نوع الاستهلاك', en: 'Consumption type', groupAr: 'التشغيل', groupEn: 'Operations' },
  { key: 'fuelCard', field: 'fuelCard.cardNumber', ar: 'رقم شريحة بترو اب', en: 'Fuel card number', groupAr: 'التشغيل', groupEn: 'Operations' },
  { key: 'gpsProvider', field: 'gps.provider', ar: 'مزوّد التتبّع', en: 'GPS provider', groupAr: 'التشغيل', groupEn: 'Operations' },
  { key: 'gpsSerial', field: 'gps.serialImei', ar: 'سريال جهاز التتبّع', en: 'GPS serial', groupAr: 'التشغيل', groupEn: 'Operations' },
  { key: 'gpsDevice', field: 'gps.deviceModel', ar: 'طراز جهاز التتبّع', en: 'GPS device', groupAr: 'التشغيل', groupEn: 'Operations' },
  { key: 'gpsDeviceStatus', field: 'gps.deviceStatusAr', ar: 'حالة جهاز التتبّع', en: 'GPS device status', groupAr: 'التشغيل', groupEn: 'Operations' },
];

// The fields all filters need, as one projection: a single query covers them all. Fetching the whole document for 300 vehicles on every dashboard open is unnecessary transfer on the throttled Atlas cluster, which is what this screen's slowness is measured by.
const FILTER_SELECT = [...new Set([
  ...FILTER_DEFS.map((d) => d.field),
  ...DERIVED_DEFS.flatMap((d) => d.select || []),
])].join(' ');

// Why two groups, not one.
// Direct filters are value counts, and counting runs in the database: one row returns per value instead of 300 vehicles crossing the network to be counted here. Derived filters have JavaScript function conditions (time left on a document, what is missing) that do not translate to an aggregation, so only they pull rows, and only their own fields: 14 fields, not 46.
// The dashboard used to pull the whole union for every active filter, nine seconds per open.
const DERIVED_SELECT = [...new Set(DERIVED_DEFS.flatMap((d) => d.select || []))].join(' ');
// Derived rows come from a mirror updated by diff: every write clears `vreg:`, so the next open pulled the whole fleet again (two to three seconds), as did every active filter. Now only the ids are queried. See utils/changeStamp.
const derivedMirror = require('../utils/changeStamp').mirror(VehicleMaster, DERIVED_SELECT);

const _get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

exports.filterOptions = async (req, res) => {
  try {
    const key = `vreg:filters:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);
    await getConfig(); // Alert thresholds for the document-state filters (see ALERTS)

    const tally = (rows, field) => {
      const counts = new Map();
      for (const r of rows) {
        const raw = _get(r, field);
        const v = (raw === null || raw === undefined || raw === '') ? '—' : String(raw);
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
    };

    // 'All filters except this field' really differs only for fields currently filtered; the rest share one group. One query for all of them plus one per active filter, instead of eighteen queries on every dashboard open.
    // Derived buckets are counted with the same condition function that opens their rows: one definition for both, so the number never diverges from what it opens. A value whose count is zero is not shown: an option that opens an empty screen is worse than none.
    const tallyDerived = (rows, d) => {
      if (d.valuesOf) {
        const m = new Map();
        // Values are multiple per vehicle (missing items, Logisti requirements): a vehicle is counted under each item it lacks, so this bucket's sum exceeds the vehicle count; that is correct here and only here.
        for (const r of rows) for (const v of d.valuesOf(r)) m.set(v, (m.get(v) || 0) + 1);
        return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
      }
      // Bucket order is definition order, not count order: 'expired' before 'within 30' before '31 to 60' is a readable ladder, and sorting by count destroys its meaning.
      return d.options.map((o) => ({ value: o.value, count: rows.filter(o.test).length }))
        .filter((x) => x.count > 0);
    };

    const ALL_DEFS = [...FILTER_DEFS, ...DERIVED_DEFS];
    const isOn = (k) => req.query[k] != null && req.query[k] !== '';
    const active = ALL_DEFS.filter((d) => isOn(d.key));
    const passive = ALL_DEFS.filter((d) => !isOn(d.key));
    // Value counts for every direct field in a single pass over the database.
    const plainTally = async (filter) => {
      const facet = {};
      FILTER_DEFS.forEach((d, i) => {
        facet[`f${i}`] = [
          { $group: { _id: { $ifNull: [`$${d.field}`, '—'] }, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ];
      });
      const [r] = await VehicleMaster.aggregate([{ $match: filter }, { $facet: facet }]);
      const out = new Map();
      FILTER_DEFS.forEach((d, i) => {
        // Values differing only by blank are one row, and blank alone is the dash.
        out.set(d.key, mergeOptions(((r && r[`f${i}`]) || []).map((b) => ({ value: b._id, count: b.count })),
          // A null arrives as the dash (from $ifNull) and the empty string '' is also the dash; they are the same dash.
          { keyOf: (v) => { const k = normKey(v); return k === '—' ? '' : k; } })
          .map((o) => ({ value: o.value === '' ? '—' : o.value, count: o.count }))
          .sort((a, b) => b.count - a.count));
      });
      return out;
    };

    const needRows = passive.some((d) => !d.field) || active.some((d) => !d.field);
    const [sharedPlain, shared] = await Promise.all([
      passive.length ? plainTally(buildFilter(req.query)) : new Map(),
      needRows && passive.length
        ? derivedMirror.rowsFor(buildFilter(req.query))
        : [],
    ]);
    const perActive = new Map(); const perActivePlain = new Map();
    await Promise.all(active.map(async (d) => {
      const others = { ...req.query };
      delete others[d.key];
      const f = buildFilter(others);
      if (d.field) perActivePlain.set(d.key, (await plainTally(f)).get(d.key) || []);
      else perActive.set(d.key, await derivedMirror.rowsFor(f));
    }));

    const filters = ALL_DEFS.map((d) => ({
      key: d.key, ar: d.ar, en: d.en, groupAr: d.groupAr, groupEn: d.groupEn,
      values: d.field
        ? (perActivePlain.get(d.key) || sharedPlain.get(d.key) || [])
        : tallyDerived(perActive.get(d.key) || shared, d),
    })).filter((f) => f.values.length);
    // Archived authorized people's names are not offered as options.
    const archSets = await endedStaff();
    if (archSets.archivedIdNumbers.size) {
      const gone = await VehicleMaster.find({ 'authorizedPerson.iqamaNumber': { $in: [...archSets.archivedIdNumbers] } })
        .select('authorizedPerson.name authorizedPerson.iqamaNumber').lean();
      const goneVals = new Set(gone.flatMap((v) => [S(v.authorizedPerson?.name), S(v.authorizedPerson?.iqamaNumber)]).filter(Boolean));
      for (const f of filters) {
        if (f.key === 'authorizedPerson' || f.key === 'authorizedPersonIqama') f.values = f.values.filter((x) => !goneVals.has(S(x.value)));
      }
    }
    const body = { filters };
    // Twenty seconds meant cold every time.
    // The dashboard opens once every few minutes, so the cache expired before the next open and nobody benefited. Every write on the registry clears all of `vreg:` (see `emit` at the top of the file), so a longer TTL does not keep a stale number; it keeps a correct one ready. Five minutes makes the second open instant for everyone.
    cache.set(key, body, 5 * 60 * 1000);
    res.json(body);
  } catch (e) {
    console.error('vreg filterOptions', e);
    res.status(500).json({ message: 'تعذّر تحميل الفلاتر' });
  }
};

/**
 * Derived analytics: each document's expiry horizons, and vehicle ages.
 * Each bucket carries the **filter that reproduces it exactly**, so clicking it opens its rows without the UI guessing the condition, and the displayed number never diverges from the rows it opens.
 */
const _iso = (d) => d.toISOString().slice(0, 10);
const _shiftDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return _iso(d); };

const buildVehicleAnalytics = (vehicles) => {
  const out = [];
  for (const dt of DOC_TYPES) {
    const mk = (ar, en, from, to) => {
      const f = { expiryDoc: dt.key };
      if (from) f.expiryFrom = from;
      if (to) f.expiryTo = to;
      const count = vehicles.filter((v) => {
        const raw = getPath(v, dt.path);
        if (!raw) return false;
        const d = new Date(raw);
        if (isNaN(d)) return false;
        const s = _iso(d);
        return (!from || s >= from) && (!to || s <= to);
      }).length;
      return { label: ar, labelEn: en, count, filter: f };
    };
    const items = [
      // 'Expired' ends yesterday and 'within 30' starts today; without the split a document expiring today would be counted in both and the bucket sum would exceed the vehicle count.
      mk('منتهٍ', 'Expired', null, _shiftDays(-1)),
      mk('خلال ٣٠ يومًا', 'Within 30d', _shiftDays(0), _shiftDays(30)),
      mk('٣١ إلى ٦٠ يومًا', '31–60d', _shiftDays(31), _shiftDays(60)),
      mk('٦١ إلى ٩٠ يومًا', '61–90d', _shiftDays(61), _shiftDays(90)),
      mk('أبعد من ٩٠ يومًا', 'Beyond 90d', _shiftDays(91), null),
    ];
    const dated = vehicles.filter((v) => { const r = getPath(v, dt.path); return r && !isNaN(new Date(r)); }).length;
    items.push({ label: 'بلا تاريخ مسجَّل', labelEn: 'No date', count: vehicles.length - dated, filter: { missingDocDate: dt.key } });
    out.push({ key: `hz:${dt.key}`, ar: `انتهاء ${dt.ar}`, en: `${dt.en} expiry`, kind: 'horizon', items });
  }

  // Vehicle ages: model year is a number from which age is not readable by eye.
  const year = new Date().getFullYear();
  const AGE = [
    { ar: 'أقل من ٣ سنوات', en: 'Under 3y', from: year - 2, to: null },
    { ar: '٣ إلى ٥ سنوات', en: '3–5y', from: year - 5, to: year - 3 },
    { ar: '٦ إلى ١٠ سنوات', en: '6–10y', from: year - 10, to: year - 6 },
    { ar: 'أكثر من ١٠ سنوات', en: 'Over 10y', from: null, to: year - 11 },
  ].map((b) => {
    const f = {};
    if (b.from) f.yearFrom = String(b.from);
    if (b.to) f.yearTo = String(b.to);
    const count = vehicles.filter((v) => {
      const y = Number(v.modelYear);
      if (!y) return false;
      return (!b.from || y >= b.from) && (!b.to || y <= b.to);
    }).length;
    return { label: b.ar, labelEn: b.en, count, filter: f };
  });
  AGE.push({
    label: 'بلا سنة صنع', labelEn: 'No model year',
    count: vehicles.filter((v) => !Number(v.modelYear)).length, filter: { modelYear: '—' },
  });
  out.push({ key: 'age', ar: 'أعمار المركبات', en: 'Vehicle age', kind: 'bar', items: AGE });
  return out;
};

/**
 * Filter dashboard warm-up.
 * The first click on 'filter' paid for the cold connection and the derived-row read together while the user waited. The common case (no active filter) is a single result that changes only on a write, so it is computed once after boot and kept ready.
 */
exports.warmFilters = async () => {
  try {
    const fake = { query: {}, user: null };
    await new Promise((resolve) => {
      exports.filterOptions(fake, { json: resolve, status: () => ({ json: resolve }) });
    });
    // The expiry mirror too: its first open used to pay the transfer of the whole fleet.
    await expiryMirror.sync();
  } catch (e) { /* Warm-up is a nicety, not a requirement */ }
};

exports.overview = async (req, res) => {
  try {
    const key = `vreg:overview:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    await getConfig(); // Before buildFilter; see ALERTS
    const filter = buildFilter(req.query);
    const [vehicles, cfg, allClaims, policies] = await Promise.all([
      VehicleMaster.find(filter).select(AGG_FIELDS).lean(),
      getConfig(),
      // Requested fields are the ones actually read, not near-names.
      // The projection was `status cost date`, and the model has no fields by those names, so every claim returned without `statusCode`, `claim` or `faultPercent`, and `undefined !== 'closed'` is always true: every claim counted as open. The dashboard said 25 open and opened on seven, and the amounts were zero because `claim` was never read. They are now requested by their model names.
      VehicleClaim.find({ isActive: true })
        .select('vehiclePlateKey vehiclePlate statusCode faultPercent accidentDate claim isActive').lean(),
      CorporatePolicy.find({ isActive: true }).lean(),
    ]);

    // Accidents are limited to the vehicles matching the filter.
    // They used to be computed on the whole fleet whatever the filter, so choosing a branch showed the whole company's accident count and amounts above that branch's vehicles, with nothing on screen saying so. The join is on the unified plate key because accidents are recorded by plate, not by vehicle id.
    // The join applies only when a filter is actually active.
    // Without a filter the join dropped every accident with no plate key (accidents not linked to a vehicle, or unmatched at import), making the total lower than the fleet's truth with nothing saying so. That is the same fault the join was added to fix. The unmatched count is reported rather than swallowed.
    const filtered = Object.keys(req.query || {}).some((k) => !['scope'].includes(k) && req.query[k] !== '');
    const plateKeys = new Set(vehicles.map((v) => v.plateKey).filter(Boolean));
    const claims = filtered
      ? allClaims.filter((c) => plateKeys.has(c.vehiclePlateKey))
      : allClaims;
    const unmatchedClaims = filtered ? 0 : allClaims.filter((c) => !c.vehiclePlateKey).length;

    // Column distribution: value to count, sorted, each value with the filter that reaches it.
    const group = (field, valueOf) => {
      const m = new Map();
      for (const v of vehicles) {
        const raw = valueOf(v);
        const k = raw === null || raw === undefined || raw === '' ? '—' : String(raw);
        m.set(k, (m.get(k) || 0) + 1);
      }
      return [...m.entries()]
        .map(([value, count]) => ({ value, count, filter: { [field]: value === '—' ? '' : value } }))
        .sort((a, b) => b.count - a.count);
    };

    // Classification cards, column by column.
    const breakdowns = [
      { key: 'sector', ar: 'القطاع', en: 'Sector', field: 'sectorAr', items: group('sectorAr', (v) => v.sectorAr) },
      // Came with the section files update: department and city are more precise than the sector alone; 'Keeta vehicles in Makkah' is a real question that no card answered.
      { key: 'department', ar: 'الإدارة', en: 'Department', field: 'departmentAr', items: group('departmentAr', (v) => v.departmentAr) },
      { key: 'city', ar: 'المدينة', en: 'City', field: 'cityAr', items: group('cityAr', (v) => v.cityAr) },
      { key: 'possession', ar: 'حالة الحيازة', en: 'Possession', field: 'possessionStatusAr', items: group('possessionStatusAr', (v) => v.possessionStatusAr) },
      // Operating state before any other classification: a quarter of the fleet is stopped or stolen, and no card on the page said so.
      { key: 'serviceStatus', ar: 'حالة التشغيل', en: 'Service status', field: 'serviceStatusAr', items: group('serviceStatusAr', (v) => v.serviceStatusAr) },
      { key: 'registrationType', ar: 'نوع التسجيل', en: 'Registration type', field: 'registrationTypeAr', items: group('registrationTypeAr', (v) => v.registrationTypeAr) },
      { key: 'ownerCompany', ar: 'الشركة المالكة', en: 'Owning company', field: 'ownerCompanyAr', items: group('ownerCompanyAr', (v) => v.ownerCompanyAr) },
      { key: 'brand', ar: 'الماركة', en: 'Brand', field: 'brandAr', items: group('brandAr', (v) => v.brandAr) },
      { key: 'model', ar: 'الموديل', en: 'Model', field: 'modelAr', items: group('modelAr', (v) => v.modelAr) },
      { key: 'modelYear', ar: 'سنة الصنع', en: 'Model year', field: 'modelYear', items: group('modelYear', (v) => v.modelYear) },
      { key: 'color', ar: 'اللون', en: 'Colour', field: 'colorAr', items: group('colorAr', (v) => v.colorAr) },
      { key: 'owner', ar: 'المالك', en: 'Owner', field: 'ownerNameAr', items: group('ownerNameAr', (v) => v.ownerNameAr) },
      { key: 'tamStatus', ar: 'حالة تم', en: 'TAM status', field: 'tamStatusAr', items: group('tamStatusAr', (v) => v.tamStatusAr) },
      { key: 'insuranceCompany', ar: 'شركة التأمين', en: 'Insurer', field: 'insurance.companyAr', items: group('insurance.companyAr', (v) => v.insurance?.companyAr) },
      { key: 'coverageType', ar: 'نوع التغطية', en: 'Coverage', field: 'insurance.coverageTypeAr', items: group('insurance.coverageTypeAr', (v) => v.insurance?.coverageTypeAr) },
      { key: 'fuelCardStatus', ar: 'حالة شريحة الوقود', en: 'Fuel card', field: 'fuelCard.statusAr', items: group('fuelCard.statusAr', (v) => v.fuelCard?.statusAr) },
      { key: 'consumptionType', ar: 'نوع الاستهلاك', en: 'Consumption', field: 'fuelCard.consumptionTypeAr', items: group('fuelCard.consumptionTypeAr', (v) => v.fuelCard?.consumptionTypeAr) },
      // Premium payer: vehicles whose premium the financier pays are insured with the number held by him, and used to read as 'no premium', showing a gap that does not exist.
      { key: 'premiumStatus', ar: 'جهة سداد القسط', en: 'Premium paid by', field: 'insurance.premiumStatusAr', items: group('insurance.premiumStatusAr', (v) => v.insurance?.premiumStatusAr) },
      { key: 'gpsStatus', ar: 'حالة جهاز التتبّع', en: 'GPS status', field: 'gps.status', items: group('gps.status', (v) => v.gps?.status) },
      { key: 'gpsProvider', ar: 'مزوّد التتبّع', en: 'GPS provider', field: 'gps.provider', items: group('gps.provider', (v) => v.gps?.provider) },
      { key: 'gpsDevice', ar: 'موديل جهاز التتبّع', en: 'GPS device', field: 'gps.deviceModel', items: group('gps.deviceModel', (v) => v.gps?.deviceModel) },
      // Device state differs from subscription state: a 'stolen' device may have a valid subscription.
      { key: 'gpsDeviceStatus', ar: 'حالة الجهاز', en: 'Device status', field: 'gps.deviceStatusAr', items: group('gps.deviceStatusAr', (v) => v.gps?.deviceStatusAr) },
      { key: 'inspectionStatus', ar: 'حالة الفحص', en: 'Inspection', field: 'inspection.statusAr', items: group('inspection.statusAr', (v) => v.inspection?.statusAr) },
    ];

    // A card per document: computed states plus administrative states (required / not required / none).
    const documents = DOC_TYPES.map((dt) => {
      const states = { valid: 0, warning: 0, critical: 0, upcoming: 0, expired: 0, missing: 0, not_applicable: 0 };
      const statuses = {};
      let nearest = null;
      for (const v of vehicles) {
        const st = VDOC.stateOf(getPath(v, dt.path), getPath(v, dt.statusPath), cfg.alerts?.[dt.key]);
        states[st.state] += 1;
        const sc = getPath(v, dt.statusPath) || '';
        statuses[sc] = (statuses[sc] || 0) + 1;
        if (st.days != null && st.days >= 0 && (nearest === null || st.days < nearest)) nearest = st.days;
      }
      return {
        key: dt.key, ar: dt.ar, en: dt.en, icon: dt.icon,
        alert: cfg.alerts?.[dt.key] || {},
        states,
        // By the name as in the Excel sheet: required / not required / none / with the bank, etc.
        statuses: Object.entries(statuses)
          .map(([code, count]) => ({ code, ar: VDOC.statusLabel(code, 'ar'), en: VDOC.statusLabel(code, 'en'), count }))
          .sort((a, b) => b.count - a.count),
        needsAttention: states.expired + states.critical + states.warning,
        nearestDays: nearest,
      };
    });

    // The driver card is a seventh card.
    // The dashboard shows six cards for vehicle papers and the driver card is not among them, so it was absent from the dashboard as from the expiry screen: fifty-seven cards, four expiring within days, invisible to anyone opening the overview.
    // It is not shown when the dashboard is filtered by something vehicle-specific (sector or owner): a driver does not belong to a vehicle sector, and a card that stays constant while the rest move reads wrongly as part of the filter. See buildExpiryRows.
    if (!filtered) {
      const DriverCard = require('../models/DriverCard');
      const [allCards, ended] = await Promise.all([
        DriverCard.find({ isActive: { $ne: false } }).select('expiryDate cardNumber employee idNumber').lean(),
        endedStaff(),
      ]);
      const cards = allCards.filter((c) => !cardEnded(ended, c));
      const dcStates = { valid: 0, warning: 0, critical: 0, upcoming: 0, expired: 0, missing: 0, not_applicable: 0 };
      let dcNearest = null;
      for (const c of cards) {
        // Without a date it is 'required': pending work, which is what `missing` means here.
        const st = VDOC.stateOf(c.expiryDate || null, '', cfg.alerts?.driverCard);
        dcStates[st.state] += 1;
        if (st.days != null && st.days >= 0 && (dcNearest === null || st.days < dcNearest)) dcNearest = st.days;
      }
      documents.push({
        key: 'driverCard', ar: 'بطاقة السائق', en: 'Driver card', icon: 'driverCard',
        alert: cfg.alerts?.driverCard || {},
        states: dcStates,
        statuses: [],
        needsAttention: dcStates.expired + dcStates.critical + dcStates.warning,
        nearestDays: dcNearest,
      });
    }

    // Top numbers.
    const totals = {
      vehicles: vehicles.length,
      insuredPremiumSar: Math.round(vehicles.reduce((t, v) => t + (Number(v.insurance?.premiumSar) || 0), 0)),
      withGps: vehicles.filter(hasGps).length,
      activeFuelCards: vehicles.filter((v) => v.fuelCard?.statusCode === 'active').length,
      withAccidents: vehicles.filter((v) => (v.accidentCount || 0) > 0).length,
      needsAttention: documents.reduce((t, d) => t + d.needsAttention, 0),
      // Logisti platform gaps: how many vehicles fail the platform requirements, and how many requirements are missing in total. The second number is the real workload, since one vehicle may lack three requirements.
      withLogistiGaps: vehicles.filter((v) => (v.logistiGaps || []).length > 0).length,
      logistiGapItems: vehicles.reduce((t, v) => t + (v.logistiGaps || []).length, 0),
      // Data gaps: how many vehicles lack something, how many items in total, and how many of them are actual **work required**. 'Not required' is a healthy state and is not a gap; mixing it in makes the number the manager reads meaningless.
      withMissing: vehicles.filter((v) => (v.missingItems || []).some((x) => VDOC.isGap(x.reason))).length,
      missingItems: vehicles.reduce((t, v) => t + (v.missingItems || []).filter((x) => VDOC.isGap(x.reason)).length, 0),
    };

    // Gaps grouped by item then reason: 'operating card: 44 required and 72 none' are two different pieces of work, not one number.
    const missingMap = new Map();
    for (const v of vehicles) {
      for (const it of v.missingItems || []) {
        if (!VDOC.isGap(it.reason)) continue;
        const k = `${it.item}|${it.reason}`;
        if (!missingMap.has(k)) {
          missingMap.set(k, {
            item: it.item, docKey: it.docKey, reason: it.reason,
            reasonAr: VDOC.statusLabel(it.reason, 'ar'), reasonEn: VDOC.statusLabel(it.reason, 'en'),
            count: 0, filter: { missingItem: it.item, missingReason: it.reason },
          });
        }
        missingMap.get(k).count += 1;
      }
    }
    const missingBreakdown = [...missingMap.values()].sort((a, b) => b.count - a.count);

    // Missing requirements sorted by frequency: where to start.
    const gapCounts = new Map();
    for (const v of vehicles) for (const g of v.logistiGaps || []) gapCounts.set(g, (gapCounts.get(g) || 0) + 1);
    const logistiGaps = [...gapCounts.entries()]
      .map(([value, count]) => ({ value, count, filter: { logistiGap: value } }))
      .sort((a, b) => b.count - a.count);

    // Accidents and claims: money is the question.
    const openClaims = claims.filter((c) => c.statusCode !== 'closed');
    const claimTotals = {
      total: claims.length,
      open: openClaims.length,
      estimatedSar: Math.round(claims.reduce((t, c) => t + (Number(c.claim?.estimatedAmountSar) || 0), 0)),
      expectedRecoverySar: Math.round(claims.reduce((t, c) => t + (Number(c.claim?.expectedRecoverySar) || 0), 0)),
      ourFault: claims.filter((c) => (c.faultPercent || 0) >= 50).length,
      unmatched: unmatchedClaims,
      byInsurer: [...claims.reduce((m, c) => m.set(c.claim?.insurerAr || '—', (m.get(c.claim?.insurerAr || '—') || 0) + 1), new Map())]
        .map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
    };

    // Company documents: their expiry stops all work, not one vehicle.
    const corporate = policies.map((p) => {
      const st = VDOC.stateOf(p.expiryDate, '', cfg.alerts?.corporatePolicy);
      return { _id: p._id, scopeAr: p.scopeAr, companyAr: p.companyAr, expiryDate: p.expiryDate,
        premiumSar: p.premiumSar, policyNumbers: p.policyNumbers, state: st.state, days: st.days };
    }).sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));

    const body = { totals, breakdowns, documents, logistiGaps, missingBreakdown, claims: claimTotals, corporate,
      analytics: buildVehicleAnalytics(vehicles), alerts: cfg.alerts || {} };
    cache.set(key, body, 20000);
    res.json(body);
  } catch (e) {
    console.error('vreg overview', e);
    res.status(500).json({ message: 'تعذّر تحميل نظرة المركبات' });
  }
};

// Expiries with a flexible filter: show what expires within N days.
/**
 * GET /expiring?doc=insurance&withinDays=30
 * doc: one or more documents (comma-separated), empty = all; withinDays: any number, not a fixed list; includeExpired=0 hides expired; state: extra filter on computed state.
 * Returns a row per (vehicle x document), nearest expiry first.
 */
// One source for each document's state.
// Expiries and renewal, and vehicle alerts, answer the same question: which document is near or finished? They were computed by two functions and two filters, so numbers differed, which the user noticed. The worst difference: the alerts screen silently dropped any document type whose alert was disabled in settings, so an actually expired document was missing there but visible in expiry.
// This function is now the single source and both screens build from it. If the future needs to differentiate them, it does so in the **filter**, not in the **calculation**.
// What the expiry rows read from the vehicle, no more: they used to pull AGG_FIELDS (76 fields) to read 18 from them, and transfer is the entire cost of this screen.
const EXPIRY_FIELDS = [...new Set([
  'plateNumber', 'brandAr', 'modelAr', 'chassisNumber', 'serialNumber', 'registrationTypeAr', 'ownerCompanyAr',
  'colorAr', 'sectorAr', 'ownerNameAr', 'modelYear',
  ...DOC_TYPES.flatMap((dt) => [dt.path, dt.statusPath, dt.numberPath].filter(Boolean)),
  'insurance.companyAr', 'gps.provider', 'authorizedPerson.name', 'authorizedPerson.iqamaNumber',
])].join(' ');
// The mirror is updated by diff: renewing one document fetches only its vehicle. See utils/changeStamp.
const expiryMirror = require('../utils/changeStamp').mirror(VehicleMaster, EXPIRY_FIELDS);

async function buildExpiryRows(query = {}) {
  const DriverCard = require('../models/DriverCard');
  const [vehicles, cfg, cards, ended] = await Promise.all([
    expiryMirror.rowsFor(buildFilter(query)),
    getConfig(),
    DriverCard.find({ isActive: { $ne: false } })
      .select('name idNumber cardNumber cardType expiryDate logisticRegister employee').lean(),
    endedStaff(),
  ]);
  // The driver and his card on every vehicle row.
  // 'Document holder' used to be filled for authorization only, so the column was empty on vehicle insurance, registration and inspection, which are most of the rows. The question is the same for all: who drives this vehicle, and what is his card? So the authorized person is read and linked to his card by residency number.
  const cardById = new Map(cards.map((c) => [String(c.idNumber || '').trim(), c]));
  const rows = [];
  const cardOf = (v) => {
    const iq = String(v.authorizedPerson?.iqamaNumber || '').trim();
    return iq && !holderArchived(ended, v) ? cardById.get(iq) : null;
  };
  for (const v of vehicles) {
    for (const dt of DOC_TYPES) {
      const expiry = getPath(v, dt.path);
      const statusCode = getPath(v, dt.statusPath) || '';
      const st = VDOC.stateOf(expiry, statusCode, cfg.alerts?.[dt.key]);
      rows.push({
        rowId: `v:${v._id}:${dt.key}`,
        vehicleId: v._id, plateNumber: v.plateNumber, brandAr: v.brandAr, modelAr: v.modelAr,
        chassisNumber: v.chassisNumber || '', serialNumber: v.serialNumber || '',
        registrationTypeAr: v.registrationTypeAr || '', ownerCompanyAr: v.ownerCompanyAr || '', colorAr: v.colorAr || '',
        sectorAr: v.sectorAr, ownerNameAr: v.ownerNameAr, modelYear: v.modelYear,
        docKey: dt.key, docAr: dt.ar, docEn: dt.en,
        expiryDate: expiry, daysRemaining: st.days, state: st.state, statusCode,
        // Is the alert enabled for this type? Returned with the row instead of the row silently disappearing.
        alertEnabled: cfg.alerts?.[dt.key]?.enabled !== false,
        // Document number from its definition, not a chain of conditions that gets forgotten: authorization was added as a sixth document and not added to the chain, so it appeared on the expiry screen without a number to identify it, and an authorization whose number is unknown cannot be renewed.
        reference: dt.numberPath ? String(getPath(v, dt.numberPath) || '') : '',
        company: dt.key === 'insurance' ? v.insurance?.companyAr : dt.key === 'gps' ? v.gps?.provider : '',
        // The authorized person on the vehicle, for all its documents and not authorization only (see above). An archived authorized person is not named; the row belongs to the vehicle and its paper.
        holder: holderArchived(ended, v) ? '' : String(v.authorizedPerson?.name || ''),
        driverCardNumber: String(cardOf(v)?.cardNumber || ''),
      });
    }
  }

  // The driver card is a document that expires like the rest.
  // It is a paper on a person, not on a vehicle, so it lived on its own page and was absent from the expiry screen and the dashboard. That absence is not organization: an expired card stops a driver as an expired registration does, and whoever opens 'what expires within thirty days' wants everything that will stop work, not only what stops vehicles.
  // So it enters as a row like the others: a date, a state and days remaining, with thresholds set from section settings under `driverCard` as for registration. It has no plate; the plate column shows its holder's name, which is the row identity here.
  // It is not filtered by vehicle filters (sector, owner, city): a driver is not a vehicle, so filtering the dashboard by sector would drop all cards, and silent dropping is worse than appearing. It appears when nothing vehicle-specific is filtered.
  const vehicleFiltered = ['sector', 'owner', 'city', 'department', 'q']
    .some((k) => String(query[k] || '').trim() !== '');
  if (!vehicleFiltered) {
    for (const c of cards) {
      // Without a card number it is 'required', not 'expired': pending work with its own column on the driver-cards page. It does not enter the expiry screen without an expiry date.
      if (!c.expiryDate) continue;
      // Someone whose service ended gets no card alert: nobody will renew it.
      if (cardEnded(ended, c)) continue;
      const st = VDOC.stateOf(c.expiryDate, '', cfg.alerts?.driverCard);
      rows.push({
        // Driver data is not stuffed into vehicle fields.
        // The driver's name was first written into `plateNumber` to fill the plate column, so the reader saw 'Plate: Muhammad Taher'. A column has to say what its name says or it stops being readable. The vehicle fields stay empty, since there is no vehicle here, and the name is read from `holder`, the same column that carries the authorized person's name.
        // `rowId` is the row identity: the screen used to build it from `vehicleId`, which is `null` on every card, so all fifty-seven shared one key, one was drawn and the wrong one was selected on click.
        rowId: `dc:${c._id}`,
        vehicleId: null, driverCardId: String(c._id),
        plateNumber: '', brandAr: '', modelAr: '', modelYear: null,
        chassisNumber: '', serialNumber: '', registrationTypeAr: '', ownerCompanyAr: '', colorAr: '',
        sectorAr: '', ownerNameAr: '',
        driverCardNumber: String(c.cardNumber || ''),
        docKey: 'driverCard', docAr: 'بطاقة السائق', docEn: 'Driver card',
        expiryDate: c.expiryDate, daysRemaining: st.days, state: st.state, statusCode: '',
        alertEnabled: cfg.alerts?.driverCard?.enabled !== false,
        reference: String(c.cardNumber || ''),
        company: String(c.cardType || ''),
        holder: String(c.name || c.idNumber || ''),
      });
    }
  }
  return rows;
}

/**
 * Documents of the expiry screen: vehicle papers and the driver card.
 * `DOC_TYPES` describes vehicle papers and the driver card is a paper on a person. They meet in one question, 'what expires and stops work?', so they meet in this list only, and the driver card is not mixed with vehicle papers anywhere else.
 */
const EXPIRY_DOCS = [...DOC_TYPES, { key: 'driverCard', ar: 'بطاقة السائق', en: 'Driver card' }];

exports.expiring = async (req, res) => {
  try {
    const withinDays = req.query.withinDays === '' || req.query.withinDays == null
      ? null : Math.max(0, Number(req.query.withinDays) || 0);
    const wanted = _multi(req.query.doc);
    const includeExpired = req.query.includeExpired !== '0';
    const states = _multi(req.query.state);

    await getConfig(); // Before buildFilter; see ALERTS
    const all = await buildExpiryRows(req.query);
    const rows = [];
    for (const r of all) {
      const st = { state: r.state, days: r.daysRemaining };
      const dt = { key: r.docKey };
      if (wanted.length && !wanted.includes(dt.key)) continue;
      {
        // 'Not required' does not expire, and 'no date' has no place on an expiry screen.
        if (st.state === 'not_applicable' || st.state === 'missing') continue;
        if (!includeExpired && st.state === 'expired') continue;
        // The filter is compared to the state as displayed, not as computed: the screen shows three (expired, nearing, valid) while the computation distinguishes three color grades below that. Whoever clicks 'nearing' means all of them.
        if (states.length && !states.includes(st.state) && !states.includes(VDOC.publicState(st.state))) continue;
        // An already expired document stays visible whatever the window; its date has passed.
        if (withinDays !== null && st.days > withinDays) continue;
        rows.push({
          ...r,
        });
      }
    }
    rows.sort((a, b) => (a.daysRemaining ?? 1e9) - (b.daysRemaining ?? 1e9));

    // Summary computed on the same rows, so the number above always describes what is below.
    const summary = { total: rows.length, expired: 0, critical: 0, warning: 0, valid: 0 };
    const byDoc = {};
    for (const r of rows) {
      summary[r.state] = (summary[r.state] || 0) + 1;
      byDoc[r.docKey] = (byDoc[r.docKey] || 0) + 1;
    }
    // The cap announces itself and can be lifted on request.
    // Rows here are vehicle x document, so two thousand is closer than it looks. The truncation used to be silent: the summary above counts everything while the file downloads with two thousand, so the exporter reads an incomplete file as complete, which makes 'export all' a promise not kept.
    const CAP = Math.min(Number(req.query.limit) || 2000, 50000);
    const body = {
      rows: rows.slice(0, CAP),
      summary,
      // The driver card is a seventh column above the table.
      // `DOC_TYPES` is vehicle papers only and the driver card is not among them, but it expires and displays here like the others, so it is counted in the strip read above the table. Otherwise its rows would appear in the list with no column saying how many there are.
      byDoc: EXPIRY_DOCS.map((d) => ({ key: d.key, ar: d.ar, en: d.en, count: byDoc[d.key] || 0 })),
      withinDays, docs: EXPIRY_DOCS.map((d) => ({ key: d.key, ar: d.ar, en: d.en })),
    };
    if (rows.length > CAP) { body.truncated = true; body.limit = CAP; body.matched = rows.length; }
    res.json(body);
  } catch (e) {
    console.error('vreg expiring', e);
    res.status(500).json({ message: 'تعذّر تحميل الانتهاءات' });
  }
};

// Renewal
/**
 * POST /:id/renew  { document, newExpiry, cost?, reference?, note? }
 * Updates the expiry date **and records the renewal in the log** with old and new date and who did it. Without the log, 'when did we renew it and for how much?' has no answer after the first renewal. It also clears the 'none/required' state automatically, since a date now exists.
 */
/**
 * Applies one renewal to a vehicle: the date, the number if changed, and the log entry.
 * A function rather than repeated lines in two places: single and bulk renewal copied the same steps, so any change in one (this change is an example) left the other behind. The number would be renewed from the single screen and not from the bulk one, and the difference shows only after a hundred vehicles were renewed incompletely.
 * Returns the entry itself so it is recorded in the audit log as it was recorded on the vehicle.
 */
const applyRenewal = (v, doc, when, src = {}, byName = '') => {
  const [block, field] = doc.path.split('.');
  const previous = v[block]?.[field] || null;
  v[block][field] = when;

  // The Hijri date is renewed with the Gregorian.
  // Registration and inspection carry a Hijri date written on the paper. Renewal used to update the Gregorian only, leaving the Hijri as the expired paper's date: the screen showed an expiry a year away next to a Hijri date already past, and one of them is wrong. The new paper's Hijri date is known only from the paper, so it is computed from the new date: a consistent approximation is better than a date that contradicts its neighbor.
  if (v[block] && Object.prototype.hasOwnProperty.call(v[block], 'expiryDateHijri')) {
    try {
      const { toHijriPlain } = require('../utils/hijri');
      const hij = toHijriPlain(when);
      if (hij) v[block].expiryDateHijri = hij;
    } catch (e) { /* Renewal proceeds even if derivation fails */ }
  }

  // The new number is optional, and silence means unchanged.
  // Blank is not a clear command: someone who leaves the field empty has not extracted a card with a new number, and reading it as erase would let a bulk renewal destroy two hundred numbers in one stroke.
  let previousNumber = '';
  let newNumber = '';
  const wanted = src.documentNumber == null ? '' : String(src.documentNumber).trim();
  if (wanted && doc.numberPath) {
    const [nBlock, nField] = doc.numberPath.split('.');
    previousNumber = String(v[nBlock]?.[nField] || '');
    if (previousNumber !== wanted) { v[nBlock][nField] = wanted; newNumber = wanted; }
    else previousNumber = '';
  }

  // The start date is renewed with the end.
  // A document that has a start (authorization) is issued anew with a new start. Leaving the old value keeps the start date of an authorization that lapsed and was replaced, so the driver reads as driving on an authorization from a year ago that he extracted yesterday.
  let previousStart = '';
  let newStart = '';
  if (doc.startPath && src.startDate) {
    const [stB, stF] = doc.startPath.split('.');
    const d = new Date(src.startDate);
    if (!Number.isNaN(d.getTime())) {
      previousStart = v[stB]?.[stF] || null;
      v[stB][stF] = d;
      newStart = d;
    }
  }

  const [sBlock, sField] = doc.statusPath.split('.');
  if (v[sBlock] && ['none', 'required', 'unknown', ''].includes(v[sBlock][sField])) v[sBlock][sField] = '';
  // Documents saved before this field was added will not have the array at all.
  if (!Array.isArray(v.renewals)) v.renewals = [];
  const entry = {
    document: doc.key, previousExpiry: previous, newExpiry: when,
    previousNumber, newNumber,
    ...(newStart ? { previousStart: previousStart || null, newStart } : {}),
    cost: src.cost != null && src.cost !== '' ? Number(src.cost) : null,
    reference: String(src.reference || '').trim(),
    note: String(src.note || '').trim(),
    byName,
  };
  v.renewals.push(entry);
  return { previous, entry };
};

/**
 * Driver card renewal: POST /:id/renew with `document: 'driverCard'`.
 * Why here: the expiry screen shows driver cards with vehicle documents in one table (they expire the same way) with a single renewal button. The card used to bounce with 'unknown document type': it is not one of the six vehicle documents and has no vehicle (`vehicleId: null`), so the path itself could not match.
 * So it is renewed here: the new date and its number if changed, then its snapshot returns to the owner's HR file. See utils/driverCardSync.
 */
async function renewDriverCard(req, res) {
  const DriverCard = require('../models/DriverCard');
  const id = String(req.body.driverCardId || req.body.cardId || req.params.id || '').trim();
  const card = await DriverCard.findById(id).catch(() => null);
  if (!card) return res.status(404).json({ message: 'بطاقة السائق غير موجودة' });
  const newExpiry = req.body.newExpiry ? new Date(req.body.newExpiry) : null;
  if (!newExpiry || isNaN(newExpiry)) return res.status(400).json({ message: 'أدخل تاريخ الانتهاء الجديد' });
  if (newExpiry < new Date(new Date().setHours(0, 0, 0, 0))) {
    return res.status(400).json({ message: 'تاريخ الانتهاء الجديد في الماضي — راجع التاريخ' });
  }
  const previous = card.expiryDate;
  const previousNumber = card.cardNumber;
  card.expiryDate = newExpiry;
  const num = String(req.body.documentNumber || '').trim();
  if (num) card.cardNumber = num;
  if (req.body.startDate) card.issueDate = new Date(req.body.startDate);
  // What the dialog asked for is saved: cost, receipt and note were read from the request and then dropped. See `renewals` in models/DriverCard.
  const cost = req.body.cost === '' || req.body.cost == null ? null : Number(req.body.cost);
  card.renewals = card.renewals || [];
  card.renewals.push({
    previousExpiry: previous ? String(previous).slice(0, 10) : '',
    newExpiry: String(req.body.newExpiry).slice(0, 10),
    previousNumber: previousNumber || '',
    newNumber: card.cardNumber || '',
    cost: Number.isFinite(cost) ? cost : null,
    reference: String(req.body.reference || '').trim(),
    note: String(req.body.note || '').trim(),
    at: new Date(),
    byName: [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' '),
  });
  card.lastModifiedBy = req.user?._id;
  await card.save();
  try { await require('../utils/driverCardSync').pushCardToEmployee(card); } catch (e) { console.error('driver card renew → HR:', e.message); }
  logAudit({
    user: req.user, action: 'renew_driver_card', entity: 'DriverCard', entityId: card._id,
    changes: { before: { expiryDate: previous, cardNumber: previousNumber }, after: { expiryDate: newExpiry, cardNumber: card.cardNumber } },
    ipAddress: req.ip,
  }).catch(() => {});
  emit('vreg:updated', {});
  return res.json({ driverCard: card.toObject() });
}

exports.renew = async (req, res) => {
  try {
    if (String(req.body.document || '') === 'driverCard') return renewDriverCard(req, res);
    const doc = VDOC.getDoc(req.body.document);
    if (!doc) return res.status(400).json({ message: 'نوع المستند غير معروف' });
    const newExpiry = req.body.newExpiry ? new Date(req.body.newExpiry) : null;
    if (!newExpiry || isNaN(newExpiry)) return res.status(400).json({ message: 'أدخل تاريخ الانتهاء الجديد' });

    const v = await VehicleMaster.findById(req.params.id);
    if (!v) return res.status(404).json({ message: 'المركبة غير موجودة' });

    // Renewing to a date already past is most likely a typo; stop it rather than record it and confuse the data.
    if (newExpiry < new Date(new Date().setHours(0, 0, 0, 0))) {
      return res.status(400).json({ message: 'تاريخ الانتهاء الجديد في الماضي — راجع التاريخ' });
    }
    // A new number for a document that has no number (registration, inspection) is a meaningless request: accepting it silently makes the user think a number was saved when there is nowhere to save it.
    if (String(req.body.documentNumber || '').trim() && !doc.numberPath) {
      return res.status(400).json({ message: `${doc.ar} ليس له رقم مستقلّ يُجدَّد` });
    }

    const { previous, entry } = applyRenewal(v, doc, newExpiry, req.body,
      `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim());
    await v.save();

    logAudit({
      user: req.user, action: 'renew_vehicle_document', entity: 'VehicleMaster', entityId: v._id,
      changes: {
        before: { [doc.key]: previous, number: entry.previousNumber || undefined },
        after: { [doc.key]: newExpiry, number: entry.newNumber || undefined },
      },
      ipAddress: req.ip,
    }).catch(() => {});

    emit('vreg:updated', {});
    const cfg = await getConfig();
    res.json({ vehicle: decorate(v.toObject(), cfg) });
  } catch (e) {
    console.error('vreg renew', e);
    return sendMongooseError(res, e, 'تعذّر تسجيل التجديد');
  }
};

// Renew several documents at once. Each line goes through the same single-renewal logic (validation, vehicle log entry, date), so bulk and single never differ.
// All or nothing: if one line is wrong no vehicle is renewed, since a half-applied batch of 151 cannot be traced.
/**
 * Renew a shared paper across all its vehicles. POST /renew-shared
 * { document: 'insurance', number, newExpiry, newNumber?, cost?, reference?, note? }
 * One policy covers many vehicles, so renewing one by one leaves forgotten ones 'expired'. The number is shared only for a document flagged `sharedNumber`; the policy record (`VehicleInsurancePolicy`) is updated too.
 */
exports.renewShared = async (req, res) => {
  try {
    const doc = VDOC.getDoc(req.body?.document);
    if (!doc) return res.status(400).json({ message: 'نوع المستند غير معروف' });
    if (!doc.sharedNumber) {
      return res.status(400).json({ message: `${doc.ar} ورقةٌ لكلّ مركبة، فلا يُجدَّد جماعةً برقمٍ واحد` });
    }
    const number = String(req.body?.number || '').trim();
    if (!number) return res.status(400).json({ message: 'حدِّد رقم الوثيقة المراد تجديدها' });
    const when = req.body?.newExpiry ? new Date(req.body.newExpiry) : null;
    if (!when || isNaN(when)) return res.status(400).json({ message: 'أدخل تاريخ الانتهاء الجديد' });
    const today = new Date(new Date().setHours(0, 0, 0, 0));
    if (when < today) return res.status(400).json({ message: 'تاريخ الانتهاء الجديد في الماضي — راجع التاريخ' });

    const vehicles = await VehicleMaster.find({ [doc.numberPath]: number });
    if (!vehicles.length) return res.status(404).json({ message: `لا مركبةَ على الوثيقة «${number}»` });

    const byName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim();
    const newNumber = String(req.body?.newNumber || '').trim();
    const done = [];
    for (const v of vehicles) {
      const { previous } = applyRenewal(v, doc, when, {
        documentNumber: newNumber,
        cost: req.body.cost, reference: req.body.reference, note: req.body.note,
      }, byName);
      await v.save();
      done.push({ vehicle: v._id, plate: v.plateNumber, previousExpiry: previous });
    }

    // The policy record itself, if registered there.
    let policyUpdated = false;
    const policy = await VehicleInsurancePolicy.findOne({ policyNumber: number });
    if (policy) {
      const previousExpiry = policy.expiryDate;
      policy.expiryDate = when;
      if (newNumber) policy.policyNumber = newNumber;
      if (!Array.isArray(policy.renewals)) policy.renewals = [];
      policy.renewals.push({
        previousExpiry, newExpiry: when,
        cost: req.body.cost != null && req.body.cost !== '' ? Number(req.body.cost) : null,
        reference: String(req.body.reference || '').trim(),
        note: String(req.body.note || '').trim(),
        vehiclesUpdated: done.length, byName,
      });
      await policy.save();
      policyUpdated = true;
    }

    logAudit({
      user: req.user, action: 'renew_vehicle_document', entity: 'VehicleMaster', entityId: null,
      changes: { sharedPolicy: number, newNumber: newNumber || null, document: doc.key, count: done.length, newExpiry: when, policyUpdated },
      ipAddress: req.ip,
    }).catch(() => {});

    emit('vreg:updated', {});
    res.json({ renewed: done, summary: { count: done.length, policyUpdated, number: newNumber || number } });
  } catch (e) {
    console.error('vreg renewShared', e);
    return sendMongooseError(res, e, 'تعذّر تجديد الوثيقة');
  }
};

exports.renewBulk = async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ message: 'اختر مركبة واحدة على الأقل' });
    if (items.length > 500) return res.status(400).json({ message: 'أقصى ٥٠٠ سطر في المرة الواحدة' });

    const shared = req.body?.newExpiry ? new Date(req.body.newExpiry) : null;
    const today = new Date(new Date().setHours(0, 0, 0, 0));
    const errors = [];
    const prepared = [];

    // Driver cards are renewed too.
    // The expiry screen groups them with vehicle documents in one table, so a selection mixes them and 'renew' is clicked. The whole batch used to be rejected because of them.
    const DriverCard = require('../models/DriverCard');
    const cardRows = [];

    // 1. Validate everything before saving anything
    for (const [i, row] of items.entries()) {
      if (String(row.document || '') === 'driverCard') {
        const when0 = row.newExpiry ? new Date(row.newExpiry) : shared;
        if (!when0 || isNaN(when0)) { errors.push({ line: i + 1, message: 'أدخل تاريخ الانتهاء الجديد' }); continue; }
        if (when0 < today) { errors.push({ line: i + 1, message: 'تاريخ الانتهاء الجديد في الماضي — راجع التاريخ' }); continue; }
        const card = await DriverCard.findById(row.driverCardId || row.vehicle).catch(() => null);
        if (!card) { errors.push({ line: i + 1, message: 'بطاقة السائق غير موجودة' }); continue; }
        cardRows.push({ card, when: when0, row });
        continue;
      }
      const doc = VDOC.getDoc(row.document);
      if (!doc) { errors.push({ line: i + 1, message: `نوع المستند «${row.document}» غير معروف` }); continue; }
      const when = row.newExpiry ? new Date(row.newExpiry) : shared;
      if (!when || isNaN(when)) { errors.push({ line: i + 1, message: 'أدخل تاريخ الانتهاء الجديد' }); continue; }
      if (when < today) { errors.push({ line: i + 1, message: 'تاريخ الانتهاء الجديد في الماضي — راجع التاريخ' }); continue; }
      const v = await VehicleMaster.findById(row.vehicle || row.id);
      if (!v) { errors.push({ line: i + 1, message: 'المركبة غير موجودة' }); continue; }
      // The number in bulk renewal is per line, not shared: each vehicle's card carries its own number, and one number written on a hundred of them makes a hundred copies of one paper, worse than writing no number at all.
      if (String(row.documentNumber || '').trim() && !doc.numberPath) {
        errors.push({ line: i + 1, message: `${doc.ar} ليس له رقم مستقلّ يُجدَّد` }); continue;
      }
      prepared.push({ v, doc, when, row });
    }
    if (errors.length) {
      return res.status(400).json({ message: 'العملية اترفضت — مفيش أي مركبة اتجدّدت', errors });
    }

    // 2. Execute: exactly the single-renewal steps
    const byName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim();
    const done = [];
    for (const { v, doc, when, row } of prepared) {
      const { previous, entry } = applyRenewal(v, doc, when, {
        ...row,
        reference: row.reference || req.body.reference,
        note: row.note || req.body.note,
      }, byName);
      await v.save();
      done.push({
        vehicle: v._id, plate: v.plateNumber, document: doc.key,
        previousExpiry: previous, newExpiry: when,
        previousNumber: entry.previousNumber, newNumber: entry.newNumber,
      });
    }
    // Cards too, each returning to its owner's HR file.
    for (const { card, when, row } of cardRows) {
      const previous = card.expiryDate;
      card.expiryDate = when;
      const num = String(row.documentNumber || '').trim();
      if (num) card.cardNumber = num;
      card.lastModifiedBy = req.user?._id;
      await card.save();
      try { await require('../utils/driverCardSync').pushCardToEmployee(card); } catch (e) { console.error('driver card bulk → HR:', e.message); }
      done.push({
        vehicle: null, driverCard: card._id, plate: card.name || '', document: 'driverCard',
        previousExpiry: previous, newExpiry: when,
        previousNumber: undefined, newNumber: num || undefined,
      });
    }

    logAudit({
      user: req.user, action: 'renew_vehicle_document', entity: 'VehicleMaster', entityId: null,
      changes: {
        bulk: true, count: done.length, newExpiry: shared,
        documents: [...new Set(done.map((d) => d.document))],
        // How many numbers were actually replaced: the difference between 'renewed the dates' and 'extracted new papers'.
        numbersChanged: done.filter((d) => d.newNumber).length,
      },
      ipAddress: req.ip,
    }).catch(() => {});

    emit('vreg:updated', {});
    res.json({
      renewed: done,
      summary: { count: done.length, vehicles: new Set(done.map((d) => String(d.vehicle))).size },
    });
  } catch (e) {
    console.error('vreg renewBulk', e);
    return sendMongooseError(res, e, 'تعذّر تسجيل التجديد');
  }
};

// Section registers: owners, authorized people, tracking devices and fuel cards.
// All are **built from the vehicles themselves**, not from parallel tables. An owner is not an independent entity here, it is a name on vehicles; stored twice, its vehicle count would differ between screens as soon as a vehicle moved. Building from the source makes inconsistency impossible rather than rare.
// Each register carries what is actually asked: how many vehicles, and how many have expired documents.
const REGISTER_DEFS = {
  owners: {
    ar: 'المُلّاك', en: 'Owners',
    key: (v) => S(v.ownerNameAr),
    extra: (rows) => ({ commercialRegistration: S(rows[0].commercialRegistration) }),
    filterKey: 'owner',
  },
  authorizedPersons: {
    ar: 'المفوَّضون', en: 'Authorized persons',
    key: (v) => S(v.authorizedPerson?.name),
    extra: (rows) => ({
      iqamaNumber: S(rows[0].authorizedPerson?.iqamaNumber),
      jobTitleAr: S(rows[0].authorizedPerson?.jobTitleAr),
    }),
    filterKey: 'authorizedPerson',
  },
  gpsProviders: {
    ar: 'مزوّدو التتبّع', en: 'GPS providers',
    key: (v) => S(v.gps?.provider),
    extra: (rows) => ({ devices: [...new Set(rows.map((r) => S(r.gps?.deviceModel)).filter(Boolean))] }),
    filterKey: 'gpsProvider',
  },
  gpsDevices: {
    ar: 'أجهزة التتبّع', en: 'GPS devices',
    key: (v) => S(v.gps?.deviceModel),
    extra: (rows) => ({ providers: [...new Set(rows.map((r) => S(r.gps?.provider)).filter(Boolean))] }),
    filterKey: 'gpsDevice',
  },
};

const S = (v) => String(v ?? '').trim();

exports.registers = async (req, res) => {
  try {
    const [cfg, archSets] = await Promise.all([getConfig(), endedStaff()]);
    const vehicles = await VehicleMaster.find({ isActive: { $ne: false } }).select(AGG_FIELDS).lean();

    /** State of the worst document on the vehicle, used to know how many of an owner's vehicles are in trouble. */
    const worstOf = (v) => {
      let worst = 'valid';
      const rank = { expired: 4, critical: 3, warning: 2, upcoming: 1, valid: 0 };
      for (const dt of DOC_TYPES) {
        const st = VDOC.stateOf(getPath(v, dt.path), getPath(v, dt.statusPath) || '', cfg.alerts?.[dt.key]);
        if ((rank[st.state] || 0) > (rank[worst] || 0)) worst = st.state;
      }
      return worst;
    };

    const out = {};
    for (const [name, def] of Object.entries(REGISTER_DEFS)) {
      const groups = new Map();
      for (const v of vehicles) {
        const k = def.key(v);
        if (!k) continue;
        // The authorized-people register is names of people: archived ones are not listed.
        if (name === 'authorizedPersons' && holderArchived(archSets, v)) continue;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(v);
      }
      out[name] = {
        ar: def.ar, en: def.en, filterKey: def.filterKey,
        items: [...groups.entries()].map(([value, rows]) => ({
          value,
          vehicles: rows.length,
          expired: rows.filter((v) => worstOf(v) === 'expired').length,
          plates: rows.slice(0, 40).map((v) => v.plateNumber),
          ...(def.extra ? def.extra(rows) : {}),
          filter: { [def.filterKey]: value },
        })).sort((a, b) => b.vehicles - a.vehicles),
      };
    }

    // Fuel cards are a row per card, not an aggregate: a card belongs to one vehicle.
    out.fuelCards = {
      ar: 'شرائح الوقود', en: 'Fuel cards', filterKey: 'fuelCard',
      items: vehicles
        .filter((v) => S(v.fuelCard?.cardNumber))
        .map((v) => ({
          value: S(v.fuelCard.cardNumber),
          plateNumber: v.plateNumber,
          vehicleId: v._id,
          plateOnInvoiceAr: S(v.fuelCard.plateOnInvoiceAr),
          statusAr: S(v.fuelCard.statusAr),
          consumptionTypeAr: S(v.fuelCard.consumptionTypeAr),
          limitSar: v.fuelCard.limitSar ?? null,
          sectorAr: v.sectorAr, departmentAr: v.departmentAr, cityAr: v.cityAr,
        }))
        .sort((a, b) => String(a.plateNumber).localeCompare(String(b.plateNumber), 'ar')),
    };

    // Tracking devices are a row per device too: a device is on a specific vehicle with a serial and subscription.
    out.gpsUnits = {
      ar: 'أجهزة التتبّع المركّبة', en: 'Installed GPS units', filterKey: 'gpsUnit',
      // 'Installed' means it has a serial. A vehicle whose field says 'required' has no device, only one awaiting fitting, and counting it among devices inflates the number by a hundred devices that do not exist.
      items: vehicles
        .filter((v) => S(v.gps?.serialImei))
        .map((v) => {
          const st = VDOC.stateOf(v.gps?.expiryDate, v.gps?.statusCode || '', cfg.alerts?.gps);
          return {
            value: S(v.gps.serialImei) || S(v.gps.deviceModel),
            plateNumber: v.plateNumber, vehicleId: v._id,
            deviceModel: S(v.gps.deviceModel), provider: S(v.gps.provider),
            deviceStatusAr: S(v.gps.deviceStatusAr),
            expiryDate: v.gps?.expiryDate || null,
            state: st.state, daysRemaining: st.days,
            sectorAr: v.sectorAr, departmentAr: v.departmentAr, cityAr: v.cityAr,
          };
        })
        .sort((a, b) => (a.daysRemaining ?? 1e9) - (b.daysRemaining ?? 1e9)),
    };

    res.json({
      registers: out,
      totals: Object.fromEntries(Object.entries(out).map(([k, r]) => [k, r.items.length])),
    });
  } catch (e) {
    console.error('vreg registers', e);
    return sendMongooseError(res, e, 'تعذّر تحميل سجلّات القسم');
  }
};

// Vehicle insurance policies.
// One policy covers up to 239 vehicles. Renewing it meant opening each vehicle, and any forgotten vehicle stayed 'expired' on screen though insured. Here the policy is renewed once, the date applies to all its vehicles and is recorded in each one's renewal log as if renewed alone, so a reviewer sees the same entry in both cases.
exports.listInsurancePolicies = async (req, res) => {
  try {
    const cfg = await getConfig();
    const policies = await VehicleInsurancePolicy.find({ isActive: { $ne: false } })
      .sort({ expiryDate: 1 }).lean();
    // Vehicle count is computed from the vehicles themselves, not from a stored number, which goes stale.
    const counts = await VehicleMaster.aggregate([
      { $match: { insurancePolicy: { $ne: null }, isActive: { $ne: false } } },
      { $group: { _id: '$insurancePolicy', n: { $sum: 1 } } },
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c.n]));
    const rows = policies.map((p) => {
      const st = VDOC.stateOf(p.expiryDate, '', cfg.alerts?.insurance);
      return {
        ...p,
        vehicles: byId.get(String(p._id)) || 0,
        state: st.state,
        daysRemaining: st.days,
      };
    });
    res.json({
      policies: rows,
      totals: {
        total: rows.length,
        vehiclesCovered: rows.reduce((t, r) => t + r.vehicles, 0),
        premiumSar: Math.round(rows.reduce((t, r) => t + (Number(r.totalPremiumSar) || 0), 0)),
        expired: rows.filter((r) => r.state === 'expired').length,
        soon: rows.filter((r) => r.state === 'critical' || r.state === 'warning').length,
      },
    });
  } catch (e) {
    console.error('vreg listInsurancePolicies', e);
    res.status(500).json({ message: 'تعذّر تحميل وثائق التأمين' });
  }
};

exports.renewInsurancePolicy = async (req, res) => {
  try {
    const pol = await VehicleInsurancePolicy.findById(req.params.id);
    if (!pol || pol.isActive === false) return res.status(404).json({ message: 'الوثيقة غير موجودة' });
    const newExpiry = req.body?.newExpiry ? new Date(req.body.newExpiry) : null;
    if (!newExpiry || isNaN(newExpiry)) return res.status(400).json({ message: 'أدخل تاريخ الانتهاء الجديد' });
    if (newExpiry < new Date(new Date().setHours(0, 0, 0, 0))) {
      return res.status(400).json({ message: 'تاريخ الانتهاء الجديد في الماضي — راجع التاريخ' });
    }

    const previous = pol.expiryDate || null;
    const byName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim();
    const reference = String(req.body?.reference || '').trim();
    const note = String(req.body?.note || '').trim();
    const newNumber = String(req.body?.policyNumber || '').trim();

    const vehicles = await VehicleMaster.find({ insurancePolicy: pol._id, isActive: { $ne: false } });
    for (const v of vehicles) {
      const before = v.insurance?.expiryDate || null;
      const beforeNumber = String(v.insurance?.policyNumber || '');
      v.set('insurance.expiryDate', newExpiry);
      // A new policy with a new number? It updates on every vehicle too.
      if (newNumber) v.set('insurance.policyNumber', newNumber);
      if (['none', 'required', 'unknown', ''].includes(v.insurance?.statusCode)) v.set('insurance.statusCode', '');
      if (!Array.isArray(v.renewals)) v.renewals = [];
      v.renewals.push({
        document: 'insurance', previousExpiry: before, newExpiry,
        // The old number is recorded on every vehicle, not on the policy alone: a claim open under the previous number is reviewed vehicle by vehicle, and if the trace stayed only in the policy log another screen would be needed to know which policy number insured it.
        previousNumber: newNumber && newNumber !== beforeNumber ? beforeNumber : '',
        newNumber: newNumber && newNumber !== beforeNumber ? newNumber : '',
        cost: req.body?.cost != null && req.body?.cost !== '' ? Number(req.body.cost) : null,
        reference, note: [note, `تجديد وثيقة ${pol.policyNumber}`].filter(Boolean).join(' — '), byName,
      });
      await v.save();
    }

    pol.renewals.push({
      previousExpiry: previous, newExpiry,
      cost: req.body?.cost != null && req.body?.cost !== '' ? Number(req.body.cost) : null,
      reference, note, vehiclesUpdated: vehicles.length, byName,
    });
    pol.expiryDate = newExpiry;
    if (newNumber) pol.policyNumber = newNumber;
    await pol.save();

    logAudit({
      user: req.user, action: 'renew_insurance_policy', entity: 'VehicleInsurancePolicy', entityId: pol._id,
      changes: { policy: pol.policyNumber, before: previous, after: newExpiry, vehicles: vehicles.length },
      ipAddress: req.ip,
    }).catch(() => {});

    emit('vreg:updated', {});
    res.json({ policy: pol, vehiclesUpdated: vehicles.length });
  } catch (e) {
    console.error('vreg renewInsurancePolicy', e);
    return sendMongooseError(res, e, 'تعذّر تجديد الوثيقة');
  }
};

// Accidents and claims.
// An accident is recorded, edited and closed from the screen. It used to be read-only, meaning the first inventory was loaded from the sheet and any later accident had nowhere to be written.
// Computed fields (recovery gap) are computed here, not in the UI, so the screen, the report and any other path do not differ.
const CLAIM_FIELDS = [
  'isVehicleIncident', 'incidentSubjectAr', 'vehiclePlate', 'vehicle',
  'vehicleSectorAr', 'vehicleTypeAr', 'vehicleCategoryAr', 'vehicleBrandAr', 'ownerRegistrationAr',
  'driverNameAr', 'driverIdNumber',
  'counterpartyNameAr', 'counterpartyNationalId', 'faultRatio', 'faultPercent',
  'accidentDate', 'reportedViaAr', 'reportedViaCode', 'accidentNumber', 'reportOrEstimateNumber',
  'statusAr', 'statusCode',
];
const CLAIM_SUB = ['insurerAr', 'claimNumber', 'claimNumberStatus', 'notesAr',
  'lastNoteDate', 'lastInsurerUpdateDate', 'estimatedAmountSar', 'expectedRecoverySar'];

/**
 * The difference is computed at closing, not before.
 * It used to be called the gap and was computed from day one: estimated minus expected recovery, so an open claim read as a loss though not yet collected. Per the company owner, the difference is known when the money is collected, i.e. when the claim is closed. So it is empty while open and computed at the moment of closing.
 */
const claimDifference = (doc) => {
  if (doc.statusCode !== 'closed') return null;
  const est = Number(doc.claim?.estimatedAmountSar);
  const rec = Number(doc.claim?.expectedRecoverySar);
  return doc.claim?.estimatedAmountSar != null && doc.claim?.expectedRecoverySar != null
    && Number.isFinite(est) && Number.isFinite(rec) ? Math.round(est - rec) : null;
};
exports._claimDifference = claimDifference;

/** Builds/updates the document from the body and computes the difference (at closing). */
function applyClaim(doc, body) {
  for (const k of CLAIM_FIELDS) if (body[k] !== undefined) doc[k] = body[k] === '' ? doc[k] : body[k];
  const sub = body.claim || {};
  doc.claim = doc.claim || {};
  for (const k of CLAIM_SUB) if (sub[k] !== undefined) doc.claim[k] = sub[k];
  doc.claim.recoveryGapSar = claimDifference(doc);
  if (doc.vehiclePlate) doc.vehiclePlateKey = plateKey(doc.vehiclePlate);
  return doc;
}


/**
 * Who was driving this vehicle.
 * Suggested, not enforced: the section's actual driver first (the light transport record says who rides it today), then the authorized person in the vehicle registry. They differ on twenty-four vehicles (paper in one name, rider another), and the rider is closer to the truth.
 * Written only if the field is empty: a hand-written value is more truthful than any derivation.
 */
async function suggestDriver(doc) {
  try {
    if (S(doc.driverNameAr) || S(doc.driverIdNumber)) return false;
    const key = doc.vehiclePlateKey || (doc.vehiclePlate ? plateKey(doc.vehiclePlate) : null);
    if (!key && !doc.vehicle) return false;

    const { LightTransportEmployee } = require('../models/LightTransport');
    let lt = null;
    // An archived person is not suggested as driver, as if deleted.
    const AH = require('../utils/archivedHidden');
    const archSets = await endedStaff();
    if (doc.vehicle) lt = await LightTransportEmployee.findOne(AH.andAll({ vehicle: doc.vehicle, isActive: { $ne: false } }, AH.notArchivedRow(archSets))).select('name idNumber').lean();
    if (!lt && key) {
      const rows = await LightTransportEmployee.find(AH.andAll({ vehiclePlate: { $nin: ['', null] }, isActive: { $ne: false } }, AH.notArchivedRow(archSets)))
        .select('name idNumber vehiclePlate').lean();
      lt = rows.find((r) => plateKey(r.vehiclePlate) === key) || null;
    }
    if (lt) { doc.driverNameAr = lt.name; doc.driverIdNumber = lt.idNumber; return true; }

    const v = doc.vehicle
      ? await VehicleMaster.findById(doc.vehicle).select('authorizedPerson').lean()
      : (key ? (await VehicleMaster.find({}).select('plateNumber authorizedPerson').lean())
        .find((x) => plateKey(x.plateNumber) === key) : null);
    if (v?.authorizedPerson?.name && !holderArchived(archSets, v)) {
      doc.driverNameAr = v.authorizedPerson.name;
      doc.driverIdNumber = S(v.authorizedPerson.iqamaNumber);
      return true;
    }
    return false;
  } catch (e) {
    return false;   // A suggestion does not stop a save
  }
}

/**
 * People search: type a number and the fields fill.
 * Every screen in this section asks about a person: vehicle owner, authorized person, actual driver, accident driver, card holder. They used to be typed by hand each time, producing two spellings of a name, a number missing a digit, and his mobile looked up in another file.
 * One search by name, ID or residency returns the person with his data and the fields are filled from it. It is a **search, not a list**: all people's names are not shown on every screen; you type what you have and get a reply, and for someone not found the message says to ask HR to register him. Hand-typing stays open as it was.
 * Three sources in order of trust: HR file, then the light transport register (it has people with no file), then driver cards (which hold the Absher mobile).
 */
exports.personLookup = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 3) return res.json({ people: [] });

    const Employee = require('../models/Employee');
    const DriverCard = require('../models/DriverCard');
    const { LightTransportEmployee } = require('../models/LightTransport');
    const { arabicSearchRegex } = require('../utils/arabicSearch');
    const rx = arabicSearchRegex(q);
    const digits = q.replace(/\D/g, '');

    // An archived person is not suggested in any field, as if deleted.
    const { NOT_ARCHIVED } = require('../utils/hrEngagement');
    const archSets = await endedStaff();
    const [emps, lts, cards] = await Promise.all([
      Employee.find({
        ...NOT_ARCHIVED,
        $or: [{ firstName: rx }, { lastName: rx }, { arabicName: rx },
          ...(digits.length >= 4 ? [{ iqamaNumber: new RegExp(digits) }, { nationalId: new RegExp(digits) }] : [])],
      }).select('firstName lastName arabicName iqamaNumber nationalId phone mobile employeeNumber jobTitle department employmentStatus hireDate dateOfBirth iqamaExpiry iqamaExpiryHijri licenseExpiry')
        .limit(12).lean(),
      LightTransportEmployee.find({
        $or: [{ name: rx }, ...(digits.length >= 4 ? [{ idNumber: new RegExp(digits) }] : [])],
      }).select('name idNumber phone jobTitleAr projectAr cityAr vehiclePlate employee').limit(12).lean(),
      DriverCard.find({
        $or: [{ name: rx }, ...(digits.length >= 4 ? [{ idNumber: new RegExp(digits) }] : [])],
      }).select('name idNumber absherPhone cardNumber expiryDate transportTypeAr dateOfBirth').limit(12).lean(),
    ]);

    // A person is assembled from his sources by ID number: one row, not three, for one man.
    const byId = new Map();
    const put = (id, patch, source) => {
      const key = String(id || '').trim() || `~${patch.name}`;
      const cur = byId.get(key) || { idNumber: String(id || '').trim(), sources: [] };
      for (const [k, val] of Object.entries(patch)) if (val && !cur[k]) cur[k] = val;
      if (!cur.sources.includes(source)) cur.sources.push(source);
      byId.set(key, cur);
    };
    for (const e of emps) {
      put(e.iqamaNumber || e.nationalId, {
        name: e.arabicName || [e.firstName, e.lastName].filter(Boolean).join(' '),
        phone: e.mobile || e.phone || '',
        employeeNumber: e.employeeNumber || '',
        jobTitleAr: e.jobTitle || '',
        departmentAr: e.department || '',
        employmentStatus: e.employmentStatus || '',
        hireDate: e.hireDate || null,
        // Birth date from his file, shown under the residency number in the authorization and the driver card.
        dateOfBirth: e.dateOfBirth || '',
        // His residency and driving-license expiry, in Gregorian. Someone whose residency is registered in Hijri only is converted, so it does not read 'not registered' when it is.
        iqamaExpiry: e.iqamaExpiry || (e.iqamaExpiryHijri ? (require('../utils/hijri').fromHijriString(e.iqamaExpiryHijri) || '') : ''),
        licenseExpiry: e.licenseExpiry || '',
        employeeId: String(e._id),
      }, 'hr');
    }
    for (const e of lts) {
      if (e.employee ? employeeArchived(archSets, e.employee) : idNumberArchived(archSets, e.idNumber)) continue;
      put(e.idNumber, {
        name: e.name, phone: e.phone || '', jobTitleAr: e.jobTitleAr || '',
        projectAr: e.projectAr || '', cityAr: e.cityAr || '', vehiclePlate: e.vehiclePlate || '',
      }, 'light_transport');
    }
    for (const c of cards) {
      if (idNumberArchived(archSets, c.idNumber)) continue;
      put(c.idNumber, {
        name: c.name, absherPhone: c.absherPhone || '', cardNumber: c.cardNumber || '',
        cardExpiryDate: c.expiryDate || null, transportTypeAr: c.transportTypeAr || '',
        dateOfBirth: c.dateOfBirth || '',
      }, 'driver_card');
    }

    const people = [...byId.values()].filter((p) => p.name).slice(0, 15);
    res.json({ people });
  } catch (e) {
    console.error('vreg personLookup', e);
    res.status(500).json({ message: 'تعذّر البحث عن الشخص' });
  }
};

/** Register plates for selection, instead of hand-typing the plate in the section's forms. */
exports.plateOptions = async (req, res) => {
  try {
    const [rows, archSets] = await Promise.all([VehicleMaster.find({ isActive: { $ne: false } })
      .select('plateNumber serialNumber registrationTypeAr sectorAr brandAr modelAr ownerCompanyAr authorizedPerson actualDriver')
      .sort({ plateNumber: 1 }).limit(2000).lean(), endedStaff()]);
    // The plate stays selectable; an archived person's name on it is not suggested.
    const hideA = (v) => holderArchived(archSets, v);
    const hideD = (v) => idNumberArchived(archSets, v.actualDriver?.idNumber);
    res.json({
      // Vehicle type is not its registration type.
      // The list showed `registrationTypeAr` under the label 'type', which is the plate license: sixty-eight trucks all 'public transport'. Whoever opened the list saw the same description beside every truck and could not tell them apart. The type meant is make and model ('Sino / head'), which is what the accident register itself records.
      plates: rows.filter((v) => String(v.plateNumber || '').trim()).map((v) => ({
        _id: String(v._id),
        plate: v.plateNumber,
        serial: v.serialNumber || '',
        typeAr: [v.brandAr, v.modelAr].filter(Boolean).join(' / '),
        registrationTypeAr: v.registrationTypeAr || '',
        ownerCompanyAr: v.ownerCompanyAr || '',
        sectorAr: v.sectorAr || '',
        authorizedName: hideA(v) ? '' : (v.authorizedPerson?.name || ''),
        authorizedId: hideA(v) ? '' : (v.authorizedPerson?.iqamaNumber || ''),
        actualDriverName: hideD(v) ? '' : (v.actualDriver?.name || ''),
        actualDriverId: hideD(v) ? '' : (v.actualDriver?.idNumber || ''),
      })),
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل اللوحات' });
  }
};

exports.createClaim = async (req, res) => {
  try {
    if (!req.body?.accidentDate && !req.body?.incidentSubjectAr && !req.body?.vehiclePlate) {
      return res.status(400).json({ message: 'اكتب على الأقل المركبة أو موضوع الواقعة أو تاريخها' });
    }
    // The number is generated here; otherwise it would be duplicated or left blank by the user.
    const last = await VehicleClaim.findOne({ claimId: /^ACC-/ }).sort({ claimId: -1 }).select('claimId').lean();
    const n = last ? (Number(String(last.claimId).replace('ACC-', '')) || 0) + 1 : 1;
    const doc = applyClaim(new VehicleClaim({ claimId: `ACC-${String(n).padStart(3, '0')}` }), req.body);
    if (!doc.statusCode) { doc.statusCode = 'pending'; doc.statusAr = doc.statusAr || 'قيد المتابعة'; }
    doc.createdBy = req.user?._id;
    doc.createdByName = [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ');
    await suggestDriver(doc);
    await doc.save();
    await syncAccidentCount(doc.vehiclePlateKey);
    // A claim is a reviewed financial record, so everything written to it is recorded with its author and time. No write here used to be recorded, so a claim's history started from nothing.
    logAudit({
      user: req.user, action: 'create_vehicle_claim', entity: 'VehicleClaim', entityId: doc._id,
      changes: { after: { claimId: doc.claimId, plate: doc.vehiclePlate, date: doc.accidentDate } },
      ipAddress: req.ip,
    }).catch(() => {});
    emit('vreg:updated', {});
    res.status(201).json({ claim: doc });
  } catch (e) {
    console.error('vreg createClaim', e);
    return sendMongooseError(res, e, 'تعذّر تسجيل الحادث');
  }
};

exports.updateClaim = async (req, res) => {
  try {
    const doc = await VehicleClaim.findById(req.params.id);
    if (!doc || doc.isActive === false) return res.status(404).json({ message: 'الحادث غير موجود' });
    const oldKey = doc.vehiclePlateKey;
    applyClaim(doc, req.body);
    doc.lastModifiedBy = req.user?._id;
    doc.lastModifiedByName = [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ');
    // Changing the vehicle re-suggests the driver when the field is empty.
    await suggestDriver(doc);

    // The insurer's reply is appended, not written over the previous one.
    // The insurance company replies several times on one claim, and the negotiation history is what is cited in a dispute. What arrives here is appended to the log and erases nothing.
    const reply = req.body.newInsurerReply;
    if (reply && String(reply.text || '').trim()) {
      doc.insurerReplies.push({
        at: reply.at ? new Date(reply.at) : new Date(),
        text: String(reply.text).trim(),
        amountSar: reply.amountSar == null || reply.amountSar === '' ? null : Number(reply.amountSar),
        by: req.user?._id,
        byName: [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' '),
      });
      // The last reply is the date of the company's last update; it is read in the 'stalled' view.
      doc.claim = doc.claim || {};
      doc.claim.lastInsurerUpdateDate = new Date();
    }

    await doc.save();
    await syncAccidentCount(oldKey);
    if (doc.vehiclePlateKey !== oldKey) await syncAccidentCount(doc.vehiclePlateKey);
    logAudit({
      user: req.user, action: 'update_vehicle_claim', entity: 'VehicleClaim', entityId: doc._id,
      // Only the sent fields, not the whole document: the record is read to know what changed.
      changes: { after: Object.keys({ ...req.body, ...(req.body.claim || {}) }).filter((k) => k !== 'claim') },
      ipAddress: req.ip,
    }).catch(() => {});
    emit('vreg:updated', {});
    res.json({ claim: doc });
  } catch (e) {
    console.error('vreg updateClaim', e);
    return sendMongooseError(res, e, 'تعذّر تعديل الحادث');
  }
};

exports.deleteClaim = async (req, res) => {
  try {
    const doc = await VehicleClaim.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'الحادث غير موجود' });
    // Soft delete: a claim is a financial record, and a hard delete loses its history.
    doc.isActive = false;
    await doc.save();
    await syncAccidentCount(doc.vehiclePlateKey);
    logAudit({
      user: req.user, action: 'delete_vehicle_claim', entity: 'VehicleClaim', entityId: doc._id,
      changes: { before: { claimId: doc.claimId, plate: doc.vehiclePlate } }, ipAddress: req.ip,
    }).catch(() => {});
    emit('vreg:updated', {});
    res.json({ ok: true });
  } catch (e) {
    console.error('vreg deleteClaim', e);
    res.status(500).json({ message: 'تعذّر حذف الحادث' });
  }
};

/**
 * The file of a single claim.
 * The table used to be everything a claim had: read in a nine-column row, then edited in a dialog. What does not fit the row (the other party, fault percentage, report source, the company's reply log, all the papers) could be read only by opening the edit dialog. A claim is a file opened and followed, not a row in a statement.
 */
exports.getClaim = async (req, res) => {
  try {
    const claim = await VehicleClaim.findById(req.params.id)
      .populate('vehicle', 'plateNumber sectorAr departmentAr brandAr modelAr modelYear ownerNameAr')
      .lean();
    if (!claim || claim.isActive === false) return res.status(404).json({ message: 'الحادث غير موجود' });
    res.json({ claim });
  } catch (e) {
    console.error('vreg getClaim', e);
    res.status(500).json({ message: 'تعذّر تحميل الحادث' });
  }
};

/** History of what happened to this claim, from audit entries, newest first. */
exports.getClaimAudit = async (req, res) => {
  try {
    const AuditLog = require('../models/AuditLog');
    const logs = await AuditLog.find({ entity: 'VehicleClaim', entityId: req.params.id })
      .populate('user', 'firstName lastName role').sort({ createdAt: -1 }).limit(300).lean();
    res.json({ logs });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل السجلّ' });
  }
};

/**
 * Claim attachments, in one batch or file by file, each with a name its owner types.
 * The file arrives in the body as an encoded `data:` URL (the system has no `multer`), is decoded and written to `uploads/claims`. See utils/fileStore.
 */
exports.addClaimAttachments = async (req, res) => {
  try {
    const doc = await VehicleClaim.findById(req.params.id);
    if (!doc || doc.isActive === false) return res.status(404).json({ message: 'الحادث غير موجود' });
    const incoming = Array.isArray(req.body.files) ? req.body.files : [req.body];
    if (!incoming.length) return res.status(400).json({ message: 'اختر ملفًّا' });
    doc.attachments = doc.attachments || [];
    // A cap on the count: a claim with a hundred attachments is unreadable, and the disk is not unlimited.
    if (doc.attachments.length + incoming.length > 40) {
      return res.status(400).json({ message: 'لا يُرفَق أكثر من ٤٠ ملفًّا للمطالبة' });
    }
    for (const f of incoming) {
      if (!f || !f.dataUrl) continue;
      let stored;
      try { stored = saveUploadFile(f.dataUrl, 'claims', f.fileName || ''); }
      catch (e) { return res.status(400).json({ message: e.message }); }
      doc.attachments.push({
        ...stored,
        title: String(f.title || '').trim().slice(0, 200),
        uploadedBy: req.user?._id,
        uploadedByName: [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' '),
        uploadedAt: new Date(),
      });
    }
    await doc.save();
    logAudit({
      user: req.user, action: 'add_claim_attachment', entity: 'VehicleClaim', entityId: doc._id,
      changes: { after: { files: incoming.map((f) => f.title || f.fileName).filter(Boolean) } }, ipAddress: req.ip,
    }).catch(() => {});
    emit('vreg:updated', {});
    res.status(201).json({ claim: doc.toObject() });
  } catch (e) {
    console.error('vreg addClaimAttachments', e);
    res.status(500).json({ message: 'تعذّر رفع الملفّ' });
  }
};

/** Only the name is edited; the bytes are not replaced, since an uploaded file is evidence, not a draft. */
exports.renameClaimAttachment = async (req, res) => {
  try {
    const doc = await VehicleClaim.findById(req.params.id);
    if (!doc || doc.isActive === false) return res.status(404).json({ message: 'الحادث غير موجود' });
    const att = doc.attachments.id(req.params.attId);
    if (!att) return res.status(404).json({ message: 'المرفق غير موجود' });
    att.title = String(req.body.title || '').trim().slice(0, 200);
    await doc.save();
    emit('vreg:updated', {});
    res.json({ claim: doc.toObject() });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تعديل المرفق' });
  }
};

exports.deleteClaimAttachment = async (req, res) => {
  try {
    const doc = await VehicleClaim.findById(req.params.id);
    if (!doc || doc.isActive === false) return res.status(404).json({ message: 'الحادث غير موجود' });
    const att = doc.attachments.id(req.params.attId);
    if (!att) return res.status(404).json({ message: 'المرفق غير موجود' });
    const url = att.fileUrl;
    const title = att.title || att.fileName;
    att.deleteOne();
    await doc.save();
    // The bytes are deleted after the save succeeds: if the save failed, a record would remain pointing to a missing file.
    try { deleteStoredFile(url); } catch (e) { /* The record was cleaned */ }
    logAudit({
      user: req.user, action: 'delete_claim_attachment', entity: 'VehicleClaim', entityId: doc._id,
      changes: { before: { title } }, ipAddress: req.ip,
    }).catch(() => {});
    emit('vreg:updated', {});
    res.json({ claim: doc.toObject() });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر حذف المرفق' });
  }
};

/** A vehicle's accident counter equals the count of its active claims: computed, not hand-written. */
async function syncAccidentCount(key) {
  if (!key) return;
  const n = await VehicleClaim.countDocuments({ vehiclePlateKey: key, isActive: true });
  await VehicleMaster.updateMany({ plateKey: key }, { $set: { accidentCount: n } });
}

exports.listClaims = async (req, res) => {
  try {
    const f = { isActive: true };
    if (req.query.status) f.statusCode = req.query.status;
    if (req.query.insurer) f['claim.insurerAr'] = req.query.insurer;
    if (req.query.vehicleId) f.vehicle = req.query.vehicleId;
    if (req.query.q && req.query.q.trim()) {
      // Same search rule as the vehicle registry: spaces and spelling variants do not block a match. The plate used to be matched literally here and not found.
      const rx = flexSpaceRegex(req.query.q);
      f.$or = [{ vehiclePlate: rx }, { accidentNumber: rx }, { counterpartyNameAr: rx }, { 'claim.insurerAr': rx }, { incidentSubjectAr: rx }];
    }
    const rows = await VehicleClaim.find(f).sort({ accidentDate: -1 }).limit(500).lean();
    const money = (k) => Math.round(rows.reduce((t, r) => t + (Number(r.claim?.[k]) || 0), 0));
    res.json({
      claims: rows,
      totals: {
        total: rows.length,
        open: rows.filter((r) => r.statusCode !== 'closed').length,
        estimatedSar: money('estimatedAmountSar'),
        expectedRecoverySar: money('expectedRecoverySar'),
        gapSar: money('recoveryGapSar'),
        // Days elapsed with no reply from the insurer: this exposes the dormant claim.
        stale: rows.filter((r) => r.statusCode !== 'closed' && r.claim?.lastInsurerUpdateDate
          && VDOC.daysLeft(r.claim.lastInsurerUpdateDate) < -30).length,
      },
    });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل الحوادث' }); }
};

// Company-level insurance policies.

/**
 * Ending the contract with the company.
 * A policy used to have only renewal: extended, or left expired alerting every week. But sometimes the contract is ended and not renewed. It then stayed in expiries demanding renewal of something closed by decision, and the alert read as neglect when it was a decision.
 * So termination is an action recorded with its date and reason and entered in the policy log like a renewal, so it can be read back as to when and why it stopped. The policy stays in the register: what ended is read, not erased.
 */
exports.endCorporatePolicy = async (req, res) => {
  try {
    const p = await CorporatePolicy.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'الوثيقة غير موجودة' });
    if (p.endedAt) return res.status(400).json({ message: 'العقدُ مُنهًى بالفعل' });
    const when = req.body.endDate ? new Date(req.body.endDate) : new Date();
    if (Number.isNaN(when.getTime())) return res.status(400).json({ message: 'تاريخٌ غير صالح' });

    p.endedAt = when;
    p.endReasonAr = String(req.body.reason || '').trim();
    p.renewals = p.renewals || [];
    p.renewals.push({
      previousExpiry: p.expiryDate,
      newExpiry: when,
      note: `إنهاءُ العقد${p.endReasonAr ? ` — ${p.endReasonAr}` : ''}`,
      byName: [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' '),
      at: new Date(),
    });
    await p.save();
    logAudit({
      user: req.user, action: 'end_corporate_policy', entity: 'CorporatePolicy', entityId: p._id,
      changes: { after: { endedAt: when, reason: p.endReasonAr } }, ipAddress: req.ip,
    }).catch(() => {});
    emit('vreg:updated', {});
    return res.json({ policy: p.toObject() });
  } catch (e) {
    console.error('endCorporatePolicy', e);
    return res.status(500).json({ message: 'تعذّر إنهاء العقد' });
  }
};

/** What was terminated may resume, so reversal is possible and is recorded too. */
exports.reopenCorporatePolicy = async (req, res) => {
  try {
    const p = await CorporatePolicy.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'الوثيقة غير موجودة' });
    if (!p.endedAt) return res.status(400).json({ message: 'العقدُ سارٍ أصلًا' });
    p.renewals = p.renewals || [];
    p.renewals.push({
      newExpiry: p.expiryDate || new Date(),
      note: 'أُعيد فتحُ العقد',
      byName: [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' '),
      at: new Date(),
    });
    p.endedAt = null;
    p.endReasonAr = '';
    await p.save();
    emit('vreg:updated', {});
    return res.json({ policy: p.toObject() });
  } catch (e) {
    return res.status(500).json({ message: 'تعذّر إعادة الفتح' });
  }
};

exports.listCorporatePolicies = async (req, res) => {
  try {
    // The page used to read all driver cards on every open.
    // Three policies, and with them sixty-one cards were read to compute fidelity-policy coverage, so a cold open took a second and a quarter. Cards change a few times a day, so they are served from a short cache cleared on any write in the section (see `emit`).
    const ck = `vreg:corp:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(ck);
    if (hit !== undefined) return res.json(hit);
    const [rows, cfg] = await Promise.all([
      CorporatePolicy.find({ isActive: true }).sort({ expiryDate: 1 }).lean(),
      getConfig(),
    ]);
    // Who the fidelity policy covers.
    // The list is not copied onto the policy: it lives in the driver cards. So it is read with them and the total is computed from the number actually covered, not from a number written in the name, which is true the day it was written and false after the first hire.
    const needsDrivers = rows.some((p) => p.coversDrivers);
    // An archived person is not counted as covered by the policy and is not named in it.
    const archSets = needsDrivers ? await endedStaff() : null;
    const cards = needsDrivers
      ? (await DriverCard.find({ isActive: { $ne: false } })
        .select('idNumber name cardNumber expiryDate fidelity employee')
        .populate('employee', 'employeeNumber arabicName')
        .sort({ name: 1 }).lean()).filter((c) => !cardArchived(archSets, c))
      : [];

    const body = {
      policies: rows.map((p) => {
        const st = VDOC.stateOf(p.expiryDate, '', cfg.alerts?.corporatePolicy);
        // What was terminated by decision gets no alert: its state is 'terminated', not 'expired'.
        const out = p.endedAt
          ? { ...p, state: 'ended', daysRemaining: null }
          : { ...p, state: st.state, daysRemaining: st.days };
        // Old policies have no written subject: it is inferred from their pricing.
        if (!out.coverageSubject) out.coverageSubject = p.coversDrivers ? 'drivers' : 'other';
        if (out.coverageSubject === 'vehicles') {
          out.computedPremiumSar = p.premiumPerVehicleSar != null && p.vehicleCount != null
            ? Math.round(p.premiumPerVehicleSar * p.vehicleCount * 100) / 100
            : null;
        }
        if (p.coversDrivers) {
          const covered = cards.filter((c) => c.fidelity?.status === 'covered');
          const pending = cards.filter((c) => c.fidelity?.status === 'required');
          out.drivers = {
            covered: covered.map((c) => ({
              _id: String(c._id), idNumber: c.idNumber, name: c.name,
              cardNumber: c.cardNumber || '', addedDate: c.fidelity?.addedDate || '',
              employeeNumber: c.employee?.employeeNumber || '',
            })),
            pending: pending.map((c) => ({
              _id: String(c._id), idNumber: c.idNumber, name: c.name,
              employeeNumber: c.employee?.employeeNumber || '',
            })),
            coveredCount: covered.length,
          };
          // Computed total: per-head price x number covered. `premiumSar` stays as is if hand-written; the screen shows both and hides neither.
          out.computedPremiumSar = p.premiumPerPersonSar != null
            ? Math.round(p.premiumPerPersonSar * covered.length * 100) / 100
            : null;
        }
        return out;
      }),
    };
    // Short cache: three policies and sixty-one cards, both rarely changing.
    cache.set(ck, body, 60 * 1000);
    res.json(body);

  } catch (e) { console.error('listCorporatePolicies', e); res.status(500).json({ message: 'تعذّر تحميل وثائق الشركة' }); }
};

/** Fields written on a company policy; nothing else is written from the screen. */
const CORP_FIELDS = ['scopeAr', 'policyholderAr', 'policyNumbers', 'companyAr', 'startDate',
  'expiryDate', 'premiumSar', 'premiumPerPersonSar', 'statusAr', 'notesAr', 'coversDrivers',
  'coverageSubject', 'premiumPerVehicleSar', 'vehicleCount'];
const SUBJECTS = ['drivers', 'vehicles', 'goods', 'other'];

/** Create and edit a company policy. The page used to display and write only renewal, so any correction of a number, premium or company needed database access. */
const pickCorp = (body) => {
  const out = {};
  for (const k of CORP_FIELDS) {
    if (body[k] === undefined) continue;
    if (k === 'policyNumbers') {
      out[k] = Array.isArray(body[k]) ? body[k].map((x) => String(x).trim()).filter(Boolean)
        : String(body[k] || '').split(/[,،\n]/).map((x) => x.trim()).filter(Boolean);
    } else if (k === 'expiryDate' || k === 'startDate') {
      out[k] = body[k] ? new Date(body[k]) : null;
    } else if (k === 'coverageSubject') {
      out[k] = SUBJECTS.includes(body[k]) ? body[k] : '';
    } else if (['premiumSar', 'premiumPerPersonSar', 'premiumPerVehicleSar', 'vehicleCount'].includes(k)) {
      out[k] = body[k] === '' || body[k] === null ? null : Number(body[k]);
    } else if (k === 'coversDrivers') {
      out[k] = !!body[k];
    } else out[k] = String(body[k] ?? '').trim();
  }
  // The subject decides the rest: no driver list stays on a goods policy, and no per-head price on a vehicles policy from which a meaningless total is computed.
  if (out.coverageSubject) {
    out.coversDrivers = out.coverageSubject === 'drivers';
    if (out.coverageSubject !== 'drivers') out.premiumPerPersonSar = null;
    if (out.coverageSubject !== 'vehicles') { out.premiumPerVehicleSar = null; out.vehicleCount = null; }
  }
  return out;
};

exports.createCorporatePolicy = async (req, res) => {
  try {
    const data = pickCorp(req.body);
    if (!data.scopeAr) return res.status(400).json({ message: 'اكتب اسم الوثيقة' });
    const p = await CorporatePolicy.create({ ...data, isActive: true });
    logAudit({ user: req.user, action: 'create_corporate_policy', entity: 'CorporatePolicy', entityId: p._id, changes: { after: data }, ipAddress: req.ip }).catch(() => {});
    emit('vreg:updated', {});
    res.status(201).json({ policy: p });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر إنشاء الوثيقة'); }
};

exports.updateCorporatePolicy = async (req, res) => {
  try {
    const p = await CorporatePolicy.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'الوثيقة غير موجودة' });
    const data = pickCorp(req.body);
    const before = { scopeAr: p.scopeAr, expiryDate: p.expiryDate, premiumSar: p.premiumSar, premiumPerPersonSar: p.premiumPerPersonSar };
    Object.assign(p, data);
    await p.save();
    logAudit({ user: req.user, action: 'update_corporate_policy', entity: 'CorporatePolicy', entityId: p._id, changes: { before, after: data }, ipAddress: req.ip }).catch(() => {});
    emit('vreg:updated', {});
    res.json({ policy: p });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر حفظ الوثيقة'); }
};

exports.deleteCorporatePolicy = async (req, res) => {
  try {
    // Soft delete: a policy is history, and its renewal log is read after expiry.
    const p = await CorporatePolicy.findByIdAndUpdate(req.params.id, { $set: { isActive: false } }, { new: true });
    if (!p) return res.status(404).json({ message: 'الوثيقة غير موجودة' });
    logAudit({ user: req.user, action: 'delete_corporate_policy', entity: 'CorporatePolicy', entityId: p._id, ipAddress: req.ip }).catch(() => {});
    emit('vreg:updated', {});
    res.json({ ok: true });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر حذف الوثيقة'); }
};

/**
 * Add a driver to the fidelity policy or remove him. POST /corporate-policies/:id/drivers
 * { cardId, covered: true|false, addedDate? }
 * Written on the driver's card, not on the policy: the list is one record, not two copies.
 */
exports.setPolicyDriver = async (req, res) => {
  try {
    const p = await CorporatePolicy.findById(req.params.id).lean();
    if (!p) return res.status(404).json({ message: 'الوثيقة غير موجودة' });
    if (!p.coversDrivers) return res.status(400).json({ message: 'هذه الوثيقة لا تغطّي أشخاصًا' });
    const card = await DriverCard.findById(req.body.cardId);
    if (!card) return res.status(404).json({ message: 'بطاقة السائق غير موجودة' });
    const covered = req.body.covered !== false;
    card.fidelity = {
      ...(card.fidelity ? card.fidelity.toObject?.() || card.fidelity : {}),
      status: covered ? 'covered' : 'required',
      addedDate: covered ? (req.body.addedDate || card.fidelity?.addedDate || new Date().toISOString().slice(0, 10)) : '',
    };
    card.lastModifiedBy = req.user?._id;
    await card.save();
    logAudit({
      user: req.user, action: covered ? 'add_driver_to_policy' : 'remove_driver_from_policy',
      entity: 'DriverCard', entityId: card._id,
      changes: { after: { policy: p.scopeAr, driver: card.name, covered } }, ipAddress: req.ip,
    }).catch(() => {});
    emit('vreg:updated', {});
    res.json({ card });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر تعديل قائمة المشمولين'); }
};

exports.renewCorporatePolicy = async (req, res) => {
  try {
    const newExpiry = req.body.newExpiry ? new Date(req.body.newExpiry) : null;
    if (!newExpiry || isNaN(newExpiry)) return res.status(400).json({ message: 'أدخل تاريخ الانتهاء الجديد' });
    const p = await CorporatePolicy.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'الوثيقة غير موجودة' });
    const previous = p.expiryDate;
    p.expiryDate = newExpiry;
    if (!Array.isArray(p.renewals)) p.renewals = [];
    p.renewals.push({
      previousExpiry: previous, newExpiry,
      cost: req.body.cost != null && req.body.cost !== '' ? Number(req.body.cost) : null,
      reference: String(req.body.reference || '').trim(),
      note: String(req.body.note || '').trim(),
      byName: `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim(),
    });
    await p.save();
    logAudit({
      user: req.user, action: 'renew_corporate_policy', entity: 'CorporatePolicy', entityId: p._id,
      changes: { before: { expiry: previous }, after: { expiry: newExpiry } }, ipAddress: req.ip,
    }).catch(() => {});
    emit('vreg:updated', {});
    res.json({ policy: p });
  } catch (e) { res.status(500).json({ message: 'تعذّر تسجيل التجديد' }); }
};

/** Document definitions: the UI builds filters and settings from them instead of repeating them. */
exports.documentTypes = async (req, res) => {
  const cfg = await getConfig();
  res.json({
    // `numberAr` lets the renewal dialog know whether a document has a number that changes with renewal (so it asks for it) or none (so it stays silent). Without it the UI would keep its own list and diverge from the server as soon as a document is added.
    documents: DOC_TYPES.map((d) => ({
      key: d.key, ar: d.ar, en: d.en, icon: d.icon,
      numberAr: d.numberPath ? d.numberAr : null, numberEn: d.numberPath ? d.numberEn : null,
      // One paper covering many vehicles (insurance) or a paper per vehicle? The bulk renewal dialog depends on it: show one number for all or a number per line. See config/vehicleDocuments.
      sharedNumber: !!d.sharedNumber,
      alert: cfg.alerts?.[d.key] || {},
    })),
    corporatePolicyAlert: cfg.alerts?.corporatePolicy || {},
    states: VDOC.STATE_LABELS,
    statuses: VDOC.STATUS_LABELS,
  });
};

// Vehicle files.
// The vehicle holds its documents' dates and numbers; this holds their images. Without it 'where is the license picture?' gets searched for in WhatsApp, which is the difference between a register and a folder.
const VehicleDocument = require('../models/VehicleDocument');
const { saveUploadFile, deleteStoredFile } = require('../utils/fileStore');

exports.listVehicleDocuments = async (req, res) => {
  try {
    const docs = await VehicleDocument.find({ vehicle: req.params.id })
      .sort({ createdAt: -1 }).limit(500).lean();
    res.json({ documents: docs });
  } catch (e) {
    console.error('vreg listVehicleDocuments', e);
    res.status(500).json({ message: 'تعذّر تحميل الملفّات' });
  }
};

exports.uploadVehicleDocument = async (req, res) => {
  try {
    const v = await VehicleMaster.findById(req.params.id).select('plateNumber').lean();
    if (!v) return res.status(404).json({ message: 'المركبة غير موجودة' });

    const { title, category, expiryDate, notes, dataUrl, fileName } = req.body;
    // The name is required and not derived from the file name: 'IMG_20260829.jpg' says nothing to whoever opens the file a year later, while 'license photo' says everything.
    if (!String(title || '').trim()) return res.status(400).json({ message: 'اكتب اسمًا للملفّ' });
    if (!dataUrl) return res.status(400).json({ message: 'اختر ملفًّا' });

    let stored;
    try { stored = saveUploadFile(dataUrl, 'vehicles', fileName); }
    catch (e) { return res.status(400).json({ message: e.message }); }

    const doc = await VehicleDocument.create({
      vehicle: req.params.id, plateNumber: v.plateNumber,
      title: String(title).trim(), category: category || 'other',
      expiryDate: expiryDate || undefined, notes: notes || '',
      uploadedBy: req.user._id,
      uploadedByName: `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim(),
      ...stored,
    });
    logAudit({
      user: req.user, action: 'add_vehicle_document', entity: 'VehicleMaster', entityId: req.params.id,
      changes: { after: { title: doc.title, category: doc.category } }, ipAddress: req.ip,
    }).catch(() => {});
    emit('vreg:updated', {});
    res.status(201).json({ document: doc.toObject() });
  } catch (e) {
    console.error('vreg uploadVehicleDocument', e);
    res.status(500).json({ message: 'تعذّر رفع الملفّ' });
  }
};

exports.updateVehicleDocument = async (req, res) => {
  try {
    const doc = await VehicleDocument.findById(req.params.docId);
    if (!doc) return res.status(404).json({ message: 'الملفّ غير موجود' });
    // Bytes are not replaced: a wrong file is deleted and another uploaded. What is edited here is its description: name, family, expiry and note.
    for (const f of ['title', 'category', 'expiryDate', 'notes']) {
      if (req.body[f] !== undefined) doc[f] = req.body[f];
    }
    if (!String(doc.title || '').trim()) return res.status(400).json({ message: 'اكتب اسمًا للملفّ' });
    await doc.save();
    logAudit({
      user: req.user, action: 'update_vehicle_document', entity: 'VehicleMaster', entityId: doc.vehicle,
      changes: { after: { title: doc.title } }, ipAddress: req.ip,
    }).catch(() => {});
    emit('vreg:updated', {});
    res.json({ document: doc.toObject() });
  } catch (e) {
    return sendMongooseError(res, e, 'تعذّر تعديل الملفّ');
  }
};

exports.deleteVehicleDocument = async (req, res) => {
  try {
    const doc = await VehicleDocument.findById(req.params.docId);
    if (!doc) return res.status(404).json({ message: 'الملفّ غير موجود' });
    // Bytes are removed with the row: a file left on disk with no row pointing to it can be neither opened nor deleted, and accumulates until the disk fills with nobody knowing what it is.
    deleteStoredFile(doc.fileUrl);
    const vehicleId = doc.vehicle;
    await doc.deleteOne();
    logAudit({
      user: req.user, action: 'delete_vehicle_document', entity: 'VehicleMaster', entityId: vehicleId,
      changes: { before: { title: doc.title, fileUrl: doc.fileUrl } }, ipAddress: req.ip,
    }).catch(() => {});
    emit('vreg:updated', {});
    res.json({ message: 'حُذف الملفّ' });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر حذف الملفّ' });
  }
};

// Driver cards: a register in the vehicles section.
/**
 * Same-plate key for one plate written in two orders.
 * The two registers write the same plate reversed: letters-then-digits in the vehicle registry and digits-then-letters in the assignment log. `registryPlateKey` preserves order, rightly, since it serves search and display. Here the question is 'are they one vehicle?', so letters are sorted alphabetically and separated from the digits.
 * The letters stay in the key and are not dropped: a motorbike plate and a trailer plate can share digits, and dropping letters merges them (eleven collisions in the current file).
 */
// The rule moved to utils/plateKey (`orderlessPlateKey`); the authorization service reads it too, and two copies would diverge one day so that one links what the other does not.
const samePlate = require('../utils/plateKey').orderlessPlateKey;

const DriverCard = require('../models/DriverCard');
const VehicleAuthorization = require('../models/VehicleAuthorization');

/** Days until a date by the company calendar: computed, not stored. */
const cardDaysLeft = (ymd) => {
  if (!ymd) return null;
  const { startOfDay, todayKey } = require('../utils/companyDay');
  const a = startOfDay(todayKey()); const b = startOfDay(ymd);
  return a && b ? Math.round((b - a) / 86400000) : null;
};

/** Expiry bucket, same vocabulary as the section's other documents. */
/**
 * Card state from section settings.
 * Thresholds were hard-coded here (30/60/90), so one card read 'critical' on the cards page and 'valid' on the expiry page, because the latter computes with `stateOf` from settings. Two answers to one question; which is trusted?
 * Now the computation is single: the same `stateOf` with the `alerts.driverCard` thresholds.
 */
const cardState = (days, alert) => {
  if (days === null) return 'unknown';
  if (days < 0) return 'expired';
  const crit = Number(alert?.criticalDays ?? 30);
  const warn = Number(alert?.warnDays ?? 60);
  const soon = Number(alert?.soonDays ?? 90);
  if (days <= crit) return 'critical';
  if (days <= warn) return 'warning';
  if (days <= soon) return 'upcoming';
  return 'valid';
};

/**
 * Heavy transport driver versus the rest.
 * The card does not say this: it is one document in every case and `DriverCard` has no field for vehicle type. The difference is not in the paper but in what it authorizes: the registration type of the vehicle authorized to him. The registry has 336 vehicles, of which 212 are motorbikes driven by B2C reps and 68 are 'public transport', i.e. the trucks.
 * A driver may hold more than one vehicle, and is assigned to the heaviest he drives: someone driving a truck and a bike is a heavy transport driver, not a rep.
 */
const CLASS_OF_REG = {
  public_transport: 'heavy', private_transport: 'heavy',
  private: 'light', motorcycle: 'motorcycle',
};
const CLASS_AR = { heavy: 'نقل ثقيل', light: 'مركبة خاصة', motorcycle: 'دراجة آلية', none: 'بلا تفويض' };
const CLASS_EN = { heavy: 'Heavy transport', light: 'Private vehicle', motorcycle: 'Motorcycle', none: 'No authorisation' };
const CLASS_RANK = { heavy: 3, light: 2, motorcycle: 1, none: 0 };

const driverClass = (authorizations = []) => {
  let best = 'none';
  for (const a of authorizations) {
    // Code first, otherwise the Arabic text; some rows have no code.
    const code = String(a.registrationTypeCode || '').trim();
    let cls = CLASS_OF_REG[code];
    if (!cls) {
      // The text is read in Arabic and English: the old assignment log writes the Arabic heavy-transport name in the department and `truck` in the type.
      const s = String(a.registrationTypeAr || '');
      if (/دراجة|motorcycle|bike|scooter/i.test(s)) cls = 'motorcycle';
      else if (/نقل|شاحن|truck|trailer|heavy/i.test(s)) cls = 'heavy';
      else if (/خاص|private|car|sedan/i.test(s)) cls = 'light';
    }
    if (cls && CLASS_RANK[cls] > CLASS_RANK[best]) best = cls;
  }
  return { vehicleClass: best, vehicleClassAr: CLASS_AR[best], vehicleClassEn: CLASS_EN[best] };
};

exports.listDriverCards = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = {};
    if (q.logisticRegister) filter.logisticRegister = q.logisticRegister;
    if (q.cardType) filter.cardType = q.cardType;
    if (q.active !== 'all') filter.isActive = { $ne: false };
    if (q.q && String(q.q).trim()) {
      // 'Any name or any number', as in the rest of the section, ignoring spaces and spelling variants.
      const rx = flexSpaceRegex(q.q);
      filter.$or = [{ name: rx }, { idNumber: rx }, { cardNumber: rx },
        { absherPhone: rx }, { logisticRegister: rx }, { cardType: rx }, { notes: rx }];
    }
    if (q.fidelity) filter['fidelity.status'] = q.fidelity === 'none' ? { $in: ['', null] } : q.fidelity;
    // Card thresholds from section settings: the same ones the expiry screen computes with.
    const [cfg, ended] = await Promise.all([getConfig(), endedStaff()]);
    let cards = await DriverCard.find(filter)
      .populate('employee', 'firstName lastName arabicName employeeNumber employmentStatus')
      .sort({ expiryDate: 1 }).lean();
    // An archived person's card is neither shown nor counted; an expired one stays a row (below).
    cards = cards.filter((c) => !cardArchived(ended, c));

    // Authorizations are read with the card, so one row shows what a driver holds.
    // Authorization is written in two places, read together and merged on the folded plate key so a vehicle shows once: `VehicleMaster.authorizedPerson` (the paper, keyed by residency number) and `VehicleAuthorization` (older assignment log with handover dates).
    // The sources are not unified here; the question is answered by their union.
    const empIds = cards.map((c) => c.employee?._id).filter(Boolean);
    const idNumbers = cards.map((c) => String(c.idNumber || '').trim()).filter(Boolean);

    const [auths, masterAuths] = await Promise.all([
      empIds.length
        ? VehicleAuthorization.find({ employee: { $in: empIds }, status: 'active' })
          // The assignment log points to the old `Vehicle`, not the vehicle registry, and carries classification under two other names: `type` and `department` (heavy transport).
          .populate('vehicle', 'plateNumber type department master')
          .select('employee vehicle startDate documentExpiry').lean()
        : [],
      idNumbers.length
        ? VehicleMaster.find({ 'authorizedPerson.iqamaNumber': { $in: idNumbers } })
          .select('plateNumber authorizedPerson registrationTypeAr registrationTypeCode').lean()
        : [],
    ]);

    const byEmp = new Map(); const byIqama = new Map();
    const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
    // Old assignments are not read for a vehicle that has a paper in the registry.
    // The paper is authoritative (utils/vehicleAuthorization): an 'active' assignment on a vehicle whose paper was cancelled or moved to someone else is not an authorization. It used to appear here as a substitute for those with no paper, so a driver read as authorized on a bike whose authorization was cancelled.
    const regKeys = auths.length ? await require('../utils/vehicleAuthorization').registryPlateKeys() : new Set();
    for (const a of auths) {
      if (a.vehicle?.master || regKeys.has(samePlate(a.vehicle?.plateNumber))) continue;
      push(byEmp, String(a.employee), {
        _id: String(a._id),
        source: 'assignment',
        vehicle: a.vehicle?._id ? String(a.vehicle._id) : null,
        plateNumber: a.vehicle?.plateNumber || '',
        startDate: a.startDate || '',
        expiryDate: a.documentExpiry || '',
        authorizationNumber: '',
        registrationTypeAr: a.vehicle?.department || a.vehicle?.type || '',
        registrationTypeCode: '',
      });
    }
    for (const v of masterAuths) {
      const ap = v.authorizedPerson || {};
      push(byIqama, String(ap.iqamaNumber || '').trim(), {
        _id: String(v._id),
        source: 'registry',
        vehicle: String(v._id),        // The vehicle screen in the current registry
        plateNumber: v.plateNumber || '',
        startDate: ap.startDate ? String(ap.startDate).slice(0, 10) : '',
        expiryDate: ap.expiryDate ? String(ap.expiryDate).slice(0, 10) : '',
        authorizationNumber: ap.authorizationNumber || '',
        registrationTypeAr: v.registrationTypeAr || '',
        registrationTypeCode: v.registrationTypeCode || '',
      });
    }

    // Classification comes from the vehicle registry alone.
    // The old assignment log writes the department, not the registration type ('B2C' in the department field), so a driver with an incomplete paper read from it would not show what he drives. The plate is the shared key, so the vehicle registry, which officially carries the registration type, is queried by the folded plate key.
    const plateKeys = [...new Set([...byIqama.values(), ...byEmp.values()].flat()
      .map((a) => samePlate(a.plateNumber)).filter(Boolean))];
    const regByPlate = new Map();
    if (plateKeys.length) {
      const regs = await VehicleMaster.find({}).select('plateNumber registrationTypeAr registrationTypeCode').lean();
      for (const v of regs) {
        const k = samePlate(v.plateNumber);
        if (k) regByPlate.set(k, { ar: v.registrationTypeAr || '', code: v.registrationTypeCode || '' });
      }
    }
    for (const list of [...byIqama.values(), ...byEmp.values()]) {
      for (const a of list) {
        const hit = regByPlate.get(samePlate(a.plateNumber));
        if (hit) { a.registrationTypeAr = hit.ar || a.registrationTypeAr; a.registrationTypeCode = hit.code || a.registrationTypeCode; }
      }
    }

    cards = cards.map((c) => {
      const days = cardDaysLeft(c.expiryDate);
      // The registry paper first, the assignment a fallback and not a partner.
      // The two registers disagree: for fourteen drivers each names a different truck than the other, some plainly swapped (5096 with this one in the registry and 5033 with that one, reversed in the other). The drivers swapped trucks and the assignment log was not updated.
      // Showing both says a driver holds two trucks when he holds one. The authorization paper in the vehicle registry is the valid document; it carries the number and term and is what is shown at a checkpoint. If it exists it is the answer alone, and the assignment log is read only for those with no paper there.
      const fromRegistry = byIqama.get(String(c.idNumber || '').trim()) || [];
      const fromAssign = c.employee ? (byEmp.get(String(c.employee._id)) || []) : [];
      const authorizations = fromRegistry.length ? fromRegistry : fromAssign;
      return {
        ...c,
        daysLeft: days,
        state: cardState(days, cfg.alerts?.driverCard),
        authorizations,
        // What this driver drives: what is written on the card first, with the derived value from his vehicles filling the blank. See `driverClass` below.
        ...(() => {
          const derived = driverClass(authorizations);
          const written = S(c.transportTypeAr);
          if (!written) return derived;
          const code = Object.entries(CLASS_AR).find(([, ar]) => ar === written)?.[0] || derived.vehicleClass;
          return { vehicleClass: code, vehicleClassAr: written, vehicleClassEn: CLASS_EN[code] || written, vehicleClassSource: 'card' };
        })(),
        // The disagreement is not hidden: the row says the older register has another opinion, to be reviewed.
        staleAssignments: fromRegistry.length
          ? fromAssign.filter((a) => !fromRegistry.some((r) => samePlate(r.plateNumber) === samePlate(a.plateNumber)))
            .map((a) => a.plateNumber).filter(Boolean)
          : [],
      };
    });
    // The bucket is filtered after computing: it is derived from the date, not a database field.
    if (q.state) cards = cards.filter((c) => c.state === q.state);
    // Likewise the type of what he drives: derived from his vehicles, not written on his card.
    if (q.vehicleClass) cards = cards.filter((c) => c.vehicleClass === q.vehicleClass);

    // The card is identified by its number, and blank means 'required'.
    // The registry has fifty-nine drivers and fifty-seven cards; two cards are not yet extracted. That used to be written in the number field as text, the word 'required' in the place of the number. The field read as a number found a word, the row counted as a card though not a card, and 'total cards 59' was really fifty-seven.
    // The state is derived, not written: an empty field means 'not extracted'. So no word is written in a thousand spellings, and no invented number reads as a number.
    const NO_CARD = /^\s*(?:مطلوب(?:ة)?|بدون|لا\s*يوجد|غير\s*مستخرجة?|-|—|n\/?a|none)\s*$/i;
    const hasCard = (c) => {
      const n = String(c.cardNumber || '').trim();
      return !!n && !NO_CARD.test(n);
    };
    // His residency and driving-license expiry from his HR file (utils/personDocDates).
    const docs = await require('../utils/personDocDates').docDatesFor(cards);
    cards = cards.map((c) => ({ ...c, ...docs(c), hasCard: hasCard(c), ...(cardEnded(ended, c) ? { ended: true } : {}) }));
    // Filtered after derivation, like the bucket.
    if (q.has === 'yes') cards = cards.filter((c) => c.hasCard);
    if (q.has === 'no') cards = cards.filter((c) => !c.hasCard);

    // Someone whose service ended stays as a row but is not counted.
    // HR ended his service, so he is not counted among the section's drivers or its buckets.
    const listed = cards;
    cards = listed.filter((c) => !c.ended);
    const count = (s) => cards.filter((c) => c.state === s).length;
    res.json({
      cards: listed,
      totals: {
        // The first number is drivers, not cards: that is what is asked, how many drivers we have and how many of them hold a card authorizing driving.
        drivers: cards.length,
        withCard: cards.filter((c) => c.hasCard).length,
        withoutCard: cards.filter((c) => !c.hasCard).length,
        total: cards.length,
        expired: count('expired'),
        critical: count('critical'),
        warning: count('warning'),
        // 'Upcoming' is a displayed, filterable bucket and is not folded into 'valid': it used to be merged, so the count said the card is valid while the expiry page said it is near.
        upcoming: count('upcoming'),
        valid: count('valid'),
        unlinked: cards.filter((c) => !c.employee).length,
        // Fidelity insurance: 'required' is the number that gets read, a working driver the policy does not cover. 'No answer' is not zero: it is a question not yet asked.
        fidelityCovered: cards.filter((c) => c.fidelity?.status === 'covered').length,
        fidelityRequired: cards.filter((c) => c.fidelity?.status === 'required').length,
        fidelityUnknown: cards.filter((c) => !c.fidelity?.status).length,
        authorized: cards.filter((c) => (c.authorizations || []).length > 0).length,
        /**
         * Divided by cardholders, not all drivers.
         * The question is 'of the cards we have, how many are heavy transport and how many light?'. The count was over all rows, so a split totaling sixty was read over a card total of fifty-nine, two numbers for one thing that do not reconcile.
         * Light transport here covers the motorbike and the private vehicle: in the field they are one class against heavy transport, and the binary split is what is read.
         */
        heavy: cards.filter((c) => c.hasCard && c.vehicleClass === 'heavy').length,
        light: cards.filter((c) => c.hasCard && ['light', 'motorcycle'].includes(c.vehicleClass)).length,
        unclassified: cards.filter((c) => c.hasCard && !['heavy', 'light', 'motorcycle'].includes(c.vehicleClass)).length,
        // The detailed breakdown stays for those who filter by it from the table.
        motorcycle: cards.filter((c) => c.vehicleClass === 'motorcycle').length,
        lightVehicle: cards.filter((c) => c.vehicleClass === 'light').length,
        noVehicle: cards.filter((c) => c.vehicleClass === 'none').length,
      },
      // Filter values are built from the register, not hand-written.
      options: {
        logisticRegister: [...new Set(listed.map((c) => c.logisticRegister).filter(Boolean))],
        cardType: [...new Set(listed.map((c) => c.cardType).filter(Boolean))],
        // Both code and name: the screen shows the name and sends the code.
        vehicleClass: ['heavy', 'light', 'motorcycle', 'none']
          .map((k) => ({ code: k, ar: CLASS_AR[k], en: CLASS_EN[k] })),
      },
    });
  } catch (e) {
    console.error('listDriverCards error:', e);
    res.status(500).json({ message: 'تعذّر تحميل بطاقات السائقين' });
  }
};

const CARD_FIELDS = ['idNumber', 'employee', 'name', 'dateOfBirth', 'absherPhone', 'transportTypeAr',
  'logisticRegister', 'cardNumber', 'cardType', 'expiryDate', 'notes', 'isActive', 'fidelity'];

const pickCard = (body) => {
  const out = {};
  for (const k of CARD_FIELDS) if (body[k] !== undefined) out[k] = body[k];
  if (out.employee === '' || out.employee === null) delete out.employee;
  return out;
};

exports.createDriverCard = async (req, res) => {
  try {
    const data = pickCard(req.body);
    if (!String(data.idNumber || '').trim()) return res.status(400).json({ message: 'رقم الهوية مطلوب' });
    const dup = await DriverCard.findOne({ idNumber: String(data.idNumber).trim() }).lean();
    if (dup) return res.status(409).json({ message: 'توجد بطاقةٌ بهذا الرقم' });
    data.createdBy = req.user._id;
    const card = await DriverCard.create(data);
    // The card reaches its owner's HR file; see utils/driverCardSync.
    try { await require('../utils/driverCardSync').pushCardToEmployee(card); } catch (e) { console.error('driver card → HR:', e.message); }
    emit('vreg:updated', {});
    res.status(201).json({ card });
  } catch (e) { res.status(500).json({ message: e.message || 'تعذّر الحفظ' }); }
};

exports.updateDriverCard = async (req, res) => {
  try {
    const data = pickCard(req.body);
    data.lastModifiedBy = req.user._id;
    const card = await DriverCard.findByIdAndUpdate(req.params.id, { $set: data }, { new: true, runValidators: true });
    if (!card) return res.status(404).json({ message: 'غير موجودة' });
    // The card snapshot on the employee file is updated with it: HR screens read it, and leaving it would make two different numbers for one thing. It used to be updated only if the card was linked by id, but most are linked by ID number, so cards were renewed in vehicles and stayed 'expired' in HR.
    try { await require('../utils/driverCardSync').pushCardToEmployee(card); } catch (e) { console.error('driver card → HR:', e.message); }
    emit('vreg:updated', {});
    res.json({ card });
  } catch (e) { res.status(500).json({ message: e.message || 'تعذّر الحفظ' }); }
};

exports.deleteDriverCard = async (req, res) => {
  try {
    const card = await DriverCard.findByIdAndDelete(req.params.id);
    if (!card) return res.status(404).json({ message: 'غير موجودة' });
    try { await require('../utils/driverCardSync').clearEmployeeCard(card); } catch (e) { console.error('driver card delete → HR:', e.message); }
    emit('vreg:updated', {});
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ message: e.message || 'تعذّر الحذف' }); }
};

// Authorization: revoke and assign. POST /:id/authorization
/**
 * Revoking is a separate action, not clearing fields: authorization lives in two registers, the paper (`VehicleMaster.authorizedPerson`) and the assignment (`VehicleAuthorization`), and erasing the name empties only the paper, leaving the employee 'authorized' in HR and blocking his clearance.
 * The action closes both and records who, when and why.
 * body: { action: 'revoke' | 'assign', reason?, name?, iqamaNumber?, authorizationNumber?, jobTitleAr?, startDate?, expiryDate? }
 */
exports.authorizationAction = async (req, res) => {
  try {
    const v = await VehicleMaster.findById(req.params.id);
    if (!v) return res.status(404).json({ message: 'المركبة غير موجودة' });

    const action = String(req.body?.action || '').trim();
    if (!['revoke', 'assign'].includes(action)) {
      return res.status(400).json({ message: 'الإجراء إمّا «إلغاء» أو «تفويض»' });
    }
    const byName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim();
    // Both registers are written from one place.
    // The paper, then the assignment log follows (utils/vehicleAuthorization). This endpoint used to write both by hand while others wrote the paper only; now everything goes through the same service, and the plate link is in it (one space or two, any order).
    const VA = require('../utils/vehicleAuthorization');

    // Revoking goes through the one shared path (services/vehicleLifecycle), used by every screen that offers it.
    if (action === 'revoke') {
      const L = require('../services/vehicleLifecycle');
      try {
        const r = await L.revokeAuthorization(v, {
          user: req.user, reason: req.body?.reason, source: S_SOURCE(req.body?.source), ip: req.ip,
        });
        return res.json({ message: r.message, closedAssignments: r.closedAssignments, clearedOrders: r.clearedOrders, vehicle: r.vehicle });
      } catch (err) { return L.reply(res, err, 'تعذّر إلغاء التفويض'); }
    }

    // Assign: the paper is written, and an assignment is opened if the employee is known.
    // The authorized person is chosen from employees (utils/vehiclePerson): a reference (`employeeId`/`ltId`) or an ID number; the name alone only if it matches a single employee.
    let holder;
    try {
      holder = await require('../utils/vehiclePerson').resolvePerson({
        employeeId: req.body?.employeeId, ltId: req.body?.ltId, idNumber: req.body?.iqamaNumber, name: req.body?.name,
      }, { label: 'المفوَّض' });
    } catch (err) { return res.status(400).json({ message: err.message }); }
    if (!holder) return res.status(400).json({ message: 'اختر المفوَّض من قائمة الموظّفين' });
    const name = holder.name;
    const iq = holder.idNumber;
    const r = await VA.setHolder(v, {
      employee: holder.employee || null, name, idNumber: iq, phone: holder.phone,
      jobTitleAr: String(req.body?.jobTitleAr || '').trim() || holder.jobTitleAr,
      authorizationNumber: String(req.body?.authorizationNumber || '').trim(),
      startDate: req.body?.startDate || null,
      expiryDate: req.body?.expiryDate || null,
    }, { userId: req.user?._id, byName, note: 'فُوِّضت المركبة من صفحة التفاويض' });
    // The employee is linked by residency number.
    // If unknown, the paper stands alone and that is stated explicitly rather than letting the link be assumed done.
    const linked = !r.unlinkedHolder;
    const note = linked ? '' : (iq ? ' (لم يُعثَر على موظّفٍ بهذا الرقم، فلم يُفتح إسنادٌ في ملفّه)' : ' (بلا رقم إقامة لا يُربط بملفّ موظّف)');

    await logAudit({
      user: req.user?._id, action: 'assign_vehicle_authorization', entity: 'VehicleMaster',
      entityId: v._id, changes: { after: { plateNumber: v.plateNumber, name, iqamaNumber: iq, linked } },
      ipAddress: req.ip,
    });
    emit('vreg:updated', {});
    return res.json({ message: `فُوِّضت ${v.plateNumber} إلى ${name}${note}`, linked, vehicle: r.vehicle });
  } catch (e) {
    console.error('authorizationAction error:', e);
    return sendMongooseError(res, e, 'تعذّر تنفيذ الإجراء');
  }
};

// Where the revoke was pressed, for the vehicle log and audit only.
const SOURCES = { registry: 'سجل المركبات', profile: 'ملفّ المركبة', authorizations: 'صفحة التفاويض', b2c: 'مركبات النقل الخفيف', mobile: 'تطبيق الجوال' };
function S_SOURCE(k) { return SOURCES[String(k || '').trim()] || SOURCES.authorizations; }

/** POST /:id/end-service { reason, date }: refused while authorized; see services/vehicleLifecycle. */
exports.endService = async (req, res) => {
  const L = require('../services/vehicleLifecycle');
  try {
    const r = await L.endService(req.params.id, req.body || {}, { user: req.user, ip: req.ip });
    res.json({ message: r.message, releasedRiders: r.releasedRiders, endedOrders: r.endedOrders });
  } catch (e) { L.reply(res, e, 'تعذّر إنهاء خدمة المركبة'); }
};

/** POST /:id/restore { reason? } */
exports.restoreService = async (req, res) => {
  const L = require('../services/vehicleLifecycle');
  try {
    const r = await L.restoreService(req.params.id, req.body || {}, { user: req.user, ip: req.ip });
    res.json({ message: r.message });
  } catch (e) { L.reply(res, e, 'تعذّر إعادة المركبة'); }
};

/** GET /archive?q=: vehicles whose service ended, newest first, with their history counts. */
exports.archiveList = async (req, res) => {
  try {
    const q = String(req.query?.q || '').trim();
    const filter = { archived: true };
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ plateNumber: rx }, { serialNumber: rx }, { chassisNumber: rx }, { brandAr: rx }, { 'archive.reason': rx }, { ownerNameAr: rx }];
    }
    const rows = await VehicleMaster.find(filter)
      .select('plateNumber plateKey serialNumber chassisNumber brandAr modelAr modelYear sectorAr departmentAr cityAr ownerNameAr registrationTypeAr archive archiveLog renewals.document accidentCount')
      .sort({ 'archive.at': -1 }).lean();
    const vehicles = rows.map((v) => ({
      ...v,
      renewals: undefined,
      authorizationEntries: (v.renewals || []).filter((r) => r.document === 'authorization').length,
      renewalEntries: (v.renewals || []).length,
    }));
    res.json({ vehicles, total: vehicles.length });
  } catch (e) { console.error('vreg archive', e); res.status(500).json({ message: 'تعذّر تحميل الأرشيف' }); }
};

// Used by the backfill script; see backfillClaimDrivers.
module.exports.suggestDriver = suggestDriver;
