/**
 * Business review delegation: a section manager lets a member of his team act for him there.
 * The member reads the section's tasks and acts on them like the manager; his own name stays on everything he does.
 * Applied per request on /api/business-review: the account takes the manager's role there only, never elsewhere.
 */
const cache = require('./ttlCache');

const managerOf = (id) => cache.wrap(`br:actsfor:${id}`, 30 * 1000, async () => {
  const User = require('../models/User');
  return User.findById(id).select('firstName lastName role isActive').lean();
});

/** Express middleware: swaps in the manager's role for this request when the account acts for an active manager. */
async function applyDelegation(req, res, next) {
  try {
    const u = req.user;
    if (!u || !u.brActsFor) return next();
    const { isManagerRole } = require('../config/businessReview');
    if (isManagerRole(u.role)) return next();
    const m = await managerOf(String(u.brActsFor));
    if (!m || m.isActive === false || !isManagerRole(m.role)) return next();
    // A copy: the authenticated user object is cached and shared between requests.
    const base = typeof u.toObject === 'function' ? u.toObject() : { ...u };
    req.user = { ...base, role: m.role, ownRole: u.role, brActingFor: { _id: m._id, name: `${m.firstName || ''} ${m.lastName || ''}`.trim() } };
    return next();
  } catch (_) { return next(); }
}

const clear = (managerId) => { try { cache.clear(`br:actsfor:${managerId}`); } catch (_) { /* */ } };

module.exports = { applyDelegation, clear };
