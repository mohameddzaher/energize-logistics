const mongoose = require('mongoose');

/**
 * سجلّ السيارة الشهريّ — إدارة الأسطول.
 *
 * ── لماذا سجلٌّ للسيارة لا للحمولة ─────────────────────────────────────────
 * متابعةُ الحمولة تُجيب سؤالًا واحدًا: أين هذه الشحنة الآن. وسؤالُ المشرف
 * الآخر لا تُجيبه: «ماذا جرى لهذه السيّارة الشهر الماضي؟» — عطلٌ يومَ ٩،
 * إطارٌ يوم ١٤، سائقٌ تغيّر يوم ٢٠، وست حمولات بينها. هذه أحداثُ السيّارة لا
 * أحداثُ شحنةٍ بعينها، وكانت تتبعثر بين سجلّات ستّ شحنات فلا تُقرأ مجتمعة.
 *
 * ── والشهرُ يُقفل من نفسِه ───────────────────────────────────────────────────
 * السجلُّ فترةٌ لا دفترٌ مفتوح: يبدأ يوم ١ وينتهي بآخر يوم في الشهر، ومتى جاء
 * أوّلُ الشهر التالي أُقفل ما قبله. والإقفالُ هنا **حقيقةٌ عن الزمن لا خانةٌ
 * يضغطها أحد**: لا وظيفةَ مجدولةً تنساه، ولا علمًا يُرفع متأخّرًا فيبدو
 * الشهرُ مفتوحًا وقد انقضى. `isClosed(monthKey)` تحسبها في سطر.
 *
 * وما أُضيف إلى شهرٍ مُقفل يُوسَم `lateEntry` ولا يُدَسّ: المدير قد يحتاج قيدَ
 * عطلٍ نُسي، لكنّ من يقرأ السجلّ بعدها يجب أن يرى أنّه كُتب بعد الإقفال.
 */

// أنواعُ القيد. الحمولاتُ تُشتقّ من الشحنات نفسِها ولا تُكتب هنا — هذه
// للأحداث التي لا مكان لها إلّا هنا.
const LOG_KINDS = [
  'breakdown',    // عطل
  'maintenance',  // صيانة
  'tire',         // إطارات
  'fuel',         // وقود
  'accident',     // حادث
  'violation',    // مخالفة
  'driver',       // تغيير سائق
  'idle',         // توقّف/ركن
  'note',         // ملاحظة
];

const KIND_LABELS = {
  breakdown: { ar: 'عطل', en: 'Breakdown' },
  maintenance: { ar: 'صيانة', en: 'Maintenance' },
  tire: { ar: 'إطارات', en: 'Tyres' },
  fuel: { ar: 'وقود', en: 'Fuel' },
  accident: { ar: 'حادث', en: 'Accident' },
  violation: { ar: 'مخالفة', en: 'Violation' },
  driver: { ar: 'تغيير سائق', en: 'Driver change' },
  idle: { ar: 'توقّف', en: 'Idle' },
  note: { ar: 'ملاحظة', en: 'Note' },
};

/** مفتاح الشهر من تاريخٍ أو نصّ: 'YYYY-MM'. */
const monthKeyOf = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** أوّلُ الشهر التالي مرّ؟ إذن الشهرُ مقفل. */
const isClosed = (monthKey, now = new Date()) => {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return false;
  return String(monthKey) < monthKeyOf(now);
};

/** حدّا الشهر بالـUTC: [أوّلُ يومٍ ٠٠:٠٠ ، آخرُ لحظةٍ في آخر يوم]. */
const monthRange = (monthKey) => {
  const [y, m] = String(monthKey).split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  return { from, to };
};

const fleetVehicleLogSchema = new mongoose.Schema({
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetVehicle', required: true },
  // لقطةٌ من اللوحة: السجلُّ يُقرأ بعد سنة، ولو حُذفت السيّارة أو غُيّرت لوحتُها
  // بقي القيدُ يقول على أيِّ سيّارةٍ كُتب.
  vehiclePlate: { type: String, trim: true, default: '', index: true },

  // اليوم الذي وقع فيه الحدث — لا يوم الكتابة.
  at: { type: Date, required: true, index: true },
  monthKey: { type: String, default: '', index: true }, // YYYY-MM — مشتقّ من at

  kind: { type: String, enum: LOG_KINDS, default: 'note', index: true },
  text: { type: String, trim: true, default: '' },
  location: { type: String, trim: true, default: '' },
  cost: { type: Number, default: 0 },

  // القيدُ قد يخصّ حمولةً بعينها — عطلٌ وقع وهي محمَّلة — وقد لا يخصّ شيئًا.
  shipment: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetShipment', default: null, index: true },
  waybillNumber: { type: Number, default: null },

  driverName: { type: String, trim: true, default: '' },

  // كُتب بعد إقفال شهره.
  lateEntry: { type: Boolean, default: false },

  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  byName: { type: String, trim: true, default: '' },
}, { timestamps: true });

fleetVehicleLogSchema.index({ vehicle: 1, at: -1 });
fleetVehicleLogSchema.index({ monthKey: 1, vehicle: 1 });

// monthKey يُشتقّ دائمًا من `at` ولا يُقبل من العميل: لو أُرسل مخالفًا لتاريخه
// عاش القيدُ في شهرٍ ليس شهرَه، فاختلّ الإقفال والتصفية معًا.
fleetVehicleLogSchema.pre('save', function (next) {
  if (this.at) this.monthKey = monthKeyOf(this.at);
  next();
});

const bust = () => { try { require('../utils/ttlCache').clear('fleet:'); } catch (e) { /* noop */ } };
fleetVehicleLogSchema.post('save', bust);
fleetVehicleLogSchema.post(/^find.*[UD]/, bust);

module.exports = mongoose.models.FleetVehicleLog || mongoose.model('FleetVehicleLog', fleetVehicleLogSchema);
module.exports.LOG_KINDS = LOG_KINDS;
module.exports.KIND_LABELS = KIND_LABELS;
module.exports.monthKeyOf = monthKeyOf;
module.exports.isClosed = isClosed;
module.exports.monthRange = monthRange;
