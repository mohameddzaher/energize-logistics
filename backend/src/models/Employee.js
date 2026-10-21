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
    // ── الفئةُ الوظيفيّة: إداري · سائق · فني (صاحبُ الشركة، ٢٠٢٦/١٠/١٩) ──────────
    // لموظّفي B2C والنقل الثقيل وحدَهم — قسمان فيهما الثلاثة معًا، ويُسأل «كم إداريًّا
    // في النقل الثقيل؟». من قائمةٍ مغلقة (utils/hrLists ← hr_staff_category).
    staffCategory: { type: String, trim: true, default: '', index: true },
    // ── حالتُه اليومَ في قسم الأفراد (B2C) — لقطةٌ للقراءة لا تُكتب هنا ──────────
    // إجازة · موقوف · حادث (فراغ = يعمل) تُكتب في «موظفو النقل الخفيف» وحدَه
    // (`LightTransportEmployee.opStatus`) وتُنسَخ هنا كي تراها الموارد البشريّة في
    // الملفّ والقائمة (صاحبُ الشركة، ٢٠٢٦/١٠/٢١). لا تمسّ حالةَ التوظيف ولا تُنشئ إجازة.
    b2cOpStatus: { type: String, enum: ['', 'leave', 'suspended', 'accident'], default: '' },
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
    /**
     * «لا يعمل» = إنهاءُ الخدمة، وله حالةٌ من ثلاث (صاحبُ الشركة، ٢٠٢٦/١٠/١٩):
     *   transfer_pending  انتظار نقل الكفالة — شهرٌ تُنبَّه فيه الموارد البشريّة
     *                     كلَّ يومٍ لإخراجه من النظام (فيذهب إلى الأرشيف)
     *   sister_company    شركة شقيقة (داخل النظام)
     *   final_exit        خروج نهائي (داخل النظام)
     * راجع utils/hrEngagement (TERMINATION_KINDS) و jobs/hrTransferAlerts.
     */
    terminationKind: { type: String, enum: ['transfer_pending', 'sister_company', 'final_exit', ''], default: '' },
    transferDeadline: { type: Date, default: null },
    // «شركة شقيقة» — حالةُ عملٍ لا إنهاءُ خدمة: موظّفٌ قائمٌ على كفالتنا يعمل لدى
    // شركةٍ شقيقة، ويُعامَل في كلّ قسمٍ كموظّفٍ عاديّ. راجع utils/hrEngagement.
    sisterCompany: { type: Boolean, default: false, index: true },
    // آخرُ نافذةِ تنبيهٍ أُرسلت (اليوم + صباحًا/مساءً) — يمنع عاملَي الخادم من التكرار.
    transferAlertKey: { type: String, default: '' },

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
    // المركبه — لقطةٌ مشتقّةٌ لا تُكتب باليد: لوحاتُ ما يحمله في سجلّ المركبات
    // (`VehicleMaster.authorizedPerson`)، يكتبها utils/vehicleAuthorization.refreshPlateSnapshot
    // وحدَه بعد كلّ تفويضٍ أو نقلٍ أو تغيير لوحة. استمارةُ الموارد البشريّة تعرضها ولا تقبلها.
    vehiclePlate: { type: String, trim: true },
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
    // ── نوعُ الارتباط: على كفالتنا أم عملٌ حرّ ────────────────────────────
    //
    // كان `isFreelancer` منطقيًّا (نعم/لا). والمنطقيُّ لا يحتمل نوعًا ثالثًا
    // يظهر غدًا (منتدَب، متعاقد مع مورّد…)، ولا يُدار من إعدادات القسم.
    // فصار الحقلُ مفتاحَ قائمةٍ تُدار من «القوائم المنسدلة»، ويبقى
    // `isFreelancer` مرآةً له لأنّ عليه تقوم عدّاداتٌ قائمة — تُكتب الاثنتان
    // معًا فلا يفترقان. راجع utils/employmentType.
    employmentType: { type: String, trim: true, default: '', index: true },
    iqamaIssueDate: { type: Date, default: null },
    iqamaExpiryHijri: { type: String, trim: true, default: '' },
    contractOccupation: { type: String, trim: true, default: '' },
    insuranceClass: { type: String, trim: true, default: '' },
    // ── التأمينُ الطبّيّ ─────────────────────────────────────────────────────
    // رقمُ الوثيقة عند شركة التأمين والسجلُّ المسجَّل تحته. يُسألان عند كلّ
    // مراجعةٍ أو تجديد، وكانا خارجَ الملفّ فيُبحث عنهما في شيتٍ منفصل.
    medicalInsuranceNumber: { type: String, trim: true, default: '' },
    medicalInsuranceRegister: { type: String, trim: true, default: '' },
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
    // ── من أين أُنشئ الملفّ ─────────────────────────────────────────────────
    // قسمُ الأفراد يضيف موظّفَه من سجلّ النقل الخفيف ببياناتٍ قليلة (الاسم
    // والإقامة والمشروع…)، والموارد البشريّة تُكمل الباقي. فيُعلَّم الملفُّ
    // بمصدره (`b2c`) لتجد الموارد البشريّة ما أُضيف من هناك بضغطة.
    createdVia: { type: String, trim: true, default: '', index: true },
    // ── وهل علمت به الموارد البشريّة؟ ───────────────────────────────────────
    // الزرُّ «موظفون جدد من قسم الأفراد» تنبيهٌ لا سجلّ: يقول «أُنشئ ملفٌّ فانتبهوا».
    // فمتى عدّلت الموارد البشريّة أيَّ شيءٍ في الملفّ فقد علمت، ويخرج من التنبيه
    // وحدَه — بلا زرّ «تمّت المراجعة» يُنسى. يُرفَع في خطّاف الحفظ أدناه.
    hrPending: { type: Boolean, default: false, index: true },

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
/**
 * ── رقمُ الهويّة يبقى في العمودين ─────────────────────────────────────────────
 *
 * السعوديُّ رقمُه في `nationalId` والمقيمُ في `iqamaNumber`، وهذا صحيحٌ في
 * المعنى. لكنّ الشاشات كلَّها تقرأ `iqamaNumber` — الجداولُ والتصديراتُ
 * وقوائمُ الاختيار — لأنّه في الواقع «رقمُ هويّة هذا الشخص» أيًّا كان نوعُها؛
 * واثنتان وخمسون من أربعٍ وخمسين بطاقةَ سعوديٍّ تحمله فيه أصلًا.
 *
 * فكانت النتيجةُ صفًّا يقول «لا يوجد» عن رقمٍ مكتوبٍ في ملفّ صاحبه، ويُعَدُّ
 * نقصًا يُطالَب بجمعه. والقراءةُ المزدوجة في `config/hrFields` تصلح الماستر،
 * لكنّها لا تصل إلى عشرين شاشةً أخرى تقرأ العمود مباشرة.
 *
 * فيُنسَخ رقمُ السعوديّ إلى `iqamaNumber` عند الحفظ. لا يُنسخ العكس: رقمُ
 * الإقامة ليس رقمًا وطنيًّا، وكتابتُه في `nationalId` تجعل مقيمًا يبدو سعوديًّا.
 */
