/**
 * GET /api/business-review/activity — every update made on business review tasks: who, from which section, what changed
 * (status, note, postponement, files, creation, archive), when, and where the task stands now.
 * Read from the tasks' own update logs (BrAction / BrAssignment `updates`), so history before this page is included.
 * Open to the top roles and the software team, or to anyone given the page on the permissions screen.
 */
const { BrAction, BrAssignment, BrMeeting } = require('../models/BusinessReview');
const { sectionsOfUserIds } = require('../utils/userSection');
const { orgSectionOfRole } = require('../config/roles');
const { ACTION_STATUSES, ACTIVITY_PAGE: PAGE, ACTIVITY_ROLES } = require('../config/businessReview');
const brScope = require('../utils/brScope');

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 400;
const statusAr = Object.fromEntries(ACTION_STATUSES.map((s) => [s.key, s.ar]));

/** Role list, or the page ticked for this account on the permissions screen. */
async function canSeeActivity(user) {
  if (!user) return false;
  if (ACTIVITY_ROLES.includes(user.ownRole || user.role)) return true;
  try {
    const granted = await require('../utils/permissions').explicitlyGrantedPagesForUser(user);
    return (granted || []).includes(PAGE);
  } catch (_) { return false; }
}
exports.canSeeActivity = canSeeActivity;

/** What one log line did, as a short kind and its Arabic name. */
function kindOf(u) {
  if (u.statusTo === 'postponed') return 'postpone';
  if (u.statusTo) return 'status';
  if (/^نُقل/.test(u.text || '')) return 'transfer';
  if (/^أُسند أيضًا/.test(u.text || '')) return 'share';
  if ((u.files || []).length && !String(u.text || '').trim()) return 'files';
  return 'note';
}
const KIND_AR = { status: 'تغيير الحالة', postpone: 'تأجيل', note: 'ملاحظة', files: 'مرفقات', transfer: 'نقل', share: 'إسناد إضافي', created: 'إنشاء بند', delegated: 'توزيع على الفريق', archived: 'أرشفة' };

