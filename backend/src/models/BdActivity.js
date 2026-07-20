const mongoose = require('mongoose');

// A dated log entry against any Business Development record. One polymorphic
// collection (entityType + refId) rather than three parallel ones, so the
// dashboard timeline is a single query and a record's detail page can pull its
// whole history with one lookup.
const bdActivitySchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },

    entityType: { type: String, enum: ['opportunity', 'partner', 'tender'], required: true },
    refId: { type: mongoose.Schema.Types.ObjectId, required: true },

    title: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['meeting', 'call', 'email', 'visit', 'proposal', 'research', 'followup', 'other'],
      default: 'meeting',
    },

    summary: { type: String, trim: true },
    outcome: { type: String, trim: true },
    nextStep: { type: String, trim: true },

    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Name snapshot so the timeline still reads correctly after staff changes.
    performedByName: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

bdActivitySchema.index({ entityType: 1, refId: 1, date: -1 });
bdActivitySchema.index({ date: -1 });

module.exports = mongoose.models.BdActivity || mongoose.model('BdActivity', bdActivitySchema);
