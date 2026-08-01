const mongoose = require('mongoose');

// إدارة الأسطول — the section that runs OUR OWN trucks, as opposed to the
// shipment-orders trial which books supplier trucks. One file for the four
// models because they only ever change together: a shipment snapshots the
// vehicle and drivers it was booked with, and the drivers' assignment moves
// between vehicles as part of booking.

// ── Vehicles: the 57 trucks (seeded from Location Solutions) ────────────────
const fleetVehicleSchema = new mongoose.Schema({
  plate: { type: String, required: true, unique: true, trim: true },
  name: { type: String, trim: true, default: '' },
  trailerType: { type: String, trim: true, default: 'سطحة' }, // سطحة / ستارة / …
  gpsType: { type: String, trim: true, default: 'LS' },       // LS / EX
  brand: { type: String, trim: true, default: '' },           // ماركة السيارة — للبوليصة
  color: { type: String, trim: true, default: '' },           // لون السيارة — للبوليصة
  // الهدف الشهري للدخل لهذه السيارة (ر.س) — يُقارَن بالمحقَّق في التحليلات.
  // الافتراضي من إعدادات القسم (FleetConfig.defaultMonthlyTarget) عند الإنشاء.
  monthlyTarget: { type: Number, default: 27000 },
  // المشرف المسؤول عن هذه السيارة: يعيّنه مدير القسم، وكل ما يراه المشرف في
  // القسم (حمولات، سائقون، لوحة، تحليلات) محصور في سياراته هذه.
  supervisor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  supervisorName: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

// ── Drivers: ~70 people across the 57 trucks — one or two per vehicle ───────
const fleetDriverSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, trim: true, default: '' },
  iqama: { type: String, trim: true, default: '' },
  nationality: { type: String, trim: true, default: '' }, // الجنسية — للبوليصة
  // حالة السائق: does he work at the moment (sick / on leave ⇒ false)?
  working: { type: Boolean, default: true },
  // WHY he is off — مرضية / إجازة / أخرى — so the dashboard can answer "who is
  // sick and who is on leave" instead of one flat "off" count.
  offReason: { type: String, enum: ['', 'sick', 'leave', 'other'], default: '' },
  offNote: { type: String, trim: true, default: '' },
  // على الكفالة أم لا
  onSponsorship: { type: Boolean, default: true },
  // The truck he is currently on. Reassigning him — including implicitly, by
  // picking him on a shipment for another truck — just moves this pointer;
  // the shipment events keep the story.
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetVehicle', default: null, index: true },
  notes: { type: String, trim: true, default: '' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });
fleetDriverSchema.index({ name: 1 });
fleetDriverSchema.index({ vehicle: 1 }); // every board/list joins drivers by seat

// ── Customers of the fleet section (separate register from the trial's) ─────
const fleetCustomerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, default: '' },
  // نوع العميل: عملاء النقل الثقيل (عملاء قسم الأسطول) أو عملاء الفروع.
  customerType: { type: String, enum: ['heavy', 'branch'], default: 'heavy', index: true },
  // تقييمنا للعميل (0–5) — يظهر في ترتيب العملاء بالتحليلات.
  rating: { type: Number, default: 0, min: 0, max: 5 },
  routes: [{
    fromCity: { type: String, trim: true, default: '' },
    toCity: { type: String, trim: true, default: '' },
    price: { type: Number, default: null },
  }],
  notes: { type: String, trim: true, default: '' },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
fleetCustomerSchema.index({ name: 1 });

