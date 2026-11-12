/**
 * Work plan (JP): department tasks and projects, and the manager dashboard.
 * Manager assigns tasks to the team, creates projects, sees the whole plan; an employee sees what is assigned to or written by them, writes requests, and may complete assigned tasks. In the management scope the system admin is the manager and department managers are the team.
 * Permission is computed server-side by `who()` on every read and write; hiding a button is not the guard.
 */
const mongoose = require('mongoose');
const { JpProject, JpTask, ACTIONS } = require('../models/JpModels');
const User = require('../models/User');
const { JP_SECTIONS, sectionOfRole } = require('../config/jpSections');
const { LABELS_AR, LABELS_EN } = require('../config/roles');
const { isManagerRole } = require('../config/businessReview');
const { saveUploadFile, deleteStoredFile } = require('../utils/fileStore');
const { createNotification } = require('../services/notificationService');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');
const { endedStaff, userEnded, userArchived } = require('../utils/endedStaff');

// Super admin and admin see the whole system with full permissions.
const TOP_ROLES = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'];
const sameId = (a, b) => !!a && !!b && String(a._id || a) === String(b._id || b);
const nameOf = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || '' : '');
const HOUR = 3600000;
const EMP = 'emp:';
const assigneeName = (t) => nameOf(t.assignedTo) || t.assigneeName || '';
const assigneeKey = (t) => (t.assignedTo ? String(t.assignedTo._id || t.assignedTo) : (t.assignedEmployee ? `${EMP}${t.assignedEmployee}` : ''));
/** Task fields for a picked person. Employees without a login are picked as `emp:<id>`. */
const assigneeFields = (picked, team) => {
  const id = String(picked);
  if (!id.startsWith(EMP)) return { assignedTo: picked, assignedEmployee: null, assigneeName: '' };
  return { assignedTo: null, assignedEmployee: id.slice(EMP.length), assigneeName: team.find((m) => m._id === id)?.name || '' };
};

/**
 * The caller's position in the requested scope; returns `null` if the scope is unknown.
 * canManage  manager of this scope (or top management)
 * isMember   on its team: can be assigned and writes requests
 */
function who(req, src = {}) {
  const scope = src.scope === 'management' ? 'management' : 'section';
  const role = req.user?.role;
  const top = TOP_ROLES.includes(role);
  if (scope === 'management') {
    const member = isManagerRole(role) && !top;
    return { scope, section: 'management', top, canManage: top, isMember: top || member, def: null };
  }
  const def = JP_SECTIONS[String(src.section || '')];
  if (!def) return null;
  const manager = def.managerRoles.includes(role);
  return {
    scope, section: def.slug, top, def,
    canManage: top || manager,
    isMember: top || def.memberRoles.includes(role),
  };
}

/**
 * Who can be assigned in this scope.
 * `wide`: a top role (super_admin/admin) planning a section may assign anyone active —
 * e.g. the IT team are super_admins, so the section's role list does not contain them.
 * `assign`: the list for assigning a task: every account plus every HR employee with no
 * login, whatever their status. Only partner logins and the archive stay out.
 * Without it the result is the team as counted on dashboards and for hand-down.
 * The section's own members come first, flagged `inSection`.
 */
async function teamOf(w, { wide = false, assign = false } = {}) {
  const base = assign ? {} : { isActive: { $ne: false } };
  const [users, ended] = await Promise.all([
    User.find(base).select('firstName lastName role email linkedEmployee').lean(),
    endedStaff(),
  ]);
  // Accounts are mostly in English; the HR file's Arabic name lets people search as they speak.
  const Employee = require('../models/Employee');
  const { withoutArchived } = require('../utils/hrEngagement');
  const files = await Employee.find(assign ? withoutArchived({}) : { $or: [
    { _id: { $in: users.map((u) => u.linkedEmployee).filter(Boolean) } },
    { user: { $in: users.map((u) => u._id) } },
  ] }).select('arabicName firstName lastName user department email companyEmail').lean();
  const arabicOf = new Map();
  for (const f of files) {
    arabicOf.set(String(f._id), f.arabicName);
    if (f.user) arabicOf.set(String(f.user), f.arabicName);
  }
  const { isExternalRole } = require('../config/scopedRoles');
  const inSection = (u) => (w.scope === 'management'
    ? isManagerRole(u.role) && !TOP_ROLES.includes(u.role)
    : w.def.memberRoles.includes(u.role));
  const scoped = wide && w.scope === 'section' ? (u) => !isExternalRole(u.role) : inSection;
  const pick = (u) => (assign ? !isExternalRole(u.role) && !userArchived(ended, u) : scoped(u) && !userEnded(ended, u));
  // Ended staff are off the team even with a live account; their old tasks stay
  // and count under their name as former on the dashboard.
  const accounts = users.filter(pick).map((u) => ({
    _id: u._id,
    name: nameOf(u),
    nameAr: arabicOf.get(String(u.linkedEmployee)) || arabicOf.get(String(u._id)) || '',
    role: u.role,
    roleAr: LABELS_AR[u.role] || u.role,
    roleEn: LABELS_EN[u.role] || u.role,
    isManager: w.scope === 'management' ? false : w.def.managerRoles.includes(u.role),
    inSection: inSection(u),
  }));
  const withLogin = new Set(users.flatMap((u) => [String(u.linkedEmployee), String(u.email || '').toLowerCase()]));
  const noLogin = !assign ? [] : files
    .filter((f) => !f.user && ![String(f._id), String(f.email || '').toLowerCase(), String(f.companyEmail || '').toLowerCase()].some((k) => k && withLogin.has(k)))
    .map((f) => ({
      _id: `${EMP}${f._id}`,
      name: f.arabicName || [f.firstName, f.lastName].filter(Boolean).join(' ').trim(),
      nameAr: f.arabicName || '',
      // Latin spelling still searchable when the list shows the Arabic name.
      search: [f.firstName, f.lastName].filter(Boolean).join(' '),
      role: '',
      roleAr: f.department || 'موظف بدون حساب',
      roleEn: f.department || 'Employee without login',
      isManager: false,
      inSection: false,
      noLogin: true,
    }))
    .filter((m) => m.name);
  return [...accounts, ...noLogin].sort((a, b) => (Number(b.inSection) - Number(a.inSection)) || a.name.localeCompare(b.name, 'ar'));
}

/** What the caller sees: a manager sees the whole scope, anyone else what is assigned to or written by them. */
const visible = (req, w) => {
  const f = { scope: w.scope, section: w.section };
  if (!w.canManage) f.$or = [{ assignedTo: req.user._id }, { createdBy: req.user._id }];
  return f;
};

const POP = (q) => q
  .populate('assignedTo', 'firstName lastName role')
  .populate('createdBy', 'firstName lastName role')
  .populate('project', 'name status');

/** Status as read: done, overdue or open. Derived from the deadline, not stored. */
const stateOf = (t, now = Date.now()) => {
  if (t.status === 'done') return 'done';
  if (t.deadlineAt && new Date(t.deadlineAt).getTime() < now) return 'overdue';
  return 'open';
};

