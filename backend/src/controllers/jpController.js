/**
 * خطّةُ العمل (JP) — مهامُّ القسم ومشروعاتُه، ولوحةُ مديره.
 *
 * ── من يفعل ماذا ───────────────────────────────────────────────────────────
 *
 *   المدير     يُسند **مهمّةً** إلى أيٍّ من فريقه، وينشئ المشروعات، ويرى كلَّ
 *              ما في خطّة قسمه، ويعدّل ويحذف، ويفتح اللوحة.
 *   الموظّف    يرى ما أُسنِد إليه وما كتبه هو. يكتب **طلبًا** لنفسه أو لزميلٍ
 *              في قسمه، ويعدّل طلبَه ويحذفه. ويُتمّ ما أُسنِد إليه إن شاء.
 *   المُسنَد إليه  يقول «تمّ» ويرفق ما يثبته — أو لا يقول: الإتمامُ اختياريّ.
 *
 * وفي نطاق الإدارة (`management`) المعنى نفسُه درجةً أعلى: مديرُ النظام هو
 * «المدير»، ومديرو الأقسام هم «الفريق».
 *
 * ── والصلاحيّةُ تُحسَب هنا لا في الشاشة ────────────────────────────────────
 * `who()` تجيب عن كلّ طلبٍ: أهو مديرٌ في هذا النطاق أم عضوٌ أم غريب. وكلُّ
 * قراءةٍ وكتابةٍ تمرّ بها — فإخفاءُ زرٍّ في الشاشة لا يكون هو الحارس.
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

const TOP_ROLES = ['super_admin'];
const sameId = (a, b) => !!a && !!b && String(a._id || a) === String(b._id || b);
const nameOf = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || '' : '');
const HOUR = 3600000;

/**
 * موقعُ السائل من النطاق المطلوب. يردّ `null` إن كان النطاقُ نفسُه غيرَ معروف.
 *   canManage  مديرُ هذا النطاق (أو الإدارةُ العليا)
 *   isMember   من فريقه — يُسنَد إليه ويكتب طلبات
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

/** فريقُ النطاق: من يصحّ الإسنادُ إليهم. */
async function teamOf(w) {
  const base = { isActive: { $ne: false } };
  const users = await User.find(base).select('firstName lastName role email').lean();
  const pick = w.scope === 'management'
    // مديرو الأقسام — ولا يدخل مديرُ النظام قائمةَ من يُسنَد إليهم.
    ? (u) => isManagerRole(u.role) && !TOP_ROLES.includes(u.role)
    : (u) => w.def.memberRoles.includes(u.role);
  return users.filter(pick).map((u) => ({
    _id: u._id,
    name: nameOf(u),
    role: u.role,
    roleAr: LABELS_AR[u.role] || u.role,
    roleEn: LABELS_EN[u.role] || u.role,
    isManager: w.scope === 'management' ? false : w.def.managerRoles.includes(u.role),
  })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

/** ما يراه السائل: المديرُ كلَّ النطاق، وغيرُه ما أُسنِد إليه أو كتبه. */
const visible = (req, w) => {
  const f = { scope: w.scope, section: w.section };
  if (!w.canManage) f.$or = [{ assignedTo: req.user._id }, { createdBy: req.user._id }];
  return f;
};

const POP = (q) => q
  .populate('assignedTo', 'firstName lastName role')
  .populate('createdBy', 'firstName lastName role')
  .populate('project', 'name status');

/** الحالةُ كما تُقرأ: تمّت، أو تأخّرت، أو قائمة. تُشتقّ من الموعد لا تُخزَّن. */
const stateOf = (t, now = Date.now()) => {
  if (t.status === 'done') return 'done';
  if (t.deadlineAt && new Date(t.deadlineAt).getTime() < now) return 'overdue';
  return 'open';
};

const shape = (t, req, w) => {
  const mine = sameId(t.assignedTo, req.user._id);
  const author = sameId(t.createdBy, req.user._id);
  // أصلُ المهمّة في خطّة الإدارة لا يراه إلّا مديرُ القسم.
  const { parentTask, ...rest } = t;
  return {
    ...rest,
    fromManagement: w.canManage && !!parentTask,
    state: stateOf(t),
    onTime: t.status === 'done' && t.deadlineAt ? new Date(t.doneAt) <= new Date(t.deadlineAt) : null,
    assignedToName: nameOf(t.assignedTo),
    createdByName: nameOf(t.createdBy),
    // ما يجوز لهذا السائل على هذه المهمّة — تقرؤه الشاشةُ ولا تخمّنه.
    can: {
      complete: mine || w.canManage,
      edit: w.canManage || (author && t.kind === 'request'),
      remove: w.canManage || (author && t.kind === 'request'),
      attach: mine || author || w.canManage,
      comment: mine || author || w.canManage,
    },
  };
};

const broadcast = (w) => { try { emitToAll('jp:changed', { scope: w.scope, section: w.section }); } catch (_) { /* زيادة */ } };

const notify = async (recipient, actor, title, message, id) => {
  if (!recipient || sameId(recipient, actor)) return;
  try {
    await createNotification({
      recipient: recipient._id || recipient, type: 'task_assigned', title, message,
      relatedEntity: 'JpTask', relatedEntityId: id,
    });
  } catch (_) { /* الإشعارُ زيادة — لا يُفشل الحفظ */ }
};

/**
 * الموعد من جسم الطلب → لحظةٌ واحدة.
 *   { deadlineKind: 'date',  deadlineDate: 'YYYY-MM-DD' }  آخرُ ذلك اليوم بتوقيت الرياض
 *   { deadlineKind: 'hours', deadlineHours: 2 }            الآن + ساعتان
 *   { deadlineKind: '' }                                   بلا موعد
 * يردّ `undefined` إن لم يُرسَل الموعدُ أصلًا (فلا يُمسّ عند التعديل).
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

const fail = (res, e, fallback) => res.status(e?.name === 'ValidationError' || e?.status === 400 ? 400 : 500)
  .json({ message: e?.status === 400 || e?.name === 'ValidationError' ? e.message : fallback });
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

// ═══════════════════════════════════════════════════════════════════════════
//  من أنا في هذه الخطّة
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/jp/me?scope=&section=
exports.me = async (req, res) => {
  try {
    const w = who(req, req.query);
    if (!w) return res.status(404).json({ message: 'قسمٌ غير معروف' });
    if (!w.isMember) return res.status(403).json({ message: 'خطّةُ العمل لفريق القسم ومديره', code: 'JP_NOT_MEMBER' });
    const [team, projects] = await Promise.all([
      teamOf(w),
      JpProject.find({ scope: w.scope, section: w.section }).sort({ status: 1, createdAt: -1 }).lean(),
    ]);
    res.json({
      scope: w.scope, section: w.section, canManage: w.canManage,
      sectionAr: w.def ? w.def.ar : 'الإدارة العليا', sectionEn: w.def ? w.def.en : 'Top management',
      me: req.user._id,
      // الموظّفُ يُسند إلى نفسه وزملائه؛ والمديرُ إلى الفريق كلِّه.
      team,
      projects,
      actions: ACTIONS.filter(Boolean),
    });
  } catch (e) { fail(res, e, 'تعذّر تحميل الخطّة'); }
};

// GET /api/jp/home — أين خطّةُ هذا المستخدم (يفتحها الإشعار).
exports.home = (req, res) => {
  const role = req.user?.role;
  if (TOP_ROLES.includes(role)) return res.json({ path: '/system/management-jp' });
  const s = sectionOfRole(role);
  if (s) return res.json({ path: `${s.path}/jp` });
  res.json({ path: null });
};

// ═══════════════════════════════════════════════════════════════════════════
//  المهامّ
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/jp/tasks?scope=&section=&box=mine|sent|all&status=&project=&assignee=&kind=
exports.listTasks = async (req, res) => {
  try {
    const w = who(req, req.query);
    if (!w) return res.status(404).json({ message: 'قسمٌ غير معروف' });
    if (!w.isMember) return res.status(403).json({ message: 'خطّةُ العمل لفريق القسم ومديره' });

    const f = visible(req, w);
    const and = [];
    const { box, status, project, assignee, kind } = req.query;
    if (box === 'mine') and.push({ assignedTo: req.user._id });
    else if (box === 'sent') and.push({ createdBy: req.user._id, assignedTo: { $ne: req.user._id } });
    if (kind === 'task' || kind === 'request') and.push({ kind });
    if (project === 'none') and.push({ project: null });
    else if (project && mongoose.isValidObjectId(project)) and.push({ project });
    if (assignee && mongoose.isValidObjectId(assignee)) and.push({ assignedTo: assignee });
    const now = new Date();
    if (status === 'done') and.push({ status: 'done' });
    else if (status === 'open') and.push({ status: 'open' });
    else if (status === 'overdue') and.push({ status: 'open', deadlineAt: { $ne: null, $lt: now } });
    if (and.length) f.$and = and;

    const rows = await POP(JpTask.find(f)).sort({ status: 1, deadlineAt: 1, createdAt: -1 }).limit(1000).lean();
    // المفتوحُ أوّلًا بأقرب موعد، وما لا موعدَ له بعده، والمنجَزُ آخرًا بأحدثه.
    const rank = (t) => (t.status === 'done' ? 2 : t.deadlineAt ? 0 : 1);
    rows.sort((a, b) => rank(a) - rank(b)
      || (rank(a) === 0 ? new Date(a.deadlineAt) - new Date(b.deadlineAt) : 0)
      || (rank(a) === 2 ? new Date(b.doneAt || 0) - new Date(a.doneAt || 0) : new Date(b.createdAt) - new Date(a.createdAt)));

    // العدّاداتُ على ما يراه السائل كلِّه — لا على ما بقي بعد الفلتر.
    const all = await JpTask.find(visible(req, w)).select('status deadlineAt assignedTo createdBy kind').lean();
    const t0 = Date.now();
    const counts = { all: all.length, open: 0, overdue: 0, done: 0, mine: 0, sent: 0 };
    for (const t of all) {
      const s = stateOf(t, t0);
      if (s === 'done') counts.done += 1; else { counts.open += 1; if (s === 'overdue') counts.overdue += 1; }
      if (sameId(t.assignedTo, req.user._id) && t.status !== 'done') counts.mine += 1;
      if (sameId(t.createdBy, req.user._id) && !sameId(t.assignedTo, req.user._id) && t.status !== 'done') counts.sent += 1;
    }
    // في خطّة الإدارة: أين وصلت كلُّ مهمّةٍ أسندها مديرُها إلى فريقه.
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
          // من أُسنِدت إليه وله قسمٌ يديره يستطيع أن يُنزلها إلى فريقه.
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
    const team = await teamOf(w);
    const assignedTo = req.body.assignedTo || (w.top ? null : req.user._id);
    // الإسنادُ داخل الفريق وحدَه — لا يُسنَد إلى موظّفِ قسمٍ آخر من هذه الخطّة.
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

    const doc = await JpTask.create({
      scope: w.scope, section: w.section,
      // المديرُ يكلِّف، وغيرُه يطلب — يحدّده من كتب لا ما أُرسِل.
      kind: w.canManage ? 'task' : 'request',
      project, title, details: String(req.body.details || '').trim(), action,
      contact: String(req.body.contact || '').trim(),
      assignedTo, createdBy: req.user._id, ...deadline,
    });
    for (const f of (Array.isArray(req.body.files) ? req.body.files : []).slice(0, 5)) {
      const stored = saveUploadFile(f.dataUrl, 'jp', f.fileName);
      doc.attachments.push({ ...stored, phase: 'brief', uploadedBy: req.user._id, uploadedByName: nameOf(req.user) });
    }
    if (doc.attachments.length) await doc.save();

    await notify(assignedTo, req.user._id,
      doc.kind === 'task' ? 'مهمّةٌ جديدةٌ أُسنِدت إليك' : 'طلبٌ جديدٌ من زميل',
      `${title} — من ${nameOf(req.user)}`, doc._id);
    await logAudit({ user: req.user._id, action: 'create', entity: 'JpTask', entityId: doc._id, changes: { after: { title, kind: doc.kind, section: w.section, assignedTo } }, ipAddress: req.ip }).catch(() => {});
    broadcast(w);
    const fresh = await POP(JpTask.findById(doc._id)).lean();
    res.status(201).json({ task: shape(fresh, req, w) });
  } catch (e) { fail(res, e, 'تعذّر إنشاء المهمّة'); }
};

/** المهمّةُ وموقعُ السائل منها، أو ردٌّ بالرفض. */
async function loadTask(req, res) {
  const t = await JpTask.findById(req.params.id);
  if (!t) { res.status(404).json({ message: 'المهمّة غير موجودة' }); return null; }
  const w = who(req, { scope: t.scope, section: t.section });
  const related = sameId(t.assignedTo, req.user._id) || sameId(t.createdBy, req.user._id);
  if (!w || !(w.canManage || (w.isMember && related))) { res.status(403).json({ message: 'ليست من مهامّك' }); return null; }
  return { t, w, mine: sameId(t.assignedTo, req.user._id), author: sameId(t.createdBy, req.user._id) };
}

// PATCH /api/jp/tasks/:id — تعديلُ النصّ والإسناد والموعد
exports.updateTask = async (req, res) => {
  try {
    const got = await loadTask(req, res); if (!got) return;
    const { t, w, author } = got;
    if (!(w.canManage || (author && t.kind === 'request'))) return res.status(403).json({ message: 'التعديلُ لمن أسند المهمّة' });

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
    if (b.assignedTo !== undefined && !sameId(b.assignedTo, t.assignedTo)) {
      const team = await teamOf(w);
      if (!(team.some((m) => sameId(m._id, b.assignedTo)) || sameId(b.assignedTo, req.user._id))) throw bad('اختر من يُسنَد إليه من فريق القسم');
      t.assignedTo = b.assignedTo; reassigned = true;
    }
    const deadline = readDeadline(b);
    if (deadline) Object.assign(t, deadline);
    await t.save();
    if (reassigned) await notify(t.assignedTo, req.user._id, 'مهمّةٌ أُسنِدت إليك', `${t.title} — من ${nameOf(req.user)}`, t._id);
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
      t.status = 'done'; t.doneAt = new Date(); t.doneBy = req.user._id;
      t.doneNote = String(req.body.note || '').trim();
      const f = req.body.file;
      if (f && f.dataUrl) {
        const stored = saveUploadFile(f.dataUrl, 'jp', f.fileName);
        t.attachments.push({ ...stored, phase: 'done', uploadedBy: req.user._id, uploadedByName: nameOf(req.user) });
      }
    } else {
      // رجع عن الإتمام: تعود مفتوحةً وتبقى مرفقاتُها.
      t.status = 'open'; t.doneAt = null; t.doneBy = null; t.doneNote = '';
    }
    await t.save();
    if (done) await notify(t.createdBy, req.user._id, 'تمّت مهمّة', `${t.title} — ${nameOf(req.user)}`, t._id);
    await logAudit({ user: req.user._id, action: done ? 'complete' : 'reopen', entity: 'JpTask', entityId: t._id, changes: { after: { title: t.title, status: t.status } }, ipAddress: req.ip }).catch(() => {});
    broadcast(w);
    res.json({ task: shape(await POP(JpTask.findById(t._id)).lean(), req, w) });
  } catch (e) { fail(res, e, 'تعذّر الحفظ'); }
};

// POST /api/jp/tasks/:id/attachments — { dataUrl, fileName }
exports.addAttachment = async (req, res) => {
  try {
    const got = await loadTask(req, res); if (!got) return;
    const { t, w, mine } = got;
    const stored = saveUploadFile(req.body.dataUrl, 'jp', req.body.fileName);
    // ما يرفعه المنفِّذُ دليلُ إتمام، وما يرفعه غيرُه من أصل التكليف.
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
    // يُخبَر الطرفُ الآخر: من أُسنِدت إليه إن علّق غيرُه، ومن أسندها إن علّق هو.
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
    await logAudit({ user: req.user._id, action: 'delete', entity: 'JpTask', entityId: t._id, changes: { before: { title: t.title, kind: t.kind, section: t.section } }, ipAddress: req.ip }).catch(() => {});
    broadcast(w);
    res.json({ deleted: true });
  } catch (e) { fail(res, e, 'تعذّر الحذف'); }
};

// ═══════════════════════════════════════════════════════════════════════════
//  الإنزال — مديرُ القسم يُسند ما كُلِّف به إلى فريقه
// ═══════════════════════════════════════════════════════════════════════════
/**
 * ما أسندته الإدارةُ العليا إلى مدير القسم يُنزله إلى موظّفٍ عنده. والناتجُ
 * مهمّةُ قسمٍ عاديّةٌ **كاتبُها المدير**: الموظّفُ يراها من مديره كأيّ مهمّةٍ
 * أخرى، ولا شيءَ فيها يقول من أين جاءت. والأصلُ يبقى على المدير أمام الإدارة —
 * هو المسؤولُ عنه، ويُتمّه حين يرى أنّ العملَ تمّ.
 */
async function handDownOne(parent, def, assignee, req, sectionProject = null) {
  const child = await JpTask.create({
    scope: 'section', section: def.slug, kind: 'task', project: sectionProject,
    title: parent.title, details: parent.details, action: parent.action, contact: parent.contact,
    assignedTo: assignee, createdBy: req.user._id,
    deadlineKind: parent.deadlineAt ? 'date' : '', deadlineHours: null, deadlineAt: parent.deadlineAt,
    // مرفقاتُ التكليف تنزل معه — الملفُّ نفسُه، باسم المدير.
    attachments: (parent.attachments || []).filter((a) => a.phase === 'brief').map((a) => ({
      fileUrl: a.fileUrl, fileName: a.fileName, mimeType: a.mimeType, size: a.size, phase: 'brief',
      uploadedBy: req.user._id, uploadedByName: nameOf(req.user),
    })),
    parentTask: parent._id,
  });
  await notify(assignee, req.user._id, 'مهمّةٌ جديدةٌ أُسنِدت إليك', `${parent.title} — من ${nameOf(req.user)}`, child._id);
  return child;
}

/** قسمُ المدير وفريقُه، أو رفض. */
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

// POST /api/jp/projects/:id/hand-down — { assignedTo } : مهامّي المفتوحةُ في المشروع كلُّها
exports.handDownProject = async (req, res) => {
  try {
    const p = await JpProject.findById(req.params.id);
    if (!p || p.scope !== 'management') return res.status(404).json({ message: 'المشروع غير موجود' });
    const def = await myTeamFor(req, res, req.body.assignedTo); if (!def) return;
    const mine = await JpTask.find({ project: p._id, scope: 'management', assignedTo: req.user._id, status: 'open' });
    if (!mine.length) return res.status(400).json({ message: 'لا مهامَّ مفتوحةً لك في هذا المشروع' });
    // مشروعُ القسم يُنشأ مرّةً ويُعاد استعمالُه إن نزلت منه مهامُّ من قبل.
    const sp = await JpProject.findOne({ scope: 'section', section: def.slug, parentProject: p._id })
      || await JpProject.create({ scope: 'section', section: def.slug, name: p.name, description: p.description, startDate: p.startDate, endDate: p.endDate, createdBy: req.user._id, parentProject: p._id });
    const done = new Set((await JpTask.find({ parentTask: { $in: mine.map((t) => t._id) } }).select('parentTask').lean()).map((k) => String(k.parentTask)));
    let created = 0;
    for (const t of mine) {
      if (done.has(String(t._id))) continue;      // نزلت من قبل — لا تُكرَّر
      await handDownOne(t, def, req.body.assignedTo, req, sp._id); created += 1;
    }
    broadcast({ scope: 'section', section: def.slug });
    broadcast({ scope: 'management', section: 'management' });
    res.status(201).json({ created, project: sp._id });
  } catch (e) { fail(res, e, 'تعذّر الإسناد'); }
};

// ═══════════════════════════════════════════════════════════════════════════
//  المشروعات — للمدير
// ═══════════════════════════════════════════════════════════════════════════
const day = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? new Date(`${String(v).slice(0, 10)}T00:00:00.000+03:00`) : null);

