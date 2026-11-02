const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');

const isObjectId = (v) => !!v && mongoose.Types.ObjectId.isValid(String(v)) && String(new mongoose.Types.ObjectId(String(v))) === String(v);

/**
 * Write one audit entry. Never throws — an audit failure must not fail the
 * action being audited.
 *
 * `entityId` accepts anything the caller has: a real ObjectId goes to entityId,
 * anything else (a role name, a section key) goes to entityKey. Previously a
 * non-ObjectId hit a cast error and the entry was dropped entirely, which is how
 * every role-permission change went unrecorded.
 */
// The audit log is attributed to a person.
// A test script calling a real controller needs `req.user`, so the first system admin is taken from the database and the script's work would be recorded under their name. That happened: 202 test-account creates and deletes were attributed to an employee who never opened the screen.
// A log that accuses an innocent person is worse than a missing one, so when the system is outside production (`AUDIT_SUPPRESS=1`, set by test scripts) nothing is written.
const SUPPRESSED = process.env.AUDIT_SUPPRESS === '1';

const logAudit = async ({
  user, action, entity, entityId, entityKey, changes, ipAddress, bySystem, details, ip,
}) => {
  // Something was recorded in this request, so the safety net does not write its generic entry on top (see middleware/auditTrail). The flag is raised before writing: the attempt is what counts.
  try { require('./auditContext').mark(); } catch (_) { /* Outside a request. */ }
  if (SUPPRESSED) return;
  try {
    // The actor is either a person or explicitly the system. Neither is a caller error: it is recorded in the technical log and no audit entry without an actor is written.
    const actor = user?._id || (isObjectId(user) ? user : null);
    if (!actor && !bySystem) {
      console.error(`[audit] فعلٌ بلا فاعل: ${action} على ${entity} — لم يُقيَّد`);
      return;
    }
    /**
     * The name is captured even when the object is not passed.
     * Some callers pass `user: req.user` and others `user: req.user._id`; the name was captured only from the first, so entries had a valid reference and an empty name. The log is read by name, not id: asked who ended an employee's service, it showed unregistered although the actor was recorded on the same row.
     * When only the id arrives its name is read once: a small query that happens only when the name is missing and does not slow a caller that passed its object.
     */
    let snapName = user && (user.firstName || user.lastName)
      ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '';
    let snapEmail = (user && user.email) || '';
    if (actor && !snapName) {
      try {
        const User = require('../models/User');
        const u = await User.findById(actor).select('firstName lastName email').lean();
        if (u) {
          snapName = `${u.firstName || ''} ${u.lastName || ''}`.trim();
          snapEmail = u.email || '';
        }
      } catch (e) { /* The entry is written with its reference even if the name cannot be resolved. */ }
    }

    const id = isObjectId(entityId) ? entityId : undefined;
    const key = entityKey || (entityId != null && id === undefined ? String(entityId) : '');
    const entry = await AuditLog.create({
      user: actor || undefined,
      bySystem: !actor,
      // The name is captured now rather than read later; see models/AuditLog.
      userName: snapName || (actor ? '' : 'النظام'),
      userEmail: snapEmail,
      action,
      entity,
      entityId: id,
      entityKey: key,
      // `details` is not dropped.
      // Bulk edits in operations sheets pass their description in `details` and their title in `ip`, names this call does not know, so 52 entries were written with no detail (a bulk edit with no count or field). The description is saved where details are read.
      changes: changes !== undefined ? changes : (details ? { details } : undefined),
      ipAddress: ipAddress || ip,
    });
    // The action becomes a bell item for those entitled to it; see services/activityFeed. It is not awaited: the item neither delays nor fails the action.
    require('../services/activityFeed').announce(entry.toObject());
  } catch (error) {
    console.error('Audit log error:', error.message);
  }
};

module.exports = logAudit;
