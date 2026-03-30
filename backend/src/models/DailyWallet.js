const mongoose = require('mongoose');

const dailyWalletSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD format for easy querying
    openingBalance: { type: Number, default: 0 },
    closingBalance: { type: Number, default: 0 },
    totalCollections: { type: Number, default: 0 },
    totalExpenses: { type: Number, default: 0 },
    totalPurchases: { type: Number, default: 0 },
    isClosed: { type: Boolean, default: false },
    closedAt: { type: Date },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Cash reconciliation
    actualCash: { type: Number },
    cashDifference: { type: Number },
    differenceReason: { type: String, trim: true },
    differenceNotes: { type: String, trim: true },
    // Auto-close tracking
    autoClosedNote: { type: String, trim: true },
  },
  { timestamps: true }
);

// One wallet per user per day
dailyWalletSchema.index({ user: 1, date: 1 }, { unique: true });
dailyWalletSchema.index({ branch: 1, date: 1 });
dailyWalletSchema.index({ date: -1 });
dailyWalletSchema.index({ isClosed: 1 });

module.exports = mongoose.model('DailyWallet', dailyWalletSchema);
