const mongoose = require('mongoose');

// A 3PL supplier for the shipment-orders trial: whoever owns the truck when it
// is not ours. Either a company or an individual freelancer — the same row
// shape, one flag apart, because the workflow treats them identically.
//
// Suppliers are usually born from the create-shipment form ("this truck is not
// ours → whose is it?") rather than data entry, so most rows arrive with just a
// name and get enriched later.

/** A stored file (uploads/vendors) with its kind and the name the team gave it. */
const fileSchema = (what) => new mongoose.Schema({
  kind: { type: String, trim: true, default: what === 'contract' ? 'contract' : 'other' },
  title: { type: String, trim: true, default: '' },
  fileUrl: { type: String, required: true },
  fileName: { type: String, trim: true, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  uploadedAt: { type: Date, default: Date.now },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  uploadedByName: { type: String, default: '' },
});

const shipmentOrderSupplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['company', 'freelancer'], default: 'company' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },

    // Supplier data as carried by the operations platform.
    // A supplier is a commercial register, tax card, IBAN for transfers, a manager and an accountant each with a number, not just a name and phone; calling the owner about an invoice wastes a day. Payment terms are what it is settled on.
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

    // Merging.
    // One supplier may have several records in the operations platform (one has two). When two are merged, the other's id stays here so import finds it under either and does not recreate it. The merged record stays disabled with `mergedInto`, a permanent trail.
    externalIds: { type: [String], default: [], index: true },
    mergedInto: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderSupplier', default: null },
    isActive: { type: Boolean, default: true },

    // Vendors management: the master-sheet profile the vendors team keeps on each carrier (imported once from their
    // sheets, then worked here). Activity is never stored: it is read from the shipments every time.
    inMaster: { type: Boolean, default: false, index: true },
    masterNo: { type: Number, default: null },
    isNewVendor: { type: Boolean, default: false },
    /** The vendors team member who follows this vendor (name as the team writes it, and the account when known). */
    followOwner: { type: String, trim: true, default: '', index: true },
    followUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /** Our operations rep who brought or deals with the vendor. */
    energizeRep: { type: String, trim: true, default: '' },
    taxClass: { type: String, trim: true, default: '' },
    representative: { type: String, trim: true, default: '' },
    destinations: { type: String, trim: true, default: '' },
    headOffice: { type: String, trim: true, default: '' },
    vehicleTypes: { type: String, trim: true, default: '' },
    fleetSize: { type: Number, default: null },
    hasPapers: { type: Boolean, default: false },
    vendorSigned: { type: Boolean, default: false },
    ourSigned: { type: Boolean, default: false },
    contractDate: { type: String, trim: true, default: '' },
    contractStatus: { type: String, trim: true, default: '', index: true },
    paymentTermDays: { type: Number, default: null },
    financeCode: { type: String, trim: true, default: '' },
    financeClass: { type: String, trim: true, default: '' },
    previousName: { type: String, trim: true, default: '' },
    /** Follow-up priority for an active carrier not yet on the master (أولوية 1/2/3). */
    leadPriority: { type: String, trim: true, default: '' },
    /** The other names this carrier is written under in shipments; their folded keys join shipments to this row. */
    aliases: { type: [String], default: [] },
    aliasKeys: { type: [String], default: [], index: true },
    /** The team's own rating (1-5) beside the computed one. */
    rating: { type: Number, default: null, min: 1, max: 5 },
    ratingNote: { type: String, trim: true, default: '' },
    lastFollowUpAt: { type: Date, default: null },
    /** The person at the carrier the team deals with day to day (often not the owner). */
    operatorName: { type: String, trim: true, default: '' },
    operatorPhone: { type: String, trim: true, default: '' },
    /** Company papers. cr, nationalAddress, iban and taxCard are required for a new company; `other` carries a typed title. */
    documents: { type: [fileSchema('document')], default: [] },
    /** Official contract: null = not stated yet (legacy rows fall back to contractStatus), true/false once the team marks it. */
    contracted: { type: Boolean, default: null },
    contractEndDate: { type: Date, default: null },
    contractFiles: { type: [fileSchema('contract')], default: [] },
    /** Last contract-expiry notification sent (`<end day>:<soon|expired>`), so each state is announced once. */
    contractAlertKey: { type: String, default: '' },
    /**
     * Approval of a carrier added by the team. Missing on legacy rows, which read as approved; only approved carriers
     * (missing or 'approved') are offered in pickers. 'returned' = sent back for edits, resubmitted to 'pending'.
     */
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected', 'returned'], default: undefined, index: true },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    submittedByName: { type: String, default: '' },
    submittedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedByName: { type: String, default: '' },
    approvedAt: { type: Date, default: null },
    rejectNote: { type: String, trim: true, default: '' },
    approvalLog: { type: [{ action: String, note: String, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, byName: String, at: { type: Date, default: Date.now } }], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shipmentOrderSupplierSchema.index({ name: 1 });

/** The folded key every carrier name is joined by (alef forms, ta marbuta, ya, Persian letters, spaces). */
const foldName = (v) => String(v || '')
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/چ/g, 'ج').replace(/گ/g, 'ك').replace(/ڤ/g, 'ف').replace(/پ/g, 'ب')
  .replace(/[\u064B-\u0652\u0640]/g, '')
  .replace(/[\s\u00a0]+/g, ' ').trim().toLowerCase();
shipmentOrderSupplierSchema.statics.foldName = foldName;

shipmentOrderSupplierSchema.pre('save', function keys(next) {
  if (this.isModified('name') || this.isModified('aliases') || !this.aliasKeys?.length) {
    this.aliasKeys = [...new Set([this.name, ...(this.aliases || [])].map(foldName).filter(Boolean))];
  }
  next();
});

// Saved shipment-order lists are cleared on every write.
// The suppliers and trucks lists are cached for two minutes (so:registry) because reading them from the cluster is slow. A supplier appears inside the trucks list and its truck count in its own list, so any write to either, from any screen or script, clears the whole prefix.
const clearRegistry = () => {
  try {
    const c = require('../utils/ttlCache');
    c.clear('so:registry:');
    // A carrier's kind, master flag, owner or contract moves the vendors section's numbers.
    c.clear('so:analytics:vendor-yearly');
    c.clear('so:analytics:vm-');
  } catch (_) { /* */ }
};
for (const op of ['save', 'findOneAndUpdate', 'updateOne', 'updateMany', 'insertMany', 'bulkWrite', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  shipmentOrderSupplierSchema.post(op, clearRegistry);
}

module.exports = mongoose.models.ShipmentOrderSupplier
  || mongoose.model('ShipmentOrderSupplier', shipmentOrderSupplierSchema);
