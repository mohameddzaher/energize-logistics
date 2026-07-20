const mongoose = require('mongoose');

// A Business Development opportunity — the STRATEGIC, upstream layer that sits
// above the CRM pipeline. A CrmDeal is "sell freight to an existing customer";
// a BdOpportunity is "enter the Dammam reefer market", "win the Aramco tender"
// or "sign a partnership with carrier X". It may optionally point at a CRM
// company when the initiative is anchored on a specific account, but the two
// collections stay independent.
const bdOpportunitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nameAr: { type: String, trim: true },

    type: {
      type: String,
      enum: ['new_market', 'new_service', 'partnership', 'tender', 'expansion', 'other'],
      default: 'new_market',
    },
    // Where the initiative sits on its journey. `status` below is derived from it.
    stage: {
      type: String,
      enum: ['identified', 'researching', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'on_hold'],
      default: 'identified',
    },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },

    estimatedValue: { type: Number, default: 0 },
    currency: { type: String, default: 'SAR', trim: true },
    probability: { type: Number, default: 0, min: 0, max: 100 },
    // Kept as a plain YYYY-MM-DD string so it never shifts across time zones.
    expectedCloseDate: { type: String, trim: true },

    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Snapshot of the owner's name at write time so exports/lists stay readable
    // even when the user document is gone.
    ownerName: { type: String, trim: true },

    // Optional bridge to the CRM account this initiative revolves around.
    crmCompany: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmCompany' },
    partnerName: { type: String, trim: true },

    region: { type: String, trim: true },
    city: { type: String, trim: true },

    description: { type: String, trim: true },
    nextStep: { type: String, trim: true },
    nextStepDate: { type: String, trim: true },
    source: { type: String, trim: true },
    competitors: { type: [String], default: [] },
    risks: { type: String, trim: true },
    notes: { type: String, trim: true },

    // Derived from `stage` on every save (see the hook below) — never set by a client.
    status: { type: String, enum: ['open', 'won', 'lost', 'on_hold'], default: 'open' },
    closedAt: { type: Date },
    lostReason: { type: String, trim: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// `status` is a projection of `stage`, so both stay in sync no matter which
// path (create, update, stage-advance) wrote the document.
const statusForStage = (stage) => {
  if (stage === 'won') return 'won';
  if (stage === 'lost') return 'lost';
  if (stage === 'on_hold') return 'on_hold';
  return 'open';
};
bdOpportunitySchema.statics.statusForStage = statusForStage;

bdOpportunitySchema.pre('save', function (next) {
  this.status = statusForStage(this.stage);
  if ((this.status === 'won' || this.status === 'lost') && !this.closedAt) this.closedAt = new Date();
  if (this.status === 'open' || this.status === 'on_hold') this.closedAt = undefined;
  next();
});

bdOpportunitySchema.index({ stage: 1 });
bdOpportunitySchema.index({ owner: 1 });
bdOpportunitySchema.index({ expectedCloseDate: 1 });
bdOpportunitySchema.index({ type: 1 });
bdOpportunitySchema.index({ crmCompany: 1 });

module.exports = mongoose.models.BdOpportunity || mongoose.model('BdOpportunity', bdOpportunitySchema);
