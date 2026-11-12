/**
 * Fleet alerts reach those who can act on them rather than waiting on a screen.
 * The alert engine opens `Ls2Alert` on each breach: tire or coolant temperature, pressure under the limit, overdue maintenance. Previously the only effect was a line on the alerts screen, unseen unless opened.
 * Now a notification goes to those who can act: the Location Solutions team (reads the devices) and the fleet manager and team (stop the truck or send it to the workshop); it reaches the phone as well as the site (see services/notificationService).
 * Only critical and overdue items are sent: a tire at 110 degrees or late maintenance is a wake-up; stops and slowdowns are lines read on the screen. One notification per new alert, not per polling cycle: sent when opened (the engine does not reopen an open alert).
 */
const { ALERT_TYPES: T } = require('../config/ls2Config');

// Roles that act: device readers and the truck owners themselves.
const ROLES = ['location_manager', 'location_team_leader', 'location_staff', 'fleet_manager', 'fleet_team_leader', 'fleet_supervisor'];
const SECTIONS = ['Location Solutions', 'Fleet Management'];

// Sent as a notification whatever the severity: a missed maintenance date is not a "warning" to read later.
const ALWAYS = new Set([T.MAINTENANCE_OVERDUE, T.TIRE_PRESSURE_CRITICAL, T.TIRE_FAULT]);

let cached = { at: 0, ids: [] };

/** Who is notified: the fleet and Location Solutions roles. Read every five minutes. */
async function recipients() {
  if (Date.now() - cached.at < 5 * 60 * 1000) return cached.ids;
  const User = require('../models/User');
  const ids = new Set();
  const users = await User.find({ isActive: { $ne: false }, role: { $in: ROLES } }).select('_id role').lean();
  users.forEach((u) => ids.add(String(u._id)));
  // By role only. Notifying everyone with "edit" on either section gave a list of 25, including accountants with edit on Location and operations staff with edit on Fleet, none of whom stops a truck for a tire temperature. A notification that reaches someone who cannot act trains people to ignore it, and the ones that matter get lost.
  cached = { at: Date.now(), ids: [...ids] };
  return cached.ids;
}

/** @param {Array} alerts alerts opened now: { unitId, plate, type, severity, message } */
async function notifyNewAlerts(alerts) {
  const worth = (alerts || []).filter((a) => a && (a.severity === 'critical' || ALWAYS.has(a.type)));
  if (!worth.length) return 0;
  const ids = await recipients();
  if (!ids.length) return 0;

  const { createNotification } = require('./notificationService');
  // A batch with ten trucks does not send ten notifications per person; they are grouped.
  const title = worth.length === 1
    ? `تنبيه أسطول: ${worth[0].plate || worth[0].unitId}`
    : `تنبيهات أسطول جديدة (${worth.length})`;
  const message = worth.slice(0, 6).map((a) => `${a.plate || a.unitId}: ${a.message}`).join(' · ')
    + (worth.length > 6 ? ` … +${worth.length - 6}` : '');

  await Promise.all(ids.map((rid) => createNotification({
    recipient: rid,
    type: 'system_alert',
    title,
    message,
    relatedEntity: 'Ls2Alert',
    relatedEntityId: worth[0]._id || undefined,
  }).catch(() => {})));
  return worth.length;
}

module.exports = { notifyNewAlerts, _recipients: recipients };
