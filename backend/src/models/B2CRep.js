const mongoose = require('mongoose');

const b2cRepSchema = new mongoose.Schema(
  {
    repId: { type: String, trim: true, index: true }, // App account ID (rep's login on the delivery app)
    arabicName: { type: String, trim: true },
    englishName: { type: String, trim: true, required: true },
    phone: { type: String, trim: true },
    joiningDate: { type: Date },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'B2CProject' },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    /**
     * Supervisor responsible for this rep.
     * A branch says where the rep works, not who oversees him, and one branch can hold two supervisors and thirty reps. Administrative link, not a permission: it decides who sees these reps on the duty-check screen. See controllers/b2cDutyController.
     */
    supervisor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    /**
     * Row in the department register.
     * This record is the rep's delivery-app account; the light-transport register (`LightTransportEmployee`) is our own file for him. Name matching was unreliable because the app spells one person several ways, so once a row is identified (by match or by a user) it is stored here and assignment follows this link, not name similarity.
     */
    ltEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'LightTransportEmployee', default: null, index: true },
    monthlyTarget: { type: Number, default: 400 },
    dailyTarget: { type: Number, default: 15 },
    expectedWorkingDays: { type: Number, default: 26 },
    isActive: { type: Boolean, default: true },
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Composite uniqueness: repId per project (when both present)
b2cRepSchema.index({ repId: 1, project: 1 }, { unique: false, sparse: true });
b2cRepSchema.index({ englishName: 1 });
b2cRepSchema.index({ project: 1, isActive: 1 });
b2cRepSchema.index({ branch: 1, isActive: 1 });
b2cRepSchema.index({ supervisor: 1, isActive: 1 });

module.exports = mongoose.model('B2CRep', b2cRepSchema);
