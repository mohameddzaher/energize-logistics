/**
 * businessReviewController: business review meetings. Executives and the secretary see everything; a department manager sees invited meetings, own actions and delegations handed out; an employee sees ONLY delegations addressed to them.
 * The employee rule is enforced by the data model (models/BusinessReview.js): that endpoint reads BrAssignment, which holds no meeting content.
 */
const mongoose = require('mongoose');
const { BrMeeting, BrAction, BrAssignment } = require('../models/BusinessReview');
const { sendMongooseError, stripEmpty } = require('../utils/mongooseError');
const { startOfDay, endOfDay } = require('../utils/companyDay');
const User = require('../models/User');
// Referenced by populate('linkedEmployee') below. Requiring it here means this
// controller never depends on some other module having registered it first —
// otherwise the participants list dies with a MissingSchemaError.
require('../models/Employee');
const {
  isExecutive, isSecretary, canRunMeetings, isParticipant, isManagerRole,
  OPEN_ACTION_STATUSES, OPEN_MEETING_STATUSES, HELD_MEETING_STATUSES, meta,
} = require('../config/businessReview');
const { createNotification } = require('../services/notificationService');
const { emitToAll, emitToUser } = require('../websocket/socketManager');

const fullName = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');
// A day typed as YYYY-MM-DD is a company day; a due date is due by the end of it, a start date begins at its start.
const dayOf = (v) => (v ? (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? startOfDay(String(v)) : new Date(v)) : null);
const dueOf = (v) => (v ? (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? endOfDay(String(v)) : new Date(v)) : null);

/**
 * Status, progress, expected date and postponement, shared by actions and delegated tasks.
 * Postponing needs a new date (a reason is optional): the new date becomes the due date (so overdue follows it) and the first committed date is kept.
 * Returns an error message, or '' when applied.
 */
function applyProgress(item, body) {
  const before = item.status;
  if (body.expectedDate !== undefined) item.expectedDate = dueOf(body.expectedDate);
  if (body.status === 'postponed') {
    const to = dueOf(body.newDueDate || body.postponedTo);
    const reason = String(body.postponeReason || body.note || '').trim();
    if (!to || Number.isNaN(to.getTime())) return 'حدّد الموعد الجديد للتأجيل';
    if (!item.originalDueDate) item.originalDueDate = item.dueDate || null;
    item.dueDate = to;
    // The reason is optional (owner's call); a postponement without one clears the previous reason.
    item.postponeReason = reason;
    item.postponeCount = (item.postponeCount || 0) + 1;
    item.isOverdue = false; item.overdueNotifiedAt = null; item.dueSoonNotifiedAt = null;
  }
  if (body.status !== undefined) item.status = body.status;
  if (body.progress !== undefined) item.progress = Math.max(0, Math.min(100, Number(body.progress) || 0));
  if (item.status === 'done') {
    item.completedAt = item.completedAt || new Date();
    item.progress = 100;
    item.isOverdue = false;
  } else if (before === 'done' && item.status !== 'done') {
    item.completedAt = null;
  }
  return '';
}

/** The update log line; a postponement names its new date. */
function logUpdate(item, user, body, before) {
  let note = (body.note || '').trim();
  if (body.status === 'postponed' && item.dueDate) {
    const to = new Date(item.dueDate).toLocaleDateString('en-GB');
    note = `أُجِّل إلى ${to}${item.postponeReason ? ` — ${item.postponeReason}` : ''}`;
  } else if (body.expectedDate !== undefined && item.expectedDate && !note) {
    note = `الإنجاز المتوقَّع: ${new Date(item.expectedDate).toLocaleDateString('en-GB')}`;
  }
  if (note || before !== item.status) {
    item.updates.push({
      by: user._id, byName: fullName(user), text: note,
      statusFrom: before !== item.status ? before : '',
      statusTo: before !== item.status ? item.status : '',
      progress: body.progress !== undefined ? item.progress : null,
      at: new Date(),
    });
  }
}
const sameId = (a, b) => a && b && String(a._id || a) === String(b._id || b);
const deny = (res, msg = 'Insufficient permissions') => res.status(403).json({ message: msg });

const emit = (event, payload = {}) => { try { emitToAll(event, { ...payload, at: Date.now() }); } catch (e) {} };

/** Tell one person something happened to their work, in-app + live. */
async function notify(userId, { title, message, entity, entityId }) {
  if (!userId) return;
  try {
    await createNotification({
      recipient: userId, type: 'system_alert', title, message,
      relatedEntity: entity, relatedEntityId: entityId,
    });
    emitToUser(String(userId), 'br:updated', { entity, id: String(entityId || '') });
  } catch (e) { /* a missed notification must never fail the write */ }
}

// ── Meta ────────────────────────────────────────────────────────────────────

/**
 * Everything the UI needs to render itself: the vocabularies, the departments
 * (from the permission matrix, so new sections appear automatically), the people
 * who can be invited, and what THIS caller is allowed to do.
 */
