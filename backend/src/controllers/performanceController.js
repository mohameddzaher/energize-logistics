/**
 * Performance (KPI) evaluation.
 * Top roles see the whole company. Forms, items and weights are per section: the section manager edits his section's forms, top roles and the general manager (top-management account) edit every form, the bands and the tiers. A section manager evaluates his section's staff accounts only.
 * The score is computed in one place (config/performanceConfig.computeScore) so preview, saved record and PDF agree.
 */
const Employee = require('../models/Employee');
const { sendMongooseError, describeMongooseError } = require('../utils/mongooseError');
const User = require('../models/User');
const PerfTemplate = require('../models/PerfTemplate');
const PerfEvaluation = require('../models/PerfEvaluation');
const PerfSettings = require('../models/PerfSettings');
const { computeScore } = require('../config/performanceConfig');
const D = require('../config/performanceDepartments');
const { canonicalRole, DATA_DEPT } = require('../config/roles');
const { emitToAll } = require('../websocket/socketManager');
const { isTopManagement } = require('../utils/leaveChain');
const { nameKey } = require('../utils/nameKey');
const mongoose = require('mongoose');

// The section an account is evaluated in, including the data department (config/performanceDepartments).
const sectionOfRole = (role) => D.perfSectionOfRole(role);

// Who may SEE everything (read-only oversight).
// it_specialist removed (owner, 2026-10-27): every employee's grade and bonus is
// for the top roles and the IT manager only.
const FULL_ACCESS = ['super_admin', 'admin', 'it_manager', 'it_specialist'];
// Override a locked evaluation and decide edit requests: top roles only.
const CONFIG_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];

const isFull = (role) => FULL_ACCESS.includes(role);
// Every form, the bands and the bonus tiers: top roles and the general manager.
const canConfigure = (user) => CONFIG_ROLES.includes(user?.role) || isTopManagement(user);
const canOverride = (role) => CONFIG_ROLES.includes(role);

/** Sections whose forms this user may add to: every section for top roles and the general manager, else the sections he manages. */
const editableSections = (user) => (canConfigure(user) ? D.allSections()
  : [...new Set([...D.sectionsManagedBy(canonicalRole(user?.role)), ...D.sectionsSubHeadedBy(canonicalRole(user?.role))])]);

/**
 * May this user edit this form? Section forms: the section's manager, except a form that grades a section head or the editor himself (a manager does not tune his own grading). Department forms and tiers: top roles and the general manager.
 * @param {object} t form fields (section, roles, employees); {Array} ownIds the editor's employee file ids
 */
function canEditTemplate(user, t, ownIds = []) {
  if (canConfigure(user)) return true;
  if (!t || !t.section) return false;
  const role = canonicalRole(user?.role);
  const heads = D.managerRolesOf(t.section);
  const subs = D.subHeadsOf(t.section);
  if (!heads.includes(role) && !subs.includes(role)) return false;
  // A second-level rater does not edit forms that grade his head or his own level.
  if ((t.roles || []).some((r) => heads.includes(r) || r === role || (!heads.includes(role) && subs.includes(r)))) return false;
  const own = new Set(ownIds.map(String));
  return !(t.employees || []).some((id) => own.has(String(id)));
}
const ownEmployeeIds = (user) => Employee.find({ user: user._id }).distinct('_id');

// A rejected value or a duplicate is the client's input: 400 / 409 with the field, not 500 (QA write sweep).
const fail = (res, e, msg) => {
  const d = describeMongooseError(e, msg);
  if (d.status < 500) return res.status(d.status).json({ message: d.message, fields: d.fields });
  console.error(msg || 'performance error:', e);
  return res.status(500).json({ message: msg || (e && e.message) });
};

// ---- Period helpers --------------------------------------------------------
// A stable key per period so one employee can't be graded twice for the same
// quarter on the same form (enforced by a unique index).
function periodKeyOf(p = {}) {
  const year = p.year || new Date().getFullYear();
  switch (p.type) {
    case 'month': return `${year}-M${String(p.month || 1).padStart(2, '0')}`;
    case 'year': return `${year}`;
    case 'custom': return `${p.from || ''}..${p.to || ''}`;
    case 'quarter':
    default: return `${year}-Q${p.quarter || 1}`;
  }
}
function periodLabel(p = {}, ar = true) {
  const year = p.year || new Date().getFullYear();
  const Q = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع'];
  switch (p.type) {
    case 'month': return ar ? `شهر ${p.month}/${year}` : `${p.month}/${year}`;
    case 'year': return ar ? `سنة ${year}` : `Year ${year}`;
    case 'custom': return `${p.from} → ${p.to}`;
    case 'quarter':
    default: return ar ? `الربع ${Q[p.quarter] || ''} ${year}` : `Q${p.quarter} ${year}`;
  }
}
// Parse ?period=2026-Q3 / 2026-M07 / 2026 back into a period object.
function parsePeriod(q) {
  if (!q) {
    const now = new Date();
    return { type: 'quarter', quarter: Math.floor(now.getMonth() / 3) + 1, year: now.getFullYear() };
  }
  let m = /^(\d{4})-Q([1-4])$/.exec(q);
  if (m) return { type: 'quarter', quarter: Number(m[2]), year: Number(m[1]) };
  m = /^(\d{4})-M(\d{1,2})$/.exec(q);
  if (m) return { type: 'month', month: Number(m[2]), year: Number(m[1]) };
  m = /^(\d{4})$/.exec(q);
  if (m) return { type: 'year', year: Number(m[1]) };
  return { type: 'custom', year: new Date().getFullYear(), from: '', to: '' };
}

// ---- Who can this user grade? ---------------------------------------------
/**
 * The roster comes from system accounts, not the HR file's department: a section-manager role evaluates, that section's staff roles are evaluated (config/roles). Accountless people (drivers, reps) are excluded; a role moved between sections moves with it.
 * Per employee: section (role's section), manager (bool), dept (display/grouping name), hrDept (HR-file department, picks the form).
 */
