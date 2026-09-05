const mongoose = require('mongoose');

const operationsWorkflowSchema = new mongoose.Schema(
  {
    // ══════════════════════════════════════════════════════════
    // PRIMARY FIELD — رقم الكشف (Report Number)
    // ══════════════════════════════════════════════════════════
    reportNumber: { type: String, unique: true },

    // ══════════════════════════════════════════════════════════
    // GROUP 1: Application Columns (Moderator) — 14 fields
    // ══════════════════════════════════════════════════════════
    reportDate: { type: Date },                              // تاريخ الكشف
    fromLocation: { type: String, trim: true },              // من
    toLocation: { type: String, trim: true },                // الي
    branch: { type: String, trim: true },                    // الفرع
    carOwner: { type: String, trim: true },                  // مالك السياره
    carNumber: { type: String, trim: true },                 // رقم السياره
    ownerType: { type: String, trim: true },                 // نوع المالك
    executionStatus: { type: String, trim: true },           // حاله التنفيذ
    applicationStatus: { type: String, trim: true },         // حاله الابلكيشن
    paymentMethod: { type: String, trim: true },             // طريقه الدفع
    username: { type: String, trim: true },                  // اسم المستخدم
    taxIndicator: { type: String, trim: true },              // ض / غ ض
    purchaseValue: { type: Number, default: 0 },             // قيمه الشراء
    sellingValue: { type: Number, default: 0 },

    // ── ومن أين جاءت قيمةُ البيع ──────────────────────────────────────────────
    //
    // `sellingValue` تُكتب من منصّة التشغيل في كلّ مزامنة. فتصحيحُها باليد لا
    // يعيش دقائق: كُتبت قيمُ سبعةٍ وأربعين كشفًا نقديًّا من دفتر التحصيل فأعادتها
    // المزامنةُ إلى ما كانت قبل أن يراها أحد.
    //
    // ودفترُ التحصيل هو المرجعُ في الكشف النقديّ — «لو دي بالذات فواتير كاش
    // فالسعرُ في شيت التحصيل هو الأصحّ». فمتى كُتبت القيمةُ من الدفتر عُلِّمت
    // هنا، وامتنعت المزامنةُ عن الكتابة فوقها وحدَها. وبقيّةُ الحقول تُنقَل كما
    // هي، والقرّاءُ كلُّهم يقرؤون `sellingValue` كما كانوا — لا شرطَ يتناثر في
    // الشاشات.
    sellingValueSource: { type: String, enum: ['', 'platform', 'collections_book'], default: '' },              // قيمه البيع

    // Additional Application fields (from Excel import)
    loadingTime: { type: String, trim: true },                // وقت التحميل
    driverRentalType: { type: String, trim: true },           // نوع تأجير السائق
    reference: { type: String, trim: true },                  // رقم المرجع
    userPhone: { type: String, trim: true },                  // هاتف المستخدم
    driverName: { type: String, trim: true },                 // اسم السائق
    driverPhone: { type: String, trim: true },                // هاتف السائق
    carName: { type: String, trim: true },                    // اسم السيارة
    plateNumber: { type: String, trim: true },                // رقم اللوحة
    truckType: { type: String, trim: true },                  // نوع الشاحنة
    truckSize: { type: String, trim: true },                  // حجم الشاحنة
    loadType: { type: String, trim: true },                   // نوع الحمولة
    quantity: { type: String, trim: true },                   // الكمية
    goodsValue: { type: Number, default: 0 },                 // قيمة البضائع
    representativeName: { type: String, trim: true },         // اسم المندوب
    country: { type: String, trim: true },                    // اسم الدولة
    // Legacy fields (kept for backwards compatibility)
    ownerName: { type: String, trim: true },
    ownerPhone: { type: String, trim: true },
    region: { type: String, trim: true },
    product: { type: String, trim: true },
    invoiceRef: { type: String, trim: true },
    driverCost: { type: Number, default: 0 },
    loadNumber: { type: String, trim: true },
    volume: { type: String, trim: true },

    // ══════════════════════════════════════════════════════════
    // GROUP 2: Operations Column (Operations Manager) — 1 field
    // ══════════════════════════════════════════════════════════
    operationsReview: { type: String, trim: true },          // مراجعه التشغيل

    // ══════════════════════════════════════════════════════════
    // GROUP 3: Manual Moderator Columns (Moderator) — 7 fields
    // ══════════════════════════════════════════════════════════
    paymentDate: { type: Date },                             // تاريخ السداد
    payingBranch: { type: String, trim: true },              // الفرع المسدد

    // ── ما دُفع للمورّد، وبأيّ صفةٍ يُفوتَر العميل ────────────────────────
    // `paymentAmount` سعرُ الشراء الحقيقيّ: يُملأ وحدَه من مشتريات المحفظة
    // (رقمُ الكشف + المبلغ)، ويبقى قابلًا للتعديل باليد هنا.
    //
    // و`paymentType` هو ما يفرّق الطريقين: عميلُ الكاش يُحصَّل منه فورًا بلا
    // فاتورة، وعميلُ الضريبيّ تُكتب له فاتورةٌ ثمّ يُحصَّل بها. وعمودُ «طريقة
    // الدفع» القادمُ من المنصّة لا يُعتمَد عليه في شيءٍ من ذلك — هذا هو المرجع.
    paymentAmount: { type: Number, default: 0 },             // مبلغ السداد
    paymentType: {                                           // نوع الدفع
      type: String,
      enum: ['', 'cash', 'tax'],
      default: '',
    },

    // ── ومَن كتب النوع ───────────────────────────────────────────────────────
    // «manual» تعني أنّ موظّفًا اختاره على هذا الكشف بعينه، فلا يُغيَّر بعده
    // تلقائيًّا مهما تغيّرت صفةُ العميل. وبدون هذا الحقل لا سبيلَ إلى التفريق
    // بين اختيارٍ مقصودٍ وقيمةٍ اشتُقّت، فيدهس الاشتقاقُ قرارَ الإنسان في أوّل
    // تحديثٍ لصفحة أنواع الدفع. راجع utils/paymentType.
    paymentTypeSource: {
      type: String,
      enum: ['', 'manual', 'auto'],
      default: '',
    },
    finalReportDestination: { type: String, trim: true },    // وجهه الكشف النهائي
    documentNumber: { type: String, trim: true },            // رقم السند
    sendingDate: { type: Date },                             // تاريخ الارسال

    // ── تسليمان لا تسليمٌ واحد ────────────────────────────────────────────────
    //
    // كانا حقلًا واحدًا اسمُه «تاريخ التسليم»، وهما حدثان مختلفان في يومين
    // مختلفين وعلى يد فريقين:
    //
    //   `branchDeliveryDate`  تسليمُ الكشف إلى الفرع — عملُ التشغيل، ويأتي في
    //                         شيت المتابعة بين «تاريخ الإرسال» و«مراجعة
    //                         الحسابات»، وهذا موضعُه هنا.
    //   `deliveryDate`        تسليمُ الفاتورة إلى **العميل** — عملُ التحصيل.
    //                         ومنه وحدَه تبدأ مهلةُ السداد المتّفق عليها: عميلٌ
    //                         على خمسةٍ وأربعين يومًا تُعَدُّ الخمسةُ والأربعون
    //                         من يوم استلامه الفاتورة لا من يوم إصدارها ولا من
    //                         يوم وصولها الفرع.
    //
    // ودمجُهما كان يجعل مهلةَ السداد تُحسب من تاريخٍ سابقٍ للتسليم الحقيقيّ،
    // فتظهر الفاتورةُ متأخّرةً وهي في مهلتها — أو العكس. وهما يختلفان فعلًا:
    // في البيانات ثمانمئةٌ وستٌّ وتسعون صفًّا التاريخان فيه مختلفان.
    branchDeliveryDate: { type: Date },                      // تاريخ التسليم للفرع
    deliveryDate: { type: Date },                            // تاريخ التسليم للعميل
    accountingReview: { type: String, trim: true },          // مراجعه الحسابات

    // ══════════════════════════════════════════════════════════
    // GROUP 4: Collections Columns (Admin/Employee) — 7 fields
    // ══════════════════════════════════════════════════════════
    invoiceNumber: { type: String, trim: true },             // رقم الفاتوره
    netInvoice: { type: Number, default: 0 },                // صافي الفاتوره
    tax: { type: Number, default: 0 },                       // ضريبه
    totalInvoice: { type: Number, default: 0 },              // اجمالى الفاتوره
    invoiceDate: { type: Date },                             // تاريخ الفاتوره
    invoiceNotes: { type: String, trim: true },              // ملاحظات الفاتوره
    // ما حصّله قسمُ التحصيل فعلًا — يكتبه بيده عند التحصيل، ولا يُشتقّ من
    // مبلغ السداد: ذاك ما دُفع للمورّد، وهذا ما قُبض من العميل.
    collectedAmount: { type: Number, default: 0 },           // مبلغ التحصيل
    collectionDate: { type: Date },

    // ── وحالةُ التحصيل في دفتر الكاش ─────────────────────────────────────────
    //
    // ورقةُ «Shipment Report» فيها عمودُ حالةٍ لا يُشتقّ من التاريخ: تسعةٌ
    // وتسعون كشفًا مكتوبٌ عليها «Collected» وليس لها تاريخُ تحصيلٍ في الورقة
    // نفسِها — يعرف الدفترُ أنّها حُصّلت ولا يعرف متى. وكانت تظهر عندنا «لم
    // تُحصَّل» لأنّ الشاشةَ تقرأ التاريخ وحدَه.
    //
    // فتُخزَّن الحالةُ كما قالها الدفتر، ولا يُخترَع لها تاريخ. والشاشةُ تقول
    // «محصَّل — بلا تاريخ»، وهو الصدق: حُصِّل، ومتى؟ لا يُعرف بعد.
    cashCollectionStatus: { type: String, enum: ['', 'collected'], default: '' },                          // تاريخ التحصيل

    // ══════════════════════════════════════════════════════════
    // WORKFLOW / STAGE
    // ══════════════════════════════════════════════════════════
    stage: {
      type: String,
      enum: ['draft', 'submitted_to_ops', 'ops_completed', 'submitted_to_collections', 'completed'],
      default: 'draft',
    },

    // ══════════════════════════════════════════════════════════
    // ROW LOCKING
    // ══════════════════════════════════════════════════════════
    lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lockedByName: { type: String, default: '' },
    lockedAt: { type: Date, default: null },

    // ══════════════════════════════════════════════════════════
    // TRACKING
    // ══════════════════════════════════════════════════════════
    // ── المُنشئُ اختياريّ ────────────────────────────────────────────────────
    // الكشفُ المنقولُ من منصّة التشغيل لا مُنشئَ له عندنا — أحدٌ ما أنشأه هناك.
    // وكان الحقلُ مطلوبًا، فكانت المزامنةُ تضع فيه أوّلَ سوبر أدمنَ تجده لتمرّ
    // من التحقّق، فقرأ أربعةٌ وثلاثون ألفَ كشفٍ «أنشأتها فلانة» وهي لم تفتح
    // واحدًا منها.
    //
    // فحين أُزيل الختمُ الكاذب صار كلُّ حفظٍ على تلك الصفوف يفشل: «createdBy
    // مطلوب». والشرطُ نفسُه هو الذي وَلَّد الكذبةَ ثمّ منعَ تصحيحَها — فسقط.
    // ومَن أنشأ الكشفَ عندنا يبقى مسجَّلًا كما كان؛ ومَن لم يُنشئه أحدٌ عندنا
    // يُقرأ من `externalSource`.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Provenance for rows auto-synced from the external UPL operations platform.
    // `externalId` (UPL shipment id) dedups so re-syncs update in place; the
    // UPL-derived columns are refreshed each run while manually-entered columns
    // (operations/accounting/invoice review, etc.) are left untouched.
    externalSource: { type: String, trim: true },
    externalId: { type: String, trim: true },
    lastSyncedAt: { type: Date },
  },
  { timestamps: true }
);

