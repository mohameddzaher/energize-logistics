const mongoose = require('mongoose');

/**
 * ── مراحلُ دورة التخليص ────────────────────────────────────────────────────
 * كانت إحدى عشرةَ مرحلةً على خطٍّ واحد. والدورةُ ليست خطًّا: بعد «أمر النقل»
 * تتفرّع — إمّا من الميناء إلى الساحة (فيتبعها التفريغُ والتخزين ثمّ نقلٌ ثانٍ
 * إلى العميل) وإمّا من الميناء إلى العميل مباشرةً (فلا تفريغَ ولا تخزين).
 * ومعاملةُ السيّارات لا إرجاعَ حاوياتٍ فيها أصلًا.
 *
 * فالقائمةُ هنا كلُّ ما قد يقع، و`pipelineOf` أدناه تقول ما يَلزم **هذه**
 * المعاملةَ منها وما أُغلِق عليها — ومنها تُحسَب النسبة، فلا تُعاقَب معاملةٌ
 * على مرحلةٍ ليست من طريقها.
 */
const STAGES = [
  'papers_received',        // استلام الأوراق
  'declaration_paid',       // سداد البيان الجمركي
  'do_requested',           // طلب فاتورة إذن التسليم
  'do_invoice_paid',        // سداد فاتورة إذن التسليم
  'do_linked',              // ربط إذن التسليم
  'port_fees_paid',         // سداد أجور الموانئ
  'unloading_fees_paid',    // سداد أجور التفريغ
  'transport_order',        // أمر النقل
  'transport_to_yard',      // النقل من الميناء إلى الساحة
  'transport_to_customer',  // النقل من الميناء إلى العميل
  'unloaded_stored',        // التفريغ والتخزين (طريقُ الساحة وحدَه)
  'yard_to_customer',       // النقل من الساحة إلى العميل (طريقُ الساحة وحدَه)
  'containers_returned',    // إرجاع الحاويات (لا في معاملات السيّارات)
  'invoiced',               // إصدار الفاتورة — تُعلَّم بإصدارها لا بيد
];
// مفتاحُ ما قبل التفريع: «نقل الحاويات إلى العميل أو الساحة». يبقى مقبولًا في
// `stage` لأنّ معاملاتٍ قديمةً واقفةٌ عليه، ويُقرأ بمعناه الجديد في `pipelineOf`.
const LEGACY_STAGES = ['containers_transported'];
// الترتيبُ الخطّيُّ القديم — به تُقرأ معاملةٌ تحمل مرحلتَها الحاليّةَ بلا علامات.
const LINEAR_V1 = [
  'papers_received', 'declaration_paid', 'do_requested', 'do_linked', 'port_fees_paid',
  'unloading_fees_paid', 'transport_order', 'containers_transported', 'unloaded_stored',
  'containers_returned', 'invoiced',
];
// المراحلُ التي هي نقلٌ — لكلٍّ منها بيانُ سيّاراته (راجع containers.moves).
const TRANSPORT_LEGS = ['transport_to_yard', 'transport_to_customer', 'yard_to_customer'];
// مرحلتا الميناء — يُختار أحدُهما، ويُبدَّل بينهما بضغطة.
const PORT_LEGS = ['transport_to_yard', 'transport_to_customer'];
const CARGO_TYPES = ['containers', 'vehicles'];
const VEHICLE_KINDS = ['energize', 'external'];

