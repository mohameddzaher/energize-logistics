const mongoose = require('mongoose');

// Singleton config: there's only one Google-Sheet-source per project at a time.
// We use a single document with a known `_singleton: 'config'` key.
const b2cGoogleSheetSyncSchema = new mongoose.Schema(
  {
    singleton: { type: String, default: 'config', unique: true, index: true },
    sheetUrl: { type: String, trim: true },        // raw URL the user pasted
    sheetId: { type: String, trim: true },         // extracted Google Sheets ID
    enabled: { type: Boolean, default: false },
    intervalMinutes: { type: Number, default: 15, min: 1, max: 1440 },
    // Sync mode: overwrite reflects every edit in the sheet (default — the sheet is the
    // source of truth). merge_new_only only adds days that don't already exist.
    syncMode: { type: String, enum: ['merge_new_only', 'overwrite'], default: 'overwrite' },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'B2CProject' }, // optional default scope
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
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

module.exports = mongoose.model('B2CGoogleSheetSync', b2cGoogleSheetSyncSchema);
