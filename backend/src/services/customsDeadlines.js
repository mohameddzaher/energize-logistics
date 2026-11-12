/**
 * Customs deadlines: the demurrage (floor) date and the container return date, and the live alerts they raise.
 * Demurrage: containers get unloading + 3 days, fixed; vehicles get unloading + their day count (default 15, editable).
 * A deadline runs to the end of its day (Riyadh). The demurrage alert clears once every unit has left the port;
 * the return alert clears once every container is returned.
 */
const { todayKey, startOfDay, DAY_MS } = require('../utils/companyDay');

const CONTAINER_FLOOR_DAYS = 3;
const VEHICLE_FLOOR_DAYS = 15;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const ymdOf = (v) => {
  const s = String(v || '').slice(0, 10);
  return YMD.test(s) ? s : '';
};
const addDays = (ymd, n) => {
  if (!ymd) return '';
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Fills the derived dates on a plain object or document; `prev` is the stored row when patching. */
function applyDerivedDates(doc, prev = {}) {
  const get = (k) => (doc[k] !== undefined ? doc[k] : prev[k]);
  const unloading = ymdOf(get('unloadingAppointment'));
  const vehicles = get('cargoType') === 'vehicles';
  if (unloading) {
    // Containers: +3 days. Vehicles: their own day count (default 15), editable on the transaction.
    const days = vehicles ? (Number(get('demurrageDays')) > 0 ? Number(get('demurrageDays')) : VEHICLE_FLOOR_DAYS) : CONTAINER_FLOOR_DAYS;
    doc.demurrageStartDate = addDays(unloading, days);
    // Container return: free days and deadline are one fact. Typed days set the date; a typed date sets the days.
    if (!vehicles) {
      const typedFree = doc.returnFreeDays !== undefined && Number(doc.returnFreeDays) > 0 ? Math.round(Number(doc.returnFreeDays)) : 0;
      const typedDate = doc.returnDeadline !== undefined ? ymdOf(doc.returnDeadline) : '';
      const daysTo = (d) => Math.round((new Date(`${d}T12:00:00Z`) - new Date(`${unloading}T12:00:00Z`)) / DAY_MS);
      if (typedFree) doc.returnDeadline = addDays(unloading, typedFree);
      else if (typedDate) { const n = daysTo(typedDate); if (n >= 0) doc.returnFreeDays = n; }
      else {
        const free = Number(get('returnFreeDays')) || 0;
        const cur = ymdOf(get('returnDeadline'));
        if (free > 0) doc.returnDeadline = addDays(unloading, free);
        else if (cur && daysTo(cur) >= 0) doc.returnFreeDays = daysTo(cur);
      }
    }
  }
  return doc;
}

/** Live alerts of one transaction. `p` is pipelineOf(c). */
function alertsOf(c, p, now = Date.now()) {
  if (!c || c.cancelled || c.upcoming || c.isCompleted) return [];
  const out = [];
  const units = (p && p.units) || [];
  const has = (u, k) => u.steps.some((s) => s.key === k && s.done);
  const stepDone = (k) => (p?.steps || []).some((s) => s.key === k && s.done);
  const leftPort = units.length
    ? units.every((u) => has(u, 'transport_to_yard') || has(u, 'transport_to_customer'))
    : stepDone('transport_to_yard') || stepDone('transport_to_customer');
  const returned = c.cargoType === 'vehicles' || (units.length
    ? units.every((u) => has(u, 'containers_returned'))
    : stepDone('containers_returned') || !!c.stageDone?.containersReturned);
  const push = (type, date) => {
    const end = startOfDay(date).getTime() + DAY_MS; // midnight closing the deadline day
    const msLeft = end - now;
    out.push({ type, date, deadlineAt: new Date(end).toISOString(), msLeft, state: msLeft < 0 ? 'overdue' : msLeft <= DAY_MS ? 'today' : msLeft <= 3 * DAY_MS ? 'soon' : 'ok' });
  };
  const floor = ymdOf(c.demurrageStartDate);
  if (floor && !leftPort) push('demurrage', floor);
  const ret = ymdOf(c.returnDeadline);
  if (ret && !returned) push('return', ret);
  return out;
}

module.exports = { applyDerivedDates, alertsOf, addDays, todayKey, CONTAINER_FLOOR_DAYS, VEHICLE_FLOOR_DAYS };
