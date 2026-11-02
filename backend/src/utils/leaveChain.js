/**
 * Leave approval chain: who decides at each stage.
 * Four stages: direct manager, HR, accounting, top management. Accounting was added because money matters (advances, settlements before travel) never reached it, and top management learned of travel after the fact.
 * A clarification request is not a rejection: the request returns to the employee to reply, amend or attach a receipt, and when they reply the chain restarts from the beginning because the approved request is no longer the same request.
 */
const { rolesOfSection } = require('../config/roles');

// Stage to the pending status held at it.
const STAGES = ['manager', 'hr', 'finance', 'executive'];
const PENDING_OF = {
  manager: 'pending_manager',
  hr: 'pending_hr',
  finance: 'pending_finance',
  executive: 'pending_executive',
};
// A request is 'open' until finally decided: at any stage, or returned to the employee for a reply. This is the measure used to count pending requests on every dashboard; per-file two-stage lists used to drop requests that had reached accounting or management from every counter.
const OPEN_STATUSES = [...Object.values(PENDING_OF), 'info_requested'];

const NEXT_OF = { manager: 'hr', hr: 'finance', finance: 'executive', executive: 'done' };
const DECISION_FIELD = {
  manager: 'managerDecision', hr: 'hrDecision',
  finance: 'financeDecision', executive: 'executiveDecision',
};

// Who owns each stage: roles are read from `config/roles` rather than a second list that would go stale, so a role added to HR or accounting joins the chain automatically.
const HR_ROLES = rolesOfSection('HR');
const FINANCE_ROLES = rolesOfSection('Accounting');
const EXEC_ROLES = ['super_admin', 'admin'];

// Who can push a stalled request through. Not `FULL_ACCESS_ROLES`: IT owns the whole system to fix it, not to sign anyone's leave.
const OVERRIDE_ROLES = ['super_admin', 'admin'];

/** Can this user decide this request at this stage? */
function canActAt(stage, user, leave) {
  const role = user?.role || '';
  if (OVERRIDE_ROLES.includes(role)) return true;
  if (stage === 'manager') return String(leave.manager || '') === String(user._id);
  if (stage === 'hr') return HR_ROLES.includes(role);
  if (stage === 'finance') return FINANCE_ROLES.includes(role);
  if (stage === 'executive') return EXEC_ROLES.includes(role);
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
  if (FINANCE_ROLES.includes(role)) out.push('finance');
  if (EXEC_ROLES.includes(role)) out.push('executive');
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
 * Employee reply restarts the chain from the start.
 * Previous approvals are cleared: the request changed, so earlier approval was for a different one.
 */
function restart(leave) {
  leave.managerDecision = undefined;
  leave.hrDecision = undefined;
  leave.financeDecision = undefined;
  leave.executiveDecision = undefined;
  const hasManager = !!leave.manager;
  leave.status = hasManager ? 'pending_manager' : 'pending_hr';
  leave.currentStage = hasManager ? 'manager' : 'hr';
}

module.exports = {
  STAGES, PENDING_OF, OPEN_STATUSES, NEXT_OF, DECISION_FIELD,
  HR_ROLES, FINANCE_ROLES, EXEC_ROLES, OVERRIDE_ROLES,
  canActAt, stagesFor, inboxFilter, advance, askEmployee, restart,
};
