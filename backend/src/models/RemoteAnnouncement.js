const mongoose = require('mongoose');

// Team-wide announcement posted by a manager / admin to the remote team.
const remoteAnnouncementSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    // null/empty → visible to all remote employees; otherwise limited to these users
    audience: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

remoteAnnouncementSchema.index({ createdAt: -1 });

module.exports = mongoose.model('RemoteAnnouncement', remoteAnnouncementSchema);
