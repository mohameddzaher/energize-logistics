/**
 * Individuals-section guards not left to the permissions matrix.
 * A rider supervisor is an employee of the section and gets edit access by default, which is what they need to record duty checks. But distributing riders among supervisors is a decision for the project manager, sector manager and super admin, so it is not opened to the supervisor even if the riders page is.
 */
const REP_SUPERVISOR = 'b2c_rep_supervisor';
const INSPECTION_SUPERVISOR = 'b2c_inspection_supervisor';

// Both supervisor roles are supervisors. The supervisor now has two roles: an operational one that covers the rider's day, and a duty-check one that covers the start-of-shift moment. Neither distributes riders; that is the project manager's decision. Reading the restriction for the first role only would make the new role broader than the one it was derived from.
const SUPERVISOR_ROLES = [REP_SUPERVISOR, INSPECTION_SUPERVISOR];

const isRepSupervisor = (user) => SUPERVISOR_ROLES.includes(user?.role);
const isInspectionSupervisor = (user) => user?.role === INSPECTION_SUPERVISOR;

const denyRepSupervisor = (req, res, next) => {
  if (isRepSupervisor(req.user)) {
    return res.status(403).json({ message: 'توزيع المناديب وتعديلهم لمدير المشروع ومدير القطاع فقط' });
  }
  next();
};

module.exports = {
  REP_SUPERVISOR, INSPECTION_SUPERVISOR, SUPERVISOR_ROLES,
  isRepSupervisor, isInspectionSupervisor, denyRepSupervisor,
};
