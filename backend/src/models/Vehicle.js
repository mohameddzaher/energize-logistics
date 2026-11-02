const mongoose = require('mongoose');

// A company vehicle: car, motorcycle, heavy truck, trailer, etc. In Saudi an employee may only take or operate a company vehicle once a formal authorization is issued; see VehicleAuthorization. `currentAuthorization`/`currentEmployee` are denormalized pointers to the single ACTIVE authorization for fast fleet listing; the full assignment history lives in the VehicleAuthorization collection.
const vehicleSchema = new mongoose.Schema(
  {
    plateNumber: { type: String, required: true, unique: true, trim: true }, // Plate number
    type: {
      type: String,
      enum: ['car', 'motorcycle', 'heavy_truck', 'trailer', 'van', 'equipment', 'other'],
      default: 'car',
    },
    make: { type: String, trim: true },   // Manufacturer
    model: { type: String, trim: true },
    year: { type: Number },
    color: { type: String, trim: true },

    // Classification / ownership context (mirrors the HR sheet)
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    department: { type: String, trim: true }, // Department (heavy transport / B2C ...)
    project: { type: String, trim: true },    // Project (Amazon / HungerStation ...)

    // Documents / compliance (tracking only)
    registrationExpiry: { type: String }, // Registration expiry, YYYY-MM-DD
    insuranceExpiry: { type: String },    // Insurance expiry, YYYY-MM-DD

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

    // The same vehicle in the vehicle register (the paper record, which is the reference).
    // This record is now a mirror of that register for authorizations; see utils/vehicleAuthorization. The link is stored here once known by plate, so it is not re-guessed from text typed with one or two spaces.
    master: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', default: null, index: true },

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

vehicleSchema.index({ status: 1 });
vehicleSchema.index({ type: 1 });
vehicleSchema.index({ branch: 1 });
vehicleSchema.index({ currentEmployee: 1 });

// Any vehicle write clears the cached vehicles list so edits show immediately.
const bustVehiclesList = () => { try { require('../utils/ttlCache').clear('vehicles:list'); } catch (e) { /* noop */ } };
vehicleSchema.post('save', bustVehiclesList);
vehicleSchema.post(/^find.*[UD]/, bustVehiclesList);

module.exports = mongoose.model('Vehicle', vehicleSchema);
