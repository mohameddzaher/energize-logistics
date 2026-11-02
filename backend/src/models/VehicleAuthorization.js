const mongoose = require('mongoose');

// A vehicle authorization: formal permission for one employee to operate one vehicle. Each record is one assignment period, closed (never deleted) on transfer or revocation, so history is the ordered records per vehicle or employee. Regulations require it before an employee takes a company vehicle.
const vehicleAuthorizationSchema = new mongoose.Schema(
  {
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },

    status: {
      type: String,
      enum: ['active', 'transferred', 'revoked'],
      default: 'active',
    },

    startDate: { type: String, required: true }, // Authorization date, YYYY-MM-DD.
    endDate: { type: String },                   // set when closed — YYYY-MM-DD

    authorizationType: { type: String, trim: true }, // Authorization type (driving, operation, ...).
    documentNumber: { type: String, trim: true },    // Authorization / document number.
    documentExpiry: { type: String },                // Authorization expiry, YYYY-MM-DD.
    issuedBy: { type: String, trim: true },          // Issuing authority.

    // How/why this authorization ended (only set once closed).
    endReason: { type: String, enum: ['transferred', 'revoked', 'parked', ''], default: '' },
    // On a transfer, the active record is closed pointing at the new holder, and
    // a fresh active record is created pointing back at the previous holder.
    transferredTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    transferredFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    revokedReason: { type: String, trim: true }, // Revocation reason / parking reason.

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // who issued it
    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },   // who transferred/revoked it
  },
  { timestamps: true }
);

vehicleAuthorizationSchema.index({ vehicle: 1, status: 1 });
vehicleAuthorizationSchema.index({ employee: 1, status: 1 });
vehicleAuthorizationSchema.index({ vehicle: 1, createdAt: -1 });
vehicleAuthorizationSchema.index({ employee: 1, createdAt: -1 });

module.exports = mongoose.model('VehicleAuthorization', vehicleAuthorizationSchema);