exports.getMeta = async (req, res) => {
  try {
    const { endedStaff, userArchived } = require('../utils/endedStaff');
    const [allUsers, archSets] = await Promise.all([User.find({ isActive: true, role: { $nin: require('../config/scopedRoles').EXTERNAL_ROLES }, email: { $not: /@example\.invalid$/i } })
      .select('firstName lastName role linkedEmployee')
      .populate('linkedEmployee', 'department jobTitle')
      .sort({ firstName: 1 }).lean(), endedStaff()]);
    // An archived user is not invited or assigned, as if deleted.
    const users = allUsers.filter((u) => !userArchived(archSets, u));

    // Participants are derived from the ROLE RULE, not from a stored list — add
    // a `x_manager` role tomorrow and its holders appear here with no code change.
    const sectionByUser = await require('../utils/userSection').sectionsOfUserIds(users.filter((u) => isManagerRole(u.role)).map((u) => u._id));
    const participants = users
      .filter((u) => isManagerRole(u.role))
      .map((u) => ({
        _id: String(u._id), name: fullName(u), role: u.role,
        department: u.linkedEmployee?.department || '',
        jobTitle: u.linkedEmployee?.jobTitle || '',
        // The section the role heads, so choosing a department can invite its manager.
        section: sectionByUser.get(String(u._id)) || '',
        roleAr: require('../config/roles').LABELS_AR[u.role] || u.role,
        // The board tier. The GM is nearly always the one ASKING for an action,
        // so the UI pre-selects them as attendees and always offers them in the
        // "requested by" picker — even for a round they could not attend.
        isExecutive: isExecutive(u),
      }));

    res.json({
      ...meta(),
      participants,
      // Everyone active — a manager delegates to their own team, who are not
      // themselves participants.
      people: users.map((u) => ({
        _id: String(u._id), name: fullName(u), role: u.role,
        department: u.linkedEmployee?.department || '',
      })),
      me: {
        _id: String(req.user._id),
        name: fullName(req.user),
        role: req.user.role,
        isExecutive: isExecutive(req.user),
        isSecretary: isSecretary(req.user),
        canRunMeetings: canRunMeetings(req.user),
        isParticipant: isParticipant(req.user),
      },
    });
  } catch (error) {
    console.error('br meta error:', error);
    res.status(500).json({ message: 'Failed to load meeting settings' });
  }
};

// ── Meetings ────────────────────────────────────────────────────────────────

/** A manager sees the meetings they were in; the board and the secretary see all. */
const meetingScope = (user) =>
  (canRunMeetings(user) ? {} : { 'attendees.user': user._id });

exports.listMeetings = async (req, res) => {
  try {
    if (!isParticipant(req.user)) {
      // An employee has no meetings — they have delegated work. Answer plainly
      // rather than 403-ing a page they can legitimately open.
      return res.json({ meetings: [], canRunMeetings: false, participant: false });
    }
    const filter = { ...meetingScope(req.user) };
    if (req.query.cadence) filter.cadence = req.query.cadence;
    if (req.query.status) filter.status = req.query.status;
    // Filters the cards link to. 'Open' is not a single status, so it is defined once here instead of each UI building its own rule and drifting.
    if (req.query.bucket === 'completed') filter.status = 'completed';
    if (req.query.bucket === 'open') filter.status = { $in: OPEN_MEETING_STATUSES };
    if (req.query.bucket === 'cancelled') filter.status = 'cancelled';
    if (req.query.bucket === 'upcoming') {
      filter.status = { $in: ['scheduled', 'in_progress'] };
      filter.scheduledAt = { ...(filter.scheduledAt || {}), $gte: new Date() };
    }
    if (req.query.from || req.query.to) {
      filter.scheduledAt = {};
      // Meetings scheduled in the future: an empty 'to' means no upper bound here, not 'until now'; otherwise every upcoming meeting would vanish from the list.
      if (req.query.from) filter.scheduledAt.$gte = startOfDay(req.query.from);
      if (req.query.to) filter.scheduledAt.$lte = endOfDay(req.query.to);
    }

    const meetings = await BrMeeting.find(filter)
      .select('-minutes') // the list doesn't need the full record
      .sort({ scheduledAt: -1 }).limit(300).lean();

    // Action counts per meeting, so the list can show "3 open of 7".
    const ids = meetings.map((m) => m._id);
    const counts = ids.length
      ? await BrAction.aggregate([
        { $match: { meeting: { $in: ids } } },
        { $group: { _id: { m: '$meeting', open: { $in: ['$status', OPEN_ACTION_STATUSES] } }, n: { $sum: 1 } } },
      ])
      : [];
    const byMeeting = new Map();
    for (const c of counts) {
      const k = String(c._id.m);
      const cur = byMeeting.get(k) || { total: 0, open: 0 };
      cur.total += c.n;
      if (c._id.open) cur.open += c.n;
      byMeeting.set(k, cur);
    }

    // Card counters are computed over the whole scope, not the filtered page. A card saying 'completed 4' must keep saying 4 while another filter is selected, otherwise it describes the filter and not the work.
    const scope = meetingScope(req.user);
    const [total, completed, open, upcoming, cancelled] = await Promise.all([
      BrMeeting.countDocuments(scope),
      BrMeeting.countDocuments({ ...scope, status: 'completed' }),
      BrMeeting.countDocuments({ ...scope, status: { $in: OPEN_MEETING_STATUSES } }),
      BrMeeting.countDocuments({ ...scope, status: { $in: ['scheduled', 'in_progress'] }, scheduledAt: { $gte: new Date() } }),
      BrMeeting.countDocuments({ ...scope, status: 'cancelled' }),
    ]);

    res.json({
      meetings: meetings.map((m) => ({ ...m, actions: byMeeting.get(String(m._id)) || { total: 0, open: 0 } })),
      counts: { total, completed, open, upcoming, cancelled },
      canRunMeetings: canRunMeetings(req.user),
      participant: true,
    });
  } catch (error) {
    console.error('br list meetings error:', error);
    res.status(500).json({ message: 'Failed to load meetings' });
  }
};

