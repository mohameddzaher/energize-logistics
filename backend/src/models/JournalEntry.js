const mongoose = require('mongoose');

// One line of a double-entry journal entry: a single account debited OR credited.
const journalLineSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'ChartAccount', required: true },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    description: { type: String, trim: true },
  },
  { _id: false }
);

// A balanced journal entry (sum of debits === sum of credits). Can be created
// manually or auto-generated from a source document (invoice / payment / wallet).
const journalEntrySchema = new mongoose.Schema(
  {
    entryNumber: { type: String, trim: true },
    date: { type: Date, required: true, default: Date.now },
    memo: { type: String, trim: true },
    lines: { type: [journalLineSchema], default: [] },
    totalDebit: { type: Number, default: 0 },
    totalCredit: { type: Number, default: 0 },
    status: { type: String, enum: ['draft', 'posted', 'void'], default: 'posted' },

    // Where this entry came from. `auto:true` + a unique (type,refId) makes
    // auto-posting idempotent — re-running the sync won't duplicate entries.
    source: {
      type: { type: String, enum: ['manual', 'invoice', 'payment', 'wallet', 'vendorbill', 'vendorpayment'], default: 'manual' },
      refId: { type: mongoose.Schema.Types.ObjectId },
      auto: { type: Boolean, default: false },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

journalEntrySchema.index({ date: -1 });
journalEntrySchema.index({ status: 1 });
journalEntrySchema.index({ 'lines.account': 1 });
// One auto entry per source document.
journalEntrySchema.index({ 'source.type': 1, 'source.refId': 1 }, { unique: true, partialFilterExpression: { 'source.auto': true } });

module.exports = mongoose.model('JournalEntry', journalEntrySchema);
