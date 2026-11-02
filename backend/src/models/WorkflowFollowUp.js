/** A follow-up line on an operations statement: what happened, who wrote it, when. A separate record because `invoiceNotes` is a single money-column field that each writer overwrites, and `CollectionsFollowUp` is per party and unreadable by customs. Operations, customs and collections all write and read lines on the same statement. One document per line, because the statement is a hot model synced every minute and an array would burden every read and save (as with `CollectionAttachment`); deletion removes a document and counts use the index. */
const mongoose = require('mongoose');

const workflowFollowUpSchema = new mongoose.Schema({
  workflow: { type: mongoose.Schema.Types.ObjectId, ref: 'OperationsWorkflow', required: true },
  // Statement number stored with the line so it stays readable in the audit log if the statement is deleted.
  reportNumber: { type: String, trim: true, default: '' },

  text: { type: String, required: true, trim: true, maxlength: 2000 },
  // One optional attachment, a photo of a paper or receipt. See utils/fileStore.
  attachment: {
    fileUrl: { type: String, default: '' },
    fileName: { type: String, trim: true, default: '' },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
  },

  // Author, with name and department stored so the user is not looked up on every display.
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  byName: { type: String, trim: true, default: '' },
  byRole: { type: String, trim: true, default: '' },
  // Screen it was written from: operations, customs or collections.
  source: { type: String, enum: ['operations', 'customs', 'collections'], default: 'operations' },
  at: { type: Date, default: Date.now },
});

workflowFollowUpSchema.index({ workflow: 1, at: -1 });

module.exports = mongoose.models.WorkflowFollowUp
  || mongoose.model('WorkflowFollowUp', workflowFollowUpSchema);
