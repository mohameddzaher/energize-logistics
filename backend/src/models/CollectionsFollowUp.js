/**
 * Collection follow-up: a call, visit, or payment promise tied to a specific party.
 * Moved here from the customers/finance section, where it was tied to `Customer` and `Invoice`, which are no longer produced. It now attaches to `CollectionsParty` and, for a specific statement, `OperationsWorkflow`, the live document the numbers come from.
 * A payment promise is not a note: it has a date and amount and is queried in due follow-ups, so it has its own fields.
 */
const mongoose = require('mongoose');

const collectionsFollowUpSchema = new mongoose.Schema(
  {
    party: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionsParty', required: true, index: true },
    // The statement this follow-up concerns, if one specifically.
    report: { type: mongoose.Schema.Types.ObjectId, ref: 'OperationsWorkflow' },
    collector: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    type: {
      type: String,
      enum: ['call', 'whatsapp', 'email', 'visit', 'promise', 'note'],
      required: true,
    },
    status: { type: String, enum: ['done', 'postponed', 'cancelled'], default: 'done' },
    notes: { type: String, required: true, trim: true },

    // Amount collected in this follow-up, if any.
    amountCollected: { type: Number, default: 0 },

    // The promise and its outcome.
    promiseDate: { type: Date },
    promiseAmount: { type: Number },
    promiseFulfilled: { type: Boolean },

    nextFollowUpAt: { type: Date, index: true },
    // Closed when the promise is fulfilled or dropped, so it leaves the due list.
    closedAt: { type: Date },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

collectionsFollowUpSchema.index({ party: 1, createdAt: -1 });
collectionsFollowUpSchema.index({ closedAt: 1, nextFollowUpAt: 1 });

module.exports = mongoose.models.CollectionsFollowUp
  || mongoose.model('CollectionsFollowUp', collectionsFollowUpSchema);
