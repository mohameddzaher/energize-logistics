const mongoose = require('mongoose');

/**
 * An invoice line uploaded from the sales sheet.
 * The invoice-data upload writes the sheet's values onto statements and then forgets the sheet. A line with no statement is reported once in the preview and lost, and an invoice whose sheet says 4025 against statements totaling 3500 is unknown after the window closes.
 * So each line is kept as in the sheet: invoice number, the statement it names, its value, the customer name as the accountant typed it, who uploaded and when. The three workflow cards (statement not found, value difference, different customer name) are computed live from it: fixing the statement drops the line from the card without a new upload.
 * One line is (invoice, statement); a later sheet naming it overwrites (newest wins, same rule the upload applies to the statement).
 */
const invoiceUploadLineSchema = new mongoose.Schema({
  invoiceNumber: { type: String, trim: true, required: true },
  reportNumber: { type: String, trim: true, required: true },
  // Values in the sheet: line net, its tax and its total. `total` is what is compared.
  net: { type: Number, default: null },
  tax: { type: Number, default: null },
  total: { type: Number, default: null },
  customerName: { type: String, trim: true, default: '' },
  invoiceDate: { type: Date, default: null },

  // Batch: one upload is one id, with the file and who uploaded.
  batchId: { type: String, trim: true, index: true },
  fileName: { type: String, trim: true, default: '' },
  sheet: { type: String, trim: true, default: '' },
  sheetRow: { type: Number, default: null },
  uploadedAt: { type: Date, default: Date.now, index: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedByName: { type: String, trim: true, default: '' },
}, { timestamps: true });

invoiceUploadLineSchema.index({ invoiceNumber: 1, reportNumber: 1 }, { unique: true });
invoiceUploadLineSchema.index({ reportNumber: 1 });

module.exports = mongoose.model('InvoiceUploadLine', invoiceUploadLineSchema);
