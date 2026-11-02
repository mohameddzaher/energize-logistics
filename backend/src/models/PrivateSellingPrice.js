/**
 * LEGACY: no longer written or read. The selling value is now the single column `OperationsWorkflow.sellingValue` (see operationsPrivateController); leftover rows are matched with scripts/reconcilePrivateSellingPrices.js (dry run first, `--apply` copies to the report).
 * The platform's report carries a selling price equal to purchase price, and sync would overwrite an edit and might push it back, exposing our margin; so the real price lived in this table, keyed by report, never read by sync.
 * Sources: branches report (one-time import), customer file route price (latest), and a user's edit (newest).
 */
const mongoose = require('mongoose');

const privateSellingPriceSchema = new mongoose.Schema({
  // The report in the operations workflow; the row's real key.
  workflow: {
    type: mongoose.Schema.Types.ObjectId, ref: 'OperationsWorkflow', required: true, unique: true, index: true,
  },
  // The report number is stored too, for search and export without another join.
  reportNumber: { type: String, trim: true, default: '', index: true },

  sellingValue: { type: Number, default: 0 },
  // Where this number came from: sheet | route | manual
  source: { type: String, trim: true, default: '' },
  // Note from whoever edited it, e.g. agreed with the customer on a price.
  note: { type: String, trim: true, default: '' },

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedByName: { type: String, trim: true, default: '' },
}, { timestamps: true });

module.exports = mongoose.models.PrivateSellingPrice
  || mongoose.model('PrivateSellingPrice', privateSellingPriceSchema);
