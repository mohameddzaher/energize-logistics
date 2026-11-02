const { isAllowedOrigin } = require('../config/cors');

/**
 * Reject cross-site forged requests (CSRF) on everything that changes state.
 * CORS is not enough: session cookies are necessarily `SameSite=None` (frontend and server on different domains), so the browser sends them from any site, and a plain form post needs no preflight; CORS blocks reading the response, not the action.
 * This compares `Origin` (or `Referer`) with the allowed origins. Unlike `isAllowedOrigin`, a missing origin is rejected when a session cookie is present; without a session cookie (token in a header, server tools) there is no risk.
 */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

// Routes called by external systems with no browser, protected by a shared secret.
const EXEMPT = [/^\/api\/ops\/webhook/, /^\/api\/health/];

function csrfGuard(req, res, next) {
  if (SAFE.has(req.method)) return next();
  const path = req.originalUrl.split('?')[0];
  if (EXEMPT.some((rx) => rx.test(path))) return next();

  // Without a session cookie a browser cannot forge anything on someone's behalf.
  const hasSessionCookie = !!(req.cookies?.accessToken || req.cookies?.refreshToken);
  if (!hasSessionCookie) return next();

  const origin = req.headers.origin
    || (req.headers.referer ? (() => { try { return new URL(req.headers.referer).origin; } catch (e) { return ''; } })() : '');

  if (origin && isAllowedOrigin(origin)) return next();

  return res.status(403).json({
    message: 'طلبٌ من مصدر غير معروف',
    code: 'CSRF_ORIGIN_REJECTED',
  });
}

module.exports = csrfGuard;
