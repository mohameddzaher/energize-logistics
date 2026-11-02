const mongoose = require('mongoose');

/**
 * A request from a section to HR about staff status. HR status is the truth sections build on and it lags the field (a rep returns today, HR hears days later), so the section that sees it reports who returned, who did not, or any other request; names are optional.
 * Unlike `SectionWork` (inside one section), this crosses sections, with a sender, receiver and mandatory reply: received, then done or rejected WITH a written reason.
 * A reply can be partial, so each name has its own decision and text.
 */
const SECTIONS = ['B2C', 'Light Transport', 'Fleet Management', 'Operations', 'Location Solutions',
  'Vehicles', 'Customs', 'Collections', 'Workshop', 'Other'];

const KINDS = [
  'back_to_work',   // Returned to work
  'service_ended',  // Did not return / service ended
  'on_leave',       // On leave
  'data_fix',       // Data correction
  'other',
];

const subjectSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  // Snapshot stays even if the name changes later; the request is a document read months after.
  name: { type: String, trim: true, default: '' },
  employeeNumber: { type: String, trim: true, default: '' },
  note: { type: String, trim: true, default: '' },
  // HR's decision on this name alone.
  decision: { type: String, enum: ['pending', 'done', 'rejected'], default: 'pending' },
  decisionNote: { type: String, trim: true, default: '' },
  decidedAt: { type: Date, default: null },
}, { _id: true });

const staffStatusRequestSchema = new mongoose.Schema({
  number: { type: Number, index: true },            // Sequence number quoted in conversation
  section: { type: String, enum: SECTIONS, default: 'B2C', index: true },
  kind: { type: String, enum: KINDS, default: 'back_to_work', index: true },
  title: { type: String, trim: true, default: '' },
  body: { type: String, trim: true, default: '' },

  subjects: [subjectSchema],

  // `new` until received, then `received`, then `done` or `rejected`.
  status: { type: String, enum: ['new', 'received', 'done', 'rejected'], default: 'new', index: true },
  // Rejecting the whole request requires a reason; guarded in the controller.
  decisionNote: { type: String, trim: true, default: '' },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, trim: true, default: '' },
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  receivedByName: { type: String, trim: true, default: '' },
  receivedAt: { type: Date, default: null },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedByName: { type: String, trim: true, default: '' },
  decidedAt: { type: Date, default: null },
}, { timestamps: true });

staffStatusRequestSchema.index({ status: 1, createdAt: -1 });
staffStatusRequestSchema.index({ section: 1, createdAt: -1 });

module.exports = mongoose.models.StaffStatusRequest
  || mongoose.model('StaffStatusRequest', staffStatusRequestSchema);
module.exports.SECTIONS = SECTIONS;
module.exports.KINDS = KINDS;
