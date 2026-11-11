/**
 * Business review department board and recurring meeting schedules.
 * The board groups every action by department: what is open, in progress, postponed, overdue and done, with start, due and expected dates.
 * Scope follows the meeting rule: the board and secretariat see everything; a manager sees actions from meetings they attended plus their own.
 */
const { orgSectionOfRole } = require('../config/roles');
const mongoose = require('mongoose');
const { BrSeries, BrMeeting, BrAction, BrAssignment } = require('../models/BusinessReview');
const User = require('../models/User');
require('../models/Employee');
const { startOfDay, endOfDay, todayKey, dayKeyOf } = require('../utils/companyDay');
const {
  canRunMeetings, isParticipant, isManagerRole, OPEN_ACTION_STATUSES, CADENCE_KEYS, departments,
} = require('../config/businessReview');
const { sectionOfRole } = require('../config/roles');
const { sectionsOfUserIds } = require('../utils/userSection');
const { sendMongooseError } = require('../utils/mongooseError');
const { emitToAll } = require('../websocket/socketManager');
const brSeries = require('../services/brSeries');

const fullName = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');
const emit = (event, payload = {}) => { try { emitToAll(event, { ...payload, at: Date.now() }); } catch (e) { /* */ } };
const DAY = 86400000;
const NO_DEPT = 'Unassigned';

/** Period bounds from ?period=today|week|month|all or ?from&to (YYYY-MM-DD, company days). */
function periodOf(q) {
  if (q.from || q.to) return { from: q.from ? startOfDay(q.from) : null, to: q.to ? endOfDay(q.to) : null };
  const today = todayKey();
  const t0 = startOfDay(today);
  if (q.period === 'all') return { from: null, to: null };
  if (q.period === 'today') return { from: t0, to: endOfDay(today) };
  if (q.period === 'week') return { from: new Date(t0.getTime() - 6 * DAY), to: endOfDay(today) };
  // Default: this calendar month.
  const [y, m] = today.split('-');
  return { from: startOfDay(`${y}-${m}-01`), to: endOfDay(today) };
}

