/**
 * activityFeed — كلُّ فعلٍ على النظام يصير خبرًا في الجرس، لمن يحقّ له أن يعرفه.
 *
 * ── من يرى ماذا ────────────────────────────────────────────────────────────
 *   مديرُ النظام   كلَّ ما يُفعَل في النظام: من فعل ماذا.
 *   مديرُ القسم    كلَّ ما يدور في قسمه.
 *   الموظّف        ما وُجِّه إليه هو وحدَه (مهمّةٌ أُسنِدت، طلبٌ رُدّ عليه…).
 *
 * ── ومن أين يأتي الخبر ─────────────────────────────────────────────────────
 * من سجلّ المراجعة نفسِه: كلُّ فعلٍ في النظام يمرّ بـ`logAudit`، فلا قائمةَ
 * مواضعَ تُكتب بيدٍ فيُنسى منها موضع. يُكتب للفعل **صفٌّ واحد** موجَّهٌ إلى
 * قسمه — لا صفٌّ لكلّ قارئ — ومن يراه يُحسَب عند القراءة (راجع
 * notificationController.scopeOf). والجملةُ هي جملةُ سجلّ المراجعة
 * (`auditDescribe`): ما يُقرأ في الجرس هو ما يُقرأ في السجلّ.
 *
 * ── وما لا يدخل ────────────────────────────────────────────────────────────
 * الدخولُ والخروجُ وتبديلُ كلمة المرور ليست «أفعالًا على النظام» — هي لسجلّ
 * المراجعة. وما يفعله النظامُ من تلقاء نفسه (إقفالٌ آليّ، مزامنة) كذلك.
 */
const Notification = require('../models/Notification');
const { sectionOf, SECTIONS } = require('../config/auditSections');
const { actionLabel } = require('../config/auditLabels');
const { describe } = require('../utils/auditDescribe');
const { emitToAll } = require('../websocket/socketManager');

/** ما لا يُعَدّ فعلًا على النظام. */
const SKIP = /^(login|logout|failed_login|refresh_token|change_password|reset_password|update_profile|view_|read_|export_|reveal_)/;

/** قسمُ سجلّ المراجعة ← مفتاحُ القسم في مصفوفة الصلاحيّات. */
const SYS_OF = Object.fromEntries(SECTIONS.map((s) => [s.key, s.sys || null]));
// العهدةُ شاشةٌ داخل العمليّات — يراها مديرُ العمليّات.
SYS_OF.wallet = 'Operations';
/** ما لا قسمَ له (المستخدمون، الصلاحيّات، الفروع) يراه مديرُ النظام وحدَه. */
const SYSTEM_ONLY = '_system';

/** يُنادى من `logAudit` بعد كتابة القيد. لا يرمي: الخبرُ زيادةٌ على الفعل. */
async function announce(entry) {
  try {
    if (!entry || entry.bySystem || !entry.user) return;
    if (SKIP.test(String(entry.action || ''))) return;
    const d = describe(entry, { lang: 'ar' });
    const what = actionLabel(entry.action, entry.entity, 'ar');
    const body = [d.subject, d.summary].filter(Boolean).join(' — ') || what;
    const n = await Notification.create({
      section: SYS_OF[sectionOf(entry.entity)] || SYSTEM_ONLY,
      activity: true,
      actor: entry.user,
      type: 'general',
      title: `${entry.userName || 'مستخدم'} — ${what}`.slice(0, 200),
      message: body.slice(0, 600),
      relatedEntity: 'AuditLog',
      relatedEntityId: entry._id,
    });
    // إشارةٌ بلا محتوى: كلُّ جرسٍ يعيد السحبَ عبر صلاحيّته، فلا يتسرّب خبرٌ.
    try { emitToAll('notification:activity', { section: n.section }); } catch (_) { /* زيادة */ }
  } catch (e) {
    console.error('[activity] تعذّر كتابةُ الخبر:', e.message);
  }
}

module.exports = { announce, SYSTEM_ONLY };
