const { VehicleMaster, VehicleRegistryConfig, CorporatePolicy, VehicleInsurancePolicy } = require('../models/VehicleMaster');
const { sendMongooseError, stripEmpty } = require('../utils/mongooseError');
const { startOfDay, endOfDay } = require('../utils/companyDay');
const VehicleClaim = require('../models/VehicleClaim');
const VDOC = require('../config/vehicleDocuments');
const logAudit = require('../utils/auditLogger');
const cache = require('../utils/ttlCache');
const { emitToAll } = require('../websocket/socketManager');
// مفتاح **سجل المركبات** (حروف + أرقام)، لا مفتاح الأرقام الذي يستعمله النقل
// الثقيل. الأرقام وحدها تتصادم هنا: «ل أ 1080» دراجة و«أ ص ر 1080» تريلا —
// ومفتاح الأرقام يقيّد حادثة الدراجة على التريلا. التفصيل في utils/plateKey.
const { registryPlateKey: plateKey, flexSpaceRegex } = require('../utils/plateKey');

const emit = (event, payload = {}) => { try { emitToAll(event, payload); } catch (e) {} cache.clear('vreg:'); };

// المستندات ذات تاريخ الانتهاء — المفتاح ← مسار التاريخ + الاسم.
// تعريف واحد للمستندات — config/vehicleDocuments.js. كان فيه نسخة تانية هنا
// بتحسب الحالة من غير ما تعرف «غير مطلوب»، فعربية مش محتاجة فحص كانت بتتحسب
// ناقصة فحص.
const DOC_TYPES = VDOC.DOCUMENTS;

const DAY = 86400000;
const daysUntil = (date) => (date ? Math.floor((new Date(date).getTime() - Date.now()) / DAY) : null);
const getPath = (obj, path) => path.split('.').reduce((c, p) => (c == null ? c : c[p]), obj);

const _multi = (v) => (v == null ? [] : (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean));