exports.getBoard = async (req, res) => {
  try {
    const runner = canRunMeetings(req.user);
    if (!runner && !isParticipant(req.user)) return res.status(403).json({ message: 'Not allowed' });

    const scope = {};
    if (!runner) {
      const attended = await BrMeeting.find({ 'attendees.user': req.user._id }).distinct('_id');
      scope.$or = [{ meeting: { $in: attended } }, { assignee: req.user._id }];
    }
    const { from, to } = periodOf(req.query);
    const inPeriod = (d) => d && (!from || d >= from) && (!to || d <= to);

    // Open work is always current; finished or cancelled work counts when it closed inside the period.
    const match = { ...scope };
    const actions = await BrAction.find(match)
        .select('shareGroup meeting meetingRef meetingTitle meetingDate title description department assignee assigneeName assigneeRole raisedByName startDate dueDate expectedDate originalDueDate postponeReason postponeCount priority status progress completedAt isOverdue createdAt updatedAt updates')
      .sort({ dueDate: 1, createdAt: -1 }).limit(3000).lean();
    const shown = actions.filter((a) => OPEN_ACTION_STATUSES.includes(a.status)
      || (a.status === 'done' && inPeriod(a.completedAt || a.updatedAt))
      || (a.status === 'cancelled' && inPeriod(a.updatedAt)));

    // A task belongs to its owner's department: the manager speaks for it. The stored department was the meeting's first department on older tasks, so it is only the fallback for owners without a section (board, secretariat).
    const ownerSection = await sectionsOfUserIds(shown.map((a) => a.assignee));
    const deptOf = (a) => ownerSection.get(String(a.assignee)) || orgSectionOfRole(a.assigneeRole) || a.department || NO_DEPT;
    if (req.query.department) {
      for (let i = shown.length - 1; i >= 0; i -= 1) if (deptOf(shown[i]) !== req.query.department) shown.splice(i, 1);
    }

    const ids = shown.map((a) => a._id);
    const shared = await require('./businessReviewController').siblingsOf(shown);
    const dels = ids.length ? await BrAssignment.find({ action: { $in: ids } })
      .select('action assigneeName status dueDate progress isOverdue').lean() : [];
    const delBy = new Map();
    for (const d of dels) { const k = String(d.action); if (!delBy.has(k)) delBy.set(k, []); delBy.get(k).push(d); }

    // Department heads, by the same role rule as the meetings.
    const heads = await User.find({ isActive: { $ne: false } }).select('firstName lastName role').lean();
    const headsOf = new Map();
    for (const u of heads) {
      if (!isManagerRole(u.role) || !/_manager$/.test(u.role)) continue;
      const sec = orgSectionOfRole(u.role);
      if (!sec) continue;
      if (!headsOf.has(sec)) headsOf.set(sec, []);
      headsOf.get(sec).push(fullName(u));
    }

    const now = new Date();
    const weekEnd = endOfDay(dayKeyOf(new Date(now.getTime() + 7 * DAY)));
    const blank = () => ({ total: 0, open: 0, in_progress: 0, blocked: 0, postponed: 0, overdue: 0, done: 0, cancelled: 0, dueThisWeek: 0 });
    const byDept = new Map();
    const totals = blank();
    const items = shown.map((a) => {
      const dept = deptOf(a);
      if (!byDept.has(dept)) byDept.set(dept, { key: dept, heads: headsOf.get(dept) || [], counts: blank(), items: [] });
      const g = byDept.get(dept);
      const open = OPEN_ACTION_STATUSES.includes(a.status);
      const late = open && a.dueDate && new Date(a.dueDate) < now;
      for (const c of [g.counts, totals]) {
        c.total += 1;
        c[a.status] = (c[a.status] || 0) + 1;
        if (late) c.overdue += 1;
        if (open && a.dueDate && new Date(a.dueDate) >= now && new Date(a.dueDate) <= weekEnd) c.dueThisWeek += 1;
      }
      const start = a.startDate || a.meetingDate || a.createdAt;
      const last = (a.updates || []).slice(-1)[0] || null;
      const row = {
        _id: a._id, title: a.title, description: a.description, department: dept,
        meeting: a.meeting, meetingRef: a.meetingRef, meetingTitle: a.meetingTitle, meetingDate: a.meetingDate,
        assignee: a.assignee, assigneeName: a.assigneeName, raisedByName: a.raisedByName,
        startDate: start, dueDate: a.dueDate, expectedDate: a.expectedDate,
        originalDueDate: a.originalDueDate, postponeReason: a.postponeReason, postponeCount: a.postponeCount || 0,
        // Planned duration in days, start to due, inclusive of the due day.
        durationDays: start && a.dueDate ? Math.max(1, Math.round((new Date(a.dueDate) - new Date(start)) / DAY)) : null,
        priority: a.priority, status: a.status, progress: a.progress, completedAt: a.completedAt,
        overdue: !!late,
        lastUpdate: last ? { at: last.at, byName: last.byName, text: last.text, statusTo: last.statusTo } : null,
        delegations: delBy.get(String(a._id)) || [],
        sharedWith: shared.get(String(a._id)) || [],
        mine: String(a.assignee) === String(req.user._id),
      };
      g.items.push(row);
      return row;
    });

    const rate = (c) => {
      const base = c.total - (c.cancelled || 0);
      return base ? Math.round((c.done / base) * 100) : 0;
    };
    const depts = [...byDept.values()]
      .map((g) => ({ ...g, completionRate: rate(g.counts) }))
      .sort((a, b) => (b.counts.overdue - a.counts.overdue) || (b.counts.total - a.counts.total));

    // Today's recurring meetings, so the board opens on the day's agenda.
    const today = todayKey();
    const todays = await BrMeeting.find({
      seriesDay: today,
      ...(runner ? {} : { 'attendees.user': req.user._id }),
    }).select('refNumber title scheduledAt status series minutes departments').lean();

    res.json({
      period: { from, to },
      totals: { ...totals, completionRate: rate(totals) },
      departments: depts,
      allDepartments: departments(),
      today: todays.map((m) => ({
        _id: m._id, refNumber: m.refNumber, title: m.title, scheduledAt: m.scheduledAt, status: m.status,
        departments: m.departments,
        minutesWritten: (m.minutes || []).filter((x) => String(x.body || '').trim()).length,
        minutesTotal: (m.minutes || []).length,
      })),
      canRunMeetings: runner,
      itemsCount: items.length,
    });
  } catch (error) {
    console.error('br board error:', error);
    res.status(500).json({ message: 'تعذّر تحميل لوحة الأقسام' });
  }
};

