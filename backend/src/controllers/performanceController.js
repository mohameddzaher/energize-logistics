/**
 * Performance (KPI) evaluation — تقييم الأداء.
 *
 * Who sees whom:
 *   • super_admin / admin / it_manager / it_specialist → the whole company, and
 *     they alone may edit the forms, the weights, the bands and the bonus tiers.
 *   • a department manager → the people who report to them (Employee.directManager)
 *     plus their own department, so they can grade their team and nobody else's.
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
  isFull(role) || /(_manager|_head|_lead|^moderator$|^operations_manager$)/.test(role);

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
// The people who run a department: anyone who is somebody's directManager, or
// whose linked user holds a manager/head/lead role. This is super-admin's own
// evaluation list — they grade the managers, the managers grade their teams.
async function departmentManagers() {
  const [managerIds, managerUsers] = await Promise.all([
    Employee.distinct('directManager', { directManager: { $ne: null } }),
    User.find({ isActive: { $ne: false } }, { _id: 1, role: 1 }).lean(),
  ]);
  const managerUserIds = managerUsers
    .filter((u) => u.role !== 'super_admin' && isManagerRole(u.role))
    .map((u) => u._id);
  return Employee.find({
    employmentStatus: { $ne: 'terminated' },
    // directManager stores USER ids (Employee.directManager ref: 'User'), so a
    // manager is the employee whose linked `user` is referenced — matching
    // Employee._id against user ids could never hit.
    $or: [{ user: { $in: managerIds } }, { user: { $in: managerUserIds } }],
  }).lean();
}

/**
 * ── نطاقُ قسمٍ بعينه: مَن يقيّمه مديرُ ذلك القسم ─────────────────────────
 *
 * صفحاتُ تقييم الأداء في الأقسام واحدةٌ في كلّ قسم. وكانت لا ترسل شيئًا يميّز
 * القسمَ عن غيره، فيرى مديرُ القسم فريقَه نفسَه في كلّ صفحةٍ يفتحها، ويرى
 * مديرُ النظام **قائمةَ مديري الأقسام** في كلّ صفحةٍ من صفحات الأقسام — فتظهر
 * الشاشةُ وفيها مديرون مكانَ الموظفين، وفي كلّ قسمٍ الوجوهُ نفسُها.
 *
 * ولا يُعالَج بخريطةٍ من «القسم في النظام» إلى «القسم في الموارد البشرية»:
 * التسميتان تصنيفان مختلفان أصلًا — أقسامُ النظام إنجليزيّةٌ (Operations،
 * Collections) وأقسامُ الموظفين عربيّةٌ تصف العمل (التشغيل، النقل الثقيل،
 * سعودة). وخريطةٌ تُكتب بالإيد بينهما تشيخ في أوّل قسمٍ يُضاف.
 *
 * فيُسأل التنظيمُ نفسُه: مَن مديرُ هذا القسم؟ ثمّ: مَن فريقُه؟ — وهو السؤالُ
 * الذي يجيب عنه النظامُ للمدير حين يفتح صفحتَه. فمديرُ النظام حين يفتح قسمًا
 * يرى ما يراه مديرُ ذلك القسم بالضبط، وهو المطلوب.
 */
async function sectionScope(sectionKey) {
  const { rolesOfSection } = require('../config/roles');
  const roles = rolesOfSection(sectionKey) || [];
  const managerRole = roles.find((r) => /_manager$/.test(r));
  if (!managerRole) return null;

  const managers = await User.find({ role: managerRole, isActive: { $ne: false } }, { _id: 1 }).lean();
  if (!managers.length) return { ors: [], managerIds: [] };

  const managerIds = managers.map((m) => m._id);
  const rows = await Employee.find({ user: { $in: managerIds } }).select('department').lean();
  const departments = [...new Set(rows.map((r) => r.department).filter(Boolean))];

  const ors = [{ directManager: { $in: managerIds } }];
  if (departments.length) ors.push({ department: { $in: departments } });
  return { ors, managerIds };
}

/**
 * scope: 'team' (default for managers) | 'managers' (default for super-admin)
 *        | 'all' (full-access only — the whole company)
 * department: optional narrowing by the HR department name.
 * section: the system section whose KPI page this is — see sectionScope.
 */
