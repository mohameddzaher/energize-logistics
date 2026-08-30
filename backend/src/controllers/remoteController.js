const mongoose = require('mongoose');
const { startOfDay, endOfDay } = require('../utils/companyDay');
const User = require('../models/User');
const RemoteAttendance = require('../models/RemoteAttendance');
const RemoteLeaveRequest = require('../models/RemoteLeaveRequest');
const RemoteMessage = require('../models/RemoteMessage');
const RemoteTask = require('../models/RemoteTask');
const RemoteReport = require('../models/RemoteReport');
const RemoteAnnouncement = require('../models/RemoteAnnouncement');
const { createNotification } = require('../services/notificationService');
const { emitToUser, emitToAll } = require('../websocket/socketManager');
const { grantedBySection } = require('../utils/sectionAccess');

// ── Helpers ───────────────────────────────────────────────────────────────
const STAFF_ROLES = ['super_admin', 'admin', 'remote_manager'];
const isStaff = (user) => STAFF_ROLES.includes(user.role);
// A role the super_admin granted this section to counts as staff too —
// otherwise the grant passes the route gate but the handler still rejects it.
const staffReq = (req) => isStaff(req.user) || grantedBySection(req);
const isFullAdmin = (user) => user.role === 'super_admin' || user.role === 'admin';

// Cairo-local calendar day as YYYY-MM-DD (en-CA formats as ISO date).
const cairoDate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);

const daysBetween = (start, end) => {
  const a = new Date(start + 'T00:00:00Z');
  const b = new Date(end + 'T00:00:00Z');
  const diff = Math.round((b - a) / 86400000);
  return diff >= 0 ? diff + 1 : 1;
};

// Returns the list of remote-employee userIds the requester may see, or `null`
// meaning "all remote employees" (full admins). remote_employee sees only self.
const scopeEmployeeIds = async (user) => {
  if (isFullAdmin(user)) return null; // all
  if (user.role === 'remote_manager') {
    const team = await User.find({ role: 'remote_employee', manager: user._id }).select('_id').lean();
    return team.map((u) => u._id);
  }
  return [user._id]; // remote_employee
};

// Build a {user: ...} mongo filter scoped to what the requester can see, with
// optional explicit userId (validated against scope) and date range.
const buildScopedFilter = async (req, dateField = 'date') => {
  const filter = {};
  const ids = await scopeEmployeeIds(req.user);
  const { userId, from, to } = req.query;

  if (ids === null) {
    if (userId) filter.user = userId;
  } else {
    const allowed = ids.map(String);
    if (userId && allowed.includes(String(userId))) filter.user = userId;
    else filter.user = { $in: ids };
  }

  if (from || to) {
    // `date`/`startDate` are 'YYYY-MM-DD' strings; `createdAt` is a real Date.
    // String-vs-Date comparisons don't match in Mongo, so coerce accordingly.
    const isDateType = dateField === 'createdAt' || dateField === 'updatedAt';
    filter[dateField] = {};
    if (from) filter[dateField].$gte = isDateType ? startOfDay(from) : from;
    if (to) filter[dateField].$lte = isDateType ? endOfDay(to) : to;
  }
  return filter;
};

// Notify an employee's reviewers (their manager + all full admins).
const reviewersFor = async (employeeUserId, managerId) => {
  const admins = await User.find({ role: { $in: ['super_admin', 'admin'] }, isActive: true }).select('_id').lean();
  const ids = admins.map((a) => String(a._id));
  if (managerId) ids.push(String(managerId));
  return [...new Set(ids)].filter((id) => id !== String(employeeUserId));
};

