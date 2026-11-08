/**
 * Business review department board and recurring meeting schedules.
 * The board groups every action by department: what is open, in progress, postponed, overdue and done, with start, due and expected dates.
 * Scope follows the meeting rule: the board and secretariat see everything; a manager sees actions from meetings they attended plus their own.
 */
const mongoose = require('mongoose');
const { BrSeries, BrMeeting, BrAction, BrAssignment } = require('../models/BusinessReview');
const User = require('../models/User');
require('../models/Employee');
const { startOfDay, endOfDay, todayKey, dayKeyOf } = require('../utils/companyDay');
const {
  canRunMeetings, isParticipant, isManagerRole, OPEN_ACTION_STATUSES, CADENCE_KEYS, departments,
} = require('../config/businessReview');
const { sectionOfRole } = require('../config/roles');
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
    if (req.query.department) match.department = req.query.department === NO_DEPT ? { $in: ['', null] } : req.query.department;
    const actions = await BrAction.find(match)
      .select('meeting meetingRef meetingTitle meetingDate title description department assignee assigneeName assigneeRole raisedByName startDate dueDate expectedDate originalDueDate postponeReason postponeCount priority status progress completedAt isOverdue createdAt updatedAt updates')
      .sort({ dueDate: 1, createdAt: -1 }).limit(3000).lean();
    const shown = actions.filter((a) => OPEN_ACTION_STATUSES.includes(a.status)
      || (a.status === 'done' && inPeriod(a.completedAt || a.updatedAt))
      || (a.status === 'cancelled' && inPeriod(a.updatedAt)));

    const ids = shown.map((a) => a._id);
    const dels = ids.length ? await BrAssignment.find({ action: { $in: ids } })
      .select('action assigneeName status dueDate progress isOverdue').lean() : [];
    const delBy = new Map();
    for (const d of dels) { const k = String(d.action); if (!delBy.has(k)) delBy.set(k, []); delBy.get(k).push(d); }

    // Department heads, by the same role rule as the meetings.
    const heads = await User.find({ isActive: { $ne: false } }).select('firstName lastName role').lean();
    const headsOf = new Map();
    for (const u of heads) {
      if (!isManagerRole(u.role) || !/_manager$/.test(u.role)) continue;
      const sec = sectionOfRole(u.role);
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
      const dept = a.department || NO_DEPT;
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
    emit('br:series', { id: String(series._id) });
    res.json({ series });
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
