const mongoose = require('mongoose');

/**
 * سائقو شاحنات الناقلين — سجلٌّ كان ناقصًا بالكامل.
 *
 * ── الحال قبل ──────────────────────────────────────────────────────────────
 * القسمُ يسجّل المورّدَ وشاحنتَه، وسائقُها اسمٌ ورقمُ هاتفٍ مكتوبان على صفّ
 * الشاحنة (`defaultDriverName`/`defaultDriverPhone`) — لا سجلَّ له. فمن سأل
 * «أرِني سوّاق هذا المورّد» لم يكن له جواب، ومن أراد رقمَ إقامة السائق أو
 * تاريخَ انتهاء بطاقة تشغيله لم يجدهما، ومن كتب الاسمَ بهجاءٍ آخر صار رجلين.
 *
 * ومنصّةُ الأوبريشن تحمل سبعةَ عشرَ ألفًا وخمسَمئةٍ وأربعةً وستّين سائقًا لكلٍّ
 * ملفٌّ كامل. فهذا السجلُّ مرآتُها هنا.
 *
 * ── والسائقُ هو ما يربط الشاحنةَ بمالكها ──────────────────────────────────
 * سجلُّ المركبات في المنصّة لا يحمل مالكَها؛ سجلُّ السائق يحمل الاثنين معًا
 * (`car` و`carOwner`). فإسنادُ الشاحنة إلى مورّدها يُقرأ من هنا — وكان
 * يُستنتَج من تاريخ الطلبات باللوحة، فيصحّ في سبعة آلافٍ ويبقى خمسةُ آلافٍ
 * وسبعُمئةٍ مجهولةَ المالك. والمعرفةُ في مكانها خيرٌ من استنتاجها.
 */
const shipmentOrderDriverSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    nationality: { type: String, trim: true, default: '' },
    /** رقمُ الإقامة — به يُعرَف الرجلُ حين يتشابه الاسم. */
    residenceNumber: { type: String, trim: true, default: '', index: true },

    // ── بطاقةُ التشغيل: سائقٌ بطاقتُه منتهيةٌ لا يُحمَّل ─────────────────────
    // يُوقفه الطريقُ لا نحن، فمعرفةُ التاريخ قبل الإسناد توفّر حمولةً متعطّلة.
    driverCardNumber: { type: String, trim: true, default: '' },
    driverCardExpiry: { type: String, trim: true, default: '' },

    companyName: { type: String, trim: true, default: '' },
    sponsorName: { type: String, trim: true, default: '' },

    // صورُ الأوراق كما تحملها المنصّة — روابطُها لا نسخُها.
    residenceImage: { type: String, trim: true, default: '' },
    licenseImage: { type: String, trim: true, default: '' },
    absherImage: { type: String, trim: true, default: '' },

    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderSupplier', default: null, index: true },
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderVehicle', default: null, index: true },

    notes: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
    /** معرّفُه في منصّة الأوبريشن — به يُطابَق في كلّ استيراد فلا يُكرَّر. */
    externalId: { type: String, trim: true, default: '', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shipmentOrderDriverSchema.index({ name: 1 });

// ── قوائمُ «طلبات الشحنات» المحفوظة تُمسَح مع كلّ كتابة ─────────────────────
// السائقُ يظهر في قائمة الشاحنات (سائقُها المعتاد) وفي عدّاد سوّاق المورّد،
// فأيُّ كتابةٍ عليه — من أيّ شاشةٍ أو سكربت — تمسح البادئةَ كلَّها.
const clearRegistry = () => {
  try { require('../utils/ttlCache').clear('so:registry:'); } catch (_) { /* */ }
};
for (const op of ['save', 'findOneAndUpdate', 'updateOne', 'updateMany', 'insertMany', 'bulkWrite', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  shipmentOrderDriverSchema.post(op, clearRegistry);
}

module.exports = mongoose.models.ShipmentOrderDriver
  || mongoose.model('ShipmentOrderDriver', shipmentOrderDriverSchema);