// ── Attendance ──────────────────────────────────────────────────────────────
// One big button: first press of the day checks in, second checks out.
exports.toggleAttendance = async (req, res) => {
  try {
    if (req.user.role !== 'remote_employee') {
      return res.status(403).json({ message: 'Only remote employees record attendance' });
    }
    const today = cairoDate();
    const now = new Date();
    let record = await RemoteAttendance.findOne({ user: req.user._id, date: today });

    if (!record) {
      record = await RemoteAttendance.create({
        user: req.user._id,
        date: today,
        checkIn: now,
        status: 'incomplete',
      });
      return res.json({ record, action: 'check_in' });
    }

    if (record.checkIn && !record.checkOut) {
      record.checkOut = now;
      record.durationMinutes = Math.max(0, Math.round((now - record.checkIn) / 60000));
      record.status = 'present';
      await record.save();
      return res.json({ record, action: 'check_out' });
    }

    // Already completed for today — nothing more to toggle.
    return res.json({ record, action: 'done' });
  } catch (error) {
    console.error('toggleAttendance error:', error);
    res.status(500).json({ message: 'Failed to record attendance' });
  }
};

exports.getTodayAttendance = async (req, res) => {
  try {
    const record = await RemoteAttendance.findOne({ user: req.user._id, date: cairoDate() }).lean();
    res.json({ record: record || null, today: cairoDate() });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load attendance' });
  }
};

exports.listAttendance = async (req, res) => {
  try {
    const filter = await buildScopedFilter(req, 'date');
    const records = await RemoteAttendance.find(filter)
      .populate('user', 'firstName lastName email')
      .sort({ date: -1, createdAt: -1 })
      .limit(1000)
      .lean();
    res.json({ records });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load attendance records' });
  }
};

// ── Dashboard (personal stats, or team totals for staff) ─────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const attendanceFilter = await buildScopedFilter(req, 'date');
    const leaveFilter = await buildScopedFilter(req, 'createdAt');

    const [attendance, leaves] = await Promise.all([
      RemoteAttendance.find(attendanceFilter).populate('user', 'firstName lastName').lean(),
      RemoteLeaveRequest.find({ ...leaveFilter, status: 'approved' }).lean(),
    ]);

    const totalMinutes = attendance.reduce((s, a) => s + (a.durationMinutes || 0), 0);
    const daysWorked = attendance.filter((a) => a.status === 'present').length;
    const leaveDays = leaves.reduce((s, l) => s + (l.days || 0), 0);

    // Per-employee breakdown (used by staff team view).
    const byUser = {};
    for (const a of attendance) {
      const id = String(a.user?._id || a.user);
      if (!byUser[id]) {
        byUser[id] = {
          userId: id,
          name: a.user ? `${a.user.firstName} ${a.user.lastName}` : '—',
          daysWorked: 0,
          totalMinutes: 0,
          leaveDays: 0,
        };
      }
      if (a.status === 'present') byUser[id].daysWorked += 1;
      byUser[id].totalMinutes += a.durationMinutes || 0;
    }
    for (const l of leaves) {
      const id = String(l.user);
      if (byUser[id]) byUser[id].leaveDays += l.days || 0;
    }

    res.json({
      scope: staffReq(req) ? 'team' : 'self',
      summary: {
        daysWorked,
        totalMinutes,
        totalHours: Math.round((totalMinutes / 60) * 10) / 10,
        leaveDays,
        pendingLeaves: await RemoteLeaveRequest.countDocuments({
          ...(await buildScopedFilter(req, 'createdAt')),
          status: 'pending',
        }),
      },
      perEmployee: Object.values(byUser).sort((a, b) => b.totalMinutes - a.totalMinutes),
    });
  } catch (error) {
    console.error('getDashboard error:', error);
    res.status(500).json({ message: 'Failed to load dashboard' });
  }
};