const customsClearanceSchema = new mongoose.Schema(
  {
    refNumber: { type: String, unique: true, index: true },

    branch: { type: String, enum: ['jeddah', 'dammam'], default: 'jeddah', index: true },
    stage: { type: String, enum: [...STAGES, ...LEGACY_STAGES], default: 'papers_received', index: true },
    /**
     * ── نوعُ المعاملة: حاوياتٌ أم سيّارات ────────────────────────────────────
     * يُختار عند الإنشاء. والدورةُ واحدةٌ في الحالين إلّا «إرجاع الحاويات»:
     * السيّارةُ تُسلَّم ولا يعود منها شيءٌ إلى الوكيل، فتُغلَق تلك المرحلةُ من
     * أوّل يوم. و`containerCount` عددُ الوحدات في الحالين.
     */
    cargoType: { type: String, enum: CARGO_TYPES, default: 'containers', index: true },
    // أيُّ الطريقين سلكت بعد أمر النقل — يُكتب حين تُعلَّم إحدى مرحلتَي الميناء.
    transportRoute: { type: String, enum: ['', 'yard', 'customer'], default: '' },
    // ٢ = عُلِّمت مراحلُها بالقائمة الجديدة. وما دونه يُقرأ بقاعدة القديم.
    // بلا قيمةٍ افتراضيّة عمدًا: الافتراضيُّ يُكتب على القديم عند قراءته.
    pipelineVersion: { type: Number },
    // مَن علّم أيَّ مرحلةٍ ومتى — به تُقرأ حركةُ الفريق في لوحة القسم.
    stageLog: [{
      key: { type: String, default: '' },
      done: { type: Boolean, default: true },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      byName: { type: String, default: '' },
      at: { type: Date, default: Date.now },
    }],
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
    // الناقلُ الذي نقل الحاوية من الميناء — سجلٌّ كالعميل والوكيل، والاسمُ
    // يبقى نصًّا لما أُدخل قبل السجلّ.
    carrierParty: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomsParty', index: true },
    carrierName: { type: String, trim: true, default: '' },
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

    /**
     * ── معاملةٌ لم يحِن وقتُها بعد ────────────────────────────────────────
     * الشحنةُ تُعرَف قبل وصولها بأسبوع: العميلُ يُخطر، والوكيلُ يُحجَز،
     * والأوراقُ تُجهَّز. وكان ذلك يُكتب في دفترٍ جانبيٍّ أو يُترَك للذاكرة،
     * فتأتي الشحنةُ ولم يُحجَز لها موعد.
     *
     * فتُسجَّل معاملةً كاملةً بتاريخها المرتقَب، **ولا تُخلَط بالجاري**:
     * قوائمُ العمل وأرقامُ اللوحة ومطالباتُ التحصيل كلُّها عن معاملاتٍ وقعت،
     * فصفٌّ لم يقع بعدُ فيها يُفسد كلَّ عدّ. ولها قائمتُها وتنبيهُها، ومنها
     * تُحوَّل بضغطةٍ إلى معاملةٍ جارية حين تصل.
     */
    upcoming: { type: Boolean, default: false, index: true },
    expectedDate: { type: String, trim: true, default: '' }, // YYYY-MM-DD
    // متى تحوّلت إلى معاملةٍ جارية — ومَن حوّلها.
    activatedAt: { type: Date, default: null },
    activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    activatedByName: { type: String, trim: true, default: '' },

    /**
     * ── مراحلُ السداد: قائمةٌ تتكرّر، لا ثمانيَ خانة ──────────────────────
     *
     * كانت `stageDates`/`stageDone` أدناه ثمانيَ مفتاحٍ مكتوبةً في المخطَّط:
     * مرحلةً واحدةً لكلٍّ، بتاريخٍ واحدٍ وبلا مرفق. وثلاثةُ أشياءَ لم تكن ممكنة:
     *
     *   · مرحلةٌ تاسعة — «فاتورة النقل» — تحتاج نشرةً جديدة لتوجد.
     *   · ورقةُ السداد نفسُها. فيُكتب «سُدِّد ٣/٨» ولا إيصال، فإن سُئل بعد شهرٍ
     *     لم يوجد إلّا تاريخٌ لا يُثبِت شيئًا.
     *   · وأن تتكرّر المرحلة. والرسومُ تُسدَّد على دفعتين، والإرجاعُ يقع مرّتين
     *     لحاويتين — فيُكتب الثاني فوق الأوّل ويضيع.
     *
     * فصارت قائمةً: كلُّ إدخالٍ مرحلةٌ بتاريخها ومرفقها، وتُضاف المرحلةُ نفسُها
     * مرّاتٍ. والقائمةُ التي تُختار منها تُدار من إعدادات القسم
     * (`customs_payment_stage`)، والاسمُ يُلقَط في `label` فلا يتغيّر ما مضى
     * إن أُعيدت التسميةُ لاحقًا.
     *
     * و`stageDates`/`stageDone` تبقيان: صفوفُ الاستيراد القديمة فيها، ومحوُها
     * محوٌ للتاريخ. تُنقَل مرّةً بـ`scripts/migrateCustomsStages.js` وتبقى
     * مقروءةً لا مكتوبة.
     */
    paymentStages: [
      {
        key: { type: String, trim: true, default: '' },     // مفتاحُ المرحلة من القائمة
        label: { type: String, trim: true, default: '' },   // لقطةُ الاسم وقتَ الإضافة
        date: { type: String, default: '' },                // YYYY-MM-DD
        amount: { type: Number, default: null },            // المبلغُ إن سُجِّل
        note: { type: String, trim: true, default: '' },
        // المرفقُ يُكتب هنا وفي `attachments` معًا: هنا ليُقرأ في موضعه من
        // المرحلة، وهناك ليُوجَد مع بقيّة ورق المعاملة في مكانٍ واحد.
        fileUrl: { type: String, default: '' },
        fileName: { type: String, trim: true, default: '' },
        mimeType: { type: String, trim: true, default: '' },
        size: { type: Number, default: 0 },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        addedByName: { type: String, default: '' },
        addedAt: { type: Date, default: Date.now },

        /**
         * ── والمدخلُ طلبُ صرفٍ إلى الإدارة الماليّة ──────────────────────
         * حين يرفق موظّفُ التخليص فاتورةً في مرحلةٍ من مراحل السداد فهو لا
         * يؤرّخ حدثًا مضى: هو يقول «هذا ما يجب أن يُدفَع». وكان ذلك يُقال
         * بالهاتف أو على الواتساب، ويُعلَّم في الشاشة بعلامةٍ تُوضَع بيدٍ —
         * فلا يُعرَف مَن طلب ولا مَن دفع ولا متى، ولا يظهر في مكانٍ يراه
         * المحاسب.
         *
         * فصار المدخلُ نفسُه طلبًا له حالة: مُعلَّقٌ حتى تقرّر الماليّةُ —
         * دفعتْ (ومعها إثباتُها)، أو أعادتْه لتصحيح (ومعها سببُها)، أو
         * رفضتْه. والعلامةُ الخضراء لا تُوضَع بيدٍ: تُوضَع حين يُدفَع.
         */
        payStatus: {
          type: String,
          enum: ['pending', 'paid', 'returned', 'rejected'],
          default: 'pending',
          index: true,
        },
        decisionNote: { type: String, trim: true, default: '' },
        decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        decidedByName: { type: String, trim: true, default: '' },
        decidedAt: { type: Date, default: null },
        // إثباتُ الدفع — ملفٌّ أو أكثر، واختياريٌّ (تحويلٌ بنكيٌّ قد لا يُصوَّر).
        proofFiles: [{
          fileUrl: { type: String, trim: true, default: '' },
          fileName: { type: String, trim: true, default: '' },
          mimeType: { type: String, trim: true, default: '' },
          size: { type: Number, default: 0 },
        }],
      },
    ],

    /**
     * ── إقفالُ المعاملة ──────────────────────────────────────────────────
     * فعلٌ صريحٌ لا حالةٌ تُستنتَج. ولا يُقفَل قبل أن تكون «فاتورة النقل» لها
     * تاريخٌ ومرفق — راجع `completeClearance`: المعاملةُ تُقفَل فتخرج من قوائم
     * المتابعة، فإن أُقفلت بلا فاتورةِ نقلٍ خرجت وفيها مالٌ لم يُطالَب به.
     */
    /**
     * ── وفاتورةُ العميل تُكتب عند الإقفال ────────────────────────────────
     *
     * مراحلُ السداد أعلاه **ما ندفعه**: طلباتُ صرفٍ تجيبها الإدارةُ الماليّة.
     * وهذه **ما نفوتره**: عند إقفال المعاملة يُسأل موظّفُ التخليص عن سعر
     * البيع لكلّ بندٍ (فاتورةُ النقل، الرسومُ الجمركيّة، حجزُ الموعد…) ومعه
     * مرفقُه — فيُقال «سدّدنا النقلَ ١٨٠٠ ونفوتره ٢٢٠٠».
     *
     * وقاعدةُ الفاتورة (راجع utils/customsInvoice، والحسابُ هناك لا هنا):
     *   بنودُ مراحل السداد بمبالغها **كما هي** بلا ضريبة — إلّا ما كان له
     *   بندُ بيعٍ هنا، فيُؤخَذ من هنا ولا يُكرَّر.
     *   + بنودُ البيع هذه مجموعةً × ١٫١٥
     *   = إجماليُّ الفاتورة.
     *
     * ولا يُخزَّن الإجماليُّ: يُشتقّ عند القراءة من البنود نفسِها، فلا يبقى
     * رقمٌ يصدق يومَ كُتب ويكذب بعد تعديل بند.
     */
    saleItems: [{
      key: { type: String, trim: true, default: '' },
      label: { type: String, trim: true, default: '' },
      amount: { type: Number, default: 0 },
      note: { type: String, trim: true, default: '' },
      fileUrl: { type: String, default: '' },
      fileName: { type: String, trim: true, default: '' },
      mimeType: { type: String, trim: true, default: '' },
      size: { type: Number, default: 0 },
      addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      addedByName: { type: String, default: '' },
      addedAt: { type: Date, default: Date.now },
    }],
    // رقمُ الفاتورة يُمنَح عند الإقفال ولا يتغيّر — به تُعرَف عند الماليّة.
    saleInvoiceNumber: { type: String, trim: true, default: '', index: true },
    saleInvoiceAt: { type: Date, default: null },
    // نسبةُ الضريبة وقتَ الإقفال — تُلقَط كي لا تتغيّر فاتورةٌ قديمةٌ بتغيّرها.
    saleVatRate: { type: Number, default: 0.15 },

    isCompleted: { type: Boolean, default: false, index: true },
    completedAt: { type: Date, default: null },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    completedByName: { type: String, trim: true, default: '' },

    // Payment / milestone dates (YYYY-MM-DD strings, '' when unknown)
    // مقروءةٌ لا مكتوبة — راجع `paymentStages` أعلاه.
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
      extraFees: { type: Number, default: 0 },          // اجور اضافية
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
        containerNumber: { type: String, trim: true }, // رقمُ الحاوية (أو هيكلِ السيّارة)
        exitPermit: { type: Number, default: 0 },      // تصريح خروج
        declaration: { type: String, trim: true },     // البيان
        notes: { type: String, trim: true },
        // تاريخُ إرجاع هذه الحاوية إلى الوكيل — لكلّ حاويةٍ تاريخُها.
        returnDate: { type: String, trim: true, default: '' }, // YYYY-MM-DD
        /**
         * بيانُ نقلها في كلّ مرحلةِ نقل: بسيّارةِ الشركة فيُكتب رقمُ كشف
         * التخريج (وهو `reportNumber` في سير عمل التشغيل)، أو بسيّارةٍ
         * خارجيّةٍ فيُكتب رقمُ فاتورتها.
         */
        moves: [{
          _id: false,
          leg: { type: String, enum: TRANSPORT_LEGS },
          vehicleKind: { type: String, enum: [...VEHICLE_KINDS, ''], default: '' },
          ref: { type: String, trim: true, default: '' },
        }],
      },
    ],

    /**
     * ── فاتورةُ النقل: تُفوتَر المعاملةُ بدونها وتُنهى بها ────────────────────
     * كان الإقفالُ والفوترةُ فعلًا واحدًا لا يمرّ قبل فاتورة النقل، وهي تتأخّر
     * عند الناقل أسابيع — فتبقى المعاملةُ بلا فاتورةٍ للعميل وعملُها منتهٍ.
     * ففُصِلا: الفاتورةُ تصدر متى اكتمل العمل وتذهب إلى الماليّة، والمعاملةُ
     * تُنهى حين تصل فاتورةُ النقل وتُرفَق. وما بينهما يُعَدّ ويُلوَّن بالأحمر
     * في لوحة القسم حتى لا يُنسى.
     */
    transportInvoice: {
      fileUrl: { type: String, default: '' },
      fileName: { type: String, trim: true, default: '' },
      mimeType: { type: String, trim: true, default: '' },
      size: { type: Number, default: 0 },
      date: { type: String, trim: true, default: '' },
      // نُقلت بسيّارات الشركة فلا فاتورةَ ناقلٍ تُنتظَر — يُقال صراحةً.
      notRequired: { type: Boolean, default: false },
      note: { type: String, trim: true, default: '' },
      receivedAt: { type: Date, default: null },
      receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      receivedByName: { type: String, trim: true, default: '' },
    },
    // مشتقٌّ يُحفَظ عند كلّ حفظ (راجع hasTransportInvoice) ليُفلتَر به في القاعدة.
    transportInvoiceReceived: { type: Boolean, default: false, index: true },

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

    // ── والملاحظةُ سطرٌ يُضاف لا خانةٌ تُدهَس ────────────────────────────────
    // كانت `notes` خانةً واحدة: من كتب ملاحظةً اليوم محا ملاحظةَ أمس، ولا يُعرف
    // مَن كتب ولا متى. فصار لكلّ ملاحظةٍ سطرُها بصاحبها ووقتها، وآخرُها هو ما
    // يظهر في عمود الجدول. و`notes` تبقى لما كُتب قبل اليوم.
    notesLog: [
      {
        text: { type: String, trim: true, required: true },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        byName: { type: String, default: '' },
        at: { type: Date, default: Date.now },
      },
    ],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  // `pipeline` (المراحلُ كما تَلزم هذه المعاملة ونسبتُها) تخرج مع كلّ جواب.
  // و`revenue.profit` لا تخرج في جوابٍ ولا في بثٍّ حيّ: الربحُ للإدارة والماليّة،
  // والمعاملةُ تُرسَل إلى كلّ من فتح شاشتَها ويُبَثّ تحديثُها للجميع. فمَن يحقّ
  // له الرقمُ يأخذه في حقلٍ على حدة (راجع getClearance)، لا مدفونًا في الوثيقة.
  {
    timestamps: true,
    id: false,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        if (ret.revenue && typeof ret.revenue === 'object') delete ret.revenue.profit;
        return ret;
      },
    },
  }
);

