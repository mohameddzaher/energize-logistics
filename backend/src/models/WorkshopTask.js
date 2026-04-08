const mongoose = require('mongoose');

const workshopTaskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'in_progress', 'completed', 'cancelled'], default: 'pending' },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  dueDate: { type: Date },
  completedAt: { type: Date },
  completionNotes: { type: String, trim: true },
  branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
}, { timestamps: true });

workshopTaskSchema.index({ assignedTo: 1, status: 1 });
workshopTaskSchema.index({ createdBy: 1 });
workshopTaskSchema.index({ createdAt: -1 });

module.exports = mongoose.model('WorkshopTask', workshopTaskSchema);
