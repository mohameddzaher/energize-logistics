/**
 * Collection task: who visits whom today, and what happened.
 * The collections manager writes each employee's daily plan (visit, call, email) and employees write their own for tomorrow. Afterwards the outcome and amount collected are recorded, feeding team evaluation and the customer file.
 * Unit is (customer x day), matching the sheet's column per day, so a task is a dated row readable by week, employee, or customer.
 */
const mongoose = require('mongoose');

const collectionTaskSchema = new mongoose.Schema({
  party: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionsParty', index: true },
  partyCode: { type: String, trim: true, default: '', index: true },
  partyName: { type: String, trim: true, default: '' },

  // Employee name as written in the sheet, plus the id when linked to a system account.
  // The id is resolved from the name on create and edit (utils/collectionsOfficer), and tasks are filtered by both, so work under another spelling is not lost.
  officerName: { type: String, trim: true, default: '', index: true },
  officer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

  date: { type: String, required: true, index: true },   // YYYY-MM-DD: task day

  // Contact type requested: office visit, call, email, or invoice delivery.
  requestType: { type: String, trim: true, default: '' },
  planned: { type: Boolean, default: true },             // "x" in the sheet
  status: { type: String, trim: true, default: '' },     // Done / …
  collected: { type: Number, default: 0 },               // Amount collected in this visit
  action: { type: String, trim: true, default: '' },     // What happened, in the doer's words
  notes: { type: String, trim: true, default: '' },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  source: { type: String, trim: true, default: '' },
}, { timestamps: true });

// One row per (customer x day x request type), so a day is not imported twice.
collectionTaskSchema.index({ party: 1, date: 1, requestType: 1 }, { unique: true, sparse: true });
collectionTaskSchema.index({ officerName: 1, date: -1 });
collectionTaskSchema.index({ date: -1, status: 1 });

module.exports = mongoose.models.CollectionTask
  || mongoose.model('CollectionTask', collectionTaskSchema);