const EMP_FIELDS = 'arabicName firstName lastName jobTitle department employeeNumber photo user directManager isHrRecord employmentStatus';
// Whoever manages above sections is evaluated by the system admin together with section managers.
const ABOVE_SECTIONS = ['cfo', 'moderator'];
const sectionLabelAr = (section) => (section === DATA_DEPT ? 'إدارة البيانات ودعم القرار' : require('../config/sections').sectionLabel(section, 'ar'));
const sectionDept = (section) => ({ key: `sec:${section}`, label: sectionLabelAr(section), labelEn: section, known: true, section });

async function loadOrg() {
  const [index, linked, users] = await Promise.all([
    D.loadIndex(),
    Employee.find({ employmentStatus: { $ne: 'terminated' }, user: { $ne: null } }).select(EMP_FIELDS).lean(),
    User.find({ isActive: { $ne: false } }, { _id: 1, role: 1 }).lean(),
  ]);
  const roleOf = new Map(users.map((u) => [String(u._id), canonicalRole(u.role)]));
  // One account can have two files (the HR file and one created with the account): the HR file wins so the person is not counted twice.
  const byUser = new Map();
  for (const e of linked) {
    const k = String(e.user);
    const cur = byUser.get(k);
    if (!cur || (cur.isHrRecord === false && e.isHrRecord !== false)) byUser.set(k, e);
  }
  const out = [];
  const owner = new Map();
  // The system admin evaluates section managers by account: accounts whose role is a section manager in config/roles. Not people named direct manager in someone's file, and not roles named lead who are staff in their manager's team. Also included: those who manage above sections and are in nobody's team (finance manager, general supervisor).
  const managers = [];
  for (const e of byUser.values()) {
    const role = roleOf.get(String(e.user));
    if (!role || D.isKpiExempt(e.department)) continue;
    const sec = sectionOfRole(role);
    const heads = sec && D.managerRolesOf(sec).includes(role);
    if (!heads && !ABOVE_SECTIONS.includes(role)) continue;
    e.section = sec || D.sectionOfManagerRole(role) || null;
    e.role = role;
    e.manager = true;
    e.hrDept = D.resolveDepartment(e.department, index);
    e.dept = e.section ? sectionDept(e.section) : e.hrDept;
    managers.push(e);
  }
  for (const e of byUser.values()) {
    const role = roleOf.get(String(e.user));
    const section = role ? sectionOfRole(role) : null;
    // Disabled account, or a role with no section (top management, plain employee): outside the sections.
    if (!section) continue;
    // Two departments are exempt from evaluation, see config/performanceDepartments.isKpiExempt.
    if (D.isKpiExempt(e.department)) continue;
    e.section = section;
    e.role = role;
    e.manager = D.managerRolesOf(section).includes(role);
    e.dept = sectionDept(section);
    e.hrDept = D.resolveDepartment(e.department, index);
    owner.set(e.dept.key, section);
    out.push(e);
  }
  return { index, employees: out, roleOf, owner, managers };
}

/** A single read employee gets the same section and HR-file department that the roster assigns. */
async function decorate(employee, index) {
  const u = employee.user ? await User.findOne({ _id: employee.user, isActive: { $ne: false } }).select('role').lean() : null;
  const role = u ? canonicalRole(u.role) : null;
  // Heads above the sections (cfo) take the section they manage, as in loadOrg.
  const section = role ? (sectionOfRole(role) || (ABOVE_SECTIONS.includes(role) ? D.sectionOfManagerRole(role) : null)) : null;
  employee.section = section;
  employee.role = role;
  employee.manager = !!section && (D.managerRolesOf(section).includes(role) || ABOVE_SECTIONS.includes(role));
  employee.hrDept = D.resolveDepartment(employee.department, index);
  employee.dept = section ? sectionDept(section) : employee.hrDept;
  return employee;
}

/** A section's team: its staff accounts except its manager, who is evaluated by the system admin from the central page (otherwise he would evaluate himself). */
function sectionTeam(org, sectionKey) {
  return org.employees.filter((e) => e.section === sectionKey && !e.manager);
}

/** Who this user may evaluate (for non-full-access users): a section head evaluates the staff accounts of every section he heads (operations_manager also heads Vendors Management, cfo heads Accounting); the accounting manager evaluates the team below him; nobody else evaluates. */
function evaluableBy(org, user) {
  const role = canonicalRole(user.role);
  // A second-level rater (accounting manager) rates the team below him, not his peers at his level.
  const below = D.sectionsSubHeadedBy(role).flatMap((section) => sectionTeam(org, section).filter((e) => !D.subHeadsOf(section).includes(e.role)));
  return [...D.sectionsManagedBy(role).flatMap((section) => sectionTeam(org, section)), ...below];
}

/**
 * scope: 'managers' (default for super-admin on the central page) | 'all' (full-access only, whole company)
 * department: optional narrowing by HR department (any spelling).
 * section: the system section whose KPI page this is.
 * Every employee in the result carries `dept`, his canonical department.
 */
async function visibleEmployees(user, { scope, department, section } = {}, org) {
  org = org || await loadOrg();
  let list;

  if (isFull(user.role)) {
    // A specific section's page: the system admin sees the same section team as its manager, not the managers list.
    if (section && !scope) {
      list = sectionTeam(org, section);
    } else {
      const effective = scope || (canOverride(user.role) ? 'managers' : 'all');
      if (effective === 'managers') {
        // Section managers by account, see loadOrg.
        list = org.managers;
      } else list = org.employees;
    }
  } else {
    list = evaluableBy(org, user);
    // A section page that is not the caller's own does not show another team: the list is only who he may evaluate. Previously it returned the requested team, with scores, to any account that typed the name in the URL, and then the server refused to open any card.
    if (section) {
      const ids = new Set(sectionTeam(org, section).map((e) => String(e._id)));
      list = list.filter((e) => ids.has(String(e._id)));
    }
  }

  if (department) {
    // The department is requested by its key or its displayed name.
    const want = D.resolveDepartment(department, org.index).key;
    list = list.filter((e) => e.dept.key === department || e.dept.label === department || e.dept.key === want);
  }
  // Never let anyone grade themselves.
  return list.filter((e) => String(e.user || '') !== String(user._id));
}

