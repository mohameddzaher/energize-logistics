const mongoose = require('mongoose');

/** A file uploaded against a vehicle (registration copy, operating card, insurance document, inspection form). Kept as its own record because a vehicle has dates and numbers while this holds the images, one-to-many; embedding would bloat every fleet read. Bytes live under uploads/vehicles and `fileUrl` is the served path; `title` is user-written; `category` ties a file to its document family. */
const vehicleDocumentSchema = new mongoose.Schema(
  {
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', required: true, index: true },
    // Plate snapshot so the file stays readable in the audit log after the vehicle is deleted.
    plateNumber: { type: String, trim: true, default: '' },
    title: { type: String, required: true, trim: true },
    // insurance / operatingCard / vehicleLicense / inspection / gps / authorization / other
    category: { type: String, trim: true, default: 'other', index: true },
    fileUrl: { type: String, required: true },
    fileName: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    size: { type: Number, default: 0 },
    expiryDate: { type: String },   // Optional, YYYY-MM-DD.
    notes: { type: String, trim: true, default: '' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedByName: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);

vehicleDocumentSchema.index({ vehicle: 1, createdAt: -1 });

module.exports = mongoose.models.VehicleDocument || mongoose.model('VehicleDocument', vehicleDocumentSchema);
