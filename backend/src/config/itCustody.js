// مفردات عهد تقنية المعلومات: الدلاء الخمسة التي تُعرض بها العهدة، والنوع
// القياسي الذي يُكتب لكل دلو.
//
// السبب في وجود هذا الملف: سجل العهد كان يخزّن خمسة عشر نوعاً مفصّلاً وستة
// وستين اسماً حرّاً لأربعمئة صنف تقريباً — أسماء بالعربية وأخرى بالإنجليزية
// لنفس الجهاز، وأسماء تحمل الماركة وحدها. من دون طبقة تجميع ثابتة يستحيل
// عرض إجمالي صادق لكل فئة، ويصبح كل عدّ على الشاشة رهناً بما كتبه المُدخِل.
//
// الدلاء تُقرأ ولا تُكتب: النوع المفصّل يبقى كما هو في قاعدة البيانات حتى لا
// نفقد أن هذا «ماوس» وذاك «كيبورد»، والدلو يُشتق منه وقت العرض.

// شرائح الاتصال ليست من عهدة القسم — الخطوط ملك جهة أخرى — فهي مستبعدة من
// كل قوائم تقنية المعلومات. استبعادها هنا يمنع عودتها من أي مسار جديد يُضاف
// لاحقاً، لأن كل الشاشات تقرأ من هذه القائمة.
const EXCLUDED_TYPES = ['vehicle', 'tool', 'sim'];

const BUCKETS = [
  {
    key: 'laptops',
    nameAr: 'لابتوبات',
    nameEn: 'Laptops',
    // النوع الذي يُكتب عند إضافة صنف جديد من هذا الدلو.
    canonicalType: 'laptop',
    types: ['laptop', 'desktop'],
  },
  // ── والماوسُ دلوٌ وحدَه، والكيبوردُ وحدَه — ولا طقم ──────────────────────
  // كانا دلوًا واحدًا «ماوس وكيبورد». وفي المستودع ماوساتٌ بلا كيبورد
  // وكيبورداتٌ بلا ماوس (٩ ماوسات و٣٢ كيبوردًا بأنواعها المفصّلة)، فمن أراد
  // «أضِف ماوسًا» لم يجد تصنيفًا له إلّا الذي يكتبه «ماوس وكيبورد» — فيصير
  // الصنفُ الفردُ مكتوبًا طقمًا، ولا يُعرَف كم ماوسًا عندنا.
  //
  // ثمّ بقي «طقم ماوس وكيبورد» دلوًا ثالثًا مدّةً، وقرّر صاحبُ الشركة أنّ
  // الماوسَ والكيبوردَ غيرُ مرتبطين: يُسلَّم أحدُهما ويُرَدّ ويتلف وحدَه.
  // فقُسم كلُّ طقمٍ ماوسًا وكيبوردًا (scripts/splitKeyboardMouseSets.js) وأُلغي
  // الدلو. والنوعُ `keyboard_mouse` يبقى مقروءًا في دلو الكيبورد — لا يُكتب
  // جديدًا (راجع RETIRED_TYPES) — حتى إن بقي صفٌّ قديمٌ لم يُقسَم ظهر في العدّ
  // بشارة «ماوس وكيبورد» بدل أن يختفي.
  {
    key: 'mice',
    nameAr: 'ماوس',
    nameEn: 'Mouse',
    canonicalType: 'mouse',
    types: ['mouse'],
  },
  {
    key: 'keyboards',
    nameAr: 'كيبورد',
    nameEn: 'Keyboard',
    canonicalType: 'keyboard',
    types: ['keyboard', 'keyboard_mouse'],
  },
  {
    key: 'phones',
    nameAr: 'موبايلات',
    nameEn: 'Phones',
    canonicalType: 'phone',
    types: ['phone', 'tablet'],
  },
  {
    key: 'monitors',
    nameAr: 'شاشات',
    nameEn: 'Monitors',
    canonicalType: 'monitor',
    types: ['monitor'],
  },
  {
    key: 'other',
    nameAr: 'أخرى',
    nameEn: 'Other',
    canonicalType: 'other',
    // الشنط والكابلات والشواحن وما شابهها. الدلو مفتوح عمداً: أي نوع يُضاف من
    // البيانات المرجعية ولا ينتمي لدلو معروف يسقط هنا بدل أن يختفي من العدّ.
    types: ['laptop_bag', 'charger', 'cable', 'headset', 'printer', 'router', 'access_card', 'accessory', 'other'],
  },
];

const BUCKET_KEYS = BUCKETS.map((b) => b.key);

