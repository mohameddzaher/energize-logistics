/**
 * Business review delegation: a section manager lets someone act for him there (his team, a shared transition/backup
 * account, or the data manager). One account may act for several managers; it then works in each of their sections.
 * Applied per request on /api/business-review only; the account's own name stays on everything it does.
 */
const cache = require('./ttlCache');

/** brActsFor as a list: older rows hold a single id. */
const actsForIds = (u) => {
  const v = u && u.brActsFor;
  if (!v) return [];
  return (Array.isArray(v) ? v.flat(3) : [v]).filter(Boolean).map(String);
};

const managerOf = (id) => cache.wrap(`br:actsfor:${id}`, 30 * 1000, async () => {
  const User = require('../models/User');
  return User.findById(id).select('firstName lastName role isActive').lean();
});

/** The active managers this account acts for, as { _id, name, role }. */
async function managersOf(u) {
  const { isManagerRole } = require('../config/businessReview');
  const out = [];
  for (const id of [...new Set(actsForIds(u))]) {
    // eslint-disable-next-line no-await-in-loop
    const m = await managerOf(id);
    if (m && m.isActive !== false && isManagerRole(m.role)) out.push({ _id: m._id, name: `${m.firstName || ''} ${m.lastName || ''}`.trim(), role: m.role });
  }
  return out;
}

/** Express middleware: under a delegation the request carries the managers acted for, and a non-manager takes a manager's role. */
async function applyDelegation(req, res, next) {
  try {
    const u = req.user;
    if (!u || !actsForIds(u).length) return next();
    const { isManagerRole, canRunMeetings } = require('../config/businessReview');
    const managers = await managersOf(u);
    if (!managers.length) return next();
    // A copy: the authenticated user object is cached and shared between requests.
    const base = typeof u.toObject === 'function' ? u.toObject() : { ...u };
    // A manager keeps his own role; anyone else borrows one, preferring a plain head so a delegation never turns into running the meetings.
    const borrowed = managers.find((m) => !canRunMeetings({ role: m.role })) || managers[0];
    const role = isManagerRole(u.role) ? u.role : borrowed.role;
    req.user = { ...base, role, ownRole: u.role, brActingFor: managers[0], brActingForAll: managers };
    return next();
  } catch (_) { return next(); }
}

const clear = (managerId) => { try { cache.clear(`br:actsfor:${managerId}`); } catch (_) { /* */ } };

module.exports = { applyDelegation, clear, actsForIds, managersOf };
