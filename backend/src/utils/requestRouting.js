/**
 * Routing of employee requests (HRRequest): an employee's request goes to his direct manager first, who handles it,
 * rejects it, or sends it on to a department (HR, finance, IT, ...) or to top management. A department manager (or
 * anyone without a direct manager) picks the department himself. Each request is visible only to its requester, his
 * direct manager, the department or desk it currently sits with, whoever already acted on it, and the top roles.
 */
const { SECTION_ROLES, ORG_PARENT, DATA_DEPT } = require('../config/roles');
const { isTopRole } = require('../config/constants');
const chain = require('./leaveChain');
const { sectionOfUser } = require('./userSection');

const TOP_TARGET = 'Top Management';
const OPEN = ['open', 'in_progress', 'received'];

const strip = (s, re) => String(s || '').replace(re, '').trim();
// Where the manager's title does not read as the department's name.
const LABEL = {
  Accounting: ['الإدارة المالية', 'Finance'], B2C: ['النقل الخفيف', 'Light Transport'], 'Fleet Management': ['إدارة الأسطول', 'Fleet Management'],
  CRM: ['إدارة علاقات العملاء', 'CRM'], 'Software & IT': ['البرمجيات', 'Software'],
};
/** Every department a request can be sent to, as {key, ar, en}; top management last. */
const TARGETS = [
  ...SECTION_ROLES.filter((s) => !ORG_PARENT[s.section]).map((s) => ({
    key: s.section,
    ar: (LABEL[s.section] || [])[0] || strip(s.manager.ar, /^مدير\s+/),
    en: (LABEL[s.section] || [])[1] || strip(s.manager.en, /\s+Manager$/i),
  })),
  { key: DATA_DEPT, ar: 'إدارة البيانات', en: 'Data Management' },
  { key: TOP_TARGET, ar: 'الإدارة العليا', en: 'Top Management' },
];
const TARGET_KEYS = new Set(TARGETS.map((t) => t.key));
const targetLabel = (key) => (TARGETS.find((t) => t.key === key) || {}).ar || key || '';

/** Legacy rows have no route: they were all addressed to HR. */
const targetOf = (r) => (r && r.targetSection) || 'HR';
const stageOf = (r) => (r && r.stage) || (OPEN.includes(r && r.status) ? 'department' : 'done');

/** Does the requester pick the department himself? A department manager, or nobody above him on his account. */
const needsTarget = (user) => chain.selfManaged(user) || !user.manager;

const isTopMgmt = (u) => !!u && (u.isTopManagement === true || u.isChairman === true);
const idEq = (a, b) => !!a && !!b && String(a._id || a) === String(b._id || b);

/** Is `user` (with `section` = his department) one of the people of `target`? */
const memberOf = (user, section, target, { hrGranted = false } = {}) => {
  if (!user) return false;
  if (target === TOP_TARGET) return isTopMgmt(user);
  if (target === 'HR' && hrGranted) return true;
  if (target === 'Accounting' && chain.FINANCE_ROLES.includes(user.role)) return true;
  return !!section && section === target;
};

/** Mongo filter for the requests `user` may see as a handler (not his own requests). */
async function visibleFilter(user, opts = {}) {
  if (isTopRole(user.role)) return { requester: { $ne: user._id } };
  const section = await sectionOfUser(user);
  const or = [{ manager: user._id }, { participants: user._id }];
  const targets = TARGETS.map((t) => t.key).filter((k) => memberOf(user, section, k, opts));
  if (targets.length) {
    or.push({ targetSection: { $in: targets }, stage: { $ne: 'manager' } });
    if (targets.includes('HR')) or.push({ targetSection: { $exists: false }, stage: { $exists: false } });
  }
  return { requester: { $ne: user._id }, $or: or };
}

/** May `user` see this request at all? */
async function canSee(user, r, opts = {}) {
  if (!user || !r) return false;
  if (idEq(r.requester, user._id) || isTopRole(user.role)) return true;
  if (idEq(r.manager, user._id)) return true;
  if ((r.participants || []).some((p) => idEq(p, user._id))) return true;
  if (stageOf(r) === 'manager') return false;
  return memberOf(user, await sectionOfUser(user), targetOf(r), opts);
}

/** May `user` act on it now (forward / handle / reject)? Only whoever holds it at its current stage, or a top role. */
async function canAct(user, r, opts = {}) {
  if (!user || !r || stageOf(r) === 'done') return false;
  if (isTopRole(user.role)) return true;
  if (idEq(r.requester, user._id)) return false;
  if (stageOf(r) === 'manager') return idEq(r.manager, user._id);
  return memberOf(user, await sectionOfUser(user), targetOf(r), opts);
}

module.exports = { TARGETS, TARGET_KEYS, TOP_TARGET, OPEN, targetLabel, targetOf, stageOf, needsTarget, visibleFilter, canSee, canAct, memberOf };
