const mongoose = require('mongoose');

const taskSuggestionSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    suggestedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reason: {
      type: String,
      required: true,
    },
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high'],
    },
    overdueDays: { type: Number, default: 0 },
    outstanding: { type: Number, default: 0 },
    dismissed: { type: Boolean, default: false },
    dismissedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    dismissedAt: { type: Date },
    convertedToTask: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CollectionTask',
    },
  },
  { timestamps: true }
);

taskSuggestionSchema.index({ dismissed: 1 });
taskSuggestionSchema.index({ suggestedTo: 1 });
taskSuggestionSchema.index({ customer: 1 });

module.exports = mongoose.model('TaskSuggestion', taskSuggestionSchema);
