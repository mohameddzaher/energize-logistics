const mongoose = require('mongoose');

// A tender / RFQ we are watching or bidding on. The submission deadline is the
// spine of this model — the BD dashboard and the tenders page both sort and
// colour-code by how many days remain.
const bdTenderSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    titleAr: { type: String, trim: true },

    // Issuing body (Aramco, SPL, a ministry, a private shipper…).
    entity: { type: String, trim: true },
    referenceNumber: { type: String, trim: true },

    // Plain YYYY-MM-DD — indexed because every list/dashboard query sorts on it.
    submissionDeadline: { type: String, trim: true },

    status: {
      type: String,
      enum: ['watching', 'preparing', 'submitted', 'shortlisted', 'won', 'lost', 'cancelled'],
      default: 'watching',
    },

    estimatedValue: { type: Number, default: 0 },
    bidBondAmount: { type: Number, default: 0 },

    scope: { type: String, trim: true },
    requirements: { type: [String], default: [] },
    documentsReady: { type: Boolean, default: false },

    submittedAt: { type: String, trim: true },
    result: { type: String, trim: true },

    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ownerName: { type: String, trim: true },
    notes: { type: String, trim: true },

    // Optional link back to the strategic initiative this tender belongs to.
    opportunity: { type: mongoose.Schema.Types.ObjectId, ref: 'BdOpportunity' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

bdTenderSchema.index({ submissionDeadline: 1 });
bdTenderSchema.index({ status: 1 });
bdTenderSchema.index({ owner: 1 });
bdTenderSchema.index({ opportunity: 1 });

module.exports = mongoose.models.BdTender || mongoose.model('BdTender', bdTenderSchema);