// ── Leave requests ───────────────────────────────────────────────────────────
exports.createLeave = async (req, res) => {
  try {
    if (req.user.role !== 'remote_employee') {
      return res.status(403).json({ message: 'Only remote employees can request leave' });
    }
    const { type, startDate, endDate, reason } = req.body;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start and end dates are required' });
    }
    // Same advance-notice rule as the HR section: a planned leave is requested a
    // month ahead; sick and emergency leave are exempt because you cannot plan them.
    const { REMOTE_LEAVE_NO_NOTICE, LEAVE_ADVANCE_NOTICE_DAYS } = require('../config/constants');
    const kind = type || 'annual';
    if (!REMOTE_LEAVE_NO_NOTICE.includes(kind)) {
      const today = new Date().toISOString().slice(0, 10);
      const daysAhead = Math.round(
        (Date.parse(`${String(startDate).slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000
      );
      if (daysAhead < LEAVE_ADVANCE_NOTICE_DAYS) {
        return res.status(400).json({
          code: 'ADVANCE_NOTICE_REQUIRED',
          policy: { requiredDays: LEAVE_ADVANCE_NOTICE_DAYS, daysAhead, leaveType: kind },
          message: `يجب تقديم طلب الإجازة قبل موعد بدايتها بـ ${LEAVE_ADVANCE_NOTICE_DAYS} يومًا على الأقل (المتبقي ${daysAhead} يوم). الإجازة المرضية والطارئة معفاة.`
            + ` | Leave must be requested at least ${LEAVE_ADVANCE_NOTICE_DAYS} days before it starts (this one starts in ${daysAhead}). Sick and emergency leave are exempt.`,
        });
      }
    }
    const leave = await RemoteLeaveRequest.create({
      user: req.user._id,
      manager: req.user.manager || undefined,
      type: type || 'annual',
      startDate,
      endDate,
      days: daysBetween(startDate, endDate),
      reason,
    });

    const recipients = await reviewersFor(req.user._id, req.user.manager);
    const name = `${req.user.firstName} ${req.user.lastName}`;
    await Promise.all(
      recipients.map((rid) =>
        createNotification({
          recipient: rid,
          type: 'system_alert',
          title: 'New leave request',
          message: `${name} requested ${leave.days} day(s) leave (${startDate} → ${endDate}).`,
          relatedEntity: 'RemoteLeaveRequest',
          relatedEntityId: leave._id,
        }).catch(() => {})
      )
    );

    res.status(201).json({ leave });
  } catch (error) {
    console.error('createLeave error:', error);
    res.status(500).json({ message: 'Failed to create leave request' });
  }
};

exports.listLeaves = async (req, res) => {
  try {
    const filter = await buildScopedFilter(req, 'createdAt');
    if (req.query.status) filter.status = req.query.status;
    const leaves = await RemoteLeaveRequest.find(filter)
      .populate('user', 'firstName lastName email')
      .populate('reviewedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ leaves });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load leave requests' });
  }
};

exports.reviewLeave = async (req, res) => {
  try {
    if (!staffReq(req)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    const { status, reviewNote } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Status must be approved or rejected' });
    }
    const leave = await RemoteLeaveRequest.findById(req.params.id);
    if (!leave) return res.status(404).json({ message: 'Leave request not found' });

    // A remote_manager may only review their own team's requests.
    if (req.user.role === 'remote_manager') {
      const ids = await scopeEmployeeIds(req.user);
      if (!ids.map(String).includes(String(leave.user))) {
        return res.status(403).json({ message: 'Not your team member' });
      }
    }

    leave.status = status;
    leave.reviewedBy = req.user._id;
    leave.reviewedAt = new Date();
    if (reviewNote !== undefined) leave.reviewNote = reviewNote;
    await leave.save();

    await createNotification({
      recipient: leave.user,
      type: 'system_alert',
      title: status === 'approved' ? 'Leave approved' : 'Leave rejected',
      message: `Your leave request (${leave.startDate} → ${leave.endDate}) was ${status}.`,
      relatedEntity: 'RemoteLeaveRequest',
      relatedEntityId: leave._id,
    }).catch(() => {});
    try { emitToUser(String(leave.user), 'remote:leave-updated', { id: String(leave._id), status }); } catch (e) {}

    res.json({ leave });
  } catch (error) {
    console.error('reviewLeave error:', error);
    res.status(500).json({ message: 'Failed to review leave request' });
  }
};

// ── Chat ──────────────────────────────────────────────────────────────────
// For staff: list of employee threads with last message + unread count.
exports.listThreads = async (req, res) => {
  try {
    if (!staffReq(req)) return res.status(403).json({ message: 'Insufficient permissions' });
    const ids = await scopeEmployeeIds(req.user);
    const employees = await User.find(
      ids === null ? { role: 'remote_employee' } : { _id: { $in: ids } }
    ).select('firstName lastName email').lean();

    const threads = await Promise.all(
      employees.map(async (emp) => {
        const [last, unread] = await Promise.all([
          RemoteMessage.findOne({ employee: emp._id }).sort({ createdAt: -1 }).lean(),
          RemoteMessage.countDocuments({ employee: emp._id, readByStaff: false, sender: emp._id }),
        ]);
        return {
          employee: emp,
          lastMessage: last ? { body: last.body, createdAt: last.createdAt } : null,
          lastAt: last ? last.createdAt : null,
          unread,
        };
      })
    );
    threads.sort((a, b) => new Date(b.lastAt || 0) - new Date(a.lastAt || 0));
    res.json({ threads });
  } catch (error) {
    console.error('listThreads error:', error);
    res.status(500).json({ message: 'Failed to load conversations' });
  }
};

// Resolve which employee thread the requester is allowed to read/write.
const resolveThread = async (req) => {
  if (req.user.role === 'remote_employee') return req.user._id;
  const employeeId = req.params.employeeId;
  if (!mongoose.isValidObjectId(employeeId)) return false;
  if (isFullAdmin(req.user)) return employeeId;
  // remote_manager — must own this employee
  const ids = await scopeEmployeeIds(req.user);
  return ids.map(String).includes(String(employeeId)) ? employeeId : false;
};

exports.getMessages = async (req, res) => {
  try {
    const employeeId = await resolveThread(req);
    if (!employeeId) return res.status(403).json({ message: 'No access to this conversation' });

    const messages = await RemoteMessage.find({ employee: employeeId })
      .populate('sender', 'firstName lastName role')
      .sort({ createdAt: 1 })
      .lean();

    // Mark the other side's messages as read.
    if (req.user.role === 'remote_employee') {
      await RemoteMessage.updateMany({ employee: employeeId, readByEmployee: false }, { readByEmployee: true });
    } else {
      await RemoteMessage.updateMany({ employee: employeeId, readByStaff: false }, { readByStaff: true });
    }

    res.json({ messages });
  } catch (error) {
    console.error('getMessages error:', error);
    res.status(500).json({ message: 'Failed to load messages' });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const employeeId = await resolveThread(req);
    if (!employeeId) return res.status(403).json({ message: 'No access to this conversation' });
    const { body } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ message: 'Message cannot be empty' });

    const fromEmployee = req.user.role === 'remote_employee';
    const message = await RemoteMessage.create({
      employee: employeeId,
      sender: req.user._id,
      body: body.trim(),
      readByEmployee: fromEmployee,
      readByStaff: !fromEmployee,
    });
    const populated = await message.populate('sender', 'firstName lastName role');

    // Push to the other party in real time.
    try {
      if (fromEmployee) {
        const emp = await User.findById(employeeId).select('manager').lean();
        const targets = await reviewersFor(employeeId, emp?.manager);
        targets.forEach((rid) => emitToUser(rid, 'remote:message', { employee: String(employeeId), message: populated }));
      } else {
        emitToUser(String(employeeId), 'remote:message', { employee: String(employeeId), message: populated });
        await createNotification({
          recipient: employeeId,
          type: 'system_alert',
          title: 'New message from your manager',
          message: body.trim().slice(0, 120),
          relatedEntity: 'RemoteMessage',
          relatedEntityId: message._id,
        }).catch(() => {});
      }
    } catch (e) {}

    res.status(201).json({ message: populated });
  } catch (error) {
    console.error('sendMessage error:', error);
    res.status(500).json({ message: 'Failed to send message' });
  }
};

// ── Tasks ───────────────────────────────────────────────────────────────────
exports.listTasks = async (req, res) => {
  try {
    const filter = await buildScopedFilter(req, 'createdAt');
    if (req.query.done !== undefined) filter.done = req.query.done === 'true';
    const tasks = await RemoteTask.find(filter)
      .populate('user', 'firstName lastName')
      .populate('assignedBy', 'firstName lastName')
      .sort({ done: 1, createdAt: -1 })
      .lean();
    res.json({ tasks });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load tasks' });
  }
};

exports.createTask = async (req, res) => {
  try {
    if (!staffReq(req)) return res.status(403).json({ message: 'Only managers assign tasks' });
    const { user, title, description, dueDate } = req.body;
    if (!user || !title) return res.status(400).json({ message: 'Assignee and title are required' });

    // remote_manager may only assign to their own team.
    if (req.user.role === 'remote_manager') {
      const ids = await scopeEmployeeIds(req.user);
      if (!ids.map(String).includes(String(user))) {
        return res.status(403).json({ message: 'Not your team member' });
      }
    }

    const task = await RemoteTask.create({ user, title, description, dueDate, assignedBy: req.user._id });
    await createNotification({
      recipient: user,
      type: 'system_alert',
      title: 'New task assigned',
      message: title,
      relatedEntity: 'RemoteTask',
      relatedEntityId: task._id,
    }).catch(() => {});
    try { emitToUser(String(user), 'remote:task', { id: String(task._id) }); } catch (e) {}

    res.status(201).json({ task });
  } catch (error) {
    console.error('createTask error:', error);
    res.status(500).json({ message: 'Failed to create task' });
  }
};

exports.updateTask = async (req, res) => {
  try {
    const task = await RemoteTask.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    const owner = String(task.user) === String(req.user._id);
    if (!owner && !staffReq(req)) return res.status(403).json({ message: 'Insufficient permissions' });
    if (req.user.role === 'remote_manager' && !owner) {
      const ids = await scopeEmployeeIds(req.user);
      if (!ids.map(String).includes(String(task.user))) {
        return res.status(403).json({ message: 'Not your team member' });
      }
    }

    const { done, title, description, dueDate } = req.body;
    if (done !== undefined) {
      task.done = !!done;
      task.completedAt = done ? new Date() : undefined;
    }
    // Only staff may edit task content.
    if (staffReq(req)) {
      if (title !== undefined) task.title = title;
      if (description !== undefined) task.description = description;
      if (dueDate !== undefined) task.dueDate = dueDate;
    }
    await task.save();
    res.json({ task });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update task' });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    if (!staffReq(req)) return res.status(403).json({ message: 'Insufficient permissions' });
    const task = await RemoteTask.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });
    if (req.user.role === 'remote_manager') {
      const ids = await scopeEmployeeIds(req.user);
      if (!ids.map(String).includes(String(task.user))) {
        return res.status(403).json({ message: 'Not your team member' });
      }
    }
    await task.deleteOne();
    res.json({ message: 'Task deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete task' });
  }
};

// ── Daily reports ─────────────────────────────────────────────────────────────
exports.listReports = async (req, res) => {
  try {
    const filter = await buildScopedFilter(req, 'date');
    const reports = await RemoteReport.find(filter)
      .populate('user', 'firstName lastName email')
      .sort({ date: -1, createdAt: -1 })
      .limit(500)
      .lean();
    res.json({ reports });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load reports' });
  }
};

exports.submitReport = async (req, res) => {
  try {
    if (req.user.role !== 'remote_employee') {
      return res.status(403).json({ message: 'Only remote employees submit reports' });
    }
    const { body, date } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ message: 'Report cannot be empty' });
    const day = date || cairoDate();

    // One report per day — upsert so re-submitting edits today's report.
    const report = await RemoteReport.findOneAndUpdate(
      { user: req.user._id, date: day },
      { $set: { body: body.trim() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const recipients = await reviewersFor(req.user._id, req.user.manager);
    const name = `${req.user.firstName} ${req.user.lastName}`;
    await Promise.all(
      recipients.map((rid) =>
        createNotification({
          recipient: rid,
          type: 'system_alert',
          title: 'Daily report submitted',
          message: `${name} submitted their report for ${day}.`,
          relatedEntity: 'RemoteReport',
          relatedEntityId: report._id,
        }).catch(() => {})
      )
    );

    res.status(201).json({ report });
  } catch (error) {
    console.error('submitReport error:', error);
    res.status(500).json({ message: 'Failed to submit report' });
  }
};

exports.getTodayReport = async (req, res) => {
  try {
    const report = await RemoteReport.findOne({ user: req.user._id, date: cairoDate() }).lean();
    res.json({ report: report || null, today: cairoDate() });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load report' });
  }
};

// ── Announcements ───────────────────────────────────────────────────────────
exports.listAnnouncements = async (req, res) => {
  try {
    let filter = {};
    // remote_employee sees team-wide ones + any addressed to them.
    if (req.user.role === 'remote_employee') {
      filter = { $or: [{ audience: { $size: 0 } }, { audience: req.user._id }] };
    }
    const announcements = await RemoteAnnouncement.find(filter)
      .populate('author', 'firstName lastName role')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.json({ announcements });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load announcements' });
  }
};

exports.createAnnouncement = async (req, res) => {
  try {
    if (!staffReq(req)) return res.status(403).json({ message: 'Insufficient permissions' });
    const { title, body, audience } = req.body;
    if (!title || !body) return res.status(400).json({ message: 'Title and body are required' });

    const announcement = await RemoteAnnouncement.create({
      author: req.user._id,
      title,
      body,
      audience: Array.isArray(audience) ? audience : [],
    });

    // Notify the audience (or whole team).
    const ids = await scopeEmployeeIds(req.user);
    let targets;
    if (Array.isArray(audience) && audience.length) targets = audience;
    else {
      const emps = await User.find(
        ids === null ? { role: 'remote_employee', isActive: true } : { _id: { $in: ids } }
      ).select('_id').lean();
      targets = emps.map((e) => e._id);
    }
    await Promise.all(
      targets.map((rid) =>
        createNotification({
          recipient: rid,
          type: 'system_alert',
          title: 'New announcement',
          message: title,
          relatedEntity: 'RemoteAnnouncement',
          relatedEntityId: announcement._id,
        }).catch(() => {})
      )
    );

    res.status(201).json({ announcement });
  } catch (error) {
    console.error('createAnnouncement error:', error);
    res.status(500).json({ message: 'Failed to create announcement' });
  }
};

exports.deleteAnnouncement = async (req, res) => {
  try {
    if (!staffReq(req)) return res.status(403).json({ message: 'Insufficient permissions' });
    const a = await RemoteAnnouncement.findById(req.params.id);
    if (!a) return res.status(404).json({ message: 'Announcement not found' });
    if (req.user.role === 'remote_manager' && String(a.author) !== String(req.user._id)) {
      return res.status(403).json({ message: 'You can only delete your own announcements' });
    }
    await a.deleteOne();
    res.json({ message: 'Announcement deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete announcement' });
  }
};

// ── Team directory (for filters / task assignment) ──────────────────────────
exports.listEmployees = async (req, res) => {
  try {
    if (!staffReq(req)) return res.status(403).json({ message: 'Insufficient permissions' });
    const ids = await scopeEmployeeIds(req.user);
    const employees = await User.find(
      ids === null ? { role: 'remote_employee' } : { _id: { $in: ids } }
    )
      .select('firstName lastName email isActive')
      .sort({ firstName: 1 })
      .lean();
    res.json({ employees });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load employees' });
  }
};

/**
 * تعديل إعلان — الإعلان الذي فيه خطأٌ يُصحَّح لا يُحذف ويُعاد.
 * حذفُه وإعادة نشره يُرسل إشعارًا ثانيًا لكلّ الفريق عن الخبر نفسه، فيُقرأ
 * الثاني على أنّه خبرٌ جديد. ولذلك لا يُشعَر عند التعديل.
 */
exports.updateAnnouncement = async (req, res) => {
  try {
    if (!staffReq(req)) return res.status(403).json({ message: 'Insufficient permissions' });
    const a = await RemoteAnnouncement.findById(req.params.id);
    if (!a) return res.status(404).json({ message: 'Announcement not found' });
    const { title, body, audience } = req.body;
    if (title !== undefined) { if (!String(title).trim()) return res.status(400).json({ message: 'Title is required' }); a.title = title; }
    if (body !== undefined) { if (!String(body).trim()) return res.status(400).json({ message: 'Body is required' }); a.body = body; }
    if (audience !== undefined) a.audience = Array.isArray(audience) ? audience : [];
    await a.save();
    try { emitToAll('remote:announcement', { id: String(a._id) }); } catch (e) {}
    res.json({ announcement: a });
  } catch (error) {
    console.error('updateAnnouncement error:', error);
    res.status(500).json({ message: 'Failed to update the announcement' });
  }
};
