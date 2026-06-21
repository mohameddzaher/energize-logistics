const mongoose = require('mongoose');

// A single account in the Chart of Accounts.
const chartAccountSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    nameEn: { type: String, required: true, trim: true },
    nameAr: { type: String, trim: true },
    type: { type: String, enum: ['asset', 'liability', 'equity', 'revenue', 'expense'], required: true },
    normalBalance: { type: String, enum: ['debit', 'credit'], required: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'ChartAccount' },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    // Seeded defaults — protected from deletion.
    system: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

chartAccountSchema.index({ type: 1 });

module.exports = mongoose.model('ChartAccount', chartAccountSchema);
