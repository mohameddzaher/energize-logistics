/**
 * User rental: a delivery-app account on one of our projects rented to a company or a person. Counted with reps in the individuals dashboard (total reps = sponsored + freelance + rented users).
 * The renter is identified by residence or ID number. The rental date is stamped automatically on the registration day in company time. A rental is ended, never erased, so past months can be reported.
 */
const mongoose = require('mongoose');

const ltUserRentalSchema = new mongoose.Schema({
  // Project, from the department project list (lt_project).
  projectAr: { type: String, trim: true, required: true, index: true },
  renterType: { type: String, enum: ['company', 'person'], required: true },
  renterName: { type: String, trim: true, required: true, maxlength: 200 },
  idNumber: { type: String, trim: true, required: true, index: true },
  phone: { type: String, trim: true, default: '' },
  // User name or number on the delivery app, optional.
  userAccount: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '', maxlength: 1000 },
  // YYYY-MM-DD in company time; stamped automatically, not chosen.
  startDate: { type: String, required: true, index: true },
  status: { type: String, enum: ['active', 'ended'], default: 'active', index: true },
  endDate: { type: String, default: '' },
  endedByName: { type: String, default: '' },
  // Link of the user row to the light transport staff cards. An active linked rental defines a rented user; see utils/ltRental.
  ltEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'LightTransportEmployee', default: null, index: true },
  // Contract type before the rental; restored when the rental ends.
  prevContractTypeAr: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, default: '' },
}, { timestamps: true });
ltUserRentalSchema.index({ ltEmployee: 1, status: 1 });

module.exports = mongoose.models.LtUserRental || mongoose.model('LtUserRental', ltUserRentalSchema);