employeeSchema.pre('save', function mirrorNationalId(next) {
  if (this.idType === 'national_id') {
    const nid = String(this.nationalId || '').trim();
    if (nid && String(this.iqamaNumber || '').trim() !== nid) this.iqamaNumber = nid;
  }
  next();
});

// ── اسمُ الفرع نصًّا يُملأ من الفرع المختار ─────────────────────────────────
// الماستر يفلتر ويجمع بـ`branchName` (نصُّ ملفّ الاستيراد)، واستمارةُ الموظّف
// تختار `branch` معرّفًا ولا تكتب النصّ — فمن أُضيف في النظام يقع تحت «—».
employeeSchema.pre('save', async function fillBranchName(next) {
  try {
    if (this.branch && !String(this.branchName || '').trim()
      && (this.isNew || this.isModified('branch'))) {
      const b = await mongoose.model('Branch').findById(this.branch).select('name').lean();
      if (b?.name) this.branchName = b.name;
    }
  } catch (_) { /* لا يُفشل الحفظ */ }
  next();
});

// ── موظّفٌ جديد: مستنداتُه الفارغةُ «مطلوبة» حتّى يُقال غيرُ ذلك ────────────
// كانت الخانةُ الفارغةُ عند من أُضيف في النظام تُقرأ «لا يوجد»، فلا يدخل عدّادَ
// «المطلوب» ولا شاشاتِ الانتهاء — و«مطلوب» لم يكن يكتبها إلّا الاستيراد. فيُعلَّم
// كلُّ حقلٍ من حقول المستندات فارغٍ بلا حالة «مطلوبًا» عند الإنشاء، ومن لا
// يحتاجه يختار «غير مطلوب» من الاستمارة أو الماستر.
//
// ولا يُعلَّم ما لا ينطبق أصلًا: السعوديّ لا إقامةَ له ولا رخصةَ عمل، والتاريخُ
// الهجريُّ مشتقٌّ لا يُكتب. وحساباتُ الدخول التلقائيّة ليست موظّفين.
employeeSchema.pre('save', function defaultRequiredDocs(next) {
  try {
    if (!this.isNew || this.isHrRecord === false) return next();
    const H = require('../config/hrFields');
    const saudi = this.idType === 'national_id';
    const skipGroups = new Set(saudi ? ['iqama', 'workPermit'] : []);
    if (!this.fieldStatus || typeof this.fieldStatus.set !== 'function') this.fieldStatus = new Map();
    const empty = (v) => v === null || v === undefined || v === '' || (v instanceof Date && isNaN(v));
    for (const g of H.DOCUMENT_GROUPS) {
      // التأشيرةُ وأجير لا يحملهما كلُّ موظّف (`optional`) — لا تُطلَب من الجميع.
      if (skipGroups.has(g.key) || g.optional) continue;
      for (const f of g.fields) {
        if (/Hijri$/.test(f.key) || f.optional || f.readOnly) continue;
        const sk = H.statusKeyOf(f.key);
        if (this.fieldStatus.get(sk)) continue;
        if (empty(H.valueOf(this, f.key))) this.fieldStatus.set(sk, 'required');
      }
    }
  } catch (_) { /* لا يُفشل الإنشاء */ }
  next();
});

