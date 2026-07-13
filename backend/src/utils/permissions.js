// Resolves a role's section access from its RolePermission doc, with a short
// in-process cache (this runs on every gated API request). See config/sections.js
// for the model and the no-lockout guarantee.
const RolePermission = require('../models/RolePermission');
const { SECTIONS, SECTION_KEYS, defaultAccess } = require('../config/sections');
const { FULL_ACCESS_ROLES } = require('../config/constants');

const TTL = 20 * 1000;
const cache = new Map(); // role -> { overrides: {sectionKey: level}, expires }

const invalidate = (role) => {
  if (role) cache.delete(String(role));
  else cache.clear();
};

// Raw saved overrides for a role ({} when no doc). Cached.
const getOverrides = async (role) => {
  const key = String(role);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.overrides;
  const doc = await RolePermission.findOne({ role }).lean();
  const overrides = {};
  if (doc && doc.sections) {
    // lean() returns a Map as a plain object.
    for (const [k, v] of Object.entries(doc.sections)) overrides[k] = v;
  }
  cache.set(key, { overrides, expires: Date.now() + TTL });
  return overrides;
};

// Gate use: the explicit override for one section, or null when the role has no
// saved override for it (→ caller falls through to legacy authorize).
const getOverride = async (role, sectionKey) => {
  if (FULL_ACCESS_ROLES.includes(role)) return 'edit';
  const overrides = await getOverrides(role);
  return Object.prototype.hasOwnProperty.call(overrides, sectionKey) ? overrides[sectionKey] : null;
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
  for (const k of SECTION_KEYS) {
    out[k] = Object.prototype.hasOwnProperty.call(overrides, k) ? overrides[k] : defaultAccess(role, k);
  }
  return out;
};

// Map an incoming request path to the section that owns it (or null).
const sectionForPath = (path) => {
  for (const s of SECTIONS) {
    if (s.apiPrefixes.some((p) => path === p || path.startsWith(p + '/'))) return s;
  }
  return null;
};

module.exports = { invalidate, getOverride, effectivePermissions, sectionForPath, getOverrides };
