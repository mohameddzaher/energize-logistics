const mongoose = require('mongoose');

const dailyWalletSchema = new mongoose.Schema(
  {
    // Wallet is per branch, not per employee: cash belongs to the branch, several staff work on it in a day and hand over between them.
    // Key is branch and day; `user` is kept for history only (older days written per user) and is no longer written.
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD format for easy querying
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
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

// One wallet per branch per day.
dailyWalletSchema.index({ branch: 1, date: 1 }, { unique: true });
dailyWalletSchema.index({ user: 1, date: 1 });
dailyWalletSchema.index({ date: -1 });
dailyWalletSchema.index({ isClosed: 1 });

module.exports = mongoose.model('DailyWallet', dailyWalletSchema);
