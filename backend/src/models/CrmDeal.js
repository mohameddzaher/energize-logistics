const mongoose = require('mongoose');

// A sales opportunity moving through the pipeline. `stage` is a free string that
// matches one of the configured PIPELINE_STAGES (see config/crmDefaults.js);
// `status` is the terminal outcome (open / won / lost).
const crmDealSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmCompany' },
    contact: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmContact' },

    stage: { type: String, default: 'new' },
    status: { type: String, enum: ['open', 'won', 'lost'], default: 'open' },

    value: { type: Number, default: 0 },
    currency: { type: String, default: 'SAR' },
    probability: { type: Number, default: 0, min: 0, max: 100 },
    expectedCloseDate: { type: Date },

    wonAt: { type: Date },
    lostAt: { type: Date },
    lostReason: { type: String, trim: true },

    source: {
      type: String,
      enum: ['referral', 'website', 'cold_call', 'social', 'event', 'campaign', 'other', ''],
      default: '',
    },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

crmDealSchema.index({ company: 1 });
crmDealSchema.index({ stage: 1, status: 1 });
crmDealSchema.index({ owner: 1 });
crmDealSchema.index({ status: 1, expectedCloseDate: 1 });

module.exports = mongoose.model('CrmDeal', crmDealSchema);
