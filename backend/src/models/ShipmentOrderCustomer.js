const mongoose = require('mongoose');

// A customer of the shipment-orders trial section, with the two things that
// make creating an order fast: the prices agreed per route, and the defaults
// they usually ship with.
//
// Separate from the CRM/ops customer bases on purpose — this whole section is
// an experiment, and its data must be disposable without touching anything the
// rest of the system depends on. If the trial graduates, migrating a handful of
// rows is trivial; untangling shared rows would not be.
const shipmentOrderCustomerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },

    // بياناتُ العميل كما تحملها منصّةُ الأوبريشن.
    externalId: { type: String, trim: true, default: '', index: true },
    // فردٌ أم شركة: الفاتورةُ تختلف، والسعرُ يختلف.
    customerType: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },

    // The agreed price list: "من جدة للرياض بكذا". Picking this customer plus a
    // from/to on the create form pulls the matching price automatically; a NEW
    // route priced on the form is appended here, so the profile learns as the
    // work happens instead of someone maintaining it by hand.
    // ── والسعرُ أحدثُ ما اتُّفق عليه ────────────────────────────────────────
    // المسارُ الواحد يتكرّر خمسين مرّةً في السنة بأسعارٍ تتغيّر. فلا يُحفظ له
    // صفٌّ لكلّ مرّة — صفٌّ واحدٌ يحمل **آخرَ** سعرٍ عُمل به، ومعه تاريخُه
    // ومصدرُه: من أين جاء هذا الرقم (شحنةٌ أُنشئت، أو تقريرُ الفروع، أو يدُ
    // موظّف)، ومتى. والأحدثُ يغلب الأقدمَ مهما كان مصدرُه.
    //
    // و`at` تاريخُ **العمل** لا تاريخُ الكتابة: صفٌّ يُستورَد اليوم عن شحنةٍ
    // في مارس لا يُسقِط سعرًا اتُّفق عليه في أغسطس.
    routes: [{
      fromCity: { type: String, trim: true, default: '' },
      toCity: { type: String, trim: true, default: '' },
      price: { type: Number, default: null },
      at: { type: Date, default: null },
      source: { type: String, trim: true, default: '' }, // order | platform | sheet | manual | private
      hits: { type: Number, default: 1 },                 // كم مرّةً رأينا هذا المسار
    }],

    // What this customer usually ships with — prefilled, always editable.
    defaults: {
      truckType: { type: String, trim: true, default: '' },
      cargoType: { type: String, trim: true, default: '' },
      paymentMethod: { type: String, trim: true, default: '' },
      driverRentType: { type: String, trim: true, default: '' },
      branch: { type: String, trim: true, default: '' },
    },

    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shipmentOrderCustomerSchema.index({ name: 1 });

// ── فهرسُ أسعار المسارات يُمسَح مع كلّ كتابة ─────────────────────────────────
// «التشغيل — خاصّ» يحفظ فهرسَ (عميل|مسار ← سعر) دقيقةً بدل قراءة ٦٦٨ عميلًا في
// كلّ نداء. فأيُّ كتابةٍ على عميلٍ — حفظٌ أو تحديثٌ أو حذف، من أيّ شاشة — تمسحه
// هنا في موضعٍ واحد، فلا يُنسى مسارُ كتابةٍ فيبقى سعرٌ قديم.
// وقائمةُ العملاء في «طلبات الشحنات» محفوظةٌ كذلك (so:registry) — تُمسَح معه.
const clearRouteIndex = () => {
  try {
    const cache = require('../utils/ttlCache');
    cache.clear('opsprivate:routes');
    cache.clear('so:registry:');
  } catch (_) { /* */ }
};
for (const op of ['save', 'findOneAndUpdate', 'updateOne', 'updateMany', 'insertMany', 'bulkWrite', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  shipmentOrderCustomerSchema.post(op, clearRouteIndex);
}

module.exports = mongoose.models.ShipmentOrderCustomer
  || mongoose.model('ShipmentOrderCustomer', shipmentOrderCustomerSchema);
