const mongoose = require('mongoose');

// A per-section task. Each business section (crm, sales, accounting, …) keeps its
// OWN independent task list. Visibility is strict: only the assignee, the creator
// and super_admin can see/act on a task (enforced in the controller).
const sectionTaskSchema = new mongoose.Schema(
  {
    section: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    status: { type: String, enum: ['todo', 'in_progress', 'done', 'cancelled'], default: 'todo' },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    dueDate: { type: Date },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

sectionTaskSchema.index({ section: 1, assignedTo: 1 });
sectionTaskSchema.index({ section: 1, createdBy: 1 });

module.exports = mongoose.model('SectionTask', sectionTaskSchema);
