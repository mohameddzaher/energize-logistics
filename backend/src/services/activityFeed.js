/**
 * Every action on the system becomes a bell item for whoever may know about it.
 * Visibility: the system admin sees all actions and who did them; a department manager sees everything in their department; an employee sees only what is directed at them (an assigned task, a reply to their request).
 * Source: the audit log itself. Every action goes through logAudit, so there is no hand-written list of places to forget. One row per action is written, addressed to its department, not one per reader; who sees it is computed at read time (notificationController.scopeOf). The sentence is the audit description (auditDescribe), so the bell and the log read the same.
 * Excluded: login, logout and password changes belong to the audit log only, as do automatic system actions (auto close, sync).
 */
const Notification = require('../models/Notification');
const { sectionOf, SECTIONS } = require('../config/auditSections');
const { actionLabel } = require('../config/auditLabels');
const { describe } = require('../utils/auditDescribe');
const { emitToAll } = require('../websocket/socketManager');

/** What does not count as an action on the system. */
// Safety-net entries (api_*) do not become bell items: they only guarantee that no action passes without an audit trace, and are not news for anyone. A shipment follow-up every three hours per truck used to fill the bell with technical lines. They stay readable in the log (utils/auditDescribe).
const SKIP = /^(login|logout|failed_login|refresh_token|change_password|reset_password|update_profile|view_|read_|export_|reveal_|api_)/;

/** Audit log section to the section key in the permission matrix. */
const SYS_OF = Object.fromEntries(SECTIONS.map((s) => [s.key, s.sys || null]));
// Custody is a screen inside operations, so the operations manager sees it.
SYS_OF.wallet = 'Operations';
/** Items with no section (users, permissions, branches) are seen by the system admin only. */
const SYSTEM_ONLY = '_system';

/** Called from logAudit after the entry is written. Never throws: the feed is an addition to the action. */
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
    // A signal with no content: each bell re-pulls through its own permission, so nothing leaks.
    try { emitToAll('notification:activity', { section: n.section }); } catch (_) { /* Addition */ }
  } catch (e) {
    console.error('[activity] تعذّر كتابةُ الخبر:', e.message);
  }
}

module.exports = { announce, SYSTEM_ONLY };
