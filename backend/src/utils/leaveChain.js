/**
 * Leave approval chain: who decides at each stage.
 * Five stages, the owner's order: direct manager, finance, HR, top management (accounts flagged `isTopManagement`), chairman of the board (`isChairman`).
 * A request already past a stage that was added later (held at HR without a finance decision) carries on from where it is; NEXT_OF never sends it back.
 * A clarification request is not a rejection: the request returns to the employee to reply, amend or attach a receipt, and when they reply the chain restarts from the beginning because the approved request is no longer the same request.
 */
const { rolesOfSection } = require('../config/roles');

const STAGES = ['manager', 'finance', 'hr', 'executive', 'chairman'];
const PENDING_OF = {
  manager: 'pending_manager',
  finance: 'pending_finance',
  hr: 'pending_hr',
  executive: 'pending_executive',
  chairman: 'pending_chairman',
};
// A request is 'open' until finally decided: at any stage, or returned to the employee for a reply. This is the measure used to count pending requests on every dashboard.
const OPEN_STATUSES = [...Object.values(PENDING_OF), 'info_requested'];

const NEXT_OF = { manager: 'finance', finance: 'hr', hr: 'executive', executive: 'chairman', chairman: 'done' };
// Where a request starts once the direct manager is satisfied (no manager, or he filed it himself).
const AFTER_MANAGER = NEXT_OF.manager;
const DECISION_FIELD = {
  manager: 'managerDecision', finance: 'financeDecision', hr: 'hrDecision',
  executive: 'executiveDecision', chairman: 'chairmanDecision',
};
const STAGE_AR = {
  manager: 'المدير المباشر', finance: 'الإدارة المالية', hr: 'الموارد البشرية',
  executive: 'الإدارة العليا', chairman: 'رئيس مجلس الإدارة',
};

// Who owns each stage: roles are read from `config/roles` rather than a second list that would go stale, so a role added to HR or finance joins the chain automatically.
const HR_ROLES = rolesOfSection('HR');
// The CFO sits above the accounting department, so he is added from financeAuthority rather than the section list.
const FINANCE_ROLES = [...new Set([...rolesOfSection('Accounting'), ...require('../config/financeAuthority').FINANCE_FULL_ROLES])];
const EXEC_ROLES = ['super_admin', 'admin'];
/** Top management and the chairman are named accounts, not roles; any super admin can still push a stalled request (OVERRIDE_ROLES). */
const isTopManagement = (user) => user?.isTopManagement === true;
const isChairman = (user) => user?.isChairman === true;

// Who can push a stalled request through. Not `FULL_ACCESS_ROLES`: IT owns the whole system to fix it, not to sign anyone's leave.
const OVERRIDE_ROLES = ['super_admin', 'admin'];

/** Can this user decide this request at this stage? */
function canActAt(stage, user, leave) {
  const role = user?.role || '';
  if (OVERRIDE_ROLES.includes(role)) return true;
  if (stage === 'manager') return String(leave.manager || '') === String(user._id);
  if (stage === 'finance') return FINANCE_ROLES.includes(role);
  if (stage === 'hr') return HR_ROLES.includes(role);
  if (stage === 'executive') return isTopManagement(user);
  if (stage === 'chairman') return isChairman(user);
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
  if (FINANCE_ROLES.includes(role)) out.push('finance');
  if (HR_ROLES.includes(role)) out.push('hr');
  if (isTopManagement(user)) out.push('executive');
  if (isChairman(user)) out.push('chairman');
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

/** Status and stage a request starts at: the manager, or the stage after him when there is none. */
function startOf(hasManager) {
  const stage = hasManager ? 'manager' : AFTER_MANAGER;
  return { status: PENDING_OF[stage], currentStage: stage };
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
 * When the replier is the request's manager himself (he filed it for his team), his reply is his approval: it goes straight to the next stage.
 */
function restart(leave, replier) {
  for (const f of Object.values(DECISION_FIELD)) leave[f] = undefined;
  leave.deductsBalance = null;
  const hasManager = !!leave.manager;
  if (hasManager && replier && String(replier._id || replier) === String(leave.manager)) {
    leave.managerDecision = { by: replier._id || replier, at: new Date(), decision: 'approved', note: 'ردّ المدير على الاستفسار — موافقته قائمة' };
    Object.assign(leave, startOf(false));
    return;
  }
  Object.assign(leave, startOf(hasManager));
}

module.exports = {
  STAGES, PENDING_OF, OPEN_STATUSES, NEXT_OF, AFTER_MANAGER, DECISION_FIELD, STAGE_AR,
  HR_ROLES, FINANCE_ROLES, EXEC_ROLES, OVERRIDE_ROLES, isTopManagement, isChairman,
  canActAt, stagesFor, inboxFilter, startOf, advance, askEmployee, restart,
};
