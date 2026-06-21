const mongoose = require('mongoose');

// A monthly sales target for a rep (or the whole team when rep is null).
// Actuals are computed live from won CRM deals — see salesController.
const salesTargetSchema = new mongoose.Schema(
  {
    rep: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // null = team-wide
    period: { type: String, required: true }, // 'YYYY-MM'
    amountTarget: { type: Number, default: 0 },   // revenue target
    dealsTarget: { type: Number, default: 0 },     // # of won deals target
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

salesTargetSchema.index({ rep: 1, period: 1 }, { unique: true });
salesTargetSchema.index({ period: 1 });

module.exports = mongoose.model('SalesTarget', salesTargetSchema);
