/**
 * PerfTemplate: one department's (or job family's) evaluation form: the criteria, each with weight, description, data source and 1..5 wording.
 * A department can have SEVERAL templates because it grades different jobs differently (e.g. heavy transport has separate operations, customer service and follow-up forms, each summing to 100%).
 * Only super-admin may create or edit these (enforced in the routes).
 */
const mongoose = require('mongoose');
const { DEFAULT_SCALE } = require('../config/performanceConfig');

const scalePointSchema = new mongoose.Schema({
  score: { type: Number, required: true, min: 1, max: 5 },
  label: { type: String, default: '' },      // English wording
  labelAr: { type: String, default: '' },    // Arabic wording of the level, e.g. no fines
}, { _id: false });

const criterionSchema = new mongoose.Schema({
  // Stable key so historic evaluations still resolve their criterion after the
  // template is reordered or retitled.
  key: { type: String, required: true },
  order: { type: Number, default: 0 },
  title: { type: String, default: '' },
  titleAr: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  descriptionAr: { type: String, default: '' },
  dataSource: { type: String, default: '' },   // Data source: where the evidence comes from
  dataSourceAr: { type: String, default: '' },
  weight: { type: Number, required: true, min: 0, max: 100 }, // percent of this form
  scale: { type: [scalePointSchema], default: () => DEFAULT_SCALE.map((s) => ({ score: s.score, label: s.en, labelAr: s.ar })) },
});

const perfTemplateSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  nameAr: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  descriptionAr: { type: String, default: '' },
  // Which department this form belongs to. Plain string to match Employee.department.
  department: { type: String, required: true, trim: true, index: true },
  // Optional narrowing: only these job titles use this form. Empty = the whole
  // department falls back to it.
  jobTitles: { type: [String], default: [] },
  // Bonus tier for the people graded by this form (1 | 2 | 3 by default, but the
  // tier list itself is editable in PerfSettings).
  tier: { type: Number, default: 1 },
  active: { type: Boolean, default: true, index: true },
  criteria: { type: [criterionSchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

// Convenience: does this form's weighting actually add up?
perfTemplateSchema.virtual('totalWeight').get(function () {
  return (this.criteria || []).reduce((s, c) => s + (Number(c.weight) || 0), 0);
});
perfTemplateSchema.set('toJSON', { virtuals: true });
perfTemplateSchema.set('toObject', { virtuals: true });

perfTemplateSchema.index({ department: 1, active: 1 });

module.exports = mongoose.models.PerfTemplate || mongoose.model('PerfTemplate', perfTemplateSchema);
