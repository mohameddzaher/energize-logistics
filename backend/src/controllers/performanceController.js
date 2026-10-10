/**
 * Performance (KPI) evaluation — تقييم الأداء.
 *
 * Who sees whom:
 *   • super_admin / admin / it_manager / it_specialist → the whole company, and
 *     super_admin alone may edit the forms, the weights, the bands and the tiers.
 *   • a section manager → the employees of the HR department(s) his section
 *     owns, and nobody else's. One rule (config/performanceDepartments) decides
 *     the list, the permission to grade and the per-department numbers.
 *
 * The score itself is computed in ONE place (config/performanceConfig.computeScore)
 * so the live preview, the saved record and the PDF can never disagree.
 */
const Employee = require('../models/Employee');
const User = require('../models/User');
const PerfTemplate = require('../models/PerfTemplate');
const PerfEvaluation = require('../models/PerfEvaluation');
const PerfSettings = require('../models/PerfSettings');
const { computeScore } = require('../config/performanceConfig');
const D = require('../config/performanceDepartments');
const { canonicalRole, sectionOfRole } = require('../config/roles');
const { emitToAll } = require('../websocket/socketManager');

// Who may SEE everything (read-only oversight).
const FULL_ACCESS = ['super_admin', 'admin', 'it_manager', 'it_specialist'];
// Who may EDIT the grading rules AND override a locked evaluation AND decide
// edit requests. Deliberately just super_admin: these are compensation
// decisions, and a submitted grade the employee has been told must not be
// quietly rewritten by anyone else.
const CONFIG_ROLES = ['super_admin'];

const isFull = (role) => FULL_ACCESS.includes(role);
const canConfigure = (role) => CONFIG_ROLES.includes(role);
const canOverride = (role) => CONFIG_ROLES.includes(role);
// Anyone whose role names them a manager/head/lead can grade their department.
const isManagerRole = (role = '') =>
  isFull(role) || /(_manager|_head|_lead|^moderator$|^operations_manager$|^cfo$)/.test(role);

const fail = (res, e, msg) => res.status(500).json({ message: msg || e.message });

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
 * ── الملاكُ كما تراه صفحاتُ التقييم: حساباتُ النظام ─────────────────────────
 *
 * من يُقيَّم ومن يقيِّم يُعرَفان من **حسابات النظام** لا من خانة القسم في ملفّ
 * الموارد البشريّة (قرارُ صاحب الشركة): الحسابُ الذي دورُه مديرُ قسمٍ يقيّم،
 * والحساباتُ التي دورُها موظّفُ ذلك القسم تُقيَّم — كما في config/roles.
 *
 * فمن لا حسابَ له (سائقٌ، مندوب) لا يدخل تقييمَ الأقسام، ومن نُقل دورُه من
 * قسمٍ إلى قسم انتقل معه في اللحظة نفسِها، بلا تعديلٍ في ملفّه.
 *
 * كلُّ موظّفٍ في الملاك عليه:
 *   section   قسمُ النظام الذي ينتمي إليه دورُه
 *   manager   أهو مديرُ ذلك القسم
 *   dept      القسمُ كما يُعرَض ويُجمَع: قسمُ النظام باسمه العربيّ
 *   hrDept    قسمُه في ملفّه — يُختار به نموذجُ التقييم إن وُجد له نموذج
 */
const EMP_FIELDS = 'arabicName firstName lastName jobTitle department employeeNumber photo user directManager isHrRecord employmentStatus';
// من يدير فوق الأقسام — يقيّمه مديرُ النظام مع مديري الأقسام.
const ABOVE_SECTIONS = ['cfo', 'moderator'];
const sectionDept = (section) => {
  const { sectionLabel } = require('../config/sections');
  return { key: `sec:${section}`, label: sectionLabel(section, 'ar'), labelEn: section, known: true, section };
};