exports.getMeeting = async (req, res) => {
  try {
    const meeting = await BrMeeting.findById(req.params.id).lean();
    if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

    // Minutes are boardroom content: you read them if you ran the meeting or
    // were in it. Nobody else, whatever else their role lets them do.
    const wasThere = (meeting.attendees || []).some((a) => sameId(a.user, req.user._id));
    if (!canRunMeetings(req.user) && !wasThere) return deny(res, 'You did not attend this meeting');

    const actions = await BrAction.find({ meeting: meeting._id }).sort({ createdAt: 1 }).lean();
    // Delegation counts let the meeting page show a manager's action as "passed
    // to 3 people" without exposing who, to someone who shouldn't see it.
    const actionIds = actions.map((a) => a._id);
    const delegations = actionIds.length
      ? await BrAssignment.find({ action: { $in: actionIds } })
        .select('action assignee assigneeName status dueDate progress').lean()
      : [];
    const byAction = new Map();
    for (const d of delegations) {
      const k = String(d.action);
      if (!byAction.has(k)) byAction.set(k, []);
      byAction.get(k).push(d);
    }

    const shared = await siblingsOf(actions);
    res.json({
      meeting,
      actions: actions.map((a) => ({ ...a, delegations: byAction.get(String(a._id)) || [], sharedWith: shared.get(String(a._id)) || [] })),
      can: {
        edit: canRunMeetings(req.user),
        writeMinutes: canRunMeetings(req.user),
        raiseActions: canRunMeetings(req.user),
      },
    });
  } catch (error) {
    console.error('br get meeting error:', error);
    res.status(500).json({ message: 'Failed to load the meeting' });
  }
};

const MEETING_FIELDS = [
  'title', 'cadence', 'departments', 'scheduledAt', 'durationMinutes',
  'location', 'meetingLink', 'status', 'agenda', 'summary',
];

/**
 * Resolve the attendee list into stamped rows.
 *
 * `previous` is the list as it stands now: marking attendance must record WHEN
 * it was marked and by whom, and must not wipe a timestamp that is already
 * there — the attendance log is part of the meeting's history, not a checkbox.
 */ 
async function buildAttendees(list, previous = [], actor = null) {
  const ids = (Array.isArray(list) ? list : []).map((a) => a.user || a._id || a).filter(Boolean);
  if (!ids.length) return [];
  const users = await User.find({ _id: { $in: ids } })
    .select('firstName lastName role linkedEmployee')
    .populate('linkedEmployee', 'department').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const prevById = new Map((previous || []).map((p) => [String(p.user), p]));

  return (Array.isArray(list) ? list : []).map((a) => {
    const id = String(a.user || a._id || a);
    const u = byId.get(id);
    const prev = prevById.get(id);
    const attendance = a.attendance || prev?.attendance || 'invited';
    const changed = !prev || prev.attendance !== attendance;
    const marked = attendance !== 'invited';

    return {
      user: id,
      name: fullName(u),
      role: u?.role || '',
      department: u?.linkedEmployee?.department || '',
      attendance,
      // Stamp on the transition; keep the existing stamp otherwise.
      attendanceAt: marked ? (changed ? new Date() : (prev?.attendanceAt || new Date())) : null,
      attendanceBy: marked ? (changed ? (actor?._id || null) : (prev?.attendanceBy || null)) : null,
      attendanceByName: marked ? (changed ? fullName(actor) : (prev?.attendanceByName || '')) : '',
      excuseReason: a.excuseReason !== undefined ? String(a.excuseReason).trim() : (prev?.excuseReason || ''),
      isChair: a.isChair !== undefined ? !!a.isChair : !!prev?.isChair,
    };
  }).filter((a) => a.name || a.user);
}

