const mongoose = require('mongoose');

// One issue (صرف) of spare parts out of the workshop store — the record that
// answers "this filter left the shelf on this date, onto this vehicle".
//
// Spare parts are counted, not serial-tracked, so unlike a tire the part itself
// has no identity to follow around. What CAN be recorded is the movement: which
// line, how many, which vehicle. The store's installed-vs-stock view for
// consumables is the sum of these rows, exactly as the tires' view is the sum
// of their mount events.
//
// Deliberately NOT tied to a maintenance job — the user wants the store
// standalone for now; when maintenance is linked later it will create these
// same rows rather than a parallel kind.
const inventoryIssueSchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true },
  // Snapshots, so the history still reads correctly if the line is renamed or
  // soft-deleted later.
  itemName: { type: String, required: true, trim: true },
  itemCode: { type: String, trim: true },

  quantity: { type: Number, required: true, min: 1 },
  vehicleNumber: { type: String, trim: true, index: true }, // free text — matches how the whole workshop refers to trucks
  // WHERE on the truck it was fitted — الرأس، السطحة، التيدر — so the register
  // answers "this part is on which vehicle, and on which part of it".
  fitLocation: { type: String, enum: ['head', 'flatbed', 'trailer', ''], default: '' },
  // The OUT that this IN displaced: installing a part on a truck replaces an
  // old one, and the old one must be accounted for — تالف (destroyed, gone),
  // تحت التجديد (sent for refurbishing), or 'none' (nothing was replaced —
  // first fit / top-up).
  replacedFate: { type: String, enum: ['damaged', 'under_renewal', 'none'], default: 'none' },
  notes: { type: String, trim: true },
  date: { type: String }, // YYYY-MM-DD — the day it physically left the shelf

  issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

inventoryIssueSchema.index({ createdAt: -1 });

module.exports = mongoose.model('InventoryIssue', inventoryIssueSchema);
