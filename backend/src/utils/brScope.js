/**
 * Business-review scope for department heads.
 * Meeting runners (executives, secretariat) see and manage every department. A department head sees only his own
 * department's tasks and manages them like a runner would, but only inside that department.
 */
const { orgSectionOfRole } = require('../config/roles');
const { canRunMeetings, isManagerRole } = require('../config/businessReview');
const { sectionsOfUserIds } = require('./userSection');

const NO_DEPT = 'Unassigned';

/** Managers this account acts for under business review delegation (utils/brDelegate). */
const actingFor = (user) => (user && (user.brActingForAll || (user.brActingFor ? [user.brActingFor] : []))) || [];

/**
 * The departments a head manages, or null for runners and non-heads.
 * A head has his own section; a delegate also works in each section whose manager delegated him (a shared account may serve several).
 */
async function headDepts(user) {
  if (!user || canRunMeetings(user) || !isManagerRole(user.role)) return null;
  const heads = [];
  if (isManagerRole(user.ownRole || user.role)) heads.push({ _id: user._id, role: user.ownRole || user.role });
  for (const m of actingFor(user)) heads.push({ _id: m._id, role: m.role });
  const secs = await sectionsOfUserIds(heads.map((h) => h._id));
  const out = [...new Set(heads.map((h) => secs.get(String(h._id)) || orgSectionOfRole(h.role)).filter(Boolean))];
  return out.length ? out : null;
}
const headDept = async (user) => ((await headDepts(user)) || [])[0] || null;

/** Same department rule as the meeting cards: the owner's section, else his role's, else the stored one. */
async function deptResolver(actions) {
  const owner = await sectionsOfUserIds(actions.map((a) => a.assignee));
  return (a) => owner.get(String(a.assignee)) || orgSectionOfRole(a.assigneeRole) || a.department || NO_DEPT;
}

/** May this user change what the task is, who owns it, or delete it. */
async function canManageAction(user, action) {
  if (canRunMeetings(user)) return true;
  const hd = await headDepts(user);
  if (!hd) return false;
  return hd.includes((await deptResolver([action]))(action));
}

/** Every user id belongs to the head's department (a head hands work only inside it). */
async function allInDept(ids, depts) {
  const list = (Array.isArray(depts) ? depts : [depts]).filter(Boolean);
  if (!list.length) return false;
  const m = await sectionsOfUserIds(ids);
  return ids.every((id) => list.includes(m.get(String(id))));
}

/**
 * Who the caller counts as in business review: himself, and under a delegation (utils/brDelegate) also the manager he acts for.
 * Visibility follows both (the manager is the attendee and the assignee); writes still carry the caller's own id and name.
 */
const brIds = (user) => [user && user._id, ...actingFor(user).map((m) => m._id)].filter(Boolean);
const isMe = (user, id) => !!id && brIds(user).some((x) => String(x) === String(id && id._id ? id._id : id));
module.exports = { brIds, isMe, headDept, headDepts, actingFor, deptResolver, canManageAction, allInDept, NO_DEPT };
