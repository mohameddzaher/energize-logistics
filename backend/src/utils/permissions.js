// Resolves a role's section access from its RolePermission doc, with a short
// in-process cache (this runs on every gated API request). See config/sections.js
// for the model and the no-lockout guarantee.
const RolePermission = require('../models/RolePermission');
const { SECTIONS, SECTION_KEYS, defaultAccess } = require('../config/sections');
const { PAGES, PERSONAL_SECTIONS } = require('../config/pages');
const { FULL_ACCESS_ROLES } = require('../config/constants');

// ── والذاكرةُ مشتركةٌ بين العاملَين ──────────────────────────────────────────
//
// كانت هنا `Map` داخل العمليّة بمهلة عشرين ثانية، و`invalidate` تمسحها في
// العامل الذي عالج الحفظ وحدَه. والبرودكشن عاملان بالتناوب — فمن منح دورًا
// قسمًا رآه يعمل مرّةً ويردّ ٤٠٣ مرّة. أثبته الفحصُ الحيّ: النداءُ نفسُه بعد
// المنح مباشرةً ردّ `SECTION_FORBIDDEN` من عاملٍ و`SECTION_READ_ONLY` من الآخر
// في الثانية نفسِها — أي أنّ العاملَين اختلفا في **صلاحيّات** مستخدمٍ واحد.
//
// وهذه ثالثُ مرّةٍ يظهر فيها هذا الشكل (راجع two-workers-two-caches)، فلا
// تُصلَّح بذاكرةٍ ثالثةٍ خاصّة: تُوضع في `ttlCache` المشتركة، وإبطالُها يُختم في
// القاعدة فيعبر إلى العامل الآخر في أجزاءٍ من الثانية.
const cache = require('./ttlCache');

const TTL = 20 * 1000;
const PREFIX = 'perm:';

// eslint-disable-next-line no-unused-vars — الدورُ يُمرَّر ليُقرأ في موضع النداء
const invalidate = (role) => {
  // البادئةُ كلُّها لا دورٌ واحد: الخريطةُ ستّةٌ وأربعون سجلًّا صغيرًا، وحسابُ
  // أيِّها يتأثّر بتغيير الآخر أغلى من إعادة قراءتها عند الحاجة.
  cache.clear(PREFIX);
};

/**
 * الأدوارُ المصنوعة من الشاشة — يُسأل عنها في كلّ نداءٍ محروس.
 *
 * الجوابُ يقرّر أيرث الدورُ افتراضياتِ قسمِه أم لا يملك إلّا ما مُنح صراحةً.
 * راجع models/CustomRole.
 */
const customRoleKeys = async () => {
  const keys = await cache.wrap(`${PREFIX}custom`, TTL, async () => {
    try {
      const CustomRole = require('../models/CustomRole');
      const rows = await CustomRole.find({ isActive: true }).select('key').lean();
      return rows.map((r) => r.key);
    } catch (_) { return []; /* الفهرسُ غيرُ متاحٍ الآن — لا دورَ مصنوعًا اليوم */ }
  });
  return new Set(keys || []);
};

const isCustomRole = async (role) => (await customRoleKeys()).has(String(role));

// Raw saved doc for a role (empty when none). Cached across workers.
const getSaved = async (role) => cache.wrap(`${PREFIX}role:${role}`, TTL, async () => {
  const doc = await RolePermission.findOne({ role }).lean();
  const overrides = {};
  const pages = {};
  if (doc && doc.sections) {
    // lean() returns a Map as a plain object.
    for (const [k, v] of Object.entries(doc.sections)) overrides[k] = v;
  }
  if (doc && doc.pages) {
    for (const [k, v] of Object.entries(doc.pages)) pages[k] = !!v;
  }
  return { overrides, pages, homePage: (doc && doc.homePage) || '' };
});

const getOverrides = async (role) => (await getSaved(role)).overrides;

// Gate use: the explicit override for one section, or null when the role has no
// saved override for it (→ caller falls through to legacy authorize).
const getOverride = async (role, sectionKey) => {
  if (FULL_ACCESS_ROLES.includes(role)) return 'edit';
  const overrides = await getOverrides(role);
  if (Object.prototype.hasOwnProperty.call(overrides, sectionKey)) return overrides[sectionKey];
  // ── والدورُ المصنوعُ لا يرث ────────────────────────────────────────────────
  // الدورُ المكتوبُ في الشيفرة له قسمُه افتراضيًّا وقوائمُ `authorize` تعرفه،
  // فسكوتُ المصفوفة عنه يعني «كما كان». والمصنوعُ لا ماضيَ له: سكوتُها عنه
  // يجب أن يعني **لا شيء**، وإلّا وُلد دورٌ جديدٌ يملك ما لم يُمنَح.
  if (await isCustomRole(role)) return 'none';
  return null;
};

