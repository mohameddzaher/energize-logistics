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
    // Actual first day on the job (تاريخ مباشرة العمل). Distinct from hireDate/
    // contract dates — survives contract renewals so we always know when the
    // employee actually started with us.
    actualWorkStartDate: { type: String }, // YYYY-MM-DD
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

    // ── Banking ──────────────────────────────────────────────────────────────
    iban: { type: String, trim: true },  // الايبان
    bank: { type: String, trim: true },  // البنك (RJHI / INMA / SNB ...)

    // ── Extra HR-sheet fields (Saudi payroll/compliance bookkeeping) ─────────
    fileStatus: { type: String, trim: true },        // حاله الملف (كامل ...)
    absherNumber: { type: String, trim: true },      // رقم ابشر (the number, distinct from absherStatus)
    companyNumber: { type: String, trim: true },     // رقم الشركه
    originCountryNumber: { type: String, trim: true }, // رقم دوله الأصل
    project: { type: String, trim: true },           // المشروع (امازون / هنقرستيشن / النقل الثقيل ...)
    registerNumber: { type: String, trim: true },    // رقم السجل التجاري (CR)
    systemStatus: { type: String, trim: true },      // حاله النظام (داخل النظام ...)
    workStatusText: { type: String, trim: true },    // حاله العمل كنص (يعمل / اجازة) — employmentStatus stays the enum
    penaltyClause: { type: Number, default: 0 },     // الشرط الجزائي
    iqamaProfession: { type: String, trim: true },   // المهنه في الاقامه
    classification: { type: String, trim: true },    // التصنيف

    // ── Contract columns mirrored from the HR master sheet ───────────────────
    // Reference text only — the Contract collection stays the source of truth.
    contractStatusText: { type: String, trim: true, default: '' },  // حاله العقد (ساري ...)
    contractStartDate: { type: String, default: '' },               // تاريخ الانشاء — YYYY-MM-DD
    contractEndDate: { type: String, default: '' },                 // تاريخ الانتهاء_2 — YYYY-MM-DD

    // Insurance
    insuranceCompany: { type: String, trim: true },  // شركه التامين
    insuranceExpiry: { type: String },               // تاريخ انتهاء التامين — YYYY-MM-DD
    socialInsuranceStatus: { type: String, trim: true }, // حاله التامينات الاجتماعيه (نشط ...)
    insuranceRequirements: { type: String, trim: true, default: '' },        // متطلبات التامين
    iqamaProfessionRequirements: { type: String, trim: true, default: '' },  // متطلبات المهنه في الاقامه

    // Visa
    visaExpiry: { type: String },                    // انتهاء التأشيرة — YYYY-MM-DD

    // Travel (latest known trip)
    lastTravelDate: { type: String },                // تاريخ السفر — YYYY-MM-DD
    lastReturnDate: { type: String },                // تاريخ الرجوع — YYYY-MM-DD

    // ── Driving / vehicle eligibility ────────────────────────────────────────
    vehiclePlate: { type: String, trim: true },      // المركبه — current plate (denormalized; authoritative link is VehicleAuthorization)
    licenseNumber: { type: String, trim: true },     // رقم رخصة القيادة
    licenseType: { type: String, trim: true },       // نوع الرخصه (نقل ثقيل / دراجة الية ...)
    licenseExpiry: { type: String },                 // انتهاء الرخصه — YYYY-MM-DD
    driverCardNumber: { type: String, trim: true },  // رقم كارت السائق
    driverCardType: { type: String, trim: true },    // نوع كارت السائق (سنوية ...)
    driverCardStatus: { type: String, trim: true },  // حاله كارت السائق
    driverCardExpiry: { type: String },              // انتهاء كارت السائق — YYYY-MM-DD
    workCard: { type: String, trim: true },          // كارت العمل
    ajeerStatus: { type: String, trim: true },       // حاله اجير
    ajeerExpiry: { type: String },                   // انتهاء اجير — YYYY-MM-DD

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
employeeSchema.index({ vehiclePlate: 1 });

module.exports = mongoose.model('Employee', employeeSchema);
