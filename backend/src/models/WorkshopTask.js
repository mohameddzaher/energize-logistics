const mongoose = require('mongoose');

const workshopTaskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  // Workshop employee who will manage/track the task
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Technician who will physically do the work (optional)
  technicianName: { type: String, trim: true },
  // Reference to maintenance type (optional)
  // Retired: the workshop's own parallel list of service types. Kept so the
  // handful of tasks created before the switch still show what they were.
  maintenanceType: { type: mongoose.Schema.Types.ObjectId, ref: 'MaintenanceType' },
  // The real service plan, mirrored from Location Solutions (Wialon). `key` is
  // the leading number ("1".."4") — the same key the Settings checklists use —
  // and the name is stored alongside it so a task still reads correctly if the
  // plan is ever renamed upstream.
  serviceTypeKey: { type: String, default: '', trim: true },
  serviceTypeName: { type: String, default: '', trim: true },
  vehicleNumber: { type: String, trim: true },
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
