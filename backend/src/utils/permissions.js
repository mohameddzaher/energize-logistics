// Resolves a role's section access from its RolePermission doc, with a short
// in-process cache (this runs on every gated API request). See config/sections.js
// for the model and the no-lockout guarantee.
const RolePermission = require('../models/RolePermission');
const { SECTIONS, SECTION_KEYS, defaultAccess } = require('../config/sections');
const { PAGES, PERSONAL_SECTIONS } = require('../config/pages');
const { FULL_ACCESS_ROLES } = require('../config/constants');
const { isScopedRole, scopeOf } = require('../config/scopedRoles');

// The cache is shared across both workers. It used to be a per-process Map with a 20s TTL and invalidate cleared only the worker that handled the save; prod runs two workers in rotation, so a granted section worked once and returned 403 the next. It now lives in the shared `ttlCache`, whose invalidation is stamped in the DB and reaches the other worker within a fraction of a second.
const cache = require('./ttlCache');

const TTL = 20 * 1000;
const PREFIX = 'perm:';

// the role is passed so it is read at the call site
// eslint-disable-next-line no-unused-vars
const invalidate = (role) => {
  // Cache the whole prefix, not one role: the map is 46 small records and working out which one a change affects costs more than re-reading them when needed.
  cache.clear(PREFIX);
};

/**
 * Roles created from the screen, asked about on every guarded call.
 * The answer decides whether the role inherits its section defaults or has only what was granted explicitly. See models/CustomRole.
 */
const customRoleKeys = async () => {
  const keys = await cache.wrap(`${PREFIX}custom`, TTL, async () => {
    try {
      const CustomRole = require('../models/CustomRole');
      const rows = await CustomRole.find({ isActive: true }).select('key').lean();
      return rows.map((r) => r.key);
    } catch (_) { return []; /* The index is unavailable now; treat as no custom roles. */ }
  });
  return new Set(keys || []);
};

const isCustomRole = async (role) => (await customRoleKeys()).has(String(role));

/** Roles that inherit nothing: screen-created roles and the section trainee (config/roles). They have no history in the role lists, so the matrix being silent means "nothing", not "as before". They get only what is opened from the permissions page, no section or page by default. */
const inheritsNothing = async (role) => require('../config/roles').isTrainee(String(role)) || isCustomRole(role);

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
/**
 * Finance roles (accountant, accounts manager, finance manager): a section opened to them, even view-only, is writable like for a system admin, because they answer for the numbers and must be able to correct them (config/financeAuthority).
 * This raises what was granted, never grants new: "none" stays none, and users/permissions stay behind the `strict` guard.
 */
const liftFinance = (role, access) =>
  (access === 'view' && require('../config/financeAuthority').isFinanceFull(role) ? 'edit' : access);

const getOverride = async (role, sectionKey) => {
  if (FULL_ACCESS_ROLES.includes(role)) return 'edit';
  const overrides = await getOverrides(role);
  if (Object.prototype.hasOwnProperty.call(overrides, sectionKey)) return liftFinance(role, overrides[sectionKey]);
  // A screen-created role does not inherit. A code-defined role has its section by default and `authorize` lists know it, so matrix silence means "as before". A created role has no past, so silence must mean none, or a new role would be born with access nobody granted.
  if (await inheritsNothing(role)) return 'none';
  return null;
};

/**
 * Effective sections for a given overrides set, with no DB read.
 * Read twice: here when computing the effective set, and in the controller on save to know what sections will be after the save. It is one function so the two calculations cannot diverge (they did once; see `pageFollowsSection` below).
 */
const resolveSections = (role, overrides, custom) => {
  const out = {};
  for (const k of SECTION_KEYS) {
    out[k] = liftFinance(role, Object.prototype.hasOwnProperty.call(overrides || {}, k)
      ? overrides[k]
      : (custom ? 'none' : defaultAccess(role, k)));
  }
  return out;
};

/**
 * Whether the page is open because it follows its section (no explicit tick).
 * Exported because the permissions screen used to repeat this rule when shrinking its payload to only what differs from the section. For a section not managed by the matrix (my profile, my leaves, settings, reports hub, executive view) the screen said open to all while the server said closed for created roles, so a tick on such a page matched the baseline, was not sent, and the server read it as closed. The shortcut now lives on the server using this same function, and the screen sends the map as the user sees it.
 */
