const mongoose = require('mongoose');

// Heavy transport store (spare parts)
// One item per material: name, category, current balance, unit, unit price. The balance changes through in/out movements recorded in Ls2StoreMovement.
const storeItemSchema = new mongoose.Schema({
  /**
   * Two stores, not one: heavy and light transport have different items and their balances must not be summed.
   * A field on the item rather than a second model, so the movement rules (in/out, reversal not edit, balance after each movement, shortage threshold) stay in one place.
   */
  warehouse: { type: String, enum: ['heavy', 'light'], default: 'heavy', index: true },
  code: { type: String, default: '', trim: true, index: true },
  name: { type: String, required: true, trim: true, index: true },
  // The same item's name on the supplier's invoice (it often differs from ours).
  supplierItemName: { type: String, default: '', trim: true },
  category: { type: String, default: '', index: true },       // inferred_category
  groupAr: { type: String, default: 'قطع غيار' },              // Group
  quantity: { type: Number, default: 0 },                      // Current balance
  unit: { type: String, default: 'قطعة' },                     // Unit
  unitPrice: { type: Number, default: 0 },                     // Unit price (SAR)
  minQuantity: { type: Number, default: 0 },                   // Shortage threshold (alert at or below)
  // Last purchase of the item: its supplier and purchase day. Per-purchase detail lives in the movement.
  supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Ls2Supplier', default: null, index: true },
  supplierName: { type: String, default: '' },                 // Name snapshot
  purchaseDate: { type: String, default: '', index: true },    // YYYY-MM-DD
  compatibleModels: { type: [String], default: [] },
  notes: { type: String, default: '' },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

// Store movement (in/out)
// In: enters the store (optionally from a specific vehicle the part came off).
// Out: issued to a vehicle (vehiclePlate).
const storeMovementSchema = new mongoose.Schema({
  /** Store of the movement, copied from the item at record time so another store's register is never read. */
  warehouse: { type: String, enum: ['heavy', 'light'], default: 'heavy', index: true },
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Ls2StoreItem', required: true, index: true },
  itemName: { type: String, default: '' },                    // Name snapshot
  type: { type: String, enum: ['in', 'out'], required: true, index: true },
  quantity: { type: Number, required: true },
  // Unit price of this inbound; records the purchase cost and updates the item price.
  unitPrice: { type: Number, default: null },
  // Supplier inbound: who and the purchase day. `date` is the movement day used by log filters (purchase day for inbound, record day otherwise), not the system entry time.
  supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Ls2Supplier', default: null, index: true },
  supplierName: { type: String, default: '' },
  date: { type: String, default: '', index: true },           // YYYY-MM-DD
  vehiclePlate: { type: String, default: '' },                // Issued to / received from (optional)
  // Its vehicle in the vehicle register if known; the text stays as typed (services/ls2VehicleLink).
  vehicleMaster: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', default: null, index: true },
  reason: { type: String, default: '' },
  // Issue reason, required on every new outbound (utils/storeIssueReasons). Empty for inbound and for old outbound rows predating the field.
  issueReason: { type: String, enum: ['', ...require('../utils/storeIssueReasons').ISSUE_REASON_KEYS], default: '', index: true },
  balanceAfter: { type: Number, default: 0 },                 // Balance after the movement
  // Issue request that wrote this movement; such a movement is undone only by cancelling its request.
  issueRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreIssueRequest', default: null, index: true },
  issueRequestNo: { type: String, default: '' },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  performedByName: { type: String, default: '' },

  // Reversal
  // A recorded movement is never edited or deleted (finance decision). Mistakes are fixed by an opposite movement linked to the original; both stay visible with who and when. No API path changes a recorded movement's quantity or type.
  reversed: { type: Boolean, default: false, index: true },   // Reversed
  reversedAt: { type: Date, default: null },
  reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reversedByName: { type: String, default: '' },
  reversalReason: { type: String, default: '' },              // Required when reversing
  reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Ls2StoreMovement', default: null, index: true }, // This is the opposite movement of
}, { timestamps: true });
storeMovementSchema.index({ createdAt: -1 });

// Suppliers
// Who spare parts are bought from. Each store has its own suppliers (`warehouse`); a name is unique within one store after folding hamza and spaces (`nameKey`).
const supplierSchema = new mongoose.Schema({
  warehouse: { type: String, enum: ['heavy', 'light'], default: 'heavy', index: true },
  name: { type: String, required: true, trim: true },
  nameKey: { type: String, default: '', index: true },
  phone: { type: String, default: '', trim: true },
  taxNumber: { type: String, default: '', trim: true },
  city: { type: String, default: '', trim: true },
  notes: { type: String, default: '' },
  isActive: { type: Boolean, default: true, index: true },
  createdByName: { type: String, default: '' },
}, { timestamps: true });

module.exports = {
  Ls2Supplier: mongoose.models.Ls2Supplier || mongoose.model('Ls2Supplier', supplierSchema),
  Ls2StoreItem: mongoose.models.Ls2StoreItem || mongoose.model('Ls2StoreItem', storeItemSchema),
  Ls2StoreMovement: mongoose.models.Ls2StoreMovement || mongoose.model('Ls2StoreMovement', storeMovementSchema),
};
