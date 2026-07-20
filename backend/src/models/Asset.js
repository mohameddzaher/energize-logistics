const mongoose = require('mongoose');

// Custody (العهدة): company property handed to an employee — laptop, phone,
// SIM, vehicle, tools, etc. A contract cannot be terminated while the employee
// still holds any `assigned` asset (enforced in the controller).
const assetSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['laptop', 'phone', 'sim', 'vehicle', 'tool', 'access_card', 'other'],
      default: 'other',
    },
    serialNumber: { type: String, trim: true },
    brand: { type: String, trim: true },
    model: { type: String, trim: true },
    condition: { type: String, enum: ['new', 'good', 'fair', 'damaged'], default: 'good' },
    value: { type: Number, default: 0 },
    assignedDate: { type: String }, // YYYY-MM-DD

    status: { type: String, enum: ['assigned', 'returned'], default: 'assigned' },
    returnedDate: { type: String },
    returnedCondition: { type: String, enum: ['new', 'good', 'fair', 'damaged'] },
    returnedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // ── Additive fields for the Software & IT section ────────────────────────
    // The IT العهد page writes to THIS collection (never a second one) so an
    // IT-issued laptop shows up on the employee's HR profile automatically.
    // All optional — HR keeps working unchanged when they are absent.
    category: { type: String, default: '', trim: true },        // free text, e.g. 'IT'
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    issuedBySection: { type: String, default: '', trim: true }, // 'it' | 'hr'
    specs: { type: String, default: '', trim: true },           // e.g. 'i7 / 16GB / 512 SSD'
  },
  { timestamps: true }
);

assetSchema.index({ employee: 1, status: 1 });
assetSchema.index({ status: 1 });
assetSchema.index({ serialNumber: 1 });

module.exports = mongoose.model('Asset', assetSchema);
