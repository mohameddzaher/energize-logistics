/**
 * Fleet requests to maintenance: needing a truck whose maintenance is overdue.
 * The Location Solutions mirror reports an overdue truck as a red badge that was read but did not block, so trucks were loaded and failed on the road. Blocking alone is not enough (a two-hour trip to Jeddah, or maintenance may allow it until Thursday), so this table records that exchange: requested, approved or rejected, with who, when and why.
 * An approval is consumed by one load (`usedBy`); the next is requested anew, unless the service is logged, which removes the need.
 */
const mongoose = require('mongoose');

const fleetRequestSchema = new mongoose.Schema(
  {
    // One type today; the table is ready for others (part, inspection, workshop entry).
    kind: { type: String, enum: ['maintenance_override'], default: 'maintenance_override', index: true },

    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetVehicle', required: true, index: true },
    plate: { type: String, trim: true, default: '' },

    // Snapshot of what was overdue at request time: the state changes once service is logged, and a reader a month later must know what was approved.
    service: { type: String, trim: true, default: '' },
    kmToService: { type: Number, default: null },
    odometerKm: { type: Number, default: null },

    reason: { type: String, trim: true, default: '' },
    // The load being waited on, read in the maintenance decision: a two-hour trip to Jeddah differs from a long trip to Jazan.
    load: {
      customerName: { type: String, trim: true, default: '' },
      fromCity: { type: String, trim: true, default: '' },
      toCity: { type: String, trim: true, default: '' },
      loadDate: { type: String, trim: true, default: '' },
    },

    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requestedByName: { type: String, default: '' },

    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedByName: { type: String, default: '' },
    decidedAt: { type: Date },
    decisionNote: { type: String, trim: true, default: '' },

    usedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetShipment', default: null },
    usedAt: { type: Date },
  },
  { timestamps: true }
);

// One pending request per truck: a double click does not open two.
fleetRequestSchema.index({ vehicle: 1, status: 1, usedBy: 1 });

module.exports = mongoose.model('FleetRequest', fleetRequestSchema);