const shape = (t, req, w) => {
  const mine = sameId(t.assignedTo, req.user._id);
  const author = sameId(t.createdBy, req.user._id);
  // A task's origin in the management plan is visible only to the department manager.
  const { parentTask, ...rest } = t;
  return {
    ...rest,
    assignedTo: rest.assignedTo || (rest.assignedEmployee ? { _id: assigneeKey(t), firstName: rest.assigneeName, lastName: '' } : null),
    fromManagement: w.canManage && !!parentTask,
    state: stateOf(t),
    onTime: t.status === 'done' && t.deadlineAt ? new Date(t.doneAt) <= new Date(t.deadlineAt) : null,
    assignedToName: assigneeName(t),
    createdByName: nameOf(t.createdBy),
    // Time so far, including what the running timer has accumulated.
    spentNow: Math.round(((Number(t.spentMinutes) || 0) + (t.timerStartedAt ? (Date.now() - new Date(t.timerStartedAt).getTime()) / 60000 : 0)) * 10) / 10,
    // What this caller may do on this task; the screen reads it and does not guess.
    can: {
      complete: mine || w.canManage,
      // The timer is for whoever works on the task; time correction is for the manager.
      track: mine,
      adjust: w.canManage,
      edit: w.canManage || (author && (t.kind === 'request' || mine)),
      remove: w.canManage || (author && (t.kind === 'request' || mine)),
      attach: mine || author || w.canManage,
      comment: mine || author || w.canManage,
    },
  };
};

// The customs department dashboard counts plan tasks on its transactions and caches the figures for 30 seconds, so the cache is cleared before the broadcast; otherwise the screen that heard the event reads pre-edit values.
const broadcast = (w) => {
  if (w.section === 'customs') { try { require('../utils/ttlCache').clear('customs:dash'); } catch (_) { /* extra */ } }
  try { emitToAll('jp:changed', { scope: w.scope, section: w.section }); } catch (_) { /* extra */ }
};

const notify = async (recipient, actor, title, message, id) => {
  if (!recipient || sameId(recipient, actor)) return;
  try {
    await createNotification({
      recipient: recipient._id || recipient, type: 'task_assigned', title, message,
      relatedEntity: 'JpTask', relatedEntityId: id,
    });
  } catch (_) { /* The notification is extra and must not fail the save. */ }
};

/**
 * Deadline from the request body, resolved to one instant.
 * date: end of that day in Riyadh time; hours: now + deadlineHours; empty kind: no deadline.
 * Returns `undefined` if no deadline was sent (left untouched on edit).
 */
function readDeadline(body) {
  if (body.deadlineKind === undefined) return undefined;
  const kind = String(body.deadlineKind || '');
  if (kind === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(body.deadlineDate || ''));
    if (!m) throw new Error('تاريخُ الموعد غير صالح');
    return { deadlineKind: 'date', deadlineHours: null, deadlineAt: new Date(`${m[1]}-${m[2]}-${m[3]}T23:59:59.000+03:00`) };
  }
  if (kind === 'hours') {
    const h = Number(body.deadlineHours);
    if (!Number.isFinite(h) || h <= 0 || h > 24 * 60) throw new Error('عددُ الساعات غير صالح');
    return { deadlineKind: 'hours', deadlineHours: h, deadlineAt: new Date(Date.now() + h * HOUR) };
  }
  return { deadlineKind: '', deadlineHours: null, deadlineAt: null };
}

// Work day and expected time
const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;
const riyadhDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(d));
const dayStart = (ymd) => new Date(`${ymd}T00:00:00.000+03:00`);
/** { workDate?, expectedMinutes? } from the request body; `undefined` for a field not sent. */
function readPlan(body) {
  const out = {};
  if (body.workDate !== undefined) {
    const v = String(body.workDate || '');
    if (v && !DAY_RX.test(v)) throw bad('يومُ العمل غير صالح');
    out.workDate = v ? dayStart(v) : null;
  }
  if (body.expectedMinutes !== undefined) {
    const raw = body.expectedMinutes;
    if (raw === '' || raw === null) out.expectedMinutes = null;
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 24 * 60 * 30) throw bad('الوقتُ المتوقّع غير صالح');
      out.expectedMinutes = Math.round(n);
    }
  }
  return out;
}

/** Closes a running timer: writes the interval as a line in the time log. */
function closeTimer(t, user, at = new Date()) {
  if (!t.timerStartedAt) return 0;
  const start = new Date(t.timerStartedAt);
  const minutes = Math.max(0, Math.round(((at - start) / 60000) * 10) / 10);
  t.timeLog.push({ kind: 'timer', start, end: at, minutes, by: user._id, byName: nameOf(user) });
  t.timerStartedAt = null;
  return minutes;
}

/**
 * What a task links to.
 * Each department has its own kinds (transaction, shipment, employee, vehicle...) in config/jpLinks.js.
 */
const jpLinks = require('../config/jpLinks');

/** Task links from the request body; `undefined` if not sent (left untouched on edit). */
async function readLinks(body, w) {
  if (body.links === undefined) return undefined;
  const kinds = w.scope === 'section' ? jpLinks.kindsFor(w.section) : [];
  const out = [];
  for (const l of (Array.isArray(body.links) ? body.links : []).slice(0, 8)) {
    const kind = String(l?.kind || '');
    if (!kinds.includes(kind) || !mongoose.isValidObjectId(l?.ref)) continue;
    if (out.some((x) => x.kind === kind && String(x.ref) === String(l.ref))) continue;
    const label = await jpLinks.labelOf(kind, l.ref);
    if (label === null) throw bad('ما رُبطت به المهمّةُ غير موجود');
    out.push({ kind, ref: l.ref, label });
  }
  return out;
}

const fail = (res, e, fallback) => res.status(e?.name === 'ValidationError' || e?.status === 400 ? 400 : 500)
  .json({ message: e?.status === 400 || e?.name === 'ValidationError' ? e.message : fallback });
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

// Who am I in this plan
// GET /api/jp/me?scope=&section=
exports.me = async (req, res) => {
  try {
    const w = who(req, req.query);
    if (!w) return res.status(404).json({ message: 'قسمٌ غير معروف' });
    if (!w.isMember) return res.status(403).json({ message: 'خطّةُ العمل لفريق القسم ومديره', code: 'JP_NOT_MEMBER' });
    const [team, projects] = await Promise.all([
      teamOf(w, { wide: w.top, assign: true }),
      JpProject.find({ scope: w.scope, section: w.section }).sort({ status: 1, createdAt: -1 }).lean(),
    ]);
    res.json({
      scope: w.scope, section: w.section, canManage: w.canManage,
      sectionAr: w.def ? w.def.ar : 'الإدارة العليا', sectionEn: w.def ? w.def.en : 'Top management',
      me: req.user._id,
      // An employee assigns to themself and colleagues; a manager to the whole team.
      team,
      projects,
      actions: ACTIONS.filter(Boolean),
      // What a task can be linked to in this section; empty for a section without links.
      linkKinds: w.scope === 'section' ? jpLinks.kindsFor(w.section) : [],
      // The label of each kind and its link template; both front ends read it instead of keeping their own list.
      linkMeta: w.scope === 'section' ? jpLinks.metaFor(w.section) : {},
    });
  } catch (e) { fail(res, e, 'تعذّر تحميل الخطّة'); }
};

// GET /api/jp/link-options?scope=section&section=&kind=&q= - searchable choices for linking.
exports.linkOptions = async (req, res) => {
  try {
    const w = who(req, req.query);
    if (!w) return res.status(404).json({ message: 'قسمٌ غير معروف' });
    if (!w.isMember) return res.status(403).json({ message: 'خطّةُ العمل لفريق القسم ومديره' });
    const kind = String(req.query.kind || '');
    if (w.scope !== 'section' || !jpLinks.kindsFor(w.section).includes(kind)) return res.json({ options: [] });
    res.json({ options: await jpLinks.searchKind(kind, req.query.q, req.query.limit) });
  } catch (e) { fail(res, e, 'تعذّر البحث'); }
};

