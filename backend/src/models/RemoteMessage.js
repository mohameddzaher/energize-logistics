const mongoose = require('mongoose');

// A chat message in a remote employee's thread. Each remote_employee has one
// thread (keyed by `employee`); their manager / admins / super_admin all talk
// to them in it. `sender` is whoever wrote the message.
const remoteMessageSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true },
    // sent by staff (manager/admin) → unread for employee until they read it
    readByEmployee: { type: Boolean, default: false },
    // sent by employee → unread for staff until a staff member reads it
    readByStaff: { type: Boolean, default: false },
  },
  { timestamps: true }
);

remoteMessageSchema.index({ employee: 1, createdAt: 1 });

module.exports = mongoose.model('RemoteMessage', remoteMessageSchema);
