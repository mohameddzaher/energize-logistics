const mongoose = require('mongoose');

const collectionTaskSchema = new mongoose.Schema(
  {
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    contactMethod: {
      type: String,
      enum: ['call', 'whatsapp', 'visit', 'email', 'message'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'done', 'cancelled', 'postponed'],
      default: 'pending',
    },
    dueDate: { type: Date },
    completedAt: { type: Date },
    collectedAmount: { type: Number, default: 0 },
    actionNotes: { type: String },
    nextFollowUpDate: { type: Date },
  },
  { timestamps: true }
);

collectionTaskSchema.index({ assignedTo: 1, status: 1 });
collectionTaskSchema.index({ createdBy: 1 });
collectionTaskSchema.index({ customer: 1 });
collectionTaskSchema.index({ status: 1 });
collectionTaskSchema.index({ dueDate: 1 });
collectionTaskSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CollectionTask', collectionTaskSchema);
