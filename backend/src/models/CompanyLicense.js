const mongoose = require('mongoose');

// Company-level licenses & subscriptions (التراخيص والاشتراكات) — the
// government/insurance/municipal permits the company itself holds, previously
// tracked in an Excel sheet. Not tied to a specific employee. The "days left"
// column is computed on read from `expiryDate`, never stored.
const companyLicenseSchema = new mongoose.Schema(
  {
    category: { type: String, required: true, trim: true }, // التصنيف / الفئة
    name: { type: String, required: true, trim: true }, // اسم الترخيص أو الاشتراك
    duration: { type: String, trim: true }, // المدة (free text: سنوي / 3 سنوات ...)
    expiryDate: { type: String }, // تاريخ الانتهاء — YYYY-MM-DD
    location: { type: String, trim: true }, // الموقع (جدة / عقلة الصقور ...)
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

companyLicenseSchema.index({ expiryDate: 1 });
companyLicenseSchema.index({ category: 1 });
companyLicenseSchema.index({ location: 1 });

module.exports = mongoose.model('CompanyLicense', companyLicenseSchema);