// GET /api/jp/projects?scope=&section=
exports.listProjects = async (req, res) => {
  try {
    const w = who(req, req.query);
    if (!w) return res.status(404).json({ message: 'قسمٌ غير معروف' });
    if (!w.isMember) return res.status(403).json({ message: 'خطّةُ العمل لفريق القسم ومديره' });
    const projects = await JpProject.find({ scope: w.scope, section: w.section }).sort({ status: 1, createdAt: -1 }).lean();
    // تقدّمُ المشروع على ما يراه السائل من مهامّه.
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

// DELETE /api/jp/projects/:id — المهامُّ تبقى وتخرج من المشروع
exports.deleteProject = async (req, res) => {
  try {
    const p = await JpProject.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'المشروع غير موجود' });
    const w = who(req, { scope: p.scope, section: p.section });
    if (!w || !w.canManage) return res.status(403).json({ message: 'المشروعاتُ يحذفها مديرُ القسم' });
    // حذفُ المشروع لا يمحو عملَ الناس: مهامُّه تبقى بلا مشروع.
    await JpTask.updateMany({ project: p._id }, { $set: { project: null } });
    await p.deleteOne();
    broadcast(w);
    res.json({ deleted: true });
  } catch (e) { fail(res, e, 'تعذّر الحذف'); }
};

