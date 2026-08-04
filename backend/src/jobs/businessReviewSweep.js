/**
 * businessReviewSweep — التنبيهات على البنود المتأخرة والمستحقة قريبًا.
 *
 * An action board is only worth having if being late is visible. This runs daily
 * and does two things:
 *
 *   • stamps `isOverdue` on anything past its due date that is still open, so
 *     every list and dashboard can filter on it without recomputing;
 *   • sends ONE reminder two days before the due date and ONE when it is breached
 *     — to the person who owes it, and, for a breach, to whoever asked for it.
 *
 * The `dueSoonNotifiedAt` / `overdueNotifiedAt` stamps are what keep this from
 * becoming a nightly nag that everyone learns to ignore.
 */
const { BrAction, BrAssignment } = require('../models/BusinessReview');
const { OPEN_ACTION_STATUSES } = require('../config/businessReview');
const { createNotification } = require('../services/notificationService');
const { emitToUser } = require('../websocket/socketManager');

let timer = null;
let running = false;

const DUE_SOON_DAYS = 2;
const dayMs = 86400000;

async function ping(userId, title, message, entity, entityId) {
  if (!userId) return;
  try {
    await createNotification({
      recipient: userId, type: 'system_alert', title, message,
      relatedEntity: entity, relatedEntityId: entityId,
    });
    emitToUser(String(userId), 'br:updated', { entity, id: String(entityId) });
  } catch (e) { /* a missed reminder must not stop the sweep */ }
}

const fmt = (d) => new Date(d).toLocaleDateString('en-GB');

async function sweepOnce({ log = true } = {}) {
  if (running) return { skipped: 'already-running' };
  running = true;
  const now = new Date();
  const soon = new Date(now.getTime() + DUE_SOON_DAYS * dayMs);
  let overdue = 0; let dueSoon = 0; let cleared = 0;

  try {
    // ── Actions ────────────────────────────────────────────────────────────
    const lateActions = await BrAction.find({
      status: { $in: OPEN_ACTION_STATUSES },
      dueDate: { $ne: null, $lt: now },
    });
    for (const a of lateActions) {
      const first = !a.isOverdue;
      a.isOverdue = true;
      if (!a.overdueNotifiedAt) {
        a.overdueNotifiedAt = now;
        const days = Math.max(1, Math.round((now - a.dueDate) / dayMs));
        await ping(a.assignee, 'بند تنفيذي متأخر',
          `${a.title} — تجاوز موعد التسليم بـ ${days} يوم (${a.meetingRef})`, 'BrAction', a._id);
        // The board hears about a breach too — that is the point of the forum.
        await ping(a.raisedBy || a.createdBy, 'بند تنفيذي تجاوز موعده',
          `${a.title} — المكلَّف: ${a.assigneeName}`, 'BrAction', a._id);
      }
      if (first || a.isModified()) await a.save();
      overdue += 1;
    }

    const soonActions = await BrAction.find({
      status: { $in: OPEN_ACTION_STATUSES },
      dueDate: { $ne: null, $gte: now, $lte: soon },
      dueSoonNotifiedAt: null,
    });
    for (const a of soonActions) {
      a.dueSoonNotifiedAt = now;
      await a.save();
      await ping(a.assignee, 'بند تنفيذي يقترب موعده',
        `${a.title} — التسليم ${fmt(a.dueDate)} (${a.meetingRef})`, 'BrAction', a._id);
      dueSoon += 1;
    }

    // An action that was late and is now moved/closed must stop being flagged.
    const fixedActions = await BrAction.updateMany(
      { isOverdue: true, $or: [{ status: { $nin: OPEN_ACTION_STATUSES } }, { dueDate: null }, { dueDate: { $gte: now } }] },
      { $set: { isOverdue: false, overdueNotifiedAt: null } },
    );
    cleared += fixedActions.modifiedCount || 0;

    // ── Delegated tasks ────────────────────────────────────────────────────
    const lateTasks = await BrAssignment.find({
      status: { $in: OPEN_ACTION_STATUSES },
      dueDate: { $ne: null, $lt: now },
    });
    for (const t of lateTasks) {
      const first = !t.isOverdue;
      t.isOverdue = true;
      if (!t.overdueNotifiedAt) {
        t.overdueNotifiedAt = now;
        const days = Math.max(1, Math.round((now - t.dueDate) / dayMs));
        await ping(t.assignee, 'مهمة متأخرة', `${t.title} — تجاوزت موعدها بـ ${days} يوم`, 'BrAssignment', t._id);
        // The manager who delegated it needs to know before the meeting does.
        await ping(t.assignedBy, 'مهمة كلّفت بها تأخرت',
          `${t.title} — ${t.assigneeName}`, 'BrAssignment', t._id);
      }
      if (first || t.isModified()) await t.save();
      overdue += 1;
    }

    const soonTasks = await BrAssignment.find({
      status: { $in: OPEN_ACTION_STATUSES },
      dueDate: { $ne: null, $gte: now, $lte: soon },
      dueSoonNotifiedAt: null,
    });
    for (const t of soonTasks) {
      t.dueSoonNotifiedAt = now;
      await t.save();
      await ping(t.assignee, 'مهمة يقترب موعدها', `${t.title} — التسليم ${fmt(t.dueDate)}`, 'BrAssignment', t._id);
      dueSoon += 1;
    }

    const fixedTasks = await BrAssignment.updateMany(
      { isOverdue: true, $or: [{ status: { $nin: OPEN_ACTION_STATUSES } }, { dueDate: null }, { dueDate: { $gte: now } }] },
      { $set: { isOverdue: false, overdueNotifiedAt: null } },
    );
    cleared += fixedTasks.modifiedCount || 0;

    if (log && (overdue || dueSoon || cleared)) {
      console.log(`[businessReviewSweep] overdue ${overdue}, due-soon ${dueSoon}, cleared ${cleared}`);
    }
    return { overdue, dueSoon, cleared };
  } catch (e) {
    console.error('businessReviewSweep error:', e.message);
    return { error: e.message };
  } finally {
    running = false;
  }
}

function startBusinessReviewSweep() {
  if (timer) return;
  // A first pass shortly after boot so a restart re-stamps state, then hourly —
  // often enough that "متأخر" is true within the working day, rare enough that
  // nobody is buried in notifications.
  setTimeout(() => { sweepOnce().catch(() => {}); }, 90 * 1000);
  timer = setInterval(() => { sweepOnce().catch(() => {}); }, 60 * 60 * 1000);
  console.log('Business review sweep scheduled (hourly)');
}

module.exports = { startBusinessReviewSweep, sweepOnce };
