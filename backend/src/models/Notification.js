const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // ── إلى شخصٍ بعينه، أو إلى قسمٍ بأكمله ──────────────────────────────────
  //
  // كان لكلّ إشعارٍ مستلمٌ واحدٌ إلزاميّ. فخبرٌ يخصّ قسمًا كان يُكتب صفًّا لكلّ
  // شخصٍ فيه: رفعُ مستندٍ واحدٍ يصير ثلاثةَ عشرَ صفًّا. وهكذا بلغت المجموعةُ
  // سبعين ألفًا، تسعةٌ وسبعون بالمئة منها غيرُ مقروءة.
  //
  // وأسوأُ من الحجم أنّ قائمةَ المستلمين كانت تُكتب بيدٍ في كلّ موضع: من
  // يُنشَأ له دورٌ جديدٌ لا يصله شيءٌ حتّى يتذكّره أحدٌ ويضيفه. ولذلك كان ثمانيةٌ
  // وثلاثون مستخدمًا نشِطًا بلا إشعارٍ واحد.
  //
  // فالإشعارُ الآن إمّا `recipient` — شخصٌ بعينه، «أُسنِدت إليك مهمّة» — وإمّا
  // `section`: صفٌّ واحدٌ يراه **كلُّ من يملك ذلك القسمَ في صلاحيّاته**. فمن
  // فُتح له القسمُ رآه بلا أن يُضاف إلى قائمة، ومن أُغلق عنه لم يره.
  // أحدُهما مطلوبٌ ولا يصحّ غيابُهما معًا.
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  /** مفتاحُ القسم كما في config/sections (مثل 'Operations'). */
  section: { type: String, default: null, index: true },
  type: {
    type: String,
    enum: [
      'invoice_due_soon',
      'invoice_overdue',
      'payment_received',
      'risk_updated',
      'dispute_opened',
      'dispute_resolved',
      'credit_term_changed',
      'follow_up_reminder',
      'system_alert',
      // عامة عبر الأقسام:
      'task_assigned',
      'complaint_assigned',
      'approval_needed',
      'status_changed',
      'shipment_update',
      'general',
    ],
    required: true,
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  relatedEntity: { type: String },
  relatedEntityId: { type: mongoose.Schema.Types.ObjectId },
  isRead: { type: Boolean, default: false },
  readAt: { type: Date },
  // ── ومقروئيّةُ إشعارِ القسم لكلِّ قارئٍ على حدة ──────────────────────────
  // صفٌّ واحدٌ يراه عشرون شخصًا لا يسعه `isRead` واحدة: قراءةُ أحدِهم تُخفيه
  // عن الباقين. فمن قرأه يُسجَّل هنا، و«غيرُ المقروء» يُحسَب بغياب اسمه.
  readBy: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
  // ── خبرُ فعلٍ على النظام ─────────────────────────────────────────────────
  // «فلانٌ عدّل كذا» — يُكتب من سجلّ المراجعة (services/activityFeed). `actor`
  // صاحبُ الفعل: لا يُعرَض عليه خبرُ ما فعله هو.
  activity: { type: Boolean, default: false },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt: { type: Date, default: Date.now },
});

// ── ولا إشعارَ بلا وجهة ─────────────────────────────────────────────────────
// صفٌّ بلا `recipient` ولا `section` لا يراه أحد: يُكتب ويُدفَن. والفشلُ عند
// الكتابة أهونُ من خبرٍ لا يصل ولا يُعرَف أنّه لم يصل.
notificationSchema.pre('validate', function requireAudience(next) {
  if (!this.recipient && !this.section) {
    return next(new Error('Notification needs a recipient or a section'));
  }
  next();
});

notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ section: 1, createdAt: -1 });
notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