employeeSchema.pre('save', function clearSatisfiedStatuses(next) {
  if (!this.fieldStatus || typeof this.fieldStatus.forEach !== 'function') return next();
  const filled = (v) => !(v === null || v === undefined || v === '' || (v instanceof Date && isNaN(v)));
  for (const [statusKey, code] of [...this.fieldStatus.entries()]) {
    // «غير مطلوب» قرار إداري — مش بيتشال لمجرد إن حد كتب حاجة. أمّا «غير نشط»
    // فحالُ الخانة لا قرار: كتابةُ شركة تأمينٍ من جديد تعني أنّه صار نشطًا.
    if (code !== 'required' && code !== 'inactive') continue;
    const fieldKey = statusKey.replace(/Status$/, '');
    if (filled(this.get(fieldKey))) this.fieldStatus.delete(statusKey);
  }
  next();
});

/**
 * ── وخاناتُ العقد تُكتب في العقد نفسِه ──────────────────────────────────────
 * نهايةُ العقد وبدايتُه ورقمُه صورةٌ من العقد الساري (راجع utils/contractStatus).
 * فمن عدّلها هنا — من الماستر، أو «تجديد» في صفحة الانتهاءات، أو تجديدٍ جماعيّ —
 * يُكتب تعديلُه في العقد، وإلّا عرضت الانتهاءاتُ تاريخًا وتبويبُ العقود آخر.
 *
 * وهو خطّافٌ على الحفظ لا سطرٌ في كلّ متحكِّم: أبوابُ التعديل أربعةٌ اليوم
 * وتزيد، ومن ينسى السطرَ يعيد العطبَ صامتًا. والمزامنةُ من العقد تكتب
 * بـ`updateOne` فلا تمرّ من هنا — فلا دوران.
 */
// أيُّ حفظٍ لملفٍّ قائمٍ هو يدُ الموارد البشريّة عليه (قسمُ الأفراد يكتب في سجلّه
// هو، لا هنا) — فيُرفَع التنبيه. راجع `hrPending`.
employeeSchema.pre('save', function clearHrPending(next) {
  if (!this.isNew && this.hrPending && this.modifiedPaths().some((p) => p !== 'hrPending' && p !== 'updatedAt')) this.hrPending = false;
  next();
});