/**
 * وصلت فاتورةُ النقل؟ ثلاثةُ أبوابٍ تُدخلها: خانتُها الخاصّة، أو إدخالُ «فاتورة
 * النقل» في مراحل السداد بمرفقه، أو بندُها في فاتورة العميل بمرفقه.
 */
function hasTransportInvoice(c) {
  if (!c) return false;
  const t = c.transportInvoice || {};
  if (t.notRequired || t.fileUrl) return true;
  if ((c.paymentStages || []).some((p) => p && p.key === 'transportInvoice' && p.fileUrl)) return true;
  return (c.saleItems || []).some((x) => x && x.key === 'transportInvoice' && x.fileUrl);
}

/** لماذا أُغلِقت هذه المرحلةُ على هذه المعاملة — أو '' إن كانت من طريقها. */
function lockReason(key, route, cargoType) {
  if (key === 'containers_returned' && cargoType === 'vehicles') return 'معاملةُ سيّاراتٍ — لا إرجاعَ حاوياتٍ فيها';
  if (key === 'transport_to_customer' && route === 'yard') return 'اختير النقلُ من الميناء إلى الساحة';
  if (key === 'transport_to_yard' && route === 'customer') return 'اختير النقلُ من الميناء إلى العميل';
  if (key === 'unloaded_stored' || key === 'yard_to_customer') {
    if (route === 'customer') return 'النقلُ إلى العميل مباشرةً — لا تفريغَ ولا تخزين';
    if (route !== 'yard') return 'تُتاح بعد اختيار «النقل من الميناء إلى الساحة»';
  }
  return '';
}

