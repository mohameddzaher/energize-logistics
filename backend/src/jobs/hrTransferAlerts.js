/**
 * hrTransferAlerts: alerts for the sponsorship-transfer-pending status.
 * An employee ended with that status has one month (`transferDeadline`). During that month, and after it if late, HR is alerted twice a day (morning and evening, Riyadh time) to remove him from the system; once removed he is archived and alerts stop. `transferAlertKey` is written atomically before sending, so two workers never send the same alert.
 */
const Employee = require('../models/Employee');
const { notifySection } = require('../services/notificationService');
const ENG = require('../utils/hrEngagement');

let timer = null;
let running = false;
const EVERY_MS = 30 * 60 * 1000;

const riyadhWindow = (d = new Date()) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
    .formatToParts(d).reduce((m, x) => ((m[x.type] = x.value), m), {});
  return `${p.year}-${p.month}-${p.day}-${Number(p.hour) < 12 ? 'am' : 'pm'}`;
};

async function sweepOnce() {
  if (running) return { skipped: true };
  running = true;
  let sent = 0;
  try {
    const key = riyadhWindow();
    const rows = await Employee.find({
      employmentStatus: 'terminated', terminationKind: 'transfer_pending',
      systemStatus: { $ne: ENG.SYSTEM_OUT }, transferAlertKey: { $ne: key },
    }).select('arabicName firstName lastName employeeNumber transferDeadline terminatedAt').lean();
    for (const e of rows) {
      // Atomic: whoever claims the window sends; the other finds it written and stays silent.
      // eslint-disable-next-line no-await-in-loop
      const won = await Employee.updateOne({ _id: e._id, transferAlertKey: { $ne: key } }, { $set: { transferAlertKey: key } });
      if (!won.modifiedCount) continue;
      const name = e.arabicName || [e.firstName, e.lastName].filter(Boolean).join(' ');
      const deadline = e.transferDeadline ? new Date(e.transferDeadline) : null;
      const days = deadline ? Math.ceil((deadline - Date.now()) / 86400000) : null;
      const when = days == null ? '' : days > 0 ? `باقي ${days} يوم على انتهاء مهلة الشهر` : `تجاوز مهلة الشهر بـ${-days} يوم`;
      try {
        // eslint-disable-next-line no-await-in-loop
        await notifySection('HR', {
          type: 'system_alert',
          title: `انتظار نقل الكفالة: أخرِج ${name} من النظام`,
          message: `${e.employeeNumber ? `#${e.employeeNumber} · ` : ''}${when} — «خروج من النظام» من ملفّ الموظف ينقله إلى الأرشيف.`,
          relatedEntity: 'Employee', relatedEntityId: e._id,
        });
        sent += 1;
      } catch (_) { /* A missed alert must not stop the round. */ }
    }
  } catch (e) {
    console.log('[hrTransferAlerts] error:', e.message);
  } finally {
    running = false;
  }
  return { sent };
}

function startHrTransferAlerts() {
  if (timer) return;
  timer = setInterval(() => { sweepOnce().catch(() => {}); }, EVERY_MS);
  setTimeout(() => { sweepOnce().catch(() => {}); }, 60 * 1000);
}

module.exports = { startHrTransferAlerts, sweepOnce, riyadhWindow };
