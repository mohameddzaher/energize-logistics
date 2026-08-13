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
