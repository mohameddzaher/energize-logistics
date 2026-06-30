const mongoose = require('mongoose');

// A single custody (عهدة) ledger entry for a B2C project manager. Completely
// independent of the rest of B2C — additive only.
//   direction 'in'  = custody received / granted (money handed to the PM)
//   direction 'out' = money the PM spent (e.g. paid to field reps)
// A PM's current custody balance = sum(in) - sum(out).
const b2cWalletEntrySchema = new mongoose.Schema(
  {
    projectManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    direction: { type: String, enum: ['in', 'out'], required: true },
    amount: { type: Number, required: true, min: 0 },
    // For 'in' entries: how the money was received.
    method: { type: String, enum: ['cash', 'bank_transfer', 'other', ''], default: '' },
    // Free text: what it was for (e.g. "للمناديب") or who it was received from.
    reason: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

b2cWalletEntrySchema.index({ projectManager: 1, createdAt: -1 });

module.exports = mongoose.model('B2CWalletEntry', b2cWalletEntrySchema);
