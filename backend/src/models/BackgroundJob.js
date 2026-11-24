const mongoose = require('mongoose');

/**
 * A long request run after the reply (utils/backgroundJob): the client gets the job id at once and polls for the
 * outcome, so no proxy or browser timeout can cut a big import. Stored, not kept in memory, because the poll may land
 * on the other PM2 worker. Removed a day after creation.
 */
const backgroundJobSchema = new mongoose.Schema({
  kind: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['running', 'done', 'error'], default: 'running' },
  httpStatus: { type: Number, default: null },
  result: { type: mongoose.Schema.Types.Mixed, default: null },
  message: { type: String, default: '' },
  finishedAt: { type: Date, default: null },
  // Which PM2 worker runs it: a worker that restarts marks its unfinished jobs as stopped instead of leaving them running forever.
  instance: { type: String, default: '' },
  // How far a long job got, for the screen that polls it ({ phase, done, total }).
  progress: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now, expires: 24 * 60 * 60 },
});

module.exports = mongoose.models.BackgroundJob || mongoose.model('BackgroundJob', backgroundJobSchema);
