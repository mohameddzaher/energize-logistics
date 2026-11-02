/**
 * Expiring documents of the vehicles section, defined once; dashboard cards, the expiry filter, renewal and alert settings all derive from here.
 * statusCode is the manual administrative reason a date is missing; state is the computed meaning of the date today (valid, warning, critical, expired, missing, not_applicable). Not-required is healthy, not missing data.
 * numberPath says where a renewed document's new number is written and numberAr names it in the renewal dialog, so a renewal never pairs an old number with a new date; null for documents without a number.
 */

const DOCUMENTS = [
  {
    key: 'insurance',
    ar: 'التأمين', en: 'Insurance',
    path: 'insurance.expiryDate',
    statusPath: 'insurance.statusCode',
    extra: ['insurance.policyNumber', 'insurance.companyAr', 'insurance.coverageTypeAr', 'insurance.premiumSar'],
    numberPath: 'insurance.policyNumber', numberAr: 'رقم وثيقة التأمين', numberEn: 'Policy number',
    // The insurance policy alone is a shared paper: one policy covers many vehicles with one number and a single renewal event. Operating card and authorization are per vehicle with their own numbers, and writing one number onto many would make copies of one paper. The difference is declared here, not guessed in the UI.
    sharedNumber: true,
    icon: 'shield',
  },
  {
    key: 'operatingCard',
    ar: 'بطاقة التشغيل', en: 'Operating Card',
    path: 'operatingCard.expiryDate',
    statusPath: 'operatingCard.statusCode',
    extra: ['operatingCard.cardNumber'],
    numberPath: 'operatingCard.cardNumber', numberAr: 'رقم بطاقة التشغيل', numberEn: 'Operating card number',
    icon: 'card',
  },
  {
    key: 'vehicleLicense',
    ar: 'رخصة السير', en: 'Vehicle License',
    path: 'vehicleLicense.expiryDate',
    statusPath: 'vehicleLicense.statusCode',
    extra: [],
    // The driving license is renewed and its number does not change, so it has no separate number.
    numberPath: null,
    icon: 'license',
  },
  {
    key: 'inspection',
    ar: 'الفحص الدوري', en: 'Periodic Inspection',
    path: 'inspection.expiryDate',
    statusPath: 'inspection.statusCode',
    extra: ['inspection.statusAr'],
    numberPath: null,
    icon: 'inspection',
  },
  {
    key: 'gps',
    ar: 'اشتراك التتبّع', en: 'GPS Subscription',
    path: 'gps.expiryDate',
    statusPath: 'gps.statusCode',
    extra: ['gps.provider', 'gps.deviceModel', 'gps.serialImei', 'gps.status'],
    // A subscription renewal may come with a device swap, so the serial changes with the date.
    numberPath: 'gps.serialImei', numberAr: 'سريال جهاز التتبّع', numberEn: 'GPS serial',
    icon: 'gps',
  },
  // Authorization is a document like the others. Its dates used to live in a separate field with no expiry screen or alert threshold, so it expired unnoticed; an expired authorization leaves the driver without standing, charges the violation to the company and weakens insurance coverage. It has an expiry, number and holder, so it is another operating card and belongs here where the four screens see it.
  {
    key: 'authorization',
    ar: 'التفويض', en: 'Authorisation',
    path: 'authorizedPerson.expiryDate',
    statusPath: 'authorizedPerson.statusCode',
    extra: ['authorizedPerson.name', 'authorizedPerson.iqamaNumber',
      'authorizedPerson.authorizationNumber', 'authorizedPerson.startDate'],
    numberPath: 'authorizedPerson.authorizationNumber', numberAr: 'رقم التفويض', numberEn: 'Authorisation number',
    // Authorization has a start as well as an end: the end alone cannot say how long the driver has been authorized. The start used to be set at import and never updated on renewal, leaving the start of an expired authorization.
    startPath: 'authorizedPerson.startDate', startAr: 'تاريخ بداية التفويض', startEn: 'Authorisation start date',
    icon: 'authorization',
  },
];

const DOC_KEYS = DOCUMENTS.map((d) => d.key);
const getDoc = (key) => DOCUMENTS.find((d) => d.key === key) || null;

/** Administrative states explaining a missing date, named as in the Excel source. */
const STATUS_LABELS = {
  required: { ar: 'مطلوب', en: 'Required' },
  not_required: { ar: 'غير مطلوب', en: 'Not required' },
  none: { ar: 'لا يوجد', en: 'None' },
  unknown: { ar: 'غير معروف', en: 'Unknown' },
  with_bank: { ar: 'لدى البنك', en: 'Held by bank' },
  with_aljabr: { ar: 'لدى الجبر', en: 'Held by Aljabr' },
  not_in_use: { ar: 'غير مستخدم', en: 'Not in use' },
  unmapped: { ar: 'غير مصنَّف', en: 'Unclassified' },
  '': { ar: 'مسجَّل', en: 'On file' },
};
const statusLabel = (code, lang = 'ar') =>
  (STATUS_LABELS[code || ''] || { ar: code, en: code })[lang === 'en' ? 'en' : 'ar'];

/**
 * States computed from the date; three of them are shown to users.
 * The middle three (radar, nearly expired, expiring very soon) were one thing in three urgency levels, and a status that needs explaining is not a filter. So users read expired, nearly expired, valid. The levels stay in the computation because color distinguishes them. publicState is the translation; every screen and export goes through it so naming never diverges.
 */
