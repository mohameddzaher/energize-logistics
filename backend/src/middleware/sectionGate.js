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
const { getOverride, liftFinance } = require('../utils/permissions');
const { getSection, defaultAccess } = require('../config/sections');
const { FULL_ACCESS_ROLES } = require('../config/constants');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Bulk PDFs are POST only because the id list is too long for a URL; rendering a file writes nothing, so view access may call them.
const isRead = (req) => READ_METHODS.has(req.method) || (req.method === 'POST' && /\.pdf$/i.test(req.path || ''));

// HR self-service paths (relative to the /api/hr mount) are used by every logged
// in user for their own profile/leaves/requests and by managers acting on their
// team. They must stay open even when back-office HR access is removed.
const hrSelfServiceExempt = (req) => {
  const p = req.path || '';
  if (p.startsWith('/me') || p.startsWith('/team')) return true;
  if (req.method === 'GET' && p === '/leave-types') return true;
  // Leave approval inbox and its counter, and a single leave (for the PDF): the controller builds the query from the reader's stages and checks the requester. These were outside this list, so a department manager saved with HR "none" never saw their team's requests.
  if (req.method === 'GET' && /^\/leaves\/inbox(\/count)?$/.test(p)) return true;
  if (req.method === 'GET' && /^\/leaves\/[0-9a-f]{24}$/i.test(p)) return true;
  if (/^\/leaves\/[^/]+\/decision$/.test(p)) return true;
  if (/^\/requests\/[^/]+\/reply$/.test(p)) return true;
  if (req.method === 'GET' && /^\/employees\/[^/]+$/.test(p)) return true;
  return false;
};

const sectionGate = (sectionKey) => {
  const section = getSection(sectionKey);
  const exempt = section && section.exemptSelfService ? hrSelfServiceExempt : null;
  const guard = async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Authentication required' });
      if (FULL_ACCESS_ROLES.includes(req.user.role)) { req.sectionAccess = 'edit'; return next(); }
      // An exemption lifts the denial but does not skip the stamp. These paths are exempt so every employee can read their own file and leaves without being in HR. The exemption used to skip the guard entirely, so the controller received no `sectionAccess`, and it reads the stamp to know who was granted the section from the matrix. Someone whose access came from a grant rather than a role (a finance manager granted HR edit) was read as foreign to the section: the list opened and search found the employee, but opening him said "no data". Seen in production: `GET /employees` 200 and `GET /employees/:id` 403 for the same role at the same moment.
      // So a grant is stamped if present, and denial never applies on these paths.
      if (exempt && exempt(req)) {
        try {
          const g = await getOverride(req.user.role, sectionKey);
          const a = g == null ? liftFinance(req.user.role, defaultAccess(req.user.role, sectionKey)) : g;
          if (a === 'view' || a === 'edit') req.sectionAccess = a;
        } catch (e) { /* The exemption passes without a stamp. */ }
        return next();
      }

      let access = await getOverride(req.user.role, sectionKey); // 'none'|'view'|'edit'|null
      if (access == null) {
        // No saved override, so use the section's default access. This is what makes "section manager and staff have their section" (config/roles.js) work on the API and not only decorate the sidebar; without it a new role would open the section in the menu and get 403 from every endpoint inside.
        const fallback = liftFinance(req.user.role, defaultAccess(req.user.role, sectionKey));
        // Only widens, never narrows: if the default is 'none' we do not reject here and leave the old authorize lists to decide as before, so nobody loses access they had.
        if (fallback === 'none') return next();
        access = fallback;
      }

      if (access === 'none') {
        return res.status(403).json({ message: 'No access to this section', code: 'SECTION_FORBIDDEN' });
      }
      if (access === 'view' && !isRead(req)) {
        return res.status(403).json({ message: 'Read-only access to this section', code: 'SECTION_READ_ONLY' });
      }
      req.sectionAccess = access; // 'view' or 'edit'
      next();
    } catch (e) {
      next(); // fail-open
    }
  };
  // The guard describes itself; the docs generator reads it from the router. See `services/apiDocs`.
  guard.__section = (section && section.key) || sectionKey;
  return guard;
};

/**
 * Grants but never denies. Some records are written by more than one section (suppliers by operations and purchasing, drivers by operations), so one section cannot guard them.
 * A custom role granted operations edit was rejected because `authorize` reads a role list without it and the route stamps no `req.sectionAccess`: the button showed and saving was refused.
 * This stamps access and rejects nobody: edit in a listed section passes, otherwise the `authorize` list decides as before.
 */
const stampSection = (...sectionKeys) => async (req, res, next) => {
  try {
    if (!req.user) return next();
    if (FULL_ACCESS_ROLES.includes(req.user.role)) { req.sectionAccess = 'edit'; return next(); }
    let best = null;
    for (const key of sectionKeys) {
      const saved = await getOverride(req.user.role, getSection(key)?.key || key);
      if (saved === 'edit') { best = 'edit'; break; }
      if (saved === 'view' && best !== 'edit') best = 'view';
    }
    // With no saved matrix, the default applies as in `sectionGate`: it grants and never denies. Otherwise a role whose default is edit (the data team) would be rejected from a shared record it has nothing saved for.
    if (!best) {
      for (const key of sectionKeys) {
        const k = getSection(key)?.key || key;
        if ((await getOverride(req.user.role, k)) != null) continue;
        const d = liftFinance(req.user.role, defaultAccess(req.user.role, k));
        if (d === 'edit') { best = 'edit'; break; }
        if (d === 'view') best = 'view';
      }
    }
    if (best) req.sectionAccess = best;
    return next();
  } catch (e) {
    return next(); // The stamp is a convenience, not a requirement.
  }
};

/**
 * What only the section itself may read. `sectionGate` lets through a role with no saved matrix whose default is none, so nobody is locked out of shared reads (the transactions and parties lists are read by operations, collections and the work plan). Because of that, 43 roles read customs-clearance contract pricing, its invoice and the parties card directly through the API (QA check), although they are shown only on the transaction page inside the section.
 * This is mounted on a specific route after `sectionGate`: whoever has the section stamped (view or edit) and system admins pass, everything else is rejected, with no fallback to role lists.
 */
const requireSectionAccess = (sectionKey) => {
  const guard = (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Authentication required' });
    if (FULL_ACCESS_ROLES.includes(req.user.role)) return next();
    if (req.sectionAccess === 'view' || req.sectionAccess === 'edit') return next();
    return res.status(403).json({ message: 'No access to this section', code: 'SECTION_FORBIDDEN' });
  };
  guard.__section = (getSection(sectionKey) && getSection(sectionKey).key) || sectionKey;
  return guard;
};

module.exports = sectionGate;
module.exports.stampSection = stampSection;
module.exports.requireSectionAccess = requireSectionAccess;
