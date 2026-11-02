const { canonicalRole } = require('../config/roles');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Old role names are read by their new names. Roles get renamed (`b2c_head` became `b2c_manager`) and the old-name map has existed in config/roles.js without being used anywhere.
 * A guard written with the old name opens for nobody: it looks wider than it is. An account still stored under the old name is blocked from a door it owns. Both cases are silent: no log error, only "no permission" on screen.
 * So both sides are normalized before comparing: the guard's list and the account's role. A rename then cannot break a door nobody updated.
 */
const build = (roles, { strict = false } = {}) => {
  const allowed = new Set(roles.map(canonicalRole));
  const guard = (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (allowed.has(canonicalRole(req.user.role))) {
      return next();
    }

    // Admin passes wherever super admin passes, even in strict guards (config/constants: TOP_ROLES).
    if (req.user.role === 'admin' && allowed.has('super_admin')) return next();

    // A door a matrix grant cannot open. `authorize.strict` reads no section stamp and no page tick: its list is everything. It is for whoever owns the matrix itself; if their screen could be opened by a tick, the holder could grant themselves everything in two clicks. Also covers data erasure, which is irreversible.
    if (strict) return res.status(403).json({ message: 'Insufficient permissions' });

    // Dynamic permissions: sectionGate() stamps req.sectionAccess when the
    // super_admin has granted this role access to the section this route lives
    // in. Honour it so a granted role passes even when it isn't in the route's
    // legacy role list. 'view' grants reads only; 'edit' grants everything.
    const access = req.sectionAccess;
    if (access === 'edit') return next();
    if (access === 'view' && READ_METHODS.has(req.method)) return next();

    // A page tick is read like the section stamp. `pageGate` stamps `pageGranted` if this endpoint belongs to a page explicitly ticked for this role and has no matrix-managed section (there the section is the top guard). Screens of such areas (users, audit log, branches, reference lists, reports center, executive overview, performance review) can only be granted this way: a roles line written in every route guards them and does not know custom types. A user ticked for them opened the screen and got "no permission" with no reason.
    // The tick opens the screen and its actions, as a section does with edit access: ticking a screen in the permissions matrix means it should work, not be shown disabled.
    // One limit remains outside all of this: a system admin account is created or touched only by a system admin (see `guardSuperAdminRole` in controllers/userController). That is handing over the system, not opening a screen, so one checkbox must not lead to it.
    if (req.pageGranted) return next();

    return res.status(403).json({ message: 'Insufficient permissions' });
  };
  // The guard describes itself. API docs are built from the router so they do not drift, and a mounted guard is a closed function that exposes nothing, so what it guards is attached to it as a property, making the docs state the truth.
  guard.__roles = [...allowed];
  if (strict) guard.__strict = true;
  return guard;
};

const authorize = (...roles) => build(roles);

/** Its list alone decides; no section stamp or page tick opens it. */
authorize.strict = (...roles) => build(roles, { strict: true });

module.exports = authorize;
