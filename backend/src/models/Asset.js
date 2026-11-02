const mongoose = require('mongoose');

// Custody: company property handed to an employee (laptop, phone, SIM, vehicle, tools, etc.). A contract cannot be terminated while the employee still holds any `assigned` asset (enforced in the controller).
const assetSchema = new mongoose.Schema(
  {
    // Optional: an `in_stock` item sits in the IT store and belongs to nobody.
    // Every other flow still sets it, and `status` defaults to 'assigned', so
    // existing documents and all HR code behave exactly as before.
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: false, default: null },
    name: { type: String, required: true, trim: true },
    // Every kind of item is named for what it actually is — a keyboard is a
    // keyboard, not a "tool". The vocabulary is NOT an enum: it lives in the
    // `Lookup` collection (type `asset_type`, seeded from config/assetDefaults)
    // so the section can add or rename types from Settings → Reference Data.
    // Controllers validate new values against the active lookup rows.
    type: { type: String, default: 'other', trim: true },
    serialNumber: { type: String, trim: true },
    brand: { type: String, trim: true },
    model: { type: String, trim: true },
    // Also lookup-backed (`asset_condition`) rather than an enum — same reason
    // as `type` above.
    condition: { type: String, default: 'good', trim: true },
    value: { type: Number, default: 0 },
    assignedDate: { type: String }, // YYYY-MM-DD

    // 'in_stock' = sitting in the IT store, held by nobody. 'assigned' stays the default so nothing that omits `status` changes meaning.
    // A fourth state, sold: a device is sometimes sold to an employee or an outsider. Recording it as delivered or deleting it left it counted as owned after it left, or lost the trace of where it went and for how much.
    status: { type: String, enum: ['assigned', 'returned', 'in_stock', 'sold'], default: 'assigned' },

    // The holder may not be an employee. A device is sometimes handed to someone outside the company or in a sister company. The only way was to register that person as an HR employee to link the custody, which put a company name in the employee register, and when deleted the custody was left without an owner.
    // So for a non-employee the name is stored as text: it reads in the register and does not pollute HR. `employee` stays empty then, so he is not counted in employee reports and does not block anyone's termination.
    holderName: { type: String, trim: true, default: '' },
    holderKind: { type: String, enum: ['', 'employee', 'external'], default: '' },

    // Sale: to whom and for how much
    soldTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    soldToName: { type: String, trim: true, default: '' },   // When the buyer is external
    soldDate: { type: String },                              // YYYY-MM-DD
    soldPrice: { type: Number, default: 0 },
    returnedDate: { type: String },
    returnedCondition: { type: String, trim: true },
    returnedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Additive fields for the Software & IT section. The IT custody page writes to THIS collection (never a second one) so an IT-issued laptop shows up on the employee's HR profile automatically. All optional; HR keeps working unchanged when they are absent.
    category: { type: String, default: '', trim: true },        // free text, e.g. 'IT'
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    issuedBySection: { type: String, default: '', trim: true }, // 'it' | 'hr'
    specs: { type: String, default: '', trim: true },           // e.g. 'i7 / 16GB / 512 SSD'

    // Stock fields. Consumables (cables, adapters) are not serial-tracked, so one document can stand for N identical units. Serial-tracked gear just keeps quantity 1.
    quantity: { type: Number, default: 1 },
    location: { type: String, default: '', trim: true },        // shelf / room in the store

    // Row identity from an imported register (see scripts/importItCustody.js). Only set by importers, which is what makes a re-run update instead of duplicate. Sparse, so the hundreds of hand-entered assets stay unaffected.
    // A mobile line is a record with its own details. It is custody like a laptop but is not described by brand, model and condition: it has a SIM serial, a plan, and a contract with duration and end date. Most important is the authorized person: the name registered with the carrier for the line, who differs from the holder (in 20 of 79 lines). Whoever reconciles with the carrier needs the authorized person, not the user.
    // The line number itself stays in `serialNumber`, where it was written for 64 lines before this, and is not moved so the number has one location only.
    telecom: {
      iccid: { type: String, trim: true, default: '' },        // SIM serial number
      package: { type: String, trim: true, default: '' },      // Plan; a list managed from reference data
      contractMonths: { type: Number, default: null },         // Duration in months
      expiryDate: { type: String, default: '' },               // YYYY-MM-DD
      // Authorized person at the carrier: a linked employee if known, and always the name as written.
      authorizedEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
      authorizedName: { type: String, trim: true, default: '' },
      provider: { type: String, trim: true, default: '' },     // Carrier: Mobily / stc / Zain
    },

    importKey: { type: String, trim: true },
  },
  { timestamps: true }
);

assetSchema.index({ employee: 1, status: 1 });
assetSchema.index({ status: 1 });
assetSchema.index({ serialNumber: 1 });
assetSchema.index({ importKey: 1 }, { unique: true, sparse: true });

// Any asset write clears the cached IT custody list so changes show immediately.
const bustCustodyList = () => { try { require('../utils/ttlCache').clear('it:custody'); } catch (e) { /* noop */ } };
assetSchema.post('save', bustCustodyList);
assetSchema.post(/^find.*[UD]/, bustCustodyList);

module.exports = mongoose.model('Asset', assetSchema);
