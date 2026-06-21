const mongoose = require('mongoose');

// A CRM to-do, optionally tied to a company/contact/deal, assigned to a user,
// with a due date so it shows on the calendar and drives reminders.
const crmTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    company: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmCompany' },
    contact: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmContact' },
    deal: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmDeal' },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    dueDate: { type: Date },
    // Optional time-of-day ('HH:mm') shown alongside the due date.
    dueTime: { type: String, trim: true },

    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    status: { type: String, enum: ['todo', 'in_progress', 'done', 'cancelled'], default: 'todo' },
    completedAt: { type: Date },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

crmTaskSchema.index({ assignedTo: 1, status: 1, dueDate: 1 });
crmTaskSchema.index({ company: 1 });
crmTaskSchema.index({ deal: 1 });
crmTaskSchema.index({ dueDate: 1 });

module.exports = mongoose.model('CrmTask', crmTaskSchema);
