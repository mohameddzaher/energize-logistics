// The dynamic-permissions gate (middleware/sectionGate) stamps `req.sectionAccess`
// when the super_admin has granted a role access to the section a route lives in.
// `authorize()` already honours it — but several controllers ALSO do their own
// staff-role checks inside the handler (isHRStaff, isCRMStaff, …). Those checks
// ignored the grant, so a newly-permitted role passed the route gate and was then
// rejected (or returned nothing) inside the handler — which is why granting a
// role access produced broken/empty pages.
//
// Controllers should use this so a granted role is treated as staff:
//   const staff = isHRStaff(req.user) || grantedBySection(req);
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const grantedBySection = (req) =>
  req.sectionAccess === 'edit' || (req.sectionAccess === 'view' && READ_METHODS.has(req.method));

module.exports = { grantedBySection };
