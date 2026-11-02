/**
 * Attachment of a collection invoice: one file per document.
 * Kept in its own collection because both invoice stores (the tax row in `CollectionInvoice`, the cash statement in `OperationsWorkflow`) are hot models written every minute, and file arrays would slow every read and save.
 * Points to its invoice by (`kind`, `key`): tax = invoice number as in the ledger (trimmed text); cash = workflow statement id.
 * One document per file, so a page count is a single aggregation on the (`kind` + `key`) index.
 */
const mongoose = require('mongoose');

const collectionAttachmentSchema = new mongoose.Schema({
  kind: { type: String, enum: ['tax', 'cash'], required: true },
  key: { type: String, required: true, trim: true },

  fileUrl: { type: String, required: true },
  fileName: { type: String, trim: true, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },

  // Uploader, with the name stored so display needs no user lookup and survives the account being disabled.
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedByName: { type: String, trim: true, default: '' },
  uploadedAt: { type: Date, default: Date.now },
});

collectionAttachmentSchema.index({ kind: 1, key: 1, uploadedAt: -1 });

module.exports = mongoose.models.CollectionAttachment
  || mongoose.model('CollectionAttachment', collectionAttachmentSchema);
