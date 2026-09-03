// The one rule for matching a vehicle across the two systems that describe it.
//
// The workshop registers assets against a bare fleet number ("2708"); the live
// Wialon mirror names the same truck "ق ن ر 2708" or "3449 JTA محمد عباس" —
// Arabic letters, Latin letters, the driver's name, any order. Reducing both to
// their digits is what makes them the same key.
//
// Kept here rather than in a controller because BOTH the ls2 asset registry and
// the workshop store join on it: two copies of this rule silently drifting apart
// would show a tire as unassigned on one screen and fitted on the other.
//
// "ق ن ر 2708" / "2708" / "٢٧٠٨" → "2708". A plate with no digits at all
// ("TR1") falls back to its uppercased text so it still matches itself.
const plateKey = (p) => {
  if (p == null) return null;
  const west = String(p).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const digits = (west.match(/\d+/g) || []).join('');
  return digits || west.trim().toUpperCase() || null;
};

// A live Wialon vehicle carries its plate in `plate` or, for older units, only
// inside `name` — try both, in that order.
const vehiclePlateKey = (v) => (v ? plateKey(v.plate) || plateKey(v.name) : null);

// ── ولماذا مفتاح ثانٍ؟ ───────────────────────────────────────────────────────
//
// المفتاح فوق يُسقِط الحروف عمدًا، لأن Wialon يكتب اسم الشاحنة بصيغ لا تُحصى
// وأرقام أسطولنا الثقيل (٦١ شاحنة) فريدة بأرقامها وحدها.
//
// أما سجل المركبات فيضمّ ٣٣٤ مركبة بينها ٢١٢ دراجة، وهناك الأرقام **تتصادم**:
// «ل أ 1080» دراجة، و«أ ص ر 1080» تريلا من أسطولنا — ومفتاح الأرقام يجعلهما
// مركبة واحدة، فتُقيَّد حادثة الدراجة على التريلا. أحد عشر تصادمًا من هذا النوع
// في الملف الحالي، وصفر تصادم حين تدخل الحروف في المفتاح.
//
// فالفرق ليس إهمالًا: كل مفتاح يخدم مجالًا اختلفت فيه شروط التفرّد. وتوحيدهما
// في واحد يكسر أحد الجانبين حتمًا — ولذلك يعيشان هنا معًا وبسببهما مكتوبًا.
const registryPlateKey = (p) => {
  if (p == null) return null;
  const west = String(p).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const k = west
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[ؤئ]/g, 'ي').replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[^\u0621-\u064A0-9A-Za-z]/g, '')
    .toUpperCase();
  return k || null;
};

module.exports = { plateKey, vehiclePlateKey, registryPlateKey };

/**
 * تعبيرٌ نمطيّ لا يبالي بعدد المسافات.
 *
 * لوحةُ السعودية ثلاثةُ حروفٍ ورقم؛ والدبّابات والمقطورات حرفان، فيُترك موضع
 * الثالث فارغًا — «أ ب  3499» بمسافتين. ونحن نخزّن اللوحة بمسافةٍ واحدة، بينما
 * الموظّف ينسخ اللوحة من أبشر أو من شيتٍ آخر فتصل بمسافتين، فلا يطابق شيءٌ
 * شيئًا وتخرج الشاشة فارغة — فيمسح مسافةً بيده ليجد ما يبحث عنه.
 *
 * فكلُّ فراغٍ في نصّ البحث يصير «صفرًا فأكثر من الفراغ»: تُطابَق اللوحة بمسافةٍ
 * أو بمسافتين أو بلا مسافةٍ إطلاقًا، ولا يُطلب من أحدٍ أن يعرف كيف كُتبت.
 */
