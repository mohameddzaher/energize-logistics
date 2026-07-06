const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (roles.includes(req.user.role)) {
      return next();
    }

    // Dynamic permissions: sectionGate() stamps req.sectionAccess when the
    // super_admin has granted this role access to the section this route lives
    // in. Honour it so a granted role passes even when it isn't in the route's
    // legacy role list. 'view' grants reads only; 'edit' grants everything.
    const access = req.sectionAccess;
    if (access === 'edit') return next();
    if (access === 'view' && READ_METHODS.has(req.method)) return next();

    return res.status(403).json({ message: 'Insufficient permissions' });
  };
};

module.exports = authorize;