/**
 * A meeting's departments as cards: every task each department holds in this meeting's series (a daily meeting carries
 * its tasks from day to day; a one-off meeting has only its own), with counts by state, overdue included, and each
 * task's full detail so the page opens it in place. Same visibility as the meeting: its runners and attendees.
 */
exports.getMeetingDepartments = async (req, res) => {
  try {
    const meeting = await BrMeeting.findById(req.params.id).select('series departments attendees refNumber seriesDay scheduledAt minutes').lean();
    if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
    const runner = canRunMeetings(req.user);
    const wasThere = (meeting.attendees || []).some((a) => String(a.user) === String(req.user._id));
    if (!runner && !wasThere) return res.status(403).json({ message: 'You did not attend this meeting' });

    const meetingIds = meeting.series
      ? (await BrMeeting.find({ series: meeting.series }).select('_id').lean()).map((m) => m._id)
      : [meeting._id];
    const actions = await BrAction.find({ meeting: { $in: meetingIds } })
      .select('-__v').sort({ createdAt: -1 }).limit(3000).lean();
    const ownerSection = await sectionsOfUserIds(actions.map((a) => a.assignee));
    const deptOf = (a) => ownerSection.get(String(a.assignee)) || orgSectionOfRole(a.assigneeRole) || a.department || NO_DEPT;
    const titleOf = new Map(actions.map((a) => [String(a._id), a.title]));
    // Parts handed to the owner's team ("توزيع على الفريق"): shown on the task with each person's own state.
    const dels = actions.length ? await BrAssignment.find({ action: { $in: actions.map((a) => a._id) } })
      .select('action assigneeName title status progress dueDate isOverdue').lean() : [];
    const delsOf = new Map();
    for (const x of dels) { const k = String(x.action); if (!delsOf.has(k)) delsOf.set(k, []); delsOf.get(k).push(x); }
    // The department's head(s), named on its card.
    const managers = await User.find({ isActive: { $ne: false }, role: { $in: [/_manager$/, 'cfo'] } }).select('firstName lastName role').lean();
    const headOf = new Map();
    for (const u of managers) { const sec = orgSectionOfRole(u.role); if (sec && !headOf.has(sec)) headOf.set(sec, []); if (sec) headOf.get(sec).push(fullName(u)); }
    // The CFO heads the finance department, above the accounting manager.
    const cfos = managers.filter((u) => u.role === 'cfo').map(fullName);
    if (cfos.length) headOf.set('Accounting', cfos);
    const followUps = new Map();
    for (const a of actions) if (a.followUpOf) { const k = String(a.followUpOf); if (!followUps.has(k)) followUps.set(k, []); followUps.get(k).push({ _id: a._id, title: a.title, status: a.status }); }

    const now = Date.now();
    const isOpen = (a) => a.status !== 'done' && a.status !== 'cancelled';
    const overdue = (a) => isOpen(a) && a.dueDate && new Date(a.dueDate).getTime() < now;
    // Where an open task's deadline falls: late, within 48 hours, within a week, later, or no date yet.
    const horizon = (a) => {
      if (!isOpen(a)) return '';
      if (!a.dueDate) return 'nodate';
      const ms = new Date(a.dueDate).getTime() - now;
      return ms < 0 ? 'late' : ms <= 2 * DAY ? 'h48' : ms <= 7 * DAY ? 'week' : 'later';
    };
    const rank = (a) => (overdue(a) ? 0 : a.status === 'blocked' ? 1 : a.status === 'in_progress' ? 2 : a.status === 'open' ? 3 : a.status === 'postponed' ? 4 : 5);
    // A task given to several owners shows each owner's part on every card that carries it.
    const shared = await require('./businessReviewController').siblingsOf(actions);
    const keys = [...new Set([...(meeting.departments || []), ...actions.map(deptOf)])];
    const cards = keys.map((key) => {
      const list = actions.filter((a) => deptOf(a) === key)
        .sort((x, y) => rank(x) - rank(y) || new Date(x.dueDate || 8.64e15) - new Date(y.dueDate || 8.64e15));
      const n = (f) => list.filter(f).length;
      return {
        key,
        counts: {
          total: list.length,
          done: n((a) => a.status === 'done'),
          in_progress: n((a) => a.status === 'in_progress'),
          open: n((a) => a.status === 'open'),
          postponed: n((a) => a.status === 'postponed'),
          blocked: n((a) => a.status === 'blocked'),
          overdue: n(overdue),
          today: n((a) => String(a.meeting) === String(meeting._id)),
          // For discussion today: late, or due within 48 hours.
          agenda: n((a) => ['late', 'h48'].includes(horizon(a))),
          h48: n((a) => horizon(a) === 'h48'),
          week: n((a) => horizon(a) === 'week'),
          later: n((a) => horizon(a) === 'later'),
          nodate: n((a) => horizon(a) === 'nodate'),
          // Of the tasks done, how many landed without being postponed.
          onTime: n((a) => a.status === 'done' && !a.postponeCount),
        },
        managers: headOf.get(key) || [],
        // The department's part of this meeting's minutes.
        minutes: String(((meeting.minutes || []).find((x) => x.department === key) || {}).body || '').trim(),
        inMinutes: (meeting.minutes || []).some((x) => x.department === key),
        tasks: list.map((a) => ({
          _id: a._id, title: a.title, description: a.description, status: a.status, progress: a.progress, priority: a.priority,
          assignee: a.assignee, assigneeName: a.assigneeName, raisedByName: a.raisedByName, createdByName: a.createdByName,
          startDate: a.startDate, dueDate: a.dueDate, expectedDate: a.expectedDate, originalDueDate: a.originalDueDate,
          postponeReason: a.postponeReason, postponeCount: a.postponeCount, completedAt: a.completedAt, createdAt: a.createdAt,
          meeting: a.meeting, meetingRef: a.meetingRef, meetingDate: a.meetingDate, fromThisMeeting: String(a.meeting) === String(meeting._id),
          overdue: overdue(a),
          horizon: horizon(a),
          delegations: delsOf.get(String(a._id)) || [],
          followUpOf: a.followUpOf ? { _id: a.followUpOf, title: titleOf.get(String(a.followUpOf)) || '' } : null,
          followUps: followUps.get(String(a._id)) || [],
          sharedWith: shared.get(String(a._id)) || [],
          shareGroup: a.shareGroup || null,
          updates: (a.updates || []).slice(-15).reverse(),
        })),
      };
    });
    // Departments with something to discuss first; quiet ones keep the meeting's order after them.
    cards.sort((x, y) => (y.counts.overdue - x.counts.overdue) || ((y.counts.total - y.counts.done) - (x.counts.total - x.counts.done)));
    res.json({ departments: cards, scope: meeting.series ? 'series' : 'meeting', canEdit: runner });
  } catch (error) {
    console.error('br meeting departments error:', error);
    res.status(500).json({ message: 'تعذّر تحميل أقسام الاجتماع' });
  }
};

