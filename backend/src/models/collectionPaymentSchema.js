/** A collection payment, shared by the invoice ledger (tax) and the operations statement (cash). Not its own collection: it lives with its invoice and is read in the same row. Each payment has an id so it can be edited or removed alone, and keeps its writer's name as written. */
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  // Collection day as written by the collect button: `new Date('YYYY-MM-DD')`.
  date: { type: Date, required: true },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  byName: { type: String, trim: true, default: '' },
  note: { type: String, trim: true, default: '' },
  // 'partial' is a partial payment; 'full' settles the remainder.
  mode: { type: String, enum: ['partial', 'full'], default: 'partial' },
  at: { type: Date, default: Date.now },
}, { _id: true });

module.exports = { paymentSchema };
