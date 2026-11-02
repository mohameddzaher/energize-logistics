/**
 * A vehicle held by someone whose service ended is put on hold and flagged, not cancelled; the department decides whether to take it back or reassign it.
 * The system keeps the vehicle with him as actual driver, sets his operating order to `hold` (neither active nor closed) and notifies B2C once. If he returns to work the hold is lifted.
 * Authorization decides nothing here; the actual driver counts. `run()` is called after each service end or record edit, and hourly as a safety net.
 */
const S = (v) => String(v ?? '').trim();
const HOLD_REASON = 'انتهت خدمتُه والمركبةُ ما زالت معه — بانتظار استلامها أو تسليمها لغيره';

async function run({ dry = false } = {}) {
  require('../models/Employee');
  const { LightTransportEmployee, LightTransportOrder } = require('../models/LightTransport');
  const lts = await LightTransportEmployee.find({ isActive: { $ne: false }, vehicle: { $ne: null } })
    .populate('employee', 'employmentStatus');
  const ended = (l) => (l.employee && typeof l.employee === 'object'
    ? l.employee.employmentStatus === 'terminated'
    : /انهاء|إنهاء/.test(S(l.workStatusAr)));
  const out = { held: [], released: [] };

  for (const l of lts) {
    const onHold = !!l.vehicleHold?.at;
    if (ended(l) && !onHold) {
      out.held.push({ name: l.name, plate: l.vehiclePlate });
      if (dry) continue;
      l.vehicleHold = { at: new Date(), reason: HOLD_REASON };
      l.history.push({ kind: 'vehicle', byName: 'النظام', fromValue: S(l.vehiclePlate), toValue: S(l.vehiclePlate), note: `تعليق — ${HOLD_REASON}` });
      await l.save();
      await LightTransportOrder.updateMany({ ltEmployee: l._id, status: 'active' }, { $set: { status: 'hold' } });
      try {
        await require('../services/notificationService').notifySection('B2C', {
          type: 'system_alert',
          title: `مركبةٌ مع منتهي الخدمة: ${S(l.vehiclePlate)}`,
          message: `${l.name} — انتهت خدمتُه والمركبة ${S(l.vehiclePlate)} ما زالت معه. أمرُ تشغيله معلَّق: استلم المركبة منه أو سلّمها لغيره بأمر تشغيل.`,
          relatedEntity: 'LightTransportEmployee', relatedEntityId: l._id,
        });
      } catch (_) { /* A failed notification must not drop the hold */ }
    } else if (!ended(l) && onHold) {
      out.released.push({ name: l.name, plate: l.vehiclePlate });
      if (dry) continue;
      l.vehicleHold = { at: null, reason: '' };
      l.history.push({ kind: 'vehicle', byName: 'النظام', fromValue: S(l.vehiclePlate), toValue: S(l.vehiclePlate), note: 'رُفع التعليق — عاد إلى العمل' });
      await l.save();
      await LightTransportOrder.updateMany({ ltEmployee: l._id, status: 'hold' }, { $set: { status: 'active' } });
    }
  }
  // Someone who left the vehicle while on hold: no hold without a vehicle.
  if (!dry) {
    await LightTransportEmployee.updateMany({ vehicle: null, 'vehicleHold.at': { $ne: null } }, { $set: { 'vehicleHold.at': null, 'vehicleHold.reason': '' } });
  }

  if (!dry && (out.held.length || out.released.length)) {
    require('./vehicleAnnounce').announceVehicles({});
  }
  return out;
}

const after = () => { run().catch((e) => console.error('[lt-hold]', e.message)); };

function startHourly() {
  setTimeout(after, 60 * 1000);
  setInterval(after, 60 * 60 * 1000).unref();
}

module.exports = { run, after, startHourly, HOLD_REASON };
