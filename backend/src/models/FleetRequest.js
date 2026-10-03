/**
 * طلباتُ الأسطول إلى الصيانة — «أحتاج هذه الشاحنةَ وصيانتُها متأخّرة».
 *
 * ── ما الذي استدعى جدولًا جديدًا ─────────────────────────────────────────────
 * مرآةُ لوكيشن سوليوشن تقول عن شاحنةٍ «فات موعدُ صيانتها بألفٍ وسبعِمئةِ
 * كيلومتر». وكان ذلك شارةً حمراءَ على بطاقتها تُقرأ ولا تمنع: تُحمَّل الشاحنةُ
 * وتسير ألفًا وخمسَمئةِ كيلومترٍ أخرى، ويُكتشَف الأمرُ حين تقف في الطريق.
 *
 * والمنعُ وحدَه لا يكفي: الحمولةُ قد تكون ساعتَين إلى جدّة، ومديرُ الصيانة قد
 * يقول «امشِ بها واحضر إليَّ الخميس». فهذا الجدولُ هو ذلك الحوارُ مكتوبًا:
 * يُطلَب، فيُوافَق أو يُرفَض، ويبقى مَن وافق ومتى وبأيّ سبب.
 *
 * ── والموافقةُ تُستهلَك بحمولةٍ واحدة ────────────────────────────────────────
 * موافقةٌ مفتوحةٌ تعني شاحنةً مفتوحةً إلى الأبد: تُسجَّل مرّةً ثمّ تسير سنةً
 * بلا صيانة. فكلُّ موافقةٍ لحمولةٍ واحدة (`usedBy`)، والتالية تُطلَب من جديد
 * — إلّا أن تُسجَّل الخدمةُ فتزول الحاجةُ إلى الطلب أصلًا.
 */
const mongoose = require('mongoose');

const fleetRequestSchema = new mongoose.Schema(
  {
    // اليومَ نوعٌ واحد، والجدولُ مُعَدٌّ لغيره (قطعةٌ، فحصٌ، إدخالُ ورشة).
    kind: { type: String, enum: ['maintenance_override'], default: 'maintenance_override', index: true },

    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetVehicle', required: true, index: true },
    plate: { type: String, trim: true, default: '' },

    // لقطةُ ما فات ساعةَ الطلب: الحالةُ تتغيّر حين تُسجَّل الخدمة، ومن يقرأ
    // الطلبَ بعد شهرٍ يجب أن يعرف على أيّ شيءٍ وافق.
    service: { type: String, trim: true, default: '' },
    kmToService: { type: Number, default: null },
    odometerKm: { type: Number, default: null },

    reason: { type: String, trim: true, default: '' },
    // ما الحمولةُ المنتظرة — تُقرأ في قرار الصيانة: «ساعتان إلى جدّة» ليست
    // «ألفًا وأربعَمئةِ كيلومترٍ إلى جيزان».
    load: {
      customerName: { type: String, trim: true, default: '' },
      fromCity: { type: String, trim: true, default: '' },
      toCity: { type: String, trim: true, default: '' },
      loadDate: { type: String, trim: true, default: '' },
    },

    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requestedByName: { type: String, default: '' },

    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedByName: { type: String, default: '' },
    decidedAt: { type: Date },
    decisionNote: { type: String, trim: true, default: '' },

    usedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetShipment', default: null },
    usedAt: { type: Date },
  },
  { timestamps: true }
);

// طلبٌ معلّقٌ واحدٌ لكلّ شاحنة: ضغطُ الزرّ مرّتين لا يفتح طلبين.
fleetRequestSchema.index({ vehicle: 1, status: 1, usedBy: 1 });

module.exports = mongoose.model('FleetRequest', fleetRequestSchema);
