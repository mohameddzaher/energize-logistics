/**
 * Ls2DriverAssignment — who drove which truck, and when.
 *
 * Wialon only tells us the CURRENT driver (it's embedded in the unit name), with
 * no history. So the poll watches for the driver on a unit changing and records
 * it here: the previous assignment is closed (`to` = now) and a new open one
 * (`to` = null) is started. History therefore accumulates from the moment this
 * shipped — we can't invent what we were never told.
 */
const mongoose = require('mongoose');

const ls2DriverAssignmentSchema = new mongoose.Schema({
  unitId: { type: Number, required: true, index: true },
  plate: { type: String, default: '' },
  driver: { type: String, default: '', index: true },
  from: { type: Date, default: Date.now },
  to: { type: Date, default: null }, // null → still driving this truck
}, { timestamps: true });

ls2DriverAssignmentSchema.index({ unitId: 1, from: -1 });
ls2DriverAssignmentSchema.index({ driver: 1, from: -1 });

module.exports = mongoose.models.Ls2DriverAssignment || mongoose.model('Ls2DriverAssignment', ls2DriverAssignmentSchema);