// GET /api/jp/home - where this user's plan lives (opened by the notification).
exports.home = (req, res) => {
  const role = req.user?.role;
  if (TOP_ROLES.includes(role)) return res.json({ path: '/system/management-jp' });
  const s = sectionOfRole(role);
  if (s) return res.json({ path: `${s.path}/jp` });
  res.json({ path: null });
};

// Tasks
// GET /api/jp/tasks?scope=&section=&box=mine|sent|all&status=&project=&assignee=&kind=
exports.listTasks = async (req, res) => {
  try {
    const w = who(req, req.query);
    if (!w) return res.status(404).json({ message: 'قسمٌ غير معروف' });
    if (!w.isMember) return res.status(403).json({ message: 'خطّةُ العمل لفريق القسم ومديره' });

    const f = visible(req, w);
    const and = [];
    const { box, status, project, assignee, kind, linkKind, linkRef } = req.query;
    // Tasks of a given transaction or party, read on its page with the same visibility rule.
    if (linkRef && mongoose.isValidObjectId(linkRef)) {
      and.push({ links: { $elemMatch: { ref: new mongoose.Types.ObjectId(String(linkRef)), ...(linkKind ? { kind: String(linkKind) } : {}) } } });
    }
    if (box === 'mine') and.push({ assignedTo: req.user._id });
    else if (box === 'sent') and.push({ createdBy: req.user._id, assignedTo: { $ne: req.user._id } });
    if (kind === 'task' || kind === 'request') and.push({ kind });
    if (project === 'none') and.push({ project: null });
    else if (project && mongoose.isValidObjectId(project)) and.push({ project });
    if (assignee && mongoose.isValidObjectId(assignee)) and.push({ assignedTo: assignee });
    if (assignee && String(assignee).startsWith(EMP) && mongoose.isValidObjectId(String(assignee).slice(EMP.length))) and.push({ assignedEmployee: String(assignee).slice(EMP.length) });
    const now = new Date();
    if (status === 'done') and.push({ status: 'done' });
    else if (status === 'open') and.push({ status: 'open' });
    else if (status === 'overdue') and.push({ status: 'open', deadlineAt: { $ne: null, $lt: now } });
    if (and.length) f.$and = and;

    const rows = await POP(JpTask.find(f)).sort({ status: 1, deadlineAt: 1, createdAt: -1 }).limit(1000).lean();
    // Open first by nearest deadline, then those without a deadline, then done ones, newest first.
    const rank = (t) => (t.status === 'done' ? 2 : t.deadlineAt ? 0 : 1);
    rows.sort((a, b) => rank(a) - rank(b)
      || (rank(a) === 0 ? new Date(a.deadlineAt) - new Date(b.deadlineAt) : 0)
      || (rank(a) === 2 ? new Date(b.doneAt || 0) - new Date(a.doneAt || 0) : new Date(b.createdAt) - new Date(a.createdAt)));

    // Counters cover everything the caller can see, not what remains after filtering.
    const all = await JpTask.find(visible(req, w)).select('status deadlineAt assignedTo createdBy kind').lean();
    const t0 = Date.now();
    const counts = { all: all.length, open: 0, overdue: 0, done: 0, mine: 0, sent: 0 };
    for (const t of all) {
      const s = stateOf(t, t0);
      if (s === 'done') counts.done += 1; else { counts.open += 1; if (s === 'overdue') counts.overdue += 1; }
      if (sameId(t.assignedTo, req.user._id) && t.status !== 'done') counts.mine += 1;
      if (sameId(t.createdBy, req.user._id) && !sameId(t.assignedTo, req.user._id) && t.status !== 'done') counts.sent += 1;
    }
    // In the management plan: where each task its manager assigned to the team stands.
    let handed = new Map();
    if (w.scope === 'management' && rows.length) {
      const kids = await JpTask.find({ parentTask: { $in: rows.map((t) => t._id) } })
        .select('parentTask status deadlineAt doneAt assignedTo').populate('assignedTo', 'firstName lastName').lean();
      for (const k of kids) {
        const key = String(k.parentTask);
        if (!handed.has(key)) handed.set(key, []);
        handed.get(key).push({ _id: k._id, name: nameOf(k.assignedTo), state: stateOf(k), doneAt: k.doneAt });
      }
    }
    const mySection = sectionOfRole(req.user.role);
    res.json({
      tasks: rows.map((t) => ({
        ...shape(t, req, w),
        ...(w.scope === 'management' ? {
          handedTo: handed.get(String(t._id)) || [],
          // Whoever is assigned and manages a department can hand it down to their team.
          canHandDown: sameId(t.assignedTo, req.user._id) && !!mySection && mySection.managerRoles.includes(req.user.role),
        } : {}),
      })),
      counts, now: new Date(),
      mySection: mySection ? mySection.slug : null,
    });
  } catch (e) { fail(res, e, 'تعذّر تحميل المهامّ'); }
};

// POST /api/jp/tasks
exports.createTask = async (req, res) => {
  try {
    const w = who(req, req.body);
    if (!w) return res.status(404).json({ message: 'قسمٌ غير معروف' });
    if (!w.isMember) return res.status(403).json({ message: 'خطّةُ العمل لفريق القسم ومديره' });

    const title = String(req.body.title || '').trim();
    if (!title) throw bad('اكتب ما المطلوب');
    const team = await teamOf(w, { wide: w.top, assign: true });
    const assignedTo = req.body.assignedTo || (w.top ? null : req.user._id);
    // Assignment stays inside the team; no assigning to another department's employee from this plan.
    if (!assignedTo || !(team.some((m) => sameId(m._id, assignedTo)) || sameId(assignedTo, req.user._id))) {
      throw bad('اختر من يُسنَد إليه من فريق القسم');
    }
    let project = null;
    if (req.body.project) {
      const p = mongoose.isValidObjectId(req.body.project)
        ? await JpProject.findOne({ _id: req.body.project, scope: w.scope, section: w.section }).select('_id').lean() : null;
      if (!p) throw bad('المشروعُ غير موجودٍ في هذه الخطّة');
      project = p._id;
    }
    const action = ACTIONS.includes(String(req.body.action || '')) ? String(req.body.action || '') : '';
    const deadline = readDeadline(req.body) || {};
    const links = (await readLinks(req.body, w)) || [];
    const plan = readPlan(req.body);

    const doc = await JpTask.create({
      links, ...plan,
      scope: w.scope, section: w.section,
      // A manager assigns, anyone else requests; decided by who wrote it, not by what was sent. An employee assigning to themself means 'I am working on this': it is their task, not a request to anyone.
      kind: w.canManage || sameId(assignedTo, req.user._id) ? 'task' : 'request',
      project, title, details: String(req.body.details || '').trim(), action,
      contact: String(req.body.contact || '').trim(),
      ...assigneeFields(assignedTo, team), createdBy: req.user._id, ...deadline,
    });
    for (const f of (Array.isArray(req.body.files) ? req.body.files : []).slice(0, 5)) {
      const stored = saveUploadFile(f.dataUrl, 'jp', f.fileName);
      doc.attachments.push({ ...stored, phase: 'brief', uploadedBy: req.user._id, uploadedByName: nameOf(req.user) });
    }
    if (doc.attachments.length) await doc.save();

    await notify(doc.assignedTo, req.user._id,
      doc.kind === 'task' ? 'مهمّةٌ جديدةٌ أُسنِدت إليك' : 'طلبٌ جديدٌ من زميل',
      `${title} — من ${nameOf(req.user)}`, doc._id);
    await logAudit({ user: req.user._id, action: 'create', entity: 'JpTask', entityId: doc._id, changes: { after: { title, kind: doc.kind, section: w.section, assignedTo } }, ipAddress: req.ip }).catch(() => {});
    await require('../services/itTicketJp').fromTask(doc._id, req.user._id);
    broadcast(w);
    const fresh = await POP(JpTask.findById(doc._id)).lean();
    res.status(201).json({ task: shape(fresh, req, w) });
  } catch (e) { fail(res, e, 'تعذّر إنشاء المهمّة'); }
};

