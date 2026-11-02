/**
 * Work plan (JP): tasks and projects that run a department's daily work.
 * Two scopes, one model: `section` (inside the department, the manager assigns to staff) and `management` (senior management to department managers). Same rules and screen; only who is manager and who is team differ.
 * Task vs request: what a manager assigns is a task; what an employee writes for himself or a colleague is a request, not an assignment by an authority, counted and read separately. The server decides the kind from the author; the screen cannot send it.
 * Deadline is optional, as a day or as hours; stored as one instant (`deadlineAt`) lateness is measured on, plus how it was stated so it displays as stated.
 */
const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
  fileUrl: { type: String, required: true },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  // Assignment attachment (from the assigner) or completion attachment (from the executor).
  phase: { type: String, enum: ['brief', 'done'], default: 'brief' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedByName: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now },
});

const SCOPES = ['section', 'management'];
// Contact method when the task is to contact someone.
const ACTIONS = ['', 'call', 'whatsapp', 'visit', 'email', 'meeting', 'other'];

const jpProjectSchema = new mongoose.Schema({
  scope: { type: String, enum: SCOPES, required: true },
  section: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, default: '', maxlength: 2000 },
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  status: { type: String, enum: ['active', 'closed'], default: 'active' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // A department project born from a project that senior management assigned to its manager; see parentTask.
  parentProject: { type: mongoose.Schema.Types.ObjectId, ref: 'JpProject', default: null },
}, { timestamps: true });
jpProjectSchema.index({ scope: 1, section: 1, status: 1 });

const jpTaskSchema = new mongoose.Schema({
  scope: { type: String, enum: SCOPES, required: true },
  section: { type: String, required: true, trim: true },
  kind: { type: String, enum: ['task', 'request'], required: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'JpProject', default: null },

  title: { type: String, required: true, trim: true, maxlength: 200 },
  details: { type: String, trim: true, default: '', maxlength: 4000 },
  action: { type: String, enum: ACTIONS, default: '' },
  // Who to contact: a name or number, as the manager writes it.
  contact: { type: String, trim: true, default: '', maxlength: 200 },

  // Empty for an HR employee with no login: `assignedEmployee` and `assigneeName` name them.
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignedEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  assigneeName: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  deadlineKind: { type: String, enum: ['', 'date', 'hours'], default: '' },
  deadlineHours: { type: Number, default: null },
  deadlineAt: { type: Date, default: null },

  // Completion is optional: the task stays open until its owner says it is done.
  status: { type: String, enum: ['open', 'done'], default: 'open' },
  doneAt: { type: Date, default: null },
  doneBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  doneNote: { type: String, trim: true, default: '', maxlength: 2000 },

  attachments: [attachmentSchema],

  /** Work day and expected time. The day is the one the task counts in on the team's daily view (midnight Riyadh time); time is in minutes. Both optional: a task without a day counts on its creation day. */
  workDate: { type: Date, default: null },
  expectedMinutes: { type: Number, default: null, min: 0 },

  /** Progress. `status` stays open or done. While open it is one of three: not started, running (timer on), paused. Running always means a timer is counting, never without time being measured. */
  progress: { type: String, enum: ['todo', 'doing', 'paused'], default: 'todo' },
  timerStartedAt: { type: Date, default: null },

  /** Actual time. Each work period is a row: from start to stop (`timer`), or a manager correction of minutes added or subtracted on a given day (`adjust`). The daily view splits a period across its days, so work past midnight counts in both. `spentMinutes` is the sum of all rows, recomputed on every save. */
  timeLog: [{
    kind: { type: String, enum: ['timer', 'adjust'], required: true },
    start: { type: Date, default: null },
    end: { type: Date, default: null },
    day: { type: String, default: '' },          // YYYY-MM-DD, for adjustments only.
    minutes: { type: Number, required: true },
    note: { type: String, trim: true, default: '', maxlength: 500 },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  }],
  spentMinutes: { type: Number, default: 0 },

  // Comments: a question or news about the task is written on it, not in a chat outside the system. Written by the assignee, the assigner and the department manager.
  comments: [{
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, default: '' },
    text: { type: String, trim: true, required: true, maxlength: 2000 },
    at: { type: Date, default: Date.now },
  }],

  /** What the task relates to. A follow-up task on a transport invoice only makes sense with its transaction, and contact the customer with its customer. So a task links to what it concerns (transaction, customer, shipping agent or carrier), opens from it and is read there. Allowed kinds per department are in controllers/jpController (LINK_KINDS); the name is captured at link time to display without another read. */
  links: [{
    _id: false,
    kind: { type: String, required: true },
    ref: { type: mongoose.Schema.Types.ObjectId, required: true },
    label: { type: String, trim: true, default: '' },
  }],

  // A task handed down from senior management: the department manager assigns what he was given to one of his staff, which creates a normal department task in his own name, and this link ties it to its origin. It is never exposed to the employee, who sees only a task from his manager; the link is for the manager and management to see its progress.
  parentTask: { type: mongoose.Schema.Types.ObjectId, ref: 'JpTask', default: null, index: true },
}, { timestamps: true });
jpTaskSchema.index({ scope: 1, section: 1, status: 1, deadlineAt: 1 });
jpTaskSchema.index({ assignedTo: 1, status: 1 });
jpTaskSchema.index({ createdBy: 1 });
jpTaskSchema.index({ project: 1 });
jpTaskSchema.index({ 'links.ref': 1 });
jpTaskSchema.index({ scope: 1, section: 1, workDate: 1 });
jpTaskSchema.index({ assignedTo: 1, timerStartedAt: 1 });

// Total follows the rows; not typed by hand, or it would differ from them.
jpTaskSchema.pre('save', function sumTime(next) {
  if (this.isModified('timeLog')) {
    this.spentMinutes = Math.max(0, Math.round((this.timeLog || []).reduce((s, x) => s + (Number(x.minutes) || 0), 0) * 10) / 10);
  }
  next();
});

const JpProject = mongoose.models.JpProject || mongoose.model('JpProject', jpProjectSchema);
const JpTask = mongoose.models.JpTask || mongoose.model('JpTask', jpTaskSchema);

module.exports = { JpProject, JpTask, SCOPES, ACTIONS };
