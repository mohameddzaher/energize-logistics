// Per-section authorization gate. Mounted on a section's API prefixes in
// server.js: app.use('/api/hr', sectionGate('HR'), hrRoutes).
//
// Behaviour (see config/sections.js for the full model):
//   • super_admin            → always allowed (stamps edit).
//   • no saved override      → next() (legacy authorize() lists decide — no
//                              behaviour change, no lockout risk).
//   • override 'none'        → 403 for everything.
//   • override 'view'        → GET/HEAD allowed, writes 403.
//   • override 'view'/'edit' → stamps req.sectionAccess so authorize() can grant
//                              a role that isn't in a route's legacy list.
// Resolver errors fail OPEN (fall through to legacy authorize) to avoid locking
// users out on a transient DB issue.
const { getOverride } = require('../utils/permissions');
const { getSection } = require('../config/sections');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// HR self-service paths (relative to the /api/hr mount) are used by every logged
// in user for their own profile/leaves/requests and by managers acting on their
// team. They must stay open even when back-office HR access is removed.
const hrSelfServiceExempt = (req) => {
  const p = req.path || '';
  if (p.startsWith('/me') || p.startsWith('/team')) return true;
  if (req.method === 'GET' && p === '/leave-types') return true;
  if (/^\/leaves\/[^/]+\/decision$/.test(p)) return true;
  if (/^\/requests\/[^/]+\/reply$/.test(p)) return true;
  if (req.method === 'GET' && /^\/employees\/[^/]+$/.test(p)) return true;
  return false;
};

const sectionGate = (sectionKey) => {
  const section = getSection(sectionKey);
  const exempt = section && section.exemptSelfService ? hrSelfServiceExempt : null;
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Authentication required' });
      if (req.user.role === 'super_admin') { req.sectionAccess = 'edit'; return next(); }
      if (exempt && exempt(req)) return next();

      const access = await getOverride(req.user.role, sectionKey); // 'none'|'view'|'edit'|null
      if (access == null) return next(); // no override → legacy authorize decides

      if (access === 'none') {
        return res.status(403).json({ message: 'No access to this section', code: 'SECTION_FORBIDDEN' });
      }
      if (access === 'view' && !READ_METHODS.has(req.method)) {
        return res.status(403).json({ message: 'Read-only access to this section', code: 'SECTION_READ_ONLY' });
      }
      req.sectionAccess = access; // 'view' or 'edit'
      next();
    } catch (e) {
      next(); // fail-open
    }
  };
};

module.exports = sectionGate;
