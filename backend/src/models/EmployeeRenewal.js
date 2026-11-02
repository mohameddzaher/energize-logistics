const mongoose = require('mongoose');

// One row per document renewal (residence, insurance, license, driver card, Ajeer ...). Created whenever HR renews a dated document on the employee profile, so the profile keeps a history of renewed from X to Y, on this date, by whom.
const employeeRenewalSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    // Which document was renewed. Maps to the matching expiry/number fields on Employee.
    docType: {
      type: String,
      // Values cover every document group on the HR dashboard. A group with no type here had no renewal, so dates were edited by hand with no trace of who renewed it or from what date to what.
      enum: ['iqama', 'passport', 'workPermit', 'insurance', 'visa', 'license',
             'driverCard', 'ajeer', 'contract', 'healthCert', 'other'],
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
