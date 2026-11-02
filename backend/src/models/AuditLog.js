const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  // An actor that is not a person. The automatic wallet close at end of day deserves an entry: it closes a branch ledger and fixes its balance. `user` was required and wallets now belong to the branch with no owner, so the entry failed every night with "AuditLog validation failed: user is required" and the ledger closed with no trace of who closed it.
  // So the actor is optional and `bySystem` says the absence is intended, not a gap. See utils/auditLogger: an entry with neither an actor nor `bySystem` is still rejected.
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  bySystem: { type: Boolean, default: false },
  // Snapshot of the actor's name. The reference alone is not enough: when the account is deleted `populate` returns empty and the screen attributes the action to "the system", which is false in the worst place to be false. A log is history and must not depend on a deletable row, so the name and email are captured at the time of the action and kept.
  userName: { type: String, trim: true, default: '' },
  userEmail: { type: String, trim: true, default: '' },
  action: { type: String, required: true },
  entity: { type: String, required: true },
  entityId: { type: mongoose.Schema.Types.ObjectId },
  // Not everything auditable is keyed by an ObjectId — a role permission change
  // is identified by the role NAME. Those used to be written into entityId and
  // silently thrown away by the cast, so the most security-relevant action in
  // the system (changing who can reach what) left no trail at all.
  entityKey: { type: String, trim: true, default: '' },
  // Fully Mixed on purpose: callers log either { before, after } diffs or a
  // flat summary object ({ waybillNumber, customerName }). The old
  // { before, after }-only shape silently DROPPED every flat summary at write
  // time (strict mode), leaving those rows with no detail at all.
  changes: { type: mongoose.Schema.Types.Mixed, default: null },
  ipAddress: { type: String },
  createdAt: { type: Date, default: Date.now },
});

auditLogSchema.index({ entity: 1, entityId: 1 });
auditLogSchema.index({ entity: 1, entityKey: 1 });
auditLogSchema.index({ entity: 1, createdAt: -1 }); // filtered audit views sort by recency
auditLogSchema.index({ user: 1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