/**
 * ما عُلِّم من المراحل والطريقُ المسلوك — بقاعدةٍ واحدةٍ للجديد والقديم.
 *
 * المعاملاتُ التي عُلِّمت قبل التفريع تحمل «نقل الحاويات» مفتاحًا واحدًا، ولا
 * تحمل «سداد فاتورة إذن التسليم» أصلًا. فتُقرأ بما يدلّ عليه ما بعدها: مَن
 * فرّغ وخزّن مرّ بالساحة، ومَن ربط الإذنَ سدّد فاتورتَه. ولا يُكتب ذلك في
 * القاعدة إلّا عند أوّل تعليمٍ جديد (راجع setStage) — القراءةُ لا تُعدِّل.
 */
function readStages(c) {
  const done = new Set((c && c.stagesDone) || []);
  let route = (c && c.transportRoute) || '';
  if (c && c.pipelineVersion !== 2) {
    // ── وأقدمُ من ذلك: مرحلةٌ بلا علامات ───────────────────────────────────
    // ما استُورد من الماستر (وما أُدخل قبل أن تُعلَّم المراحلُ واحدةً واحدة)
    // يحمل مرحلتَه وحدَها و`stagesDone` فارغة. والمرحلةُ في الماستر آخرُ ما
    // **بلغته** المعاملة («فُوترت»، «أُرجعت الحاويات») — فهي وما قبلها مُنجَز.
    // وإلّا عُدَّت معاملةٌ بلغت الفوترةَ واقفةً عند «استلام الأوراق» بصفرٍ في المئة.
    if (!done.size && c.stage && c.stage !== 'papers_received') {
      const at = LINEAR_V1.indexOf(c.stage);
      for (let i = 0; i <= at; i += 1) done.add(LINEAR_V1[i]);
    }
    if (done.has('containers_transported') && !route) {
      route = done.has('unloaded_stored') ? 'yard' : 'customer';
      done.add(route === 'yard' ? 'transport_to_yard' : 'transport_to_customer');
      if (route === 'yard' && (done.has('containers_returned') || done.has('invoiced'))) done.add('yard_to_customer');
    }
    if (done.has('do_linked') || (c.stageDone && c.stageDone.doInvoicePaid)) done.add('do_invoice_paid');
  }
  done.delete('containers_transported');
  if (!route) {
    if (done.has('transport_to_yard')) route = 'yard';
    else if (done.has('transport_to_customer')) route = 'customer';
  }
  // الفاتورةُ الصادرةُ هي المرحلةُ نفسُها — لا علامةٌ ثانيةٌ تُنسى.
  if (c && c.saleInvoiceNumber) done.add('invoiced');
  return { done, route };
}