// ── Recurring schedules ─────────────────────────────────────────────────────

const SERIES_FIELDS = ['title', 'cadence', 'weekdays', 'time', 'durationMinutes', 'departments', 'attendees', 'location', 'meetingLink', 'active'];
const pickSeries = (body) => {
  const d = {};
  for (const f of SERIES_FIELDS) if (body[f] !== undefined) d[f] = body[f];
  if (d.weekdays) d.weekdays = [...new Set(d.weekdays.map(Number).filter((n) => n >= 0 && n <= 6))];
  if (d.attendees) d.attendees = d.attendees.map((a) => a?._id || a?.user || a).filter((a) => mongoose.isValidObjectId(a));
  if (d.cadence && !CADENCE_KEYS.includes(d.cadence)) delete d.cadence;
  return d;
};

exports.listSeries = async (req, res) => {
  try {
    if (!canRunMeetings(req.user) && !isParticipant(req.user)) return res.status(403).json({ message: 'Not allowed' });
    const q = canRunMeetings(req.user) ? {} : { attendees: req.user._id };
    const series = await BrSeries.find(q).sort({ active: -1, createdAt: -1 }).lean();
    const today = todayKey();
    const todays = await BrMeeting.find({ series: { $in: series.map((s) => s._id) }, seriesDay: today }).select('series refNumber status').lean();
    const byS = new Map(todays.map((m) => [String(m.series), m]));
    res.json({ series: series.map((s) => ({ ...s, today: byS.get(String(s._id)) || null })), canEdit: canRunMeetings(req.user) });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الاجتماعات الدورية' });
  }
};

