const mongoose = require('mongoose');

// Company-level licenses and subscriptions: the government, insurance and municipal permits the company itself holds, previously tracked in Excel. Not tied to an employee. The "days left" column is computed on read from `expiryDate`, never stored.
const companyLicenseSchema = new mongoose.Schema(
  {
    category: { type: String, required: true, trim: true }, // Category
    name: { type: String, required: true, trim: true }, // License or subscription name
    duration: { type: String, trim: true }, // Duration (free text: yearly / 3 years ...)
    expiryDate: { type: String }, // Expiry date, YYYY-MM-DD
    location: { type: String, trim: true }, // Location (Jeddah / Aqla al-Suqur ...)
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

companyLicenseSchema.index({ expiryDate: 1 });
companyLicenseSchema.index({ category: 1 });
companyLicenseSchema.index({ location: 1 });

module.exports = mongoose.model('CompanyLicense', companyLicenseSchema);