/**
 * مراحلُ المعاملة كما تَلزمها: لكلٍّ منها أمُنجزةٌ هي أم مُغلَقة، ومعها النسبة.
 * والنسبةُ على ما يَلزم وحدَه؛ وما دام الطريقُ لم يُختَر فمرحلتا الميناء خانةٌ
 * واحدة (ستُنجَز إحداهما وتُغلَق الأخرى).
 */
function pipelineOf(c) {
  const { done, route } = readStages(c);
  const cargoType = (c && c.cargoType) || 'containers';
  const steps = STAGES.map((key) => {
    const reason = lockReason(key, route, cargoType);
    return {
      key, done: !reason && done.has(key), locked: !!reason, ...(reason ? { reason } : {}),
      // الطريقُ الآخرُ ليس بابًا موصدًا: يُضغَط فيتحوّل الاختيارُ إليه (راجع setStage).
      ...(reason && PORT_LEGS.includes(key) ? { switchable: true } : {}),
    };
  });
  const open = steps.filter((s) => !s.locked);
  const total = open.length - (route ? 0 : 1);
  const doneCount = open.filter((s) => s.done).length;
  const next = open.find((s) => !s.done);
  return {
    route, cargoType, steps, done: doneCount, total,
    percent: total ? Math.min(100, Math.round((doneCount / total) * 100)) : 0,
    next: next ? next.key : '',
  };
}