// Departments present in the list with employee counts; the no-department group is last.
function groupsOf(list, org) {
  const { sectionLabel } = require('../config/sections');
  const m = new Map();
  for (const e of list) {
    const g = m.get(e.dept.key) || {
      key: e.dept.key, label: e.dept.label, labelEn: e.dept.labelEn,
      section: org.owner.get(e.dept.key) || null, count: 0,
    };
    g.count += 1;
    m.set(e.dept.key, g);
  }
  return [...m.values()]
    .map((g) => ({ ...g, sectionAr: g.section ? sectionLabel(g.section, 'ar') : '' }))
    .sort((a, b) => (a.key === D.NONE.key) - (b.key === D.NONE.key) || b.count - a.count || a.label.localeCompare(b.label, 'ar'));
}

// May this user write to this evaluation right now?
// Super-admin always can. The evaluator can while it is a draft, and again once
// an edit request has been approved (that approval is consumed on save).
function writeGuard(existing, user) {
  if (!existing) return { ok: true };
  if (canOverride(user.role)) return { ok: true, override: true };
  const mine = String(existing.evaluator) === String(user._id);
  if (!mine) return { ok: false, message: 'Only the original evaluator or a super admin can change this evaluation' };
  if (existing.status !== 'submitted') return { ok: true };
  if (existing.editRequest?.status === 'approved') return { ok: true, consumesApproval: true };
  return {
    ok: false,
    locked: true,
    message: existing.editRequest?.status === 'pending'
      ? 'This evaluation is locked — your edit request is awaiting super-admin approval'
      : 'This evaluation is submitted and locked. Request an edit and a super admin will decide.',
  };
}

const sameDept = (a, b) => D.deptFold(a) === D.deptFold(b);

/** A form that grades a head of its section (its roles hold a manager role): staff never fall back to it. */
const gradesHead = (t) => (t.roles || []).some((r) => D.managerRolesOf(t.section).includes(r));

/** The employee's section forms, in pick order: given to him by name, then by job title (spelling-folded), then by account role, then the section's general form. */
function sectionTemplateFor(employee, templates) {
  if (!employee.section) return null;
  const list = templates.filter((t) => t.active && t.section === employee.section);
  if (!list.length) return null;
  const id = String(employee._id);
  const title = nameKey(employee.jobTitle || '');
  return list.find((t) => (t.employees || []).some((x) => String(x) === id))
    || (title && list.find((t) => (t.jobTitles || []).some((j) => nameKey(j) === title)))
    || (employee.role && list.find((t) => (t.roles || []).includes(employee.role)))
    || list.find((t) => !(t.roles || []).length && !(t.employees || []).length && !(t.jobTitles || []).length)
    || null;
}

/** Forms an evaluator may choose for this employee: his section's forms (head forms only for a head) and his HR department's forms. */
function formsFor(employee, templates, index) {
  const dept = (employee.hrDept || D.resolveDepartment(employee.department, index)).key;
  return templates.filter((t) => t.active && (t.section
    ? t.section === employee.section && (employee.manager || !gradesHead(t))
    : D.resolveDepartment(t.department, index).key === dept || D.resolveDepartment(t.department, index).key === employee.dept?.key));
}

// Pick the form that applies to an employee: a section form first (sectionTemplateFor), then the older department forms where an exact job-title match wins over the department-wide fallback, then any non-head form of his section so the evaluator can open the card and switch. Departments match by canonical key, not spelling.
function templateFor(employee, templates, index) {
  const own = sectionTemplateFor(employee, templates);
  if (own) return own;
  const legacy = legacyTemplateFor(employee, templates.filter((t) => !t.section), index);
  if (legacy) return legacy;
  return templates.find((t) => t.active && employee.section && t.section === employee.section && !gradesHead(t)) || null;
}

function legacyTemplateFor(employee, templates, index) {
  // The form is chosen by the employee's HR-file department; if that department has no form (or none is set), use the form of the system section his account belongs to.
  const hr = employee.hrDept || D.resolveDepartment(employee.department, index);
  const pick = (key) => templates.filter((t) => t.active && D.resolveDepartment(t.department, index).key === key);
  let inDept = pick(hr.key);
  if (!inDept.length && employee.section) {
    const { sectionLabel } = require('../config/sections');
    for (const name of [sectionLabel(employee.section, 'ar'), employee.section]) {
      inDept = pick(D.resolveDepartment(name, index).key);
      if (inDept.length) break;
    }
  }
  const byTitle = inDept.find((t) => (t.jobTitles || []).length && t.jobTitles.includes(employee.jobTitle));
  return byTitle || inDept.find((t) => !(t.jobTitles || []).length) || inDept[0] || null;
}

// The department layer is stored under the name as written when saved, so match it in any of its spellings.
function departmentTier(settings, ...names) {
  const tiers = settings.departmentTiers || {};
  for (const n of names) if (n && tiers[n] != null) return tiers[n];
  const hit = Object.keys(tiers).find((k) => names.some((n) => n && sameDept(k, n)));
  return hit ? tiers[hit] : null;
}

const tierOf = (template, settings) => {
  const t = template?.tier || departmentTier(settings, template?.department) || 1;
  return (settings.tiers || []).find((x) => Number(x.tier) === Number(t)) || (settings.tiers || [])[0] || null;
};

// ---- Settings --------------------------------------------------------------
exports.getSettings = async (req, res) => {
  try {
    const s = await PerfSettings.getOrCreate();
    // Departments that actually have employees, by canonical name, plus the departments of existing forms so a department with a form never disappears from the list.
    const [org, tplDepts] = await Promise.all([loadOrg(), PerfTemplate.distinct('department')]);
    const names = new Map();
    // System sections with accounts, and the departments of their owners' HR files (forms are written for those).
    for (const e of org.employees) {
      names.set(e.dept.key, e.dept.label);
      if (e.hrDept && !e.hrDept.none) names.set(e.hrDept.key, e.hrDept.label);
    }
    for (const t of tplDepts) {
      const d = D.resolveDepartment(t, org.index);
      if (!d.none && !names.has(d.key)) names.set(d.key, d.label);
    }
    const departments = [...names.values()].sort((a, b) => a.localeCompare(b, 'ar'));
    res.json({
      settings: s, departments, canConfigure: canConfigure(req.user),
      // Section keys a form can belong to, with their Arabic names.
      sections: D.allSections().map((key) => ({ key, ar: sectionLabelAr(key), en: key })),
    });
  } catch (e) { fail(res, e, 'Failed to load settings'); }
};

