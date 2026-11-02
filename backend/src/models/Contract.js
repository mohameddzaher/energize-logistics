const mongoose = require('mongoose');

// An employment contract. Each employee has at most one `active` contract at a
// time. The contract defines the annual leave entitlement that drives the
// progressive leave-balance maths (see utils/leaveBalance.js).
const contractSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },

    type: { type: String, enum: ['fixed', 'unlimited'], default: 'fixed' },
    startDate: { type: String, required: true }, // YYYY-MM-DD
    endDate: { type: String }, // YYYY-MM-DD (empty for unlimited)
    durationMonths: { type: Number, default: 12 },

    // Annual leave days granted by this contract (e.g. 30 or 21). This is the
    // entitlement the balance accrues toward.
    annualLeaveDays: { type: Number, required: true, default: 21 },
    // Balance carried over from the previous contract.
    // Balance accrues from the start of the active contract, so a new contract at renewal would reset accrual to zero while taken leave stays counted, making the balance negative on renewal day. Unused days are the employee's right. They are computed at renewal and fixed here, with the new year's accrual added.
    carriedOverDays: { type: Number, default: 0 },
    // The contract this one renewed; gives the employee's contract sequence.
    renewedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract' },

    jobTitle: { type: String, trim: true },
    basicSalary: { type: Number, default: 0 },
    allowances: { type: Number, default: 0 },
    probationMonths: { type: Number, default: 3 },

    // Two states, not four: active or expired.
    // Terminated counts as expired and renewed as active (its new contract). The termination reason and date stay in the fields below so nothing is lost by unifying the wording.
    // Legacy values are folded before validation (below); scripts/contractTwoStatuses folds stored ones.
    status: { type: String, enum: ['active', 'expired'], default: 'active' },
    terminatedAt: { type: Date },
    // Ended together with the employee's service; reactivating the employee restores the contract to its prior state.
    endedByTermination: { type: Boolean, default: false },
    statusBeforeTermination: { type: String, default: '' },
    terminationReason: { type: String, trim: true },
    // Set true only once all custody/assets are returned — termination is
    // blocked until then (enforced in the controller).
    custodyReturned: { type: Boolean, default: false },

    // Fields from the employee contracts file.
    // The contract is an official paper with data absent from the employee file: ID number as written in the contract, and the profession as in the contract (differs from the residence profession and job title, and is what inspections check), plus the commercial register it was issued under. The page used to show six of ten columns.
    iqamaNumber: { type: String, trim: true, default: '' },        // ID number
    employeeNameAr: { type: String, trim: true, default: '' },     // Name as in the contract
    contractProfession: { type: String, trim: true, default: '' }, // Profession in the contract
    sponsorRegistration: { type: String, trim: true, default: '' },// Commercial register
    // Contract number.
    // Its number in Qiwa, which inspections and correspondence with the office ask for instead of the employee name; it used to be looked up in the sheet each time.
    contractNumber: { type: String, trim: true, default: '', index: true },

    // "Not required" in the leave or probation field is a valid state, not missing data: a seasonal contract has no annual leave. Forcing it into the number would make it zero and the contract look incomplete, so the text is kept next to the number.
    annualLeaveText: { type: String, trim: true, default: '' },
    probationText: { type: String, trim: true, default: '' },

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

contractSchema.index({ employee: 1, status: 1 });
contractSchema.index({ status: 1 });
contractSchema.index({ endDate: 1 });

/**
 * Every contract save refreshes its snapshot on the employee file.
 * Status, both dates and the number are read in the master and expiries from fields on the employee (see utils/contractStatus). Controllers call the sync after each write; this hook is the safety net for paths that bypass them, such as an import script or a future endpoint.
 */
// An old "terminated" or "renewed" contract not yet migrated is folded on first save, otherwise validation would reject it and old contracts could not be edited. Renewed was succeeded by an active contract, so it is expired.
contractSchema.pre('validate', function twoStatuses(next) {
  if (this.status === 'terminated' || this.status === 'renewed') this.status = 'expired';
  next();
});
// The term decides: past its end date is expired; an extended end date makes it active again.
contractSchema.pre('save', function statusFollowsTerm(next) {
  const { isLapsed } = require('../utils/contractStatus');
  if (this.status === 'active' && isLapsed(this.endDate)) this.status = 'expired';
  // A contract ended by termination (`terminatedAt`) is not reactivated by extending the date: it was "terminated" before the states became two.
  else if (this.status === 'expired' && !this.terminatedAt && !this.isNew && this.isModified('endDate') && !this.isModified('status') && !isLapsed(this.endDate)) this.status = 'active';
  next();
});
contractSchema.post('save', async function mirrorToEmployee(doc) {
  try { await require('../utils/contractStatus').syncEmployeeContractStatus(doc.employee); }
  catch (e) { console.error('contract → employee:', e.message); }
});

module.exports = mongoose.model('Contract', contractSchema);