customsClearanceSchema.virtual('pipeline').get(function pipelineVirtual() { return pipelineOf(this); });

/**
 * صفوفُ الوحدات (حاوياتٍ أو سيّارات) بعدد المعاملة: تُزاد خاناتٌ فارغةٌ حتى
 * العدد، ويُحذَف الفارغُ الزائدُ من آخرها. وما كُتب فيه شيءٌ لا يُحذَف بتصغير
 * العدد — يبقى ويُصحَّح العددُ إليه.
 */
function syncUnits(rows, count) {
  const list = (Array.isArray(rows) ? rows : []).map((r) => ({ ...(r && r.toObject ? r.toObject() : r) }));
  const want = Math.max(0, Math.min(300, Math.round(Number(count) || 0)));
  const filled = (r) => !!(r && (String(r.containerNumber || '').trim() || String(r.returnDate || '').trim()
    || String(r.notes || '').trim() || String(r.declaration || '').trim() || Number(r.exitPermit) > 0 || (r.moves || []).some((m) => m && (m.ref || m.vehicleKind))));
  while (list.length > want && !filled(list[list.length - 1])) list.pop();
  while (list.length < want) list.push({ containerNumber: '', returnDate: '', moves: [] });
  return list;
}

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
  'extraFees',
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
  // ── وصافي النقل فرقٌ لا خانةٌ تُملأ ───────────────────────────────────────
  // كان رقمين يكتبهما الموظّف بيده: «سعر بيع النقل» و«صافي النقل». وهما ليسا
  // مستقلَّين — الثاني هو الأوّل ناقصَ ما ندفعه للناقل (`costs.transport`).
  // فكتابتُهما معًا تفتح بابَ اختلافهما: صافٍ لا يساوي الفرق، وربحٌ مبنيٌّ
  // على رقمٍ كُتب سهوًا. والقاعدةُ واحدة: نأخذ من العميل ٢٠٠٠ وندفع للناقل
  // ١٥٠٠، فربحُنا من النقل ٥٠٠ — يُحسب حيث تُحسب بقيّةُ الأرقام المشتقّة.
  doc.revenue.transportNet = r2(n(doc.revenue.transportSelling) - n(doc.costs.transport));
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
  this.transportInvoiceReceived = hasTransportInvoice(this);
  if (this.isNew) {
    this.pipelineVersion = 2;
    // المعاملةُ تُنشأ بعدد وحداتها، فتُفتَح لها خاناتُها من أوّل يوم.
    const rows = syncUnits(this.containers, this.containerCount);
    if (rows.length !== (this.containers || []).length) this.containers = rows;
  }
  next();
});

