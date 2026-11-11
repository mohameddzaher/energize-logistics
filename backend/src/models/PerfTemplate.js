/**
 * PerfTemplate: one department's (or job family's) evaluation form: the criteria, each with weight, description, data source and 1..5 wording.
 * A department can have SEVERAL templates because it grades different jobs differently (e.g. heavy transport has separate operations, customer service and follow-up forms, each summing to 100%).
 * A form belongs to a system section (`section`) or, for the older forms, to an HR department. Section forms are edited by that section's manager and by top management; forms that grade a section head (`roles` holding a manager role) by top management only (see performanceController).
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
  // Heading the item is shown under (e.g. job duties / attendance); display only, the weight is per item.
  group: { type: String, default: '' },
  groupAr: { type: String, default: '' },
  weight: { type: Number, required: true, min: 0, max: 100 }, // percent of this form
  scale: { type: [scalePointSchema], default: () => DEFAULT_SCALE.map((s) => ({ score: s.score, label: s.en, labelAr: s.ar })) },
});

const perfTemplateSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  nameAr: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  descriptionAr: { type: String, default: '' },
  // Which department this form belongs to. Plain string to match Employee.department. Empty on section forms.
  department: { type: String, default: '', trim: true, index: true },
  // System section key (config/sections, or roles.DATA_DEPT); the form applies to that section's accounts.
  section: { type: String, default: '', trim: true, index: true },
  // Account roles graded by this form (e.g. the section manager's own form).
  roles: { type: [String], default: [] },
  // Employees explicitly given this form by their manager; beats job title and role.
  employees: { type: [mongoose.Schema.Types.ObjectId], ref: 'Employee', default: [] },
  // Where the seed took it from, e.g. a workbook and sheet.
  source: { type: String, default: '' },
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
perfTemplateSchema.index({ section: 1, active: 1 });

module.exports = mongoose.models.PerfTemplate || mongoose.model('PerfTemplate', perfTemplateSchema);