/** The task and the caller's position on it, or a rejection reply. */
async function loadTask(req, res) {
  const t = await JpTask.findById(req.params.id);
  if (!t) { res.status(404).json({ message: 'المهمّة غير موجودة' }); return null; }
  const w = who(req, { scope: t.scope, section: t.section });
  const related = sameId(t.assignedTo, req.user._id) || sameId(t.createdBy, req.user._id);
  if (!w || !(w.canManage || (w.isMember && related))) { res.status(403).json({ message: 'ليست من مهامّك' }); return null; }
  return { t, w, mine: sameId(t.assignedTo, req.user._id), author: sameId(t.createdBy, req.user._id) };
}

// PATCH /api/jp/tasks/:id - edit text, assignment and deadline
exports.updateTask = async (req, res) => {
  try {
    const got = await loadTask(req, res); if (!got) return;
    const { t, w, author } = got;
    if (!(w.canManage || (author && (t.kind === 'request' || sameId(t.assignedTo, req.user._id))))) return res.status(403).json({ message: 'التعديلُ لمن أسند المهمّة' });

    const b = req.body || {};
    if (b.title !== undefined) { const v = String(b.title).trim(); if (!v) throw bad('اكتب ما المطلوب'); t.title = v; }
    if (b.details !== undefined) t.details = String(b.details || '').trim();
    if (b.contact !== undefined) t.contact = String(b.contact || '').trim();
    if (b.action !== undefined) t.action = ACTIONS.includes(String(b.action || '')) ? String(b.action || '') : '';
    if (b.project !== undefined) {
      if (!b.project) t.project = null;
      else {
        const p = mongoose.isValidObjectId(b.project) ? await JpProject.findOne({ _id: b.project, scope: t.scope, section: t.section }).select('_id').lean() : null;
        if (!p) throw bad('المشروعُ غير موجودٍ في هذه الخطّة');
        t.project = p._id;
      }
    }
    let reassigned = false;
    if (b.assignedTo !== undefined && String(b.assignedTo) !== assigneeKey(t)) {
      const team = await teamOf(w, { wide: w.top, assign: true });
      if (!(team.some((m) => sameId(m._id, b.assignedTo)) || sameId(b.assignedTo, req.user._id))) throw bad('اختر من يُسنَد إليه من فريق القسم');
      Object.assign(t, assigneeFields(b.assignedTo, team)); reassigned = true;
    }
    const deadline = readDeadline(b);
    if (deadline) Object.assign(t, deadline);
    Object.assign(t, readPlan(b));
    const links = await readLinks(b, w);
    if (links) t.links = links;
    await t.save();
    if (reassigned) await notify(t.assignedTo, req.user._id, 'مهمّةٌ أُسنِدت إليك', `${t.title} — من ${nameOf(req.user)}`, t._id);
    await require('../services/itTicketJp').fromTask(t._id, req.user._id);
    broadcast(w);
    res.json({ task: shape(await POP(JpTask.findById(t._id)).lean(), req, w) });
  } catch (e) { fail(res, e, 'تعذّر التعديل'); }
};

// POST /api/jp/tasks/:id/done — { done, note, file? }
exports.setDone = async (req, res) => {
  try {
    const got = await loadTask(req, res); if (!got) return;
    const { t, w, mine } = got;
    if (!(mine || w.canManage)) return res.status(403).json({ message: 'الإتمامُ لمن أُسنِدت إليه المهمّة' });
    const done = req.body.done !== false;
    if (done) {
      // Done stops a running timer; time up to this moment is counted.
      closeTimer(t, req.user);
      t.progress = 'todo';
      t.status = 'done'; t.doneAt = new Date(); t.doneBy = req.user._id;
      t.doneNote = String(req.body.note || '').trim();
      const f = req.body.file;
      if (f && f.dataUrl) {
        const stored = saveUploadFile(f.dataUrl, 'jp', f.fileName);
        t.attachments.push({ ...stored, phase: 'done', uploadedBy: req.user._id, uploadedByName: nameOf(req.user) });
      }
    } else {
      // Completion reverted: it reopens and its attachments stay.
      t.status = 'open'; t.doneAt = null; t.doneBy = null; t.doneNote = '';
    }
    await t.save();
    if (done) await notify(t.createdBy, req.user._id, 'تمّت مهمّة', `${t.title} — ${nameOf(req.user)}`, t._id);
    await require('../services/itTicketJp').fromTask(t._id, req.user._id);
    await logAudit({ user: req.user._id, action: done ? 'complete' : 'reopen', entity: 'JpTask', entityId: t._id, changes: { after: { title: t.title, status: t.status } }, ipAddress: req.ip }).catch(() => {});
    broadcast(w);
    res.json({ task: shape(await POP(JpTask.findById(t._id)).lean(), req, w) });
  } catch (e) { fail(res, e, 'تعذّر الحفظ'); }
};

/**
 * POST /api/jp/tasks/:id/progress - { action: 'start' | 'pause' }
 * Start runs the timer (one timer per employee: whatever else was running stops); pause writes the interval to the time log. Done from /done stops it too.
 */
exports.progress = async (req, res) => {
  try {
    const got = await loadTask(req, res); if (!got) return;
    const { t, w, mine } = got;
    if (!mine) return res.status(403).json({ message: 'المؤقّتُ لمن يعمل على المهمّة' });
    if (t.status === 'done') throw bad('المهمّةُ تمّت — أعد فتحها أوّلًا');
    const action = String(req.body.action || '');
    if (action === 'start') {
      if (!t.timerStartedAt) {
        const others = await JpTask.find({ assignedTo: req.user._id, timerStartedAt: { $ne: null }, _id: { $ne: t._id } });
        for (const o of others) { closeTimer(o, req.user); o.progress = 'paused'; await o.save(); }
        t.timerStartedAt = new Date();
      }
      t.progress = 'doing';
    } else if (action === 'pause') {
      closeTimer(t, req.user);
      t.progress = 'paused';
    } else throw bad('فعلٌ غير معروف');
    await t.save();
    broadcast(w);
    res.json({ task: shape(await POP(JpTask.findById(t._id)).lean(), req, w) });
  } catch (e) { fail(res, e, 'تعذّر الحفظ'); }
};

/** POST /api/jp/tasks/:id/time - { minutes (+/-), day: 'YYYY-MM-DD', note } - manager correction. */
exports.adjustTime = async (req, res) => {
  try {
    const got = await loadTask(req, res); if (!got) return;
    const { t, w } = got;
    if (!w.canManage) return res.status(403).json({ message: 'تصحيحُ الوقت لمدير القسم' });
    const minutes = Number(req.body.minutes);
    if (!Number.isFinite(minutes) || minutes === 0 || Math.abs(minutes) > 24 * 60) throw bad('اكتب الدقائق (موجبةً تُزاد وسالبةً تُنقَص)');
    const day = String(req.body.day || '') || riyadhDay(new Date());
    if (!DAY_RX.test(day)) throw bad('اليومُ غير صالح');
    t.timeLog.push({ kind: 'adjust', day, minutes: Math.round(minutes * 10) / 10, note: String(req.body.note || '').trim().slice(0, 500), by: req.user._id, byName: nameOf(req.user) });
    await t.save();
    await logAudit({ user: req.user._id, action: 'update', entity: 'JpTask', entityId: t._id, changes: { details: `تصحيح وقت ${minutes} دقيقة يوم ${day} · ${t.title}` }, ipAddress: req.ip }).catch(() => {});
    broadcast(w);
    res.json({ task: shape(await POP(JpTask.findById(t._id)).lean(), req, w) });
  } catch (e) { fail(res, e, 'تعذّر الحفظ'); }
};