/**
 * الأقسامُ السارية لمجموعةِ تجاوزاتٍ معيّنة — بلا قراءةٍ من القاعدة.
 *
 * تُقرأ مرّتين: هنا عند حساب الساري، وفي المتحكّم عند الحفظ ليعرف ما الذي
 * ستصير عليه الأقسامُ **بعد** هذا الحفظ. ولذلك هي دالّةٌ واحدة: لو حسبها كلٌّ
 * منهما على حدةٍ لافترق الحسابان يومًا — وقد افترقا فعلًا (راجع
 * `pageFollowsSection` تحت).
 */
const resolveSections = (role, overrides, custom) => {
  const out = {};
  for (const k of SECTION_KEYS) {
    out[k] = Object.prototype.hasOwnProperty.call(overrides || {}, k)
      ? overrides[k]
      : (custom ? 'none' : defaultAccess(role, k));
  }
  return out;
};

/**
 * هل هذه الصفحةُ مفتوحةٌ **اتّباعًا لقسمها** (أي بلا تأشيرةٍ صريحة)؟
 *
 * ── ولماذا هي دالّةٌ مُصدَّرة ────────────────────────────────────────────────
 * كان هذا السطرُ مكتوبًا مرّتين: هنا، وفي شاشةِ الصلاحيّات التي تختصر ما
 * ترسله إلى «ما يخالف قسمَه وحدَه». واختلفا في حالةٍ واحدة: قسمٌ غيرُ مُدارٍ
 * بالمصفوفة (ملفي، إجازاتي، طلباتي، الإعدادات، مركزُ التقارير، النظرةُ
 * التنفيذيّة…) تقول عنه الشاشةُ «مفتوحٌ للجميع» ويقول عنه الخادمُ «مغلقٌ على
 * الدور المصنوع». فمن أشّر لمتدرّبٍ على «ملفي» حسبت الشاشةُ أنّ التأشيرةَ
 * تطابق الأصلَ فلم ترسلها، وقرأها الخادمُ مغلقةً: تختفي العلامةُ بعد حفظٍ
 * قال «تمّ»، ولا تُفتَح الصفحة.
 *
 * فصار الاختصارُ في الخادم بهذه الدالّة نفسِها، ولم يبقَ للشاشة رأيٌ في
 * القاعدة: ترسل الخريطةَ كما يراها المستخدمُ ويختصرها مَن يملك القاعدة.
 */
const pageFollowsSection = (page, sections, custom) => {
  if (!Object.prototype.hasOwnProperty.call(sections || {}, page.section)) {
    // قسمٌ شخصيٌّ (الخدمةُ الذاتيّة) أصلُه مفتوحٌ لكلّ دورٍ داخليّ ولو كان
    // مصنوعًا — راجع `PERSONAL_SECTIONS` في config/pages.
    if (PERSONAL_SECTIONS.has(page.section)) return true;
    return !custom;
  }
  return sections[page.section] === 'view' || sections[page.section] === 'edit';
};

// Effective access for EVERY managed section (override or current default).
// Used by getMe (drives the sidebar) and the permissions page display.
const effectivePermissions = async (role) => {
  const out = {};
  if (FULL_ACCESS_ROLES.includes(role)) {
    for (const k of SECTION_KEYS) out[k] = 'edit';
    return out;
  }
  return resolveSections(role, await getOverrides(role), await isCustomRole(role));
};

/**
 * الصفحاتُ المسموحةُ لهذا الدور — مسارٌ ← صواب/خطأ لكلّ صفحةٍ في الفهرس.
 *
 * القاعدةُ سطران:
 *   • ما أُشِّر عليه صراحةً يُقرأ كما أُشِّر.
 *   • وما سكتت عنه المصفوفةُ يتبع قسمَه: مسموحٌ لمن يملك القسم.
 *
 * والسكوتُ يعني الاتّباعَ لا المنع — وإلّا اختفت كلُّ صفحةٍ تُولَد غدًا عن كلّ
 * دورٍ حتّى يفتح أحدٌ الشاشةَ ويؤشّر عليها، وهو عطبٌ صامتٌ لا يُشتكى منه إلّا
 * بعد أسبوع.
 */
const effectivePages = async (role) => {
  const out = {};
  if (FULL_ACCESS_ROLES.includes(role)) {
    for (const p of PAGES) out[p.key] = true;
    return out;
  }
  const { pages } = await getSaved(role);
  const sections = await effectivePermissions(role);
  const custom = await isCustomRole(role);
  for (const p of PAGES) {
    if (Object.prototype.hasOwnProperty.call(pages, p.key)) { out[p.key] = pages[p.key]; continue; }
    // وما سكتت عنه المصفوفةُ يتبع قسمَه — والقاعدةُ في `pageFollowsSection`:
    // قسمٌ غيرُ مُدارٍ بالمصفوفة (الرئيسية، الأدوات، الإدارة، الخدمة الذاتيّة،
    // البوابة) تحرسه قوائمُ الأدوار القديمة كما كانت، إلّا الدورَ المصنوع فلا
    // تعرفه قائمةٌ ولا يُفتَح له إلّا ما أُشِّر عليه.
    out[p.key] = pageFollowsSection(p, sections, custom);
  }
  return out;
};