exports.createSeries = async (req, res) => {
  try {
    if (!canRunMeetings(req.user)) return res.status(403).json({ message: 'جدولة الاجتماعات للإدارة والسكرتارية' });
    const data = pickSeries(req.body);
    if (!String(data.title || '').trim()) return res.status(400).json({ message: 'اسم الاجتماع الدوري مطلوب' });
    if (!data.weekdays || !data.weekdays.length) data.weekdays = [0, 1, 2, 3, 4];
    const series = await BrSeries.create({ ...data, createdBy: req.user._id, createdByName: fullName(req.user) });
    // Today's meeting is created at once when today is a scheduled day, so it can be used immediately.
    const r = await brSeries.ensureDay(series, todayKey(), { actor: req.user });
    emit('br:series', { id: String(series._id) });
    if (r.created) emit('br:meeting', { id: String(r.meeting._id) });
    res.status(201).json({ series, today: r.meeting });
  } catch (e) {
    return sendMongooseError(res, e, 'تعذّر إنشاء الاجتماع الدوري');
  }
};

exports.updateSeries = async (req, res) => {
  try {
    if (!canRunMeetings(req.user)) return res.status(403).json({ message: 'Not allowed' });
    const series = await BrSeries.findById(req.params.id);
    if (!series) return res.status(404).json({ message: 'غير موجود' });
    Object.assign(series, pickSeries(req.body));
    await series.save();
    // The settings take effect on today's meeting too; before, only tomorrow's picked them up.
    const ymd = todayKey();
    let today = await BrMeeting.findOne({ series: series._id, seriesDay: ymd });
    if (today) await brSeries.syncDay(series, today);
    else today = (await brSeries.ensureDay(series, ymd, { actor: req.user })).meeting;
    emit('br:series', { id: String(series._id) });
    if (today) emit('br:meeting', { id: String(today._id) });
    res.json({ series, today });
  } catch (e) {
    return sendMongooseError(res, e, 'تعذّر تعديل الاجتماع الدوري');
  }
};

exports.deleteSeries = async (req, res) => {
  try {
    if (!canRunMeetings(req.user)) return res.status(403).json({ message: 'Not allowed' });
    const series = await BrSeries.findById(req.params.id);
    if (!series) return res.status(404).json({ message: 'غير موجود' });
    // Held days keep their minutes and actions; only the schedule stops.
    await BrSeries.deleteOne({ _id: series._id });
    emit('br:series', { id: String(series._id), deleted: true });
    res.json({ message: 'تم إيقاف الاجتماع الدوري؛ الاجتماعات السابقة ومحاضرها باقية' });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر الحذف' });
  }
};

/** Open (create if missing) the meeting of a schedule for a day, default today; any day on demand. */
exports.seriesDay = async (req, res) => {
  try {
    const series = await BrSeries.findById(req.params.id);
    if (!series) return res.status(404).json({ message: 'غير موجود' });
    const ymd = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.day || '')) ? req.body.day : todayKey();
    const existing = await BrMeeting.findOne({ series: series._id, seriesDay: ymd }).select('_id').lean();
    if (existing) return res.json({ meeting: existing, created: false });
    if (!canRunMeetings(req.user)) return res.status(403).json({ message: 'لم يُنشأ اجتماع هذا اليوم بعد' });
    const r = await brSeries.ensureDay(series, ymd, { force: true, actor: req.user });
    if (r.created) emit('br:meeting', { id: String(r.meeting._id) });
    res.status(r.created ? 201 : 200).json({ meeting: r.meeting, created: r.created });
  } catch (e) {
    return sendMongooseError(res, e, 'تعذّر فتح اجتماع اليوم');
  }
};

