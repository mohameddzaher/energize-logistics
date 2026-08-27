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
    // الفرع الأساسي — الذي يُنسَب إليه الموظف في التقارير والرواتب.
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    // ── ولماذا فروعٌ أخرى ─────────────────────────────────────────────────────
    // موظّفون يعملون على أكثر من فرع فعلًا (سائق يخدم جدة ومكة، ومشرف يغطّي
    // فرعين). حصرُه في فرع واحد كان يجبر الإدارة على اختيار أحدهما، فيختفي من
    // قوائم الفرع الآخر وكأنه ليس منه. الأساسي يبقى واحدًا للتقارير، وهذه
    // الفروع الإضافية تجعله يظهر ويُختار في الفرعين معًا.
    branches: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }], default: [], index: true },
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
    // ── ولماذا نصٌّ لا رقم ─────────────────────────────────────────────────────
    // لوحة الفلترة ترسل قيمها نصًّا، و$in على حقلٍ رقميٍّ لا يطابق «٢١» أبدًا
    // فتعود الشاشة فارغة بلا خطأ يُنبِّه. الرقم المُلزِم يبقى في وثيقة العقد
    // (Contract.annualLeaveDays) وعليه يقوم حساب رصيد الإجازات؛ وهذا لقطةٌ منه.
    annualLeaveDays: { type: String, trim: true, default: '' },      // الاجازه السنوية
    probationPeriod: { type: String, trim: true, default: '' },      // فترة التجربة

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

    // ── حقول ماستر الموارد البشرية v2.0 ────────────────────────────────────
    companyEmail: { type: String, trim: true, default: '' },
    employerNumber: { type: String, trim: true, default: '' },
    directManagerName: { type: String, trim: true, default: '' }, // لقطة الاسم من الماستر
    // `branch` فوق هي ObjectId لسجل الفرع. الماستر بيدّي اسم الفرع نصًا («جدة»)
    // ومش دايمًا ليه سجل عندنا، فبيتخزّن هنا. الاتنين مش بديل لبعض.
    branchName: { type: String, trim: true, default: '', index: true },
    isOutsideKingdom: { type: Boolean, default: false, index: true },
    isFreelancer: { type: Boolean, default: false, index: true },
    iqamaIssueDate: { type: Date, default: null },
    iqamaExpiryHijri: { type: String, trim: true, default: '' },
    contractOccupation: { type: String, trim: true, default: '' },
    insuranceClass: { type: String, trim: true, default: '' },
    healthCertNumber: { type: String, trim: true, default: '' },
    healthCertExpiry: { type: Date, default: null, index: true },

    // ── حالة كل حقل: مطلوب / غير مطلوب / لا يوجد ───────────────────────────
    // Map مفتوحة عشان إضافة حقل في config/hrFields.js ما تحتاجش تعديل هنا.
    // «مطلوب» معناها ناقص ولازم التيم يجمّعه، و«غير مطلوب» معناها مش بينطبق
    // على الموظف ده — الاتنين لازم يفضلوا مفصولين، وإلا قايمة شغل الموارد
    // البشرية بتبقى فيها ناس مالهمش دعوة.
    // بتتشال أوتوماتيك أول ما الحقل يتملي (pre-save تحت).
    fieldStatus: { type: Map, of: String, default: {} },

    // هل ده سجل موارد بشرية أصلاً؟
    // إنشاء حساب دخول بيعمل سجل موظف تلقائي (utils/ensureSelfEmployee) — وده
    // **مش موظف**. يوزر على السيستم ≠ موظف؛ بيبقى موظف لما يتربط بسجل حقيقي.
    // بيتعلّم false للسجلات دي فتخرج من عدّادات القسم وتفضل موجودة عشان الحساب
    // المربوط بيها يفضل شغّال.
    isHrRecord: { type: Boolean, default: true, index: true },

    // هل الموظف ده في ملف الماستر الحالي؟
    // ٣٧٨ صف في الماستر = الملف الوظيفي الحالي (منهم ٣٢١ على رأس العمل والباقي
    // إجازة/خروج نهائي/لا يعمل). واللي مش فيه خرج قبل كده وسجله محفوظ كتاريخ.
    // الفرق ده لازم يفضل واضح، وإلا «عدد الموظفين» بيبقى رقم مالوش معنى.
    inCurrentMaster: { type: Boolean, default: false, index: true },

    // ── متى لمسَ الاستيرادُ هذا السجلّ آخرَ مرّة ───────────────────────────────
    // الشيت لقطةٌ من ورق، ومَن فتح الشاشة بعده كان ينظر إلى الموظّف نفسه. فبمقارنة
    // `updatedAt` بهذا التاريخ يُعرَف أنّ إنسانًا كتب بعد آخر استيراد، فلا تمحو
    // خانةٌ فارغة في الشيت ما كتبه. (نفس قاعدة a348299b في قسم المركبات.)
    lastImportAt: { type: Date, default: null },

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Search & filter indexes. Search is by name / iqama / employee number / phone.
/**
 * أول ما حقل يتملي، حالته «مطلوب» بتتشال لوحدها.
 *
 * ده اللي بيخلّي عدّاد «مطلوب» في الداشبورد صادق: من غيره، الموارد البشرية
 * تملي البيانات والرقم يفضل مكانه، فيفضلوا بيدوّروا على شغل خلص. القرار إنه
 * يحصل هنا مش في الكونترولر عشان يشتغل مهما كان مصدر التعديل — الشاشة، أو
 * الاستيراد، أو أي سكربت.
 */
employeeSchema.pre('save', function clearSatisfiedStatuses(next) {
  if (!this.fieldStatus || typeof this.fieldStatus.forEach !== 'function') return next();
  const filled = (v) => !(v === null || v === undefined || v === '' || (v instanceof Date && isNaN(v)));
  for (const [statusKey, code] of [...this.fieldStatus.entries()]) {
    // «غير مطلوب» قرار إداري — مش بيتشال لمجرد إن حد كتب حاجة.
    if (code !== 'required') continue;
    const fieldKey = statusKey.replace(/Status$/, '');
    if (filled(this.get(fieldKey))) this.fieldStatus.delete(statusKey);
  }
  next();
});

employeeSchema.index({ firstName: 1, lastName: 1 });
employeeSchema.index({ iqamaNumber: 1 });
employeeSchema.index({ nationalId: 1 });
employeeSchema.index({ employeeNumber: 1 });
employeeSchema.index({ employmentStatus: 1 });
// The employees list sorts by createdAt (optionally filtered by status) — index
// it so a busy office doesn't pay an in-memory sort of the whole collection.
employeeSchema.index({ createdAt: -1 });
employeeSchema.index({ employmentStatus: 1, createdAt: -1 });
employeeSchema.index({ user: 1 });

// Any employee write clears the cached list so edits/new hires/terminations show
// immediately (the list is cached ~30s to survive concurrent office-wide loads).
employeeSchema.post('save', function () {
  try { require('../utils/ttlCache').clear('hr:employees'); } catch (e) { /* noop */ }
});
employeeSchema.index({ directManager: 1 });
employeeSchema.index({ vehiclePlate: 1 });

module.exports = mongoose.model('Employee', employeeSchema);