// ── Shipments (الحمولات) ────────────────────────────────────────────────────
const fleetShipmentSchema = new mongoose.Schema({
  // بوليصة الشحن. Its OWN series, starting at 100001, six digits — visibly a
  // different scheme from the shipment-orders 500-series, so the two can never
  // be mistaken for each other or collide.
  waybillNumber: { type: Number, unique: true, index: true },

  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetCustomer', default: null, index: true },
  customerName: { type: String, trim: true, default: '', index: true },

  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetVehicle', default: null },
  // Snapshots: the بوليصة must read the same forever, whatever later happens
  // to the vehicle row.
  vehiclePlate: { type: String, trim: true, default: '' },
  trailerType: { type: String, trim: true, default: '' },
  gpsType: { type: String, trim: true, default: '' },
  vehicleBrand: { type: String, trim: true, default: '' }, // snapshot — للبوليصة
  vehicleColor: { type: String, trim: true, default: '' }, // snapshot — للبوليصة

  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetDriver', default: null },
  driverName: { type: String, trim: true, default: '' },
  driverPhone: { type: String, trim: true, default: '' },
  driverIqama: { type: String, trim: true, default: '' },       // snapshot — للبوليصة
  driverNationality: { type: String, trim: true, default: '' }, // snapshot — للبوليصة
  // حقول البوليصة/الحمولة (تُدخَل وقت الإنشاء):
  rentType: { type: String, trim: true, default: '' },      // نوع الإيجار (قدام/راجعة…) — قائمة قابلة للتعديل
  paymentType: { type: String, trim: true, default: '' },   // نوع الدفع (كاش/ضريبي) — قائمة قابلة للتعديل
  loadType: { type: String, trim: true, default: '' },      // نوع الحمولة — قائمة أو كتابة يدوية
  // إيجار السيارة — الدخل الفعلي لقسم إدارة الأسطول من هذه الحمولة (أساس التحليلات).
  price: { type: Number, default: 0, index: true },
  // الإيجار كامل (اختياري) — المبلغ الذي يستلمه السائق من العميل. عادةً مع «قدام».
  // الفرق (fullRent − price) حصة قسم الفروع (سيناريو 3PL). صفر يعني لا يوجد.
  fullRent: { type: Number, default: 0 },
  // نوع العميل لهذه الحمولة (لقطة): نقل ثقيل أم فرع — للتقارير حتى لو تغيّر العميل لاحقًا.
  customerType: { type: String, enum: ['heavy', 'branch', ''], default: '', index: true },
  driverExpense: { type: Number, default: 0 },              // مصروف السائق (كان «سلفة السائق»)
  driverAdvance: { type: String, trim: true, default: '' }, // legacy — يُقرأ للبوليصات القديمة فقط
  // بونص يوم الجمعة: عند تفعيله يُضاف مبلغ ثابت (FleetConfig.fridayBonusAmount) لمصروف السائق.
  fridayBonus: { type: Boolean, default: false },
  branch: { type: String, trim: true, default: '' },        // الفرع — من فروع الشركة
  // سائق ثانٍ — for loads that must arrive fast, two drivers share the wheel.
  secondDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetDriver', default: null },
  secondDriverName: { type: String, trim: true, default: '' },

  // المشرف — stamped from the creating account, and a first-class filter.
  supervisor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  supervisorName: { type: String, trim: true, default: '' },

  loadDate: { type: Date, default: null }, // تاريخ التحميل
  fromCity: { type: String, trim: true, default: '' },
  toCity: { type: String, trim: true, default: '' },

  status: {
    type: String,
    enum: [
      'requesting', 'loading', 'uploaded', 'on_way', 'arrived',
      'bond_sent', 'bond_received', 'late', 'invoiced', 'cancelled',
    ],
    default: 'requesting',
    index: true,
  },

  // Follow-up state, denormalized for the list: the details live in the events.
  lastContactAt: { type: Date, default: null },   // آخر تواصل مع السائق
  expectedArrival: { type: Date, default: null }, // متوقع الوصول — optional

  notes: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
fleetShipmentSchema.index({ createdAt: -1 });
// The board and the vehicle picker resolve each truck's active trip; the list
// filters by status + sorts by recency; the follow-up sweep scans in-flight
// loads by last contact.
fleetShipmentSchema.index({ vehicle: 1, status: 1 });
fleetShipmentSchema.index({ status: 1, createdAt: -1 });
fleetShipmentSchema.index({ status: 1, lastContactAt: 1 });

const counterSchema = new mongoose.Schema({ _id: String, seq: Number });
const FleetCounter = mongoose.models.FleetCounter || mongoose.model('FleetCounter', counterSchema);

fleetShipmentSchema.pre('save', async function (next) {
  if (this.isNew && this.waybillNumber == null) {
    try {
      const c = await FleetCounter.findOneAndUpdate(
        { _id: 'waybill' }, { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      if (c.seq < 100001) { c.seq = 100001; await c.save(); }
      this.waybillNumber = c.seq;
    } catch (e) { return next(e); }
  }
  next();
});

// ── Events: the append-only story of each shipment ──────────────────────────
// Everything that ever happened — creation, edits, status flips, driver moves,
// and every follow-up call — with who and when. Nothing here is updated or
// deleted; corrections are new events. This is what "افتح تفاصيلها تلاقي كل
// حاجة حصلت" reads from.
const fleetEventSchema = new mongoose.Schema({
  shipment: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetShipment', required: true, index: true },
  type: {
    type: String,
    required: true,
    enum: ['created', 'updated', 'status', 'driver_change', 'followup'],
  },
  // followup: { contactTime, currentLocation, note, expectedArrival }
  // status:   { from, to } · updated: { fields } · driver_change: { text }
  data: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  byName: { type: String, trim: true, default: '' },
}, { timestamps: true });
fleetEventSchema.index({ shipment: 1, createdAt: -1 });

// ── Section-wide settings (singleton) ───────────────────────────────────────
// One editable row that holds the fleet section's tunable numbers. Dropdown
// option lists (rent type / payment type / load type) live in the shared Lookup
// system, not here.
const fleetConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'fleet', unique: true },
  fridayBonusAmount: { type: Number, default: 50 },      // ريال يُضاف لمصروف السائق يوم الجمعة
  defaultMonthlyTarget: { type: Number, default: 27000 }, // الهدف الشهري الافتراضي للسيارة
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = {
  FleetVehicle: mongoose.models.FleetVehicle || mongoose.model('FleetVehicle', fleetVehicleSchema),
  FleetDriver: mongoose.models.FleetDriver || mongoose.model('FleetDriver', fleetDriverSchema),
  FleetCustomer: mongoose.models.FleetCustomer || mongoose.model('FleetCustomer', fleetCustomerSchema),
  FleetShipment: mongoose.models.FleetShipment || mongoose.model('FleetShipment', fleetShipmentSchema),
  FleetEvent: mongoose.models.FleetEvent || mongoose.model('FleetEvent', fleetEventSchema),
  FleetConfig: mongoose.models.FleetConfig || mongoose.model('FleetConfig', fleetConfigSchema),
};
