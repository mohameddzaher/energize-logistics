const mongoose = require('mongoose');

// One shipment: created here (`source: 'system'`) or copied from the operations
// platform. Both carry a manifest number and have a row in the operations workflow.
const routeStop = { type: String, trim: true, default: '' };

const shipmentOrderSchema = new mongoose.Schema(
  {
    // Waybill number, equal to the manifest number on shipments created here.
    // Issued from a counter and never reused, even after deletes.
    waybillNumber: { type: Number, unique: true, sparse: true, index: true },

    source: { type: String, enum: ['system', 'platform'], default: 'system', index: true },
    /** Manifest number, one series across platform and system shipments. */
    graduationNumber: { type: Number, default: null, index: true },
    /** معرّفُ المنصّة: به تُطابَق إعادةُ المزامنة فلا تُكرِّر. */
    externalId: { type: String, trim: true, default: '', index: true },
    /** The number as shown: the manifest number. */
    reference: { type: String, trim: true, default: '', index: true },

    // ── الاستلام والتسليم ──────────────────────────────────────────────────
    fromCity: routeStop,
    toCity: routeStop,
    addressFrom: routeStop,
    addressTo: routeStop,

    // ── تفاصيل الشحنة ─────────────────────────────────────────────────────
    truckType: { type: String, trim: true, default: '' },
    cargoType: { type: String, trim: true, default: '' },
    truckLength: { type: String, trim: true, default: '' },
    quantity: { type: Number, default: null },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderCustomer', default: null, index: true },
    // Snapshot — the list and the waybill must keep reading correctly even if
    // the customer is later renamed or removed.
    customerName: { type: String, trim: true, default: '', index: true },

    driverName: { type: String, trim: true, default: '' },
    driverPhone: { type: String, trim: true, default: '' },
    vehicleName: { type: String, trim: true, default: '' }, // snapshot: السيارة / رقم اللوحة
    vehiclePlate: { type: String, trim: true, default: '', index: true },
    // رقمُ المرجع عند المنصّة — يُحفظ كما هو ولا يُخلط برقم البوليصة عندنا.
    externalRef: { type: String, trim: true, default: '' },
    // Refs behind the snapshots — ours when supplier is null, a 3PL's otherwise.
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderVehicle', default: null },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderSupplier', default: null, index: true },
    // ── لقطةُ اسم المورّد ─────────────────────────────────────────────────
    // كانت الخانةُ غائبةً عن المخطّط، فكلُّ اسمِ مورّدٍ كُتب فيها سقط صامتًا
    // (mongoose يتجاهل ما لا يعرف): ثلاثةٌ وثلاثون ألفَ شحنةٍ بلا مورّد،
    // والتحليلاتُ تقول «موردون: صفر» وهي محقّةٌ فيما تقرأ.
    //
    // ولقطةٌ لا مرجعٌ وحدَه: البوليصةُ تُقرأ بعد سنة، ومورّدُ المنصّة قد لا
    // يكون في سجلّنا أصلًا — فالاسمُ يبقى ولو لم يوجد الصفّ.
    supplierName: { type: String, trim: true, default: '', index: true },

    // المندوب — whoever created the order, stamped from their account, never
    // typed by hand.
    agentName: { type: String, trim: true, default: '' },

    // ── السيلز التشغيليّ (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢) ─────────────────────────
    // مَن جاء بهذه الحمولة إلى الشركة — من فريق المبيعات أو العمليّات. واسمُه
    // لقطةٌ كي يبقى في التحليلات ولو غادر.
    salesRep: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    salesRepName: { type: String, trim: true, default: '', index: true },

    // ── سببُ الإلغاء — لا تُلغى شحنةٌ بلا سبب (٢٠٢٦/١٠/٢٢) ───────────────────
    // من قائمة «أسباب الإلغاء» في إعدادات القسم (so_cancel_reason)، بنصّها.
    cancelReason: { type: String, trim: true, default: '', index: true },

    // ── الأسعار والتوقيت ──────────────────────────────────────────────────
    pickupTime: { type: Date, default: null },
    startTime: { type: Date, default: null },
    arrivalTime: { type: Date, default: null },
    sellPrice: { type: Number, default: null },
    buyPrice: { type: Number, default: null },

    // ── المدفوعات ─────────────────────────────────────────────────────────
    // «نوع الدفع» — أحدُ الأنواع الأربعة بمفاتيح سير عمل التشغيل
    // (deferred_cash | deferred_invoice | cash_3pl | cash_ht). حلّ في نموذج
    // الإنشاء محلَّ «نوع تأجير السائق» (٢٠٢٦/١٠/٢١)، و`paymentMethod` يُشتقّ
    // منه في الخادم — راجع utils/shipmentOrderPayment.
    paymentSubtype: {
      type: String, trim: true, default: '',
      enum: ['', ...require('../utils/paymentType').SUBTYPE_KEYS],
    },
    // نوعُ تأجير السائق: لم يعد يُسأل في النموذج. يبقى لما سُجِّل قبله، ولما
    // تنقله المنصّة (`driver_rental_type`)، ويُطبَع في خانة «إيجار» بالبوليصة.
    driverRentType: { type: String, trim: true, default: '' },
    paymentMethod: { type: String, trim: true, default: '' },
    driverRentPrice: { type: Number, default: null },
    branch: { type: String, trim: true, default: '' },

    // Same lifecycle keys as the ops mirror, so the team reads one vocabulary
    // across both — but stored here, owned here.
    //
    // ── ولا `enum` هنا ────────────────────────────────────────────────────
    // القسمُ يملك أن يزيد حالةً من إعداداته، و`enum` مكتوبةٌ في المخطَّط تجعل
    // الحالةَ المُضافة تُرفَض عند الحفظ بعد أن ظهرت في الشاشة — فيبدو الإعدادُ
    // كاذبًا. فالتحقّقُ في المتحكّم مقابل المفردات الحيّة
    // (`utils/shipmentOrderStatuses`)، وهي التي تعرف المكتوبَ في الشيفرة
    // والمُضافَ من الإعدادات معًا.
    status: { type: String, default: 'requesting', trim: true, index: true },
    notes: { type: String, trim: true, default: '' },

    // ── البوليصةُ والحاويةُ، وربطُها بمعاملة التخليص (٢٠٢٦/١٠/٢٦) ───────────
    // اختياريّتان في «الاستلام والتسليم». ومنهما — أو من رقم الشحنة مكتوبًا في
    // خانة نقل الحاوية في المعاملة — تُربط الشحنةُ بمعاملتها في الاتّجاهين:
    // تُكتب هنا فتظهر هناك، وتُكتب هناك فتُملأ هنا. يكتب `customsLink`
    // services/customsOpsLink وحدَه، بالشكل نفسِه الذي على كشف التشغيل.
    // السلفةُ المدفوعةُ للسائق على هذه الشحنة — رقمٌ يُكتب في «الأسعار والتوقيت».
    advanceAmount: { type: Number, default: null },
    blNumber: { type: String, trim: true, default: '' },
    containerNumber: { type: String, trim: true, default: '' },
    customsLink: {
      type: new mongoose.Schema({
        clearance: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomsClearance', default: null },
        refNumber: { type: String, default: '' },
        blNumber: { type: String, default: '' },
        customerName: { type: String, default: '' },
        containers: { type: [String], default: [] },
        via: { type: String, enum: ['move', 'bl', 'container', 'manual', 'unlinked'], default: 'move' },
        at: { type: Date, default: null },
        byName: { type: String, default: '' },
      }, { _id: false }),
      default: undefined,
    },

    // ── المتابعةُ هنا تغييرُ حالةٍ لا مكالمة ────────────────────────────────
    // في إدارة الأسطول السيّارةُ سيّارتُنا، فالمتابعةُ مكالمةٌ مع سائقنا: أين
    // أنت الآن. وهنا الشاحنةُ شاحنةُ مورّد، والذي يُتابَع هو **موضعُ الطلب من
    // دورته**: طُلب، حُمِّل، في الطريق، وصل، أُرسل السند. فالمتابعةُ نقلةُ
    // حالةٍ ومعها سببُها إن كان له سبب.
    //
    // ويُقيَّد كلُّ انتقال: «متى صارت في الطريق؟» و«من أخّرها؟» سؤالان يُسألان
    // بعد أسبوع، ولا جوابَ لهما إن حُفظت الحالةُ الأخيرةُ وحدَها.
    //
    // ── والنقلةُ قد تحمل ورقتَها ────────────────────────────────────────────
    // «أُرسل السند» قولٌ عن ورقةٍ أُرسلت، فالورقةُ تُرفَق مع النقلة نفسِها لا
    // في مكانٍ آخر يُبحَث عنه لاحقًا (راجع REQUIRE_FILE في المتحكّم).
    statusLog: [{
      from: { type: String, default: '' },
      to: { type: String, default: '' },
      note: { type: String, trim: true, default: '' },
      at: { type: Date, default: Date.now },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      byName: { type: String, default: '' },
      fileUrl: { type: String, default: '' },
      fileName: { type: String, default: '' },
      mimeType: { type: String, default: '' },
      size: { type: Number, default: 0 },
      // ملاحظةُ المتابعة تُعدَّل (٢٠٢٦/١٠/٢٦) — ويبقى ظاهرًا أنّها عُدّلت ومَن عدّلها.
      editedAt: { type: Date, default: null },
      editedByName: { type: String, default: '' },
    }],

    // Values of user-added inputs from the form-settings page, keyed by the
    // field's key. Mixed on purpose: those fields are the user's to invent.
    customFields: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shipmentOrderSchema.index({ createdAt: -1 });
shipmentOrderSchema.index({ source: 1, createdAt: -1 });
shipmentOrderSchema.index({ 'customsLink.clearance': 1 }, { partialFilterExpression: { 'customsLink.clearance': { $type: 'objectId' } } });

shipmentOrderSchema.index({ fromCity: 1, toCity: 1 });

// The waybill counter lives in its own tiny collection so the number survives
// deletes: a voided shipment must not free its number for someone else.
const counterSchema = new mongoose.Schema({ _id: String, seq: Number });
const Counter = mongoose.models.ShipmentOrderCounter
  || mongoose.model('ShipmentOrderCounter', counterSchema);

shipmentOrderSchema.pre('save', async function (next) {
  if (this.source === 'platform') return next();
  if (this.isNew && this.waybillNumber == null) {
    try {
      // Continues the platform's manifest series. The platform can still issue
      // numbers until it is switched off, so the counter never trails its highest.
      const top = await this.constructor.findOne({ source: 'platform', graduationNumber: { $ne: null } })
        .sort({ graduationNumber: -1 }).select('graduationNumber').lean();
      if (top) await Counter.updateOne({ _id: 'waybill' }, { $max: { seq: top.graduationNumber } }, { upsert: true });
      const c = await Counter.findOneAndUpdate({ _id: 'waybill' }, { $inc: { seq: 1 } }, { new: true, upsert: true });
      this.waybillNumber = c.seq;
      this.graduationNumber = c.seq;
    } catch (e) {
      return next(e);
    }
  }
  next();
});

shipmentOrderSchema.pre('save', function (next) {
  // Derived, never typed: the shown reference is the manifest number.
  this.reference = this.graduationNumber != null ? String(this.graduationNumber) : '';
  next();
});

module.exports = mongoose.models.ShipmentOrder || mongoose.model('ShipmentOrder', shipmentOrderSchema);