exports.list = async (req, res) => {
  try {
    if (!(await canSeeActivity(req.user))) return res.status(403).json({ message: 'هذه الصفحة غير متاحة لحسابك', code: 'PAGE_FORBIDDEN' });
    const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
    const fromDay = YMD.test(String(req.query.from || '')) ? String(req.query.from) : new Date(Date.now() + 3 * 3600000 - 29 * 86400000).toISOString().slice(0, 10);
    const toDay = YMD.test(String(req.query.to || '')) ? String(req.query.to) : today;
    const from = new Date(`${fromDay}T00:00:00+03:00`);
    const to = new Date(`${toDay}T23:59:59.999+03:00`);
    if (!(from <= to) || to - from > MAX_DAYS * 86400000) return res.status(400).json({ message: `الفترة غير صحيحة (أقصى ${MAX_DAYS} يومًا)` });
    const range = { $gte: from, $lte: to };

    const [actLines, partLines, created, parts, archived] = await Promise.all([
      BrAction.aggregate([
        { $match: { 'updates.at': range } }, { $unwind: '$updates' }, { $match: { 'updates.at': range } },
        { $project: { u: '$updates', task: '$_id' } },
      ]),
      BrAssignment.aggregate([
        { $match: { 'updates.at': range } }, { $unwind: '$updates' }, { $match: { 'updates.at': range } },
        { $project: { u: '$updates', task: '$action', part: '$_id', partTitle: '$title', partAssignee: '$assigneeName' } },
      ]),
      BrAction.find({ createdAt: range }).select('_id createdAt createdBy createdByName assigneeName').lean(),
      BrAssignment.find({ createdAt: range }).select('_id action title assigneeName createdAt assignedBy assignedByName').lean(),
      BrAction.find({ archivedAt: range, archivedByName: { $ne: '' } }).select('_id archivedAt archivedBy archivedByName').lean(),
    ]);

    const events = [];
    for (const r of actLines) events.push({ id: `a${r.u._id}`, task: r.task, at: r.u.at, by: r.u.by, byName: r.u.byName, kind: kindOf(r.u), statusFrom: r.u.statusFrom || '', statusTo: r.u.statusTo || '', text: r.u.text || '', files: r.u.files || [] });
    for (const r of partLines) events.push({ id: `p${r.u._id}`, task: r.task, part: { _id: r.part, title: r.partTitle, assigneeName: r.partAssignee }, at: r.u.at, by: r.u.by, byName: r.u.byName, kind: kindOf(r.u), statusFrom: r.u.statusFrom || '', statusTo: r.u.statusTo || '', text: r.u.text || '', files: r.u.files || [] });
    for (const a of created) events.push({ id: `c${a._id}`, task: a._id, at: a.createdAt, by: a.createdBy, byName: a.createdByName, kind: 'created', text: `أُسند إلى ${a.assigneeName || ''}`.trim(), files: [] });
    for (const p of parts) events.push({ id: `d${p._id}`, task: p.action, part: { _id: p._id, title: p.title, assigneeName: p.assigneeName }, at: p.createdAt, by: p.assignedBy, byName: p.assignedByName, kind: 'delegated', text: `وُزّع على ${p.assigneeName || ''}: ${p.title || ''}`, files: [] });
    for (const a of archived) events.push({ id: `r${a._id}`, task: a._id, at: a.archivedAt, by: a.archivedBy, byName: a.archivedByName, kind: 'archived', text: '', files: [] });

    // The task each line belongs to, as it stands now.
    const taskIds = [...new Set(events.map((e) => String(e.task)).filter(Boolean))];
    const tasks = await BrAction.find({ _id: { $in: taskIds } })
      .select('title department assignee assigneeName assigneeRole status progress dueDate meeting meetingRef meetingTitle archivedAt shareGroup isOverdue').lean();
    const byTask = new Map(tasks.map((t) => [String(t._id), t]));
    const deptOf = await brScope.deptResolver(tasks);
    const meetings = new Map((await BrMeeting.find({ _id: { $in: [...new Set(tasks.map((t) => String(t.meeting)))] } }).select('series').lean()).map((m) => [String(m._id), m]));

    // The section of whoever made the change (his HR section, else his role's).
    const User = require('../models/User');
    const actorIds = [...new Set(events.map((e) => String(e.by || '')).filter((x) => x.length === 24))];
    const [actorSec, actors] = await Promise.all([sectionsOfUserIds(actorIds), User.find({ _id: { $in: actorIds } }).select('role').lean()]);
    const roleOf = new Map(actors.map((u) => [String(u._id), u.role]));
    const { sectionLabel } = require('../config/sections');
    const { LABELS_AR } = require('../config/roles');

    const rows = [];
    for (const e of events) {
      const t = byTask.get(String(e.task));
      if (!t) continue; // deleted task
      const sec = actorSec.get(String(e.by)) || orgSectionOfRole(roleOf.get(String(e.by))) || '';
      const dept = deptOf(t);
      const m = meetings.get(String(t.meeting));
      const link = t.archivedAt ? '/system/business-review/archive'
        : m && m.series ? `/system/business-review/daily?dept=${encodeURIComponent(dept)}&task=${t._id}`
          : `/system/business-review/${t.meeting}?task=${t._id}`;
      rows.push({
        id: e.id, at: e.at, kind: e.kind, kindAr: KIND_AR[e.kind] || e.kind,
        by: e.by ? String(e.by) : '', byName: e.byName || '', byRole: roleOf.get(String(e.by)) || '', byRoleAr: LABELS_AR[roleOf.get(String(e.by))] || '',
        bySection: sec, bySectionAr: sec ? sectionLabel(sec, 'ar') : '',
        statusFrom: e.statusFrom || '', statusTo: e.statusTo || '', statusFromAr: statusAr[e.statusFrom] || '', statusToAr: statusAr[e.statusTo] || '',
        text: e.text || '', files: (e.files || []).map((f) => ({ fileUrl: f.fileUrl, fileName: f.fileName })),
        part: e.part ? { _id: String(e.part._id), title: e.part.title || '', assigneeName: e.part.assigneeName || '' } : null,
        task: {
          _id: String(t._id), title: t.title, department: dept, departmentAr: sectionLabel(dept, 'ar'), assigneeName: t.assigneeName,
          status: t.status, statusAr: statusAr[t.status] || t.status, progress: t.progress || 0, dueDate: t.dueDate, overdue: !!t.isOverdue,
          meeting: String(t.meeting || ''), meetingRef: t.meetingRef || '', meetingTitle: t.meetingTitle || '', archived: !!t.archivedAt, shared: !!t.shareGroup,
        },
        link,
      });
    }
    rows.sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json({ from: fromDay, to: toDay, rows: rows.slice(0, 20000), total: rows.length, statuses: ACTION_STATUSES, kinds: KIND_AR });
  } catch (e) {
    console.error('[br-activity]', e);
    res.status(500).json({ message: 'تعذّر تحميل سجل التحديثات' });
  }
};
