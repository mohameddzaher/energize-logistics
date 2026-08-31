const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // ── ولقطةُ اسمِ الفاعل ────────────────────────────────────────────────────
  // المرجعُ وحدَه لا يكفي: حين يُحذَف الحسابُ تعود `populate` فارغةً، فتقرأ
  // الشاشةُ الفعلَ منسوبًا إلى «النظام» — وهو كذبٌ في أخطر مكانٍ يُقال فيه.
  // السجلُّ تاريخٌ، والتاريخُ لا يعتمد على صفٍّ يمكن حذفُه. فيُلتقط الاسمُ
  // والبريدُ ساعةَ الفعل ويبقيان.
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
