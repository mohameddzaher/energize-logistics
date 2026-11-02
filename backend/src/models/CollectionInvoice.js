/**
 * Collection invoice: the invoice register the collections department works on.
 * A standalone collection rather than derived from operations statements: only about 6% of the ledger's 9375 invoice numbers (back to 2022) exist in our statements, since an invoice can predate, follow, lack, or span statements. The statement links to the invoice when one exists.
 * Day counts (billing to delivery, delivery to collection, days to due) are computed on read from the dates, never stored.
 */
const mongoose = require('mongoose');
const { paymentSchema } = require('./collectionPaymentSchema');

const collectionInvoiceSchema = new mongoose.Schema({
  // Identity
  invoiceNumber: { type: String, trim: true, required: true, index: true },
  // Cash or tax: a customer attribute reflected on the invoice.
  kind: { type: String, enum: ['tax', 'cash'], default: 'tax', index: true },

  // Owner
  party: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionsParty', index: true },
  partyCode: { type: String, trim: true, default: '', index: true },
  // Party code exactly as written in the sheet (may be empty).
  // `partyCode` is the matched code and may be generated for rows with no code; generated numbers differ between runs, so it is not a safe key (it duplicated seven invoices). This raw value is stable while the file is unchanged.
  sheetCode: { type: String, trim: true, default: '' },
  partyName: { type: String, trim: true, default: '' },

  // Money
  total: { type: Number, default: 0 },
  // Value corrected by hand from the invoices page; not recomputed from the statement totals.
  totalLocked: { type: Boolean, default: false },

  // Collection can come in installments.
  // A customer may pay part now and part later, so collected is a sum of payments (amount, date, author), and the invoice is partial while the sum is below its value and collected once it reaches it; status follows automatically.
  // `collectedAmount` is not necessarily the sum of `payments`: in the cash ledger (shipment row) it follows its statement, and earlier amounts remain a base rather than an author-less payment. A ledger invoice marked Collected with no payments counts as collected in full (see collectedOf).
  collectedAmount: { type: Number, default: 0 },
  payments: { type: [paymentSchema], default: undefined },

  // The three dates all analysis rests on: invoiced, delivered to the customer, collected. The agreed term is counted from delivery, not issue.
  invoiceDate: { type: Date, index: true },
  deliveryDate: { type: Date, index: true },
  collectionDate: { type: Date, index: true },
  exitDate: { type: Date },

  status: { type: String, trim: true, default: '', index: true }, // Collected / Delivered / ''
  comments: { type: String, trim: true, default: '' },

  // Extras from the cash shipments sheet.
  // The cash ledger (`Shipment Report`) row is a shipment, not an invoice, and carries the shipment owner, its branch, the collecting branch and the payment date, which have no place in the tax ledger.
  ownerName: { type: String, trim: true, default: '' },
  branch: { type: String, trim: true, default: '' },
  collectionBranch: { type: String, trim: true, default: '' },
  paymentDate: { type: Date, default: null },

  // Operations statements underneath.
  // One invoice can cover several statements. Filled from the invoice number written on the statement; empty for pre-system invoices, which are most of them.
  reportNumbers: [{ type: String, trim: true }],

  // Unused numbers in the sequence.
  // 321 ledger rows hold only an invoice number (no account, amount, or date). They are reserved numbers not yet issued, which the accountant needs to see where numbering stands.
  // They are kept so the sequence has no gaps, and flagged so they count as no one's work: excluded from collection lists and invoice counts.
  unused: { type: Boolean, default: false, index: true },

  source: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// One invoice per number per account.
// The key used to be (type + number), correct for invoices (one global sequence). But the ledger has 18 negative-numbered rows that are accountant settlements numbered per account (exchange differences, balances, journals), so two accounts' settlements with the same number merged into one record. The account code is now part of the key, so each account keeps its own settlement. Real invoices are unaffected: among nine thousand, only -14 is shared by two accounts.
collectionInvoiceSchema.index({ kind: 1, invoiceNumber: 1, sheetCode: 1 }, { unique: true });
collectionInvoiceSchema.index({ party: 1, status: 1 });
collectionInvoiceSchema.index({ status: 1, deliveryDate: -1 });
collectionInvoiceSchema.index({ partyCode: 1, invoiceDate: -1 });

const CollectionInvoice = mongoose.models.CollectionInvoice
  || mongoose.model('CollectionInvoice', collectionInvoiceSchema);

// 'Open' is a single definition read by every screen.
// Screens used to disagree (dashboard: no collection date and not Collected; aging and alerts: status not Collected), differing by 79k in debt and 128 in count. The status decides, as in the ledger: ten Delivered invoices with a collection date still count as open in the ledger's aging sheet, since a date may be a partial payment or an appointment. Recording collection in the system writes date and status together.
// An invoice is open unless its status is collected or it is a reserved number. Conditions needed elsewhere are taken from here, not copied.
CollectionInvoice.OPEN = Object.freeze({
  unused: { $ne: true },
  status: { $not: /collected/i },
});
CollectionInvoice.COLLECTED = Object.freeze({
  unused: { $ne: true },
  status: /collected/i,
});
/** The same condition on a read document. */
CollectionInvoice.isCollected = (i) => /collected/i.test((i && i.status) || '');
/** The same condition inside an aggregation ($cond), row by row. */
CollectionInvoice.isOpenExpr = {
  $and: [
    { $ne: ['$unused', true] },
    { $not: [{ $regexMatch: { input: { $ifNull: ['$status', ''] }, regex: /collected/i } }] },
  ],
};

// Collected and remaining under one definition.
// An invoice collected by status is collected in full (ledger invoices have no payments); otherwise collected is what was received. Remaining is what is still claimed: zero for collected, else value minus received.
CollectionInvoice.collectedOf = (i) => (CollectionInvoice.isCollected(i)
  ? Number(i.total) || 0 : Number(i && i.collectedAmount) || 0);
CollectionInvoice.remainingOf = (i) => (CollectionInvoice.isCollected(i)
  ? 0 : Math.round(((Number(i && i.total) || 0) - (Number(i && i.collectedAmount) || 0)) * 100) / 100);
/** 'full' | 'partial' | 'none'; partial is still open in every debt count. */
CollectionInvoice.stateOf = (i) => {
  if (CollectionInvoice.isCollected(i)) return 'full';
  return (Number(i && i.collectedAmount) || 0) > 0 ? 'partial' : 'none';
};
/** Partial condition: open with money received. 'Not collected' is open with nothing received. */
CollectionInvoice.PARTIAL = Object.freeze({ ...CollectionInvoice.OPEN, collectedAmount: { $gt: 0 } });
CollectionInvoice.NOT_STARTED = Object.freeze({ ...CollectionInvoice.OPEN, collectedAmount: { $not: { $gt: 0 } } });
/** Remaining inside an aggregation, for an open row (collected rows are excluded from open totals). */
CollectionInvoice.remainingExpr = {
  $subtract: [{ $ifNull: ['$total', 0] }, { $ifNull: ['$collectedAmount', 0] }],
};

module.exports = CollectionInvoice;
