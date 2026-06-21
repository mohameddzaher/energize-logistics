const mongoose = require('mongoose');

// The 11 ordered stages of a customs-clearance transaction (دورة التخليص الجمركى).
// Kept here so the controller/validation and the frontend pipeline share one source.
const STAGES = [
  'papers_received',        // استلام الأوراق
  'declaration_paid',       // طباعة البيان الجمركى و سداده
  'do_requested',           // إرسال أوراق الوكيل و طلب فاتورة إذن التسليم
  'do_linked',              // ربط إذن التسليم
  'port_fees_paid',         // طباعة فاتورة أجور الموانى و سدادها
  'unloading_fees_paid',    // طباعة فاتورة أجور التفريغ و سدادها
  'transport_order',        // عمل أمر نقل
  'containers_transported', // نقل الحاويات الى العميل او الساحة
  'unloaded_stored',        // التفريغ و التخزين
  'containers_returned',    // إرجاع الحاويات الى الوكيل
  'invoiced',               // عمل الفواتير
];

const customsClearanceSchema = new mongoose.Schema(
  {
    refNumber: { type: String, unique: true, index: true },

    branch: { type: String, enum: ['jeddah', 'dammam'], default: 'jeddah', index: true },
    stage: { type: String, enum: STAGES, default: 'papers_received', index: true },
    cancelled: { type: Boolean, default: false },

    // People
    assignedTo: { type: String, trim: true },       // مخلص / معقب (free text — reps aren't always users)
    customerName: { type: String, trim: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }, // optional link
    shippingAgent: { type: String, trim: true },
    shippingAgentEmail: { type: String, trim: true, lowercase: true },

    // Transaction data (البيانات الضرورية لعمل المعاملة على فسح)
    blNumber: { type: String, trim: true },         // رقم البوليصة
    invoiceNumber: { type: String, trim: true },    // رقم الفاتورة
    invoiceDate: { type: Date },                    // تاريخ الفاتورة
    port: { type: String, trim: true },             // اسم الميناء
    invoiceType: { type: String, enum: ['C&F', 'CIF', 'FOB', ''], default: '' },
    containerCount: { type: Number, default: 0 },   // عدد الحاويات
    totalWeight: { type: Number, default: 0 },      // الوزن الاجمالى
    invoiceValue: { type: Number, default: 0 },     // قيمة الفاتورة
    currency: { type: String, trim: true },         // نوع العملة
    exporterCompany: { type: String, trim: true },  // اسم الشركة المصدرة
    countryOfOrigin: { type: String, trim: true },  // بلد المنشأ
    hsCode: { type: String, trim: true },           // البند الجمركى HS
    saberNumber: { type: String, trim: true },      // رقم شهادة سابر (ان وجدت)

    // Required documents checklist (الأوراق المطلوبة للمعاملات)
    documents: {
      bl: { type: Boolean, default: false },               // البوليصة
      commercialInvoice: { type: Boolean, default: false }, // الفاتورة التجارية
      certificateOfOrigin: { type: Boolean, default: false }, // شهادة المنشأ
      packingList: { type: Boolean, default: false },       // بيان التعبئة
      saber: { type: Boolean, default: false },             // شهادة سابر (ان وجدت)
    },

    // Agent papers checklist (أوراق الوكيل)
    agentPapers: {
      blStamped: { type: Boolean, default: false },          // البوليصة و عليها ختم التخليص + رقم المستورد
      customerAuthorization: { type: Boolean, default: false }, // تفويض العميل للشركة
      companyAuthorization: { type: Boolean, default: false },  // تفويض الشركة لمندوب التخليص
    },

    notes: { type: String },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

customsClearanceSchema.index({ createdAt: -1 });
customsClearanceSchema.index({ blNumber: 1 });

// Auto reference number: CC-00001, CC-00002, ...
customsClearanceSchema.pre('save', async function (next) {
  if (this.isNew && !this.refNumber) {
    try {
      const last = await this.constructor.findOne({}).sort({ createdAt: -1 }).select('refNumber').lean();
      let n = 1;
      if (last && last.refNumber) {
        const m = String(last.refNumber).match(/(\d+)$/);
        if (m) n = parseInt(m[1], 10) + 1;
      }
      this.refNumber = 'CC-' + String(n).padStart(5, '0');
    } catch (e) {
      this.refNumber = 'CC-' + Date.now();
    }
  }
  next();
});

customsClearanceSchema.statics.STAGES = STAGES;

module.exports = mongoose.model('CustomsClearance', customsClearanceSchema);
module.exports.STAGES = STAGES;
