// Resolves a role's section access from its RolePermission doc, with a short
// in-process cache (this runs on every gated API request). See config/sections.js
// for the model and the no-lockout guarantee.
const RolePermission = require('../models/RolePermission');
const { SECTIONS, SECTION_KEYS, defaultAccess } = require('../config/sections');
const { PAGES } = require('../config/pages');
const { FULL_ACCESS_ROLES } = require('../config/constants');

const TTL = 20 * 1000;
const cache = new Map(); // role -> { overrides, pages, homePage, expires }

// ── الأدوارُ المصنوعة من الشاشة ──────────────────────────────────────────────
// تُقرأ مرّةً وتُحفَظ: كلُّ نداءٍ محروسٍ يسأل «أهذا الدورُ مصنوع؟»، والجوابُ يقرّر
// أيرث افتراضياتِ قسمِه أم لا يملك إلّا ما مُنح صراحةً. راجع models/CustomRole.
let customCache = { keys: new Set(), expires: 0 };

const invalidate = (role) => {
  if (role) cache.delete(String(role));
  else cache.clear();
  customCache = { keys: new Set(), expires: 0 };
};

const customRoleKeys = async () => {
  if (customCache.expires > Date.now()) return customCache.keys;
  let keys = new Set();
  try {
    const CustomRole = require('../models/CustomRole');
    const rows = await CustomRole.find({ isActive: true }).select('key').lean();
    keys = new Set(rows.map((r) => r.key));
  } catch (_) { /* الفهرسُ غيرُ متاحٍ الآن — لا دورَ مصنوعًا اليوم */ }
  customCache = { keys, expires: Date.now() + TTL };
  return keys;
};

const isCustomRole = async (role) => (await customRoleKeys()).has(String(role));

// Raw saved doc for a role (empty when none). Cached.
const getSaved = async (role) => {
  const key = String(role);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit;
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
  const entry = { overrides, pages, homePage: (doc && doc.homePage) || '', expires: Date.now() + TTL };
  cache.set(key, entry);
  return entry;
};

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
