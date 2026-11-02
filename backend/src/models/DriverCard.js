/**
 * Driver cards: a registry in the vehicles section.
 * A card is an expiring document with number, type and logistics registry; vehicles of a registry are driven only by holders of its cards. The card-number snapshot stays on Employee for HR screens; this is the registry that is managed and renewed.
 */
const mongoose = require('mongoose');

const driverCardSchema = new mongoose.Schema({
  // Identity number is the key: it is what the sheet holds and what is searched.
  idNumber: { type: String, required: true, trim: true, unique: true, index: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', index: true },
  name: { type: String, trim: true, default: '', index: true },
  dateOfBirth: { type: String, default: '' },        // YYYY-MM-DD
  absherPhone: { type: String, trim: true, default: '' },
  // Logistics registry the card was issued under; groups cards and matches them to commercial vehicle records.
  logisticRegister: { type: String, trim: true, default: '', index: true },
  cardNumber: { type: String, trim: true, default: '', index: true },
  cardType: { type: String, trim: true, default: '' },   // Annual or restricted.
  /** Transport type this card authorizes. Written at creation; the value derived from assigned vehicles only fills a blank and never overrides it, since the paper is more reliable than an inference. */
  transportTypeAr: { type: String, trim: true, default: '', index: true },
  expiryDate: { type: String, default: '', index: true }, // YYYY-MM-DD
  notes: { type: String, trim: true, default: '' },

  /** Card renewal history. The renewal dialog collects cost, receipt number and note, but card rows had nowhere to store them. Cards renew yearly, sometimes with a new number, so the chain is read backwards as for vehicles. */
  renewals: [{
    previousExpiry: { type: String, default: '' },
    newExpiry: { type: String, default: '' },
    previousNumber: { type: String, default: '' },
    newNumber: { type: String, default: '' },
    cost: { type: Number, default: null },
    reference: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, default: '' },
    at: { type: Date, default: Date.now },
    byName: { type: String, default: '' },
  }],

  /**
   * Breach-of-trust insurance is one company-wide policy (`CorporatePolicy`); number and expiry live there. Per driver only whether he is covered or must be added.
   * covered = on the policy; required = working but not yet added (the exposed risk); '' = not asked yet.
   * The count is computed from drivers, not embedded in the policy name.
   */
  fidelity: {
    status: { type: String, enum: ['covered', 'required', ''], default: '', index: true },
    // Filled only if this driver is on a policy other than the company one.
    policyNumber: { type: String, trim: true, default: '' },
    addedDate: { type: String, default: '' },     // YYYY-MM-DD, when he was added.
    notes: { type: String, trim: true, default: '' },
  },

  isActive: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

/** Days until expiry: computed, not stored. The sheet's remaining-days column goes stale daily, so it is derived from the expiry date on read. */
driverCardSchema.virtual('daysLeft').get(function daysLeft() {
  if (!this.expiryDate) return null;
  const { startOfDay, todayKey } = require('../utils/companyDay');
  const a = startOfDay(todayKey()); const b = startOfDay(this.expiryDate);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
});
driverCardSchema.set('toJSON', { virtuals: true });
driverCardSchema.set('toObject', { virtuals: true });

module.exports = mongoose.models.DriverCard || mongoose.model('DriverCard', driverCardSchema);
