/**
 * Account statement email template, edited by collections in its settings.
 * One row per template (`key`), read from the database on every draft with no cache, so edits apply on the next send. Placeholders are in brackets; see PLACEHOLDERS in controllers/collectionsMailController.
 */
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true },   // 'statement'
  subject: { type: String, default: '', trim: true, maxlength: 300 },
  body: { type: String, default: '', maxlength: 8000 },
  // Signature: text plus an optional image (logo or scanned signature) appended to every message. The image is embedded (cid) so it shows without loading external images.
  signature: { type: String, default: '', maxlength: 2000 },
  // Addresses copied on every message from this template (e.g. a manager), set once in the department settings.
  cc: { type: [String], default: [] },
  signatureImage: { type: String, default: '' },          // data:image/...;base64, up to 300 KB
  signatureImageName: { type: String, default: '' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedByName: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.models.CollectionsEmailTemplate || mongoose.model('CollectionsEmailTemplate', schema);
