/**
 * When a user's direct manager changes, what still waits on the old manager moves to the new one: staff requests at
 * the manager stage and leaves pending the manager's approval. Anything the old manager already acted on stays as it
 * is. Requests and leaves store their manager at filing time, so without this they stayed with the old manager.
 * A manager removed (none set) or inactive moves nothing: the items would wait on nobody.
 */
const User = require('../models/User');

async function handOverToNewManager(userId, oldManager, newManager, actor) {
  const from = oldManager ? String(oldManager._id || oldManager) : '';
  const to = newManager ? String(newManager._id || newManager) : '';
  const none = { requests: 0, leaves: 0 };
  if (!to || from === to || to === String(userId)) return none;
  const next = await User.findOne({ _id: to, isActive: true }).select('firstName lastName').lean();
  if (!next) return none;
  const nextName = `${next.firstName || ''} ${next.lastName || ''}`.trim();
  const HRRequest = require('../models/HRRequest');
  const LeaveRequest = require('../models/LeaveRequest');
  const actorName = actor ? `${actor.firstName || ''} ${actor.lastName || ''}`.trim() : '';

  const reqIds = (await HRRequest.find({ requester: userId, stage: 'manager', status: { $in: ['open', 'in_progress', 'received'] } }).select('_id').lean()).map((r) => r._id);
  if (reqIds.length) {
    await HRRequest.updateMany({ _id: { $in: reqIds } }, {
      $set: { manager: next._id },
      $push: { history: { at: new Date(), by: actor && actor._id, byName: actorName, action: 'manager_changed', note: `المدير المباشر الجديد: ${nextName}` } },
    });
  }
  // A leave filed by a manager for his team carries his own approval; it is not waiting on anyone's manager stage.
  const leaves = await LeaveRequest.updateMany(
    { requester: userId, status: 'pending_manager', filedByManager: { $ne: true } },
    { $set: { manager: next._id } },
  );

  const { createNotification } = require('../services/notificationService');
  const { emitToUser } = require('../websocket/socketManager');
  const notify = (title, message, entity, id, event) => createNotification({ recipient: next._id, type: 'system_alert', title, message, relatedEntity: entity, relatedEntityId: id }).catch(() => {})
    .then(() => { try { emitToUser(String(next._id), event, { id: String(id) }); } catch (e) { /* */ } });
  for (const id of reqIds) await notify('طلب موظف انتقل إليك', 'أصبحتَ المديرَ المباشر لصاحب الطلب', 'HRRequest', id, 'hr:request');
  if (leaves.modifiedCount) await notify('إجازات تنتظر موافقتك', `انتقلت إليك ${leaves.modifiedCount} إجازة بعد تغيير المدير المباشر`, 'LeaveRequest', userId, 'hr:leave');
  if (from) { try { emitToUser(from, 'hr:request', {}); emitToUser(from, 'hr:leave', {}); } catch (e) { /* */ } }
  return { requests: reqIds.length, leaves: leaves.modifiedCount || 0 };
}

module.exports = { handOverToNewManager };
