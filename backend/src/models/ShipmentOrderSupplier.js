const mongoose = require('mongoose');

// A 3PL supplier for the shipment-orders trial: whoever owns the truck when it
// is not ours. Either a company or an individual freelancer — the same row
// shape, one flag apart, because the workflow treats them identically.
//
// Suppliers are usually born from the create-shipment form ("this truck is not
// ours → whose is it?") rather than data entry, so most rows arrive with just a
// name and get enriched later.
const shipmentOrderSupplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['company', 'freelancer'], default: 'company' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },

    // ── بياناتُ المورّد كما تحملها منصّةُ الأوبريشن ───────────────────────────
    // المورّدُ ليس اسمًا ورقمَ هاتف: هو سجلٌّ تجاريٌّ وبطاقةٌ ضريبيّةٌ وآيبان
    // يُحوَّل إليه المال، ومديرٌ ومحاسبٌ لكلٍّ رقمُه — الاتّصالُ بالمالك في
    // شأن فاتورةٍ يضيّع يومًا. وشروطُ السداد هي ما يُحاسَب عليه.
    externalId: { type: String, trim: true, default: '', index: true },
    commercialRegister: { type: String, trim: true, default: '' },
    taxCard: { type: String, trim: true, default: '' },
    nationalAddress: { type: String, trim: true, default: '' },
    bankName: { type: String, trim: true, default: '' },
    iban: { type: String, trim: true, default: '' },
    ownerName: { type: String, trim: true, default: '' },
    ownerPhone: { type: String, trim: true, default: '' },
    managerName: { type: String, trim: true, default: '' },
    managerPhone: { type: String, trim: true, default: '' },
    accountantName: { type: String, trim: true, default: '' },
    accountantPhone: { type: String, trim: true, default: '' },
    paymentTerms: { type: String, trim: true, default: '' },
    agreedPriceStatement: { type: String, trim: true, default: '' },
    contractFile: { type: String, trim: true, default: '' },

    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shipmentOrderSupplierSchema.index({ name: 1 });

module.exports = mongoose.models.ShipmentOrderSupplier
  || mongoose.model('ShipmentOrderSupplier', shipmentOrderSupplierSchema);
