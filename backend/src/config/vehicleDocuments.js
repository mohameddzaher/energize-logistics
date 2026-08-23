/**
 * vehicleDocuments — المستندات ذات تاريخ الانتهاء في قسم المركبات، معرَّفة مرة واحدة.
 *
 * كل حاجة بتشتق من هنا: كروت الداشبورد، فلتر «اللي هينتهي خلال كام يوم»،
 * التجديد، وإعدادات التنبيه. الملف ده هو اللي بيخلّي إضافة مستند جديد (رخصة
 * جديدة مثلاً) تظهر في الأربع حتة لوحدها بدل ما تتكتب في كل واحدة.
 *
 * ── التفرقة اللي كل حاجة هنا مبنية عليها ────────────────────────────────────
 * `statusCode`   ليه مفيش تاريخ؟ ده وضع **إداري** بيتسجّل يدويًا:
 *                required (مطلوب) · not_required (غير مطلوب) · none (لا يوجد)
 *                · unknown (غير معروف) · with_bank / with_aljabr (لدى الغير)
 * `state`        التاريخ ده معناه إيه **النهاردة**؟ محسوبة، مش مخزّنة:
 *                valid · warning · critical · expired · missing · not_applicable
 *
 * «غير مطلوب» مش نقص بيانات — دي حالة سليمة وبتتعدّ لوحدها. لو خلطناها بـ«لا
 * يوجد» يبقى الرقم اللي صاحب الشركة بيبص عليه بيقول إن فيه نقص مش موجود.
 */

const DOCUMENTS = [
  {
    key: 'insurance',
    ar: 'التأمين', en: 'Insurance',
    path: 'insurance.expiryDate',
    statusPath: 'insurance.statusCode',
    extra: ['insurance.policyNumber', 'insurance.companyAr', 'insurance.coverageTypeAr', 'insurance.premiumSar'],
    icon: 'shield',
  },
  {
    key: 'operatingCard',
    ar: 'بطاقة التشغيل', en: 'Operating Card',
    path: 'operatingCard.expiryDate',
    statusPath: 'operatingCard.statusCode',
    extra: ['operatingCard.cardNumber'],
    icon: 'card',
  },
  {
    key: 'vehicleLicense',
    ar: 'رخصة السير', en: 'Vehicle License',
    path: 'vehicleLicense.expiryDate',
    statusPath: 'vehicleLicense.statusCode',
    extra: [],
    icon: 'license',
  },
  {
    key: 'inspection',
    ar: 'الفحص الدوري', en: 'Periodic Inspection',
    path: 'inspection.expiryDate',
    statusPath: 'inspection.statusCode',
    extra: ['inspection.statusAr'],
    icon: 'inspection',
  },
  {
    key: 'gps',
    ar: 'اشتراك التتبّع', en: 'GPS Subscription',
    path: 'gps.expiryDate',
    statusPath: 'gps.statusCode',
    extra: ['gps.provider', 'gps.deviceModel', 'gps.serialImei', 'gps.status'],
    icon: 'gps',
  },
];

const DOC_KEYS = DOCUMENTS.map((d) => d.key);
const getDoc = (key) => DOCUMENTS.find((d) => d.key === key) || null;

/** الحالات الإدارية اللي بتفسّر غياب التاريخ، بأسمائها زي ما هي في الإكسل. */
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

/** الحالات المحسوبة من التاريخ. */
const STATE_LABELS = {
  upcoming: { ar: 'على الرادار', en: 'Upcoming' },
  valid: { ar: 'ساري', en: 'Valid', color: '#16a34a' },
  warning: { ar: 'قارب على الانتهاء', en: 'Due soon', color: '#f59e0b' },
  critical: { ar: 'ينتهي قريبًا جدًا', en: 'Critical', color: '#ea580c' },
  expired: { ar: 'منتهي', en: 'Expired', color: '#dc2626' },
  missing: { ar: 'بدون تاريخ', en: 'No date', color: '#94a3b8' },
  not_applicable: { ar: 'غير مطلوب', en: 'Not applicable', color: '#64748b' },
};

const DAY = 86400000;
/** الأيام المتبقية من النهاردة (سالب = منتهي). null لو مفيش تاريخ. */
const daysLeft = (date, now = new Date()) => {
  if (!date) return null;
  const a = new Date(date); a.setHours(0, 0, 0, 0);
  const b = new Date(now); b.setHours(0, 0, 0, 0);
  return Math.round((a - b) / DAY);
};

/**
 * حالة المستند النهاردة.
 * `not_required` بترجع not_applicable مهما كان التاريخ — العربية اللي مش
 * محتاجة فحص مش «ناقصة فحص».
 */
const stateOf = (expiry, statusCode, alert = {}, now = new Date()) => {
  if (statusCode === 'not_required') return { state: 'not_applicable', days: null };
  const days = daysLeft(expiry, now);
  if (days === null) return { state: 'missing', days: null };
  if (days < 0) return { state: 'expired', days };
  const crit = Number(alert.criticalDays ?? 7);
  const warn = Number(alert.warnDays ?? 30);
  if (days <= crit) return { state: 'critical', days };
  if (days <= warn) return { state: 'warning', days };
  // أفق ثالث: «على الرادار». المستند الذي ينتهي خلال ٩٠ يومًا ليس تحذيرًا بعد،
  // لكنه ليس «ساريًا وانسَه» أيضًا — التأمين والفحص يحتاجان تجهيزًا قبل موعدهما
  // بأسابيع. كان يسقط من شاشة التنبيهات تمامًا، فيظهر فجأةً وقد صار حرجًا.
  const soon = Number(alert.soonDays ?? 90);
  if (days <= soon) return { state: 'upcoming', days };
  return { state: 'valid', days };
};

// ترجمة رموز الملف المصدر إلى رموزنا. الملف يكتبها بالإنجليزية الكبيرة، ونحن
// نخزّنها بالأسماء التي تفهمها الشاشات — والترجمة في مكان واحد حتى لا يخترع كل
// مستورِد ترجمته.
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
/** رمز الملف → رمزنا. أي قيمة تبدأ بـ TEXT: نصٌّ حرّ كتبه أحدهم في خانة تاريخ. */
const mapSentinel = (code) => {
  if (!code) return '';
  const c = String(code).trim();
  if (c.startsWith('TEXT:')) return 'unmapped';
  return SENTINEL_MAP[c.toUpperCase()] || 'unmapped';
};

/** «غير مطلوب» حالة سليمة؛ الباقي نقصٌ يحتاج عملًا. */
const isGap = (code) => !!code && code !== 'not_required' && code !== '';

module.exports = {
  DOCUMENTS, DOC_KEYS, getDoc, STATUS_LABELS, statusLabel, STATE_LABELS,
  daysLeft, stateOf, SENTINEL_MAP, mapSentinel, isGap,
};
