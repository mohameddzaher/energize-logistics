/**
 * PerfEvaluation — one employee graded by one manager for one period.
 *
 * The computed fields (weightedScore / percentage / band / bonusMultiplier) are
 * STORED, not derived on read: the template's weights and the bonus tables are
 * editable, and a past quarter's result must not silently change when someone
 * retunes next quarter's form. `criteriaSnapshot` freezes the wording+weights
 * the manager actually saw, so an old evaluation can always be reprinted exactly.
 */
const mongoose = require('mongoose');
const { PERIOD_TYPES } = require('../config/performanceConfig');

const answerSchema = new mongoose.Schema({
  criterionKey: { type: String, required: true },
  score: { type: Number, default: null, min: 1, max: 5 }, // null = not answered yet
  note: { type: String, default: '' },
}, { _id: false });

// Frozen copy of the criterion as it stood when this evaluation was filled in.
const snapshotSchema = new mongoose.Schema({
  key: String, order: Number, titleAr: String, title: String,
  descriptionAr: String, description: String, weight: Number,
}, { _id: false });

const perfEvaluationSchema = new mongoose.Schema({
  template: { type: mongoose.Schema.Types.ObjectId, ref: 'PerfTemplate', required: true, index: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  // Denormalised so lists and PDFs don't need a populate, and so the record
  // still reads correctly if the employee later changes department.
  employeeName: { type: String, default: '' },
  department: { type: String, default: '', index: true },
  jobTitle: { type: String, default: '' },

  evaluator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  evaluatorName: { type: String, default: '' },

  period: {
    type: { type: String, enum: PERIOD_TYPES, default: 'quarter' },
    quarter: { type: Number, default: null, min: 1, max: 4 },
    month: { type: Number, default: null, min: 1, max: 12 },
    year: { type: Number, required: true },
    from: { type: String, default: '' }, // YYYY-MM-DD, custom periods only
    to: { type: String, default: '' },
  },
  // Human label ("الربع الثالث ٢٠٢٦") — computed on save, used for grouping.
  periodKey: { type: String, default: '', index: true },
  evaluationDate: { type: String, default: '' }, // YYYY-MM-DD, the date entered on the form

  answers: { type: [answerSchema], default: [] },
  criteriaSnapshot: { type: [snapshotSchema], default: [] },

  // ---- Computed at save time (see performanceConfig.computeScore) ----
  weightedScore: { type: Number, default: null },  // out of 5
  percentage: { type: Number, default: null },     // 0..100
  band: { type: String, default: null },           // not_eligible | good | very_good | excellent
  tier: { type: Number, default: null },           // tier used for the bonus lookup
  bonusMultiplier: { type: Number, default: null },// in monthly salaries
  // Optional, entered per-evaluation to show the cash figure. Not written back
  // to the employee record — payroll is not part of this system.
  monthlySalary: { type: Number, default: null },

  notes: { type: String, default: '' },            // ملاحظات المُقيِّم
  status: { type: String, enum: ['draft', 'submitted'], default: 'draft', index: true },
  submittedAt: { type: Date, default: null },

  // Once submitted an evaluation is LOCKED to its evaluator — a manager cannot
  // quietly restate a grade the employee has already been told. To change it
  // they raise an edit request; only super-admin decides. An approved request
  // is consumed by the next save, so one approval buys one correction.
  editRequest: {
    status: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none', index: true },
    reason: { type: String, default: '' },          // why the manager wants to change it
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    requestedByName: { type: String, default: '' },
    requestedAt: { type: Date, default: null },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedByName: { type: String, default: '' },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: '' },
  },
  // Every correction after the first submit, so the trail survives the edit.
  editHistory: [{
    at: { type: Date, default: Date.now },
    byName: { type: String, default: '' },
    previousPercentage: { type: Number, default: null },
    newPercentage: { type: Number, default: null },
    reason: { type: String, default: '' },
  }],
}, { timestamps: true });

// One evaluation per employee per period per template — re-grading edits the
// same record rather than piling up duplicates.
perfEvaluationSchema.index({ employee: 1, periodKey: 1, template: 1 }, { unique: true });
perfEvaluationSchema.index({ department: 1, periodKey: 1 });

module.exports = mongoose.models.PerfEvaluation || mongoose.model('PerfEvaluation', perfEvaluationSchema);