async function visibleEmployees(user, { scope, department, section } = {}) {
  const base = { employmentStatus: { $ne: 'terminated' } };
  let list;

  // ── صفحةُ قسمٍ بعينه ───────────────────────────────────────────────────
  // تُقرأ بنطاق ذلك القسم أيًّا كان من يفتحها، ما دام يملك فتحَها — والصفحةُ
  // محروسةٌ بمصفوفة الصلاحيّات أصلًا. فمديرُ النظام يرى فريقَ القسم لا قائمةَ
  // المديرين، ومديرُ القسم يرى فريقَه كما كان.
  if (section && !scope) {
    const sc = await sectionScope(section);
    if (sc) {
      list = sc.ors.length ? await Employee.find({ ...base, $or: sc.ors }).lean() : [];
      // ولا يُقيَّم المديرُ في صفحة قسمه: تقييمُ المديرين لمديرِ النظام في
      // الصفحة المركزيّة، وإلّا قيَّم المديرُ نفسَه أو قيَّمه زميلُه.
      const mgr = new Set(sc.managerIds.map(String));
      list = list.filter((e) => !mgr.has(String(e.user || '')));
    }
  }

  if (!list) {
    if (isFull(user.role)) {
      const effective = scope || (canOverride(user.role) ? 'managers' : 'all');
      list = effective === 'managers' ? await departmentManagers() : await Employee.find(base).lean();
    } else {
      const ors = [{ directManager: user._id }];
      // A manager also covers their own department — most departments here don't
      // maintain directManager on every row.
      if (isManagerRole(user.role)) {
        const me = await Employee.findOne({ user: user._id }).lean();
        if (me?.department) ors.push({ department: me.department });
      }
      list = await Employee.find({ ...base, $or: ors }).lean();
    }
  }

  if (department) list = list.filter((e) => e.department === department);
  // ولا تُقيَّم الحساباتُ التي وُلدت من إنشاء مستخدم: ليست سجلَّ موارد بشريّة.
  list = list.filter((e) => e.isHrRecord !== false);
  // Never let anyone grade themselves.
  return list.filter((e) => String(e.user || '') !== String(user._id));
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
// the department-wide fallback.
function templateFor(employee, templates) {
  const inDept = templates.filter((t) => t.active && t.department === employee.department);
  const byTitle = inDept.find((t) => (t.jobTitles || []).length && t.jobTitles.includes(employee.jobTitle));
  return byTitle || inDept.find((t) => !(t.jobTitles || []).length) || inDept[0] || null;
}

const tierOf = (template, settings) => {
  const t = template?.tier || settings.departmentTiers?.[template?.department] || 1;
  return (settings.tiers || []).find((x) => Number(x.tier) === Number(t)) || (settings.tiers || [])[0] || null;
};

// ---- Settings --------------------------------------------------------------
exports.getSettings = async (req, res) => {
  try {
    const s = await PerfSettings.getOrCreate();
    // Departments actually in use, so the settings page can offer real choices.
    const departments = await Employee.distinct('department', { department: { $nin: [null, ''] } });
    res.json({ settings: s, departments: departments.sort(), canConfigure: canConfigure(req.user.role) });
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
    const [employees, templates, settings] = await Promise.all([
      visibleEmployees(req.user, { scope: req.query.scope, department: req.query.department, section: req.query.section }),
      PerfTemplate.find({ active: true }).lean(),
      PerfSettings.getOrCreate(),
    ]);
    const ids = employees.map((e) => e._id);
    const evals = await PerfEvaluation.find({ employee: { $in: ids }, periodKey }).lean();
    const byEmp = new Map(evals.map((v) => [String(v.employee), v]));

    const members = employees.map((e) => {
      const template = templateFor(e, templates);
      const ev = byEmp.get(String(e._id)) || null;
      return {
        _id: e._id,
        name: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
        jobTitle: e.jobTitle || '', department: e.department || '',
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
    res.json({ period, periodKey, periodLabel: periodLabel(period), members, summary, settings });
  } catch (e) { fail(res, e, 'Failed to load team'); }
};

// ---- Evaluations -----------------------------------------------------------
exports.listEvaluations = async (req, res) => {
  try {
    const q = {};
    if (req.query.period) q.periodKey = periodKeyOf(parsePeriod(req.query.period));
    if (req.query.department) q.department = req.query.department;
    if (req.query.employee) q.employee = req.query.employee;
    if (req.query.status) q.status = req.query.status;
    if (!isFull(req.user.role)) {
      const allowed = await visibleEmployees(req.user);
      q.employee = { $in: allowed.map((e) => e._id) };
    }
    const evaluations = await PerfEvaluation.find(q).sort({ updatedAt: -1 }).limit(1000).lean();
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
    const [templates, settings] = await Promise.all([
      PerfTemplate.find({ active: true }).lean({ virtuals: true }),
      PerfSettings.getOrCreate(),
    ]);
    const template = req.query.template
      ? templates.find((t) => String(t._id) === req.query.template)
      : templateFor(employee, templates);
    const evaluation = template
      ? await PerfEvaluation.findOne({ employee: employee._id, periodKey, template: template._id }).lean()
      : null;

    res.json({
      employee: {
        _id: employee._id,
        name: employee.arabicName || `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
        jobTitle: employee.jobTitle || '', department: employee.department || '',
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
        .filter((t) => t.department === employee.department)
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

    const [employee, template, settings] = await Promise.all([
      Employee.findById(body.employee).lean(),
      PerfTemplate.findById(body.template).lean(),
      PerfSettings.getOrCreate(),
    ]);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    if (!template) return res.status(404).json({ message: 'Template not found' });

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
      department: employee.department || '', jobTitle: employee.jobTitle || '',
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
    const [employees, evals, settings, templates] = await Promise.all([
      Employee.find({ employmentStatus: { $ne: 'terminated' } }, { department: 1 }).lean(),
      PerfEvaluation.find({ periodKey }).lean(),
      PerfSettings.getOrCreate(),
      PerfTemplate.find({ active: true }).lean(),
    ]);

    const headcount = employees.reduce((m, e) => {
      const d = e.department || '—';
      m[d] = (m[d] || 0) + 1; return m;
    }, {});
    const submitted = evals.filter((e) => e.status === 'submitted');

    const departments = Object.keys(headcount).sort().map((dept) => {
      const rows = submitted.filter((e) => e.department === dept);
      const scored = rows.filter((r) => r.percentage != null);
      return {
        department: dept,
        headcount: headcount[dept],
        evaluated: rows.length,
        coverage: headcount[dept] ? Math.round((rows.length / headcount[dept]) * 1000) / 10 : 0,
        avgPercentage: scored.length ? Math.round((scored.reduce((s, r) => s + r.percentage, 0) / scored.length) * 10) / 10 : null,
        bonusSalaries: Math.round(rows.reduce((s, r) => s + (r.bonusMultiplier || 0), 0) * 100) / 100,
        tier: settings.departmentTiers?.[dept] || (templates.find((t) => t.department === dept)?.tier ?? null),
        byBand: (settings.bands || []).map((b) => ({ key: b.key, count: rows.filter((r) => r.band === b.key).length })),
      };
    });

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
