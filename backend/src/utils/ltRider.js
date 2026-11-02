/**
 * ltRider: who rides this vehicle now, one definition.
 * The rider is the active light-transport row whose `vehicle` points to it, whatever the day's state (on leave, suspended, in an accident): riding is not working. Someone whose HR service ended while still holding the vehicle is awaiting handover (utils/ltVehicleRelease): neither rider nor idle.
 * `VehicleMaster.actualDriver` is a mirror of this row written by the model hook (models/LightTransport), never from a screen. Changing the actual driver means changing the row's vehicle link, which `setRider` does (with an operating order opened and closed as operating orders do), and the mirror, dashboard and lists follow.
 */
const S = (v) => String(v == null ? '' : v).trim();
const who = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ');

/** Vehicle state from its riders: `withRider`, `hold` or `idle`. */
function vehicleState(riders = [], holders = []) {
  if (riders.length) return 'withRider';
  if (holders.length) return 'hold';
  return 'idle';
}

/** Next operating-order number, in the same format the operating-orders screen writes. */
async function nextOrderNumber() {
  const { LightTransportOrder } = require('../models/LightTransport');
  const last = await LightTransportOrder.findOne({ orderNumber: /^LT-/ }).sort({ orderNumber: -1 }).select('orderNumber').lean();
  const n = last ? (Number(String(last.orderNumber).replace('LT-', '')) || 0) + 1 : 1;
  return `LT-${String(n).padStart(5, '0')}`;
}

/** Invalidates what the rider is read from, then announces (invalidate before announce). */
function announce() {
  require('./vehicleAnnounce').announceVehicles({ from: 'rider' }, {
    extraCaches: ['hr:', 'dash:'], events: [['hr:employee', { from: 'rider' }]],
  });
}

/**
 * Makes `ltId` the vehicle's rider (or unseats its riders if `null`).
 * - The current rider is unseated: their order is closed and their record notes the vehicle was given to someone else.
 * - The new rider's previous order is closed (their previous vehicle becomes riderless), a new order is opened on this vehicle, and the link is written on their row; the hook carries it to `actualDriver`.
 * @returns {{ changed: boolean, rider: object|null, unseated: string[] }}
 */
async function setRider(vehicleId, ltId, { user = null, reason = '', note = '', announce: doAnnounce = true } = {}) {
  const { LightTransportEmployee, LightTransportOrder } = require('../models/LightTransport');
  const { VehicleMaster } = require('../models/VehicleMaster');
  const vehicle = await VehicleMaster.findById(vehicleId).select('plateNumber registrationTypeAr');
  if (!vehicle) throw Object.assign(new Error('المركبة غير موجودة في سجل المركبات'), { status: 404 });
  const by = user ? { by: user._id, byName: who(user) } : { byName: 'النظام' };
  const today = new Date();
  const emp = ltId ? await LightTransportEmployee.findOne({ _id: ltId, isActive: { $ne: false } }) : null;
  if (ltId && !emp) throw Object.assign(new Error('الموظّف غير موجود في سجلّ النقل الخفيف'), { status: 404 });

  const current = await LightTransportEmployee.find({ vehicle: vehicle._id, isActive: { $ne: false } });
  const out = { changed: false, rider: emp ? { _id: String(emp._id), name: emp.name, idNumber: emp.idNumber } : null, unseated: [] };
  if (emp && current.length === 1 && String(current[0]._id) === String(emp._id)) return out; // Already the rider.

  for (const c of current) {
    if (emp && String(c._id) === String(emp._id)) continue;
    await LightTransportOrder.updateMany({ ltEmployee: c._id, status: { $in: ['active', 'hold'] } }, {
      $set: { status: 'ended', endDate: today, endReasonAr: emp ? `أُعطيت المركبة ${vehicle.plateNumber} لـ${emp.name}` : (S(reason) || 'أُنزل عن المركبة') },
    });
    c.history.push({
      kind: 'vehicle', ...by, fromValue: S(vehicle.plateNumber), toValue: '',
      note: emp ? `صار بلا مركبة — مركبتُه أُعطيت لـ${emp.name}` : `إنزال — ${S(reason) || 'من مركبات النقل الخفيف'}`,
    });
    c.vehicle = null; c.vehiclePlate = ''; c.vehicleHold = { at: null, reason: '' };
    await c.save();
    out.unseated.push(c.name);
    out.changed = true;
  }

  if (emp) {
    await LightTransportOrder.updateMany({ ltEmployee: emp._id, status: { $in: ['active', 'hold'] } }, {
      $set: { status: 'ended', endDate: today, endReasonAr: `انتقل إلى ${vehicle.plateNumber}` },
    });
    const order = await LightTransportOrder.create({
      orderNumber: await nextOrderNumber(),
      ltEmployee: emp._id, employeeName: emp.name, employeeIdNumber: emp.idNumber,
      vehicle: vehicle._id, vehiclePlate: vehicle.plateNumber, vehicleTypeAr: vehicle.registrationTypeAr || '',
      projectAr: emp.projectAr, cityAr: emp.cityAr,
      supervisorUser: emp.supervisorUser || null, supervisorName: emp.supervisorName,
      housing: emp.housing, housingRoom: emp.housingRoom,
      startDate: today, status: 'active',
      notesAr: S(note) || 'القائد الفعليّ — من مركبات النقل الخفيف',
      createdBy: user?._id, createdByName: by.byName,
    });
    emp.history.push({ kind: 'vehicle', ...by, fromValue: S(emp.vehiclePlate), toValue: S(vehicle.plateNumber), note: `أمر تشغيل ${order.orderNumber}${note ? ` — ${note}` : ''}` });
    emp.vehicle = vehicle._id;
    emp.vehiclePlate = vehicle.plateNumber;
    if (vehicle.registrationTypeAr) emp.vehicleTypeAr = vehicle.registrationTypeAr;
    emp.vehicleHold = { at: null, reason: '' };
    if (user) emp.lastModifiedBy = user._id;
    await emp.save();
    out.changed = true;
  }
  // A mirror left on a riderless vehicle (stale text) is cleared; the mirror follows the row.
  if (!emp) {
    await VehicleMaster.updateOne({ _id: vehicle._id }, { $set: { 'actualDriver.name': '', 'actualDriver.idNumber': '' } });
  }
  if (doAnnounce && out.changed) announce();
  else if (doAnnounce && !emp) announce();
  return out;
}

module.exports = { setRider, vehicleState, nextOrderNumber, announce };