async function loadOrg() {
  const [index, linked, users] = await Promise.all([
    D.loadIndex(),
    Employee.find({ employmentStatus: { $ne: 'terminated' }, user: { $ne: null } }).select(EMP_FIELDS).lean(),
    User.find({ isActive: { $ne: false } }, { _id: 1, role: 1 }).lean(),
  ]);
  const roleOf = new Map(users.map((u) => [String(u._id), canonicalRole(u.role)]));
  // حسابٌ واحدٌ قد يكون له ملفّان (ملفُّ الموارد وملفٌّ وُلد مع الحساب): يُؤخذ
  // ملفُّ الموارد البشريّة، فلا يُعَدّ الشخصُ مرّتين.
  const byUser = new Map();
  for (const e of linked) {
    const k = String(e.user);
    const cur = byUser.get(k);
    if (!cur || (cur.isHrRecord === false && e.isHrRecord !== false)) byUser.set(k, e);
  }
  const out = [];
  const owner = new Map();
  // ── ومن يقيّمهم مديرُ النظام: مديرو الأقسام بحساباتهم ────────────────────
  // الحسابُ الذي دورُه مديرُ قسمٍ في config/roles — لا من كُتب «مديرًا مباشرًا»
  // في ملفّ أحد، ولا من في اسم دوره «lead» وهو موظّفٌ في فريق مديره (كان
  // مديرُ المشروع يظهر هنا وفي فريق مدير قطاعه معًا). ومعهم من يدير فوق
  // الأقسام وليس في فريق أحد: المديرُ الماليّ والمشرفُ العامّ.
  const managers = [];
  for (const e of byUser.values()) {
    const role = roleOf.get(String(e.user));
    if (!role || D.isKpiExempt(e.department)) continue;
    const sec = sectionOfRole(role);
    const heads = sec && D.managerRolesOf(sec).includes(role);
    if (!heads && !ABOVE_SECTIONS.includes(role)) continue;
    e.section = sec || D.sectionOfManagerRole(role) || null;
    e.manager = true;
    e.hrDept = D.resolveDepartment(e.department, index);
    e.dept = e.section ? sectionDept(e.section) : e.hrDept;
    managers.push(e);
  }
  for (const e of byUser.values()) {
    const role = roleOf.get(String(e.user));
    const section = role ? sectionOfRole(role) : null;
    // حسابٌ معطَّل، أو دورٌ لا قسمَ له (الإدارةُ العليا، «موظّف») — خارجَ الأقسام.
    if (!section) continue;
    // «سعودة» و«مواءمة» لا تقييمَ لهم — راجع config/performanceDepartments.isKpiExempt.
    if (D.isKpiExempt(e.department)) continue;
    e.section = section;
    e.manager = D.managerRolesOf(section).includes(role);
    e.dept = sectionDept(section);
    e.hrDept = D.resolveDepartment(e.department, index);
    owner.set(e.dept.key, section);
    out.push(e);
  }
  return { index, employees: out, roleOf, owner, managers };
}

/** الموظّفُ المقروءُ وحدَه يُحمَّل ما يُحمَّله الملاك: قسمُ حسابه وقسمُ ملفّه. */
async function decorate(employee, index) {
  const u = employee.user ? await User.findOne({ _id: employee.user, isActive: { $ne: false } }).select('role').lean() : null;
  const section = u ? sectionOfRole(canonicalRole(u.role)) : null;
  employee.section = section;
  employee.hrDept = D.resolveDepartment(employee.department, index);
  employee.dept = section ? sectionDept(section) : employee.hrDept;
  return employee;
}

/**
 * فريقُ قسمٍ من أقسام النظام: حساباتُ موظّفيه — إلّا مديرَه. المديرُ يقيّمه
 * مديرُ النظام من الصفحة المركزيّة، وإلّا قيَّم نفسَه.
 */
function sectionTeam(org, sectionKey) {
  return org.employees.filter((e) => e.section === sectionKey && !e.manager);
}

/**
 * مَن يحقّ لهذا المستخدم تقييمُه (لغير أصحاب الاطّلاع الكامل): مديرُ القسم
 * يقيّم حساباتِ موظّفي قسمه، ولا أحدَ غيرُه يقيّم.
 */
function evaluableBy(org, user) {
  const section = D.sectionOfManagerRole(canonicalRole(user.role));
  return section ? sectionTeam(org, section) : [];
}

/**
 * scope: 'managers' (default for super-admin on the central page)
 *        | 'all' (full-access only — the whole company)
 * department: optional narrowing by HR department (any spelling of it).
 * section: the system section whose KPI page this is.
 *
 * كلُّ موظّفٍ في الناتج عليه `dept` — قسمُه المعتمد.
 */
async function visibleEmployees(user, { scope, department, section } = {}, org) {
  org = org || await loadOrg();
  let list;

  if (isFull(user.role)) {
    // ── صفحةُ قسمٍ بعينه ─────────────────────────────────────────────────
    // مديرُ النظام يرى فيها فريقَ القسم نفسَه الذي يراه مديرُه، لا قائمةَ
    // المديرين.
    if (section && !scope) {
      list = sectionTeam(org, section);
    } else {
      const effective = scope || (canOverride(user.role) ? 'managers' : 'all');
      if (effective === 'managers') {
        // مديرو الأقسام بحساباتهم — راجع loadOrg.
        list = org.managers;
      } else list = org.employees;
    }
  } else {
    list = evaluableBy(org, user);
    // وصفحةُ قسمٍ ليس قسمَه لا تُريه فريقَ غيره: القائمةُ هي ما يحقّ له
    // تقييمُه. (كانت تردّ فريقَ القسم المطلوب لأيّ حسابٍ يكتب اسمَه في الرابط
    // — ومعه درجاتُ الفريق — ثمّ يرفض الخادمُ فتحَ أيّ بطاقةٍ منها.)
    if (section) {
      const ids = new Set(sectionTeam(org, section).map((e) => String(e._id)));
      list = list.filter((e) => ids.has(String(e._id)));
    }
  }

  if (department) {
    // القسمُ يُطلَب بمفتاحه أو باسمه كما عُرض.
    const want = D.resolveDepartment(department, org.index).key;
    list = list.filter((e) => e.dept.key === department || e.dept.label === department || e.dept.key === want);
  }
  // Never let anyone grade themselves.
  return list.filter((e) => String(e.user || '') !== String(user._id));
}

