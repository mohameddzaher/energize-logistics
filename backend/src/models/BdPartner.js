const mongoose = require('mongoose');

// A partner / alliance tracked by Business Development: carriers we interline
// with, agents abroad, technology vendors, government bodies and industry
// associations. Distinct from CrmVendor (a contracted 3PL carrier we buy
// capacity from) — this is the relationship-building record, from first contact
// through to a signed agreement.
const bdPartnerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nameAr: { type: String, trim: true },

    type: {
      type: String,
      enum: ['carrier', 'agent', 'supplier', 'technology', 'government', 'association', 'other'],
      default: 'carrier',
    },
    status: {
      type: String,
      enum: ['prospect', 'in_discussion', 'active', 'paused', 'ended'],
      default: 'prospect',
    },

    country: { type: String, trim: true },
    city: { type: String, trim: true },
    website: { type: String, trim: true },

    contactName: { type: String, trim: true },
    contactEmail: { type: String, lowercase: true, trim: true },
    contactPhone: { type: String, trim: true },

    // Plain YYYY-MM-DD strings — agreement dates are calendar dates, not instants.
    agreementStart: { type: String, trim: true },
    agreementEnd: { type: String, trim: true },

    services: { type: [String], default: [] },
    description: { type: String, trim: true },
    notes: { type: String, trim: true },

    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ownerName: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

bdPartnerSchema.index({ status: 1 });
bdPartnerSchema.index({ type: 1 });
bdPartnerSchema.index({ owner: 1 });
bdPartnerSchema.index({ agreementEnd: 1 });

module.exports = mongoose.models.BdPartner || mongoose.model('BdPartner', bdPartnerSchema);
