const mongoose = require('mongoose');

/**
 * Vendors management: what the vendors team records beside the carrier register (ShipmentOrderSupplier).
 * Follow-ups are the team's contact log with a carrier; the approved price list is what a route should cost by carrier
 * tier; settings hold the daily and monthly trip targets the daily page measures against.
 */

const followUpSchema = new mongoose.Schema({
  supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderSupplier', required: true, index: true },
  at: { type: Date, default: Date.now, index: true },
  channel: { type: String, enum: ['call', 'whatsapp', 'visit', 'email', 'meeting', 'other'], default: 'call' },
  /** What the contact was about and how it ended, in the team's words (e.g. contract sent, asked for papers). */
  outcome: { type: String, trim: true, default: '' },
  note: { type: String, trim: true, default: '' },
  /** The contract status the follow-up left the vendor in, when it changed it. */
  contractStatus: { type: String, trim: true, default: '' },
  nextAt: { type: Date, default: null },
  source: { type: String, enum: ['manual', 'import'], default: 'manual' },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  byName: { type: String, trim: true, default: '' },
}, { timestamps: true });
followUpSchema.index({ supplier: 1, at: -1 });

const approvedPriceSchema = new mongoose.Schema({
  fromCity: { type: String, required: true, trim: true },
  toCity: { type: String, required: true, trim: true },
  fromKey: { type: String, default: '', index: true },
  toKey: { type: String, default: '', index: true },
  truckType: { type: String, trim: true, default: '' },
  /** Tier A is the ceiling the team pays a regular carrier; B and C are for preferred and contracted carriers. */
  priceA: { type: Number, default: null },
  priceB: { type: Number, default: null },
  priceC: { type: Number, default: null },
  notes: { type: String, trim: true, default: '' },
  isActive: { type: Boolean, default: true },
  updatedByName: { type: String, default: '' },
}, { timestamps: true });
approvedPriceSchema.index({ fromKey: 1, toKey: 1, truckType: 1 }, { unique: true });
approvedPriceSchema.pre('save', function keys(next) {
  const fold = require('./ShipmentOrderSupplier').foldName;
  this.fromKey = fold(this.fromCity);
  this.toKey = fold(this.toCity);
  next();
});

const settingSchema = new mongoose.Schema({
  _id: { type: String },
  value: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedByName: { type: String, default: '' },
}, { timestamps: true });

module.exports = {
  VendorFollowUp: mongoose.models.VendorFollowUp || mongoose.model('VendorFollowUp', followUpSchema),
  VendorApprovedPrice: mongoose.models.VendorApprovedPrice || mongoose.model('VendorApprovedPrice', approvedPriceSchema),
  VendorSetting: mongoose.models.VendorSetting || mongoose.model('VendorSetting', settingSchema),
};