// الأقسامُ الممثَّلة في قائمة، بعدد موظّفيها — «بدون قسم» آخرًا.
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

// Pick the form that applies to an employee: an exact job-title match wins over
// the department-wide fallback. القسمُ يُطابَق بمفتاحه المعتمد لا بحروفه: نموذجٌ
// كُتب لـ«تخليص جمركي» يخدم «التخليص الجمركي».
const sameDept = (a, b) => D.deptFold(a) === D.deptFold(b);
function templateFor(employee, templates, index) {
  // النموذجُ يُختار بقسم الموظّف في ملفّه؛ فإن لم يكن لذلك القسم نموذجٌ (أو
  // لا قسمَ في ملفّه) فبنموذج قسم النظام الذي ينتمي إليه حسابُه.
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

// طبقةُ القسم محفوظةٌ باسمه كما كُتب يومَ الحفظ — فتُقرأ بأيّ صورةٍ من صوره.
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
    // الأقسامُ التي فيها موظّفون فعلًا، بأسمائها المعتمدة — ومعها أقسامُ النماذج
    // القائمة، كي لا يختفي من القائمة قسمٌ له نموذج.
    const [org, tplDepts] = await Promise.all([loadOrg(), PerfTemplate.distinct('department')]);
    const names = new Map();
    // أقسامُ النظام التي فيها حسابات، وأقسامُ ملفّات أصحابها (لها تُكتب النماذج).
    for (const e of org.employees) {
      names.set(e.dept.key, e.dept.label);
      if (e.hrDept && !e.hrDept.none) names.set(e.hrDept.key, e.hrDept.label);
    }
    for (const t of tplDepts) {
      const d = D.resolveDepartment(t, org.index);
      if (!d.none && !names.has(d.key)) names.set(d.key, d.label);
    }
    const departments = [...names.values()].sort((a, b) => a.localeCompare(b, 'ar'));
    res.json({ settings: s, departments, canConfigure: canConfigure(req.user.role) });
  } catch (e) { fail(res, e, 'Failed to load settings'); }
};

exports.updateSettings = async (req, res) => {
  try {
    if (!canConfigure(req.user.role)) return res.status(403).json({ message: 'Super admin only' });
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
    if (req.query.active === 'true') q.active = true;
    const templates = await PerfTemplate.find(q).sort({ department: 1, nameAr: 1 }).lean({ virtuals: true });
    res.json({ templates, canConfigure: canConfigure(req.user.role) });
  } catch (e) { fail(res, e, 'Failed to list templates'); }
};

exports.getTemplate = async (req, res) => {
  try {
    const template = await PerfTemplate.findById(req.params.id).lean({ virtuals: true });
    if (!template) return res.status(404).json({ message: 'Template not found' });
    res.json({ template });
  } catch (e) { fail(res, e, 'Failed to load template'); }
};

// Weights must total 100 — a form that doesn't is a broken bonus calculation,
// so it's rejected outright rather than silently normalised.
function validateCriteria(criteria) {
  if (!Array.isArray(criteria) || !criteria.length) return 'At least one criterion is required';
  const total = criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  if (Math.abs(total - 100) > 0.01) return `Weights must total 100% (currently ${Math.round(total * 100) / 100}%)`;
  if (criteria.some((c) => !c.titleAr || !String(c.titleAr).trim())) return 'Every criterion needs an Arabic title';
  const keys = criteria.map((c) => c.key);
  if (new Set(keys).size !== keys.length) return 'Duplicate criterion keys';
  return null;
}
// Stable, collision-free key for a new criterion.
const keyFor = (c, i) => c.key || `c${i + 1}_${Date.now().toString(36)}`;

exports.createTemplate = async (req, res) => {
  try {
    if (!canConfigure(req.user.role)) return res.status(403).json({ message: 'Super admin only' });
    const body = req.body || {};
    const criteria = (body.criteria || []).map((c, i) => ({ ...c, key: keyFor(c, i), order: c.order ?? i }));
    const bad = validateCriteria(criteria);
    if (bad) return res.status(400).json({ message: bad });
    const template = await PerfTemplate.create({
      name: body.name || '', nameAr: body.nameAr, description: body.description || '',
      descriptionAr: body.descriptionAr || '', department: body.department,
      jobTitles: body.jobTitles || [], tier: body.tier || 1,
      active: body.active !== false, criteria, createdBy: req.user._id,
    });
    try { emitToAll('performance:updated', { at: Date.now() }); } catch { /* non-fatal */ }
    res.status(201).json({ template });
  } catch (e) { fail(res, e, 'Failed to create template'); }
};