// صفحتا الفواتير تُبنيان على هذين: الكاشُ بنوع الدفع، والضريبيُّ برقم
// الفاتورة الذي يجمع أكثرَ من كشفٍ تحت صفٍّ واحد.
operationsWorkflowSchema.index({ paymentType: 1, paymentDate: -1 });
operationsWorkflowSchema.index({ invoiceNumber: 1, invoiceDate: -1 });

operationsWorkflowSchema.index(
  { externalSource: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $exists: true } } }
);

// Auto-generate report number before save
operationsWorkflowSchema.pre('save', async function (next) {
  if (!this.reportNumber) {
    const last = await mongoose.model('OperationsWorkflow')
      .findOne({ reportNumber: /^RPT-/ })
      .sort({ reportNumber: -1 })
      .select('reportNumber')
      .lean();
    const lastNum = last ? parseInt(last.reportNumber.replace('RPT-', ''), 10) : 0;
    this.reportNumber = `RPT-${String(lastNum + 1).padStart(5, '0')}`;
  }
  next();
});

// Indexes
operationsWorkflowSchema.index({ stage: 1 });
operationsWorkflowSchema.index({ branch: 1 });
operationsWorkflowSchema.index({ carOwner: 1 });
operationsWorkflowSchema.index({ createdAt: -1 });
operationsWorkflowSchema.index({ lockedBy: 1 });

module.exports = mongoose.model('OperationsWorkflow', operationsWorkflowSchema);