exports.updateSettings = async (req, res) => {
  try {
    if (!canConfigure(req.user)) return res.status(403).json({ message: 'Top management only' });
    const s = await PerfSettings.getOrCreate();
    const { bands, tiers, departmentTiers, eligibilityThreshold } = req.body || {};
    if (Array.isArray(bands)) s.bands = bands;
    if (Array.isArray(tiers)) s.tiers = tiers;
    if (departmentTiers && typeof departmentTiers === 'object') s.departmentTiers = departmentTiers;
    if (eligibilityThreshold != null) s.eligibilityThreshold = Number(eligibilityThreshold);
    s.updatedBy = req.user._id;
    s.markModified('bands'); s.markModified('tiers'); s.markModified('departmentTiers');
    await s.save();
    try { emitToAll('performance:updated', { at: Date.now() }); } catch { /* non-fatal */ }
    res.json({ settings: s });
  } catch (e) { fail(res, e, 'Failed to save settings'); }
};

// ---- Templates -------------------------------------------------------------
exports.listTemplates = async (req, res) => {
  try {
    const q = {};
    if (req.query.department) q.department = req.query.department;
    if (req.query.section) q.section = req.query.section;
    if (req.query.active === 'true') q.active = true;
    const [templates, ownIds] = await Promise.all([
      PerfTemplate.find(q).sort({ section: 1, department: 1, nameAr: 1 }).lean({ virtuals: true }),
      ownEmployeeIds(req.user),
    ]);
    const editable = editableSections(req.user);
    res.json({
      templates: templates.map((t) => ({ ...t, canEdit: canEditTemplate(req.user, t, ownIds) })),
      canConfigure: canConfigure(req.user),
      // Whether a form may be added to the requested section, and which sections this user edits.
      canCreate: req.query.section ? editable.includes(req.query.section) : canConfigure(req.user),
      editableSections: editable,
    });
  } catch (e) { fail(res, e, 'Failed to list templates'); }
};

exports.getTemplate = async (req, res) => {
  try {
    const template = await PerfTemplate.findById(req.params.id).lean({ virtuals: true });
    if (!template) return res.status(404).json({ message: 'Template not found' });
    res.json({ template, canEdit: canEditTemplate(req.user, template, await ownEmployeeIds(req.user)) });
  } catch (e) { fail(res, e, 'Failed to load template'); }
};

// Weights must total 100 — a form that doesn't is a broken bonus calculation,
// so it's rejected outright rather than silently normalised.
function validateCriteria(criteria) {
  if (!Array.isArray(criteria) || !criteria.length) return 'At least one criterion is required';
  if (criteria.some((c) => !Number.isFinite(Number(c.weight)) || Number(c.weight) < 0)) return 'Every weight must be a number of 0 or more';
  const total = criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  if (Math.abs(total - 100) > 0.01) return `Weights must total 100% (currently ${Math.round(total * 100) / 100}%)`;
  if (criteria.some((c) => !c.titleAr || !String(c.titleAr).trim())) return 'Every criterion needs an Arabic title';
  const keys = criteria.map((c) => c.key);
  if (new Set(keys).size !== keys.length) return 'Duplicate criterion keys';
  return null;
}
// Stable, collision-free key for a new criterion.
const keyFor = (c, i) => c.key || `c${i + 1}_${Date.now().toString(36)}`;
const CRITERION_FIELDS = ['key', 'order', 'title', 'titleAr', 'description', 'descriptionAr', 'dataSource', 'dataSourceAr', 'group', 'groupAr', 'weight', 'scale'];
const cleanCriteria = (list) => (list || []).map((c, i) => {
  const out = {};
  for (const f of CRITERION_FIELDS) if (c[f] !== undefined) out[f] = c[f];
  out.key = keyFor(c, i);
  out.order = c.order ?? i;
  out.weight = Number(c.weight);
  if (!Array.isArray(out.scale) || !out.scale.length) delete out.scale;
  return out;
});

/** Employees a form may be given to: the section's team (and heads, for top users), as valid ids. */
async function cleanEmployees(ids, section, user) {
  const valid = (ids || []).map(String).filter((id) => mongoose.isValidObjectId(id));
  if (!valid.length || !section) return [];
  const org = await loadOrg();
  const allowed = new Set(org.employees.concat(org.managers)
    .filter((e) => e.section === section && (canConfigure(user) || !e.manager))
    .map((e) => String(e._id)));
  return [...new Set(valid.filter((id) => allowed.has(id)))];
}

// Tells every open board and settings screen to re-read; the section lets a screen ignore other sections.
const announce = (section) => { try { emitToAll('performance:updated', { at: Date.now(), section: section || null }); } catch { /* non-fatal */ } };

exports.createTemplate = async (req, res) => {
  try {
    const body = req.body || {};
    const section = String(body.section || '').trim();
    const top = canConfigure(req.user);
    if (!section && !String(body.department || '').trim()) return res.status(400).json({ message: 'Choose a section or a department' });
    if (section && !D.allSections().includes(section)) return res.status(400).json({ message: 'Unknown section' });
    const draft = { section, roles: Array.isArray(body.roles) ? body.roles.map(String) : [], employees: body.employees || [] };
    if (!canEditTemplate(req.user, draft, await ownEmployeeIds(req.user))) {
      return res.status(403).json({ message: top ? 'Not allowed' : 'Only this section\'s manager or top management can add its forms' });
    }
    const criteria = cleanCriteria(body.criteria);
    const bad = validateCriteria(criteria);
    if (bad) return res.status(400).json({ message: bad });
    if (!body.nameAr || !String(body.nameAr).trim()) return res.status(400).json({ message: 'The form needs an Arabic name' });
    const template = await PerfTemplate.create({
      name: body.name || '', nameAr: body.nameAr, description: body.description || '',
      descriptionAr: body.descriptionAr || '', department: body.department || '', section,
      roles: draft.roles, employees: await cleanEmployees(body.employees, section, req.user),
      jobTitles: body.jobTitles || [],
      // The bonus tier is compensation: set by top management only.
      tier: top ? (body.tier || 1) : 1,
      active: body.active !== false, criteria, createdBy: req.user._id,
    });
    announce(section);
    res.status(201).json({ template });
  } catch (e) { fail(res, e, 'Failed to create template'); }
};

