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
    // ── وكلُّ مرحلةٍ تُعلَّم وحدَها ─────────────────────────────────────────
    // كانت المراحلُ المنجزةُ تُشتقّ من موضع الحاليّة: مَن اختار الثامنةَ عُدَّت
    // السبعُ قبلها منجزةً وإن لم تجرِ واحدةٌ منها. والدورةُ لا تسير دائمًا على
    // ترتيبها — قد يُدفَع الرسمُ قبل وصول الأوراق، وقد تُتخطّى مرحلةٌ أصلًا.
    // فما أُنجز يُسجَّل صراحةً، و`stage` تبقى «أين هي الآن» للتقارير والفلاتر.
    stagesDone: { type: [String], default: [], index: true },
    cancelled: { type: Boolean, default: false },

    // People
    assignedTo: { type: String, trim: true },       // مخلص / معقب (free text — reps aren't always users)
    customerName: { type: String, trim: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    // ── الطرفان بمعرّفَيهما لا بنصَّيهما ───────────────────────────────────
    // الاسمُ يبقى مخزَّنًا كما كُتب (`customerName`, `shippingAgent`) لأنّ
    // التصديراتِ والتقاريرَ تقرؤه، ويُضاف إليه معرّفُ الملفّ: به تُجمَّع
    // المعاملاتُ ويُفتح البروفايل، فلا يُفرِّق صيغتا كتابةٍ طرفًا واحدًا.
    customerParty: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomsParty', index: true },
    agentParty: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomsParty', index: true }, // optional link
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

    // ---------------------------------------------------------------------
    // Master-spreadsheet fields (ماستر التخليص). All additive & optional.
    // ---------------------------------------------------------------------

    // Identity / period
    legacySerial: { type: Number },                 // مسلسل (row number in the sheet)
    periodMonth: { type: Number, min: 1, max: 12 }, // الشهر
    periodYear: { type: Number },                   // السنة
    city: { type: String, trim: true },             // المدينة (raw Arabic, as written)

    // Declaration & scheduling
    declarationNumber: { type: String, trim: true },  // رقم البيان
    declarationDate: { type: String, trim: true },    // تاريخ البيان (YYYY-MM-DD)
    papersReceivedDate: { type: String, trim: true }, // تاريخ استلام الورق (YYYY-MM-DD)
    unloadingAppointment: { type: String, trim: true }, // موعد التفريغ
    unloadingLocation: { type: String, trim: true },    // مكان التفريغ
    doNumber: { type: String, trim: true },             // رقم إذن التسليم (اذن التسليم in the sheet)
    exitPermitNumber: { type: String, trim: true },     // رقم تصريح الخروج

    // آخر موعدٍ لإرجاع الحاويات إلى الوكيل. عمودٌ في الماستر («اخر موعد ارجاع»)
    // وهو أخطرُ تاريخٍ في المعاملة: تجاوزُه يفتح عدّاد الأرضيات، فيصير مالًا.
    // لذلك يُخزَّن وحده لا داخل stageDates — تُقاس عليه المتأخّرات والمُشرِفة.
    returnDeadline: { type: String, trim: true, default: '' }, // YYYY-MM-DD
    // وأكثرُ صفوف الماستر تكتب في هذه الخانة عددَ أيّام السماح (٣٥ غالبًا) لا
    // تاريخًا. الرقمُ لا يُقحَم في خانة تاريخٍ ولا يُرمى: يُخزَّن هنا، ومنه
    // يُشتقُّ الموعدُ متى عُرف تاريخُ التفريغ.
    returnFreeDays: { type: Number, default: 0 },

    // Payment / milestone dates (YYYY-MM-DD strings, '' when unknown)
    stageDates: {
      doInvoiceEmailed: { type: String, default: '' },   // ميل فاتورة اذن التسليم
      doInvoicePaid: { type: String, default: '' },      // سداد فاتورة اذن التسليم
      doLinkEmailed: { type: String, default: '' },      // ميل ربط اذن التسليم
      dutyPaid: { type: String, default: '' },           // سداد رسوم جمركية
      portFeesPaid: { type: String, default: '' },       // سداد الموانى
      unloadingFeesPaid: { type: String, default: '' },  // سداد التفريغ
      containersReturned: { type: String, default: '' }, // الارجاع
      returnInvoiceDate: { type: String, default: '' },  // فاتورة الارجاع
    },

    // The sheet often records these milestones as "تم" with no date — keep the
    // done/not-done signal alongside stageDates so nothing is lost.
    stageDone: {
      doInvoiceEmailed: { type: Boolean, default: false },
      doInvoicePaid: { type: Boolean, default: false },
      doLinkEmailed: { type: Boolean, default: false },
      dutyPaid: { type: Boolean, default: false },
      portFeesPaid: { type: Boolean, default: false },
      unloadingFeesPaid: { type: Boolean, default: false },
      containersReturned: { type: Boolean, default: false },
      returnInvoiceDate: { type: Boolean, default: false },
    },

    // Costs (المصروفات) — all SAR
    costs: {
      deliveryOrder: { type: Number, default: 0 },      // قيمة اذن التسليم
      customsDuty: { type: Number, default: 0 },        // الرسوم الجمركية
      portFees: { type: Number, default: 0 },           // اجور الموانى
      unloadingFees: { type: Number, default: 0 },      // اجور التفريغ
      transport: { type: Number, default: 0 },          // اجور النقل (بالضريبة)
      transportToYard: { type: Number, default: 0 },    // النقل الى الساحة (بالضريبة)
      appointmentBooking: { type: Number, default: 0 }, // حجز الموعد
      yardFees: { type: Number, default: 0 },           // اجور الساحه
      demurrage: { type: Number, default: 0 },          // ارضيات
      inspection: { type: Number, default: 0 },         // اجور الكشف
      extension: { type: Number, default: 0 },          // تمديد
      consolidator: { type: Number, default: 0 },       // الدامج
      commissions: { type: Number, default: 0 },        // عمولات
      storage: { type: Number, default: 0 },            // تخزين
      exitPermit: { type: Number, default: 0 },         // تصريح الخروج
      total: { type: Number, default: 0 },              // اجمالى المصروفات (computed)
    },

    // ── الإيرادات (بالريال) ────────────────────────────────────────────────
    // في التخليص لا تُباع الرسومُ بل تُمرَّر: ما يُدفع للموانى والجمارك يُسترد
    // من العميل كما هو (اجمالى المصروفات أعلاه)، والربحُ هو ما يُضاف فوقها.
    // لذلك الحقولُ هنا بنودُ الهامش لا «المبيعات»: كلُّ واحدٍ منها يدخل الربح،
    // والفاتورةُ = المصروفات + الهامش. هكذا يحسبها الماستر نفسُه:
    //   اجمالى الفاتورة = اجمالى المصروفات + اجور التخليص + صافى التخزين
    //                     + صافى النقل الى الساحة + فحص امنى + صافي النقل
    revenue: {
      clearanceFee: { type: Number, default: 0 },        // اجور التخليص
      transportSelling: { type: Number, default: 0 },    // سعر بيع النقل (إجمالي، لا يدخل الهامش)
      transportNet: { type: Number, default: 0 },        // صافي النقل = سعر البيع − اجور النقل
      transportToYardNet: { type: Number, default: 0 },  // صافى النقل الى الساحة (بالضريبة)
      yardTransportNet: { type: Number, default: 0 },    // صافي نقل الساحه (عمود مساعد، خارج الهامش)
      yardNet: { type: Number, default: 0 },             // صافى الساحه
      storageNet: { type: Number, default: 0 },          // صافى التخزين
      securityScan: { type: Number, default: 0 },        // فحص امنى
      labour: { type: Number, default: 0 },              // عمال
      totalInvoiced: { type: Number, default: 0 },       // اجمالى الفاتورة (محسوبة)
      profit: { type: Number, default: 0 },              // اجمالى الربح (محسوبة)
    },

    // Our billing (as opposed to the supplier invoice captured above)
    billing: {
      invoiceStatus: { type: String, default: '' },  // حالة الفاتورة — free text ('خالص', 'غير مفوتر', ...)
      ourInvoiceNumber: { type: String, default: '' }, // رقم الفاتورة (ours)
      invoicedAt: { type: String, default: '' },       // YYYY-MM-DD
    },

    // Container-level detail (Sheet2 grain)
    containers: [
      {
        containerNumber: { type: String, trim: true }, // الحاوية
        exitPermit: { type: Number, default: 0 },      // تصريح خروج
        declaration: { type: String, trim: true },     // البيان
        notes: { type: String, trim: true },
      },
    ],

    // ── مرفقاتُ المعاملة ────────────────────────────────────────────────────
    // ورقُ التخليص هو المعاملة: البوليصة والبيان وفاتورة إذن التسليم وإيصال
    // السداد وتصريح الخروج. كانت تُتداول على الإيميل والواتساب، فإن سُئل عنها
    // بعد شهرٍ لم تُوجد. تُخزَّن هنا مع السجلّ نفسِه، ويُوسَم كلُّ ملفٍّ بالمرحلة
    // التي أُنتج فيها (stage) فيُقرأ الملفُّ في موضعه من دورة الإجراءات لا في
    // كومةٍ واحدة.
    attachments: [
      {
        title: { type: String, trim: true, default: '' },
        stage: { type: String, default: '' },   // إحدى STAGES أو '' للعامّ
        fileUrl: { type: String, required: true },
        fileName: { type: String, trim: true, default: '' },
        mimeType: { type: String, trim: true, default: '' },
        size: { type: Number, default: 0 },
        uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        uploadedByName: { type: String, default: '' },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    notes: { type: String },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

customsClearanceSchema.index({ createdAt: -1 });
customsClearanceSchema.index({ blNumber: 1 });
customsClearanceSchema.index({ periodYear: 1, periodMonth: 1 });
customsClearanceSchema.index({ customerName: 1 });
customsClearanceSchema.index({ 'billing.invoiceStatus': 1 });

// بنودُ المصروفات التي يتكوّن منها costs.total — وهي وحدَها ما يُمرَّر على
// العميل. مطابقةٌ لصيغة الماستر: اجمالى المصروفات = مجموعُ هذه الخانات.
const COST_KEYS = [
  'returnInvoice', 'deliveryOrder', 'customsDuty', 'portFees', 'unloadingFees',
  'inspection', 'transport', 'transportToYard', 'appointmentBooking', 'storage',
  'yardFees', 'exitPermit', 'demurrage', 'extension', 'consolidator', 'commissions',
];

// بنودُ الهامش التي يتكوّن منها revenue.profit. `transportSelling` ليس منها:
// هو الإجمالي، وصافيه (transportNet) هو الداخلُ في الربح، فجمعُهما معًا يحسب
// النقلَ مرّتين. وكذلك yardTransportNet — عمودٌ مساعدٌ لا يدخل صيغةَ الربح.
const MARGIN_KEYS = [
  'clearanceFee', 'labour', 'yardNet', 'storageNet',
  'transportToYardNet', 'securityScan', 'transportNet',
];

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const r2 = (x) => Math.round(x * 100) / 100;

/**
 * يعيد اشتقاق الأرقام الثلاثة المحسوبة على أيّ كائنٍ أو مستند:
 *   costs.total          = مجموع بنود المصروفات
 *   revenue.profit       = مجموع بنود الهامش
 *   revenue.totalInvoiced = المصروفات + الهامش
 *
 * الفاتورةُ محسوبةٌ لا مُدخلة: عمودُها في الماستر صيغةٌ لا رقمٌ مكتوب، فلو
 * قُرئ رقمًا وأُدخل يدويًّا انفصل عن بنوده وصار الربحُ خبرًا لا حسابًا.
 * وكلُّ بندٍ غيرِ رقميّ يساوي صفرًا لا NaN، كي لا تُسمَّم الجملةُ كلُّها.
 * يستعمله pre('save') ومسارُ التحديث في المتحكّم والمستورِد، فلا تنزلق
 * الأرقامُ المشتقّة عن مدخلاتها في أيّ مسار.
 */
function recomputeTotals(doc) {
  if (!doc) return doc;
  if (!doc.costs) doc.costs = {};
  if (!doc.revenue) doc.revenue = {};
  let total = 0;
  for (const k of COST_KEYS) total += n(doc.costs[k]);
  total = r2(total);
  let profit = 0;
  for (const k of MARGIN_KEYS) profit += n(doc.revenue[k]);
  profit = r2(profit);
  doc.costs.total = total;
  doc.revenue.profit = profit;
  doc.revenue.totalInvoiced = r2(total + profit);
  return doc;
}

customsClearanceSchema.pre('save', function (next) {
  recomputeTotals(this);
  next();
});

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

// Any write clears the cached clearance list so edits/stage-moves show at once.
const bustCustomsList = () => { try { require('../utils/ttlCache').clear('customs:list'); } catch (e) { /* noop */ } };
customsClearanceSchema.post('save', bustCustomsList);
customsClearanceSchema.post(/^find.*[UD]/, bustCustomsList); // findOneAndUpdate / findOneAndDelete / findByIdAndUpdate|Delete

module.exports = mongoose.model('CustomsClearance', customsClearanceSchema);
module.exports.STAGES = STAGES;
module.exports.COST_KEYS = COST_KEYS;
module.exports.MARGIN_KEYS = MARGIN_KEYS;
module.exports.recomputeTotals = recomputeTotals;
