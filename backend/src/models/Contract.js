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

    jobTitle: { type: String, trim: true },
    basicSalary: { type: Number, default: 0 },
    allowances: { type: Number, default: 0 },
    probationMonths: { type: Number, default: 3 },

    status: { type: String, enum: ['active', 'expired', 'terminated'], default: 'active' },
    terminatedAt: { type: Date },
    terminationReason: { type: String, trim: true },
    // Set true only once all custody/assets are returned — termination is
    // blocked until then (enforced in the controller).
    custodyReturned: { type: Boolean, default: false },

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

contractSchema.index({ employee: 1, status: 1 });
contractSchema.index({ status: 1 });
contractSchema.index({ endDate: 1 });

module.exports = mongoose.model('Contract', contractSchema);
