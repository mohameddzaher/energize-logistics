/**
 * Leave approval chain: who decides at each stage.
 * Five stages, the owner's order: direct manager, finance, HR, top management (accounts flagged `isTopManagement`), chairman of the board (`isChairman`).
 * A request already past a stage that was added later (held at HR without a finance decision) carries on from where it is; NEXT_OF never sends it back.
 * A clarification request is not a rejection: the request returns to the employee to reply, amend or attach a receipt. A plain reply goes back to the stage that asked, with the approvals before it kept; an amended request (dates or type changed) restarts from the beginning, because what was approved is no longer the same request.
 * The process itself (stages, who holds a request) is shown only to `seesProcess` accounts; the employee and other staff see a request as under review until it is decided or returned with a question.
 */
const { rolesOfSection, isManager } = require('../config/roles');

const STAGES = ['manager', 'finance', 'hr', 'executive', 'chairman'];
const PENDING_OF = {
  manager: 'pending_manager',
  finance: 'pending_finance',
  hr: 'pending_hr',
  executive: 'pending_executive',
  chairman: 'pending_chairman',
};
// A request is 'open' until finally decided: at any stage, or returned to the employee for a reply. This is the measure used to count pending requests on every dashboard.
const PENDING_STATUSES = Object.values(PENDING_OF);
const OPEN_STATUSES = [...PENDING_STATUSES, 'info_requested'];

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
const EXEC_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];
/** Top management and the chairman are named accounts, not roles; any super admin can still push a stalled request (OVERRIDE_ROLES). */
const isTopManagement = (user) => user?.isTopManagement === true;
const isChairman = (user) => user?.isChairman === true;

/** Who may see where a request stands in the chain: super admin powers, top management and the chairman (the owner's rule). */
const seesProcess = (user) => !!user && (EXEC_ROLES.includes(user.role) || isTopManagement(user) || isChairman(user));

// Who can push a stalled request through: the roles with super admin powers (config/constants TOP_ROLES, IT included by the owner's decision of 2026-11-05).
const OVERRIDE_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];

/**
 * A manager is his own direct manager: his request starts after the manager stage, with his own approval recorded there (and signed on the sheet). The CFO sits above the accounting department and counts the same.
 * Read from the role, not User.manager, so a manager whose account points at someone else (an admin who set up the user) is not sent to that person.
 */
// Every manager role ends in _manager (config/roles rule), which also covers managers above a single section such as data_manager.
const selfManaged = (user) => !!user && (isManager(user.role) || /_manager$/.test(String(user.role || '')) || user.role === 'cfo');
const SELF_MANAGER_NOTE = 'مدير القسم — هو مديره المباشر | Department manager: his own direct manager';
/** The manager-stage stamp for a self-managed requester. */
const selfManagerDecision = (user, signature = '') => ({ by: user._id || user, at: new Date(), decision: 'approved', note: SELF_MANAGER_NOTE, signature });

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

/** The stage whose question is the latest one on the request. */
const askedStage = (leave) => {
  const q = [...(leave.thread || [])].reverse().find((t) => t.kind === 'question');
  return q && STAGES.includes(q.stage) ? q.stage : null;
};

/**
 * Where a reply sends the request.
 * Not amended: back to the stage that asked; that stage and the later ones are cleared, the earlier approvals stand (HR's deduction choice too, unless HR or an earlier stage asked).
 * Amended (`amended`), or no asking stage on record: the chain restarts and every approval is cleared, since earlier approval was for a different request.
 * When the replier is the request's manager himself (he filed it for his team), or a department manager replying on his own request, his reply is his approval: it goes straight to the next stage.
 */
function restart(leave, replier, { amended = true } = {}) {
  const asked = amended ? null : askedStage(leave);
  if (asked && asked !== 'manager') {
    const from = STAGES.indexOf(asked);
    for (const st of STAGES.slice(from)) leave[DECISION_FIELD[st]] = undefined;
    if (from <= STAGES.indexOf('hr')) leave.deductsBalance = null;
    leave.status = PENDING_OF[asked];
    leave.currentStage = asked;
    return 'resumed';
  }
  for (const f of Object.values(DECISION_FIELD)) leave[f] = undefined;
  leave.deductsBalance = null;
  if (replier && selfManaged(replier) && String(replier._id || replier) === String(leave.requester)) {
    leave.managerDecision = selfManagerDecision(replier, leave.employeeSignature || '');
    Object.assign(leave, startOf(false));
    return 'restarted';
  }
  const hasManager = !!leave.manager;
  if (hasManager && replier && String(replier._id || replier) === String(leave.manager)) {
    leave.managerDecision = { by: replier._id || replier, at: new Date(), decision: 'approved', note: 'ردّ المدير على الاستفسار — موافقته قائمة' };
    Object.assign(leave, startOf(false));
    return 'restarted';
  }
  Object.assign(leave, startOf(hasManager));
  return 'restarted';
}

module.exports = {
  STAGES, PENDING_OF, PENDING_STATUSES, OPEN_STATUSES, NEXT_OF, AFTER_MANAGER, DECISION_FIELD, STAGE_AR,
  HR_ROLES, FINANCE_ROLES, EXEC_ROLES, OVERRIDE_ROLES, isTopManagement, isChairman, selfManaged, selfManagerDecision, seesProcess, askedStage,
  canActAt, stagesFor, inboxFilter, startOf, advance, askEmployee, restart,
};
