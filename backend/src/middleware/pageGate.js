/**
 * Page guard: page permission protects the data, not only the screen. Previously it only hid the link and the route, so anyone who knew the API endpoint could call it directly.
 * The map in `config/pageApis` says which pages call each endpoint; if all are closed to the role, the endpoint returns 403 without trusting the browser. See the head of that file for the decision rule.
 * Safeguards: an unknown endpoint passes; a page not read statically widens to its section; an error in the guard passes (fail-open). It narrows within what the section granted; the section guard runs first.
 */
const { decide } = require('../config/pageApis');
const { resolveUser } = require('./auth');
const { effectivePages, explicitlyGrantedSet, sectionForPath } = require('../utils/permissions');
const { FULL_ACCESS_ROLES } = require('../config/constants');
const { getPage } = require('../config/pages');

const pageGate = async (req, res, next) => {
  try {
    const user = await resolveUser(req);
    // No user: the route's own guard decides; it may be an intentionally public door.
    if (!user) return next();
    if (FULL_ACCESS_ROLES.includes(user.role)) return next();

    // `req.path` here is relative to the mount point, and `originalUrl` carries the query.
    const path = (req.originalUrl || req.url || '').split('?')[0];
    if (!path.startsWith('/api/')) return next();

    const pages = await effectivePages(user.role);
    const verdict = decide(path, (key) => pages[key] !== false);
    if (!verdict || verdict.ok) {
      // Whoever is granted the screen is granted what it does. Three layers stand in front of a call: the section guard, this guard, then the role list written in the route (`authorize`). The third does not know custom roles and reads the section stamp only if the route has a matrix-managed section. Screens with no section (users, audit log, branches, reference lists, reports center, executive overview, ...) can only be granted by ticking their page; the screen opened but its endpoints answered "Insufficient permissions" with nothing saying why.
      // So it stamps that this endpoint belongs to a page explicitly ticked for this role, and `authorize` reads the stamp like the section stamp. Ticking is a deliberate act by the system owner and does not override a managed section: there the section guard decides first.
      // The stamp is not placed on an endpoint with a matrix-managed section: there the section is the top guard, and "a page does not exceed its section" has no exception.
      try {
        if (!sectionForPath(path)) {
          const granted = await explicitlyGrantedSet(user.role);
          if (granted.size) {
            const owned = decide(path, (key) => granted.has(key));
            if (owned && owned.ok && !owned.widened) req.pageGranted = true;
          }
        }
      } catch (e) { /* The stamp is an extra, not a requirement; without it the decision is as before. */ }
      return next();
    }

    // The rejection names the page being requested. A bare "not authorized" reads as a fault and leads to repeated retries and support calls; the page name makes the request specific.
    const names = verdict.pages.map((k) => getPage(k)?.ar || k);
    return res.status(403).json({
      code: 'PAGE_FORBIDDEN',
      message: `هذه البيانات تخصّ صفحةً خارج صلاحيّاتك: ${names.join('، ')}`,
      pages: verdict.pages,
    });
  } catch (e) {
    // The guard only narrows, so its own failure must not stop work.
    return next();
  }
};

module.exports = pageGate;
