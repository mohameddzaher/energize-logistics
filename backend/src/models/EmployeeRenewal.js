const mongoose = require('mongoose');

// One row per document renewal (إقامة / تأمين / رخصة / كارت سائق / أجير ...).
// Created whenever HR renews a dated document on the employee profile so the
// profile keeps a history of "renewed from X to Y, on this date, by whom".
const employeeRenewalSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    // Which document was renewed. Maps to the matching expiry/number fields on Employee.
    docType: {
      type: String,
      enum: ['iqama', 'passport', 'workPermit', 'insurance', 'visa', 'license', 'driverCard', 'ajeer', 'other'],
      required: true,
    },
    previousExpiry: { type: String },   // YYYY-MM-DD (before)
    newExpiry: { type: String },        // YYYY-MM-DD (after)
    documentNumber: { type: String, trim: true }, // new number if it changed
    notes: { type: String, trim: true },
    renewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    renewedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EmployeeRenewal', employeeRenewalSchema);
