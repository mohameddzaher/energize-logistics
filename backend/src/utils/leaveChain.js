/**
 * Leave approval chain: who decides at each stage.
 * Three stages, the owner's order: direct manager, HR, top management (the accounts flagged `isTopManagement`). Accounting was a stage once; requests still held there finish through it.
 * A clarification request is not a rejection: the request returns to the employee to reply, amend or attach a receipt, and when they reply the chain restarts from the beginning because the approved request is no longer the same request.
 */
const { rolesOfSection } = require('../config/roles');

// Stage to the pending status held at it.
const STAGES = ['manager', 'hr', 'executive'];
const PENDING_OF = {
  manager: 'pending_manager',
  hr: 'pending_hr',
  finance: 'pending_finance',
  executive: 'pending_executive',
};
// A request is 'open' until finally decided: at any stage, or returned to the employee for a reply. This is the measure used to count pending requests on every dashboard; per-file two-stage lists used to drop requests that had reached accounting or management from every counter.
const OPEN_STATUSES = [...Object.values(PENDING_OF), 'info_requested'];

const NEXT_OF = { manager: 'hr', hr: 'executive', finance: 'executive', executive: 'done' };
const DECISION_FIELD = {
  manager: 'managerDecision', hr: 'hrDecision',
  finance: 'financeDecision', executive: 'executiveDecision',
};

// Who owns each stage: roles are read from `config/roles` rather than a second list that would go stale, so a role added to HR or accounting joins the chain automatically.
const HR_ROLES = rolesOfSection('HR');
const FINANCE_ROLES = rolesOfSection('Accounting');
const EXEC_ROLES = ['super_admin', 'admin'];
/** Top management: the named accounts, not a role; any super admin can still push a stalled request (OVERRIDE_ROLES). */
const isTopManagement = (user) => user?.isTopManagement === true;

// Who can push a stalled request through. Not `FULL_ACCESS_ROLES`: IT owns the whole system to fix it, not to sign anyone's leave.
const OVERRIDE_ROLES = ['super_admin', 'admin'];

/** Can this user decide this request at this stage? */
function canActAt(stage, user, leave) {
  const role = user?.role || '';
  if (OVERRIDE_ROLES.includes(role)) return true;
  if (stage === 'manager') return String(leave.manager || '') === String(user._id);
  if (stage === 'hr') return HR_ROLES.includes(role);
  if (stage === 'finance') return FINANCE_ROLES.includes(role);
  if (stage === 'executive') return isTopManagement(user) || EXEC_ROLES.includes(role);
  return false;
}

/**
 * Stages this user owns; used to build the awaiting-me page.
 * The manager stage is a relation to the request, not a role, so it is listed for every user and `inboxFilter` narrows it with `manager: user._id`.
 */
function stagesFor(user) {
  const role = user?.role || '';
  if (OVERRIDE_ROLES.includes(role)) return [...STAGES];
  const out = ['manager'];
  if (HR_ROLES.includes(role)) out.push('hr');
  if (isTopManagement(user)) out.push('executive');
  return out;
}

/** Filter for requests awaiting this user: one query, not a Node loop. The manager stage is limited to their team's requests; other stages go by role. */
function inboxFilter(user) {
  const stages = stagesFor(user);
  const or = [];
  for (const st of stages) {
    if (st === 'manager' && !OVERRIDE_ROLES.includes(user?.role)) {
      or.push({ status: 'pending_manager', manager: user._id });
    } else {
      or.push({ status: PENDING_OF[st] });
    }
  }
  return or.length ? { $or: or } : { _id: null };
}

/** Advances the request to the next stage after an approval at `stage`. */
function advance(leave, stage) {
  const next = NEXT_OF[stage];
  if (next === 'done') { leave.status = 'approved'; leave.currentStage = 'done'; return 'approved'; }
  leave.status = PENDING_OF[next];
  leave.currentStage = next;
  return next;
}

/**
 * Returns the request to its owner with a question.
 * Approvals are not cleared here but when they reply, so it stays known who approved before the question.
 */
function askEmployee(leave) {
  leave.status = 'info_requested';
  leave.currentStage = 'employee';
}

/**
 * A reply restarts the chain from the start.
 * Previous approvals (and HR's deduction choice) are cleared: the request changed, so earlier approval was for a different one.
 * When the replier is the request's manager himself (he filed it for his team), his reply is his approval: it goes straight to HR.
 */
function restart(leave, replier) {
  leave.managerDecision = undefined;
  leave.hrDecision = undefined;
  leave.financeDecision = undefined;
  leave.executiveDecision = undefined;
  leave.deductsBalance = null;
  const hasManager = !!leave.manager;
  if (hasManager && replier && String(replier._id || replier) === String(leave.manager)) {
    leave.managerDecision = { by: replier._id || replier, at: new Date(), decision: 'approved', note: 'ردّ المدير على الاستفسار — موافقته قائمة' };
    leave.status = 'pending_hr';
    leave.currentStage = 'hr';
    return;
  }
  leave.status = hasManager ? 'pending_manager' : 'pending_hr';
  leave.currentStage = hasManager ? 'manager' : 'hr';
}

module.exports = {
  STAGES, PENDING_OF, OPEN_STATUSES, NEXT_OF, DECISION_FIELD,
  HR_ROLES, FINANCE_ROLES, EXEC_ROLES, OVERRIDE_ROLES, isTopManagement,
  canActAt, stagesFor, inboxFilter, advance, askEmployee, restart,
};