/**
 * ما أُشِّر عليه صراحةً مفتوحًا لهذا الدور — لا ما وُرث عن قسمه.
 *
 * ── ولماذا تحتاجه الواجهة ───────────────────────────────────────────────────
 * الأقسامُ غيرُ المُدارة بالمصفوفة (الرئيسيّة، الأدوات، الإدارة، البوابة) يحرس
 * شريطُها قوائمَ أدوارٍ مكتوبةً باليد. فمن أشّر لدورٍ مصنوعٍ على «مركز
 * التقارير» في المصفوفة فُتحت له نقاطُ الـ API (حارسُ الصفحات يسمح) ولم يظهر
 * له رابطٌ في الشريط: قائمةٌ قديمةٌ لا تعرف دورَه. فصار «لا يُفتَح له» بلا
 * سببٍ ظاهر.
 *
 * فتُرسَل التأشيراتُ الصريحةُ مع المستخدم، والشريطُ يقدّمها على القائمة: ما
 * أشّر عليه صاحبُ النظام قصدَه، والقائمةُ تشيخ.
 */
const explicitlyGrantedPages = async (role) => {
  if (FULL_ACCESS_ROLES.includes(role)) return [];
  const { pages } = await getSaved(role);
  return Object.entries(pages || {}).filter(([, v]) => v).map(([k]) => k);
};

/** أوّلُ شاشةٍ تُفتَح لصاحب هذا الدور، إن ضُبطت له واحدة. */
const homePageFor = async (role) => {
  if (FULL_ACCESS_ROLES.includes(role)) return '';
  return (await getSaved(role)).homePage || '';
};

// Map an incoming request path to the section that owns it (or null).
const sectionForPath = (path) => {
  for (const s of SECTIONS) {
    if (s.apiPrefixes.some((p) => path === p || path.startsWith(p + '/'))) return s;
  }
  return null;
};

/**
 * hasSuperAdminPowers — مديرُ النظام، أو دورٌ مُنح صلاحيّاتِه كاملةً.
 *
 * ── ولماذا يُقرأ من المصفوفة لا من قائمة ────────────────────────────────────
 * بعضُ الأفعال لا يملكها إلّا مديرُ النظام: إعادةُ فتح يومٍ أُقفل في المحفظة،
 * وتعديلُ قيدٍ مسجَّلٍ أو حذفُه. وصاحبُ النظام يمنح أحيانًا دورًا كلَّ شيءٍ من
 * شاشة الصلاحيّات — «تعديل» على كلّ قسم — ويقصد به أن يكون كمدير النظام.
 *
 * فالتعريفُ: `super_admin`، أو دورٌ حفظت له المصفوفةُ «تعديل» على **كلّ** قسمٍ
 * صراحةً. والكلمةُ «صراحةً» مقصودة:
 *   • لا تُحسَب الافتراضيّات: دورٌ لم يُفتَح له بابُ الصلاحيّات قطّ لا يصير
 *     مديرًا للنظام لأنّ افتراضاتِ الشيفرة سخيّة.
 *   • ولا `FULL_ACCESS_ROLES`: أدوارُ تقنية المعلومات تتجاوز حارسَ الأقسام لأنّها
 *     تصون النظام، لا لأنّ لها أن تعيد كتابةَ دفترٍ ماليّ.
 *   • وقسمٌ يُضاف غدًا ولم يُمنَح بعدُ يُسقط الدورَ من هذه الدائرة حتى يُمنَحه —
 *     والأمانُ في هذا الاتّجاه، لا في عكسه.
 *
 * والذاكرةُ هي ذاكرةُ الصلاحيّات نفسُها، وإبطالُها عند الحفظ يعبر إلى العاملين:
 * من يُسحب منه قسمٌ يفقد هذه الصلاحيّة في الحال.
 */
const hasSuperAdminPowers = async (role) => {
  if (role === 'super_admin') return true;
  if (!role) return false;
  const overrides = await getOverrides(role);
  return SECTION_KEYS.length > 0
    && SECTION_KEYS.every((k) => overrides[k] === 'edit');
};

module.exports = {
  invalidate, getOverride, effectivePermissions, effectivePages, homePageFor,
  sectionForPath, getOverrides, isCustomRole, customRoleKeys, hasSuperAdminPowers,
  resolveSections, pageFollowsSection, explicitlyGrantedPages,
};
