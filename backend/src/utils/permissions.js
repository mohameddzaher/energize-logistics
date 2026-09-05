// Resolves a role's section access from its RolePermission doc, with a short
// in-process cache (this runs on every gated API request). See config/sections.js
// for the model and the no-lockout guarantee.
const RolePermission = require('../models/RolePermission');
const { SECTIONS, SECTION_KEYS, defaultAccess } = require('../config/sections');
const { PAGES } = require('../config/pages');
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

// Effective access for EVERY managed section (override or current default).
// Used by getMe (drives the sidebar) and the permissions page display.
const effectivePermissions = async (role) => {
  const out = {};
  if (FULL_ACCESS_ROLES.includes(role)) {
    for (const k of SECTION_KEYS) out[k] = 'edit';
    return out;
  }
  const overrides = await getOverrides(role);
  const custom = await isCustomRole(role);
  for (const k of SECTION_KEYS) {
    out[k] = Object.prototype.hasOwnProperty.call(overrides, k)
      ? overrides[k]
      : (custom ? 'none' : defaultAccess(role, k));
  }
  return out;
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
    // قسمٌ غيرُ مُدارٍ بالمصفوفة (الرئيسية، الأدوات، الإدارة، الخدمة الذاتيّة،
    // البوابة): تحرسه قوائمُ الأدوار القديمة كما كانت، فلا تُخفيه الصفحاتُ عمّن
    // كان يراه. إلّا الدورَ المصنوع — فذاك لا تعرفه قائمةٌ، ولا يُفتَح له إلّا
    // ما أُشِّر عليه.
    if (!Object.prototype.hasOwnProperty.call(sections, p.section)) { out[p.key] = !custom; continue; }
    out[p.key] = sections[p.section] === 'view' || sections[p.section] === 'edit';
  }
  return out;
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

module.exports = {
  invalidate, getOverride, effectivePermissions, effectivePages, homePageFor,
  sectionForPath, getOverrides, isCustomRole, customRoleKeys,
};
