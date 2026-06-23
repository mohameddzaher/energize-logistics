const mongoose = require('mongoose');

// A company vehicle (مركبة): car, motorcycle, heavy truck, trailer, etc. In
// Saudi an employee may only physically take/operate a company vehicle once a
// formal authorization (تفويض) has been issued — see VehicleAuthorization. The
// `currentAuthorization`/`currentEmployee` fields are denormalized pointers to
// the single ACTIVE authorization for fast fleet listing; the full assignment
// history lives in the VehicleAuthorization collection.
const vehicleSchema = new mongoose.Schema(
  {
    plateNumber: { type: String, required: true, unique: true, trim: true }, // رقم اللوحة
    type: {
      type: String,
      enum: ['car', 'motorcycle', 'heavy_truck', 'trailer', 'van', 'equipment', 'other'],
      default: 'car',
    },
    make: { type: String, trim: true },   // الصانع
    model: { type: String, trim: true },
    year: { type: Number },
    color: { type: String, trim: true },

    // Classification / ownership context (mirrors the HR sheet)
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    department: { type: String, trim: true }, // القسم (النقل الثقيل / B2C ...)
    project: { type: String, trim: true },    // المشروع (امازون / هنقرستيشن ...)

    // Documents / compliance (tracking only)
    registrationExpiry: { type: String }, // انتهاء الاستمارة — YYYY-MM-DD
    insuranceExpiry: { type: String },    // انتهاء التأمين — YYYY-MM-DD

    // Lifecycle status. `authorized` = currently assigned to an employee via an
    // active authorization; `parked` = revoked/idle; others self-explanatory.
    status: {
      type: String,
      enum: ['available', 'authorized', 'parked', 'maintenance', 'out_of_service'],
      default: 'available',
    },

    // Denormalized pointers to the active authorization (kept in sync by the
    // controller). Null when the vehicle is parked/unassigned.
    currentAuthorization: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleAuthorization' },
    currentEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },

    accidentCount: { type: Number, default: 0 },

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

vehicleSchema.index({ status: 1 });
vehicleSchema.index({ type: 1 });
vehicleSchema.index({ branch: 1 });
vehicleSchema.index({ currentEmployee: 1 });

module.exports = mongoose.model('Vehicle', vehicleSchema);
