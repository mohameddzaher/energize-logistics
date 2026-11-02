/**
 * Alert snooze: "seen, no need to repeat".
 * Alerts are not stored; "near its limit" and "due in two days" are computed from balances and dates on each page open, since a stored alert is true when written and false tomorrow. Only the human decision is stored: that someone saw this specific alert and closed it. It is keyed so it returns if conditions change: snoozing a limit alert at 90% utilisation does not snooze it at 120%.
 */
const mongoose = require('mongoose');

const creditAlertAckSchema = new mongoose.Schema({
  party: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionsParty', required: true, index: true },
  // 'limit' = nearing credit limit; 'due' = nearing due date
  kind: { type: String, enum: ['limit', 'due'], required: true },
  // What was snoozed on: for limit, the balance at that moment; for due, the invoice number.
  atOutstanding: { type: Number, default: 0 },
  invoiceNumber: { type: String, trim: true, default: '' },
  note: { type: String, trim: true, default: '' },
  ackedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ackedAt: { type: Date, default: Date.now },
}, { timestamps: true });

creditAlertAckSchema.index({ party: 1, kind: 1, invoiceNumber: 1 });

module.exports = mongoose.models.CreditAlertAck
  || mongoose.model('CreditAlertAck', creditAlertAckSchema);
