/**
 * BusinessReview — اجتماعات مراجعة الأعمال: الاجتماع، المحضر، البنود، والتكليفات.
 *
 * THREE collections, and the split is the security model — not a stylistic
 * choice. The brief was firm that employees must never see what the managers and
 * the board discussed, only the piece of work handed down to them.
 *
 *   BrMeeting     — the meeting: cadence, attendees, agenda, and the MINUTES
 *                   (محضر الاجتماع) the secretary writes.
 *   BrAction      — a decision that became work (بند تنفيذي): one owner, a due
 *                   date, a status. Owned by an attendee — i.e. a manager.
 *   BrAssignment  — a manager passing part of their action to their own team.
 *
 * If delegations lived inside BrAction, every employee query would have to
 * redact meeting context field by field, and one forgotten `.select()` would
 * leak the boardroom. Because they live in their own collection, an employee's
 * query is `BrAssignment.find({ assignee: me })` — it cannot return minutes,
 * because minutes are not in there. The data model enforces the rule, not the
 * diligence of whoever writes the next endpoint.
 */
const mongoose = require('mongoose');
const {
  CADENCE_KEYS, MEETING_STATUS_KEYS, ACTION_STATUS_KEYS, PRIORITY_KEYS,
} = require('../config/businessReview');

// A dated note anyone involved can add. Used for action and assignment updates.
const updateSchema = new mongoose.Schema({
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  byName: { type: String, trim: true, default: '' },
  text: { type: String, trim: true, default: '' },
  // Set when the update also changed the status, so the log reads as a story.
  statusFrom: { type: String, default: '' },
  statusTo: { type: String, default: '' },
  progress: { type: Number, default: null, min: 0, max: 100 },
  at: { type: Date, default: Date.now },
}, { _id: true });

// ── الاجتماع ────────────────────────────────────────────────────────────────
const brMeetingSchema = new mongoose.Schema({
  // Sequential reference (BRM-000123) so a meeting can be cited in writing.
  refNumber: { type: String, unique: true, index: true },

  title: { type: String, required: true, trim: true },
  cadence: { type: String, enum: CADENCE_KEYS, default: 'weekly', index: true },
  // Which departments this round is about. Sourced from config/sections.js, so
  // a newly added section is offered automatically.
  departments: { type: [String], default: [] },

  scheduledAt: { type: Date, required: true, index: true },
  durationMinutes: { type: Number, default: 60 },
  location: { type: String, trim: true, default: '' },
  // For a remote/hybrid round.
  meetingLink: { type: String, trim: true, default: '' },

  status: { type: String, enum: MEETING_STATUS_KEYS, default: 'scheduled', index: true },
  heldAt: { type: Date, default: null },
  // الإقفال: مين قال إن كل حاجة في الاجتماع ده خلصت، وامتى. منفصل عن heldAt
  // لأن الاجتماع بينعقد في يوم وبيقفل في يوم تاني بعد ما بنوده تخلص.
  completedAt: { type: Date, default: null },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  completedByName: { type: String, trim: true, default: '' },
  completionNote: { type: String, trim: true, default: '' },

  // Who was invited, and who actually turned up. Attendance is part of the
  // record: "who wasn't there when this was decided" is a real question, and so
  // is "when was that recorded" and "what reason did they give".
  attendees: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, trim: true, default: '' },
    role: { type: String, trim: true, default: '' },
    department: { type: String, trim: true, default: '' },
    // invited → attended | absent | excused
    attendance: { type: String, enum: ['invited', 'attended', 'absent', 'excused'], default: 'invited' },
    // When the attendance was marked, and by whom — the meeting's own audit line.
    attendanceAt: { type: Date, default: null },
    attendanceBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    attendanceByName: { type: String, trim: true, default: '' },
    // Why they were not there (اعتذر ليه). Only meaningful for absent/excused.
    excuseReason: { type: String, trim: true, default: '' },
    isChair: { type: Boolean, default: false },
  }],

  // جدول الأعمال — set before the meeting.
  agenda: [{
    title: { type: String, trim: true, default: '' },
    presenter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    presenterName: { type: String, trim: true, default: '' },
    department: { type: String, trim: true, default: '' },
    order: { type: Number, default: 0 },
  }],

  // محضر الاجتماع — written during/after by the secretary. Deliberately separate
  // from the actions: minutes are the DISCUSSION, actions are the WORK.
  minutes: [{
    heading: { type: String, trim: true, default: '' },
    body: { type: String, trim: true, default: '' },
    department: { type: String, trim: true, default: '' },
    order: { type: Number, default: 0 },
  }],
  // A short free-text summary for the meeting card.
  summary: { type: String, trim: true, default: '' },

  // The secretary of record for this meeting.
  scribe: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  scribeName: { type: String, trim: true, default: '' },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, trim: true, default: '' },
}, { timestamps: true });

