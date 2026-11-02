/**
 * Scoped-role fence: an external account reaches only what is written for it. Mounted on all of `/api/` before the page and section guards; touches only scoped roles (config/scopedRoles) and passes public doors on to the route's own guard when there is no token.
 * An allowlist, because many endpoints only require a logged-in caller and a blocklist would leave every new endpoint open to the partner: whatever is not listed in `api` is closed.
 * The path is compared after decoding and anything containing `..` is rejected.
 */
const { resolveUser } = require('./auth');
const { scopeOf } = require('../config/scopedRoles');

const within = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

const scopedRoleFence = async (req, res, next) => {
  try {
    const user = await resolveUser(req);
    const scope = user && scopeOf(user.role);
    if (!scope) return next();
    let path = (req.originalUrl || req.url || '').split('?')[0];
    try { path = decodeURIComponent(path); } catch (_) { /* Unchanged. */ }
    const ok = !/(^|\/)\.\.?(\/|$)/.test(path) && scope.api.some((p) => within(path, p));
    if (ok) return next();
    return res.status(403).json({
      code: 'SCOPE_FORBIDDEN',
      message: 'هذا الحساب مخصّص لصفحة واحدة / This account is limited to one page',
    });
  } catch (e) {
    // The fence guards an external account, so its own failure closes rather than opens, but only for scoped users. Here we do not know whether the caller is scoped, so it is left to the route guards.
    return next();
  }
};

module.exports = scopedRoleFence;
module.exports.within = within;
