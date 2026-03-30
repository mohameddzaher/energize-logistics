const mongoose = require('mongoose');

const collectionActivitySchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
    },
    collector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['call', 'email', 'visit', 'promise', 'follow_up', 'note', 'whatsapp'],
      required: true,
    },
    contactType: {
      type: String,
      enum: ['call', 'visit', 'email', 'whatsapp'],
    },
    status: {
      type: String,
      enum: ['done', 'postponed', 'cancelled'],
      default: 'done',
    },
    amountCollected: { type: Number, default: 0 },
    promiseDate: { type: Date },
    promiseFulfilled: { type: Boolean },
    promiseAmount: { type: Number },
    followUpDate: { type: Date },
    nextFollowUpDate: { type: Date },
    notes: { type: String, required: true },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    completionNotes: { type: String },
  },
  { timestamps: true }
);

collectionActivitySchema.index({ customer: 1 });
collectionActivitySchema.index({ collector: 1 });
collectionActivitySchema.index({ followUpDate: 1 });
collectionActivitySchema.index({ nextFollowUpDate: 1 });
collectionActivitySchema.index({ type: 1 });

module.exports = mongoose.model('CollectionActivity', collectionActivitySchema);
