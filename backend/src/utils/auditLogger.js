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
const logAudit = async ({ user, action, entity, entityId, entityKey, changes, ipAddress }) => {
  try {
    const id = isObjectId(entityId) ? entityId : undefined;
    const key = entityKey || (entityId != null && id === undefined ? String(entityId) : '');
    await AuditLog.create({
      user: user?._id || user,
      action,
      entity,
      entityId: id,
      entityKey: key,
      changes,
      ipAddress,
    });
  } catch (error) {
    console.error('Audit log error:', error.message);
  }
};

module.exports = logAudit;