const CONTRACT_MIRROR = ['contractStartDate', 'contractEndDate', 'qiwaContractNumber'];
employeeSchema.pre('save', function noteContractFields(next) {
  if (!this.isNew) {
    const changed = CONTRACT_MIRROR.filter((k) => this.isModified(k));
    if (changed.length) this.$locals.contractFields = Object.fromEntries(changed.map((k) => [k, this[k]]));
  }
  next();
});
employeeSchema.post('save', async function pushContractFields(doc) {
  const fields = doc.$locals && doc.$locals.contractFields;
  if (!fields) return;
  doc.$locals.contractFields = null;
  try { await require('../utils/contractStatus').pushEmployeeContractFields(doc._id, fields); }
  catch (e) { console.error('employee → contract:', e.message); }
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

// ── رقمُ الهويّة مفتاحُ الربط مع المركبات و B2C — فإن صُحِّح هنا صُحِّح هناك ──
// ورقةُ التفويض على المركبة (`VehicleMaster.authorizedPerson.iqamaNumber`)،
// والقائدُ الفعليّ، وبطاقةُ السائق، وصفُّ النقل الخفيف — كلُّها تعرف الموظّفَ
// برقم هويّته. فتصحيحُ الرقم في الموارد البشريّة وحدَها يقطع الربط: يختفي
// تفويضُه من ملفّه ومن إخلاء طرفه، ويبقى على المركبة رقمٌ لا يعرفه أحد.
// راجع utils/employeeIdentitySync.
//
// ── وبياناتُ الشخص تتبعه كذلك (الاسم · الجوال · الجنسيّة · المشروع · القسم · حالة
// التوظيف): نسخُها في النقل الخفيف وبطاقة السائق وورقة التفويض والقائد الفعليّ
// تُكتب من هنا — الرقمُ أوّلًا ثمّ البيانات، فتُطابَق النسخُ بالرقم الجديد.
// راجع utils/employeeIdentitySync.pushPersonChange و utils/personRef.
employeeSchema.post('init', function () {
  this.$locals.idsAtLoad = [this.iqamaNumber, this.nationalId].map((x) => String(x || '').trim());
  this.$locals.personAtLoad = require('../utils/employeeIdentitySync').personSnapshot(this);
});
employeeSchema.pre('save', function (next) {
  this.$locals.wasNew = this.isNew;
  next();
});
employeeSchema.post('save', async function (doc) {
  const sync = require('../utils/employeeIdentitySync');
  const before = doc.$locals && doc.$locals.idsAtLoad;
  const now = [doc.iqamaNumber, doc.nationalId].map((x) => String(x || '').trim());
  if (before && (before[0] !== now[0] || before[1] !== now[1])) {
    doc.$locals.idsAtLoad = now;
    try { await sync.pushIdChange(doc, before, now); }
    catch (e) { console.error('employee id → vehicles/b2c:', e.message); }
  }
  // حسابُ دخولٍ تلقائيّ ليس شخصًا في الموارد البشريّة — لا يكتب في نسخ أحد.
  if (doc.isHrRecord === false) return;
  const pBefore = doc.$locals && doc.$locals.personAtLoad;
  const pNow = sync.personSnapshot(doc);
  // ملفٌّ جديد: قد تكون له نسخٌ قائمةٌ برقم هويّته (أنشأه قسمُ الأفراد من صفّه).
  const fields = pBefore ? sync.changedPersonFields(pBefore, pNow) : (doc.$locals && doc.$locals.wasNew ? sync.COPIED_FIELDS : []);
  if (doc.$locals) doc.$locals.personAtLoad = pNow;
  if (!fields.length) return;
  try { await sync.pushPersonChange(doc, { fields }); }
  catch (e) { console.error('employee person → copies:', e.message); }
});
// والكتابةُ بالاستعلام (`updateOne`/`updateMany`/`findOneAndUpdate`) لا تمرّ بالحفظ:
// توحيدُ قوائم الجنسيّة والقسم والمشروع، ومزامنةُ المشروع من قسم الأفراد. فتُحفَظ
// معرّفاتُ مَن تمسّه قبل الكتابة، ثمّ تُدفَع بياناتُه بعدها.
const touchedPersonFields = (update) => {
  if (!update) return [];
  const keys = [];
  for (const [k, v] of Object.entries(update)) {
    if (k.startsWith('$') && v && typeof v === 'object') keys.push(...Object.keys(v));
    else keys.push(k);
  }
  const { PERSON_FIELDS } = require('../utils/employeeIdentitySync');
  return PERSON_FIELDS.filter((f) => keys.includes(f));
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate']) {
  employeeSchema.pre(op, async function () {
    const fields = touchedPersonFields(this.getUpdate());
    if (!fields.length || this.getOptions().skipPersonSync) return;
    this._personFields = fields;
    this._personIds = await this.model.find(this.getFilter()).distinct('_id');
  });
  employeeSchema.post(op, async function () {
    const ids = this._personIds || [];
    if (!ids.length) return;
    const sync = require('../utils/employeeIdentitySync');
    try {
      const rows = await this.model.find({ _id: { $in: ids }, isHrRecord: { $ne: false } }).lean();
      for (const e of rows) await sync.pushPersonChange(e, { fields: this._personFields, emit: false }); // eslint-disable-line no-await-in-loop
      if (rows.length) sync.announcePerson(rows[0]);
    } catch (e) { console.error('employee person → copies (query):', e.message); }
  });
}

// ── والفئةُ الوظيفيّة تسقط إذا خرج الموظّفُ من قسميها (B2C · النقل الثقيل) ──
employeeSchema.pre('save', async function () {
  if (!this.isModified('department') || !this.staffCategory) return;
  try {
    const deps = await require('../utils/hrLists').categoryDepartments();
    if (!deps.includes(String(this.department || '').trim())) this.staffCategory = '';
  } catch (_) { /* */ }
});

module.exports = mongoose.model('Employee', employeeSchema);
