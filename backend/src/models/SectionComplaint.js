const mongoose = require('mongoose');

// A per-section complaint. Same strict visibility model as SectionTask: only the
// assignee, the creator and super_admin can see/act on it.
const sectionComplaintSchema = new mongoose.Schema(
  {
    section: { type: String, required: true, index: true },
    subject: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    resolution: { type: String, trim: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

sectionComplaintSchema.index({ section: 1, assignedTo: 1 });
sectionComplaintSchema.index({ section: 1, createdBy: 1 });

module.exports = mongoose.model('SectionComplaint', sectionComplaintSchema);