/**
 * GET /api/jp/daily?scope=&section=&from=YYYY-MM-DD&to=&assignee=&title=&status=
 * What each person worked on per day and how long it took. One row per task per day: what was planned for that day (`workDate`), what was worked (a timer interval split across its days, and manager corrections on their day) and what was completed.
 * A manager sees the team, an employee sees themself.
 */
exports.daily = async (req, res) => {
  try {
    const w = who(req, req.query);
    if (!w) return res.status(404).json({ message: 'قسمٌ غير معروف' });
    if (!w.isMember) return res.status(403).json({ message: 'خطّةُ العمل لفريق القسم ومديره' });
    const today = riyadhDay(new Date());
    const from = DAY_RX.test(String(req.query.from || '')) ? String(req.query.from) : today;
    const to = DAY_RX.test(String(req.query.to || '')) ? String(req.query.to) : from;
    if (to < from) throw bad('المدى مقلوب');
    const lo = dayStart(from); const hi = new Date(dayStart(to).getTime() + 86400000);
    const base = visible(req, w);
    if (w.canManage && req.query.assignee && mongoose.isValidObjectId(req.query.assignee)) base.assignedTo = req.query.assignee;
    if (req.query.title) base.title = String(req.query.title);
    const tasks = await POP(JpTask.find({
      ...base,
      $and: [{ $or: [
        { workDate: { $gte: lo, $lt: hi } },
        { createdAt: { $gte: lo, $lt: hi } },
        { doneAt: { $gte: lo, $lt: hi } },
        { timerStartedAt: { $ne: null } },
        { timeLog: { $elemMatch: { $or: [{ start: { $lt: hi }, end: { $gte: lo } }, { day: { $gte: from, $lte: to } }] } } },
      ] }],
    })).lean();

    const now = new Date();
    const rows = [];
    for (const t of tasks) {
      const per = new Map(); // day → minutes
      const addSpan = (s, e) => {
        let a = new Date(Math.max(s.getTime(), lo.getTime())); const b = new Date(Math.min(e.getTime(), hi.getTime()));
        while (a < b) {
          const d = riyadhDay(a); const next = new Date(dayStart(d).getTime() + 86400000);
          const end = next < b ? next : b;
          per.set(d, (per.get(d) || 0) + (end - a) / 60000);
          a = end;
        }
      };
      for (const l of t.timeLog || []) {
        if (l.kind === 'timer' && l.start && l.end) addSpan(new Date(l.start), new Date(l.end));
        else if (l.kind === 'adjust' && l.day >= from && l.day <= to) per.set(l.day, (per.get(l.day) || 0) + (Number(l.minutes) || 0));
      }
      if (t.timerStartedAt) addSpan(new Date(t.timerStartedAt), now);
      const days = new Set(per.keys());
      const plan = t.workDate ? riyadhDay(t.workDate) : riyadhDay(t.createdAt);
      if (plan >= from && plan <= to) days.add(plan);
      if (t.doneAt) { const d = riyadhDay(t.doneAt); if (d >= from && d <= to) days.add(d); }
      for (const d of days) {
        const status = t.status === 'done' && t.doneAt && riyadhDay(t.doneAt) <= d ? 'done' : (t.timerStartedAt ? 'doing' : (t.progress || 'todo'));
        if (req.query.status && req.query.status !== status) continue;
        rows.push({
          day: d, taskId: String(t._id), title: t.title, kind: t.kind,
          assignedTo: t.assignedTo?._id ? String(t.assignedTo._id) : null, assignedToName: assigneeName(t),
          createdByName: nameOf(t.createdBy), status, running: !!t.timerStartedAt,
          expectedMinutes: t.expectedMinutes ?? null, minutes: Math.round((per.get(d) || 0) * 10) / 10,
          totalMinutes: Math.round(((Number(t.spentMinutes) || 0) + (t.timerStartedAt ? (now - new Date(t.timerStartedAt)) / 60000 : 0)) * 10) / 10,
          planned: d === plan, doneAt: t.doneAt || null,
        });
      }
    }
    rows.sort((a, b) => b.day.localeCompare(a.day) || a.assignedToName.localeCompare(b.assignedToName, 'ar') || b.minutes - a.minutes);
    // Per employee in the range: tasks, completed, minutes, and planned time.
    const people = new Map();
    for (const r of rows) {
      const k = r.assignedTo || r.assignedToName || '—';
      const p = people.get(k) || { assignedTo: r.assignedTo, name: r.assignedToName || '—', tasks: 0, done: 0, minutes: 0, expected: 0, running: 0 };
      p.tasks += 1; if (r.status === 'done') p.done += 1; p.minutes += r.minutes; if (r.planned && r.expectedMinutes) p.expected += r.expectedMinutes; if (r.running) p.running += 1;
      people.set(k, p);
    }
    const titles = new Map();
    for (const r of rows) titles.set(r.title, (titles.get(r.title) || 0) + r.minutes);
    res.json({
      from, to, rows,
      people: [...people.values()].map((p) => ({ ...p, minutes: Math.round(p.minutes * 10) / 10 })).sort((a, b) => b.minutes - a.minutes),
      titles: [...titles.entries()].map(([title, minutes]) => ({ title, minutes: Math.round(minutes * 10) / 10 })).sort((a, b) => b.minutes - a.minutes),
      team: w.canManage ? (await teamOf(w, { wide: w.top, assign: true })).filter((m) => !m.noLogin) : [],
    });
  } catch (e) { fail(res, e, 'تعذّر تحميل اليوميّة'); }
};

// POST /api/jp/tasks/:id/attachments — { dataUrl, fileName }
exports.addAttachment = async (req, res) => {
  try {
    const got = await loadTask(req, res); if (!got) return;
    const { t, w, mine } = got;
    const stored = saveUploadFile(req.body.dataUrl, 'jp', req.body.fileName);
    // What the assignee uploads is completion proof; what anyone else uploads belongs to the original assignment.
    t.attachments.push({ ...stored, phase: mine && !got.author ? 'done' : 'brief', uploadedBy: req.user._id, uploadedByName: nameOf(req.user) });
    await t.save();
    broadcast(w);
    res.status(201).json({ task: shape(await POP(JpTask.findById(t._id)).lean(), req, w) });
  } catch (e) { res.status(400).json({ message: e.message }); }
};

// POST /api/jp/tasks/:id/comments — { text }
exports.addComment = async (req, res) => {
  try {
    const got = await loadTask(req, res); if (!got) return;
    const { t, w, mine } = got;
    const text = String(req.body.text || '').trim();
    if (!text) throw bad('اكتب التعليق');
    t.comments.push({ by: req.user._id, byName: nameOf(req.user), text });
    await t.save();
    // The other party is notified: the assignee if someone else commented, the assigner if the assignee did.
    await notify(mine ? t.createdBy : t.assignedTo, req.user._id, 'تعليقٌ على مهمّة', `${t.title} — ${nameOf(req.user)}: ${text.slice(0, 120)}`, t._id);
    broadcast(w);
    res.status(201).json({ task: shape(await POP(JpTask.findById(t._id)).lean(), req, w) });
  } catch (e) { fail(res, e, 'تعذّر حفظ التعليق'); }
};