exports.createMeeting = async (req, res) => {
  try {
    if (!canRunMeetings(req.user)) return deny(res, 'Only the administration can schedule meetings');
    const data = {};
    MEETING_FIELDS.forEach((f) => { if (req.body[f] !== undefined) data[f] = req.body[f]; });
    if (!data.title || !data.scheduledAt) {
      return res.status(400).json({ message: 'العنوان وموعد الاجتماع مطلوبان' });
    }
    data.attendees = await buildAttendees(req.body.attendees, [], req.user);
    data.createdBy = req.user._id;
    data.createdByName = fullName(req.user);
    // The secretary of record defaults to whoever created it.
    data.scribe = req.body.scribe || req.user._id;
    const scribeUser = await User.findById(data.scribe).select('firstName lastName').lean();
    data.scribeName = fullName(scribeUser);

    const meeting = await BrMeeting.create(data);
    emit('br:meeting', { id: String(meeting._id) });

    // Everyone invited hears about it now, not on the day.
    const when = new Date(meeting.scheduledAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    await Promise.all((meeting.attendees || []).map((a) => notify(a.user, {
      title: 'دعوة اجتماع مراجعة أعمال',
      message: `${meeting.title} — ${when}${meeting.location ? ` · ${meeting.location}` : ''}`,
      entity: 'BrMeeting', entityId: meeting._id,
    })));

    res.status(201).json({ meeting });
  } catch (error) {
    console.error('br create meeting error:', error);
    return sendMongooseError(res, error, 'تعذّر إنشاء الاجتماع');
  }
};

exports.updateMeeting = async (req, res) => {
  try {
    if (!canRunMeetings(req.user)) return deny(res, 'Only the administration can edit meetings');
    const meeting = await BrMeeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

    MEETING_FIELDS.forEach((f) => { if (req.body[f] !== undefined) meeting[f] = req.body[f]; });
    if (req.body.attendees !== undefined) {
      meeting.attendees = await buildAttendees(req.body.attendees, meeting.attendees, req.user);
    }
    if (req.body.status === 'held' && !meeting.heldAt) meeting.heldAt = new Date();
    // 'Completed' is not an ordinary value in the list: it declares that all the meeting's work is done, so it has a dedicated path that verifies this first.
    if (req.body.status === 'completed') {
      return res.status(400).json({
        message: 'استخدم زر «إقفال الاجتماع» لتحديده كمكتمل — يتم التأكد أولاً من إغلاق كل البنود التنفيذية',
        code: 'USE_COMPLETE_ENDPOINT',
      });
    }
    // Moving a completed meeting back to 'held' also goes through the same path.
    if (meeting.isModified('status') && meeting.status !== 'completed') {
      meeting.completedAt = null; meeting.completedBy = null; meeting.completedByName = ''; meeting.completionNote = '';
    }
    await meeting.save();
    emit('br:meeting', { id: String(meeting._id) });
    res.json({ meeting });
  } catch (error) {
    console.error('br update meeting error:', error);
    return sendMongooseError(res, error, 'تعذّر تحديث الاجتماع');
  }
};

/**
 * Closing the meeting: 'completed'.
 * This differs from 'held': held is a fact (the meeting took place), completed is the administration's judgement that everything arising from it is finished. A meeting can stay 'held' for months while its items run.
 * So that 'completed' keeps meaning in the filter and reports, closing is rejected while items or sub-assignments are still open, and the exact count is returned. No closing on paper.
 */
exports.completeMeeting = async (req, res) => {
  try {
    if (!canRunMeetings(req.user)) return deny(res, 'Only the administration can close a meeting');
    const meeting = await BrMeeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
    if (meeting.status === 'cancelled') {
      return res.status(400).json({ message: 'الاجتماع ملغي — لا يُقفل' });
    }
    if (meeting.status === 'completed') {
      return res.status(400).json({ message: 'الاجتماع مقفول بالفعل' });
    }

    const actions = await BrAction.find({ meeting: meeting._id }).select('_id status title').lean();
    const openActions = actions.filter((a) => OPEN_ACTION_STATUSES.includes(a.status));
    const openTasks = actions.length
      ? await BrAssignment.countDocuments({ action: { $in: actions.map((a) => a._id) }, status: { $in: OPEN_ACTION_STATUSES } })
      : 0;

    if (openActions.length || openTasks) {
      const bits = [];
      if (openActions.length) bits.push(`${openActions.length} بند تنفيذي`);
      if (openTasks) bits.push(`${openTasks} تكليف فرعي`);
      return res.status(400).json({
        message: `لا يمكن الإقفال: لسه ${bits.join(' و')} مفتوح. أغلقها أو ألغِها أولاً.`,
        code: 'OPEN_WORK',
        openActions: openActions.map((a) => ({ _id: a._id, title: a.title, status: a.status })),
        openTasks,
      });
    }

    meeting.status = 'completed';
    if (!meeting.heldAt) meeting.heldAt = new Date();   // Cannot be completed without having taken place.
    meeting.completedAt = new Date();
    meeting.completedBy = req.user._id;
    meeting.completedByName = fullName(req.user);
    meeting.completionNote = (req.body.note || '').trim();
    await meeting.save();

    emit('br:meeting', { id: String(meeting._id) });
    res.json({ meeting });
  } catch (error) {
    console.error('br complete meeting error:', error);
    res.status(500).json({ message: 'تعذّر إقفال الاجتماع' });
  }
};

/** Reopen a closed meeting, if new work appears after closing. */
exports.reopenMeeting = async (req, res) => {
  try {
    if (!canRunMeetings(req.user)) return deny(res, 'Only the administration can reopen a meeting');
    const meeting = await BrMeeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
    if (meeting.status !== 'completed') return res.status(400).json({ message: 'الاجتماع غير مقفول' });
    meeting.status = 'held';
    meeting.completedAt = null; meeting.completedBy = null; meeting.completedByName = ''; meeting.completionNote = '';
    await meeting.save();
    emit('br:meeting', { id: String(meeting._id) });
    res.json({ meeting });
  } catch (error) {
    console.error('br reopen meeting error:', error);
    res.status(500).json({ message: 'تعذّر إعادة فتح الاجتماع' });
  }
};

/** Meeting minutes: the secretary's record of the discussion. */
exports.saveMinutes = async (req, res) => {
  try {
    if (!canRunMeetings(req.user)) return deny(res, 'Only the administration can write minutes');
    const meeting = await BrMeeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

    if (Array.isArray(req.body.minutes)) {
      meeting.minutes = req.body.minutes.map((m, i) => ({
        heading: m.heading || '', body: m.body || '',
        department: m.department || '', order: m.order ?? i,
      }));
    }
    if (req.body.summary !== undefined) meeting.summary = req.body.summary;
    // Writing minutes is what marks a meeting as actually held.
    if (meeting.status === 'scheduled' || meeting.status === 'in_progress') {
      meeting.status = 'held';
      meeting.heldAt = meeting.heldAt || new Date();
    }
    meeting.scribe = req.user._id;
    meeting.scribeName = fullName(req.user);
    await meeting.save();
    emit('br:meeting', { id: String(meeting._id) });
    res.json({ meeting });
  } catch (error) {
    console.error('br save minutes error:', error);
    return sendMongooseError(res, error, 'تعذّر حفظ المحضر');
  }
};

exports.deleteMeeting = async (req, res) => {
  try {
    if (!isExecutive(req.user)) return deny(res, 'Only the administration can delete a meeting');
    const meeting = await BrMeeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
    // Actions outlive their meeting only if someone is still working on them —
    // deleting the record of a decision should not orphan the work.
    const actions = await BrAction.find({ meeting: meeting._id }).select('_id').lean();
    const ids = actions.map((a) => a._id);
    if (ids.length) {
      await BrAssignment.deleteMany({ action: { $in: ids } });
      await BrAction.deleteMany({ _id: { $in: ids } });
    }
    await BrMeeting.findByIdAndDelete(meeting._id);
    emit('br:meeting', { id: String(meeting._id), deleted: true });
    res.json({ message: 'تم حذف الاجتماع' });
  } catch (error) {
    console.error('br delete meeting error:', error);
    res.status(500).json({ message: 'تعذّر حذف الاجتماع' });
  }
};

// ── Actions ─────────────────────────────────────────────────────────────────

/** Build one action row for an owner; shared tasks repeat this per owner with the same shareGroup. */
async function actionFor(meeting, target, body, actor, shareGroup = null) {
  const raiser = body.raisedBy ? await User.findById(body.raisedBy).select('firstName lastName').lean() : null;
  return BrAction.create({
    meeting: meeting._id,
    meetingRef: meeting.refNumber,
    meetingTitle: meeting.title,
    meetingDate: meeting.scheduledAt,
    title: body.title, description: body.description || '',
    // The owner's section wins: the form defaulted to the meeting's first department and filed HR work under IT.
    department: (await require('../utils/userSection').sectionsOfUserIds([target._id])).get(String(target._id)) || body.department || '',
    assignee: target._id, assigneeName: fullName(target), assigneeRole: target.role,
    raisedBy: raiser?._id || null, raisedByName: fullName(raiser),
    startDate: dayOf(body.startDate) || meeting.scheduledAt || new Date(),
    dueDate: dueOf(body.dueDate),
    expectedDate: dueOf(body.expectedDate),
    priority: body.priority || 'medium',
    shareGroup,
    followUpOf: mongoose.isValidObjectId(body.followUpOf) ? body.followUpOf : null,
    createdBy: actor._id, createdByName: fullName(actor),
  });
}

async function announceAction(action, meeting) {
  emit('br:action', { id: String(action._id) });
  const due = action.dueDate ? ` — التسليم ${new Date(action.dueDate).toLocaleDateString('en-GB')}` : '';
  await notify(action.assignee, {
    title: 'بند تنفيذي جديد مُسند إليك',
    message: `${action.title}${due} (${meeting.refNumber || action.meetingRef})`,
    entity: 'BrAction', entityId: action._id,
  });
}

exports.createAction = async (req, res) => {
  try {
    if (!canRunMeetings(req.user)) return deny(res, 'Only the administration can raise actions');
    const meeting = await BrMeeting.findById(req.params.id).lean();
    if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

    // One owner or several (`assignees`): a task handed to two department heads appears under both departments.
    const ids = [...new Set([...(Array.isArray(req.body.assignees) ? req.body.assignees : []), req.body.assignee].filter(Boolean).map(String))];
    if (!req.body.title || !ids.length) return res.status(400).json({ message: 'عنوان البند والمكلَّف مطلوبان' });
    const targets = await User.find({ _id: { $in: ids } }).select('firstName lastName role').lean();
    if (targets.length !== ids.length) return res.status(400).json({ message: 'المكلَّف غير موجود' });

    const group = targets.length > 1 ? new mongoose.Types.ObjectId() : null;
    const actions = [];
    for (const target of targets) actions.push(await actionFor(meeting, target, req.body, req.user, group));
    for (const a of actions) await announceAction(a, meeting);
    res.status(201).json({ action: actions[0], actions });
  } catch (error) {
    console.error('br create action error:', error);
    return sendMongooseError(res, error, 'تعذّر إنشاء البند');
  }
};

/** Give an existing task to another department head as well; both share one group from now on. */
exports.shareAction = async (req, res) => {
  try {
    if (!canRunMeetings(req.user)) return deny(res, 'Only the administration can share an action');
    const action = await BrAction.findById(req.params.actionId);
    if (!action) return res.status(404).json({ message: 'Action not found' });
    const target = await User.findById(req.body.assignee).select('firstName lastName role').lean();
    if (!target) return res.status(400).json({ message: 'المكلَّف غير موجود' });
    if (!action.shareGroup) { action.shareGroup = new mongoose.Types.ObjectId(); await action.save(); }
    const taken = await BrAction.exists({ shareGroup: action.shareGroup, assignee: target._id });
    if (taken) return res.status(409).json({ message: 'البند مُسند إليه بالفعل' });
    const meeting = await BrMeeting.findById(action.meeting).lean() || { _id: action.meeting, refNumber: action.meetingRef, title: action.meetingTitle, scheduledAt: action.meetingDate };
    const copy = await actionFor(meeting, target, {
      title: action.title, description: action.description, raisedBy: action.raisedBy, priority: action.priority,
      startDate: action.startDate, dueDate: action.dueDate,
    }, req.user, action.shareGroup);
    await announceAction(copy, meeting);
    res.status(201).json({ action: copy });
  } catch (error) {
    console.error('br share action error:', error);
    return sendMongooseError(res, error, 'تعذّر مشاركة البند');
  }
};

/** The other owners of each shared action, for "shared with" on cards and the board. */
async function siblingsOf(actions) {
  const groups = [...new Set(actions.map((a) => a.shareGroup && String(a.shareGroup)).filter(Boolean))];
  if (!groups.length) return new Map();
  const rows = await BrAction.find({ shareGroup: { $in: groups } }).select('shareGroup assignee assigneeName department status progress').lean();
  const by = new Map();
  for (const a of actions) {
    if (!a.shareGroup) continue;
    by.set(String(a._id), rows.filter((r) => String(r.shareGroup) === String(a.shareGroup) && String(r._id) !== String(a._id))
      .map((r) => ({ _id: r._id, assignee: r.assignee, assigneeName: r.assigneeName, department: r.department, status: r.status, progress: r.progress })));
  }
  return by;
}
exports.siblingsOf = siblingsOf;

/**
 * Update an action. The owner may move its status and progress; only the people
 * who run meetings may change WHAT it is or who owns it.
 */
exports.updateAction = async (req, res) => {
  try {
    const action = await BrAction.findById(req.params.actionId);
    if (!action) return res.status(404).json({ message: 'Action not found' });

    const owner = sameId(action.assignee, req.user._id);
    const runner = canRunMeetings(req.user);
    if (!owner && !runner) return deny(res, 'This action is not yours');

    const before = action.status;

    if (runner) {
      ['title', 'description', 'department', 'priority'].forEach((f) => {
        if (req.body[f] !== undefined) action[f] = req.body[f];
      });
      if (req.body.dueDate !== undefined && req.body.status !== 'postponed') action.dueDate = dueOf(req.body.dueDate);
      if (req.body.startDate !== undefined) action.startDate = dayOf(req.body.startDate);
      if (req.body.assignee && !sameId(action.assignee, req.body.assignee)) {
        const target = await User.findById(req.body.assignee).select('firstName lastName role').lean();
        if (target) {
          action.assignee = target._id;
          action.assigneeName = fullName(target);
          action.assigneeRole = target.role;
          action.department = (await require('../utils/userSection').sectionsOfUserIds([target._id])).get(String(target._id)) || action.department;
          await notify(target._id, {
            title: 'أُعيد إسناد بند تنفيذي إليك',
            message: `${action.title} (${action.meetingRef})`,
            entity: 'BrAction', entityId: action._id,
          });
        }
      }
    }

    // The owner reports progress, expected date and postponement; the board reads it live.
    const bad = applyProgress(action, req.body);
    if (bad) return res.status(400).json({ message: bad, code: 'POSTPONE_NEEDS_DATE_REASON' });
    logUpdate(action, req.user, req.body, before);
    await action.save();
    // What the task is stays the same for every department sharing it; each keeps its own status and dates.
    if (runner && action.shareGroup) {
      const same = {};
      ['title', 'description', 'priority'].forEach((f) => { if (req.body[f] !== undefined) same[f] = action[f]; });
      // An edited due date (not a postponement, which is one owner's own) moves with the task for every owner.
      if (req.body.dueDate !== undefined && req.body.status !== 'postponed') same.dueDate = action.dueDate;
      if (Object.keys(same).length) await BrAction.updateMany({ shareGroup: action.shareGroup, _id: { $ne: action._id } }, { $set: same });
    }
    emit('br:action', { id: String(action._id) });

    // Closing the loop: whoever asked for it hears that it landed.
    if (before !== 'done' && action.status === 'done') {
      await notify(action.raisedBy || action.createdBy, {
        title: 'تم إنجاز بند تنفيذي',
        message: `${action.title} — أنجزه ${fullName(req.user)}`,
        entity: 'BrAction', entityId: action._id,
      });
    }
    res.json({ action });
  } catch (error) {
    console.error('br update action error:', error);
    return sendMongooseError(res, error, 'تعذّر تحديث البند');
  }
};

exports.deleteAction = async (req, res) => {
  try {
    if (!canRunMeetings(req.user)) return deny(res);
    const action = await BrAction.findById(req.params.actionId);
    if (!action) return res.status(404).json({ message: 'Action not found' });
    await BrAssignment.deleteMany({ action: action._id });
    await BrAction.findByIdAndDelete(action._id);
    emit('br:action', { id: String(action._id), deleted: true });
    res.json({ message: 'تم حذف البند' });
  } catch (error) {
    res.status(500).json({ message: 'تعذّر حذف البند' });
  }
};

/** All items assigned to me: the manager's own board. */
exports.myActions = async (req, res) => {
  try {
    const filter = { assignee: req.user._id };
    if (req.query.status) filter.status = req.query.status;
    else if (req.query.open === '1') filter.status = { $in: OPEN_ACTION_STATUSES };

    const actions = await BrAction.find(filter).sort({ dueDate: 1, createdAt: -1 }).limit(500).lean();
    const ids = actions.map((a) => a._id);
    const delegations = ids.length
      ? await BrAssignment.find({ action: { $in: ids } }).sort({ createdAt: 1 }).lean()
      : [];
    const byAction = new Map();
    for (const d of delegations) {
      const k = String(d.action);
      if (!byAction.has(k)) byAction.set(k, []);
      byAction.get(k).push(d);
    }
    const shared = await siblingsOf(actions);
    res.json({
      actions: actions.map((a) => ({ ...a, delegations: byAction.get(String(a._id)) || [], sharedWith: shared.get(String(a._id)) || [] })),
      summary: {
        total: actions.length,
        open: actions.filter((a) => OPEN_ACTION_STATUSES.includes(a.status)).length,
        overdue: actions.filter((a) => a.isOverdue && OPEN_ACTION_STATUSES.includes(a.status)).length,
        done: actions.filter((a) => a.status === 'done').length,
      },
    });
  } catch (error) {
    console.error('br my actions error:', error);
    res.status(500).json({ message: 'تعذّر تحميل بنودك' });
  }
};

/** Every action, for the board and the secretariat — the follow-up register. */
exports.allActions = async (req, res) => {
  try {
    if (!canRunMeetings(req.user)) return deny(res);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    else if (req.query.open === '1') filter.status = { $in: OPEN_ACTION_STATUSES };
    if (req.query.assignee) filter.assignee = req.query.assignee;
    if (req.query.department) filter.department = req.query.department;
    if (req.query.meeting) filter.meeting = req.query.meeting;

    const actions = await BrAction.find(filter).sort({ dueDate: 1, createdAt: -1 }).limit(1000).lean();
    const ids = actions.map((a) => a._id);
    const delegations = ids.length
      ? await BrAssignment.find({ action: { $in: ids } }).select('action assignee assigneeName status dueDate progress').lean()
      : [];
    const byAction = new Map();
    for (const d of delegations) {
      const k = String(d.action);
      if (!byAction.has(k)) byAction.set(k, []);
      byAction.get(k).push(d);
    }

    const open = actions.filter((a) => OPEN_ACTION_STATUSES.includes(a.status));
    // Who is carrying what — the question the GM actually asks in the meeting.
    const byPerson = new Map();
    for (const a of actions) {
      const k = String(a.assignee);
      const cur = byPerson.get(k) || { assignee: k, name: a.assigneeName, total: 0, open: 0, overdue: 0, done: 0 };
      cur.total += 1;
      if (OPEN_ACTION_STATUSES.includes(a.status)) cur.open += 1;
      if (a.isOverdue && OPEN_ACTION_STATUSES.includes(a.status)) cur.overdue += 1;
      if (a.status === 'done') cur.done += 1;
      byPerson.set(k, cur);
    }

    const shared = await siblingsOf(actions);
    res.json({
      actions: actions.map((a) => ({ ...a, delegations: byAction.get(String(a._id)) || [], sharedWith: shared.get(String(a._id)) || [] })),
      summary: {
        total: actions.length,
        open: open.length,
        overdue: actions.filter((a) => a.isOverdue && OPEN_ACTION_STATUSES.includes(a.status)).length,
        done: actions.filter((a) => a.status === 'done').length,
        completionRate: actions.length ? Math.round((actions.filter((a) => a.status === 'done').length / actions.length) * 100) : 0,
      },
      byPerson: [...byPerson.values()].sort((a, b) => b.open - a.open),
    });
  } catch (error) {
    console.error('br all actions error:', error);
    res.status(500).json({ message: 'تعذّر تحميل البنود' });
  }
};

// ── Delegations ─────────────────────────────────────────────────────────────

/**
 * A manager passing part of their action to their team. Several people at once
 * is just several rows — each of whom will only ever see their own.
 */
exports.delegate = async (req, res) => {
  try {
    const action = await BrAction.findById(req.params.actionId);
    if (!action) return res.status(404).json({ message: 'Action not found' });
    // You delegate YOUR action. The secretariat can do it on a manager's behalf.
    if (!sameId(action.assignee, req.user._id) && !canRunMeetings(req.user)) {
      return deny(res, 'You can only delegate an action assigned to you');
    }

    const rows = Array.isArray(req.body.assignments) ? req.body.assignments : [req.body];
    const created = [];
    for (const row of rows) {
      const assigneeId = row.assignee;
      if (!assigneeId) continue;
      const target = await User.findById(assigneeId).select('firstName lastName role').lean();
      if (!target) continue;
      // An outside partner is never company staff — they cannot be given work.
      if (target.role === 'client') continue;

      const a = await BrAssignment.create({
        action: action._id,
        actionTitle: action.title,
        department: action.department,
        assignee: target._id,
        assigneeName: fullName(target),
        assignedBy: req.user._id,
        assignedByName: fullName(req.user),
        title: (row.title || action.title).trim(),
        instructions: row.instructions || '',
        dueDate: row.dueDate ? dueOf(row.dueDate) : action.dueDate,
        priority: row.priority || action.priority,
      });
      created.push(a);

      const due = a.dueDate ? ` — التسليم ${new Date(a.dueDate).toLocaleDateString('en-GB')}` : '';
      await notify(target._id, {
        title: 'مهمة جديدة مُسندة إليك',
        message: `${a.title}${due} — من ${fullName(req.user)}`,
        entity: 'BrAssignment', entityId: a._id,
      });
    }

    if (!created.length) return res.status(400).json({ message: 'لم يتم تحديد أي موظف صالح' });
    // The parent action starts moving the moment work is handed out.
    if (action.status === 'open') {
      action.status = 'in_progress';
      action.updates.push({
        by: req.user._id, byName: fullName(req.user),
        text: `تم توزيع المهمة على ${created.length} من الفريق`,
        statusFrom: 'open', statusTo: 'in_progress', at: new Date(),
      });
      await action.save();
    }
    emit('br:action', { id: String(action._id) });
    res.status(201).json({ assignments: created });
  } catch (error) {
    console.error('br delegate error:', error);
    res.status(500).json({ message: 'تعذّر توزيع المهمة' });
  }
};

/** My tasks: what an EMPLOYEE sees. Reads BrAssignment only, so it is structurally incapable of returning meeting minutes or anyone else's work. */
exports.myAssignments = async (req, res) => {
  try {
    const filter = { assignee: req.user._id };
    if (req.query.status) filter.status = req.query.status;
    else if (req.query.open === '1') filter.status = { $in: OPEN_ACTION_STATUSES };
    const items = await BrAssignment.find(filter).sort({ dueDate: 1, createdAt: -1 }).limit(500).lean();
    res.json({
      assignments: items,
      summary: {
        total: items.length,
        open: items.filter((a) => OPEN_ACTION_STATUSES.includes(a.status)).length,
        overdue: items.filter((a) => a.isOverdue && OPEN_ACTION_STATUSES.includes(a.status)).length,
        done: items.filter((a) => a.status === 'done').length,
      },
    });
  } catch (error) {
    console.error('br my assignments error:', error);
    res.status(500).json({ message: 'تعذّر تحميل مهامك' });
  }
};

/** The assignee reports progress; the delegating manager may also correct it. */
exports.updateAssignment = async (req, res) => {
  try {
    const a = await BrAssignment.findById(req.params.assignmentId);
    if (!a) return res.status(404).json({ message: 'Assignment not found' });

    const mine = sameId(a.assignee, req.user._id);
    const boss = sameId(a.assignedBy, req.user._id) || canRunMeetings(req.user);
    if (!mine && !boss) return deny(res, 'This task is not yours');

    const before = a.status;
    if (boss) {
      ['title', 'instructions', 'priority'].forEach((f) => { if (req.body[f] !== undefined) a[f] = req.body[f]; });
      if (req.body.dueDate !== undefined && req.body.status !== 'postponed') a.dueDate = dueOf(req.body.dueDate);
    }
    const bad = applyProgress(a, req.body);
    if (bad) return res.status(400).json({ message: bad, code: 'POSTPONE_NEEDS_DATE_REASON' });
    logUpdate(a, req.user, req.body, before);
    await a.save();
    emit('br:assignment', { id: String(a._id) });

    // The manager who handed it out hears when it comes back.
    if (mine && before !== a.status) {
      await notify(a.assignedBy, {
        title: a.status === 'done' ? 'تم إنجاز مهمة كلّفت بها' : 'تحديث على مهمة كلّفت بها',
        message: `${a.title} — ${fullName(req.user)}`,
        entity: 'BrAssignment', entityId: a._id,
      });
    }
    res.json({ assignment: a });
  } catch (error) {
    console.error('br update assignment error:', error);
    return sendMongooseError(res, error, 'تعذّر تحديث المهمة');
  }
};

exports.deleteAssignment = async (req, res) => {
  try {
    const a = await BrAssignment.findById(req.params.assignmentId);
    if (!a) return res.status(404).json({ message: 'Assignment not found' });
    if (!sameId(a.assignedBy, req.user._id) && !canRunMeetings(req.user)) return deny(res);
    await BrAssignment.findByIdAndDelete(a._id);
    emit('br:assignment', { id: String(a._id), deleted: true });
    res.json({ message: 'تم حذف المهمة' });
  } catch (error) {
    res.status(500).json({ message: 'تعذّر حذف المهمة' });
  }
};

// ── Dashboard ───────────────────────────────────────────────────────────────

exports.getDashboard = async (req, res) => {
  try {
    const runner = canRunMeetings(req.user);
    const participant = isParticipant(req.user);
    const now = new Date();

    const [myActions, myAssignments] = await Promise.all([
      participant ? BrAction.find({ assignee: req.user._id }).select('status isOverdue dueDate title meetingRef').lean() : [],
      BrAssignment.find({ assignee: req.user._id }).select('status isOverdue dueDate title').lean(),
    ]);

    const payload = {
      participant,
      canRunMeetings: runner,
      mine: {
        actions: {
          open: myActions.filter((a) => OPEN_ACTION_STATUSES.includes(a.status)).length,
          overdue: myActions.filter((a) => a.isOverdue && OPEN_ACTION_STATUSES.includes(a.status)).length,
          done: myActions.filter((a) => a.status === 'done').length,
        },
        tasks: {
          open: myAssignments.filter((a) => OPEN_ACTION_STATUSES.includes(a.status)).length,
          overdue: myAssignments.filter((a) => a.isOverdue && OPEN_ACTION_STATUSES.includes(a.status)).length,
          done: myAssignments.filter((a) => a.status === 'done').length,
        },
      },
    };

    if (participant) {
      const scope = meetingScope(req.user);
      const [upcoming, myMeetings, myHeld, myUpcoming] = await Promise.all([
        BrMeeting.find({
          ...scope,
          status: { $in: ['scheduled', 'in_progress'] },
          scheduledAt: { $gte: new Date(now.getTime() - 6 * 3600 * 1000) },
        }).select('refNumber title cadence scheduledAt location status').sort({ scheduledAt: 1 }).limit(8).lean(),
        BrMeeting.countDocuments(scope),
        BrMeeting.countDocuments({ ...scope, status: { $in: HELD_MEETING_STATUSES } }),
        BrMeeting.countDocuments({ ...scope, status: { $in: ['scheduled', 'in_progress'] }, scheduledAt: { $gte: now } }),
      ]);
      payload.upcoming = upcoming;
      // Meeting counts, so the tiles say something true the moment a meeting is
      // scheduled instead of showing zeros until the first action exists.
      const myCompleted = await BrMeeting.countDocuments({ ...scope, status: 'completed' });
      payload.mine.meetings = { total: myMeetings, held: myHeld, upcoming: myUpcoming, completed: myCompleted };
    }

    if (runner) {
      const all = await BrAction.find({}).select('status isOverdue assigneeName department dueDate').lean();
      const open = all.filter((a) => OPEN_ACTION_STATUSES.includes(a.status));
      payload.overview = {
        meetings: await BrMeeting.countDocuments({}),
        heldThisQuarter: await BrMeeting.countDocuments({
          status: 'held',
          scheduledAt: { $gte: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1) },
        }),
        actions: all.length,
        open: open.length,
        overdue: all.filter((a) => a.isOverdue && OPEN_ACTION_STATUSES.includes(a.status)).length,
        done: all.filter((a) => a.status === 'done').length,
        completionRate: all.length ? Math.round((all.filter((a) => a.status === 'done').length / all.length) * 100) : 0,
      };
    }

    res.json(payload);
  } catch (error) {
    console.error('br dashboard error:', error);
    res.status(500).json({ message: 'تعذّر تحميل اللوحة' });
  }
};