const flexSpaceRegex = (s, flags = 'i') => {
  // الفراغ يُنزع من نصّ البحث كلّه ثم يُسمَح به بين كلّ حرفين. فلا يهمّ أكتبها
  // «ح أ 3505» أم «ح أ  3505» أم «حأ3505» — الثلاثة تصل إلى الصفّ نفسه. والقيد
  // في الاتجاه الآخر أيضًا: مَن يكتب بلا فراغٍ يجد ما خُزّن بفراغ.
  //
  // ومع الفراغ تُطوى فروقُ الرسم العربيّ: الهمزةُ تُكتب «أحمد» و«احمد»، والتاءُ
  // المربوطة تُنسخ من أبشر «ة» وتُكتب في الشيت «ه». ومَن يبحث لا يعرف بأيّهما
  // خُزّن الصفّ — فيبحث مرّتين أو يستسلم. فكلُّ حرفٍ يصير صنفًا يقبل أشباهه.
  const bare = String(s || '').replace(/\s+/g, '');
  if (!bare) return new RegExp('(?:)', flags);
  const parts = [...bare].map((ch) => {
    const cls = FOLD_CLASSES[ch];
    if (cls) return cls;
    return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp(parts.join('[\\s\u064B-\u0652\u0640]*'), flags);
};

// أصنافُ الحروف المتشابهة رسمًا. تُبنى مرّةً لا عند كلّ بحث.
const FOLD_GROUPS = [
  'اأإآٱ', 'هة', 'يىئ', 'وؤ', '٠0', '١1', '٢2', '٣3', '٤4', '٥5', '٦6', '٧7', '٨8', '٩9',
];
const FOLD_CLASSES = {};
for (const g of FOLD_GROUPS) for (const ch of g) FOLD_CLASSES[ch] = `[${g}]`;

/**
 * نظيرُ `flexSpaceRegex` للمطابقة في الذاكرة.
 *
 * بعضُ قوائم القسم تُجلب كاملةً من الكاش ثمّ تُفلتر في العقدة بـ`includes` —
 * وهي مطابقةٌ حرفيّةٌ لا تتسامح مع مسافةٍ زائدةٍ ولا همزةٍ ناقصة، فيبحث الموظّف
 * عن اللوحة نفسِها التي يراها أمامه فلا يجدها. فتُطبَّق القاعدةُ نفسُها هنا.
 */
const flexNormalize = (v) => String(v == null ? '' : v)
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[أإآٱ]/g, 'ا').replace(/[ةه]/g, 'ه').replace(/[ىئي]/g, 'ي').replace(/[ؤو]/g, 'و')
  .replace(/[\u064B-\u0652\u0640]/g, '')
  .replace(/\s+/g, '')
  .toLowerCase();

/** هل يحوي أيٌّ من الحقول نصَّ البحث، بعد طيّ المسافات وفروق الرسم؟ */
const flexIncludes = (needle, ...fields) => {
  const n = flexNormalize(needle);
  if (!n) return true;
  return fields.some((f) => flexNormalize(f).includes(n));
};

/**
 * ── الرقمُ الكامل يُطلَب كاملًا ───────────────────────────────────────────────
 *
 * `flexSpaceRegex` مطابقةٌ بالتضمين، وهي الصحيحةُ للّوحات والأسماء: من يكتب
 * جزءًا من لوحةٍ يريد ما يحويه. لكنّ رقم الفاتورة يُكتب كاملًا ويُقصَد به هو
 * نفسُه — ومطابقةُ التضمين تجعل البحثَ عن «٩٧١٩» يُخرج ستّةَ صفوفٍ في فاتورتين:
 * الفاتورةَ ٩٧١٩، وكشفًا رقمُه ٩٧١٩، وسندًا رقمُه ٩٧١٩ تحت الفاتورة ٩٦٦٩.
 * فيظنّ الموظّفُ أنّ للفاتورة نسخًا وهي واحدة.
 *
 * فالقاعدةُ هنا مبنيّةٌ على طول الرقم: أرقامُ الفواتير والكشوف والسندات عندنا
 * أربعُ خاناتٍ فأكثر، فمن كتب أربعًا فقد كتب رقمًا كاملًا يقصده بعينه. ومن كتب
 * خانةً أو خانتين فهو يستكشف، والتضمينُ هو ما يريد.
 *
 * تُعيد `{ exact, loose }` — و`exact` فارغةٌ حين لا يكون النصُّ رقمًا كاملًا،
 * فيُستعمَل `exact || loose` بلا شرطٍ عند النداء.
 */
const numberSearchRegex = (s) => {
  const bare = String(s || '').trim();
  const loose = flexSpaceRegex(bare);
  if (!/^[\d٠-٩\s]+$/.test(bare)) return { exact: null, loose };
  const digits = bare.replace(/\s/g, '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  if (digits.length < 4) return { exact: null, loose };
  return { exact: new RegExp(`^\\s*${digits}\\s*$`), loose };
};

module.exports.numberSearchRegex = numberSearchRegex;

module.exports.flexSpaceRegex = flexSpaceRegex;
module.exports.flexNormalize = flexNormalize;
module.exports.flexIncludes = flexIncludes;
