const mongoose = require('mongoose');

// One dated marketing activity (نشاط تسويقي): a post, story, reel, ad, design,
// email blast or event held on a given day. This collection IS the section's
// history log — the daily/weekly/monthly report is nothing more than these rows
// bucketed by date, so every reportable number must be captured here.
const PLATFORMS = [
  'facebook', 'instagram', 'twitter', 'linkedin', 'tiktok', 'snapchat',
  'google_ads', 'youtube', 'website', 'email', 'whatsapp', 'offline', 'other',
];
const ACTIVITY_TYPES = ['post', 'story', 'reel', 'video', 'ad', 'article', 'email', 'event', 'design', 'other'];

const marketingActivitySchema = new mongoose.Schema(
  {
    // YYYY-MM-DD — the day the activity went out. Indexed because every report
    // and dashboard query is a range scan on it.
    date: { type: String, required: true, trim: true, index: true },

    // Optional: a standalone post doesn't have to belong to a campaign.
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketingCampaign', default: null, index: true },

    platform: { type: String, enum: PLATFORMS, default: 'other', index: true },
    type: { type: String, enum: ACTIVITY_TYPES, default: 'post', index: true },

    title: { type: String, trim: true },
    description: { type: String, trim: true },
    link: { type: String, trim: true },

    metrics: {
      impressions: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      likes: { type: Number, default: 0 },
      comments: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
      leads: { type: Number, default: 0 },
      reach: { type: Number, default: 0 },
    },

    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Denormalised so the history stays readable even if the user is removed.
    performedByName: { type: String, trim: true },

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

marketingActivitySchema.index({ date: -1, platform: 1 });
marketingActivitySchema.index({ campaign: 1, date: -1 });
marketingActivitySchema.index({ type: 1, date: -1 });
marketingActivitySchema.index({ performedBy: 1 });

marketingActivitySchema.statics.PLATFORMS = PLATFORMS;
marketingActivitySchema.statics.ACTIVITY_TYPES = ACTIVITY_TYPES;

module.exports = mongoose.models.MarketingActivity || mongoose.model('MarketingActivity', marketingActivitySchema);