// DELETE /api/jp/tasks/:id/attachments/:attId
exports.removeAttachment = async (req, res) => {
  try {
    const got = await loadTask(req, res); if (!got) return;
    const { t, w } = got;
    const a = t.attachments.id(req.params.attId);
    if (!a) return res.status(404).json({ message: 'المرفق غير موجود' });
    if (!(w.canManage || sameId(a.uploadedBy, req.user._id))) return res.status(403).json({ message: 'يحذف المرفقَ من رفعه' });
    deleteStoredFile(a.fileUrl);
    a.deleteOne();
    await t.save();
    broadcast(w);
    res.json({ task: shape(await POP(JpTask.findById(t._id)).lean(), req, w) });
  } catch (e) { fail(res, e, 'تعذّر الحذف'); }
};

// DELETE /api/jp/tasks/:id
exports.deleteTask = async (req, res) => {
  try {
    const got = await loadTask(req, res); if (!got) return;
    const { t, w, author } = got;
    if (!(w.canManage || (author && t.kind === 'request'))) return res.status(403).json({ message: 'الحذفُ لمن أسند المهمّة' });
    for (const a of t.attachments) deleteStoredFile(a.fileUrl);
    await t.deleteOne();
    await require('../services/itTicketJp').taskDeleted(t);
    await logAudit({ user: req.user._id, action: 'delete', entity: 'JpTask', entityId: t._id, changes: { before: { title: t.title, kind: t.kind, section: t.section } }, ipAddress: req.ip }).catch(() => {});
    broadcast(w);
    res.json({ deleted: true });
  } catch (e) { fail(res, e, 'تعذّر الحذف'); }
};

// Hand-down - a department manager assigns what was assigned to them to their team
/** What top management assigns to a department manager can be handed down to an employee. The result is an ordinary department task written by the manager: the employee sees it from the manager like any other and nothing says where it came from. The original stays with the manager before management, who is responsible and completes it when the work is done. */
async function handDownOne(parent, def, assignee, req, sectionProject = null) {
  const child = await JpTask.create({
    scope: 'section', section: def.slug, kind: 'task', project: sectionProject,
    title: parent.title, details: parent.details, action: parent.action, contact: parent.contact,
    assignedTo: assignee, createdBy: req.user._id,
    deadlineKind: parent.deadlineAt ? 'date' : '', deadlineHours: null, deadlineAt: parent.deadlineAt,
    // Assignment attachments go down with it: the same file, under the manager's name.
    attachments: (parent.attachments || []).filter((a) => a.phase === 'brief').map((a) => ({
      fileUrl: a.fileUrl, fileName: a.fileName, mimeType: a.mimeType, size: a.size, phase: 'brief',
      uploadedBy: req.user._id, uploadedByName: nameOf(req.user),
    })),
    parentTask: parent._id,
  });
  await notify(assignee, req.user._id, 'مهمّةٌ جديدةٌ أُسنِدت إليك', `${parent.title} — من ${nameOf(req.user)}`, child._id);
  return child;
}

/** The manager's department and team, or a rejection. */
async function myTeamFor(req, res, assignee) {
  const def = sectionOfRole(req.user.role);
  if (!def || !def.managerRoles.includes(req.user.role)) { res.status(403).json({ message: 'الإنزالُ لمدير القسم' }); return null; }
  const team = await teamOf({ scope: 'section', def });
  if (!team.some((m) => sameId(m._id, assignee)) || sameId(assignee, req.user._id)) {
    res.status(400).json({ message: 'اختر موظّفًا من فريق قسمك' }); return null;
  }
  return def;
}

// POST /api/jp/tasks/:id/hand-down — { assignedTo }
exports.handDown = async (req, res) => {
  try {
    const parent = await JpTask.findById(req.params.id);
    if (!parent || parent.scope !== 'management') return res.status(404).json({ message: 'المهمّة غير موجودة' });
    if (!sameId(parent.assignedTo, req.user._id)) return res.status(403).json({ message: 'ليست من مهامّك' });
    const def = await myTeamFor(req, res, req.body.assignedTo); if (!def) return;
    const child = await handDownOne(parent, def, req.body.assignedTo, req);
    broadcast({ scope: 'section', section: def.slug });
    broadcast({ scope: 'management', section: 'management' });
    res.status(201).json({ created: 1, task: child._id });
  } catch (e) { fail(res, e, 'تعذّر الإسناد'); }
};

// POST /api/jp/projects/:id/hand-down - { assignedTo } : all my open tasks in the project
exports.handDownProject = async (req, res) => {
  try {
    const p = await JpProject.findById(req.params.id);
    if (!p || p.scope !== 'management') return res.status(404).json({ message: 'المشروع غير موجود' });
    const def = await myTeamFor(req, res, req.body.assignedTo); if (!def) return;
    const mine = await JpTask.find({ project: p._id, scope: 'management', assignedTo: req.user._id, status: 'open' });
    if (!mine.length) return res.status(400).json({ message: 'لا مهامَّ مفتوحةً لك في هذا المشروع' });
    // The department project is created once and reused if tasks were handed down from it before.
    const sp = await JpProject.findOne({ scope: 'section', section: def.slug, parentProject: p._id })
      || await JpProject.create({ scope: 'section', section: def.slug, name: p.name, description: p.description, startDate: p.startDate, endDate: p.endDate, createdBy: req.user._id, parentProject: p._id });
    const done = new Set((await JpTask.find({ parentTask: { $in: mine.map((t) => t._id) } }).select('parentTask').lean()).map((k) => String(k.parentTask)));
    let created = 0;
    for (const t of mine) {
      if (done.has(String(t._id))) continue;      // Already handed down; not duplicated.
      await handDownOne(t, def, req.body.assignedTo, req, sp._id); created += 1;
    }
    broadcast({ scope: 'section', section: def.slug });
    broadcast({ scope: 'management', section: 'management' });
    res.status(201).json({ created, project: sp._id });
  } catch (e) { fail(res, e, 'تعذّر الإسناد'); }
};

// Projects - manager only
const day = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? new Date(`${String(v).slice(0, 10)}T00:00:00.000+03:00`) : null);

// GET /api/jp/projects?scope=&section=
exports.listProjects = async (req, res) => {
  try {
    const w = who(req, req.query);
    if (!w) return res.status(404).json({ message: 'قسمٌ غير معروف' });
    if (!w.isMember) return res.status(403).json({ message: 'خطّةُ العمل لفريق القسم ومديره' });
    const projects = await JpProject.find({ scope: w.scope, section: w.section }).sort({ status: 1, createdAt: -1 }).lean();
    // Project progress, over the tasks the caller can see.
    const tasks = await JpTask.find({ ...visible(req, w), project: { $in: projects.map((p) => p._id) } }).select('project status deadlineAt').lean();
    const now = Date.now();
    const by = new Map();
    for (const t of tasks) {
      const e = by.get(String(t.project)) || { total: 0, done: 0, overdue: 0 };
      e.total += 1; const s = stateOf(t, now);
      if (s === 'done') e.done += 1; if (s === 'overdue') e.overdue += 1;
      by.set(String(t.project), e);
    }
    const authors = await User.find({ _id: { $in: projects.map((p) => p.createdBy) } }).select('firstName lastName').lean();
    const authorOf = new Map(authors.map((u) => [String(u._id), nameOf(u)]));
    res.json({ projects: projects.map((p) => ({
      ...p, parentProject: undefined, createdByName: authorOf.get(String(p.createdBy)) || '',
      ...(by.get(String(p._id)) || { total: 0, done: 0, overdue: 0 }),
    })) });
  } catch (e) { fail(res, e, 'تعذّر تحميل المشروعات'); }
};

