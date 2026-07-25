const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, trim: true },
  quantity: { type: Number, default: 0, min: 0 },
  // The lifecycle buckets beside the usable shelf count. When an issue replaces
  // an old part, the removed one lands here (in ⇒ out): تحت التجديد until the
  // shop rules it renewed (back into `quantity`) or سكراب (kept to sell).
  underRenewalQty: { type: Number, default: 0, min: 0 },
  scrapQty: { type: Number, default: 0, min: 0 },
  minQuantity: { type: Number, default: 0 },
  unit: { type: String, default: 'piece', trim: true },
  costPrice: { type: Number, default: 0 },
  location: { type: String, trim: true },
  supplier: { type: String, trim: true },
  notes: { type: String, trim: true },
  isActive: { type: Boolean, default: true },
  // Approval system
  approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: { type: Date },
  approvalNote: { type: String, trim: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
}, { timestamps: true });

inventoryItemSchema.index({ name: 1 });
inventoryItemSchema.index({ category: 1 });
inventoryItemSchema.index({ isActive: 1 });
inventoryItemSchema.index({ approvalStatus: 1 });

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