/**
 * الشهرُ والسنة يُملآن لكلّ معاملة — لا لمستورَدات الماستر وحدها.
 *
 * كانا عمودين من شيت الماستر لا يملؤهما شيءٌ في النظام، والتحليلاتُ والتقريرُ
 * الماليّ وفلاترُ السنة والشهر كلُّها تقرأ بهما — فكلُّ معاملةٍ أُنشئت هنا
 * بعد الاستيراد غائبةٌ عنها. فالفارغُ يُملأ من أوّل تاريخٍ معروف: استلامُ
 * الورق، ثمّ البيان، ثمّ الإنشاء (بتوقيت الرياض). وما كُتب بيدٍ لا يُمسّ.
 */
function periodFrom(doc) {
  const s = String(doc.papersReceivedDate || doc.declarationDate || '').slice(0, 10);
  let d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00Z`) : null;
  if (!d || isNaN(d)) d = new Date((doc.createdAt ? new Date(doc.createdAt).getTime() : Date.now()) + 3 * 3600000);
  return { periodYear: d.getUTCFullYear(), periodMonth: d.getUTCMonth() + 1 };
}
customsClearanceSchema.pre('save', function (next) {
  if (!this.periodYear || !this.periodMonth) {
    const p = periodFrom(this);
    if (!this.periodYear) this.periodYear = p.periodYear;
    if (!this.periodMonth) this.periodMonth = p.periodMonth;
  }
  next();
});
customsClearanceSchema.statics.periodFrom = periodFrom;

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
module.exports.LEGACY_STAGES = LEGACY_STAGES;
module.exports.TRANSPORT_LEGS = TRANSPORT_LEGS;
module.exports.CARGO_TYPES = CARGO_TYPES;
module.exports.VEHICLE_KINDS = VEHICLE_KINDS;
module.exports.pipelineOf = pipelineOf;
module.exports.readStages = readStages;
module.exports.lockReason = lockReason;
module.exports.hasTransportInvoice = hasTransportInvoice;
module.exports.syncUnits = syncUnits;
module.exports.COST_KEYS = COST_KEYS;
module.exports.MARGIN_KEYS = MARGIN_KEYS;
module.exports.recomputeTotals = recomputeTotals;
