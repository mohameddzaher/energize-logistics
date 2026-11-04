/**
 * Return from leave: automatic status, manual return, extension, no-show.
 *
 * The approved leave's end date always reflects reality, so the live balance
 * (sum of approved leave days, see hrController.computeEmployeeBalance) refunds
 * an early return and charges an extension by itself.
 *
 * Status rules (sync):
 *   - an approved leave covers today            → employee "on_leave"
 *   - it ended and was not flagged as no-show   → back to "active" the next day
 *   - flagged as no-show                        → not working ("did not return")
 * Only employees the sync itself put on leave are returned automatically; an
 * "on leave" imported from a sheet without a leave record is left to HR.
 */
const LeaveRequest = require('../models/LeaveRequest');
const Employee = require('../models/Employee');
const User = require('../models/User');
const { leaveDays } = require('./leaveBalance');
const { todayKey } = require('./companyDay');
const { createNotification, notifySection } = require('../services/notificationService');

const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const nameOf = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');
const empName = (e) => (e ? (e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.employeeNumber || '') : '');

class LeaveReturnError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function emit(event, payload) {
  try { require('../websocket/socketManager').emitToAll(event, payload); } catch (_) { /* best effort */ }
}

function bustHrCaches() {
  try {
    const cache = require('./ttlCache');
    // 'dash:' too: the HR and section dashboards count who is on leave.
    for (const p of ['hr:', 'hrm:', 'lt:', 'fleet:', 'b2c:', 'dash:']) cache.clear(p);
  } catch (_) { /* best effort */ }
}

/** Notify the employee (linked login), the direct manager and the HR section. */
async function announce(leave, emp, { title, message, toHr = true }) {
  const users = new Set();
  if (leave.requester) users.add(String(leave.requester));
  if (leave.manager) users.add(String(leave.manager));
  const linked = await User.find({ linkedEmployee: emp._id, isActive: { $ne: false } }).select('_id').lean().catch(() => []);
  for (const u of linked) users.add(String(u._id));
  await Promise.all([...users].map((id) => createNotification({
    recipient: id, type: 'system_alert', title, message, relatedEntity: 'LeaveRequest', relatedEntityId: leave._id,
  }).catch(() => {})));
  if (toHr) await notifySection('HR', { title, message, relatedEntity: 'LeaveRequest', relatedEntityId: leave._id }).catch(() => {});
}

