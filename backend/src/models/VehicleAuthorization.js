const mongoose = require('mongoose');

// A vehicle authorization (تفويض): the formal permission for ONE employee to
// hold/operate ONE vehicle. Each record is a single assignment period — it is
// created when a vehicle is authorized to an employee and CLOSED (never deleted)
// when the authorization is transferred to another employee or revoked (vehicle
// parked). The complete history of a vehicle = all of its authorization records
// ordered by time; the same is true per employee. This mirrors how custody
// works but is its own first-class entity because Saudi regulations require a
// تفويض before an employee may take a company car/motorcycle/heavy truck.
const vehicleAuthorizationSchema = new mongoose.Schema(
  {
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },

    status: {
      type: String,
      enum: ['active', 'transferred', 'revoked'],
      default: 'active',
    },

    startDate: { type: String, required: true }, // تاريخ التفويض — YYYY-MM-DD
    endDate: { type: String },                   // set when closed — YYYY-MM-DD

    authorizationType: { type: String, trim: true }, // نوع التفويض (قيادة / تشغيل ...)
    documentNumber: { type: String, trim: true },    // رقم التفويض / الوثيقة
    documentExpiry: { type: String },                // انتهاء التفويض — YYYY-MM-DD
    issuedBy: { type: String, trim: true },          // جهة الإصدار

    // How/why this authorization ended (only set once closed).
    endReason: { type: String, enum: ['transferred', 'revoked', 'parked', ''], default: '' },
    // On a transfer, the active record is closed pointing at the new holder, and
    // a fresh active record is created pointing back at the previous holder.
    transferredTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    transferredFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    revokedReason: { type: String, trim: true }, // سبب الإلغاء / سبب الركن

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
