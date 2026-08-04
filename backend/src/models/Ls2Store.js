const mongoose = require('mongoose');

// ── مخزن النقل الثقيل (قطع الغيار) ──────────────────────────────────────────────
// صنف واحد لكل مادة: الاسم، التصنيف، الرصيد الحالي، الوحدة، سعر القطعة. الرصيد
// يتغيّر عبر حركات (وارد/صادر) المسجّلة في Ls2StoreMovement.
const storeItemSchema = new mongoose.Schema({
  code: { type: String, default: '', trim: true, index: true },
  name: { type: String, required: true, trim: true, index: true },
  category: { type: String, default: '', index: true },       // inferred_category
  groupAr: { type: String, default: 'قطع غيار' },              // المجموعة
  quantity: { type: Number, default: 0 },                      // الرصيد الحالي
  unit: { type: String, default: 'قطعة' },                     // الوحدة
  unitPrice: { type: Number, default: 0 },                     // السعر للقطعة (ر.س)
  minQuantity: { type: Number, default: 0 },                   // عتبة النقص (تنبيه عند/تحتها)
  compatibleModels: { type: [String], default: [] },
  notes: { type: String, default: '' },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

// ── حركة مخزنية (وارد/صادر) ─────────────────────────────────────────────────────
// وارد: دخل للمخزن (اختياريًا وارد من عربية معيّنة نزلت منها القطعة).
// صادر: صُرف من المخزن على عربية (vehiclePlate).
const storeMovementSchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Ls2StoreItem', required: true, index: true },
  itemName: { type: String, default: '' },                    // لقطة الاسم
  type: { type: String, enum: ['in', 'out'], required: true, index: true },
  quantity: { type: Number, required: true },
  vehiclePlate: { type: String, default: '' },                // صادر على / وارد من (اختياري)
  reason: { type: String, default: '' },
  balanceAfter: { type: Number, default: 0 },                 // الرصيد بعد الحركة
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  performedByName: { type: String, default: '' },

  // ── التراجع ───────────────────────────────────────────────────────────────
  // الحركة المسجّلة لا تُعدَّل ولا تُمسح — قرار الإدارة المالية. الغلط بيتصحّح
  // بحركة معاكسة مربوطة بالأصلية، والاتنين يفضلوا ظاهرين في السجل باسم اللي
  // عملهم وتاريخهم. مفيش أي مسار في الـ API بيغيّر كمية أو نوع حركة اتسجّلت.
  reversed: { type: Boolean, default: false, index: true },   // اتّرجع عنها
  reversedAt: { type: Date, default: null },
  reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reversedByName: { type: String, default: '' },
  reversalReason: { type: String, default: '' },              // إجباري وقت التراجع
  reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Ls2StoreMovement', default: null, index: true }, // ديه الحركة المعاكسة لِـ
}, { timestamps: true });
storeMovementSchema.index({ createdAt: -1 });

module.exports = {
  Ls2StoreItem: mongoose.models.Ls2StoreItem || mongoose.model('Ls2StoreItem', storeItemSchema),
  Ls2StoreMovement: mongoose.models.Ls2StoreMovement || mongoose.model('Ls2StoreMovement', storeMovementSchema),
};
