/** Custody ledger: entry fields defined once, from which light-transport (models/LtCustody) and heavy-transport (models/HtCustody) custody build their records. Same rules: three accounts, inflow sources, a transfer as two entries (see models/LtCustody). Heavy adds an optional Location Solutions truck per entry, with unit number and plate captured at entry time like the rep. */
const mongoose = require('mongoose');

const ACCOUNTS = ['cash', 'card', 'workshop'];
// Allowed inflow sources per account.
const IN_SOURCES = { cash: ['card', 'workshop', 'bank', 'rep'], card: ['bank'], workshop: ['maintenance'] };
// Accounts that disburse to cash.
const TO_CASH = ['card', 'workshop'];

function buildCustodySchema({ vehicles = false } = {}) {
  const schema = new mongoose.Schema({
    account: { type: String, enum: ACCOUNTS, required: true, index: true },
    direction: { type: String, enum: ['in', 'out'], required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    // Movement day, YYYY-MM-DD in company time; used for filtering and ordering.
    date: { type: String, required: true, index: true },

    // Inflow: where from.
    source: { type: String, enum: ['card', 'workshop', 'bank', 'maintenance', 'rep', 'opening', ''], default: '' },

    // Outflow: to whom. `cash` is a transfer to the cash account; anything else is a bearer.
    target: { type: String, enum: ['rep', 'company', 'cash', ''], default: '' },
    // Bearer is a rep: residence number and details captured at entry time.
    repIdNumber: { type: String, trim: true, default: '' },
    repName: { type: String, trim: true, default: '' },
    repNationality: { type: String, trim: true, default: '' },
    repProject: { type: String, trim: true, default: '' },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    // Statement: what the spend was for (required for the company, optional for a rep).
    detail: { type: String, trim: true, default: '', maxlength: 500 },

    // Entry attachments: invoice, receipt or transfer image. Optional, may be several.
    attachments: {
      type: [{
        title: { type: String, trim: true, default: '' },
        fileUrl: { type: String, required: true },
        fileName: { type: String, default: '' },
        mimeType: { type: String, default: '' },
        size: { type: Number, default: 0 },
        uploadedByName: { type: String, default: '' },
        uploadedAt: { type: Date, default: Date.now },
      }],
      default: [],
    },
    // Last edit of a recorded entry; finance and system admin only.
    editedByName: { type: String, default: '' },
    editedAt: { type: Date, default: null },

    // Both entries of a transfer carry the same id.
    transferId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' },
  }, { timestamps: true });
  if (vehicles) {
    schema.add({
      // Truck from the Location Solutions fleet (Ls2Vehicle.unitId); plate and name captured.
      vehicleUnitId: { type: Number, default: null, index: true },
      vehiclePlate: { type: String, trim: true, default: '' },
      vehicleName: { type: String, trim: true, default: '' },
      // Its vehicle in the vehicle registry, resolved from the unit (Ls2Vehicle.vehicleMaster).
      vehicleMaster: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', default: null, index: true },
    });
  }
  schema.index({ account: 1, date: -1, createdAt: -1 });
  return schema;
}

module.exports = { ACCOUNTS, IN_SOURCES, TO_CASH, buildCustodySchema };