/** Recompute one employee's status from their leaves. Idempotent. */
async function syncEmployee(employeeId, { quiet = false } = {}) {
  const emp = await Employee.findById(employeeId);
  if (!emp || ['terminated', 'suspended'].includes(emp.employmentStatus)) return null;
  const today = todayKey();
  const [covering, noShow] = await Promise.all([
    LeaveRequest.findOne({ employee: emp._id, status: 'approved', startDate: { $lte: today }, endDate: { $gte: today } }).sort({ startDate: -1 }),
    LeaveRequest.findOne({ employee: emp._id, status: 'approved', returnState: 'no_show' }).sort({ endDate: -1 }),
  ]);
  const ENG = require('./hrEngagement');
  const before = { status: emp.employmentStatus, violation: !!emp.leaveViolation?.since };
  let change = '';
  let endedLeave = null;

  if (noShow && !covering) {
    if (!emp.leaveViolation?.since || String(emp.leaveViolation.leave) !== String(noShow._id)) {
      emp.leaveViolation = { leave: noShow._id, since: noShow.noShow?.since || addDays(noShow.endDate, 1), note: noShow.noShow?.note || '' };
      change = 'violation';
    }
  } else if (emp.leaveViolation?.since) {
    emp.leaveViolation = { leave: null, since: '', note: '' };
    change = change || 'violation_cleared';
  }

  if (covering && emp.employmentStatus === 'active') {
    emp.employmentStatus = 'on_leave';
    emp.leaveStatusSource = 'leave';
    emp.leaveStatusLeave = covering._id;
    change = 'started';
  } else if (covering && emp.employmentStatus === 'on_leave' && emp.leaveStatusSource !== 'leave') {
    // Already "on leave" from an import: an approved leave now owns the status, so it ends with it.
    emp.leaveStatusSource = 'leave';
    emp.leaveStatusLeave = covering._id;
    change = 'adopted';
  } else if (!covering && !noShow && emp.employmentStatus === 'on_leave' && emp.leaveStatusSource === 'leave') {
    const ended = emp.leaveStatusLeave ? await LeaveRequest.findById(emp.leaveStatusLeave) : null;
    endedLeave = ended;
    emp.employmentStatus = 'active';
    emp.leaveStatusSource = '';
    emp.leaveStatusLeave = null;
    change = 'returned';
    // An ended leave nobody recorded a return for: the return is automatic.
    if (ended && ended.status === 'approved' && !ended.returnState) {
      ended.returnState = 'returned';
      ended.returnAuto = true;
      ended.returnedOn = ended.endDate;
      ended.workStartsOn = addDays(ended.endDate, 1);
      ended.returnRecordedAt = new Date();
      await ended.save();
    }
  }

  if (!change) return null;
  emp.workStatusText = ENG.workStatusTextOf(emp);
  await emp.save();
  bustHrCaches();
  emit('hr:employee', { id: String(emp._id) });
  emit('hr:leave', { employee: String(emp._id) });

  if (!quiet) {
    const n = empName(emp);
    if (change === 'started' && covering) {
      await announce(covering, emp, { title: `بدأت إجازة ${n}`, message: `من ${covering.startDate} إلى ${covering.endDate} — حالته الآن «إجازة».` });
    } else if (change === 'returned') {
      const last = endedLeave || await LeaveRequest.findOne({ employee: emp._id, status: 'approved', endDate: { $lt: today } }).sort({ endDate: -1 });
      if (last) await announce(last, emp, { title: `عاد ${n} من الإجازة`, message: `يباشر العمل من ${last.workStartsOn || addDays(last.endDate, 1)} — حالته الآن «يعمل».` });
    } else if (change === 'violation' && noShow) {
      await announce(noShow, emp, { title: `${n} لم يعد من الإجازة`, message: `انتهت إجازته في ${noShow.endDate} ولم يعد ولم تُمدَّد — مخالفة.` });
    }
  }
  return { employee: String(emp._id), change, before };
}

/** Rewrite stored status texts that no longer match the rule (e.g. after a label change). */
async function repairStatusTexts() {
  const ENG = require('./hrEngagement');
  const rows = await Employee.find({
    employmentStatus: { $ne: 'terminated' },
    $or: [{ workStatusText: { $regex: 'إجازة' } }, { employmentStatus: 'on_leave' }, { 'leaveViolation.since': { $nin: ['', null] } }],
  }).select('employmentStatus leaveStatusSource leaveViolation sisterCompany terminationKind workStatusText').lean();
  const ops = [];
  for (const e of rows) {
    const want = ENG.workStatusTextOf(e);
    if (want !== e.workStatusText) ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: { workStatusText: want } } } });
  }
  if (ops.length) { await Employee.bulkWrite(ops); bustHrCaches(); emit('hr:employee', {}); }
  return ops.length;
}

/** Sweep every employee whose status can change today. */
async function syncAll() {
  const today = todayKey();
  const [covering, onLeaveBySync, noShow, flagged] = await Promise.all([
    LeaveRequest.distinct('employee', { status: 'approved', startDate: { $lte: today }, endDate: { $gte: today } }),
    Employee.distinct('_id', { employmentStatus: 'on_leave', leaveStatusSource: 'leave' }),
    LeaveRequest.distinct('employee', { status: 'approved', returnState: 'no_show' }),
    Employee.distinct('_id', { 'leaveViolation.since': { $nin: ['', null] } }),
  ]);
  const ids = [...new Set([...covering, ...onLeaveBySync, ...noShow, ...flagged].map(String))];
  const changes = [];
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const r = await syncEmployee(id).catch((e) => { console.error('[leave-sync]', id, e.message); return null; });
    if (r) changes.push(r);
  }
  return { checked: ids.length, changes };
}

