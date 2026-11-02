const mongoose = require('mongoose');

/**
 * Payment of residence or work-permit renewal fees, not the renewal itself.
 * Key is (employee, document, expiry date): money is paid per cycle of a document. After HR renews, the expiry date changes and that is a new unpaid cycle; keyed on employee and document alone, it would stay paid forever and finance would read next year's residence as paid.
 * So the date is part of the key; the old payment stays as a record, never erased or moved.
 * Undo is void, not delete: a mistaken payment is voided (`voided`) and stays with who, when and why. The unique index covers active payments only, so the same cycle can be recorded again after a void.
 */
const DOC_TYPES = ['iqama', 'workPermit'];

const fileSchema = new mongoose.Schema({
  fileUrl: { type: String, required: true },
  fileName: { type: String, trim: true, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: false });

const hrDocPaymentSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  docType: { type: String, enum: DOC_TYPES, required: true },
  // Expiry date of the paid cycle (YYYY-MM-DD) as in the file at payment time.
  expiryDate: { type: String, required: true, trim: true },

  // Snapshot that survives file changes: a payment is a document read a year later.
  snapshot: {
    name: { type: String, trim: true, default: '' },
    employeeNumber: { type: String, trim: true, default: '' },
    idNumber: { type: String, trim: true, default: '' },
    department: { type: String, trim: true, default: '' },
  },

  // Amount is optional: many fees are paid in one lump for several employees.
  amount: { type: Number, default: null, min: 0 },
  note: { type: String, trim: true, default: '' },
  files: [fileSchema],

  paidAt: { type: Date, default: Date.now },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  paidByName: { type: String, trim: true, default: '' },

  voided: { type: Boolean, default: false, index: true },
  voidedAt: { type: Date, default: null },
  voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  voidedByName: { type: String, trim: true, default: '' },
  voidNote: { type: String, trim: true, default: '' },
}, { timestamps: true });

// One active payment per cycle.
hrDocPaymentSchema.index(
  { employee: 1, docType: 1, expiryDate: 1 },
  { unique: true, partialFilterExpression: { voided: false } },
);
hrDocPaymentSchema.index({ paidAt: -1 });

module.exports = mongoose.models.HrDocPayment || mongoose.model('HrDocPayment', hrDocPaymentSchema);
module.exports.DOC_TYPES = DOC_TYPES;