exports.updateTemplate = async (req, res) => {
  try {
    const template = await PerfTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: 'Template not found' });
    const body = req.body || {};
    const top = canConfigure(req.user);
    const ownIds = await ownEmployeeIds(req.user);
    if (!canEditTemplate(req.user, template, ownIds)) return res.status(403).json({ message: 'Only this section\'s manager or top management can edit this form' });
    // The edited form must still be one this user may edit: a manager cannot move it to another section or point it at a head.
    const next = {
      section: body.section !== undefined ? String(body.section || '').trim() : template.section,
      roles: Array.isArray(body.roles) ? body.roles.map(String) : template.roles,
      employees: body.employees !== undefined ? body.employees : template.employees,
    };
    if (next.section && !D.allSections().includes(next.section)) return res.status(400).json({ message: 'Unknown section' });
    if (!canEditTemplate(req.user, next, ownIds)) return res.status(403).json({ message: 'Not allowed' });
    if (body.criteria) {
      const criteria = cleanCriteria(body.criteria);
      const bad = validateCriteria(criteria);
      if (bad) return res.status(400).json({ message: bad });
      template.criteria = criteria;
    }
    for (const f of ['name', 'nameAr', 'description', 'descriptionAr', 'department', 'jobTitles', 'active']) {
      if (body[f] !== undefined) template[f] = body[f];
    }
    if (top && body.tier !== undefined) template.tier = body.tier;
    template.section = next.section;
    template.roles = next.roles;
    if (body.employees !== undefined) template.employees = await cleanEmployees(body.employees, next.section, req.user);
    if (!template.section && !String(template.department || '').trim()) return res.status(400).json({ message: 'Choose a section or a department' });
    template.updatedBy = req.user._id;
    await template.save();
    announce(template.section);
    res.json({ template });
  } catch (e) { fail(res, e, 'Failed to update template'); }
};

exports.deleteTemplate = async (req, res) => {
  try {
    const template = await PerfTemplate.findById(req.params.id).lean();
    if (!template) return res.status(404).json({ message: 'Template not found' });
    if (!canEditTemplate(req.user, template, await ownEmployeeIds(req.user))) return res.status(403).json({ message: 'Only this section\'s manager or top management can delete this form' });
    // Past evaluations must stay readable, so a used form is retired, not removed.
    const used = await PerfEvaluation.countDocuments({ template: req.params.id });
    if (used > 0) {
      await PerfTemplate.findByIdAndUpdate(req.params.id, { active: false, updatedBy: req.user._id });
      announce(template.section);
      return res.json({ ok: true, deactivated: true, message: `Template has ${used} evaluations — deactivated instead of deleted` });
    }
    await PerfTemplate.findByIdAndDelete(req.params.id);
    announce(template.section);
    res.json({ ok: true, deleted: true });
  } catch (e) { fail(res, e, 'Failed to delete template'); }
};

