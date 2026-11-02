const mongoose = require('mongoose');

/**
 * Invoice line: one clearance statement with its amount and status.
 * The system lacked a table saying exactly what an invoice covers and for how much per statement.
 * "Returned" (rejected) is a property of the line, not the invoice: 174 of 178 invoices with a returned line are collected in full, and invoice totals equal the sum of all lines x 1.15 including returned ones. It is the shipment status (load came back or incomplete, yet billed). A statement can appear on several invoices when re-executed.
 * The line is the unit: returns are counted by it, and statements billed more than once are found through it.
 */
const collectionInvoiceLineSchema = new mongoose.Schema({
  invoiceNumber: { type: String, required: true, trim: true, index: true },
  kind: { type: String, enum: ['tax', 'cash'], default: 'tax', index: true },
  reportNumber: { type: String, required: true, trim: true, index: true },

  partyName: { type: String, trim: true, default: '' },
  party: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionsParty', default: null, index: true },

  // Net share of this statement in the invoice, as in the sheet. Tax is derived, not stored.
  net: { type: Number, default: 0 },
  invoiceDate: { type: Date, default: null, index: true },

  // Collected | Delivered | returned | '': the status of this line.
  status: { type: String, trim: true, default: '', index: true },
  returned: { type: Boolean, default: false, index: true },

  // Order in which the statement appeared: 1 for the first invoice carrying it, 2 for the next, so "re-billed" reads without computing.
  attempt: { type: Number, default: 1 },
  attempts: { type: Number, default: 1 },

  source: { type: String, trim: true, default: '' },
}, { timestamps: true });

collectionInvoiceLineSchema.index({ invoiceNumber: 1, reportNumber: 1 }, { unique: true });
collectionInvoiceLineSchema.index({ returned: 1, invoiceDate: -1 });

module.exports = mongoose.models.CollectionInvoiceLine
  || mongoose.model('CollectionInvoiceLine', collectionInvoiceLineSchema);