brMeetingSchema.index({ scheduledAt: -1 });
brMeetingSchema.index({ status: 1, scheduledAt: -1 });
brMeetingSchema.index({ 'attendees.user': 1 });

// Reference counter in its own tiny collection, so a deleted meeting never
// frees its number for someone else to reuse.
const counterSchema = new mongoose.Schema({ _id: String, seq: Number });
const BrCounter = mongoose.models.BrCounter || mongoose.model('BrCounter', counterSchema);

brMeetingSchema.pre('save', async function (next) {
  if (this.isNew && !this.refNumber) {
    try {
      const c = await BrCounter.findOneAndUpdate(
        { _id: 'meeting' }, { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      this.refNumber = `BRM-${String(c.seq).padStart(5, '0')}`;
    } catch (e) { return next(e); }
  }
  next();
});

// ── البند التنفيذي ──────────────────────────────────────────────────────────
const brActionSchema = new mongoose.Schema({
  meeting: { type: mongoose.Schema.Types.ObjectId, ref: 'BrMeeting', required: true, index: true },
  // Snapshots so an action list reads correctly without joining the meeting.
  meetingRef: { type: String, trim: true, default: '' },
  meetingTitle: { type: String, trim: true, default: '' },
  meetingDate: { type: Date, default: null },

  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  department: { type: String, trim: true, default: '', index: true },

  // The manager who owns delivering this. One owner — shared ownership is how
  // actions die.
  assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  assigneeName: { type: String, trim: true, default: '' },
  assigneeRole: { type: String, trim: true, default: '' },

  // Who asked for it (usually the GM), captured because "who wants this" is what
  // gets it done.
  raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  raisedByName: { type: String, trim: true, default: '' },

  dueDate: { type: Date, default: null, index: true },
  priority: { type: String, enum: PRIORITY_KEYS, default: 'medium' },
  status: { type: String, enum: ACTION_STATUS_KEYS, default: 'open', index: true },
  progress: { type: Number, default: 0, min: 0, max: 100 },

  completedAt: { type: Date, default: null },
  // Stamped by the daily sweep so lists and dashboards don't recompute it.
  isOverdue: { type: Boolean, default: false, index: true },
  // Set once per breach so the overdue alert is not re-sent every night.
  overdueNotifiedAt: { type: Date, default: null },
  dueSoonNotifiedAt: { type: Date, default: null },

  updates: { type: [updateSchema], default: [] },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, trim: true, default: '' },
}, { timestamps: true });

brActionSchema.index({ assignee: 1, status: 1 });
brActionSchema.index({ status: 1, dueDate: 1 });

// ── التكليف الفرعي ──────────────────────────────────────────────────────────
// A manager breaking their action down for their own team. One row per person,
// so "assign to more than one" is just more rows — and each person sees only
// their own.
const brAssignmentSchema = new mongoose.Schema({
  action: { type: mongoose.Schema.Types.ObjectId, ref: 'BrAction', required: true, index: true },
  // Snapshot of the parent action's headline ONLY. Never the meeting minutes —
  // an employee is told what to do, not what the board said about it.
  actionTitle: { type: String, trim: true, default: '' },
  department: { type: String, trim: true, default: '' },

  assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  assigneeName: { type: String, trim: true, default: '' },

  // The manager who delegated it — the employee's point of contact.
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  assignedByName: { type: String, trim: true, default: '' },

  // What THIS person has to do (may be narrower than the parent action).
  title: { type: String, required: true, trim: true },
  instructions: { type: String, trim: true, default: '' },

  dueDate: { type: Date, default: null, index: true },
  priority: { type: String, enum: PRIORITY_KEYS, default: 'medium' },
  status: { type: String, enum: ACTION_STATUS_KEYS, default: 'open', index: true },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  completedAt: { type: Date, default: null },

  isOverdue: { type: Boolean, default: false, index: true },
  overdueNotifiedAt: { type: Date, default: null },
  dueSoonNotifiedAt: { type: Date, default: null },

  updates: { type: [updateSchema], default: [] },
}, { timestamps: true });

brAssignmentSchema.index({ assignee: 1, status: 1 });
brAssignmentSchema.index({ action: 1, assignee: 1 });

module.exports = {
  BrMeeting: mongoose.models.BrMeeting || mongoose.model('BrMeeting', brMeetingSchema),
  BrAction: mongoose.models.BrAction || mongoose.model('BrAction', brActionSchema),
  BrAssignment: mongoose.models.BrAssignment || mongoose.model('BrAssignment', brAssignmentSchema),
};