const STATE_LABELS = {
  // The three visible states
  expired: { ar: 'منتهي', en: 'Expired', color: '#dc2626' },
  due: { ar: 'قارب على الانتهاء', en: 'Due soon', color: '#f59e0b' },
  valid: { ar: 'ساري', en: 'Valid', color: '#16a34a' },
  // Urgency levels now have names, not only colors. Critical is worked on today, soon is prepared next month, and color alone cannot be filtered or exported. Thresholds are set per document in section settings (soon/warn/critical).
  critical: { ar: 'حرج', en: 'Critical', color: '#ea580c' },
  warning: { ar: 'تحذير', en: 'Warning', color: '#f59e0b' },
  upcoming: { ar: 'قريب', en: 'Upcoming', color: '#0ea5e9' },
  // No date at all: not a document state but pending work.
  missing: { ar: 'مطلوب — بلا تاريخ', en: 'Needed — no date', color: '#94a3b8' },
  not_applicable: { ar: 'غير مطلوب', en: 'Not applicable', color: '#64748b' },
};

/**
 * State as displayed, now identical to the computed state.
 * It used to fold critical, warning and soon into nearly expired. Kept because many callers use it and because due remains a useful question: everything not yet expired that needs work, i.e. the three together (see isDue).
 */
const publicState = (state) => state;

/** Is it one of the three nearly-expired levels? */
const isDue = (state) => ['critical', 'warning', 'upcoming'].includes(state);

const DAY = 86400000;
/** Days remaining from today (negative = expired). null if there is no date. */
const daysLeft = (date, now = new Date()) => {
  if (!date) return null;
  const a = new Date(date); a.setHours(0, 0, 0, 0);
  const b = new Date(now); b.setHours(0, 0, 0, 0);
  return Math.round((a - b) / DAY);
};

/** Document state today. not_required returns not_applicable regardless of date: a vehicle that needs no inspection is not missing one. */
const stateOf = (expiry, statusCode, alert = {}, now = new Date()) => {
  if (statusCode === 'not_required') return { state: 'not_applicable', days: null };
  const days = daysLeft(expiry, now);
  if (days === null) return { state: 'missing', days: null };
  if (days < 0) return { state: 'expired', days };
  const crit = Number(alert.criticalDays ?? 7);
  const warn = Number(alert.warnDays ?? 30);
  if (days <= crit) return { state: 'critical', days };
  if (days <= warn) return { state: 'warning', days };
  // Third horizon: on the radar. A document expiring within 90 days is not a warning yet but is not safely valid either; insurance and inspection need preparation weeks ahead. It used to drop off the alerts screen and reappear already critical.
  const soon = Number(alert.soonDays ?? 90);
  if (days <= soon) return { state: 'upcoming', days };
  return { state: 'valid', days };
};

// Maps source-file codes to our codes. The file uses uppercase English; we store names the screens understand. One place so no importer invents its own mapping.
const SENTINEL_MAP = {
  NONE: 'none',
  REQUIRED: 'required',
  NOT_REQUIRED: 'not_required',
  UNKNOWN: 'unknown',
  NOT_IN_USE: 'not_in_use',
  HELD_BY_BANK: 'with_bank',
  WITH_LESSOR_ALJABR: 'with_aljabr',
  EMPTY: 'none',
  OTHER: 'unmapped',
};
/** Source code to our code. Any value starting with TEXT: is free text typed into a date cell. */
const mapSentinel = (code) => {
  if (!code) return '';
  const c = String(code).trim();
  if (c.startsWith('TEXT:')) return 'unmapped';
  return SENTINEL_MAP[c.toUpperCase()] || 'unmapped';
};

// The department-edited master states the reason for a missing value in the cell itself (e.g. required in the authorization number cell, not required in the insurer cell, bank ownership in the insurance value cell). Copying them verbatim shows required as an insurance company and counts it in distributions, as an earlier import did. So they are translated once: the cell is emptied and the reason kept as a code. Spelling is normalized before matching, since variants of one phrase (extra space, hamza forms) must all match or a false value returns.
const _foldAr = (v) => String(v)
  .replace(/[\u064B-\u0652\u0640]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/\s+/g, ' ')
  .trim();

const AR_SENTINEL_MAP = {
  'مطلوب': 'required',
  'غير مطلوب': 'not_required',
  'لا يوجد': 'none',
  'لايوجد': 'none',
  'غير مستخدم': 'not_in_use',
  'غير معروف': 'unknown',
  'ملكيه بنك الراجحي': 'with_bank',
  'ملكيه البنك الاهلي السعودي': 'with_bank',
  'ملكيه شركه الجبر': 'with_aljabr',
  // The generic word for other is deliberately absent: here it is a real value (a sector and registry value for 34 vehicles), not a missing one, and treating it as a reason would blank a tenth of the fleet's sector.
  '-': 'none',
  '—': 'none',
  ';': 'none',
};

/** Arabic cell text to a status code, or '' if it is a real value. A number is always a value, and empty is just empty, not a reason. */
const mapSentinelAr = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || v instanceof Date) return '';
  const k = _foldAr(v);
  if (!k) return '';
  return AR_SENTINEL_MAP[k] || '';
};

/** Not required is a healthy state; the rest are gaps that need work. */
const isGap = (code) => !!code && code !== 'not_required' && code !== '';

module.exports = {
  publicState,
  isDue,
  DOCUMENTS, DOC_KEYS, getDoc, STATUS_LABELS, statusLabel, STATE_LABELS,
  daysLeft, stateOf, SENTINEL_MAP, mapSentinel, isGap,
  AR_SENTINEL_MAP, mapSentinelAr, foldAr: _foldAr,
};
