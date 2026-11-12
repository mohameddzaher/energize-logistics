/**
 * Business-review scope for department heads.
 * Meeting runners (executives, secretariat) see and manage every department. A department head sees only his own
 * department's tasks and manages them like a runner would, but only inside that department.
 */
const { orgSectionOfRole } = require('../config/roles');
const { canRunMeetings, isManagerRole } = require('../config/businessReview');
const { sectionsOfUserIds } = require('./userSection');

const NO_DEPT = 'Unassigned';

/** The department a head manages, or null for runners and non-heads. */
async function headDept(user) {
  if (!user || canRunMeetings(user) || !isManagerRole(user.role)) return null;
  return (await sectionsOfUserIds([user._id])).get(String(user._id)) || orgSectionOfRole(user.role) || null;
}

/** Same department rule as the meeting cards: the owner's section, else his role's, else the stored one. */
async function deptResolver(actions) {
  const owner = await sectionsOfUserIds(actions.map((a) => a.assignee));
  return (a) => owner.get(String(a.assignee)) || orgSectionOfRole(a.assigneeRole) || a.department || NO_DEPT;
}

/** May this user change what the task is, who owns it, or delete it. */
async function canManageAction(user, action) {
  if (canRunMeetings(user)) return true;
  const hd = await headDept(user);
  if (!hd) return false;
  return (await deptResolver([action]))(action) === hd;
}

/** Every user id belongs to the head's department (a head hands work only inside it). */
async function allInDept(ids, dept) {
  if (!dept) return false;
  const m = await sectionsOfUserIds(ids);
  return ids.every((id) => m.get(String(id)) === dept);
}

module.exports = { headDept, deptResolver, canManageAction, allInDept, NO_DEPT };
