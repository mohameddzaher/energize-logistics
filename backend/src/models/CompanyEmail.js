const mongoose = require('mongoose');

/**
 * Company email: mailboxes created on Hostinger (@energize-logistics.com).
 * Not the system login. System accounts live in `User` with hashed passwords nobody can read. This is a mailbox created by hand on Hostinger for staff to email customers; IT must keep its password to hand over or configure the client. One person can have both, with unrelated passwords.
 * The employee link is optional on purpose: the mailbox is created on hire and the employee may not be in HR yet. It is stored unlinked and linked later.
 */
const companyEmailSchema = new mongoose.Schema({
  email: {
    type: String, required: true, unique: true, trim: true, lowercase: true, index: true,
  },
  localPart: { type: String, default: '', trim: true },   // Part before @
  domain: { type: String, default: 'energize-logistics.com', trim: true, lowercase: true, index: true },

  // Name as written in the mailing list (may be Arabic and abbreviated).
  displayName: { type: String, default: '', trim: true, index: true },

  // HR link (optional)
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
  employeeNumber: { type: String, default: '', trim: true, index: true }, // Snapshot at link time
  employeeName: { type: String, default: '', trim: true },
  // Typed by IT by hand; not read from the HR file.
  department: { type: String, default: '', trim: true, index: true },

  // Personal (employee) or functional (info@ / sales@, not a specific person).
  mailboxType: { type: String, enum: ['personal', 'functional'], default: 'personal', index: true },
  functionAr: { type: String, default: '', trim: true },  // Mailbox function when functional

  status: { type: String, enum: ['active', 'suspended', 'closed'], default: 'active', index: true },

  // Password.
  // Encrypted with AES-256-GCM (utils/secretVault); it must be recoverable because IT hands it to the employee, so a hash would not work. `select: false` so ordinary queries never return it by mistake.
  passwordEnc: { type: String, default: '', select: false },
  passwordSetAt: { type: Date, default: null },
  passwordSetByName: { type: String, default: '', trim: true },

  notes: { type: String, default: '', trim: true },
  createdByName: { type: String, default: '', trim: true },
  updatedByName: { type: String, default: '', trim: true },

  // Who viewed the password and when; viewing is a logged event, not an ordinary query.
  lastRevealedAt: { type: Date, default: null },
  lastRevealedByName: { type: String, default: '', trim: true },
  revealCount: { type: Number, default: 0 },
}, { timestamps: true });

companyEmailSchema.index({ displayName: 1, email: 1 });
companyEmailSchema.index({ employee: 1, status: 1 });

// Domain and local part are derived from the email and computed once here so callers do not each split the string and diverge.
companyEmailSchema.pre('save', function normalise(next) {
  if (this.email) {
    this.email = String(this.email).trim().toLowerCase();
    const at = this.email.lastIndexOf('@');
    if (at > 0) {
      this.localPart = this.email.slice(0, at);
      this.domain = this.email.slice(at + 1);
    }
  }
  next();
});

module.exports = mongoose.models.CompanyEmail || mongoose.model('CompanyEmail', companyEmailSchema);
