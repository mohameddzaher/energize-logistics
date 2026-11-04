/**
 * Who a manager may file a leave request for: the people under him.
 *
 * An employee is under account M when any of these holds:
 *   1. `Employee.directManager` is M (the HR file's line manager).
 *   2. The employee's login has `User.manager` = M (the relation the leave chain routes on).
 *   3. M holds the manager role of a system section, and the employee belongs to that section:
 *      his login role is one of the section's roles, or his HR department is owned by the section
 *      (`performanceDepartments.sectionOwners`: by name, or by most of its staff reporting to the section manager).
 * Rule 3 is what reaches reps and drivers: they rarely have a login or a line manager on file, but always a department.
 * Terminated and archived staff, and M's own file, are never in the team.
 */
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const User = require('../models/User');
const cache = require('./ttlCache');
const D = require('../config/performanceDepartments');
const { canonicalRole, rolesOfSection, sectionOfRole } = require('../config/roles');

const OWNERS_TTL = 60000;
const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** HR department key → owning section, plus the department index. Cached: it reads every file. */
const ownersMap = () => cache.wrap('hr:leaveteam:owners', OWNERS_TTL, async () => {
  const [index, emps, users] = await Promise.all([
    D.loadIndex(),
    Employee.find({ employmentStatus: { $ne: 'terminated' } }).select('department user directManager').lean(),
    User.find({ isActive: { $ne: false } }, { _id: 1, role: 1 }).lean(),
  ]);
  const roleOf = new Map(users.map((u) => [String(u._id), canonicalRole(u.role)]));
  const list = emps.map((e) => ({ ...e, dept: D.resolveDepartment(e.department, index) }));
  const owner = D.sectionOwners(index, list, roleOf);
  // Department names as written on files, grouped by owning section, so the team query is a plain $in.
  const namesBySection = {};
  for (const e of list) {
    const sec = owner.get(e.dept.key);
    if (!sec || !e.department) continue;
    (namesBySection[sec] = namesBySection[sec] || new Set()).add(e.department);
  }
  return Object.fromEntries(Object.entries(namesBySection).map(([k, v]) => [k, [...v]]));
});

/** The section whose manager this account is, or null. */
function managedSection(user) {
  const role = canonicalRole(user?.role || '');
  const sec = D.sectionOfManagerRole(role);
  if (sec) return sec;
  // A section's own manager role, when the JP map names it differently.
  const own = sectionOfRole(role);
  return own && D.managerRolesOf(own).includes(role) ? own : null;
}

/** Mongo filter for the employees under this account (rules 1-3), before exclusions. */
async function teamFilter(user) {
  const me = oid(user._id);
  const or = [{ directManager: me }];
  const reports = await User.find({ manager: me }).select('_id linkedEmployee').lean();
  const section = managedSection(user);
  let members = reports;
  if (section) {
    const roles = rolesOfSection(section);
    members = members.concat(await User.find({ role: { $in: roles }, _id: { $ne: me } }).select('_id linkedEmployee').lean());
    const names = (await ownersMap())[section] || [];
    if (names.length) or.push({ department: { $in: names } });
  }
  if (members.length) {
    or.push({ user: { $in: members.map((u) => u._id) } });
    const linked = members.map((u) => u.linkedEmployee).filter(Boolean);
    if (linked.length) or.push({ _id: { $in: linked } });
  }
  return { $or: or };
}

/** The employees this account may file leave for, with a reason per person. */
async function teamOf(user, { select = '_id firstName lastName arabicName employeeNumber department jobTitle user directManager isHrRecord iqamaNumber nationalId idType' } = {}) {
  const { endedStaff } = require('./endedStaff');
  const [filter, sets] = await Promise.all([teamFilter(user), endedStaff()]);
  const mine = String(user.linkedEmployee?._id || user.linkedEmployee || '');
  const rows = await Employee.find({
    $and: [filter, { employmentStatus: { $ne: 'terminated' } }, { user: { $ne: oid(user._id) } }],
  }).select(select).lean();
  // One login can own two files (the HR file and one made with the account): the HR file wins.
  const hrFileOf = new Set(rows.filter((e) => e.user && e.isHrRecord !== false).map((e) => String(e.user)));
  return rows.filter((e) => String(e._id) !== mine
    && !sets.archivedIds.has(String(e._id))
    && !(e.isHrRecord === false && e.user && hrFileOf.has(String(e.user))));
}

/** Is this employee under this account? */
async function isUnder(user, employeeId) {
  if (!mongoose.isValidObjectId(employeeId)) return false;
  const team = await teamOf(user, { select: '_id user isHrRecord' });
  return team.some((e) => String(e._id) === String(employeeId));
}

/**
 * Does this user approve leave anywhere: a stage owner (finance, HR, top management, chairman, super admin), or a direct manager of someone.
 * Decides who sees the leave-approvals page; employees with nobody under them have nothing to approve there.
 */
async function approvesLeaves(user) {
  if (!user) return false;
  if (require('./leaveChain').stagesFor(user).length > 1) return true;
  const User = require('../models/User');
  const LeaveRequest = require('../models/LeaveRequest');
  if (await User.exists({ manager: user._id, isActive: { $ne: false } })) return true;
  if (await LeaveRequest.exists({ manager: user._id })) return true;
  return (await teamOf(user, { select: '_id' })).length > 0;
}

module.exports = { teamOf, isUnder, teamFilter, managedSection, approvesLeaves };