async function loadApproved(leaveId) {
  const leave = await LeaveRequest.findById(leaveId);
  if (!leave) throw new LeaveReturnError('الإجازة غير موجودة', 404);
  if (leave.status !== 'approved') throw new LeaveReturnError('هذا الإجراء للإجازات المعتمدة فقط');
  if (!leave.plannedEndDate) leave.plannedEndDate = leave.endDate;
  return leave;
}

/**
 * Record a return (on time, early or late).
 * By default the return day still counts as leave and work starts the next day;
 * `startsSameDay` makes the return day itself a working day.
 */
async function recordReturn(leaveId, { returnDate, startsSameDay = false, note = '' }, user) {
  if (!isYmd(returnDate)) throw new LeaveReturnError('تاريخ العودة غير صالح');
  const leave = await loadApproved(leaveId);
  if (returnDate < leave.startDate) throw new LeaveReturnError('تاريخ العودة قبل بداية الإجازة');
  if (returnDate > todayKey()) throw new LeaveReturnError('لا تُسجَّل عودةٌ في يومٍ لم يأتِ بعد');
  const newEnd = startsSameDay ? addDays(returnDate, -1) : returnDate;
  if (newEnd < leave.startDate) throw new LeaveReturnError('عاد في يوم بداية الإجازة نفسه — ألغِ الإجازة بدلًا من تسجيل عودة');
  const before = { endDate: leave.endDate, days: leave.days };
  leave.endDate = newEnd;
  leave.days = leaveDays(leave.startDate, newEnd);
  leave.returnState = 'returned';
  leave.returnAuto = false;
  leave.returnedOn = returnDate;
  leave.workStartsOn = startsSameDay ? returnDate : addDays(returnDate, 1);
  leave.returnCountsAsWork = !!startsSameDay;
  leave.returnRecordedBy = user?._id;
  leave.returnRecordedByName = nameOf(user);
  leave.returnRecordedAt = new Date();
  leave.noShow = { since: '', note: '' };
  await leave.save();

  const emp = await Employee.findById(leave.employee);
  // A manual return takes over: the employee is active from the work start day.
  if (emp && emp.employmentStatus === 'on_leave' && leave.workStartsOn <= todayKey()) {
    emp.employmentStatus = 'active';
    emp.leaveStatusSource = '';
    emp.leaveStatusLeave = null;
  }
  if (emp && String(emp.leaveViolation?.leave || '') === String(leave._id)) emp.leaveViolation = { leave: null, since: '', note: '' };
  if (emp) { emp.workStatusText = require('./hrEngagement').workStatusTextOf(emp); await emp.save(); }
  await syncEmployee(leave.employee, { quiet: true });

  const plannedEnd = leave.plannedEndDate;
  const early = newEnd < plannedEnd;
  const late = newEnd > plannedEnd;
  const delta = leaveDays(plannedEnd < newEnd ? plannedEnd : newEnd, plannedEnd < newEnd ? newEnd : plannedEnd) - 1;
  if (emp) {
    const n = empName(emp);
    await announce(leave, emp, {
      title: `سُجِّلت عودة ${n} من الإجازة`,
      message: `عاد في ${returnDate} — يباشر العمل من ${leave.workStartsOn}.`
        + (early ? ` عاد قبل موعده بـ ${delta} يوم — تُعاد إلى رصيده.` : '')
        + (late ? ` تجاوز موعده بـ ${delta} يوم — تُخصَم من رصيده.` : '')
        + (note ? ` ملاحظة: ${note}` : ''),
    });
  }
  bustHrCaches();
  emit('hr:leave', { id: String(leave._id) });
  return { leave, before, early, late, deltaDays: delta };
}

