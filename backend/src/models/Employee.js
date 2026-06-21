const mongoose = require('mongoose');

// HR profile for a person who works at the company. This is SEPARATE from the
// login account (User): HR can register employees who have no login at all, and
// a User may later be linked to one of these records (Employee.user /
// User.linkedEmployee). Saudi-specific identity & government fields live here.
const employeeSchema = new mongoose.Schema(
  {
    // Identity
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    arabicName: { type: String, trim: true },
    employeeNumber: { type: String, trim: true }, // internal staff number
    gender: { type: String, enum: ['male', 'female', ''], default: '' },
    dateOfBirth: { type: String }, // YYYY-MM-DD
    nationality: { type: String, trim: true },
    photo: { type: String }, // url

    // Saudi identity / residence (iqama for expats, national id for citizens)
    idType: { type: String, enum: ['iqama', 'national_id'], default: 'iqama' },
    iqamaNumber: { type: String, trim: true },
    iqamaExpiry: { type: String }, // YYYY-MM-DD — drives expiry alerts
    nationalId: { type: String, trim: true },
    passportNumber: { type: String, trim: true },
    passportExpiry: { type: String }, // YYYY-MM-DD

    // Government platforms (tracking only — no live integration)
    qiwaContractNumber: { type: String, trim: true },
    gosiNumber: { type: String, trim: true },
    absherStatus: { type: String, trim: true },
    sponsorName: { type: String, trim: true }, // kafala / employer of record
    workPermitExpiry: { type: String }, // YYYY-MM-DD

    // Job
    jobTitle: { type: String, trim: true },
    department: { type: String, trim: true },
    hireDate: { type: String }, // YYYY-MM-DD
    workLocation: { type: String, trim: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    employmentStatus: {
      type: String,
      enum: ['active', 'on_leave', 'suspended', 'terminated'],
      default: 'active',
    },
    terminatedAt: { type: Date },
    terminationReason: { type: String, trim: true },

    // Contact
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    emergencyContactName: { type: String, trim: true },
    emergencyContactPhone: { type: String, trim: true },

    // Compensation snapshot (current contract is the source of truth; these are
    // convenience fields shown on the profile)
    basicSalary: { type: Number, default: 0 },
    allowances: { type: Number, default: 0 },

    // Links
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // login account, optional
    directManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Search & filter indexes. Search is by name / iqama / employee number / phone.
employeeSchema.index({ firstName: 1, lastName: 1 });
employeeSchema.index({ iqamaNumber: 1 });
employeeSchema.index({ nationalId: 1 });
employeeSchema.index({ employeeNumber: 1 });
employeeSchema.index({ employmentStatus: 1 });
employeeSchema.index({ user: 1 });
employeeSchema.index({ directManager: 1 });

module.exports = mongoose.model('Employee', employeeSchema);
