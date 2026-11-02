const mongoose = require('mongoose');

/**
 * A row of the branches report, the operations manager's daily ledger.
 * Stored as a record because it has columns missing from the operations statements: reason a trip was not fulfilled, rental type, supplier type, sales and operations reps per load, and the real selling price.
 * `trips` is the order count in the row: `sell` is per vehicle and `sellTotal` is the multiplied total, so sums must multiply and rows are not trips.
 * The source file is replaced wholesale on re-import: the collection is wiped and rewritten with file name and import date.
 */
const branchReportRowSchema = new mongoose.Schema({
  day: { type: String, trim: true, default: '', index: true },   // YYYY-MM-DD
  date: { type: Date, default: null, index: true },
  month: { type: String, trim: true, default: '', index: true }, // YYYY-MM

  branch: { type: String, trim: true, default: '', index: true },
  clientName: { type: String, trim: true, default: '', index: true },
  vendorName: { type: String, trim: true, default: '', index: true },
  vendorType: { type: String, trim: true, default: '', index: true },
  opsRep: { type: String, trim: true, default: '', index: true },
  salesRep: { type: String, trim: true, default: '', index: true },
  rentType: { type: String, trim: true, default: '', index: true },
  payType: { type: String, trim: true, default: '', index: true },  // Customer payment type: tax or cash
  fromCity: { type: String, trim: true, default: '' },
  toCity: { type: String, trim: true, default: '' },

  trips: { type: Number, default: 0 },      // Number of orders in the row
  achieved: { type: Number, default: 0 },   // Number fulfilled
  failed: { type: Number, default: 0 },     // Number not fulfilled
  failReason: { type: String, trim: true, default: '', index: true },

  sell: { type: Number, default: 0 },       // Selling price per vehicle
  buy: { type: Number, default: 0 },        // Buying price per vehicle
  sellTotal: { type: Number, default: 0 },  // Total sales as in the sheet
  buyTotal: { type: Number, default: 0 },   // Total purchases
  gp: { type: Number, default: 0 },         // Margin as in the sheet

  seq: { type: Number, default: 0 },        // Row sequence in the sheet
  sourceFile: { type: String, trim: true, default: '' },
  importedAt: { type: Date, default: Date.now },
}, { timestamps: false });

branchReportRowSchema.index({ month: 1, branch: 1 });
branchReportRowSchema.index({ date: -1 });

module.exports = mongoose.models.BranchReportRow
  || mongoose.model('BranchReportRow', branchReportRowSchema);