exports.updateTemplate = async (req, res) => {
  try {
    if (!canConfigure(req.user.role)) return res.status(403).json({ message: 'Super admin only' });
    const template = await PerfTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: 'Template not found' });
    const body = req.body || {};
    if (body.criteria) {
      const criteria = body.criteria.map((c, i) => ({ ...c, key: keyFor(c, i), order: c.order ?? i }));
      const bad = validateCriteria(criteria);
      if (bad) return res.status(400).json({ message: bad });
      template.criteria = criteria;
    }
    for (const f of ['name', 'nameAr', 'description', 'descriptionAr', 'department', 'jobTitles', 'tier', 'active']) {
      if (body[f] !== undefined) template[f] = body[f];
    }
    template.updatedBy = req.user._id;
    await template.save();
    try { emitToAll('performance:updated', { at: Date.now() }); } catch { /* non-fatal */ }
    res.json({ template });
  } catch (e) { fail(res, e, 'Failed to update template'); }
};

exports.deleteTemplate = async (req, res) => {
  try {
    if (!canConfigure(req.user.role)) return res.status(403).json({ message: 'Super admin only' });
    // Past evaluations must stay readable, so a used form is retired, not removed.
    const used = await PerfEvaluation.countDocuments({ template: req.params.id });
    if (used > 0) {
      await PerfTemplate.findByIdAndUpdate(req.params.id, { active: false, updatedBy: req.user._id });
      return res.json({ ok: true, deactivated: true, message: `Template has ${used} evaluations — deactivated instead of deleted` });
    }
    await PerfTemplate.findByIdAndDelete(req.params.id);
    try { emitToAll('performance:updated', { at: Date.now() }); } catch { /* non-fatal */ }
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
        // القسمُ باسمه المعتمد، ومفتاحُه لتجميع البطاقات تحته.
        jobTitle: e.jobTitle || '', department: e.dept.label, departmentEn: e.dept.labelEn,
        departmentKey: e.dept.key,
        employeeNumber: e.employeeNumber || '', photo: e.photo || '',
        template: template ? { _id: template._id, nameAr: template.nameAr, tier: template.tier, criteriaCount: (template.criteria || []).length } : null,
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
      // الأقسامُ الممثَّلة في القائمة — تُعرَض البطاقاتُ تحتها في الويب والجوّال.
      groups: groupsOf(employees, org),
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
    // القسمُ المحفوظ على التقييم لقطةٌ نصّيّة؛ يُفلتَر بمفتاحه المعتمد.
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
    const template = req.query.template
      ? templates.find((t) => String(t._id) === req.query.template)
      : templateFor(employee, templates, index);
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
      alternatives: templates
        .filter((t) => D.resolveDepartment(t.department, index).key === employee.dept.key)
        .map((t) => ({ _id: t._id, nameAr: t.nameAr })),
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
      if (!allowed.some((e) => String(e._id) === String(employee._id))) {
        return res.status(403).json({ message: 'Not your team member' });
      }
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
      // يُحفَظ القسمُ باسمه المعتمد، فيتّفق التقييمُ مع القوائم والأرقام.
      department: employee.dept.none ? '' : employee.dept.label, jobTitle: employee.jobTitle || '',
      evaluator: req.user._id,
      evaluatorName: body.evaluatorName || `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
      period, periodKey, evaluationDate: body.evaluationDate || '',
      answers,
      criteriaSnapshot: (template.criteria || []).map((c) => ({
        key: c.key, order: c.order, titleAr: c.titleAr, title: c.title,
        descriptionAr: c.descriptionAr, description: c.description, weight: c.weight,
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

    // ── القسمُ هنا هو القسمُ في القوائم ──────────────────────────────────
    // الملاكُ من loadOrg نفسِها، والتقييمُ يُنسَب إلى قسم صاحبه **الآن** في
    // ملفّه — لا إلى النصّ المحفوظ عليه يومَ كُتب — فما يُعَدّ تحت قسمٍ هو ما
    // يُعرَض تحته. ومن غادر الملاكَ يُقرأ قسمُه من لقطة تقييمه.
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
      // تقييمٌ قديمٌ لمن صار بلا تقييم لا يصنع صفَّ قسمٍ في النظرة الشاملة.
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
        // صفحةُ القسم التي يُقيَّم منها — فارغٌ لقسمٍ لا تملكه صفحة.
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