// ---- The manager's team board ---------------------------------------------
// One card per employee: who they are, which form applies, and whether they
// have been graded for this period (and with what result).
exports.getTeam = async (req, res) => {
  try {
    const period = parsePeriod(req.query.period);
    const periodKey = periodKeyOf(period);
    const [org, templates, settings] = await Promise.all([
      loadOrg(),
      PerfTemplate.find({ active: true }).lean(),
      PerfSettings.getOrCreate(),
    ]);
    const employees = await visibleEmployees(req.user, {
      scope: req.query.scope, department: req.query.department, section: req.query.section,
    }, org);
    const ids = employees.map((e) => e._id);
    const evals = await PerfEvaluation.find({ employee: { $in: ids }, periodKey }).lean();
    const byEmp = new Map(evals.map((v) => [String(v.employee), v]));

    const members = employees.map((e) => {
      const template = templateFor(e, templates, org.index);
      const ev = byEmp.get(String(e._id)) || null;
      return {
        _id: e._id,
        name: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
        // The canonical department name and its key for grouping cards under it.
        jobTitle: e.jobTitle || '', department: e.dept.label, departmentEn: e.dept.labelEn,
        departmentKey: e.dept.key,
        employeeNumber: e.employeeNumber || '', photo: e.photo || '',
        template: template ? { _id: template._id, nameAr: template.nameAr, name: template.name || '', tier: template.tier, criteriaCount: (template.criteria || []).length } : null,
        evaluation: ev ? {
          _id: ev._id, status: ev.status, percentage: ev.percentage,
          weightedScore: ev.weightedScore, band: ev.band, bonusMultiplier: ev.bonusMultiplier,
          updatedAt: ev.updatedAt,
          // So the card can show a padlock / "awaiting approval" chip without a
          // second request.
          editRequestStatus: ev.editRequest?.status || 'none',
          locked: ev.status === 'submitted'
            && !canOverride(req.user.role)
            && ev.editRequest?.status !== 'approved',
        } : null,
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'ar'));

    const done = members.filter((m) => m.evaluation?.status === 'submitted');
    const scored = done.filter((m) => m.evaluation.percentage != null);
    const summary = {
      total: members.length,
      evaluated: done.length,
      drafts: members.filter((m) => m.evaluation?.status === 'draft').length,
      pending: members.filter((m) => !m.evaluation).length,
      noTemplate: members.filter((m) => !m.template).length,
      avgPercentage: scored.length ? Math.round((scored.reduce((s, m) => s + m.evaluation.percentage, 0) / scored.length) * 10) / 10 : null,
      totalBonusSalaries: Math.round(done.reduce((s, m) => s + (m.evaluation.bonusMultiplier || 0), 0) * 100) / 100,
      byBand: (settings.bands || []).map((b) => ({
        key: b.key, ar: b.ar, en: b.en, color: b.color,
        count: done.filter((m) => m.evaluation.band === b.key).length,
      })),
    };
    res.json({
      period, periodKey, periodLabel: periodLabel(period), members, summary, settings,
      // Departments present in the list; cards are shown under them on web and mobile.
      groups: groupsOf(employees, org),
      // Whether this user may edit the requested section's items and weights (opens the section's KPI settings).
      canEditKpis: !!req.query.section && editableSections(req.user).includes(req.query.section),
    });
  } catch (e) { fail(res, e, 'Failed to load team'); }
};

// ---- Evaluations -----------------------------------------------------------
exports.listEvaluations = async (req, res) => {
  try {
    const q = {};
    if (req.query.period) q.periodKey = periodKeyOf(parsePeriod(req.query.period));
    if (req.query.employee) q.employee = req.query.employee;
    if (req.query.status) q.status = req.query.status;
    if (!isFull(req.user.role)) {
      const allowed = await visibleEmployees(req.user);
      q.employee = { $in: allowed.map((e) => e._id) };
    }
    let evaluations = await PerfEvaluation.find(q).sort({ updatedAt: -1 }).limit(1000).lean();
    // The department saved on an evaluation is a text snapshot; filter by its canonical key.
    if (req.query.department) {
      const index = await D.loadIndex();
      const want = D.resolveDepartment(req.query.department, index).key;
      evaluations = evaluations.filter((v) => D.resolveDepartment(v.department, index).key === want);
    }
    res.json({ evaluations });
  } catch (e) { fail(res, e, 'Failed to list evaluations'); }
};

// The evaluation form: the employee, the form that applies, and any answers
// already saved for this period.
exports.getEvaluationForm = async (req, res) => {
  try {
    const period = parsePeriod(req.query.period);
    const periodKey = periodKeyOf(period);
    const employee = await Employee.findById(req.params.employeeId).lean();
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    if (!isFull(req.user.role)) {
      const allowed = await visibleEmployees(req.user);
      if (!allowed.some((e) => String(e._id) === String(employee._id))) {
        return res.status(403).json({ message: 'Not your team member' });
      }
    }
    const [templates, settings, index] = await Promise.all([
      PerfTemplate.find({ active: true }).lean({ virtuals: true }),
      PerfSettings.getOrCreate(),
      D.loadIndex(),
    ]);
    if (D.isKpiExempt(employee.department)) return res.status(400).json({ message: 'هذا الموظّف لا تقييمَ أداءٍ له (سعودة / مواءمة)', code: 'KPI_EXEMPT' });
    await decorate(employee, index);
    const choices = formsFor(employee, templates, index);
    const auto = templateFor(employee, templates, index);
    // A chosen form must be one that applies to this employee; top roles may open any.
    const template = req.query.template
      ? templates.find((t) => String(t._id) === req.query.template && (isFull(req.user.role) || String(auto?._id) === req.query.template || choices.some((c) => String(c._id) === req.query.template))) || null
      : auto;
    const evaluation = template
      ? await PerfEvaluation.findOne({ employee: employee._id, periodKey, template: template._id }).lean()
      : null;

    res.json({
      employee: {
        _id: employee._id,
        name: employee.arabicName || `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
        jobTitle: employee.jobTitle || '', department: employee.dept.label,
        departmentEn: employee.dept.labelEn, departmentKey: employee.dept.key,
        employeeNumber: employee.employeeNumber || '',
      },
      template: template || null,
      tier: tierOf(template, settings),
      evaluation,
      period, periodKey, periodLabel: periodLabel(period),
      settings,
      // Can this user write to it right now, and if not, why?
      permissions: (() => {
        const g = writeGuard(evaluation, req.user);
        return {
          canEdit: g.ok,
          locked: !!g.locked,
          reason: g.ok ? '' : g.message,
          canOverride: canOverride(req.user.role),
          canRequestEdit: !!evaluation
            && evaluation.status === 'submitted'
            && !canOverride(req.user.role)
            && String(evaluation.evaluator) === String(req.user._id)
            && evaluation.editRequest?.status !== 'pending'
            && evaluation.editRequest?.status !== 'approved',
          editRequest: evaluation?.editRequest || null,
        };
      })(),
      // Other forms in this department, so the evaluator can switch if the
      // employee's job maps to more than one.
      alternatives: (auto && !choices.some((c) => String(c._id) === String(auto._id)) ? [auto, ...choices] : choices)
        .map((t) => ({ _id: t._id, nameAr: t.nameAr, name: t.name || '' })),
    });
  } catch (e) { fail(res, e, 'Failed to load evaluation form'); }
};

// Create or update the evaluation for (employee × period × template).
exports.saveEvaluation = async (req, res) => {
  try {
    const body = req.body || {};
    const period = body.period || parsePeriod(body.periodKey);
    const periodKey = periodKeyOf(period);

    const [employee, template, settings, index] = await Promise.all([
      Employee.findById(body.employee).lean(),
      PerfTemplate.findById(body.template).lean(),
      PerfSettings.getOrCreate(),
      D.loadIndex(),
    ]);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    if (!template) return res.status(404).json({ message: 'Template not found' });
    if (D.isKpiExempt(employee.department)) return res.status(400).json({ message: 'هذا الموظّف لا تقييمَ أداءٍ له (سعودة / مواءمة)', code: 'KPI_EXEMPT' });
    await decorate(employee, index);

    if (!isFull(req.user.role)) {
      const allowed = await visibleEmployees(req.user);
      const member = allowed.find((e) => String(e._id) === String(employee._id));
      if (!member) return res.status(403).json({ message: 'Not your team member' });
      // The form must be one that applies to this employee (his section's or his department's).
      const active = await PerfTemplate.find({ active: true }).lean();
      const fits = String(templateFor(member, active, index)?._id) === String(template._id)
        || formsFor(member, active, index).some((t) => String(t._id) === String(template._id));
      if (!fits) return res.status(400).json({ message: 'This form does not apply to this employee', code: 'FORM_NOT_APPLICABLE' });
    }

    // Only keep answers that match a real criterion on this form.
    const byKey = new Map((template.criteria || []).map((c) => [c.key, c]));
    const answers = (body.answers || [])
      .filter((a) => byKey.has(a.criterionKey))
      .map((a) => ({
        criterionKey: a.criterionKey,
        score: a.score == null || a.score === '' ? null : Math.min(5, Math.max(1, Number(a.score))),
        note: a.note || '',
      }));

    const tier = tierOf(template, settings);
    const totals = computeScore(
      answers.filter((a) => a.score != null).map((a) => ({ score: a.score, weight: byKey.get(a.criterionKey).weight })),
      { bands: settings.bands, tier, totalWeight: 100 }
    );

    // A submitted evaluation is locked to its evaluator until super-admin says
    // otherwise — check BEFORE writing anything.
    const existing = await PerfEvaluation.findOne({
      employee: employee._id, periodKey, template: template._id,
    }).lean();
    const guard = writeGuard(existing, req.user);
    if (!guard.ok) return res.status(403).json({ message: guard.message, locked: !!guard.locked });

    const submitting = body.status === 'submitted';
    if (submitting && !totals.complete) {
      return res.status(400).json({ message: 'All criteria must be answered before submitting' });
    }

    const doc = {
      template: template._id, employee: employee._id,
      employeeName: employee.arabicName || `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
      // Save the canonical department name so the evaluation agrees with lists and numbers.
      department: employee.dept.none ? '' : employee.dept.label, jobTitle: employee.jobTitle || '',
      evaluator: req.user._id,
      evaluatorName: body.evaluatorName || `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
      period, periodKey, evaluationDate: body.evaluationDate || '',
      answers,
      criteriaSnapshot: (template.criteria || []).map((c) => ({
        key: c.key, order: c.order, titleAr: c.titleAr, title: c.title,
        descriptionAr: c.descriptionAr, description: c.description, weight: c.weight,
        groupAr: c.groupAr || '', group: c.group || '',
      })),
      weightedScore: totals.weightedScore, percentage: totals.percentage, band: totals.band,
      tier: tier ? tier.tier : null, bonusMultiplier: totals.bonusMultiplier,
      monthlySalary: body.monthlySalary == null || body.monthlySalary === '' ? null : Number(body.monthlySalary),
      notes: body.notes || '',
      status: submitting ? 'submitted' : 'draft',
      submittedAt: submitting ? new Date() : null,
    };

    // Correcting an already-submitted evaluation: keep the trail, and consume
    // the approval so one approval buys exactly one correction.
    const push = {};
    if (existing && existing.status === 'submitted') {
      // An evaluation never travels backwards to draft — otherwise an approved
      // correction could be saved as a draft and stay editable forever.
      doc.status = 'submitted';
      doc.submittedAt = existing.submittedAt || new Date();
      push.editHistory = {
        at: new Date(),
        byName: doc.evaluatorName || '',
        previousPercentage: existing.percentage ?? null,
        newPercentage: totals.percentage ?? null,
        reason: body.editReason || existing.editRequest?.reason || '',
      };
      doc.editRequest = {
        ...(existing.editRequest || {}),
        status: 'none', reason: '', requestedBy: null, requestedByName: '',
        requestedAt: null, decisionNote: guard.override ? 'Edited directly by super admin' : '',
      };
      // Super-admin corrections keep the original evaluator's name on the
      // record; the history line says who actually changed it.
      doc.evaluator = existing.evaluator;
      doc.evaluatorName = existing.evaluatorName;
    }

    const evaluation = await PerfEvaluation.findOneAndUpdate(
      { employee: employee._id, periodKey, template: template._id },
      { $set: doc, ...(push.editHistory ? { $push: { editHistory: push.editHistory } } : {}) },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    try { emitToAll('performance:updated', { at: Date.now(), employee: String(employee._id) }); } catch { /* non-fatal */ }
    res.json({ evaluation, totals });
  } catch (e) { fail(res, e, 'Failed to save evaluation'); }
};

// ---- Edit requests ---------------------------------------------------------
// A manager who has submitted an evaluation cannot change it. They ask here;
// super-admin decides. Approval unlocks exactly one save.
exports.requestEdit = async (req, res) => {
  try {
    const ev = await PerfEvaluation.findById(req.params.id);
    if (!ev) return res.status(404).json({ message: 'Evaluation not found' });
    if (ev.status !== 'submitted') return res.status(400).json({ message: 'Only a submitted evaluation needs an edit request' });
    if (String(ev.evaluator) !== String(req.user._id) && !canOverride(req.user.role)) {
      return res.status(403).json({ message: 'Only the original evaluator can request an edit' });
    }
    if (ev.editRequest?.status === 'pending') return res.status(400).json({ message: 'A request is already pending' });
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ message: 'Please say why the evaluation needs changing' });

    ev.editRequest = {
      status: 'pending', reason,
      requestedBy: req.user._id,
      requestedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
      requestedAt: new Date(),
      decidedBy: null, decidedByName: '', decidedAt: null, decisionNote: '',
    };
    await ev.save();
    try {
      emitToAll('performance:editRequest', { at: Date.now(), evaluation: String(ev._id) });
      emitToAll('performance:updated', { at: Date.now() });
    } catch { /* non-fatal */ }
    res.json({ evaluation: ev });
  } catch (e) { fail(res, e, 'Failed to submit the request'); }
};

// Super-admin only: approve (unlock one edit) or reject (stays locked).
exports.decideEditRequest = async (req, res) => {
  try {
    if (!canOverride(req.user.role)) return res.status(403).json({ message: 'Super admin only' });
    const ev = await PerfEvaluation.findById(req.params.id);
    if (!ev) return res.status(404).json({ message: 'Evaluation not found' });
    if (ev.editRequest?.status !== 'pending') return res.status(400).json({ message: 'No pending request on this evaluation' });

    const approve = req.body?.decision === 'approve';
    ev.editRequest.status = approve ? 'approved' : 'rejected';
    ev.editRequest.decidedBy = req.user._id;
    ev.editRequest.decidedByName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();
    ev.editRequest.decidedAt = new Date();
    ev.editRequest.decisionNote = String(req.body?.note || '').trim();
    await ev.save();
    try {
      emitToAll('performance:editRequest', { at: Date.now(), evaluation: String(ev._id), decision: ev.editRequest.status });
      emitToAll('performance:updated', { at: Date.now() });
    } catch { /* non-fatal */ }
    res.json({ evaluation: ev });
  } catch (e) { fail(res, e, 'Failed to record the decision'); }
};

// The super-admin inbox: every request awaiting a decision (plus recently
// decided ones, so the outcome is visible for a while).
exports.listEditRequests = async (req, res) => {
  try {
    if (!canOverride(req.user.role)) return res.status(403).json({ message: 'Super admin only' });
    const [pending, recent] = await Promise.all([
      PerfEvaluation.find({ 'editRequest.status': 'pending' }).sort({ 'editRequest.requestedAt': -1 }).lean(),
      PerfEvaluation.find({ 'editRequest.status': { $in: ['approved', 'rejected'] } })
        .sort({ 'editRequest.decidedAt': -1 }).limit(50).lean(),
    ]);
    res.json({ pending, recent });
  } catch (e) { fail(res, e, 'Failed to load requests'); }
};

exports.getEvaluation = async (req, res) => {
  try {
    const evaluation = await PerfEvaluation.findById(req.params.id).lean();
    if (!evaluation) return res.status(404).json({ message: 'Evaluation not found' });
    if (!isFull(req.user.role)) {
      const allowed = await visibleEmployees(req.user);
      if (!allowed.some((e) => String(e._id) === String(evaluation.employee))) {
        return res.status(403).json({ message: 'Not your team member' });
      }
    }
    const [template, settings] = await Promise.all([
      PerfTemplate.findById(evaluation.template).lean({ virtuals: true }),
      PerfSettings.getOrCreate(),
    ]);
    res.json({ evaluation, template, settings });
  } catch (e) { fail(res, e, 'Failed to load evaluation'); }
};

exports.deleteEvaluation = async (req, res) => {
  try {
    const evaluation = await PerfEvaluation.findById(req.params.id).lean();
    if (!evaluation) return res.status(404).json({ message: 'Evaluation not found' });
    // The evaluator may clear their own draft; only full-access may remove a
    // submitted one.
    const mine = String(evaluation.evaluator) === String(req.user._id);
    if (!isFull(req.user.role) && !(mine && evaluation.status === 'draft')) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    await PerfEvaluation.findByIdAndDelete(req.params.id);
    try { emitToAll('performance:updated', { at: Date.now() }); } catch { /* non-fatal */ }
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'Failed to delete evaluation'); }
};

// ---- Company-wide view (super admin) --------------------------------------
exports.getOverview = async (req, res) => {
  try {
    if (!isFull(req.user.role)) return res.status(403).json({ message: 'Not allowed' });
    const period = parsePeriod(req.query.period);
    const periodKey = periodKeyOf(period);
    const [org, evals, settings, templates] = await Promise.all([
      loadOrg(),
      PerfEvaluation.find({ periodKey }).lean(),
      PerfSettings.getOrCreate(),
      PerfTemplate.find({ active: true }).lean(),
    ]);
    const { employees } = org;
    const { sectionLabel } = require('../config/sections');

    // The department here is the department in the lists.
    // The roster comes from loadOrg, and an evaluation is attributed to its owner's current department in his file, not the text saved on it, so what is counted under a department is what is displayed under it. Someone who left the roster has his department read from the evaluation snapshot.
    const deptOfEmp = new Map(employees.map((e) => [String(e._id), e.dept]));
    const deptOfEval = (v) => deptOfEmp.get(String(v.employee)) || D.resolveDepartment(v.department, org.index);
    const submitted = evals.filter((e) => e.status === 'submitted');

    const depts = new Map();
    const bucket = (d) => {
      if (!depts.has(d.key)) depts.set(d.key, { dept: d, headcount: 0, rows: [] });
      return depts.get(d.key);
    };
    for (const e of employees) bucket(e.dept).headcount += 1;
    for (const v of submitted) {
      // An old evaluation of someone who now has none does not create a department row in the overview.
      if (!deptOfEmp.has(String(v.employee)) && D.isKpiExempt(v.department)) continue;
      bucket(deptOfEval(v)).rows.push(v);
    }

    const departments = [...depts.values()].map(({ dept, headcount, rows }) => {
      const scored = rows.filter((r) => r.percentage != null);
      const section = org.owner.get(dept.key) || null;
      return {
        department: dept.label,
        departmentEn: dept.labelEn,
        departmentKey: dept.key,
        // The section page an evaluation is made from; empty for a department no page owns.
        section, sectionAr: section ? sectionLabel(section, 'ar') : '',
        headcount,
        evaluated: rows.length,
        coverage: headcount ? Math.round((rows.length / headcount) * 1000) / 10 : 0,
        avgPercentage: scored.length ? Math.round((scored.reduce((s, r) => s + r.percentage, 0) / scored.length) * 10) / 10 : null,
        bonusSalaries: Math.round(rows.reduce((s, r) => s + (r.bonusMultiplier || 0), 0) * 100) / 100,
        tier: departmentTier(settings, dept.label, dept.labelEn)
          || (templates.find((t) => D.resolveDepartment(t.department, org.index).key === dept.key)?.tier ?? null),
        byBand: (settings.bands || []).map((b) => ({ key: b.key, count: rows.filter((r) => r.band === b.key).length })),
      };
    }).sort((a, b) => (a.departmentKey === D.NONE.key) - (b.departmentKey === D.NONE.key)
      || a.department.localeCompare(b.department, 'ar'));

    const scoredAll = submitted.filter((r) => r.percentage != null);
    res.json({
      period, periodKey, periodLabel: periodLabel(period),
      totals: {
        headcount: employees.length,
        evaluated: submitted.length,
        drafts: evals.length - submitted.length,
        coverage: employees.length ? Math.round((submitted.length / employees.length) * 1000) / 10 : 0,
        avgPercentage: scoredAll.length ? Math.round((scoredAll.reduce((s, r) => s + r.percentage, 0) / scoredAll.length) * 10) / 10 : null,
        // A count of monthly salaries, not currency — the system holds no payroll.
        totalBonusSalaries: Math.round(submitted.reduce((s, r) => s + (r.bonusMultiplier || 0), 0) * 100) / 100,
        byBand: (settings.bands || []).map((b) => ({
          key: b.key, ar: b.ar, en: b.en, color: b.color,
          count: submitted.filter((r) => r.band === b.key).length,
        })),
      },
      departments,
      settings,
    });
  } catch (e) { fail(res, e, 'Failed to load overview'); }
};
