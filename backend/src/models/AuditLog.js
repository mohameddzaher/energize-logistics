const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  action: { type: String, required: true },
  entity: { type: String, required: true },
  entityId: { type: mongoose.Schema.Types.ObjectId },
  // Fully Mixed on purpose: callers log either { before, after } diffs or a
  // flat summary object ({ waybillNumber, customerName }). The old
  // { before, after }-only shape silently DROPPED every flat summary at write
  // time (strict mode), leaving those rows with no detail at all.
  changes: { type: mongoose.Schema.Types.Mixed, default: null },
  ipAddress: { type: String },
  createdAt: { type: Date, default: Date.now },
});

auditLogSchema.index({ entity: 1, entityId: 1 });
auditLogSchema.index({ entity: 1, createdAt: -1 }); // filtered audit views sort by recency
auditLogSchema.index({ user: 1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
