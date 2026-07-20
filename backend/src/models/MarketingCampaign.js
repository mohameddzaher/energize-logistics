const mongoose = require('mongoose');

// A marketing campaign (حملة تسويقية) — a budgeted, dated push on one channel
// with an objective and its own result metrics. Individual posts/ads/designs
// executed under it are MarketingActivity docs pointing back here; the campaign
// itself keeps the rolled-up numbers the team reports on (spend vs budget,
// leads, conversions, revenue).
const PLATFORMS = [
  'facebook', 'instagram', 'twitter', 'linkedin', 'tiktok', 'snapchat',
  'google_ads', 'youtube', 'website', 'email', 'whatsapp', 'offline', 'other',
];
const OBJECTIVES = ['awareness', 'leads', 'engagement', 'traffic', 'sales', 'recruitment', 'other'];
const STATUSES = ['planned', 'active', 'paused', 'completed', 'cancelled'];

const marketingCampaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nameAr: { type: String, trim: true },
    platform: { type: String, enum: PLATFORMS, default: 'other', index: true },
    objective: { type: String, enum: OBJECTIVES, default: 'awareness' },
    status: { type: String, enum: STATUSES, default: 'planned', index: true },

    // Kept as plain YYYY-MM-DD strings (same convention as the rest of the ERP)
    // so range filters are simple lexicographic comparisons, timezone-free.
    startDate: { type: String, trim: true },
    endDate: { type: String, trim: true },

    budget: { type: Number, default: 0 },
    spend: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },

    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    targetAudience: { type: String, trim: true },
    description: { type: String, trim: true },
    notes: { type: String, trim: true },

    // Result metrics — entered/updated by the marketing team.
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    leads: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    engagements: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Click-through rate %.
marketingCampaignSchema.virtual('ctr').get(function () {
  return this.impressions > 0 ? (this.clicks / this.impressions) * 100 : 0;
});
// Cost per lead.
marketingCampaignSchema.virtual('cpl').get(function () {
  return this.leads > 0 ? this.spend / this.leads : 0;
});
// Return on ad spend (revenue / spend).
marketingCampaignSchema.virtual('roas').get(function () {
  return this.spend > 0 ? this.revenue / this.spend : 0;
});

marketingCampaignSchema.index({ name: 1 });
marketingCampaignSchema.index({ status: 1, platform: 1 });
marketingCampaignSchema.index({ startDate: 1 });
marketingCampaignSchema.index({ owner: 1 });

marketingCampaignSchema.statics.PLATFORMS = PLATFORMS;
marketingCampaignSchema.statics.OBJECTIVES = OBJECTIVES;
marketingCampaignSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.models.MarketingCampaign || mongoose.model('MarketingCampaign', marketingCampaignSchema);
