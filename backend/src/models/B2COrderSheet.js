/**
 * Per-project orders Google Sheet, one tab per month (residence number, rep name, supervisor, then a column per day).
 * Read every minute by services/b2cOrderSheetSync; changes are written to the order entries. B2COrderSheetCell snapshots the last value read per cell, so untouched cells never overwrite a number edited in the system (last edit wins).
 */
const mongoose = require('mongoose');

const b2cOrderSheetSchema = new mongoose.Schema({
  projectAr: { type: String, trim: true, required: true },
  sheetId: { type: String, trim: true, required: true },
  url: { type: String, trim: true, default: '' },
  enabled: { type: Boolean, default: true },
  lastSyncAt: { type: Date, default: null },
  lastOkAt: { type: Date, default: null },
  lastError: { type: String, default: '' },
  lastChanges: { type: Number, default: 0 },
  // Sheet rows whose residence number is unknown to the system, shown so the number can be fixed or the rep registered.
  unknownIds: [{ type: String }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
b2cOrderSheetSchema.index({ sheetId: 1 }, { unique: true });

const cellSchema = new mongoose.Schema({
  sheet: { type: mongoose.Schema.Types.ObjectId, ref: 'B2COrderSheet', required: true },
  lt: { type: mongoose.Schema.Types.ObjectId, required: true },
  dateKey: { type: String, required: true },
  value: { type: Number, default: null },
}, { timestamps: true });
cellSchema.index({ sheet: 1, lt: 1, dateKey: 1 }, { unique: true });

const B2COrderSheet = mongoose.models.B2COrderSheet || mongoose.model('B2COrderSheet', b2cOrderSheetSchema);
const B2COrderSheetCell = mongoose.models.B2COrderSheetCell || mongoose.model('B2COrderSheetCell', cellSchema);
module.exports = { B2COrderSheet, B2COrderSheetCell };

/**
 * Google script key: generated once on the server and stored here, never typed by hand.
 * Embedded in the script when it is downloaded from the Google Sheets screen (manager and deputy).
 */
const keySchema = new mongoose.Schema({
  _id: { type: String, default: 'main' },
  token: { type: String, required: true },
  // Google emails of the department leads (manager, deputy, admin), added as protection editors on every tab so they can write any day cell in any month and drag rows to reorder reps.
  headEmails: [{ type: String, trim: true, lowercase: true }],
  headEmailsAt: { type: Date, default: null },
}, { timestamps: true });
const B2CSheetsKey = mongoose.models.B2CSheetsKey || mongoose.model('B2CSheetsKey', keySchema);
let keyCache = { token: '', at: 0 };
async function sheetsToken() {
  if (keyCache.token && Date.now() - keyCache.at < 60000) return keyCache.token;
  let doc = await B2CSheetsKey.findById('main').lean();
  if (!doc) {
    const token = require('crypto').randomBytes(24).toString('hex');
    await B2CSheetsKey.updateOne({ _id: 'main' }, { $setOnInsert: { token } }, { upsert: true });
    doc = await B2CSheetsKey.findById('main').lean();
  }
  keyCache = { token: doc.token, at: Date.now() };
  return doc.token;
}
module.exports.B2CSheetsKey = B2CSheetsKey;

/**
 * Rep order in a project sheet: one per project, applied to all its months.
 * `order` holds light-transport register row ids in sequence; reps not listed come after them.
 */
const orderSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, ref: 'B2CProject' },
  order: [{ type: String }],
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  source: { type: String, default: '' },
}, { timestamps: true });
module.exports.B2CSheetOrder = mongoose.models.B2CSheetOrder || mongoose.model('B2CSheetOrder', orderSchema);
module.exports.sheetsToken = sheetsToken;

/**
 * Position of each account in the legacy sheet for every month before October 2026, so old months render in their original order.
 * Filled once by scripts/b2cLegacyRowOrder.js; later months sort by supervisor then name.
 */
const legacyRowSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'B2CProject', required: true },
  month: { type: String, required: true },             // YYYY-MM
  rep: { type: mongoose.Schema.Types.ObjectId, ref: 'B2CRep', required: true },
  pos: { type: Number, required: true },
}, { timestamps: true });
legacyRowSchema.index({ project: 1, month: 1, rep: 1 }, { unique: true });
module.exports.B2CLegacyRow = mongoose.models.B2CLegacyRow || mongoose.model('B2CLegacyRow', legacyRowSchema);