// ═══════════════════════════════════════════════════════════════════════════
//  اللوحة — للمدير وحدَه
// ═══════════════════════════════════════════════════════════════════════════
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
    // ── فلاترُ اللوحة: موظّفٌ، مشروعٌ، نوعٌ، طريقةُ تواصل ─────────────────────
    // تُطبَّق على كلّ شيءٍ في اللوحة — البطاقاتُ والجداولُ والقائمة — فلا يُقرأ
    // رقمٌ على الفريق كلِّه فوق قائمةِ موظّفٍ واحد.
    const { assignee, project: projectQ, kind: kindQ, action: actionQ } = req.query;
    if (assignee && mongoose.isValidObjectId(assignee)) f.assignedTo = assignee;
    if (projectQ === 'none') f.project = null;
    else if (projectQ && mongoose.isValidObjectId(projectQ)) f.project = projectQ;
    if (kindQ === 'task' || kindQ === 'request') f.kind = kindQ;
    if (actionQ === 'none') f.action = '';
    else if (actionQ && ACTIONS.includes(actionQ)) f.action = actionQ;
    const [tasks, team, projects] = await Promise.all([
      POP(JpTask.find(f)).lean(),
      teamOf(w),
      JpProject.find({ scope: w.scope, section: w.section }).lean(),
    ]);
    const now = Date.now();
    const blank = () => ({ assigned: 0, open: 0, done: 0, overdue: 0, onTime: 0, late: 0, requestsMade: 0, hoursSum: 0, hoursN: 0 });
    const members = new Map(team.map((m) => [String(m._id), { ...m, ...blank() }]));
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

      const aid = String(t.assignedTo?._id || t.assignedTo);
      // من خرج من الفريق تبقى مهامُّه معدودةً باسمه — لا تسقط من الإجمالي.
      if (!members.has(aid)) members.set(aid, { _id: aid, name: nameOf(t.assignedTo) || '—', role: t.assignedTo?.role || '', roleAr: LABELS_AR[t.assignedTo?.role] || '', roleEn: LABELS_EN[t.assignedTo?.role] || '', former: true, ...blank() });
      const m = members.get(aid);
      m.assigned += 1;
      if (s === 'done') { m.done += 1; if (t.doneAt) { m.hoursSum += (new Date(t.doneAt) - new Date(t.createdAt)) / HOUR; m.hoursN += 1; } } else m.open += 1;
      if (s === 'overdue') m.overdue += 1;
      if (onTime === true) m.onTime += 1; if (onTime === false) m.late += 1;
      const cid = String(t.createdBy?._id || t.createdBy);
      if (t.kind === 'request' && members.has(cid)) members.get(cid).requestsMade += 1;

      const a = t.action || 'none';
      byAction[a] = byAction[a] || { action: a, total: 0, done: 0 };
      byAction[a].total += 1; if (s === 'done') byAction[a].done += 1;

      const pid = t.project ? String(t.project._id || t.project) : 'none';
      const pe = byProject.get(pid) || { total: 0, done: 0, overdue: 0, people: new Set() };
      pe.total += 1; if (s === 'done') pe.done += 1; if (s === 'overdue') pe.overdue += 1; pe.people.add(aid);
      byProject.set(pid, pe);

      const ck = dayKey(t.createdAt); if (daily.has(ck)) daily.get(ck).created += 1;
      if (t.doneAt) { const dk = dayKey(t.doneAt); if (daily.has(dk)) daily.get(dk).done += 1; }
    }

    const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
    const slim = (t) => ({
      _id: t._id, title: t.title, kind: t.kind, assignedToName: nameOf(t.assignedTo), createdByName: nameOf(t.createdBy),
      deadlineAt: t.deadlineAt, doneAt: t.doneAt, createdAt: t.createdAt, project: t.project?.name || '',
      files: (t.attachments || []).length, doneNote: t.doneNote || '', state: stateOf(t, now),
    });
    res.json({
      sectionAr: w.def ? w.def.ar : 'الإدارة العليا', sectionEn: w.def ? w.def.en : 'Top management',
      totals: { ...totals, completionRate: pct(totals.done, totals.total), onTimeRate: pct(totals.onTime, totals.onTime + totals.late) },
      members: [...members.values()].map((m) => ({
        ...m,
        completionRate: pct(m.done, m.assigned), onTimeRate: pct(m.onTime, m.onTime + m.late),
        avgHours: m.hoursN ? Math.round((m.hoursSum / m.hoursN) * 10) / 10 : null,
        hoursSum: undefined, hoursN: undefined,
      })).sort((a, b) => b.open - a.open || b.assigned - a.assigned),
      // من لا مهمّةَ مفتوحةً عليه — أوّلُ من يُسنَد إليه.
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
      // القائمةُ كلُّها تحت الفلاتر — وفلترُ الحالة يُطبَّق في الشاشة عليها، فتبقى
      // البطاقاتُ تعدّ الحالاتِ كلَّها ويُختار منها.
      tasks: tasks.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 500).map((t) => ({
        ...slim(t), action: t.action || '', comments: (t.comments || []).length,
        dueSoon: stateOf(t, now) === 'open' && !!t.deadlineAt && new Date(t.deadlineAt).getTime() - now <= 24 * HOUR,
      })),
      team: team.map((m) => ({ _id: m._id, name: m.name })),
      projectOptions: projects.map((p) => ({ _id: p._id, name: p.name })),
      generatedAt: new Date(),
    });
  } catch (e) { fail(res, e, 'تعذّر تحميل اللوحة'); }
};

exports._who = who;