// POST /api/jp/projects
exports.createProject = async (req, res) => {
  try {
    const w = who(req, req.body);
    if (!w) return res.status(404).json({ message: 'قسمٌ غير معروف' });
    if (!w.canManage) return res.status(403).json({ message: 'المشروعاتُ ينشئها مديرُ القسم' });
    const name = String(req.body.name || '').trim();
    if (!name) throw bad('اكتب اسمَ المشروع');
    const doc = await JpProject.create({
      scope: w.scope, section: w.section, name, description: String(req.body.description || '').trim(),
      startDate: day(req.body.startDate), endDate: day(req.body.endDate), createdBy: req.user._id,
    });
    broadcast(w);
    res.status(201).json({ project: doc });
  } catch (e) { fail(res, e, 'تعذّر إنشاء المشروع'); }
};

// PATCH /api/jp/projects/:id
exports.updateProject = async (req, res) => {
  try {
    const p = await JpProject.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'المشروع غير موجود' });
    const w = who(req, { scope: p.scope, section: p.section });
    if (!w || !w.canManage) return res.status(403).json({ message: 'المشروعاتُ يعدّلها مديرُ القسم' });
    const b = req.body || {};
    if (b.name !== undefined) { const v = String(b.name).trim(); if (!v) throw bad('اكتب اسمَ المشروع'); p.name = v; }
    if (b.description !== undefined) p.description = String(b.description || '').trim();
    if (b.startDate !== undefined) p.startDate = day(b.startDate);
    if (b.endDate !== undefined) p.endDate = day(b.endDate);
    if (b.status === 'active' || b.status === 'closed') p.status = b.status;
    await p.save();
    broadcast(w);
    res.json({ project: p });
  } catch (e) { fail(res, e, 'تعذّر التعديل'); }
};

// DELETE /api/jp/projects/:id - tasks stay and leave the project
exports.deleteProject = async (req, res) => {
  try {
    const p = await JpProject.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'المشروع غير موجود' });
    const w = who(req, { scope: p.scope, section: p.section });
    if (!w || !w.canManage) return res.status(403).json({ message: 'المشروعاتُ يحذفها مديرُ القسم' });
    // Deleting a project does not erase people's work: its tasks remain without a project.
    await JpTask.updateMany({ project: p._id }, { $set: { project: null } });
    await p.deleteOne();
    broadcast(w);
    res.json({ deleted: true });
  } catch (e) { fail(res, e, 'تعذّر الحذف'); }
};

