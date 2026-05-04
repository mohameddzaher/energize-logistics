const mongoose = require('mongoose');

// Each document is one Google-Sheet sync config, keyed by (project, branch).
// Multiple sheets can be configured — e.g. Keita+Jeddah, Keita+Riyadh, Hangar+Jeddah —
// each with its own URL, schedule, and webhook secret.
const b2cGoogleSheetSyncSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },           // optional human label
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'B2CProject', required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    sheetUrl: { type: String, trim: true },
    sheetId: { type: String, trim: true },
    enabled: { type: Boolean, default: false },
    intervalMinutes: { type: Number, default: 1, min: 1, max: 1440 },
    // SHA-1 of the last successfully-parsed sheet buffer. Used to skip syncs
    // when nothing in the sheet actually changed (cron checks every minute,
    // but full parse+upsert only runs when content moves).
    lastSheetHash: { type: String, trim: true },
    // overwrite: every sheet edit reflects in dashboard. merge_new_only: only new days.
    syncMode: { type: String, enum: ['merge_new_only', 'overwrite'], default: 'overwrite' },
    // Webhook secret — unique per config so the webhook can identify which sheet pinged.
    webhookSecret: { type: String, trim: true, select: true, index: true },
    lastSyncAt: { type: Date },
    lastSyncStatus: { type: String, enum: ['ok', 'error', 'never'], default: 'never' },
    lastSyncMessage: { type: String, trim: true },
    lastSyncStats: {
      monthsDetected: [String],
      recordsParsed: Number,
      repsCreated: Number,
      daysInserted: Number,
      daysUpdated: Number,
      daysSkipped: Number,
      durationMs: Number,
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// One config per (project, branch) pair.
b2cGoogleSheetSyncSchema.index({ project: 1, branch: 1 }, { unique: true });

module.exports = mongoose.model('B2CGoogleSheetSync', b2cGoogleSheetSyncSchema);