// أنواعٌ تُقرأ ولا تُكتب: صفوفُها القديمة تُعرض، ولا يُنشأ بها صنفٌ جديد ولا
// يُحوَّل إليها صنف. والقيمةُ رسالةُ الرفض.
const RETIRED_TYPES = {
  keyboard_mouse: 'لم يعد «طقم ماوس وكيبورد» صنفًا — سجّل الماوس والكيبورد كلًّا وحده.',
};

/**
 * رسالةُ الرفض إن كان الطلبُ يكتب نوعًا ملغًى، وإلّا null.
 * `currentType` نوعُ الصنف قبل التعديل: تعديلُ صفٍّ قديمٍ دون تغيير نوعه مقبول.
 */
const retiredTypeError = (type, currentType) => {
  const t = String(type || '').trim();
  if (!t || !RETIRED_TYPES[t]) return null;
  if (currentType && String(currentType).trim() === t) return null;
  return RETIRED_TYPES[t];
};

// خريطة نوع ← دلو، تُبنى مرة واحدة: الاشتقاق يُستدعى لكل صف في كل تحميل.
const TYPE_TO_BUCKET = new Map();
BUCKETS.forEach((b) => b.types.forEach((t) => TYPE_TO_BUCKET.set(t, b.key)));

/** الدلو الذي ينتمي إليه نوع مفصّل. أي نوع غير معروف يُحسب ضمن «أخرى». */
const bucketOf = (type) => TYPE_TO_BUCKET.get(String(type || '').trim()) || 'other';

/** الأنواع المفصّلة التي يغطيها دلو ما — تُستخدم للفلترة في الاستعلامات. */
const typesInBucket = (bucketKey) => {
  const b = BUCKETS.find((x) => x.key === bucketKey);
  return b ? b.types.slice() : [];
};

// أسماء الأنواع بالعربية لاشتقاق اسم العرض. مصدرها assetDefaults، لكنها
// مكرّرة هنا بالقدر اللازم فقط حتى لا يعتمد الاشتقاق على قراءة قاعدة البيانات
// في كل حفظ.
const TYPE_NAME_AR = {
  laptop: 'لابتوب',
  desktop: 'حاسب مكتبي',
  phone: 'موبايل',
  tablet: 'جهاز لوحي',
  monitor: 'شاشة',
  keyboard: 'كيبورد',
  mouse: 'ماوس',
  keyboard_mouse: 'ماوس وكيبورد', // نوعٌ ملغًى — للصفوف القديمة وحدها
  headset: 'سماعة رأس',
  printer: 'طابعة',
  router: 'راوتر',
  charger: 'شاحن',
  cable: 'كابل',
  laptop_bag: 'شنطة لابتوب',
  accessory: 'ملحق',
  access_card: 'بطاقة دخول',
  other: 'صنف آخر',
};

/**
 * اسم العرض مشتقّ من النوع والماركة بدل أن يُكتب باليد.
 *
 * الاسم الحرّ هو ما أنتج ستة وستين تهجئة لنفس الأجهزة — «Dell» و«لابتوب Dell»
 * و«Laptop HP» و«ASUS» كلها صفوف لنفس الفكرة. اشتقاق الاسم يجعل الصنف الواحد
 * يُكتب بطريقة واحدة مهما اختلف من يُدخله.
 */
const deriveAssetName = (type, brand) => {
  const base = TYPE_NAME_AR[String(type || '').trim()] || TYPE_NAME_AR.other;
  const b = String(brand || '').trim();
  return b ? `${base} ${b}` : base;
};

/**
 * توحيد كتابة الماركة. البيانات فيها Honor وHONOR وAsus وASUS وlogitech
 * وLogitech كصفوف منفصلة، وكل تجميع حسب الماركة كان ينقسم عليها.
 */
const normalizeBrand = (brand) => {
  const b = String(brand || '').trim().replace(/\s+/g, ' ');
  if (!b) return '';
  // الاختصارات التي تُكتب بحروف كبيرة دائماً تبقى كما هي.
  const UPPER = ['HP', 'MSI', 'LG', 'SMI', 'ASUS', 'AOC'];
  const hit = UPPER.find((u) => u.toLowerCase() === b.toLowerCase());
  if (hit) return hit;
  return b.charAt(0).toUpperCase() + b.slice(1).toLowerCase();
};

module.exports = {
  BUCKETS,
  BUCKET_KEYS,
  EXCLUDED_TYPES,
  bucketOf,
  typesInBucket,
  deriveAssetName,
  normalizeBrand,
  TYPE_NAME_AR,
  RETIRED_TYPES,
  retiredTypeError,
};