const pageFollowsSection = (page, sections, custom) => {
  if (!Object.prototype.hasOwnProperty.call(sections || {}, page.section)) {
    // A personal (self-service) section is open to every internal role by default, even a created one. See `PERSONAL_SECTIONS` in config/pages.
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
  // A scoped role has no section and no matrix is read for it (config/scopedRoles).
  if (isScopedRole(role)) {
    for (const k of SECTION_KEYS) out[k] = 'none';
    return out;
  }
  return resolveSections(role, await getOverrides(role), await inheritsNothing(role));
};

/**
 * Pages allowed for this role: route to true/false for every page in the catalogue.
 * Explicit ticks are read as set; pages the matrix is silent on follow their section (allowed for whoever holds it). Silence means follow, not deny, or every page added later would vanish for every role until someone ticks it.
 */
const effectivePages = async (role) => {
  const out = {};
  if (FULL_ACCESS_ROLES.includes(role)) {
    for (const p of PAGES) out[p.key] = true;
    return out;
  }
  // Its pages are only what was written for it and everything else is closed, so `pageGate` opens its own screen's endpoints and closes the rest; it sees nothing else in the sidebar.
  const scoped = scopeOf(role);
  if (scoped) {
    for (const p of PAGES) out[p.key] = scoped.pages.includes(p.key);
    return out;
  }
  const { pages } = await getSaved(role);
  const sections = await effectivePermissions(role);
  const custom = await inheritsNothing(role);
  for (const p of PAGES) {
    if (Object.prototype.hasOwnProperty.call(pages, p.key)) { out[p.key] = pages[p.key]; continue; }
    // Pages the matrix is silent on follow their section (rule in `pageFollowsSection`). A section not managed by the matrix (home, tools, admin, self-service, portal) stays guarded by the older role lists, except a created role: no list knows it, so only what is ticked opens for it.
    out[p.key] = pageFollowsSection(p, sections, custom);
  }
  // The two wallet pages are always view-only for the collections section (config/walletViewOnly). They were open unless explicitly closed, but saving the page matrix writes every page into the role, so all operations pages including the wallet were saved as closed for collections staff. They are now always open; writes are rejected at the gate by role.
  const wv = require('../config/walletViewOnly');
  if (wv.isWalletViewOnly(role)) {
    for (const k of wv.WALLET_VIEW_PAGES) out[k] = true;
  }
  // The portal is a partner account's only screen: a saved matrix can never close it.
  // (Which tabs show is decided by the partner's services, see portalController.servicesFor.)
  if (role === 'client') {
    for (const p of PAGES) if (p.section === 'Portal') out[p.key] = true;
  }
  return out;
};

/**
 * Pages explicitly ticked open for this role, not those inherited from its section.
 * Sections not managed by the matrix (home, tools, admin, portal) have sidebars guarded by hand-written role lists. A created role ticked on "reports hub" got its API endpoints opened by the page guard but no sidebar link, since the old list does not know the role. Explicit ticks are therefore sent with the user and the sidebar prefers them over the list, which ages.
 */
const explicitlyGrantedPages = async (role) => {
  if (FULL_ACCESS_ROLES.includes(role)) return [];
  if (isScopedRole(role)) return [...scopeOf(role).pages];
  const { pages } = await getSaved(role);
  return Object.entries(pages || {}).filter(([, v]) => v).map(([k]) => k);
};

/** The same as a set; read on every guarded call, so it comes from the permissions cache. */
const explicitlyGrantedSet = async (role) => new Set(await explicitlyGrantedPages(role));

/** The first screen opened for this role, if one is configured. */
const homePageFor = async (role) => {
  if (FULL_ACCESS_ROLES.includes(role)) return '';
  if (isScopedRole(role)) return scopeOf(role).home;
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
 * hasSuperAdminPowers: a super admin, or a role granted full permissions.
 * Some actions belong only to the system admin (reopening a closed wallet day, editing or deleting a recorded entry), and the owner sometimes grants a role "edit" on every section meaning it to act as admin. So the definition is: `super_admin`, or a role whose matrix explicitly has "edit" on every section.
 * - Code defaults do not count, so a role never opened in the permissions screen is not admin.
 * - `FULL_ACCESS_ROLES` does not count: IT roles bypass the section guard to maintain the system, not to rewrite a financial ledger. - A section added later and not yet granted drops the role out of this set; failing safe is the intended direction. Uses the permissions cache itself, and invalidation on save reaches both workers: a role that loses a section loses this power immediately.
 */
const hasSuperAdminPowers = async (role) => {
  if (require('../config/constants').isTopRole(role)) return true;
  if (!role) return false;
  const overrides = await getOverrides(role);
  return SECTION_KEYS.length > 0
    && SECTION_KEYS.every((k) => overrides[k] === 'edit');
};

module.exports = {
  liftFinance,
  invalidate, getOverride, effectivePermissions, effectivePages, homePageFor,
  sectionForPath, getOverrides, isCustomRole, inheritsNothing, customRoleKeys, hasSuperAdminPowers,
  resolveSections, pageFollowsSection, explicitlyGrantedPages, explicitlyGrantedSet,
};
