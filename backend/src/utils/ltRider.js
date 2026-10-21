/**
 * ltRider — «مَن يركب هذه المركبة الآن؟» تعريفٌ واحد.
 *
 * ── التعريف (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢) ─────────────────────────────────────
 * راكبُ المركبة هو صفُّ «موظّفي النقل الخفيف» النشطُ الذي يشير `vehicle` فيه
 * إليها — أيًّا كانت حالةُ يومه: في إجازةٍ أو موقوفٌ أو في حادث، يبقى راكبَها
 * (الركوبُ غيرُ العمل). ومن انتهت خدمتُه في الموارد البشريّة والمركبةُ ما زالت
 * معه فهو «بانتظار التسليم» (utils/ltVehicleRelease) — لا راكبٌ ولا واقفة.
 *
 * و`VehicleMaster.actualDriver` (القائدُ الفعليّ) **مرآةٌ** لهذا الصفّ يكتبها
 * خطّافُ النموذج (models/LightTransport) — لا تُكتب من شاشة. فتغييرُ القائد
 * الفعليّ = تغييرُ ربط الصفّ بالمركبة، وهو ما تفعله `setRider` هنا (بأمر تشغيلٍ
 * يُفتح ويُغلق كما يفعل «أوامر التشغيل»)، فتتبعها المرآةُ واللوحةُ والقوائم.
 */
const S = (v) => String(v == null ? '' : v).trim();
const who = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ');

/** حالةُ المركبة من راكبيها: `withRider` · `hold` · `idle`. */
function vehicleState(riders = [], holders = []) {
  if (riders.length) return 'withRider';
  if (holders.length) return 'hold';
  return 'idle';
}

/** رقمُ أمر التشغيل التالي — بالصيغة نفسِها التي يكتبها «أوامر التشغيل». */
async function nextOrderNumber() {
  const { LightTransportOrder } = require('../models/LightTransport');
  const last = await LightTransportOrder.findOne({ orderNumber: /^LT-/ }).sort({ orderNumber: -1 }).select('orderNumber').lean();
  const n = last ? (Number(String(last.orderNumber).replace('LT-', '')) || 0) + 1 : 1;
  return `LT-${String(n).padStart(5, '0')}`;
}

/** يُبطل ما يُقرأ منه الراكبُ ثمّ يُعلن — الإبطالُ قبل الإعلان. */
function announce() {
  try {
    const cache = require('./ttlCache');
    for (const k of ['lt:', 'vreg:', 'hr:', 'hrm:', 'dash:', 'reports:doc:']) cache.clear(k);
  } catch (_) { /* */ }
  try {
    const { emitToAll } = require('../websocket/socketManager');
    for (const ev of ['lt:updated', 'vreg:updated', 'hr:employee']) emitToAll(ev, { from: 'rider' });
  } catch (_) { /* */ }
}

/**
 * يجعل `ltId` راكبَ المركبة (أو يُنزل راكبيها إن كان `null`).
 * • الراكبُ الحاليُّ يُنزَل: يُغلق أمرُه ويُقيَّد في سجلّه أنّ مركبتَه أُعطيت لغيره.
 * • والجديدُ يُغلق أمرُه السابق (وتصير مركبتُه السابقة بلا راكب) ويُفتح له أمرٌ
 *   على هذه المركبة، ويُكتب الربطُ على صفّه — فيتبعه الخطّافُ إلى `actualDriver`.
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
  if (emp && current.length === 1 && String(current[0]._id) === String(emp._id)) return out; // هو راكبُها أصلًا

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
  // ومرآةٌ بقيت على المركبة بلا راكبٍ (نصٌّ قديم) تُمسَح — المرآةُ تتبع الصفّ.
  if (!emp) {
    await VehicleMaster.updateOne({ _id: vehicle._id }, { $set: { 'actualDriver.name': '', 'actualDriver.idNumber': '' } });
  }
  if (doAnnounce && out.changed) announce();
  else if (doAnnounce && !emp) announce();
  return out;
}

module.exports = { setRider, vehicleState, nextOrderNumber, announce };
