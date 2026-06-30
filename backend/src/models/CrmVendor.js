const mongoose = require('mongoose');

// CRM Vendor (مورد) — a carrier/transporter (company or individual) Energize
// subcontracts to in 3PL operations when our own fleet is full. Kept in its OWN
// collection (separate from CrmCompany/customers) because it has a distinct,
// carrier-specific shape (cars, routes, contract pipeline, our rep…).
const crmVendorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    isNewVendor: { type: Boolean, default: false },
    energizeRep: { type: String, trim: true },        // مندوب تنشيط (our rep handling them)
    vendorType: { type: String, trim: true },         // ضريبي / كاش / آجل (payment type)
    representative: { type: String, trim: true },     // ممثل المورد (their contact person)
    mobile: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    destinations: { type: String, trim: true },       // routes/cities they cover
    headOffice: { type: String, trim: true },         // their HQ city
    carsCount: { type: Number, default: null },
    hasPapers: { type: Boolean, default: null },      // العقد/الأوراق متوفرة
    vendorSideSigned: { type: Boolean, default: null },
    ourSideSigned: { type: Boolean, default: null },
    contractDate: { type: String, trim: true },       // kept as text (mixed dd/mm/yyyy + iso in source)
    followUpStatus: { type: String, trim: true },     // موقع / تم ارسال العقد / قيد متابعة / معلق …
    notes: { type: String, trim: true },

    // The source sheet's id — used to dedup on re-seed.
    externalId: { type: Number },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

crmVendorSchema.index({ name: 1 });
crmVendorSchema.index({ followUpStatus: 1 });
crmVendorSchema.index({ energizeRep: 1 });
crmVendorSchema.index({ externalId: 1 }, { unique: true, partialFilterExpression: { externalId: { $type: 'number' } } });

module.exports = mongoose.model('CrmVendor', crmVendorSchema);
