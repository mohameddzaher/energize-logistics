const mongoose = require('mongoose');

/**
 * A background export job.
 * Building all statements (about 36,000 rows, about 22 MB, half a minute) inside the request left the user waiting and lost the work if the page closed or the network dropped. Now a registered job: marked in progress, built on the server, and a notification with the download link arrives when ready; closing the page does not lose the file.
 */
const exportJobSchema = new mongoose.Schema(
  {
    // What to export: a key known in exportRunners, never a path from the browser.
    kind: { type: String, required: true, index: true },
    query: { type: Object, default: {} },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    requestedByName: { type: String, default: '' },
    // The role is stored with the job: the file is built with money hidden according to the owner's role, so export is not a back door to a column hidden on screen.
    role: { type: String, default: '' },
    status: { type: String, enum: ['queued', 'running', 'done', 'failed'], default: 'queued', index: true },
    rows: { type: Number, default: 0 },
    fileName: { type: String, default: '' },
    filePath: { type: String, default: '' },   // On disk, not sent to the browser.
    size: { type: Number, default: 0 },
    error: { type: String, default: '' },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    // File is deleted after a day: an export is a snapshot, and keeping them forever fills the disk.
    expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), index: true },
  },
  { timestamps: true },
);

exportJobSchema.index({ requestedBy: 1, createdAt: -1 });

module.exports = mongoose.models.ExportJob || mongoose.model('ExportJob', exportJobSchema);