/** Extend an approved leave to a later end date (charged to the balance). */
async function extendLeave(leaveId, { newEndDate, note = '' }, user) {
  if (!isYmd(newEndDate)) throw new LeaveReturnError('تاريخ النهاية الجديد غير صالح');
  const leave = await loadApproved(leaveId);
  if (newEndDate <= leave.endDate) throw new LeaveReturnError('تاريخ النهاية الجديد يجب أن يكون بعد نهاية الإجازة الحالية');
  if (leave.returnState === 'returned') throw new LeaveReturnError('سُجِّلت عودته بالفعل — لا يُمدَّد');
  const clash = await LeaveRequest.findOne({
    _id: { $ne: leave._id }, employee: leave.employee,
    status: { $in: ['approved', ...require('./leaveChain').OPEN_STATUSES] },
    startDate: { $lte: newEndDate }, endDate: { $gt: leave.endDate },
  }).select('startDate endDate').lean();
  if (clash) throw new LeaveReturnError(`التمديد يتداخل مع إجازةٍ أخرى (${clash.startDate} → ${clash.endDate})`);
  const fromEnd = leave.endDate;
  const added = leaveDays(addDays(fromEnd, 1), newEndDate);
  leave.extensions.push({ fromEnd, toEnd: newEndDate, days: added, note: String(note || '').trim(), by: user?._id, byName: nameOf(user) });
  leave.endDate = newEndDate;
  leave.days = leaveDays(leave.startDate, newEndDate);
  leave.returnState = '';
  leave.noShow = { since: '', note: '' };
  await leave.save();
  await syncEmployee(leave.employee, { quiet: true });

  const emp = await Employee.findById(leave.employee).lean();
  if (emp) {
    await announce(leave, emp, {
      title: `مُدِّدت إجازة ${empName(emp)}`,
      message: `من ${fromEnd} إلى ${newEndDate} (+${added} يوم تُخصَم من الرصيد).${note ? ` ملاحظة: ${note}` : ''}`,
    });
  }
  bustHrCaches();
  emit('hr:leave', { id: String(leave._id) });
  return { leave, addedDays: added };
}

/** Flag that the employee did not come back after the leave ended. */
async function markNoShow(leaveId, { note = '' }, user) {
  const leave = await loadApproved(leaveId);
  const today = todayKey();
  if (leave.endDate >= today) throw new LeaveReturnError('الإجازة لم تنتهِ بعد — المخالفة تُسجَّل بعد يوم نهايتها');
  if (leave.returnState === 'returned' && !leave.returnAuto) throw new LeaveReturnError('سُجِّلت عودته بالفعل');
  leave.returnState = 'no_show';
  leave.returnAuto = false;
  leave.returnedOn = '';
  leave.workStartsOn = '';
  leave.noShow = { since: addDays(leave.endDate, 1), note: String(note || '').trim(), by: user?._id, byName: nameOf(user), at: new Date() };
  await leave.save();

  // An automatic return may already have set him active: undo it.
  const emp = await Employee.findById(leave.employee);
  if (emp && !['terminated', 'suspended'].includes(emp.employmentStatus)) {
    emp.employmentStatus = 'on_leave';
    emp.leaveStatusSource = 'leave';
    emp.leaveStatusLeave = leave._id;
    emp.leaveViolation = { leave: leave._id, since: leave.noShow.since, note: leave.noShow.note };
    emp.workStatusText = require('./hrEngagement').workStatusTextOf(emp);
    await emp.save();
    await announce(leave, emp, {
      title: `مخالفة: ${empName(emp)} لم يعد من الإجازة`,
      message: `انتهت إجازته في ${leave.endDate} ولم يعد ولم تُمدَّد.${note ? ` ملاحظة: ${note}` : ''}`,
    });
  }
  bustHrCaches();
  emit('hr:employee', { id: String(leave.employee) });
  emit('hr:leave', { id: String(leave._id) });
  return { leave };
}

/** Start the periodic sync (every 10 minutes, and once at boot). */
let timer = null;
function startLeaveReturnSync() {
  if (timer) return;
  setTimeout(() => repairStatusTexts()
    .then((n) => { if (n) console.log(`[leave-sync] repaired ${n} status text(s)`); })
    .catch((e) => console.error('[leave-sync] repair', e.message)), 10 * 1000);
  const run = () => syncAll()
    .then((r) => { if (r.changes.length) console.log(`[leave-sync] ${r.changes.length} status change(s) of ${r.checked}`); })
    .catch((e) => console.error('[leave-sync]', e.message));
  setTimeout(run, 20 * 1000);
  timer = setInterval(run, 10 * 60 * 1000);
}

module.exports = {
  syncEmployee, syncAll, repairStatusTexts, recordReturn, extendLeave, markNoShow, startLeaveReturnSync, LeaveReturnError, addDays,
};