/**
 * The daily meeting page: the schedule, today's meeting in detail (minutes and tasks per department, attendance) and the past days.
 * Visible to the board, the secretariat and the schedule's attendees.
 */
exports.getDaily = async (req, res) => {
  try {
    const runner = canRunMeetings(req.user);
    if (!runner && !isParticipant(req.user)) return res.status(403).json({ message: 'Not allowed' });
    const all = await BrSeries.find(runner ? {} : { attendees: req.user._id }).sort({ active: -1, createdAt: 1 }).lean();
    const series = all.find((s) => String(s._id) === String(req.query.series)) || all[0] || null;
    if (!series) return res.json({ series: null, list: [], today: null, days: [], canEdit: runner });

    const meetings = await BrMeeting.find({ series: series._id }).sort({ seriesDay: -1 }).limit(Math.min(120, Number(req.query.limit) || 60))
      .select('refNumber title seriesDay scheduledAt status attendees minutes departments').lean();
    const ids = meetings.map((m) => m._id);
    const acts = ids.length ? await BrAction.find({ meeting: { $in: ids } })
      .select('meeting department assignee assigneeName assigneeRole status title dueDate progress').lean() : [];
    const byMeeting = new Map();
    for (const a of acts) { const k = String(a.meeting); if (!byMeeting.has(k)) byMeeting.set(k, []); byMeeting.get(k).push(a); }
    const actOwner = await sectionsOfUserIds(acts.map((a) => a.assignee));
    const deptOfAction = (a) => actOwner.get(String(a.assignee)) || orgSectionOfRole(a.assigneeRole) || a.department || NO_DEPT;

    const summary = (m) => {
      const list = byMeeting.get(String(m._id)) || [];
      const att = m.attendees || [];
      return {
        _id: m._id, refNumber: m.refNumber, day: m.seriesDay, scheduledAt: m.scheduledAt, status: m.status,
        attendance: {
          invited: att.length,
          attended: att.filter((a) => a.attendance === 'attended').length,
          absent: att.filter((a) => a.attendance === 'absent').length,
          excused: att.filter((a) => a.attendance === 'excused').length,
        },
        minutesWritten: (m.minutes || []).filter((x) => String(x.body || '').trim()).length,
        minutesTotal: (m.minutes || []).length,
        tasks: list.length,
        tasksDone: list.filter((a) => a.status === 'done').length,
      };
    };
    const today = todayKey();
    const todayMeeting = meetings.find((m) => m.seriesDay === today) || null;
    let todayDetail = null;
    if (todayMeeting) {
      const list = byMeeting.get(String(todayMeeting._id)) || [];
      const depts = [...new Set([...(todayMeeting.departments || []), ...list.map(deptOfAction)])];
      todayDetail = {
        ...summary(todayMeeting),
        title: todayMeeting.title,
        attendees: (todayMeeting.attendees || []).map((a) => ({ name: a.name, attendance: a.attendance, excuseReason: a.excuseReason, department: sectionOfRole(a.role) || '' })),
        departments: depts.map((d) => {
          const min = (todayMeeting.minutes || []).find((x) => x.department === d);
          const tasks = list.filter((a) => deptOfAction(a) === d);
          return {
            key: d,
            minutes: min ? String(min.body || '').trim() : '',
            tasks: tasks.map((a) => ({ _id: a._id, title: a.title, assigneeName: a.assigneeName, status: a.status, dueDate: a.dueDate, progress: a.progress })),
          };
        }),
      };
    }
    res.json({
      series,
      list: all.map((s) => ({ _id: s._id, title: s.title, active: s.active })),
      today: todayDetail,
      todayKey: today,
      scheduledToday: (series.weekdays || []).includes(brSeries.weekdayOf(today)),
      days: meetings.filter((m) => m.seriesDay !== today).map(summary),
      canEdit: runner,
    });
  } catch (error) {
    console.error('br daily error:', error);
    res.status(500).json({ message: 'تعذّر تحميل الاجتماع اليومي' });
  }
};
