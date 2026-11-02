const mongoose = require('mongoose');

// A vehicle accident, linked to the vehicle and to the employee authorized for it at the time, so it shows in both the vehicle timeline and the employee profile. `authorization` optionally snapshots the authorization active then.
const vehicleAccidentSchema = new mongoose.Schema(
  {
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, // driver involved
    authorization: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleAuthorization' },

    date: { type: String, required: true }, // Accident date, YYYY-MM-DD.
    location: { type: String, trim: true }, // Location.
    description: { type: String, required: true, trim: true }, // What happened.

    // Who was at fault.
    faultParty: {
      type: String,
      enum: ['employee', 'third_party', 'shared', 'none', 'unknown'],
      default: 'unknown',
    },
    severity: {
      type: String,
      enum: ['minor', 'moderate', 'severe', 'total_loss'],
      default: 'minor',
    },
    thirdPartyDetails: { type: String, trim: true }, // Third-party details.
    injuries: { type: Boolean, default: false },     // Injuries.
    actionTaken: { type: String, trim: true },       // Action taken.
    reportNumber: { type: String, trim: true },      // Report / police record number.

    estimatedCost: { type: Number, default: 0 },
    actualCost: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ['reported', 'investigating', 'resolved', 'closed'],
      default: 'reported',
    },
    resolution: { type: String, trim: true }, // Settlement / outcome.

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

vehicleAccidentSchema.index({ vehicle: 1, date: -1 });
vehicleAccidentSchema.index({ employee: 1, date: -1 });
vehicleAccidentSchema.index({ status: 1 });

module.exports = mongoose.model('VehicleAccident', vehicleAccidentSchema);
