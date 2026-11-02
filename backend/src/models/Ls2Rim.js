/**
 * Ls2Rim: rims (جنوط) held as counted stock on the tire side of the heavy-transport registry.
 * Rims carry no serial, so unlike Ls2TireAsset one row is one rim TYPE (brand + size + condition) with a quantity.
 * The balance changes only through Ls2RimMovement rows; a recorded movement is never edited, it is reversed.
 */
const mongoose = require('mongoose');

const RIM_CONDITIONS = ['new', 'used', 'scrap'];

const rimSchema = new mongoose.Schema({
  brand: { type: String, required: true, trim: true },          // lookup ls2_rim_brand
  size: { type: String, required: true, trim: true },           // lookup ls2_rim_size
  condition: { type: String, enum: RIM_CONDITIONS, default: 'new', index: true },
  // Derived from brand/size/condition on every save, so the same rim is never written two ways.
  name: { type: String, default: '', index: true },
  key: { type: String, default: '', index: true },
  quantity: { type: Number, default: 0, min: 0 },
  unit: { type: String, default: 'قطعة' },
  unitPrice: { type: Number, default: 0 },
  minQuantity: { type: Number, default: 0 },
  notes: { type: String, default: '' },
  isActive: { type: Boolean, default: true, index: true },
  // Heavy-store items migrated into this row (scripts/moveRimsFromStore.js); also the migration's idempotence key.
  sourceStoreItems: { type: [mongoose.Schema.Types.ObjectId], default: [], index: true },
  createdByName: { type: String, default: '' },
}, { timestamps: true });

// One active row per rim type; a hidden row may share the key with a later one.
rimSchema.index({ key: 1 }, { name: 'one_active_rim_type', unique: true, partialFilterExpression: { isActive: true } });

const fold = (s) => String(s || '').trim().toLowerCase()
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[ً-ْـ]/g, '').replace(/\s+/g, ' ');
const CONDITION_AR = { new: '', used: 'مستعمل', scrap: 'سكراب' };
// Matches the store's own wording: «جنط صيني 385», «جنط صيني مستعمل 315», «جنط صيني سكراب 385».
const rimName = ({ brand, size, condition }) => ['جنط', String(brand || '').trim(), CONDITION_AR[condition] || '', String(size || '').trim()]
  .filter(Boolean).join(' ').replace(/\s+/g, ' ');
const rimKey = ({ brand, size, condition }) => `${fold(brand)}|${fold(size).replace(/\s+/g, '')}|${condition || 'new'}`;

rimSchema.pre('save', function deriveName(next) {
  this.name = rimName(this);
  this.key = rimKey(this);
  next();
});

const MOVEMENT_TYPES = ['in', 'out', 'edit'];
// Why stock moved. `transfer` legs come in pairs (transferGroup); `from_store` opens a migrated balance; `legacy` rows are store history copied for reading and never count.
const MOVEMENT_REASONS = ['purchase', 'returned', 'count', 'mounted', 'sold', 'damaged', 'transfer', 'from_store', 'legacy', 'reversal', 'created', 'edited', 'hidden', 'other'];

const movementSchema = new mongoose.Schema({
  rim: { type: mongoose.Schema.Types.ObjectId, ref: 'Ls2Rim', required: true, index: true },
  rimName: { type: String, default: '' },                         // Name snapshot at record time
  type: { type: String, enum: MOVEMENT_TYPES, required: true, index: true },
  reason: { type: String, enum: MOVEMENT_REASONS, default: 'other', index: true },
  quantity: { type: Number, default: 0 },
  balanceAfter: { type: Number, default: 0 },
  unitPrice: { type: Number, default: null },
  supplierName: { type: String, default: '' },
  vehiclePlate: { type: String, default: '' },
  plateKey: { type: String, default: null, index: true },
  vehicleMaster: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', default: null },
  date: { type: String, default: '', index: true },               // YYYY-MM-DD, the day it happened
  at: { type: Date, default: Date.now, index: true },             // Ordering; legacy copies keep the store row's time
  notes: { type: String, default: '' },
  // Transfer between two rim types: both legs share the group and name each other.
  transferGroup: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  counterpartRim: { type: mongoose.Schema.Types.ObjectId, ref: 'Ls2Rim', default: null },
  counterpartName: { type: String, default: '' },
  // Migration links: the store row a legacy copy came from, and the store item an opening balance came from.
  legacy: { type: Boolean, default: false, index: true },
  storeMovement: { type: mongoose.Schema.Types.ObjectId, ref: 'Ls2StoreMovement', default: null },
  storeItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Ls2StoreItem', default: null, index: true },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  performedByName: { type: String, default: '' },
  // Reversal, as in the store ledger: the original stays, an opposite row points at it.
  reversed: { type: Boolean, default: false, index: true },
  reversedAt: { type: Date, default: null },
  reversedByName: { type: String, default: '' },
  reversalReason: { type: String, default: '' },
  reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Ls2RimMovement', default: null, index: true },
}, { timestamps: true });

// A store row is copied once per rim, however often the migration runs.
movementSchema.index({ rim: 1, storeMovement: 1 }, { name: 'one_copy_per_store_row', unique: true, partialFilterExpression: { storeMovement: { $type: 'objectId' } } });
movementSchema.index({ rim: 1, at: -1 });

module.exports = {
  RIM_CONDITIONS,
  MOVEMENT_REASONS,
  rimName,
  rimKey,
  foldRimText: fold,
  Ls2Rim: mongoose.models.Ls2Rim || mongoose.model('Ls2Rim', rimSchema),
  Ls2RimMovement: mongoose.models.Ls2RimMovement || mongoose.model('Ls2RimMovement', movementSchema),
};
