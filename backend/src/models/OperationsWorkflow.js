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
    sellingValue: { type: Number, default: 0 },              // قيمه البيع

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
    finalReportDestination: { type: String, trim: true },    // وجهه الكشف النهائي
    documentNumber: { type: String, trim: true },            // رقم السند
    sendingDate: { type: Date },                             // تاريخ الارسال
    deliveryDate: { type: Date },                            // تاريخ التسليم
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
    collectionDate: { type: Date },                          // تاريخ التحصيل

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
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Auto-generate report number before save
operationsWorkflowSchema.pre('save', async function (next) {
  if (!this.reportNumber) {
    const count = await mongoose.model('OperationsWorkflow').countDocuments();
    this.reportNumber = `RPT-${String(count + 1).padStart(5, '0')}`;
  }
  next();
});

// Indexes
operationsWorkflowSchema.index({ stage: 1 });
operationsWorkflowSchema.index({ reportNumber: 1 });
operationsWorkflowSchema.index({ branch: 1 });
operationsWorkflowSchema.index({ carOwner: 1 });
operationsWorkflowSchema.index({ createdAt: -1 });
operationsWorkflowSchema.index({ lockedBy: 1 });

module.exports = mongoose.model('OperationsWorkflow', operationsWorkflowSchema);
