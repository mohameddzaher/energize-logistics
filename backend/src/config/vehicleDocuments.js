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
 *
 * ── ولماذا لكل مستندٍ `numberPath` ─────────────────────────────────────────
 * المستند الذي يُجدَّد لا يعود هو نفسه في كل حالة: بطاقة التشغيل تخرج برقمٍ
 * جديد، والتفويض قد يُستخرج برقمٍ آخر، ووثيقة التأمين كذلك. وكان التجديد يكتب
 * التاريخَ وحده، فيبقى في الشاشة رقمُ بطاقةٍ سُلِّمت وانتهت مقرونًا بتاريخ
 * بطاقةٍ أخرى — ورقةٌ لا وجود لها. ومن يبحث عن المركبة برقم بطاقتها الجاري لا
 * يجدها، ومن يراجع مخالفةً برقمٍ ظاهرٍ هنا يراجعها على ورقةٍ ملغاة.
 *
 * فالرقم يُسمّى هنا مرةً واحدة كما سُمّي التاريخ: `numberPath` يعرف أين يُكتب،
 * و`numberAr` يعرف كيف يُسمّى في نافذة التجديد. والمستند الذي لا رقم له —
 * رخصة السير والفحص — `numberPath: null`، فلا تعرض له النافذة خانةً لا معنى لها.
 */

const DOCUMENTS = [
  {
    key: 'insurance',
    ar: 'التأمين', en: 'Insurance',
    path: 'insurance.expiryDate',
    statusPath: 'insurance.statusCode',
    extra: ['insurance.policyNumber', 'insurance.companyAr', 'insurance.coverageTypeAr', 'insurance.premiumSar'],
    numberPath: 'insurance.policyNumber', numberAr: 'رقم وثيقة التأمين', numberEn: 'Policy number',
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
    // رخصة السير تُجدَّد ولا يتغيّر رقمها — لا رقم مستقلّ لها أصلًا.
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
    // تجديد الاشتراك قد يصحبه تبديلُ الجهاز، فالسريال يتغيّر مع التاريخ.
    numberPath: 'gps.serialImei', numberAr: 'سريال جهاز التتبّع', numberEn: 'GPS serial',
    icon: 'gps',
  },
  // ── ولماذا صار التفويض مستندًا كسائر المستندات ─────────────────────────────
  // كان تاريخا بدايته ونهايته يقيمان في حقلٍ منفصل لا تمرّ عليه شاشة انتهاءات
  // ولا عتبة تنبيه — فينتهي التفويض ولا يعلم أحد. وانتهاؤه ليس خانةً فارغة:
  // السائق يقود حينئذٍ بلا صفة، فالمخالفة تُقيَّد على الشركة وتُنازِع شركةُ
  // التأمين في التغطية عند أول حادث. له تاريخ انتهاء ورقم وحاملٌ اسمه، فهو
  // بطاقة تشغيلٍ أخرى — ومكانه هنا حيث تراه الأربعُ شاشات وحدها.
  {
    key: 'authorization',
    ar: 'التفويض', en: 'Authorisation',
    path: 'authorizedPerson.expiryDate',
    statusPath: 'authorizedPerson.statusCode',
    extra: ['authorizedPerson.name', 'authorizedPerson.iqamaNumber',
      'authorizedPerson.authorizationNumber', 'authorizedPerson.startDate'],
    numberPath: 'authorizedPerson.authorizationNumber', numberAr: 'رقم التفويض', numberEn: 'Authorisation number',
    icon: 'authorization',
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

// ── والماستر الذي يكتبه القسم بيده يقول السبب بالعربية داخل الخانة ──────────
//
// الخريطة أعلاه لملفٍ مُصدَّر برموزٍ إنجليزية. أما ماستر القسم فيكتب سبب غياب
// القيمة **مكان القيمة نفسها**: «مطلوب» في خانة رقم التفويض، و«غير مطلوب» في
// خانة شركة التأمين، و«ملكية بنك الراجحي» في خانة قيمة التأمين.
//
// نقلُها كما هي يجعل «مطلوب» تظهر شركةَ تأمينٍ لها خمسٌ وأربعون مركبة، وتُعدّ
// في التوزيعات كأنها اسم شركة — وهذا ما حدث فعلًا في استيرادٍ سابق. فتُترجَم
// هنا مرةً واحدة: تُفرَّغ الخانة ويبقى سببُ فراغها رمزًا.
//
// وتوحيد الكتابة قبل المطابقة شرط: «غير مطلوب» و«غير مطلوب » و«غير مطلوب»
// بألفٍ همزية ثلاثُ كتاباتٍ لمعنًى واحد، وأيّ واحدة تفلت تعود قيمةً كاذبة.
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
  // «اخري» ليست هنا عمدًا: هي **قيمة** في هذا الملف لا غيابَ قيمة — ٣٤ مركبة
  // قطاعُها «اخري» وسِجلُّها «اخري». عدُّها سببَ فراغٍ يفرِّغ قطاعَ عُشر الأسطول.
  '-': 'none',
  '—': 'none',
  ';': 'none',
};

/**
 * نصّ الخانة العربي → رمزُ حالة، أو '' إن كانت قيمةً حقيقية.
 * الرقم قيمةٌ دائمًا، والفراغ ليس سببًا — فراغٌ فقط.
 */
const mapSentinelAr = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || v instanceof Date) return '';
  const k = _foldAr(v);
  if (!k) return '';
  return AR_SENTINEL_MAP[k] || '';
};

/** «غير مطلوب» حالة سليمة؛ الباقي نقصٌ يحتاج عملًا. */
const isGap = (code) => !!code && code !== 'not_required' && code !== '';

module.exports = {
  DOCUMENTS, DOC_KEYS, getDoc, STATUS_LABELS, statusLabel, STATE_LABELS,
  daysLeft, stateOf, SENTINEL_MAP, mapSentinel, isGap,
  AR_SENTINEL_MAP, mapSentinelAr, foldAr: _foldAr,
};
