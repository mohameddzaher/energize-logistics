const mongoose = require('mongoose');

// A vehicle accident/incident (حادث). Linked to the vehicle AND to the employee
// who was authorized to (responsible for) it at the time, so it surfaces in both
// the vehicle history timeline and the employee profile. `authorization` is an
// optional snapshot of the authorization active when the accident happened.
const vehicleAccidentSchema = new mongoose.Schema(
  {
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, // driver involved
    authorization: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleAuthorization' },

    date: { type: String, required: true }, // تاريخ الحادث — YYYY-MM-DD
    location: { type: String, trim: true }, // الموقع
    description: { type: String, required: true, trim: true }, // وصف الحادث / ما حدث

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
    thirdPartyDetails: { type: String, trim: true }, // تفاصيل الطرف الثالث
    injuries: { type: Boolean, default: false },     // إصابات
    actionTaken: { type: String, trim: true },       // الإجراء الذي تم
    reportNumber: { type: String, trim: true },      // رقم البلاغ / المحضر

    estimatedCost: { type: Number, default: 0 },
    actualCost: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ['reported', 'investigating', 'resolved', 'closed'],
      default: 'reported',
    },
    resolution: { type: String, trim: true }, // التسوية / النتيجة

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

vehicleAccidentSchema.index({ vehicle: 1, date: -1 });
vehicleAccidentSchema.index({ employee: 1, date: -1 });
vehicleAccidentSchema.index({ status: 1 });

module.exports = mongoose.model('VehicleAccident', vehicleAccidentSchema);
