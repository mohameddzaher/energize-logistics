const mongoose = require('mongoose');

/** Accident and insurance-claim register, sourced from the Accidents sheet of the vehicles master. Distinct from `VehicleAccident`, which records the operational side (driver, authorization); this tracks the claim: fault share, Najm number, insurer, estimated vs expected recovery and the gap. */
const vehicleClaimSchema = new mongoose.Schema({
  claimId: { type: String, required: true, unique: true, trim: true, index: true }, // ACC-001
  sourceRow: Number,

  // The incident may involve a vehicle or something else (e.g. a warehouse); the flag tells which.
  isVehicleIncident: { type: Boolean, default: true, index: true },
  incidentSubjectAr: { type: String, default: '' },
  vehiclePlate: { type: String, default: '', index: true },
  vehiclePlateKey: { type: String, default: '', index: true }, // Normalized (hamza-folded) key used for linking.
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', default: null, index: true },
  vehicleSectorAr: { type: String, default: '', index: true },
  vehicleTypeAr: { type: String, default: '' },
  vehicleCategoryAr: { type: String, default: '' },
  vehicleBrandAr: { type: String, default: '' },
  ownerRegistrationAr: { type: String, default: '' },

  // Other party.
  /** Who was driving our vehicle. Suggested automatically from the vehicle's authorized person or actual light-transport driver (see `suggestDriver`) and corrected by hand, since the authorized person is not always the driver. */
  driverNameAr: { type: String, default: '' },
  driverIdNumber: { type: String, default: '', index: true },

  counterpartyNameAr: { type: String, default: '' },
  counterpartyNationalId: { type: String, default: '' },

  // Fault share: 0 = other party at fault, 100 = us. Determines the expected recovery.
  faultRatio: { type: Number, default: null },
  faultPercent: { type: Number, default: null, index: true },

  accidentDate: { type: Date, default: null, index: true },
  reportedViaAr: { type: String, default: '' },
  reportedViaCode: { type: String, default: '', index: true }, // najm / …
  accidentNumber: { type: String, default: '' },
  reportOrEstimateNumber: { type: String, default: '' },

  claim: {
    insurerAr: { type: String, default: '', index: true },
    claimNumber: { type: String, default: '' },
    claimNumberStatus: { type: String, default: '' },   // none = no claim opened yet.
    notesAr: { type: String, default: '' },
    lastNoteDate: { type: Date, default: null },
    lastInsurerUpdateDate: { type: Date, default: null, index: true },
    estimatedAmountSar: { type: Number, default: null },
    expectedRecoverySar: { type: Number, default: null },
    // Estimated minus expected recovery: the expected net loss.
    recoveryGapSar: { type: Number, default: null },
  },

  // Insurer responses form an append-only log, newest first, so replies never overwrite the negotiation history needed in a dispute.
  insurerReplies: [{
    at: { type: Date, default: Date.now },
    text: { type: String, trim: true, default: '' },
    amountSar: { type: Number, default: null },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, trim: true, default: '' },
  }],

  // Legacy status text, no longer written or read; status derives from `statusCode`.
  statusAr: { type: String, default: '' },
  statusCode: { type: String, default: '', index: true }, // pending / closed / …

  /** Claim attachments (Najm report, damage photos, workshop quote, insurer letter), each with a user-written title shown in the list. */
  attachments: [{
    title: { type: String, trim: true, default: '' },
    fileUrl: { type: String, required: true },
    fileName: { type: String, trim: true, default: '' },
    mimeType: { type: String, trim: true, default: '' },
    size: { type: Number, default: 0 },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedByName: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now },
  }],

  isActive: { type: Boolean, default: true, index: true },

  /** Who created the claim and who last touched it, for auditing the financial record. */
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, trim: true, default: '' },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastModifiedByName: { type: String, trim: true, default: '' },
}, { timestamps: true });

/** The accident carries its vehicle reference, not just the plate. The reference is resolved on create and on plate change via the unified key (utils/vehicleRef, Arabic or Latin) unless set explicitly. */
vehicleClaimSchema.pre('save', async function () {
  const plate = String(this.vehiclePlate || '').trim();
  const plateTouched = this.isNew || this.isModified('vehiclePlate');
  if (!plateTouched || !plate) return;
  const { registryPlateKey } = require('../utils/plateKey');
  if (!this.vehiclePlateKey || this.isModified('vehiclePlate')) this.vehiclePlateKey = registryPlateKey(plate) || '';
  const vehicleGiven = !!this.vehicle && (this.isNew || this.isModified('vehicle'));
  if (vehicleGiven) return;
  try {
    const hit = await require('../utils/vehicleRef').resolve(plate, '_id plateKey');
    if (hit) { this.vehicle = hit._id; if (hit.plateKey) this.vehiclePlateKey = hit.plateKey; } else if (!this.isNew) this.vehicle = null;
  } catch (_) { /* Linking never fails the save. */ }
});

vehicleClaimSchema.index({ accidentDate: -1 });
vehicleClaimSchema.index({ statusCode: 1, accidentDate: -1 });

module.exports = mongoose.models.VehicleClaim || mongoose.model('VehicleClaim', vehicleClaimSchema);