// Dashboard - manager only
// GET /api/jp/dashboard?scope=&section=&from=&to=
exports.dashboard = async (req, res) => {
  try {
    const w = who(req, req.query);
    if (!w) return res.status(404).json({ message: 'قسمٌ غير معروف' });
    if (!w.canManage) return res.status(403).json({ message: 'لوحةُ الخطّة لمدير القسم', code: 'JP_MANAGER_ONLY' });

    const f = { scope: w.scope, section: w.section };
    const from = day(req.query.from); const to = day(req.query.to);
    if (from || to) {
      f.createdAt = {};
      if (from) f.createdAt.$gte = from;
      if (to) f.createdAt.$lt = new Date(to.getTime() + 86400000);
    }
    // Dashboard filters: employee, project, kind, contact method.
    // Applied to everything on the dashboard (cards, tables, list) so no whole-team figure sits above one employee's list.
    // Exception: the tables that become filters when clicked. The employee name in the team table and the project name in projects filter the dashboard; counting those tables after their own filter would zero everyone else on a click and reorder the table under the cursor. So the team table counts with all filters except employee, and projects with all except project (faceted counts); everything else uses all filters. That is why both are applied in memory, not in the query.
    const { assignee, project: projectQ, kind: kindQ, action: actionQ } = req.query;
    const idOf = (x) => String((x && x._id) || x || '');
    const assigneeOk = assignee && mongoose.isValidObjectId(assignee)
      ? (t) => idOf(t.assignedTo) === String(assignee) : () => true;
    const projectOk = projectQ === 'none' ? (t) => !t.project
      : projectQ && mongoose.isValidObjectId(projectQ) ? (t) => idOf(t.project) === String(projectQ) : () => true;
    if (kindQ === 'task' || kindQ === 'request') f.kind = kindQ;
    if (actionQ === 'none') f.action = '';
    else if (actionQ && ACTIONS.includes(actionQ)) f.action = actionQ;
    const [allTasks, team, projects] = await Promise.all([
      POP(JpTask.find(f)).lean(),
      teamOf(w),
      JpProject.find({ scope: w.scope, section: w.section }).lean(),
    ]);
    // Section-specific filters: the task type (the section's own titles) and what the task is linked to (its records, e.g. a clearance, a vehicle, an employee).
    const titleQ = String(req.query.title || '').trim();
    const linkQ = String(req.query.link || '').trim();
    const titleOk = titleQ ? (t) => String(t.title || '').trim() === titleQ : () => true;
    const linkOk = linkQ === 'none' ? (t) => !(t.links || []).length : linkQ ? (t) => (t.links || []).some((l) => l.kind === linkQ) : () => true;
    const scoped = allTasks.filter((t) => titleOk(t) && linkOk(t));
    const tasks = scoped.filter((t) => assigneeOk(t) && projectOk(t));
    const now = Date.now();
    const blank = () => ({ assigned: 0, open: 0, done: 0, overdue: 0, onTime: 0, late: 0, requestsMade: 0, hoursSum: 0, hoursN: 0 });
    const members = new Map(team.map((m) => [String(m._id), { ...m, ...blank() }]));
    // Active, not-ended accounts: an assignee outside the section's roles still counts as a member.
    const activeIds = new Set((await teamOf(w, { wide: true, assign: true })).map((m) => String(m._id)));
    const totals = { total: 0, tasks: 0, requests: 0, open: 0, done: 0, overdue: 0, onTime: 0, late: 0, noDeadline: 0, withFiles: 0, dueSoon: 0 };
    const byAction = {}; const byProject = new Map();
    const dayKey = (d) => new Date(new Date(d).getTime() + 3 * HOUR).toISOString().slice(0, 10);
    const daily = new Map();
    for (let i = 13; i >= 0; i -= 1) daily.set(dayKey(now - i * 86400000), { day: dayKey(now - i * 86400000), created: 0, done: 0 });

    for (const t of tasks) {
      const s = stateOf(t, now);
      totals.total += 1;
      if (t.kind === 'task') totals.tasks += 1; else totals.requests += 1;
      if (s === 'done') totals.done += 1; else totals.open += 1;
      if (s === 'overdue') totals.overdue += 1;
      if (!t.deadlineAt) totals.noDeadline += 1;
      if ((t.attachments || []).length) totals.withFiles += 1;
      if (s === 'open' && t.deadlineAt && new Date(t.deadlineAt).getTime() - now <= 24 * HOUR) totals.dueSoon += 1;
      const onTime = s === 'done' && t.deadlineAt ? new Date(t.doneAt) <= new Date(t.deadlineAt) : null;
      if (onTime === true) totals.onTime += 1; if (onTime === false) totals.late += 1;

      const a = t.action || 'none';
      byAction[a] = byAction[a] || { action: a, total: 0, done: 0 };
      byAction[a].total += 1; if (s === 'done') byAction[a].done += 1;

      const ck = dayKey(t.createdAt); if (daily.has(ck)) daily.get(ck).created += 1;
      if (t.doneAt) { const dk = dayKey(t.doneAt); if (daily.has(dk)) daily.get(dk).done += 1; }
    }

    // Team table: all filters except employee, see above.
    for (const t of scoped) {
      if (!projectOk(t)) continue;
      const s = stateOf(t, now);
      const onTime = s === 'done' && t.deadlineAt ? new Date(t.doneAt) <= new Date(t.deadlineAt) : null;
      const aid = assigneeKey(t);
      // Someone who left the team keeps their tasks counted under their name; they do not drop out of the total.
      // An active person assigned from outside the section's roles (e.g. a super_admin in IT) is a member, not 'former'.
      if (!members.has(aid)) members.set(aid, { _id: aid, name: assigneeName(t) || '—', role: t.assignedTo?.role || '', roleAr: LABELS_AR[t.assignedTo?.role] || '', roleEn: LABELS_EN[t.assignedTo?.role] || '', former: !activeIds.has(aid), ...blank() });
      const m = members.get(aid);
      m.assigned += 1;
      if (s === 'done') { m.done += 1; if (t.doneAt) { m.hoursSum += (new Date(t.doneAt) - new Date(t.createdAt)) / HOUR; m.hoursN += 1; } } else m.open += 1;
      if (s === 'overdue') m.overdue += 1;
      if (onTime === true) m.onTime += 1; if (onTime === false) m.late += 1;
      const cid = String(t.createdBy?._id || t.createdBy);
      if (t.kind === 'request' && members.has(cid)) members.get(cid).requestsMade += 1;
    }
    // Projects: all filters except project.
    for (const t of scoped) {
      if (!assigneeOk(t)) continue;
      const s = stateOf(t, now);
      const aid = assigneeKey(t);
      const pid = t.project ? String(t.project._id || t.project) : 'none';
      const pe = byProject.get(pid) || { total: 0, done: 0, overdue: 0, people: new Set() };
      pe.total += 1; if (s === 'done') pe.done += 1; if (s === 'overdue') pe.overdue += 1; pe.people.add(aid);
      byProject.set(pid, pe);
    }

    const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
    const { metaFor, kindsFor } = require('../config/jpLinks');
    const linkMeta = w.section ? metaFor(w.section) : {};
    const slim = (t) => ({
      _id: t._id, title: t.title, kind: t.kind, assignedToName: assigneeName(t), createdByName: nameOf(t.createdBy),
      deadlineAt: t.deadlineAt, doneAt: t.doneAt, createdAt: t.createdAt, project: t.project?.name || '',
      files: (t.attachments || []).length, doneNote: t.doneNote || '', state: stateOf(t, now),
      spentMinutes: t.spentMinutes || 0, expectedMinutes: t.expectedMinutes ?? null,
      links: (t.links || []).map((l) => ({ kind: l.kind, label: l.label, href: linkMeta[l.kind]?.href ? linkMeta[l.kind].href.replace(':id', String(l.ref)) : '' })),
    });
    // By task type: how much of each the team did and how long it took (the section's own work, whatever it is).
    const byTitleMap = new Map();
    for (const t of tasks) {
      const k = String(t.title || '').trim() || '—';
      const e = byTitleMap.get(k) || { title: k, total: 0, done: 0, overdue: 0, minutes: 0, timed: 0 };
      const st = stateOf(t, now);
      e.total += 1; if (st === 'done') e.done += 1; if (st === 'overdue') e.overdue += 1;
      if (t.spentMinutes) { e.minutes += t.spentMinutes; e.timed += 1; }
      byTitleMap.set(k, e);
    }
    const byTitle = [...byTitleMap.values()].map((e) => ({ ...e, minutes: Math.round(e.minutes), avgMinutes: e.timed ? Math.round(e.minutes / e.timed) : null }))
      .sort((a, b) => b.total - a.total);
    // Options built from the section's tasks before these two filters, so picking one keeps the others selectable.
    const titleOptions = [...new Set(allTasks.map((t) => String(t.title || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
    const linkOptions = (w.section ? kindsFor(w.section) : []).map((k) => ({ kind: k, ar: linkMeta[k]?.ar || k, en: linkMeta[k]?.en || k, count: allTasks.filter((t) => (t.links || []).some((l) => l.kind === k)).length }));
    res.json({
      sectionAr: w.def ? w.def.ar : 'الإدارة العليا', sectionEn: w.def ? w.def.en : 'Top management',
      totals: { ...totals, completionRate: pct(totals.done, totals.total), onTimeRate: pct(totals.onTime, totals.onTime + totals.late) },
      members: [...members.values()].map((m) => ({
        ...m,
        completionRate: pct(m.done, m.assigned), onTimeRate: pct(m.onTime, m.onTime + m.late),
        avgHours: m.hoursN ? Math.round((m.hoursSum / m.hoursN) * 10) / 10 : null,
        hoursSum: undefined, hoursN: undefined,
      })).sort((a, b) => b.open - a.open || b.assigned - a.assigned),
      // Someone with no open task is first in line for assignment.
      idle: [...members.values()].filter((m) => !m.former && m.open === 0).map((m) => ({ _id: m._id, name: m.name, roleAr: m.roleAr, roleEn: m.roleEn })),
      projects: [
        ...projects.map((p) => { const e = byProject.get(String(p._id)) || { total: 0, done: 0, overdue: 0, people: new Set() }; return { _id: p._id, name: p.name, status: p.status, startDate: p.startDate, endDate: p.endDate, total: e.total, done: e.done, overdue: e.overdue, people: e.people.size, progress: pct(e.done, e.total) }; }),
        ...(byProject.has('none') ? [{ _id: 'none', name: '', status: 'active', total: byProject.get('none').total, done: byProject.get('none').done, overdue: byProject.get('none').overdue, people: byProject.get('none').people.size, progress: pct(byProject.get('none').done, byProject.get('none').total) }] : []),
      ],
      byAction: Object.values(byAction).sort((a, b) => b.total - a.total),
      daily: [...daily.values()],
      overdue: tasks.filter((t) => stateOf(t, now) === 'overdue').sort((a, b) => new Date(a.deadlineAt) - new Date(b.deadlineAt)).slice(0, 50).map(slim),
      dueSoon: tasks.filter((t) => stateOf(t, now) === 'open' && t.deadlineAt && new Date(t.deadlineAt).getTime() - now <= 24 * HOUR).sort((a, b) => new Date(a.deadlineAt) - new Date(b.deadlineAt)).slice(0, 50).map(slim),
      recentDone: tasks.filter((t) => t.status === 'done').sort((a, b) => new Date(b.doneAt) - new Date(a.doneAt)).slice(0, 20).map(slim),
      // The whole list is under the filters; the status filter is applied in the screen on top of it, so cards still count every status and one can be picked.
      tasks: tasks.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 500).map((t) => ({
        ...slim(t), action: t.action || '', comments: (t.comments || []).length,
        dueSoon: stateOf(t, now) === 'open' && !!t.deadlineAt && new Date(t.deadlineAt).getTime() - now <= 24 * HOUR,
      })),
      team: team.map((m) => ({ _id: m._id, name: m.name })),
      projectOptions: projects.map((p) => ({ _id: p._id, name: p.name })),
      byTitle, titleOptions, linkOptions,
      totals2: { minutes: Math.round(tasks.reduce((a, t) => a + (t.spentMinutes || 0), 0)) },
      generatedAt: new Date(),
    });
  } catch (e) { fail(res, e, 'تعذّر تحميل اللوحة'); }
};

exports._who = who;
