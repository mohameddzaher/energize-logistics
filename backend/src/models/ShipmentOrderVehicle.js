const mongoose = require('mongoose');

// A truck the shipment-orders section can put on a load.
//
// The default driver ride along so that picking the truck on the create form
// fills the driver in one tap — the automation the section exists for. Both
// stay editable per shipment; a truck driven by someone else today is normal.
const shipmentOrderVehicleSchema = new mongoose.Schema(
  {
    plate: { type: String, required: true, trim: true ,
      // صيغةُ اللوحة واحدةٌ في النظام كلِّه — راجع `formatPlate`.
      set: (v) => require('../utils/plateKey').formatPlate(v),
    },
    name: { type: String, trim: true, default: '' },        // e.g. "مرسيدس أكتروس أبيض"
    truckType: { type: String, trim: true, default: '' },   // same vocabulary as the form field
    /**
     * ── الماركةُ واللونُ: البوليصةُ تسألهما ─────────────────────────────────
     *
     * البوليصةُ فيها «بيانات السيارة»: اللوحةُ والماركةُ واللون. وسجلُّ شاحنات
     * الناقلين لم يكن يحمل الاثنين الأخيرين، فكانت الخانتان تُطبَعان فارغتين
     * في كلّ ورقةٍ تخرج مع سائق — وهي أوراقٌ تُسلَّم في البوّابات ويُتحقَّق
     * منها. فصارتا حقلين يُسألان عند تسجيل الشاحنة.
     */
    brand: { type: String, trim: true, default: '' },
    color: { type: String, trim: true, default: '' },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderSupplier', default: null, index: true },

    /**
     * ── لمن هذه الشاحنة — صريحًا لا بالغياب ────────────────────────────────
     *
     * كان المعنى: «لا مورّدَ لها» = من أسطولنا. ثمّ استُوردت ثلاثةَ عشرَ ألفًا من
     * شاحنات الناقلين من تاريخ الطلبات، وجاءت كلُّها بلا مرجع مورّد — فقُرئت
     * كأنّها أسطولُنا، وقال العدّادُ «١٣١٠١ من أسطولنا» وأسطولُنا ثمانٍ وخمسون.
     * والغيابُ لا يصلح أن يكون خبرًا: هو «لا أعلم» لا «ملكُنا».
     *
     *   supplier  — شاحنةُ ناقلٍ، ومرجعُه في `supplier`
     *   ours      — من أسطولنا (تُطابق سجلَّ مركباتنا بلوحتها)
     *   unknown   — جاءت من تاريخ الطلبات ولم يُعرَف مالكُها بعد
     *
     * وقسمُ طلبات الشحنات عن حمولاتٍ تُسنَد إلى ناقلين؛ أسطولُنا يُدار في «إدارة
     * الأسطول». فما كان `ours` هنا لا يُعرَض في قائمة اختيار شاحنات الموردين.
     */
    ownership: {
      type: String, enum: ['supplier', 'ours', 'unknown'], default: 'unknown', index: true,
    },
    defaultDriverName: { type: String, trim: true, default: '' },
    defaultDriverPhone: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },

    // بياناتُ المركبة كما تحملها منصّةُ الأوبريشن.
    externalId: { type: String, trim: true, default: '', index: true },
    modelYear: { type: String, trim: true, default: '' },
    recordNumber: { type: String, trim: true, default: '' },
    // بطاقةُ التشغيل وانتهاؤها: مركبةٌ بطاقتُها منتهيةٌ لا تُحمَّل — يُوقفها
    // الطريقُ لا نحن، فمعرفةُ التاريخ قبل الإسناد توفّر حمولةً متعطّلة.
    operationCardNumber: { type: String, trim: true, default: '' },
    operationCardExpiry: { type: String, trim: true, default: '' },
    insuranceDetails: { type: String, trim: true, default: '' },

    // ── اللوحةُ بمفتاحها، لا بصيغتها ────────────────────────────────────────
    // `plate` تُخزَّن بصيغةِ العرض (`formatPlate`)، واللوحةُ الواحدة تُكتب في
    // الطلب بصيغةٍ أخرى: همزةٌ مختلفة، أرقامٌ عربيّة، مسافةٌ زائدة. فالمقارنةُ
    // تجري على مفتاحٍ مجرَّد (`registryPlateKey`)، وهو لم يكن مخزَّنًا — فكان
    // طريقُ البوليصة يسحب **كلَّ** الشاحنات (ثلاثةَ عشرَ ألفًا ونصفًا) ليجد
    // ثلاثًا، ويُرشِّح بالجافاسكربت. ويكبر مع كلّ شاحنةٍ تُضاف، في ورقةٍ تُطبَع
    // كلَّ يوم.
    //
    // فيُشتقُّ المفتاحُ عند الحفظ ويُفهرَس، كما في `VehicleMaster` و
    // `Ls2TireAsset` — ويصير النداءُ `$in` على فهرس.
    plateKey: { type: String, default: '', index: true },

    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shipmentOrderVehicleSchema.index({ plate: 1 });

// ── ويُشتقُّ عند كلّ حفظ، لا في الاستيراد وحدَه ──────────────────────────────
// شاحنةٌ تُضاف من الشاشة بلا مفتاحٍ لا تُوجَد حين تُطبَع بوليصتُها، ولا شيءَ
// يقول لماذا: الخاناتُ تخرج فارغةً وحسب. و`updateOne`/`findOneAndUpdate`
// تُغطَّى كذلك، فتعديلُ اللوحة من أيّ طريقٍ يُعيد اشتقاقَه.
const deriveKey = (plate) => {
  try { return require('../utils/plateKey').registryPlateKey(plate) || ''; } catch (_) { return ''; }
};

shipmentOrderVehicleSchema.pre('save', function setPlateKey(next) {
  if (this.isModified('plate') || !this.plateKey) this.plateKey = deriveKey(this.plate);
  next();
});

for (const op of ['findOneAndUpdate', 'updateOne', 'updateMany']) {
  shipmentOrderVehicleSchema.pre(op, function setPlateKeyOnUpdate(next) {
    const u = this.getUpdate() || {};
    const plate = (u.$set && u.$set.plate) ?? u.plate;
    if (plate != null) {
      const { formatPlate } = require('../utils/plateKey');
      const key = deriveKey(formatPlate(plate));
      if (u.$set) u.$set.plateKey = key; else u.plateKey = key;
      this.setUpdate(u);
    }
    next();
  });
}

// ── قوائمُ «طلبات الشحنات» المحفوظة تُمسَح مع كلّ كتابة ─────────────────────
// قائمتا الموردين والشاحنات تُحفظان دقيقتين (so:registry) لأنّ قراءتهما من
// العنقود بطيئة. والمورّدُ يظهر داخل قائمة الشاحنات، وعددُ شاحناته في قائمته،
// فأيُّ كتابةٍ على أحدهما — من أيّ شاشةٍ أو سكربت — تمسح البادئةَ كلَّها.
const clearRegistry = () => {
  try { require('../utils/ttlCache').clear('so:registry:'); } catch (_) { /* */ }
};
for (const op of ['save', 'findOneAndUpdate', 'updateOne', 'updateMany', 'insertMany', 'bulkWrite', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  shipmentOrderVehicleSchema.post(op, clearRegistry);
}

module.exports = mongoose.models.ShipmentOrderVehicle
  || mongoose.model('ShipmentOrderVehicle', shipmentOrderVehicleSchema);
