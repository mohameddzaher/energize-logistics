const mongoose = require('mongoose');

// An internal system or service the IT team looks after — the ERP itself, the
// website, mail, servers, network gear, SaaS subscriptions, backups. Tracks its
// health, who owns it, and when it renews (so nothing silently lapses).
const itSystemSchema = new mongoose.Schema(
  {
    nameAr: { type: String, trim: true },
    name: { type: String, required: true, trim: true },

    type: {
      type: String,
      enum: ['erp', 'website', 'email', 'server', 'network_device', 'database', 'saas', 'backup', 'other'],
      default: 'other',
      index: true,
    },
    status: {
      type: String,
      enum: ['operational', 'degraded', 'down', 'maintenance', 'retired'],
      default: 'operational',
    },

    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    vendor: { type: String, trim: true },
    url: { type: String, trim: true },
    environment: { type: String, enum: ['production', 'staging', 'development'], default: 'production' },

    renewalDate: { type: String }, // YYYY-MM-DD
    cost: { type: Number, default: 0 },
    costPeriod: { type: String, enum: ['monthly', 'yearly', 'one_time'], default: 'yearly' },

    // Deliberately a *note* ("in the vault, entry #12"), never a real secret.
    credentialsNote: { type: String, trim: true },
    description: { type: String, trim: true },
    notes: { type: String, trim: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

itSystemSchema.index({ status: 1 });
itSystemSchema.index({ renewalDate: 1 });

module.exports = mongoose.models.ItSystem || mongoose.model('ItSystem', itSystemSchema);