// مخزّن مؤقتًا — كان findOneAndUpdate (كتابة) على كل طلب = بطيء على Atlas المُقيَّد.
const getConfig = async () => {
  const hit = cache.get('vreg:config');
  if (hit !== undefined) return hit;
  const cfg = await VehicleRegistryConfig.findOneAndUpdate(
    { key: 'vehicle-registry' }, { $setOnInsert: { key: 'vehicle-registry' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  cache.set('vreg:config', cfg, 60000);
  return cfg;
};

// حالة مستند مقابل عتبته: expired / critical(≤30) / warning(≤warnDays) / valid / none
// غلاف رفيع حوالين VDOC.stateOf عشان الكود القديم يفضل شغّال بنفس شكل الرد.
const docStatus = (date, alert, statusCode = '') => {
  const { state, days } = VDOC.stateOf(date, statusCode, alert || {});
  return { status: state === 'not_applicable' ? 'not_required' : state === 'missing' ? 'none' : state, days };
};

// «عليها جهاز تتبّع» — تعريف واحد لا ثلاثة.
//
// كان الفلتر والبطاقة يسألان عن `gps.deviceId`، وهو حقل لا يُملأ من أي استيراد:
// الأجهزة تصل بالرقم التسلسلي والطراز والمزوّد. فكانت البطاقة تقول «صفر» و٢٤٠
// مركبة عليها أجهزة بالفعل — رقمٌ خاطئ في وجه صاحب الأسطول لا خانةٌ فارغة.
const HAS_GPS = { $or: [
  { 'gps.serialImei': { $nin: [null, ''] } },
  { 'gps.deviceModel': { $nin: [null, ''] } },
  { 'gps.deviceId': { $nin: [null, ''] } },
] };
const hasGps = (v) => !!(v?.gps?.serialImei || v?.gps?.deviceModel || v?.gps?.deviceId);

// ═══════════════════════════════════════════════════════════════════════════
//  الفلاتر المشتقّة — ما ليس عمودًا في الجدول ويُسأل عنه كل يوم
// ═══════════════════════════════════════════════════════════════════════════
/**
 * الفلاتر أعلاه تسأل عن قيمة مكتوبة في خانة: «المدينة = جدّة». وهذه تسأل عمّا
 * لا يُكتب في خانة أصلًا: «أيُّ مركبةٍ ينتهي تأمينها خلال شهر؟» و«كم مركبةً
 * بلا جهاز تتبّع؟» و«أين المركبات التي قسطُها فوق خمسة آلاف؟».
 *
 * وهي أسئلة الإدارة لا أسئلة موظّف الإدخال. كانت تُجاب بتصدير الجدول إلى إكسل
 * ثم فرزه باليد، فيختلف رقمُ كل من يجرّبها.
 *
 * ── وكل شريحة تحمل شرطها مرّتين، وذلك مقصود ────────────────────────────────
 *   `cond()` شرطُ Mongo الذي يفتح صفوفها في القائمة.
 *   `test()` نفسُ الشرط منفَّذًا في الذاكرة، به يُحسب العدد المكتوب بجانبها.
 * ولولا اشتقاقُهما من تعريفٍ واحد لانفصل العدد المعروض عن الصفوف التي يفتحها
 * — وهو أسوأ عطبٍ في لوحة تحليلات: رقمٌ تضغطه فيعطيك غيرَه ولا شيء يفسّر.
 *
 * و`cond` دالّةٌ لا كائن: حدود «خلال ٣٠ يومًا» تُحسب من اليوم، ولو بُنيت مرّة
 * عند إقلاع الخادم لتجمّدت عند يوم الإقلاع وصارت تكذب بعد أسبوع من التشغيل.
 */
const dayStart = (n = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const _blank = (x) => x === null || x === undefined || x === '';

// أفقُ الانتهاء: نفس القطع لكل مستند. الحدود متلاصقة غير متداخلة — «منتهٍ»
// تنتهي بالأمس و«خلال ٣٠» تبدأ اليوم، وإلا عُدَّ ما ينتهي اليوم في الشريحتين
// معًا فتجاوز مجموعُ الشرائح عددَ المركبات.
const HORIZON_BANDS = [
  { value: 'منتهٍ', en: 'Expired', hi: -1 },
  { value: 'خلال ٣٠ يومًا', en: 'Within 30 days', lo: 0, hi: 30 },
  { value: '٣١ إلى ٦٠ يومًا', en: '31–60 days', lo: 31, hi: 60 },
  { value: '٦١ إلى ٩٠ يومًا', en: '61–90 days', lo: 61, hi: 90 },
  { value: 'أبعد من ٩٠ يومًا', en: 'Beyond 90 days', lo: 91 },
  // «بلا تاريخ» ليست تاريخًا خارج المدى — لا يلتقطها أيُّ مدًى، وتلزمها شريحة.
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

// شرائح رقمية (قسط التأمين، سقف الاستهلاك، عدد الحوادث، سنة الصنع).
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

/** سؤال بنعم/لا: الشريحتان متكاملتان دائمًا، فمجموعهما كلُّ المركبات. */
const yesNo = (yes, no, cond, test) => ([
  { value: yes.ar, en: yes.en, cond: () => cond(), test },
  { value: no.ar, en: no.en, cond: () => ({ $nor: [cond()] }), test: (v) => !test(v) },
]);

const HAS_FUEL_CARD = () => ({ 'fuelCard.cardNumber': { $nin: [null, ''] } });
const HAS_AUTH = () => ({ $or: [
  { 'authorizedPerson.name': { $nin: [null, ''] } },
  { 'authorizedPerson.authorizationNumber': { $nin: [null, ''] } },
] });
const ANY_EXPIRED = () => ({ $or: DOC_TYPES.map((dt) => ({ [dt.path]: { $ne: null, $lt: dayStart(0) } })) });
const ANY_SOON = () => ({ $or: DOC_TYPES.map((dt) => ({ [dt.path]: { $ne: null, $gte: dayStart(0), $lt: dayStart(31) } })) });
const anyExpiredT = (v) => DOC_TYPES.some((dt) => { const d = VDOC.daysLeft(getPath(v, dt.path)); return d != null && d < 0; });
const anySoonT = (v) => DOC_TYPES.some((dt) => { const d = VDOC.daysLeft(getPath(v, dt.path)); return d != null && d >= 0 && d <= 30; });

const _year = () => new Date().getFullYear();

const DERIVED_DEFS = [
  // ── ما ينتهي ومتى، مستندًا مستندًا ──────────────────────────────────────
  ...DOC_TYPES.map((dt) => ({
    key: `${dt.key}Horizon`, ar: `انتهاء ${dt.ar}`, en: `${dt.en} expiry`,
    groupAr: 'آفاق الانتهاء', groupEn: 'Expiry horizons',
    select: [dt.path], options: horizonOptions(dt.path),
  })),

  // ── «كم مركبةً بلا بطاقة تشغيل، ومَن هي؟» ────────────────────────────────
  //
  // هذا هو السؤال الذي يُسأل من الإدارة، وهو غيرُ سؤال الانتهاء تمامًا. ولا
  // يُقرأ من التاريخ: مركبةٌ بلا تاريخٍ قد لا تحتاج المستند أصلًا (دراجةٌ
  // ناريّة لا بطاقة تشغيل لها) وقد تحتاجه ولم يُستخرج — والفرق هو كلُّ الفرق.
  // فخلطُهما يجعل الرقمَ الذي ينظر إليه صاحبُ الشركة يقول نقصًا لا وجود له.
  //
  // والوضع الإداريّ مسجَّلٌ في `statusCode` منذ الاستيراد: `required` مطلوبٌ
  // ولم يُستخرج، و`not_required` غيرُ مطلوب. وشريحةٌ لكلٍّ، مستندًا مستندًا.
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

  // ── والمركبة كلّها في سؤال واحد ─────────────────────────────────────────
  // الشرائح الثلاث متنافية عمدًا: مركبةٌ فيها منتهٍ **و** قاربَ آخرُ على الانتهاء
  // تُعدّ في «منتهٍ» وحدها. ولولا ذلك لفاق مجموع الشرائح عدد الأسطول، وهو أوّل
  // ما يلاحظه من ينظر ويُفقده الثقة في اللوحة كلها.
  {
    key: 'documentHealth', ar: 'صحّة المستندات', en: 'Document health',
    groupAr: 'المستندات', groupEn: 'Documents',
    select: DOC_TYPES.map((dt) => dt.path),
    options: [
      { value: 'فيها مستند منتهٍ', en: 'Has an expired document', cond: ANY_EXPIRED, test: anyExpiredT },
      {
        value: 'ينتهي فيها مستند خلال ٣٠ يومًا', en: 'Something expires within 30 days',
        cond: () => ({ $and: [ANY_SOON(), { $nor: [ANY_EXPIRED()] }] }),
        test: (v) => anySoonT(v) && !anyExpiredT(v),
      },
      {
        value: 'كل مستنداتها سارية', en: 'All documents valid',
        cond: () => ({ $nor: [ANY_EXPIRED(), ANY_SOON()] }),
        test: (v) => !anyExpiredT(v) && !anySoonT(v),
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
  // البند الناقص وسببُه: `buildFilter` يعرف هذين المفتاحين من قبل (وحده يجمع
  // بينهما في `$elemMatch` حين يُطلبا معًا)، فلا يُبنى لهما شرطٌ عامّ هنا —
  // التعريفُ هنا لعرض قيمهما وأعدادها فحسب.
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

  // ── التشغيل: ما الذي على المركبة فعلًا ──────────────────────────────────
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
    // سقف الاستهلاك: «مفتوح» ليس سقفًا عاليًا — هو لا سقف. عدُّه مع الأرقام
    // يخفي المركبات التي لا حدَّ لصرفها، وهي أوّل ما يُسأل عنه في مراجعة الوقود.
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

  // ── التأمين بالمال لا بالتاريخ ──────────────────────────────────────────
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
        // مركبةٌ يسدّد قسطَها المموِّل ليست «بلا قسط» — هي مؤمَّنة والرقم عنده.
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

  // ── المركبة نفسها: عمرُها وسجلُّها ──────────────────────────────────────
  {
    // سنة الصنع رقمٌ لا يُقرأ منه العمر بالعين، والعمر هو ما يُبنى عليه قرار
    // الإحلال. والشرائح محسوبة من سنة اليوم فلا تبور مع مرور السنة.
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
      // «بلا حوادث» تشمل الخانة الفارغة: العدّاد يُملأ بعد ربط المطالبات،
      // ومركبةٌ لم يُحسب لها بعدُ ليست مركبةً خارج التصنيف — هي بلا حوادث.
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

// اسم الحالة العربي → رمزها. الشاشة تعرض «مطلوب» لا `required`، والفلتر يجب أن
// يقبل ما تعرضه — ويظل يقبل الرمز نفسه فلا تنكسر روابط محفوظة.
const REASON_BY_LABEL = Object.fromEntries(
  Object.entries(VDOC.STATUS_LABELS).map(([code, l]) => [l.ar, code]).filter(([ar]) => ar),
);

// يبني فلتر Mongo من الـ query (متعدد القيم + بحث + نطاق سنة).
/**
 * كلُّ حقلٍ نصّيٍّ في المركبة قابلٌ للبحث — تُقرأ الحقول من المخطَّط نفسه.
 *
 * كانت قائمةً مكتوبةً بأسماء الحقول، فكلُّ حقلٍ يُضاف إلى النموذج يولد خارج
 * البحث في صمت. ورقم هوية المفوَّض كان من هؤلاء: تُدخله في الخانة فتخرج
 * الشاشة فارغةً وهو مخزَّنٌ في القاعدة — وذلك أسوأ من غياب البحث، لأنّ
 * الفراغ يُقرأ «لا يوجد» لا «لم أبحث فيه».
 *
 * والاشتقاق من المخطَّط يجعل القائمة تكبر مع النموذج بلا تذكُّرٍ من أحد.
 */
const SEARCHABLE_PATHS = Object.entries(VehicleMaster.schema.paths)
  .filter(([path, def]) => def.instance === 'String' && !path.startsWith('_') && path !== '__v')
  .map(([path]) => path);

/**
 * ── حقولٌ تُطلَب، لا وثيقةٌ كاملة ─────────────────────────────────────────────
 *
 * الرابط إلى قاعدة البيانات مقيَّدٌ عند مئة كيلوبايت في الثانية تقريبًا — قياسٌ
 * ثابتٌ مهما كان الحجم. فزمنُ الشاشة يساوي عددَ البايتات التي تجرّها، لا عدد
 * وثائقها ولا تعقيد استعلامها: المحرّك ينفّذ استعلام الأسطول كلِّه في مللي
 * ثانيةٍ واحدة، ثم تُستقبَل النتيجة في ثمانية آلاف.
 *
 * ولذلك لا تُقرأ وثيقةٌ كاملة لشاشةٍ تستعمل عشرها. هذه الحقول هي ما تحتاجه
 * فعلًا شاشاتُ النظرة الشاملة والانتهاءات وسجلّات القسم — وهي التي تقرأ
 * الأسطول كلَّه — وبها تنزل الحمولة من ستّمئة وسبعين كيلوبايت إلى نحو ثمانين.
 *
 * وما يُضاف إلى النموذج لاحقًا ولا يُضاف هنا لا يظهر في هذه الشاشات: هذا هو
 * ثمن المشروع الضيّق، ويُدفَع مرّةً واحدة مقابل شاشةٍ تفتح في ثانية بدل ثمان.
 */
const DOC_PATHS = [...new Set(VDOC.DOCUMENTS.flatMap((d) => [
  d.path, d.statusPath, d.numberPath, d.startPath, ...(d.extra || []),
].filter(Boolean)))];

/** ما تحتاجه شاشاتُ التجميع: تصنيفُ المركبة، وحالةُ كلّ مستند وتاريخُه. */
const AGG_FIELDS = [...new Set([
  'plateNumber', 'plateKey', 'sectorAr', 'sectorCode', 'registrationTypeAr',
  'departmentAr', 'cityAr', 'possessionStatusAr', 'serviceStatusAr', 'serviceStatusCode',
  'brandAr', 'modelAr', 'modelYear', 'colorAr', 'ownerNameAr', 'commercialRegistration',
  'tamStatusAr', 'accidentCount', 'missingItems', 'logistiGaps', 'insurancePolicy',
  'isActive', 'notesAr',
  ...DOC_PATHS,
  // حقولٌ تقرؤها سجلّات القسم في تفاصيل صفوفها.
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
  // كل الفلاتر بالاسم العربي (نفس ما تعرضه التوزيعات) — أبسط وأوضح.
  const map = {
    sector: 'sectorAr', registrationType: 'registrationTypeAr', brand: 'brandAr',
    department: 'departmentAr', city: 'cityAr', possession: 'possessionStatusAr',
    gpsDeviceStatus: 'gps.deviceStatusAr',
    // مفاتيح سجلّات القسم — كل صفّ فيها يفتح مركباته بهذه الفلاتر
    authorizedPerson: 'authorizedPerson.name', authorizedPersonIqama: 'authorizedPerson.iqamaNumber',
    gpsProvider: 'gps.provider',
    gpsDevice: 'gps.deviceModel', fuelCard: 'fuelCard.cardNumber',
    owner: 'ownerNameAr', insuranceCompany: 'insurance.companyAr',
    coverageType: 'insurance.coverageTypeAr', fuelCardStatus: 'fuelCard.statusAr',
    inspectionStatus: 'inspection.statusAr', tamStatus: 'tamStatusAr', color: 'colorAr',
    // ── أعمدة الماستر النهائي (أغسطس ٢٠٢٦) ───────────────────────────────
    // حالة التشغيل أوّلها: ٧٦ مركبةً من ٣٣٥ واقفةٌ أو مسروقة، وكان الجواب
    // مدفونًا في كلمة «غير مستخدم» مكتوبةً مكانَ اسم الإدارة.
    serviceStatus: 'serviceStatusAr',
    model: 'modelAr',
    commercialRegistration: 'commercialRegistration',
    insurancePolicyNumber: 'insurance.policyNumber',
    premiumStatus: 'insurance.premiumStatusAr',
    consumptionType: 'fuelCard.consumptionTypeAr',
    gpsSerial: 'gps.serialImei',
    operatingCardNumber: 'operatingCard.cardNumber',
    authorizationNumber: 'authorizedPerson.authorizationNumber',
    // توافق خلفي مع الأكواد:
    sectorCode: 'sectorCode', registrationTypeCode: 'registrationTypeCode',
    serviceStatusCode: 'serviceStatusCode',
  };
  for (const [qk, field] of Object.entries(map)) {
    const vals = _multi(q[qk]);
    if (!vals.length) continue;
    // «—» تعني الخانة الفارغة، وهي فئةٌ حقيقية يُسأل عنها: «أي المركبات بلا
    // مالك مسجَّل؟» سؤالُ عملٍ لا نتيجةَ خطأ، فلا يجوز أن يسقط من الفلتر.
    const wantsBlank = vals.includes('—');
    const rest = vals.filter((x) => x !== '—');
    if (wantsBlank && rest.length) and.push({ $or: [{ [field]: { $in: rest } }, { [field]: { $in: ['', null] } }, { [field]: { $exists: false } }] });
    else if (wantsBlank) and.push({ $or: [{ [field]: { $in: ['', null] } }, { [field]: { $exists: false } }] });
    else and.push({ [field]: { $in: rest } });
  }
  // نواقص منصّة لوجستي: «أرِني المركبات التي ينقصها شرط» و«أرِني من ينقصه هذا
  // الشرط بعينه» — سؤالان مختلفان، وكلاهما قائمة عمل.
  if (q.logistiGaps === '1') and.push({ 'logistiGaps.0': { $exists: true } });
  if (q.logistiGaps === '0') and.push({ 'logistiGaps.0': { $exists: false } });
  const gapItems = _multi(q.logistiGap);
  if (gapItems.length) and.push({ logistiGaps: { $in: gapItems } });

  // نواقص البيانات: «أرِني من ينقصه شيء»، أو بندًا بعينه، أو بندًا بسبب بعينه.
  if (q.missing === '1') and.push({ 'missingItems.0': { $exists: true } });
  const mItems = _multi(q.missingItem);
  const mReasons = _multi(q.missingReason).map((x) => REASON_BY_LABEL[x] || x);
  if (mItems.length && mReasons.length) {
    and.push({ missingItems: { $elemMatch: { item: { $in: mItems }, reason: { $in: mReasons } } } });
  } else if (mItems.length) and.push({ 'missingItems.item': { $in: mItems } });
  else if (mReasons.length) and.push({ 'missingItems.reason': { $in: mReasons } });
  if (q.insurancePolicy) and.push({ insurancePolicy: q.insurancePolicy });

  // «بلا تاريخ مسجَّل» لمستند بعينه — ليس تاريخًا خارج المدى بل لا تاريخ له،
  // فلا يلتقطه أي مدى وتلزمه فئةٌ خاصة به.
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
    // البحث لا يبالي بعدد المسافات: راجع flexSpaceRegex — لوحةُ الحرفين تُنسخ
    // من أبشر بمسافتين وتُخزَّن عندنا بواحدة، فكان الموظّف يمسح مسافةً بيده
    // ليجد ما يبحث عنه.
    const rx = flexSpaceRegex(q.q);
    and.push({ $or: SEARCHABLE_PATHS.map((f) => ({ [f]: rx })) });
  }
  // فلتر انتهاء مستند خلال مدة، أو منتهي، أو ضمن نطاق تاريخي.
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
  // «بدون مستند»: مركبات ينقصها هذا المستند (لا تاريخ/لا رقم).
  if (q.missingDoc) {
    // التفويض كان غائبًا عن هذه الخريطة رغم كونه مستندًا سادسًا كامل الحقوق،
    // فـ«أرِني المركبات بلا تفويض» كان يسقط في صمت ويفتح الأسطول كلَّه.
    const paths = { insurance: 'insurance.expiryDate', operatingCard: 'operatingCard.cardNumber', vehicleLicense: 'vehicleLicense.expiryDate', inspection: 'inspection.expiryDate', gps: 'gps.deviceId', fuelCard: 'fuelCard.cardNumber', authorization: 'authorizedPerson.authorizationNumber' };
    if (q.missingDoc === 'gps') and.push({ $nor: [HAS_GPS] });
    else {
      const p = paths[q.missingDoc];
      if (p) and.push({ $or: [{ [p]: null }, { [p]: '' }] });
    }
  }
  // «لديه GPS»: مركبات عليها جهاز مركّب.
  if (q.hasGps === '1') and.push(HAS_GPS);
  if (q.hasGps === '0') and.push({ $nor: [HAS_GPS] });
  // ── الفلاتر المشتقّة ──────────────────────────────────────────────────────
  // القيم المختارة داخل الحقل الواحد **أو**، وبين الحقول **و**: «(منتهٍ أو خلال
  // ٣٠ يومًا) و(بلا جهاز تتبّع)». وهي الطريقة الوحيدة التي تُقرأ بها اللوحة:
  // اختيارُ قيمتين في حقلٍ واحد يوسّع، واختيارُ حقلٍ ثانٍ يضيّق.
  for (const d of DERIVED_DEFS) {
    if (d.handled || !d.options) continue;
    const picked = _multi(q[d.key]);
    if (!picked.length) continue;
    const conds = d.options.filter((o) => picked.includes(o.value)).map((o) => o.cond());
    // قيمةٌ لا يعرفها التعريف (رابطٌ قديمٌ أو كتابةٌ يدوية) لا تُتجاهَل في صمت
    // فتفتح الأسطول كلّه وكأن الفلتر مطبَّق — بل لا تطابق شيئًا.
    and.push(conds.length ? { $or: conds } : { _id: { $in: [] } });
  }

  if (q.expiryDoc && (q.expiryFrom || q.expiryTo)) {
    const dt = DOC_TYPES.find((x) => x.key === q.expiryDoc);
    if (dt) {
      const rng = {}; if (q.expiryFrom) rng.$gte = startOfDay(q.expiryFrom);
      // نهاية اليوم المطلوب، لا اليوم التالي — كانت الإضافة يومًا كاملًا تُدخل
      // ما ينتهي في أول اليوم التالي في هذه الشريحة وفي التي تليها معًا.
      if (q.expiryTo) rng.$lte = endOfDay(q.expiryTo);
      and.push({ [dt.path]: rng });
    }
  }
  if (and.length) f.$and = and;
  return f;
}

// ── قائمة المركبات ─────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const cacheKey = `vreg:list:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return res.json(hit);

    const filter = buildFilter(req.query);
    const limit = Math.min(Number(req.query.limit) || 500, 2000);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const sortBy = req.query.sortBy || 'plateNumber';
    const sortDir = req.query.sortDir === 'desc' ? -1 : 1;
    // ── ما تحمله القائمة، ولماذا اتّسع ─────────────────────────────────────
    //
    // المشروع مختصرٌ عمدًا: `renewals` وحدها قد تكون عشرات القيود، وجلبُها
    // لثلاثمئة مركبةٍ في كل فتحةٍ للشاشة نقلٌ لا يُقرأ. لكنّ الاختصار كان قد
    // جاوز حدَّه: **البيانات موجودة في قاعدة البيانات ولا تصل إلى الشاشة**.
    // رقمُ بطاقة التشغيل لمئتين وعشرين مركبة، ورقمُ وثيقة التأمين لمئتين
    // وأربع وثمانين، ورقمُ التفويض لمئتين وإحدى وعشرين — كلّها مسجَّلة، وكلّها
    // تسقط هنا قبل أن تُرسَل. فيفلتر المستخدم على بطاقة التشغيل فيجد الصفوف
    // ولا يجد رقمًا في أيّ منها، فيظنّ الاستيراد ناقصًا وهو تامّ.
    //
    // فكلُّ حقلٍ يُعرَض في عمودٍ من أعمدة صفحات المستندات موجودٌ هنا. وهي حقولٌ
    // نصّيةٌ قصيرة: الزيادة بضع مئات من البايتات للمركبة، والثمن الذي كانت
    // تدفعه الشاشة قبلها هو أن تكون فارغة.
    const LIST_FIELDS = 'plateNumber plateLettersAr chassisNumber serialNumber sectorAr departmentAr cityAr'
      + ' possessionStatusAr registrationTypeAr brandAr modelAr modelYear colorAr ownerNameAr commercialRegistration'
      + ' authorizedPerson logistiGaps serviceStatusAr serviceStatusCode tamStatusAr'
      + ' insurance.policyNumber insurance.companyAr insurance.coverageTypeAr insurance.expiryDate'
      + ' insurance.premiumSar insurance.premiumStatusAr insurance.statusCode'
      + ' operatingCard.cardNumber operatingCard.expiryDate operatingCard.statusCode'
      + ' vehicleLicense.expiryDate vehicleLicense.expiryDateHijri vehicleLicense.statusCode'
      + ' inspection.statusAr inspection.expiryDate inspection.expiryDateHijri inspection.statusCode'
      + ' fuelCard.provider fuelCard.cardNumber fuelCard.plateOnInvoiceAr fuelCard.statusAr fuelCard.statusCode'
      + ' fuelCard.consumptionTypeAr fuelCard.limitSar fuelCard.limitStatus'
      + ' gps.deviceId gps.serialImei gps.simNumber gps.deviceModel gps.provider gps.deviceStatusAr'
      + ' gps.status gps.statusCode gps.expiryDate'
      + ' accidentCount missingItems insurancePolicy';
    const [vehicles, total] = await Promise.all([
      VehicleMaster.find(filter).select(LIST_FIELDS).sort({ [sortBy]: sortDir }).skip((page - 1) * limit).limit(limit).lean(),
      VehicleMaster.countDocuments(filter),
    ]);
    const cfg = await getConfig();
    // ── بطاقةُ المفوَّض تُقرأ مع صفّه ──────────────────────────────────────────
    //
    // «هل التفاويض ممكن تتربط مع السائق؟» — الربطُ قائمٌ برقم الإقامة، فورقةُ
    // التفويض تحمله وبطاقةُ السائق مفتاحُها هو. وما كان ينقص أن يُقرأ: شاشةُ
    // التفاويض تقول مَن المفوَّض ولا تقول أبطاقتُه سارية، ولا أهو مشمولٌ بخيانة
    // الأمانة — وهما شرطا أن يقود أصلًا. فيُفوَّض على شاحنةٍ مَن بطاقتُه منتهية.
    //
    // إحدى وستّون بطاقةً في السجلّ كلِّه، فقراءتُها كاملةً أرخصُ من أيّ ربط.
    const cardsAll = await DriverCard.find({ isActive: { $ne: false } })
      .select('idNumber name cardNumber cardType expiryDate fidelity').lean();
    const cardById = new Map(cardsAll.map((c) => [String(c.idNumber || '').trim(), c]));
    const withStatus = vehicles.map((v) => {
      const row = decorate(v, cfg);
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
          state: cardState(days),
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

// يضيف حالة كل مستند + أقرب انتهاء + أدنى حالة للمركبة.
function decorate(v, cfg) {
  const a = cfg.alerts || {};
  const docs = {};
  for (const dt of DOC_TYPES) {
    docs[dt.key] = docStatus(getPath(v, dt.path), a[dt.key], getPath(v, dt.statusPath));
  }
  // «غير مطلوب» مش أسوأ من «ساري» — هي مش مشكلة أصلاً، فآخر الترتيب.
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
    const v = await VehicleMaster.findById(req.params.id).lean();
    if (!v) return res.status(404).json({ message: 'Vehicle not found' });
    const cfg = await getConfig();
    res.json({ vehicle: decorate(v, cfg) });
  } catch (e) { res.status(500).json({ message: 'Failed to load vehicle' }); }
};

// A bad field is the user's problem to fix, not a server fault: say WHICH field
// and return 400. These used to fall into the generic 500 handler below, so the
// form showed "Failed to create vehicle" with no idea what was wrong.
/** اسمُ الحقل المكرَّر كما يقرؤه المستخدم — لا مسارُه في المخطَّط. */
const FIELD_AR = {
  plateNumber: 'رقم اللوحة',
  chassisNumber: 'رقم الهيكل',
  serialNumber: 'الرقم التسلسلي',
  'operatingCard.cardNumber': 'رقم بطاقة التشغيل',
  'gps.serialImei': 'سريال جهاز التتبّع',
  'fuelCard.cardNumber': 'رقم شريحة الوقود',
  'authorizedPerson.authorizationNumber': 'رقم التفويض',
};

// ── ولماذا `async` ────────────────────────────────────────────────────────────
// فرعُ التكرار يسأل القاعدة عن المركبة الأخرى ليسمّيها في الرسالة، وكان يُرجع
// `true` فورًا ويترك الردَّ يُرسَل في وعدٍ معلَّق — يصل في الحالة العاديّة بعد
// تكّة، لكنّ الدالّة تكذب على من ينادِيها: تقول «تولّيتُ الردّ» قبل أن تردّ.
// فصارت تُنتظَر، ويصير الردُّ مضمونًا قبل أن يعود النداء.
const badInput = async (e, res) => {
  // ── التكرار يُسمّى بالحقل والقيمة ─────────────────────────────────────────
  // «رقم اللوحة أو الهيكل مكرر» رسالةٌ تترك المستخدم يخمّن أيّهما ومَن يحمله.
  // ومونجو يعيد الحقل والقيمة في الخطأ نفسه، فتُقرأ منه ويُبحث عن المركبة
  // الأخرى — فيصير الردّ «هذا الرقم على المركبة الفلانية» لا «خطأ».
  if (e.code === 11000) {
    const field = Object.keys(e.keyPattern || {})[0] || '';
    const value = (e.keyValue || {})[field];
    const label = FIELD_AR[field] || field || 'أحد الأرقام الفريدة';
    let other = null;
    try { other = await VehicleMaster.findOne({ [field]: value }).select('plateNumber').lean(); } catch (_) { /* الرسالةُ العامّة تكفي */ }
    res.status(400).json({
      message: other
        ? `${label} «${value}» مسجَّلٌ على المركبة ${other.plateNumber} — ولا يتكرّر على مركبتين.`
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
    const v = await VehicleMaster.create({ ...req.body, isActive: true });
    emit('vreg:updated', {});
    res.status(201).json({ vehicle: v });
  } catch (e) {
    if (await badInput(e, res)) return;
    return sendMongooseError(res, e, 'Failed to create vehicle');
  }
};

// ── تحديثٌ يدمج، لا يستبدل ───────────────────────────────────────────────────
//
// كان `$set: req.body` يكتب الكائنَ الفرعيَّ كاملًا: من أرسل
// `{ operatingCard: { expiryDate } }` كان يمحو `cardNumber` و`statusCode` معه،
// وهو ما يجعل صفحةَ عائلةٍ تُعدّل حقلين فتُتلِف حقولًا لا تعرضها أصلًا. والمشروعُ
// في القائمة جزئيّ — لا ترجع `insurance.status` ولا `fuelCard.consumptionTypeCode` —
// فالواجهة لا تملك أصلًا ما تعيد إرساله لتحفظه.
//
// ولماذا التسطيحُ هنا لا في الواجهة: `express-mongo-sanitize` يحذف كلَّ مفتاحٍ
// فيه نقطة قبل أن يصل إلى المتحكّم، فمسارٌ منقوطٌ يُرسَل من المتصفّح يختفي في
// صمت — يقول المستخدم «حفظت» ولا شيء تغيّر.
const NEVER_SET = new Set(['_id', '__v', 'createdAt', 'updatedAt', 'docStatuses', 'overallStatus', 'overallDays']);

const flattenPatch = (src, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(src || {})) {
    if (!prefix && NEVER_SET.has(k)) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    // المصفوفة تُكتب كاملةً عن قصد: `logistiGaps` و`missingItems` قوائمُ تُستبدل
    // لا حقولٌ تُدمَج، ودمجُ عناصرها بالفهرس يبقي عنصرًا حُذف.
    const isPlain = v && typeof v === 'object' && !Array.isArray(v)
      && Object.getPrototypeOf(v) === Object.prototype;
    if (!isPlain) { out[path] = v; continue; }
    // كائنٌ فارغ لا يعني «فرِّغ ما تحته» — يعني «لا شيء هنا». وكتابتُه `{}`
    // كانت تمسح المستند كلَّه على مركبةٍ لم يُقصَد فيها تعديل.
    if (Object.keys(v).length) flattenPatch(v, path, out);
  }
  return out;
};

exports.update = async (req, res) => {
  try {
    const $set = flattenPatch(req.body);
    if (!Object.keys($set).length) return res.status(400).json({ message: 'لا حقول للتعديل' });
    const v = await VehicleMaster.findByIdAndUpdate(req.params.id, { $set }, { new: true, runValidators: true });
    if (!v) return res.status(404).json({ message: 'Vehicle not found' });
    emit('vreg:updated', {});
    res.json({ vehicle: v });
  } catch (e) {
    if (await badInput(e, res)) return;
    return sendMongooseError(res, e, 'Failed to update vehicle');
  }
};

/**
 * شريحةُ بترو اب: تركيبٌ ونزع — POST /:id/fuel-card
 *
 * ── ولماذا فعلٌ مستقلٌّ لا تعديلُ خانة ─────────────────────────────────────
 * نزعُ الشريحة شرطٌ في إخلاء طرف الموظّف: لا تُنهى خدمتُه وهي في يده. وشرطٌ
 * يُبنى على خانةٍ فارغة لا يُثبِت شيئًا — تُفرَّغ الخانةُ فيسقط الشرط، ولا يبقى
 * بعد شهرين جوابٌ لسؤال «مَن نزعها ومتى؟».
 *
 * فالفعلُ يُقيَّد: ما رقمُها، وفي يد من كانت، ومتى، وبيد من. والقيدُ هو ما
 * يُقرأ في ملفّ الموظّف وفي إخلاء طرفه.
 *
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
      // ── ويُنزَع ما يخصّ الشريحةَ وحدَها ────────────────────────────────────
      // اللوحةُ على الفاتورة وسقفُ الصرف صفتان لشريحةٍ لم تعد موجودة، فبقاؤهما
      // يجعل المركبةَ تُقرأ «عليها شريحةٌ بلا رقم». ونوعُ الاستهلاك يبقى: هو
      // صفةُ المركبة لا صفةُ الشريحة.
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

// ── لوحة التحليلات ─────────────────────────────────────────────────────────────
/** ملخّصُ بطاقات السائقين للوحة القسم — عددٌ لكلّ شريحةِ انتهاء. */
async function driverCardSummary() {
  try {
    const DriverCardModel = require('../models/DriverCard');
    const { startOfDay, todayKey } = require('../utils/companyDay');
    const today = startOfDay(todayKey());
    const rows = await DriverCardModel.find({ isActive: { $ne: false } }).select('expiryDate').lean();
    const left = (d) => (d ? Math.round((startOfDay(d) - today) / 86400000) : null);
    const out = { total: rows.length, expired: 0, critical: 0, warning: 0, valid: 0, unknown: 0 };
    for (const r of rows) {
      const n = left(r.expiryDate);
      if (n === null) out.unknown += 1;
      else if (n < 0) out.expired += 1;
      else if (n <= 30) out.critical += 1;
      else if (n <= 60) out.warning += 1;
      else out.valid += 1;
    }
    return out;
  } catch (e) { return null; }
}

exports.dashboard = async (req, res) => {
  try {
    const cacheKey = `vreg:dash:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return res.json(hit);

    const filter = buildFilter(req.query);
    const DASH_FIELDS = [
      'plateNumber sectorAr registrationTypeAr brandAr modelAr ownerNameAr colorAr tamStatusAr modelYear accidentCount',
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

    // توزيعات
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

    // مبالغ
    const premiums = vehicles.map((v) => Number(v.insurance?.premiumSar) || 0).filter((x) => x > 0);
    const totalPremium = premiums.reduce((a, b) => a + b, 0);
    const fuelLimits = vehicles.map((v) => Number(v.fuelCard?.limitSar) || 0).filter((x) => x > 0);
    const totalFuelLimit = fuelLimits.reduce((a, b) => a + b, 0);

    // حالة المستندات (buckets) لكل نوع
    const docBuckets = {};
    for (const dt of DOC_TYPES) {
      const b = { expired: 0, critical: 0, warning: 0, valid: 0, none: 0, not_required: 0 };
      const alert = cfg.alerts?.[dt.key];
      for (const v of vehicles) b[docStatus(getPath(v, dt.path), alert, getPath(v, dt.statusPath)).status] += 1;
      docBuckets[dt.key] = b;
    }

    // مؤشرات علوية
    const withGps = vehicles.filter(hasGps).length;
    const missingInsurance = vehicles.filter((v) => !v.insurance?.expiryDate).length;
    const missingOperatingCard = vehicles.filter((v) => !v.operatingCard?.cardNumber).length;
    const activeFuelCards = vehicles.filter((v) => v.fuelCard?.statusCode === 'active').length;

    // إجمالي التنبيهات (منتهي + خلال العتبة) عبر كل المستندات المفعّلة
    let expiredTotal = 0; let expiringTotal = 0;
    for (const dt of DOC_TYPES) {
      if (dt.key === 'gps' && !cfg.alerts?.gps?.enabled) continue;
      const b = docBuckets[dt.key];
      expiredTotal += b.expired;
      expiringTotal += b.critical + b.warning;
    }

    const body = {
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
      // ── بطاقاتُ السائقين في اللوحة ────────────────────────────────────────
      // البطاقةُ مستندٌ ينتهي كسائر مستندات القسم، فمكانُها حيث تُقرأ حالةُ
      // المستندات لا صفحةً وحدَها لا يفتحها إلّا من يذكرها.
      driverCards: await driverCardSummary(),
    };
    cache.set(cacheKey, body, 30000);
    res.json(body);
  } catch (e) { console.error('vreg dashboard', e); res.status(500).json({ message: 'Failed to load dashboard' }); }
};

// ── التنبيهات: كل مستند خلال عتبته أو منتهي ───────────────────────────────────
exports.alerts = async (req, res) => {
  try {
    const hit = cache.get('vreg:alerts');
    if (hit !== undefined) return res.json(hit);

    // **نفس** حساب شاشة الانتهاءات — التنبيهات مجرد فلتر عليه، مش حساب تاني.
    // كانت بدالة مختلفة، فالأرقام كانت بتختلف بين الشاشتين على نفس الداتا.
    const all = await buildExpiryRows({});
    // «على الرادار» تدخل التنبيهات: كانت ٢٤ مستندًا تسقط من الشاشة تمامًا لأن
    // انتهاءها بعد عتبة التحذير، فتظهر فجأةً وقد صارت حرجة.
    const ALERT_STATES = ['expired', 'critical', 'warning', 'upcoming'];

    const items = all
      .filter((r) => ALERT_STATES.includes(r.state))
      .map((r) => ({
        vehicleId: r.vehicleId, plateNumber: r.plateNumber, brandAr: r.brandAr, modelAr: r.modelAr,
        sectorAr: r.sectorAr, ownerNameAr: r.ownerNameAr,
        docType: r.docKey, docAr: r.docAr, docEn: r.docEn,
        expiryDate: r.expiryDate, daysRemaining: r.daysRemaining, status: r.state,
        // المستند اللي تنبيهه متقفول بيفضل ظاهر ومعلّم — قبل كده كان بيختفي
        // في صمت، فمستند منتهي فعلاً ما يبانش هنا وهو بايِن في الانتهاءات.
        alertEnabled: r.alertEnabled,
      }));

    items.sort((a, b) => (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0));
    const byStatus = { expired: 0, critical: 0, warning: 0, upcoming: 0 };
    const byDoc = {};
    for (const it of items) { byStatus[it.status] += 1; byDoc[it.docType] = (byDoc[it.docType] || 0) + 1; }
    const muted = items.filter((i) => !i.alertEnabled).length;
    const body = {
      items, total: items.length, byStatus, byDoc,
      // عشان الشاشة تقدر تقول «منهم كذا تنبيههم متقفول من الإعدادات».
      mutedCount: muted,
    };
    cache.set('vreg:alerts', body, 30000);
    res.json(body);
  } catch (e) { console.error('vreg alerts', e); res.status(500).json({ message: 'Failed to load alerts' }); }
};

exports.getSettings = async (req, res) => {
  try { const cfg = await getConfig(); res.json({ config: { alerts: cfg.alerts } }); }
  catch (e) { res.status(500).json({ message: 'Failed to load settings' }); }
};

exports.updateSettings = async (req, res) => {
  try {
    // بننضّف اللي جاي: أي مستند معروف بس، وأرقام موجبة، و«حرج» مايبقاش أكبر من
    // «تنبيه» — لو حصل، التنبيه البرتقالي كان هيختفي خالص وما حدش هيلاحظ.
    const incoming = req.body.alerts || {};
    const keys = [...VDOC.DOC_KEYS, 'corporatePolicy'];
    const clean = {};
    const problems = [];
    for (const k of keys) {
      const a = incoming[k];
      if (!a) continue;
      const warn = Math.max(0, Math.min(3650, Number(a.warnDays)));
      const crit = Math.max(0, Math.min(3650, Number(a.criticalDays)));
      if (!Number.isFinite(warn) || !Number.isFinite(crit)) { problems.push(k); continue; }
      // «على الرادار» أفقٌ ثالث يقرأه `stateOf`، وكان يسقط من هنا فيُستبدل عند
      // كل حفظٍ بقيمته الافتراضية: يضبط المستخدم أفق التأمين على ١٨٠ يومًا ثم
      // يغيّر عتبةً أخرى فيعود الأفق ٩٠ بلا أن يمسّه أحد.
      const soonRaw = Number(a.soonDays);
      const soon = Number.isFinite(soonRaw) ? Math.max(0, Math.min(3650, soonRaw)) : 90;
      clean[k] = {
        enabled: a.enabled !== false,
        warnDays: warn,
        criticalDays: Math.min(crit, warn),   // الحرج جوّه التنبيه دايمًا
        soonDays: Math.max(soon, warn),       // والرادار أوسع من التنبيه دايمًا
      };
    }
    if (problems.length) return res.status(400).json({ message: `قيم غير صحيحة في: ${problems.join(', ')}` });

    const cfg = await VehicleRegistryConfig.findOneAndUpdate(
      { key: 'vehicle-registry' },
      { $set: { alerts: clean, updatedBy: req.user?._id }, $setOnInsert: { key: 'vehicle-registry' } },
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

// ═══════════════════════════════════════════════════════════════════════════
//  نظرة شاملة — كارت لكل عمود، وكله قابل للضغط
// ═══════════════════════════════════════════════════════════════════════════
/**
 * كل عمود في الماستر بيطلع كارت: التوزيع بقيمه، وكام «مطلوب» و«غير مطلوب»
 * و«لا يوجد». الفكرة إن صاحب الشركة يبص مرة واحدة ويعرف كل حاجة، وأي رقم
 * يدوس عليه يوديه على الصفحة المفلترة عليه — عشان كده كل مجموعة بترجع معاها
 * `filter` جاهز تبعته للـ list.
 */
// ── الفلاتر المتاحة وقيمها، والتحليلات المشتقّة ────────────────────────────────
//
// نفس مبدأ الموارد البشرية: الشاشة لا تكتب قائمة الفلاتر عندها. الخادم يقول
// «هذه هي الحقول، وهذه قيمها الموجودة فعلًا، وهذا عدد كلٍّ منها **بعد بقيّة
// الفلاتر**» — فما يظهر في القائمة هو ما ستحصل عليه إن ضغطته، ولا يظهر خيارٌ
// عدده صفر.
//
// عند حساب قيم حقلٍ ما تُطبَّق كل الفلاتر إلا هو، وإلا لبقيت القيمة المختارة
// وحدها ظاهرةً فلا يستطيع أحد أن يضيف قيمةً ثانية إلى اختياره.
const FILTER_DEFS = [
  { key: 'sector', field: 'sectorAr', ar: 'القطاع', en: 'Sector', groupAr: 'التصنيف', groupEn: 'Classification' },
  { key: 'department', field: 'departmentAr', ar: 'الإدارة', en: 'Department', groupAr: 'التصنيف', groupEn: 'Classification' },
  { key: 'city', field: 'cityAr', ar: 'المدينة', en: 'City', groupAr: 'التصنيف', groupEn: 'Classification' },
  { key: 'registrationType', field: 'registrationTypeAr', ar: 'نوع التسجيل', en: 'Registration type', groupAr: 'التصنيف', groupEn: 'Classification' },
  { key: 'possession', field: 'possessionStatusAr', ar: 'حالة الحيازة', en: 'Possession', groupAr: 'التصنيف', groupEn: 'Classification' },
  // حالة التشغيل: أوّل سؤالٍ تسأله الإدارة وآخرُ ما كان يجد شاشةً تجيبه.
  { key: 'serviceStatus', field: 'serviceStatusAr', ar: 'حالة التشغيل', en: 'Service status', groupAr: 'التصنيف', groupEn: 'Classification' },
  { key: 'brand', field: 'brandAr', ar: 'الماركة', en: 'Brand', groupAr: 'المركبة', groupEn: 'Vehicle' },
  { key: 'model', field: 'modelAr', ar: 'الطراز', en: 'Model', groupAr: 'المركبة', groupEn: 'Vehicle' },
  { key: 'color', field: 'colorAr', ar: 'اللون', en: 'Colour', groupAr: 'المركبة', groupEn: 'Vehicle' },
  { key: 'modelYear', field: 'modelYear', ar: 'سنة الصنع', en: 'Model year', groupAr: 'المركبة', groupEn: 'Vehicle' },
  { key: 'owner', field: 'ownerNameAr', ar: 'المالك', en: 'Owner', groupAr: 'الملكية والتفويض', groupEn: 'Ownership' },
  { key: 'commercialRegistration', field: 'commercialRegistration', ar: 'السجل التجاري', en: 'Commercial register', groupAr: 'الملكية والتفويض', groupEn: 'Ownership' },
  { key: 'authorizedPerson', field: 'authorizedPerson.name', ar: 'المفوَّض', en: 'Authorised person', groupAr: 'الملكية والتفويض', groupEn: 'Ownership' },
  // ── ورقمُ الورقة فلترٌ كاسم حاملها ──────────────────────────────────────
  // «هاتِ لي المركبة صاحبة هذا الرقم» هو أوّل ما يُسأل حين تصل مخالفةٌ أو
  // فاتورة: الورقة في اليد وعليها رقمٌ، والمركبةُ هي المجهول. وكانت هذه
  // الأرقام مقبولةً في `buildFilter` منذ البداية ولا تظهر في اللوحة، فلا
  // يبلغها إلا من يكتب الرابط بيده.
  { key: 'authorizedPersonIqama', field: 'authorizedPerson.iqamaNumber', ar: 'رقم إقامة المفوَّض', en: 'Authorised person iqama', groupAr: 'الملكية والتفويض', groupEn: 'Ownership' },
  { key: 'authorizationNumber', field: 'authorizedPerson.authorizationNumber', ar: 'رقم التفويض', en: 'Authorisation number', groupAr: 'الملكية والتفويض', groupEn: 'Ownership' },
  { key: 'insuranceCompany', field: 'insurance.companyAr', ar: 'شركة التأمين', en: 'Insurer', groupAr: 'التأمين', groupEn: 'Insurance' },
  { key: 'coverageType', field: 'insurance.coverageTypeAr', ar: 'نوع التغطية', en: 'Coverage', groupAr: 'التأمين', groupEn: 'Insurance' },
  // رقم الوثيقة فلترٌ لا زينة: وثيقةٌ واحدة تغطّي ١٩٨ مركبة، و«أرِني كل ما
  // تغطّيه هذه الوثيقة» هو السؤال الذي يسبق كل تجديد.
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

// الحقول التي تحتاجها كل الفلاتر، مجموعةً مرّة واحدة: استعلامٌ واحدٌ يكفيها
// جميعًا. جلبُ المستند كاملًا لثلاثمئة مركبة في كل فتحةٍ للّوحة نقلٌ لا داعي
// له على عنقود Atlas المُقيَّد، وهو ما تُقاس به بطء هذه الشاشة.
const FILTER_SELECT = [...new Set([
  ...FILTER_DEFS.map((d) => d.field),
  ...DERIVED_DEFS.flatMap((d) => d.select || []),
])].join(' ');

// ── ولماذا مجموعتان لا واحدة ────────────────────────────────────────────────
// الفلاتر المباشرة عدُّ قيمٍ، والعدُّ يجري في القاعدة: يعود سطرٌ لكلّ قيمة بدل
// أن تعبر ثلاثُمئةِ مركبةٍ الشبكةَ لتُعَدَّ هنا. أمّا المشتقّاتُ فشروطُها دوالُّ
// جافاسكربت (كم بقي على انتهاء الوثيقة، ما الناقص) لا تُترجَم إلى تجميع — فهي
// وحدَها تسحب صفوفًا، وبحقولها هي فقط: أربعةَ عشرَ حقلًا لا ستّةً وأربعين.
//
// وكانت اللوحةُ تسحب الاتّحادَ كلَّه لكلّ فلترٍ نشط، فتسعُ ثوانٍ في كلّ فتحة.
const DERIVED_SELECT = [...new Set(DERIVED_DEFS.flatMap((d) => d.select || []))].join(' ');

const _get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

exports.filterOptions = async (req, res) => {
  try {
    const key = `vreg:filters:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const tally = (rows, field) => {
      const counts = new Map();
      for (const r of rows) {
        const raw = _get(r, field);
        const v = (raw === null || raw === undefined || raw === '') ? '—' : String(raw);
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
    };

    // «كل الفلاتر إلا هذا الحقل» تختلف فعليًّا فقط للحقول المفلترة الآن؛ والبقيّة
    // تشترك في المجموعة نفسها. استعلامٌ واحد لها جميعًا وواحدٌ لكل فلترٍ نشط،
    // بدل ثمانية عشر استعلامًا في كل فتحةٍ للّوحة.
    // الشرائح المشتقّة تُعَدّ بنفس دالّة الشرط التي تفتح صفوفها — تعريفٌ واحد
    // للاثنين، فلا يفترق الرقم عمّا يفتحه. والقيمة التي عددُها صفر لا تُعرَض:
    // خيارٌ تضغطه فتجد الشاشة فارغة أسوأ من غيابه.
    const tallyDerived = (rows, d) => {
      if (d.valuesOf) {
        const m = new Map();
        // القيم متعددة على المركبة الواحدة (بنود النقص، شروط لوجستي): تُعَدّ
        // المركبة في كل بندٍ ينقصها — ولذلك يفوق مجموعُ هذه الشريحة عددَ
        // المركبات، وهو صحيح هنا وحده دون سائر الحقول.
        for (const r of rows) for (const v of d.valuesOf(r)) m.set(v, (m.get(v) || 0) + 1);
        return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
      }
      // ترتيب الشرائح هو ترتيب التعريف لا ترتيب الأعداد: «منتهٍ» قبل «خلال ٣٠»
      // قبل «٣١ إلى ٦٠» — سُلَّمٌ يُقرأ، وفرزُه بالعدد يُفقده معناه.
      return d.options.map((o) => ({ value: o.value, count: rows.filter(o.test).length }))
        .filter((x) => x.count > 0);
    };

    const ALL_DEFS = [...FILTER_DEFS, ...DERIVED_DEFS];
    const isOn = (k) => req.query[k] != null && req.query[k] !== '';
    const active = ALL_DEFS.filter((d) => isOn(d.key));
    const passive = ALL_DEFS.filter((d) => !isOn(d.key));
    // عدُّ القيم لكلّ حقلٍ مباشرٍ في مرورٍ واحدٍ على القاعدة.
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
        out.set(d.key, ((r && r[`f${i}`]) || []).map((b) => ({
          value: b._id === null || b._id === '' ? '—' : String(b._id),
          count: b.count,
        })));
      });
      return out;
    };

    const needRows = passive.some((d) => !d.field) || active.some((d) => !d.field);
    const [sharedPlain, shared] = await Promise.all([
      passive.length ? plainTally(buildFilter(req.query)) : new Map(),
      needRows && passive.length
        ? VehicleMaster.find(buildFilter(req.query)).select(DERIVED_SELECT).lean()
        : [],
    ]);
    const perActive = new Map(); const perActivePlain = new Map();
    await Promise.all(active.map(async (d) => {
      const others = { ...req.query };
      delete others[d.key];
      const f = buildFilter(others);
      if (d.field) perActivePlain.set(d.key, (await plainTally(f)).get(d.key) || []);
      else perActive.set(d.key, await VehicleMaster.find(f).select(DERIVED_SELECT).lean());
    }));

    const filters = ALL_DEFS.map((d) => ({
      key: d.key, ar: d.ar, en: d.en, groupAr: d.groupAr, groupEn: d.groupEn,
      values: d.field
        ? (perActivePlain.get(d.key) || sharedPlain.get(d.key) || [])
        : tallyDerived(perActive.get(d.key) || shared, d),
    })).filter((f) => f.values.length);
    const body = { filters };
    // ── عشرون ثانيةً كانت تعني «بارد» في كلّ مرّة ────────────────────────────
    // اللوحةُ تُفتح مرّةً كلّ بضع دقائق، فينتهي الكاشُ قبل الفتحة التالية دائمًا
    // ولا يستفيد منه أحد. وكلُّ كتابةٍ على السجلّ تمسح `vreg:` كاملًا (راجع
    // `emit` أعلى الملفّ)، فطولُ المدّة لا يُبقي رقمًا قديمًا: يُبقي رقمًا صحيحًا
    // جاهزًا. خمسُ دقائقَ تجعل الفتحةَ الثانيةَ فوريّةً لكلّ من يفتحها.
    cache.set(key, body, 5 * 60 * 1000);
    res.json(body);
  } catch (e) {
    console.error('vreg filterOptions', e);
    res.status(500).json({ message: 'تعذّر تحميل الفلاتر' });
  }
};

/**
 * التحليلات المشتقّة — آفاق انتهاء كل مستند، وأعمار المركبات.
 *
 * مع كل شريحة **الفلتر الذي يعيد إنتاجها بالضبط**، فالضغط عليها يفتح صفوفها
 * دون أن تخمّن الواجهة الشرط، ولا يفترق الرقم المعروض عن الصفوف التي يفتحها.
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
      // «منتهٍ» ينتهي بالأمس و«خلال ٣٠» تبدأ اليوم — ولولا الفصل لعُدَّ ما ينتهي
      // اليوم في الشريحتين معًا فتجاوز مجموع الشرائح عدد المركبات.
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

  // أعمار المركبات — سنة الصنع رقم لا يُقرأ منه العمر بالعين.
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
 * تسخينُ لوحة الفلاتر.
 *
 * أوّلُ ضغطةٍ على «فلتر» كانت تدفع ثمنَ الاتّصال البارد وقراءةَ صفوف المشتقّات
 * معًا — والمستخدم واقفٌ ينتظر. والحالةُ الشائعة (بلا فلترٍ نشط) واحدةٌ لا
 * تتغيّر إلّا بكتابة، فتُحسب مرّةً بعد الإقلاع وتبقى جاهزة.
 */
exports.warmFilters = async () => {
  try {
    const fake = { query: {}, user: null };
    await new Promise((resolve) => {
      exports.filterOptions(fake, { json: resolve, status: () => ({ json: resolve }) });
    });
  } catch (e) { /* التسخينُ رفاهيةٌ لا شرط */ }
};

exports.overview = async (req, res) => {
  try {
    const key = `vreg:overview:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const filter = buildFilter(req.query);
    const [vehicles, cfg, allClaims, policies] = await Promise.all([
      VehicleMaster.find(filter).select(AGG_FIELDS).lean(),
      getConfig(),
      VehicleClaim.find({ isActive: true }).select('vehiclePlateKey plateNumber status cost isActive date').lean(),
      CorporatePolicy.find({ isActive: true }).lean(),
    ]);

    // الحوادث تُقصَر على المركبات المطابقة للفلتر.
    //
    // كانت تُحسب على الأسطول كلّه مهما كان الفلتر، فتختار فرعًا فتقرأ فوق
    // مركباته عددَ حوادث الشركة كلها ومبالغها — رقمٌ لا يخصّ ما تنظر إليه،
    // ولا شيء على الشاشة يقول ذلك. الربط بمفتاح اللوحة الموحَّد لأن الحوادث
    // تُسجَّل باللوحة لا بمعرّف المركبة.
    // ولا يُطبَّق الربط إلا حين يكون هناك فلترٌ فعلًا.
    //
    // بلا فلتر كان الربط يُسقِط كلَّ حادثٍ لا مفتاح لوحةٍ له — الحوادث غير
    // المرتبطة بمركبة، وما لم يُطابَق عند الاستيراد — فيصير الإجماليّ أقلّ من
    // حقيقة الأسطول ولا شيء على الشاشة يقول ذلك. وهذا نفسُ العطل الذي أُصلح
    // من أجله الربط. وما لم يُطابَق يُعلَن عددُه بدل أن يُبتلَع.
    const filtered = Object.keys(req.query || {}).some((k) => !['scope'].includes(k) && req.query[k] !== '');
    const plateKeys = new Set(vehicles.map((v) => v.plateKey).filter(Boolean));
    const claims = filtered
      ? allClaims.filter((c) => plateKeys.has(c.vehiclePlateKey))
      : allClaims;
    const unmatchedClaims = filtered ? 0 : allClaims.filter((c) => !c.vehiclePlateKey).length;

    // توزيع عمود: القيمة → العدد، مرتّبة، ومع كل قيمة الفلتر اللي بيوصّلها.
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

    // بطاقات التصنيف — عمود بعمود.
    const breakdowns = [
      { key: 'sector', ar: 'القطاع', en: 'Sector', field: 'sectorAr', items: group('sectorAr', (v) => v.sectorAr) },
      // جاءت مع تحديث ملفات القسم: الإدارة والمدينة أدقّ من القطاع وحده — «مركبات
      // كيتا في مكة» سؤال يُسأل، وكان لا يجد بطاقةً تجيبه.
      { key: 'department', ar: 'الإدارة', en: 'Department', field: 'departmentAr', items: group('departmentAr', (v) => v.departmentAr) },
      { key: 'city', ar: 'المدينة', en: 'City', field: 'cityAr', items: group('cityAr', (v) => v.cityAr) },
      { key: 'possession', ar: 'حالة الحيازة', en: 'Possession', field: 'possessionStatusAr', items: group('possessionStatusAr', (v) => v.possessionStatusAr) },
      // حالة التشغيل قبل أي تصنيفٍ آخر: ٧٦ مركبة من ٣٣٥ واقفةٌ أو مسروقة —
      // ربعُ الأسطول لا يعمل، ولم تكن في الصفحة بطاقةٌ تقول ذلك.
      { key: 'serviceStatus', ar: 'حالة التشغيل', en: 'Service status', field: 'serviceStatusAr', items: group('serviceStatusAr', (v) => v.serviceStatusAr) },
      { key: 'registrationType', ar: 'نوع التسجيل', en: 'Registration type', field: 'registrationTypeAr', items: group('registrationTypeAr', (v) => v.registrationTypeAr) },
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
      // جهة سداد القسط: ٢٧ مركبة يسدّد قسطها المموِّل — مؤمَّنةٌ ورقمُها عنده،
      // وكانت تُقرأ «بلا قسط» فتظهر نقصًا لا وجود له.
      { key: 'premiumStatus', ar: 'جهة سداد القسط', en: 'Premium paid by', field: 'insurance.premiumStatusAr', items: group('insurance.premiumStatusAr', (v) => v.insurance?.premiumStatusAr) },
      { key: 'gpsStatus', ar: 'حالة جهاز التتبّع', en: 'GPS status', field: 'gps.status', items: group('gps.status', (v) => v.gps?.status) },
      { key: 'gpsProvider', ar: 'مزوّد التتبّع', en: 'GPS provider', field: 'gps.provider', items: group('gps.provider', (v) => v.gps?.provider) },
      { key: 'gpsDevice', ar: 'موديل جهاز التتبّع', en: 'GPS device', field: 'gps.deviceModel', items: group('gps.deviceModel', (v) => v.gps?.deviceModel) },
      // حالة الجهاز غير حالة الاشتراك: جهاز «مسروق» اشتراكه قد يكون ساريًا.
      { key: 'gpsDeviceStatus', ar: 'حالة الجهاز', en: 'Device status', field: 'gps.deviceStatusAr', items: group('gps.deviceStatusAr', (v) => v.gps?.deviceStatusAr) },
      { key: 'inspectionStatus', ar: 'حالة الفحص', en: 'Inspection', field: 'inspection.statusAr', items: group('inspection.statusAr', (v) => v.inspection?.statusAr) },
    ];

    // بطاقة لكل مستند: الحالات المحسوبة + الحالات الإدارية (مطلوب/غير مطلوب/لا يوجد).
    const documents = DOC_TYPES.map((dt) => {
      const states = { valid: 0, warning: 0, critical: 0, expired: 0, missing: 0, not_applicable: 0 };
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
        // بالاسم زي ما هو في الإكسل: مطلوب / غير مطلوب / لا يوجد / لدى البنك …
        statuses: Object.entries(statuses)
          .map(([code, count]) => ({ code, ar: VDOC.statusLabel(code, 'ar'), en: VDOC.statusLabel(code, 'en'), count }))
          .sort((a, b) => b.count - a.count),
        needsAttention: states.expired + states.critical + states.warning,
        nearestDays: nearest,
      };
    });

    // أرقام فوق.
    const totals = {
      vehicles: vehicles.length,
      insuredPremiumSar: Math.round(vehicles.reduce((t, v) => t + (Number(v.insurance?.premiumSar) || 0), 0)),
      withGps: vehicles.filter(hasGps).length,
      activeFuelCards: vehicles.filter((v) => v.fuelCard?.statusCode === 'active').length,
      withAccidents: vehicles.filter((v) => (v.accidentCount || 0) > 0).length,
      needsAttention: documents.reduce((t, d) => t + d.needsAttention, 0),
      // نواقص منصّة لوجستي: كم مركبة لا تستوفي شروط المنصّة، وكم شرطًا ناقصًا
      // في المجموع. الرقم الثاني هو حجم العمل الحقيقي — مركبة واحدة قد ينقصها
      // ثلاثة شروط.
      withLogistiGaps: vehicles.filter((v) => (v.logistiGaps || []).length > 0).length,
      logistiGapItems: vehicles.reduce((t, v) => t + (v.logistiGaps || []).length, 0),
      // نواقص البيانات: كم مركبة ينقصها شيء، وكم بندًا في المجموع، وكم منها
      // **عملٌ مطلوب** فعلًا. «غير مطلوب» حالة سليمة ولا تُعدّ نقصًا — خلطها
      // بالباقي يجعل الرقم الذي ينظر إليه المدير بلا معنى.
      withMissing: vehicles.filter((v) => (v.missingItems || []).some((x) => VDOC.isGap(x.reason))).length,
      missingItems: vehicles.reduce((t, v) => t + (v.missingItems || []).filter((x) => VDOC.isGap(x.reason)).length, 0),
    };

    // النواقص مجمَّعة بالبند ثم بالسبب — «بطاقة التشغيل: ٤٤ مطلوبة و٧٢ لا يوجد»
    // بندان مختلفان من العمل، لا رقم واحد.
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

    // الشروط الناقصة مرتّبة بالأكثر تكرارًا — من أين يبدأ العمل.
    const gapCounts = new Map();
    for (const v of vehicles) for (const g of v.logistiGaps || []) gapCounts.set(g, (gapCounts.get(g) || 0) + 1);
    const logistiGaps = [...gapCounts.entries()]
      .map(([value, count]) => ({ value, count, filter: { logistiGap: value } }))
      .sort((a, b) => b.count - a.count);

    // الحوادث والمطالبات — الفلوس هي السؤال.
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

    // وثائق الشركة — انتهاؤها بيوقّف الشغل كله مش عربية واحدة.
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

// ═══════════════════════════════════════════════════════════════════════════
//  الانتهاءات — بفلتر مرن: «وريني اللي هينتهي خلال كام يوم»
// ═══════════════════════════════════════════════════════════════════════════
/**
 * GET /expiring?doc=insurance&withinDays=30
 *   doc         مستند واحد أو أكتر (مفصولين بفاصلة)، فاضي = كلهم
 *   withinDays  أي رقم يكتبه المستخدم — مش قايمة ثابتة (٣٠/٦٠/٩٠)
 *   includeExpired=0  يخفي المنتهي بالفعل
 *   state       فلتر إضافي على الحالة المحسوبة
 * بيرجّع صف لكل (مركبة × مستند)، مرتّب بالأقرب انتهاءً.
 */
// ── مصدر واحد لحالة كل مستند ────────────────────────────────────────────────
//
// «الانتهاءات والتجديد» و«تنبيهات المركبات» بيردوا على نفس السؤال: أنهي مستند
// قرب أو خلص؟ وكانوا محسوبين بدالتين مختلفتين وفلترين مختلفين، فالأرقام كانت
// بتختلف — والمستخدم شاف ده بنفسه («الأرقام فيهم مش زي بعض»). أسوأ فرق: شاشة
// التنبيهات كانت بتسقط أي نوع مستند تنبيهه متقفول من الإعدادات **في صمت**، فمستند
// منتهي فعلاً ما كانش بيظهر فيها وهو ظاهر في الانتهاءات.
//
// الدالة دي بقت المصدر الوحيد، والشاشتين بيبنوا منها. لو المستقبل عايز يفرّق
// بينهم، بيفرّق في **الفلتر** مش في **الحساب**.
async function buildExpiryRows(query = {}) {
  const [vehicles, cfg] = await Promise.all([
    VehicleMaster.find(buildFilter(query)).select(AGG_FIELDS).lean(),
    getConfig(),
  ]);
  const rows = [];
  for (const v of vehicles) {
    for (const dt of DOC_TYPES) {
      const expiry = getPath(v, dt.path);
      const statusCode = getPath(v, dt.statusPath) || '';
      const st = VDOC.stateOf(expiry, statusCode, cfg.alerts?.[dt.key]);
      rows.push({
        vehicleId: v._id, plateNumber: v.plateNumber, brandAr: v.brandAr, modelAr: v.modelAr,
        sectorAr: v.sectorAr, ownerNameAr: v.ownerNameAr, modelYear: v.modelYear,
        docKey: dt.key, docAr: dt.ar, docEn: dt.en,
        expiryDate: expiry, daysRemaining: st.days, state: st.state, statusCode,
        // التنبيه متفعّل للنوع ده؟ بيترجّع مع الصف بدل ما الصف يختفي في صمت.
        alertEnabled: cfg.alerts?.[dt.key]?.enabled !== false,
        // رقم المستند من تعريفه لا من سلسلة شروطٍ تُنسى: التفويض أُضيف مستندًا
        // سادسًا ولم يُضَف إلى السلسلة، فظهر في شاشة الانتهاءات بلا رقمٍ يُعرَف
        // به — ولا يُجدَّد تفويضٌ لا يُعرَف رقمه.
        reference: dt.numberPath ? String(getPath(v, dt.numberPath) || '') : '',
        company: dt.key === 'insurance' ? v.insurance?.companyAr : dt.key === 'gps' ? v.gps?.provider : '',
        // اسم المفوَّض: التفويض وحده من بين المستندات مقرونٌ بشخص، و«تفويضٌ
        // ينتهي بعد أسبوع» سؤالٌ ناقصٌ ما لم يُقَل تفويضُ مَن.
        holder: dt.key === 'authorization' ? String(v.authorizedPerson?.name || '') : '',
      });
    }
  }
  return rows;
}

exports.expiring = async (req, res) => {
  try {
    const withinDays = req.query.withinDays === '' || req.query.withinDays == null
      ? null : Math.max(0, Number(req.query.withinDays) || 0);
    const wanted = _multi(req.query.doc);
    const includeExpired = req.query.includeExpired !== '0';
    const states = _multi(req.query.state);

    const all = await buildExpiryRows(req.query);
    const rows = [];
    for (const r of all) {
      const st = { state: r.state, days: r.daysRemaining };
      const dt = { key: r.docKey };
      if (wanted.length && !wanted.includes(dt.key)) continue;
      {
        // «غير مطلوب» مش بينتهي، و«بدون تاريخ» ملهاش مكان في شاشة انتهاءات.
        if (st.state === 'not_applicable' || st.state === 'missing') continue;
        if (!includeExpired && st.state === 'expired') continue;
        // الفلترُ يُقارَن بالحالة كما تُعرَض لا كما تُحسَب: الشاشةُ تعرض ثلاثًا
        // («منتهٍ · قارب على الانتهاء · ساري») والحسابُ يفرّق تحتها ثلاثَ
        // درجاتٍ للّون. فمن ضغط «قارب على الانتهاء» يقصدها كلَّها.
        if (states.length && !states.includes(st.state) && !states.includes(VDOC.publicState(st.state))) continue;
        // المنتهي بالفعل بيفضل ظاهر مهما كانت المدة — هو أصلاً فات الميعاد.
        if (withinDays !== null && st.days > withinDays) continue;
        rows.push({
          ...r,
        });
      }
    }
    rows.sort((a, b) => (a.daysRemaining ?? 1e9) - (b.daysRemaining ?? 1e9));

    // ملخّص بيتحسب على نفس الصفوف، فالرقم اللي فوق دايمًا بيوصف اللي تحت.
    const summary = { total: rows.length, expired: 0, critical: 0, warning: 0, valid: 0 };
    const byDoc = {};
    for (const r of rows) {
      summary[r.state] = (summary[r.state] || 0) + 1;
      byDoc[r.docKey] = (byDoc[r.docKey] || 0) + 1;
    }
    // ── السقف يُعلن نفسه، ويُرفَع عند الطلب ────────────────────────────────────
    // الصفوف هنا مركبةٌ × مستند، فالألفان أقربُ ممّا تبدو. وكان القصّ صامتًا:
    // الملخّص فوق يعدّ الكلّ والملفّ ينزل بألفين، فيقرأ المصدِّر ملفًّا ناقصًا
    // وهو يحسبه كاملًا — وهذا ما يجعل «تصدير الكلّ» وعدًا لا يُوفى.
    const CAP = Math.min(Number(req.query.limit) || 2000, 50000);
    const body = {
      rows: rows.slice(0, CAP),
      summary,
      byDoc: DOC_TYPES.map((d) => ({ key: d.key, ar: d.ar, en: d.en, count: byDoc[d.key] || 0 })),
      withinDays, docs: DOC_TYPES.map((d) => ({ key: d.key, ar: d.ar, en: d.en })),
    };
    if (rows.length > CAP) { body.truncated = true; body.limit = CAP; body.matched = rows.length; }
    res.json(body);
  } catch (e) {
    console.error('vreg expiring', e);
    res.status(500).json({ message: 'تعذّر تحميل الانتهاءات' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  التجديد
// ═══════════════════════════════════════════════════════════════════════════
/**
 * POST /:id/renew  { document, newExpiry, cost?, reference?, note? }
 *
 * بيحدّث تاريخ الانتهاء **وبيقيّد التجديد في السجل** بالتاريخ القديم والجديد
 * ومين عمله. من غير السجل، «جدّدناها امتى وبكام؟» مالهاش إجابة بعد أول تجديد.
 * وبيشيل حالة «لا يوجد/مطلوب» تلقائيًا — بقى فيه تاريخ خلاص.
 */
/**
 * يطبّق تجديدًا واحدًا على مركبة: التاريخ، والرقم إن تغيّر، والقيد في السجل.
 *
 * ولماذا دالّة لا سطورٌ مكرّرة في الموضعين: التجديد المفرد والجماعي كانا
 * ينسخان الخطوات نفسها، فأيّ تعديلٍ في أحدهما — وهذا التعديل مثالُه — يترك
 * الآخر خلفه. فيجدَّد الرقم من الشاشة الفردية ولا يجدَّد من الجماعية، ولا يظهر
 * الفرق إلا بعد أن تكون مئةُ مركبةٍ قد جُدِّدت ناقصةً.
 *
 * ويرجع القيد نفسه ليقيَّد في سجل المراجعة كما قُيِّد في المركبة.
 */
const applyRenewal = (v, doc, when, src = {}, byName = '') => {
  const [block, field] = doc.path.split('.');
  const previous = v[block]?.[field] || null;
  v[block][field] = when;

  // ── الرقم الجديد اختياريّ، وسكوتُه يعني «هو هو» ─────────────────────────
  // الفراغ ليس أمرًا بالمسح: من يترك الخانة فارغة لم يستخرج بطاقةً برقمٍ جديد،
  // ولو فسّرناه محوًا لأتلف التجديدُ الجماعيُّ مئتي رقمٍ في ضربة واحدة.
  let previousNumber = '';
  let newNumber = '';
  const wanted = src.documentNumber == null ? '' : String(src.documentNumber).trim();
  if (wanted && doc.numberPath) {
    const [nBlock, nField] = doc.numberPath.split('.');
    previousNumber = String(v[nBlock]?.[nField] || '');
    if (previousNumber !== wanted) { v[nBlock][nField] = wanted; newNumber = wanted; }
    else previousNumber = '';
  }

  // ── تاريخ البداية يُجدَّد مع النهاية ───────────────────────────────────
  // المستند الذي له بداية (التفويض) يُستخرج من جديد ببدايةٍ جديدة. وتركُها
  // على قيمتها القديمة يُبقي تاريخَ بدايةٍ لتفويضٍ انقضى وحلّ غيرُه — فيُقرأ
  // أنّ السائق يقود بتفويضٍ منذ سنةٍ وهو استخرجه أمس.
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
  // المستندات اللي اتحفظت قبل ما الحقل ده يتضاف مش هيكون عندها المصفوفة أصلاً.
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

exports.renew = async (req, res) => {
  try {
    const doc = VDOC.getDoc(req.body.document);
    if (!doc) return res.status(400).json({ message: 'نوع المستند غير معروف' });
    const newExpiry = req.body.newExpiry ? new Date(req.body.newExpiry) : null;
    if (!newExpiry || isNaN(newExpiry)) return res.status(400).json({ message: 'أدخل تاريخ الانتهاء الجديد' });

    const v = await VehicleMaster.findById(req.params.id);
    if (!v) return res.status(404).json({ message: 'المركبة غير موجودة' });

    // تجديد لتاريخ فات معناه غالبًا غلطة كتابة — نوقفه بدل ما يتسجّل ويلخبط.
    if (newExpiry < new Date(new Date().setHours(0, 0, 0, 0))) {
      return res.status(400).json({ message: 'تاريخ الانتهاء الجديد في الماضي — راجع التاريخ' });
    }
    // رقمٌ جديد لمستندٍ لا رقم له (رخصة السير، الفحص) طلبٌ لا معنى له: قبولُه
    // في صمت يوهم المستخدم أن رقمًا حُفظ ولا موضع له يُحفظ فيه.
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

// ── تجديد أكتر من مستند مرة واحدة ────────────────────────────────────────────
//
// الطلب: «النهاردة عندي تجديد ١٥١ كارت تشغيل كلهم انتهاءهم في يوم واحد» — فبدل
// ما يفتح مركبة مركبة، يعمل سيليكت ويقول التاريخ مرة واحدة.
//
// كل سطر بيمرّ على **نفس** منطق التجديد المفرد: نفس التحقق، ونفس القيد في سجل
// المركبة، ونفس التاريخ. مش مسار تاني — عشان التجديد الجماعي والمفرد ما يختلفوش
// في حاجة، والمراجع يلاقي نفس القيد في الحالتين.
//
// **الكل أو لا شيء**: لو سطر واحد غلط، مفيش مركبة واحدة بتتجدّد. تجديد نصّه
// اتنفّذ على ١٥١ مركبة كارثة — مفيش حد هيعرف مين اتجدّد ومين لأ.
/**
 * تجديدُ ورقةٍ مشتركةٍ دفعةً واحدة — POST /renew-shared
 *
 *   { document: 'insurance', number: 'P-W01-26-311-004248', newExpiry, newNumber?, cost?, reference?, note? }
 *
 * ── ولماذا لا يكفي «اختر ثمَّ جدِّد» ────────────────────────────────────────
 * وثيقةُ تأمينٍ واحدةٌ تغطّي مئةً وثمانيًا وتسعين مركبة. تجديدُها بتأشير مئةٍ
 * وثمانٍ وتسعين خانةً ليس تجديدًا للوثيقة: هو مئةٌ وثمانٍ وتسعون عمليّةً يدويّةً
 * لحدثٍ واحد، وأيُّ مركبةٍ تُنسى تبقى في الشاشة «منتهية» وهي مؤمَّنةٌ فعلًا.
 * وهذا هو ما كانت تفعله شاشةُ «وثائق تأمين المركبات» التي حُذفت لتكرارها، فعاد
 * الفعلُ إلى الشاشة التي تُدار منها المركبات بدل شاشةٍ ثانيةٍ لأجله وحده.
 *
 * الرقمُ هنا مشتركٌ عمدًا وهذا صحيح: هي وثيقةٌ واحدة، ورقمُها الجديد رقمُها
 * على كلّ ما تغطّيه. ولا يُقبل إلّا لمستندٍ عُلِّم `sharedNumber` — بطاقةُ
 * التشغيل رقمُها لكلّ مركبة، ورقمٌ واحدٌ عليها كلِّها تزويرٌ لا اختصار.
 *
 * ويُحدَّث معها سجلُّ الوثيقة نفسِه (`VehicleInsurancePolicy`) إن وُجد، وإلّا
 * بقي سجلُّ الوثائق يقول إنّها تنتهي في تاريخٍ مضى ومركباتُها كلُّها سارية.
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

    // سجلُّ الوثيقة نفسِه — إن كانت مسجَّلةً فيه.
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

    // ① التحقق على الكل قبل أي حفظ
    for (const [i, row] of items.entries()) {
      const doc = VDOC.getDoc(row.document);
      if (!doc) { errors.push({ line: i + 1, message: `نوع المستند «${row.document}» غير معروف` }); continue; }
      const when = row.newExpiry ? new Date(row.newExpiry) : shared;
      if (!when || isNaN(when)) { errors.push({ line: i + 1, message: 'أدخل تاريخ الانتهاء الجديد' }); continue; }
      if (when < today) { errors.push({ line: i + 1, message: 'تاريخ الانتهاء الجديد في الماضي — راجع التاريخ' }); continue; }
      const v = await VehicleMaster.findById(row.vehicle || row.id);
      if (!v) { errors.push({ line: i + 1, message: 'المركبة غير موجودة' }); continue; }
      // الرقم في التجديد الجماعي **سطريّ لا مشترك**: بطاقةُ كل مركبة تخرج
      // برقمها هي، ورقمٌ واحد يُكتب على مئةٍ منها يجعل المئة نسخةً من ورقة
      // واحدة — أسوأ من ألا يُكتب رقمٌ أصلًا.
      if (String(row.documentNumber || '').trim() && !doc.numberPath) {
        errors.push({ line: i + 1, message: `${doc.ar} ليس له رقم مستقلّ يُجدَّد` }); continue;
      }
      prepared.push({ v, doc, when, row });
    }
    if (errors.length) {
      return res.status(400).json({ message: 'العملية اترفضت — مفيش أي مركبة اتجدّدت', errors });
    }

    // ② التنفيذ — نفس خطوات التجديد المفرد بالظبط
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

    logAudit({
      user: req.user, action: 'renew_vehicle_document', entity: 'VehicleMaster', entityId: null,
      changes: {
        bulk: true, count: done.length, newExpiry: shared,
        documents: [...new Set(done.map((d) => d.document))],
        // كم رقمًا استُبدل فعلًا — الفرق بين «جدّدنا التواريخ» و«استخرجنا أوراقًا جديدة».
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

// ── سجلّات القسم: المُلّاك والمفوَّضون وأجهزة التتبّع وشرائح الوقود ──────────
//
// كلها **تُبنى من المركبات نفسها** لا من جداول موازية. المالك ليس كيانًا مستقلًّا
// عندنا — هو اسمٌ على مركبات؛ ولو خُزِّن مرتين لاختلف عدد مركباته بين الشاشتين
// أول ما تُنقَل مركبة. البناء من المصدر يجعل التناقض مستحيلًا لا نادرًا.
//
// وكل سجلّ يحمل ما يُسأل عنه فعلًا: كم مركبة، وكم منها مستنداتها منتهية.
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
    const cfg = await getConfig();
    const vehicles = await VehicleMaster.find({ isActive: { $ne: false } }).select(AGG_FIELDS).lean();

    /** حالة أسوأ مستند على المركبة — بها نعرف «كم مركبة عند هذا المالك متعثّرة». */
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

    // شرائح الوقود سجلٌّ صفٌّ لكل شريحة لا تجميعة — الشريحة تخصّ مركبة واحدة.
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

    // وأجهزة التتبّع صفًّا صفًّا كذلك — الجهاز على مركبة بعينها بسيريال واشتراك.
    out.gpsUnits = {
      ar: 'أجهزة التتبّع المركّبة', en: 'Installed GPS units', filterKey: 'gpsUnit',
      // «مركّب» يعني له سيريال. المركبة التي حقلها يحمل «مطلوب» ليس عليها جهاز
      // ينتظر تركيبه — وعدُّها ضمن الأجهزة يضخّم الرقم بمئة جهاز غير موجود.
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

// ── وثائق تأمين المركبات ────────────────────────────────────────────────────
//
// وثيقة واحدة تغطّي حتى ٢٣٩ مركبة. تجديدها كان يعني فتح كل مركبة على حدة —
// وأي مركبة تُنسى تبقى في الشاشة «منتهية» وهي مؤمَّنة فعلًا. هنا تُجدَّد الوثيقة
// مرة واحدة، ويسري التاريخ على كل مركباتها، ويُقيَّد في سجل تجديدات كلٍّ منها
// كما لو جُدِّدت وحدها — فالمراجع يرى نفس القيد في الحالتين.
exports.listInsurancePolicies = async (req, res) => {
  try {
    const cfg = await getConfig();
    const policies = await VehicleInsurancePolicy.find({ isActive: { $ne: false } })
      .sort({ expiryDate: 1 }).lean();
    // عدد المركبات يُحسب من المركبات نفسها لا من رقم مخزَّن — الرقم المخزَّن يشيخ.
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
      // وثيقة جديدة برقم جديد؟ يتحدَّث على كل مركبة أيضًا.
      if (newNumber) v.set('insurance.policyNumber', newNumber);
      if (['none', 'required', 'unknown', ''].includes(v.insurance?.statusCode)) v.set('insurance.statusCode', '');
      if (!Array.isArray(v.renewals)) v.renewals = [];
      v.renewals.push({
        document: 'insurance', previousExpiry: before, newExpiry,
        // الرقم القديم يُقيَّد على كل مركبة لا على الوثيقة وحدها: المطالبةُ
        // المفتوحة بالرقم السابق تُراجَع مركبةً مركبة، ولو بقي الأثر في سجل
        // الوثيقة فقط لوجب فتحُ شاشةٍ أخرى لمعرفة برقم أيّ وثيقةٍ كانت مؤمَّنة.
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

// ── الحوادث والمطالبات ──────────────────────────────────────────────────────
// الحادث بيتسجّل ويتعدّل ويتقفل من الشاشة. كان بيتقرا بس — يعني الجرد الأول
// اتحمّل من الشيت وخلاص، وأي حادث بعده مالوش مكان يتكتب فيه.
//
// الحقول الحسابية (فجوة الاسترداد) بتتحسب هنا مش في الواجهة، عشان الشاشة
// والتقرير وأي مسار تاني ما يختلفوش.
const CLAIM_FIELDS = [
  'isVehicleIncident', 'incidentSubjectAr', 'vehiclePlate', 'vehicle',
  'vehicleSectorAr', 'vehicleTypeAr', 'vehicleCategoryAr', 'vehicleBrandAr', 'ownerRegistrationAr',
  'counterpartyNameAr', 'counterpartyNationalId', 'faultRatio', 'faultPercent',
  'accidentDate', 'reportedViaAr', 'reportedViaCode', 'accidentNumber', 'reportOrEstimateNumber',
  'statusAr', 'statusCode',
];
const CLAIM_SUB = ['insurerAr', 'claimNumber', 'claimNumberStatus', 'notesAr',
  'lastNoteDate', 'lastInsurerUpdateDate', 'estimatedAmountSar', 'expectedRecoverySar'];

/** يبني/يحدّث المستند من الجسم، وبيحسب الفجوة. */
function applyClaim(doc, body) {
  for (const k of CLAIM_FIELDS) if (body[k] !== undefined) doc[k] = body[k] === '' ? doc[k] : body[k];
  const sub = body.claim || {};
  doc.claim = doc.claim || {};
  for (const k of CLAIM_SUB) if (sub[k] !== undefined) doc.claim[k] = sub[k];
  // الفجوة = المقدَّر − المتوقع استرداده. محسوبة، مش متكتوبة — عشان ما تتناقضش.
  const est = Number(doc.claim.estimatedAmountSar);
  const rec = Number(doc.claim.expectedRecoverySar);
  doc.claim.recoveryGapSar = Number.isFinite(est) && Number.isFinite(rec) ? Math.round(est - rec) : null;
  if (doc.vehiclePlate) doc.vehiclePlateKey = plateKey(doc.vehiclePlate);
  return doc;
}

exports.createClaim = async (req, res) => {
  try {
    if (!req.body?.accidentDate && !req.body?.incidentSubjectAr && !req.body?.vehiclePlate) {
      return res.status(400).json({ message: 'اكتب على الأقل المركبة أو موضوع الواقعة أو تاريخها' });
    }
    // الرقم بيتولّد هنا: لو اتساب للمستخدم هيتكرّر أو يتساب فاضي.
    const last = await VehicleClaim.findOne({ claimId: /^ACC-/ }).sort({ claimId: -1 }).select('claimId').lean();
    const n = last ? (Number(String(last.claimId).replace('ACC-', '')) || 0) + 1 : 1;
    const doc = applyClaim(new VehicleClaim({ claimId: `ACC-${String(n).padStart(3, '0')}` }), req.body);
    if (!doc.statusCode) { doc.statusCode = 'pending'; doc.statusAr = doc.statusAr || 'قيد المتابعة'; }
    await doc.save();
    await syncAccidentCount(doc.vehiclePlateKey);
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
    await doc.save();
    await syncAccidentCount(oldKey);
    if (doc.vehiclePlateKey !== oldKey) await syncAccidentCount(doc.vehiclePlateKey);
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
    // حذف ناعم: المطالبة سجل مالي، والمسح النهائي بيضيّع تاريخها.
    doc.isActive = false;
    await doc.save();
    await syncAccidentCount(doc.vehiclePlateKey);
    emit('vreg:updated', {});
    res.json({ ok: true });
  } catch (e) {
    console.error('vreg deleteClaim', e);
    res.status(500).json({ message: 'تعذّر حذف الحادث' });
  }
};

/** عدّاد حوادث المركبة = عدد مطالباتها الفعّالة. محسوب، مش مكتوب بالإيد. */
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
      // نفسُ قاعدةِ البحث في سجلّ المركبات: المسافاتُ وفروقُ الرسم لا تمنع
      // مطابقةً — كانت اللوحةُ هنا تُطلب بحرفها فلا تُوجد.
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
        // «مر عليها كام يوم من غير رد من التأمين» — ده اللي بيكشف المطالبة النايمة.
        stale: rows.filter((r) => r.statusCode !== 'closed' && r.claim?.lastInsurerUpdateDate
          && VDOC.daysLeft(r.claim.lastInsurerUpdateDate) < -30).length,
      },
    });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل الحوادث' }); }
};

// ── وثائق التأمين على مستوى الشركة ──────────────────────────────────────────
exports.listCorporatePolicies = async (req, res) => {
  try {
    const [rows, cfg] = await Promise.all([
      CorporatePolicy.find({ isActive: true }).sort({ expiryDate: 1 }).lean(),
      getConfig(),
    ]);
    // ── ومَن تغطّيهم وثيقةُ خيانة الأمانة ────────────────────────────────────
    // القائمةُ ليست منسوخةً على الوثيقة: هي في بطاقات السائقين. فتُقرأ معها
    // ويُحسب الإجماليُّ من عدد المشمولين فعلًا — لا من عددٍ مكتوبٍ في الاسم
    // يصدق يومَ كُتب ويكذب بعد أوّل تعيين.
    const needsDrivers = rows.some((p) => p.coversDrivers);
    const cards = needsDrivers
      ? await DriverCard.find({ isActive: { $ne: false } })
        .select('idNumber name cardNumber expiryDate fidelity employee')
        .populate('employee', 'employeeNumber arabicName')
        .sort({ name: 1 }).lean()
      : [];

    res.json({
      policies: rows.map((p) => {
        const st = VDOC.stateOf(p.expiryDate, '', cfg.alerts?.corporatePolicy);
        const out = { ...p, state: st.state, daysRemaining: st.days };
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
          // الإجماليُّ المحسوب: السعرُ للرأس × عددُ المشمولين. و`premiumSar`
          // يبقى كما هو إن كُتب يدًا — الشاشةُ تعرض الاثنين ولا تُخفي أيَّهما.
          out.computedPremiumSar = p.premiumPerPersonSar != null
            ? Math.round(p.premiumPerPersonSar * covered.length * 100) / 100
            : null;
        }
        return out;
      }),
    });
  } catch (e) { console.error('listCorporatePolicies', e); res.status(500).json({ message: 'تعذّر تحميل وثائق الشركة' }); }
};

/** الحقولُ التي تُكتب على وثيقة الشركة — لا يُكتب غيرُها من الشاشة. */
const CORP_FIELDS = ['scopeAr', 'policyholderAr', 'policyNumbers', 'companyAr', 'startDate',
  'expiryDate', 'premiumSar', 'premiumPerPersonSar', 'statusAr', 'notesAr', 'coversDrivers'];

/**
 * إنشاءُ وثيقةِ شركةٍ وتعديلُها — كانت الصفحةُ تعرض ولا تكتب إلّا التجديد،
 * فأيُّ تصحيحٍ في رقمٍ أو قسطٍ أو شركةٍ يحتاج فتحَ القاعدة.
 */
const pickCorp = (body) => {
  const out = {};
  for (const k of CORP_FIELDS) {
    if (body[k] === undefined) continue;
    if (k === 'policyNumbers') {
      out[k] = Array.isArray(body[k]) ? body[k].map((x) => String(x).trim()).filter(Boolean)
        : String(body[k] || '').split(/[,،\n]/).map((x) => x.trim()).filter(Boolean);
    } else if (k === 'expiryDate' || k === 'startDate') {
      out[k] = body[k] ? new Date(body[k]) : null;
    } else if (k === 'premiumSar' || k === 'premiumPerPersonSar') {
      out[k] = body[k] === '' || body[k] === null ? null : Number(body[k]);
    } else if (k === 'coversDrivers') {
      out[k] = !!body[k];
    } else out[k] = String(body[k] ?? '').trim();
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
    // حذفٌ ناعم: الوثيقةُ تاريخٌ، وسجلُّ تجديداتها يُقرأ بعد انتهائها.
    const p = await CorporatePolicy.findByIdAndUpdate(req.params.id, { $set: { isActive: false } }, { new: true });
    if (!p) return res.status(404).json({ message: 'الوثيقة غير موجودة' });
    logAudit({ user: req.user, action: 'delete_corporate_policy', entity: 'CorporatePolicy', entityId: p._id, ipAddress: req.ip }).catch(() => {});
    emit('vreg:updated', {});
    res.json({ ok: true });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر حذف الوثيقة'); }
};

/**
 * ضمُّ سائقٍ إلى وثيقةِ خيانة الأمانة أو إخراجُه — POST /corporate-policies/:id/drivers
 *   { cardId, covered: true|false, addedDate? }
 *
 * ويُكتب في بطاقة السائق لا على الوثيقة: القائمةُ سجلٌّ واحدٌ لا نسختان.
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

/** تعريف المستندات — الواجهة بتبني منه الفلاتر والإعدادات بدل ما تكرّرها. */
exports.documentTypes = async (req, res) => {
  const cfg = await getConfig();
  res.json({
    // `numberAr` هو ما يجعل نافذة التجديد تعرف: أهذا مستندٌ له رقمٌ يتغيّر مع
    // التجديد فتسأل عنه، أم لا رقم له فتسكت؟ بدونه كانت الواجهة ستكتب القائمة
    // عندها وتفترق عن الخادم أوّلَ ما يُضاف مستند.
    documents: DOC_TYPES.map((d) => ({
      key: d.key, ar: d.ar, en: d.en, icon: d.icon,
      numberAr: d.numberPath ? d.numberAr : null, numberEn: d.numberPath ? d.numberEn : null,
      // ورقةٌ واحدةٌ تغطّي مركباتٍ كثيرة (التأمين) أم ورقةٌ لكلّ مركبة؟ عليه
      // تتوقّف نافذةُ التجديد الجماعيّ: أتعرض رقمًا واحدًا للجميع أم رقمًا لكلّ
      // سطر — راجع config/vehicleDocuments.
      sharedNumber: !!d.sharedNumber,
      alert: cfg.alerts?.[d.key] || {},
    })),
    corporatePolicyAlert: cfg.alerts?.corporatePolicy || {},
    states: VDOC.STATE_LABELS,
    statuses: VDOC.STATUS_LABELS,
  });
};

// ── ملفّات المركبة ──────────────────────────────────────────────────────────
//
// المركبة تحمل تواريخ مستنداتها وأرقامَها؛ وهذه تحمل صورَها. ومن دونها يُسأل
// «فين صورة الرخصة؟» فيُبحث عنها في واتساب — وهذا هو الفرق بين سجلٍّ ومجلَّد.
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
    // الاسم مطلوبٌ ولا يُشتقّ من اسم الملفّ: «IMG_20260829.jpg» لا يقول شيئًا
    // لمن يفتح الملفّ بعد سنة، و«صورة الرخصة» تقول كلَّ شيء.
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
    // البايتات لا تُستبدَل — الملفّ الخطأ يُحذف ويُرفع غيرُه. وما يُعدَّل هنا
    // وصفُه: اسمُه وعائلتُه وانتهاؤه وملاحظتُه.
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
    // البايتات تُمسح مع الصفّ: ملفٌّ يبقى على القرص بلا صفٍّ يشير إليه لا
    // يُفتح ولا يُحذف — يتراكم إلى أن يمتلئ القرص ولا يعرف أحدٌ ما هو.
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

// ═══════════════════════════════════════════════════════════════════════════
//  بطاقاتُ السائقين — سجلٌّ في قسم المركبات
// ═══════════════════════════════════════════════════════════════════════════
/**
 * مفتاحُ «هي هي» للّوحة الواحدة كُتبت بترتيبين.
 *
 * السجلّان يكتبان اللوحة الواحدة معكوسةً: «أ ص ي 5034» في سجلّ المركبات
 * و«5034 أ ص ي» في سجلّ الإسناد. و`registryPlateKey` يحفظ الترتيب — وهو محقٌّ
 * في ذلك، فهو يخدم البحثَ والعرض. أمّا هنا فالسؤال «أهما مركبةٌ واحدة؟»،
 * فتُرتَّب الحروفُ ألفبائيًّا وتُفصَل عن الأرقام.
 *
 * والحروفُ تبقى في المفتاح ولا تُسقَط: «ل أ 1080» دراجةٌ و«أ ص ر 1080» تريلا،
 * وإسقاطُ الحروف يجعلهما واحدة — أحدَ عشرَ تصادمًا في الملفّ الحاليّ.
 */
const samePlate = (p) => {
  if (p == null) return null;
  const west = String(p).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و');
  const digits = (west.match(/\d+/g) || []).join('');
  const letters = (west.match(/[\u0621-\u064AA-Za-z]/g) || []).map((c) => c.toUpperCase()).sort().join('');
  const k = `${digits}|${letters}`;
  return k === '|' ? null : k;
};

const DriverCard = require('../models/DriverCard');
const VehicleAuthorization = require('../models/VehicleAuthorization');

/** الأيّامُ حتى تاريخٍ بتقويم الشركة — تُحسب ولا تُخزَّن. */
const cardDaysLeft = (ymd) => {
  if (!ymd) return null;
  const { startOfDay, todayKey } = require('../utils/companyDay');
  const a = startOfDay(todayKey()); const b = startOfDay(ymd);
  return a && b ? Math.round((b - a) / 86400000) : null;
};

/** شريحةُ الانتهاء — نفسُ لغة بقيّة مستندات القسم. */
const cardState = (days) => {
  if (days === null) return 'unknown';
  if (days < 0) return 'expired';
  if (days <= 30) return 'critical';
  if (days <= 60) return 'warning';
  if (days <= 90) return 'upcoming';
  return 'valid';
};

exports.listDriverCards = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = {};
    if (q.logisticRegister) filter.logisticRegister = q.logisticRegister;
    if (q.cardType) filter.cardType = q.cardType;
    if (q.active !== 'all') filter.isActive = { $ne: false };
    if (q.q && String(q.q).trim()) {
      // «أيُّ اسمٍ أو أيُّ رقم» — كما في بقيّة القسم، بلا مبالاةٍ بالمسافات
      // ولا بفروق الرسم.
      const rx = flexSpaceRegex(q.q);
      filter.$or = [{ name: rx }, { idNumber: rx }, { cardNumber: rx },
        { absherPhone: rx }, { logisticRegister: rx }, { cardType: rx }, { notes: rx }];
    }
    if (q.fidelity) filter['fidelity.status'] = q.fidelity === 'none' ? { $in: ['', null] } : q.fidelity;
    let cards = await DriverCard.find(filter)
      .populate('employee', 'firstName lastName arabicName employeeNumber employmentStatus')
      .sort({ expiryDate: 1 }).lean();

    // ── التفاويضُ تُقرأ مع البطاقة ────────────────────────────────────────────
    //
    // «هل التفاويض ممكن تتربط مع السائق؟» — سؤالُ مدير المركبات. والربطُ قائمٌ
    // في القاعدة منذ البداية: `VehicleAuthorization.employee`. لكنّه لم يكن
    // مقروءًا من ناحية السائق قطّ: التفاويضُ تُعرَض مركبةً مركبة، فمعرفةُ ما
    // بيد سائقٍ بعينه تعني تصفّحَ ثلاثمئة صفٍّ بحثًا عن اسمه.
    //
    // فبطاقةُ السائق وتفاويضُه وخيانةُ أمانته تُقرأ من سطرٍ واحد — وهي الأشياء
    // الثلاثة التي تخصّ الشخص لا المركبة.
    // والتفويضُ مكتوبٌ في موضعين، فيُقرآن معًا:
    //
    //   ١) `VehicleMaster.authorizedPerson` — ورقةُ التفويض نفسُها التي تعرضها
    //      شاشة «التفاويض»: رقمُها ومدّتُها، مفتاحُها رقمُ الإقامة. مئتان
    //      واثنان وأربعون مركبة، منها ثمانٍ وخمسون بيد حاملي بطاقات السائقين.
    //   ٢) `VehicleAuthorization` — سجلُّ الإسناد بالموظّف من وحدة المركبات
    //      الأقدم، وفيه تاريخُ التسليم والتحويل.
    //
    // وهما عن الشيء نفسِه من وجهين، فيُدمجان بمفتاح اللوحة المطويّ ولا تُعرَض
    // المركبةُ الواحدة مرّتين. ولا يُوحَّد المصدران هنا: توحيدُ سجلَّين حيَّين
    // عملٌ قائمٌ بذاته، وأمّا السؤالُ المطروح — «ما الذي بيد هذا السائق؟» —
    // فجوابُه اجتماعُهما.
    const empIds = cards.map((c) => c.employee?._id).filter(Boolean);
    const idNumbers = cards.map((c) => String(c.idNumber || '').trim()).filter(Boolean);

    const [auths, masterAuths] = await Promise.all([
      empIds.length
        ? VehicleAuthorization.find({ employee: { $in: empIds }, status: 'active' })
          .populate('vehicle', 'plateNumber').select('employee vehicle startDate documentExpiry').lean()
        : [],
      idNumbers.length
        ? VehicleMaster.find({ 'authorizedPerson.iqamaNumber': { $in: idNumbers } })
          .select('plateNumber authorizedPerson').lean()
        : [],
    ]);

    const byEmp = new Map(); const byIqama = new Map();
    const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
    for (const a of auths) {
      push(byEmp, String(a.employee), {
        _id: String(a._id),
        source: 'assignment',
        vehicle: a.vehicle?._id ? String(a.vehicle._id) : null,
        plateNumber: a.vehicle?.plateNumber || '',
        startDate: a.startDate || '',
        expiryDate: a.documentExpiry || '',
        authorizationNumber: '',
      });
    }
    for (const v of masterAuths) {
      const ap = v.authorizedPerson || {};
      push(byIqama, String(ap.iqamaNumber || '').trim(), {
        _id: String(v._id),
        source: 'registry',
        vehicle: String(v._id),        // شاشةُ المركبة في السجلّ الحاليّ
        plateNumber: v.plateNumber || '',
        startDate: ap.startDate ? String(ap.startDate).slice(0, 10) : '',
        expiryDate: ap.expiryDate ? String(ap.expiryDate).slice(0, 10) : '',
        authorizationNumber: ap.authorizationNumber || '',
      });
    }

    cards = cards.map((c) => {
      const days = cardDaysLeft(c.expiryDate);
      // ── ورقةُ السجلّ أوّلًا، والإسنادُ بديلٌ لا شريك ────────────────────────
      //
      // السجلّان لا يتّفقان: أربعةَ عشرَ سائقًا يسمّي كلٌّ منهما له شاحنةً غير
      // التي يسمّيها الآخر، وبعضُها تبادلٌ صريح — «٥٠٩٦» عند هذا في السجلّ
      // و«٥٠٣٣» عند ذاك، ومقلوبةً عند الثاني. أي أنّ السائقين تبادلوا الشاحنات
      // وسجلُّ الإسناد لم يُحدَّث.
      //
      // فعرضُهما معًا يقول إنّ السائق يمسك شاحنتين وهو يمسك واحدة. وورقةُ
      // التفويض في سجلّ المركبات هي الوثيقةُ السارية — بها رقمُ التفويض
      // ومدّتُه وهي التي تُبرَز عند المرور. فإن وُجدت فهي الجواب وحدَها،
      // ولا يُقرأ سجلُّ الإسناد إلّا لمن لا ورقةَ له فيه.
      const fromRegistry = byIqama.get(String(c.idNumber || '').trim()) || [];
      const fromAssign = c.employee ? (byEmp.get(String(c.employee._id)) || []) : [];
      const authorizations = fromRegistry.length ? fromRegistry : fromAssign;
      return {
        ...c,
        daysLeft: days,
        state: cardState(days),
        authorizations,
        // ولا يُخفى الخلاف: الصفُّ يقول إنّ للسجلّ الأقدم رأيًا آخر، فيُراجَع.
        staleAssignments: fromRegistry.length
          ? fromAssign.filter((a) => !fromRegistry.some((r) => samePlate(r.plateNumber) === samePlate(a.plateNumber)))
            .map((a) => a.plateNumber).filter(Boolean)
          : [],
      };
    });
    // الشريحةُ تُفلتَر بعد الحساب: هي مشتقّةٌ من التاريخ لا حقلٌ في القاعدة.
    if (q.state) cards = cards.filter((c) => c.state === q.state);

    const count = (s) => cards.filter((c) => c.state === s).length;
    res.json({
      cards,
      totals: {
        total: cards.length,
        expired: count('expired'),
        critical: count('critical'),
        warning: count('warning'),
        valid: count('valid') + count('upcoming'),
        unlinked: cards.filter((c) => !c.employee).length,
        // خيانةُ الأمانة: «مطلوب» هو الرقمُ الذي يُقرأ — سائقٌ يعمل والوثيقةُ
        // لا تغطّيه. و«بلا جواب» ليس صفرًا: هو سؤالٌ لم يُسأل بعد.
        fidelityCovered: cards.filter((c) => c.fidelity?.status === 'covered').length,
        fidelityRequired: cards.filter((c) => c.fidelity?.status === 'required').length,
        fidelityUnknown: cards.filter((c) => !c.fidelity?.status).length,
        authorized: cards.filter((c) => (c.authorizations || []).length > 0).length,
      },
      // قيمُ الفلاتر تُبنى من السجلّ لا تُكتب يدًا.
      options: {
        logisticRegister: [...new Set(cards.map((c) => c.logisticRegister).filter(Boolean))],
        cardType: [...new Set(cards.map((c) => c.cardType).filter(Boolean))],
      },
    });
  } catch (e) {
    console.error('listDriverCards error:', e);
    res.status(500).json({ message: 'تعذّر تحميل بطاقات السائقين' });
  }
};

const CARD_FIELDS = ['idNumber', 'employee', 'name', 'dateOfBirth', 'absherPhone',
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
    // ولقطةُ البطاقة على ملفّ الموظّف تُحدَّث معها: تقرؤها شاشاتُ الموارد
    // البشريّة، وتركُها يجعل الرقمين مختلفين لشيءٍ واحد.
    if (card.employee) {
      const Employee = require('../models/Employee');
      await Employee.updateOne({ _id: card.employee }, {
        $set: {
          driverCardNumber: card.cardNumber || '',
          driverCardType: card.cardType || '',
          driverCardExpiry: card.expiryDate || '',
        },
      });
    }
    emit('vreg:updated', {});
    res.json({ card });
  } catch (e) { res.status(500).json({ message: e.message || 'تعذّر الحفظ' }); }
};

exports.deleteDriverCard = async (req, res) => {
  try {
    const card = await DriverCard.findByIdAndDelete(req.params.id);
    if (!card) return res.status(404).json({ message: 'غير موجودة' });
    emit('vreg:updated', {});
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ message: e.message || 'تعذّر الحذف' }); }
};
