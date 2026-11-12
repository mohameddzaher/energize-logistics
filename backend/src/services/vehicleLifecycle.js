/**
 * The vehicle's lifecycle actions, one path each for every screen that offers them (vehicle registry, its profile, the authorizations page, light-transport vehicles, mobile).
 * - revokeAuthorization: empties the authorization paper and closes the assignment log through utils/vehicleAuthorization.setHolder, which also refreshes the employee file snapshot and announces; the authorization copied onto the light-transport operating orders still running on the vehicle is cleared here.
 * - endService: refused while the vehicle is authorized; archives it (utils/vehicleActive) and releases its rider and running orders.
 * - restoreService: back to the active registry.
 * Errors carry `status` (and `code`) so each route answers the same way.
 */
const mongoose = require('mongoose');
const logAudit = require('../utils/auditLogger');
const VA = require('../utils/vehicleAuthorization');
const { announceVehicles } = require('../utils/vehicleAnnounce');

const S = (v) => String(v == null ? '' : v).trim();
const nameOf = (u) => S(`${u?.firstName || ''} ${u?.lastName || ''}`);
const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const Models = () => ({
  VehicleMaster: require('../models/VehicleMaster').VehicleMaster,
  Vehicle: require('../models/Vehicle'),
  ...require('../models/LightTransport'),
});

const parseDate = (d) => {
  if (!d) return null;
  const t = new Date(String(d).length === 10 ? `${d}T00:00:00.000Z` : d);
  return Number.isNaN(t.getTime()) ? null : t;
};

async function loadVehicle(vmOrId, { withArchived = false } = {}) {
  const { VehicleMaster } = Models();
  if (vmOrId && vmOrId.save) return vmOrId;
  if (!mongoose.Types.ObjectId.isValid(String(vmOrId || ''))) throw fail(404, 'المركبة غير موجودة');
  const vm = await VehicleMaster.findById(vmOrId).setOptions({ withArchived });
  if (!vm) throw fail(404, 'المركبة غير موجودة');
  return vm;
}

/**
 * Cancels the vehicle's authorization everywhere at once.
 * @param ctx { user, reason, source, ip }
 */
/** Frees the vehicle's B2C rider(s) and ends their running orders; used by revoke and end-service. */
async function releaseRiders(vm, note, date, ctx = {}) {
  const { LightTransportEmployee, LightTransportOrder } = Models();
  const by = ctx.user?._id || null;
  const byName = nameOf(ctx.user);
  const riders = await LightTransportEmployee.find({ vehicle: vm._id });
  for (const l of riders) {
    l.history.push({ kind: 'vehicle', by, byName, fromValue: S(l.vehiclePlate), toValue: '', note });
    l.vehicle = null;
    l.vehiclePlate = '';
    if (l.vehicleHold?.at) l.vehicleHold = { at: null, reason: '' };
    await l.save(); // eslint-disable-line no-await-in-loop
  }
  const orders = await LightTransportOrder.updateMany(
    { vehicle: vm._id, status: { $in: ['active', 'hold'] } },
    { $set: { status: 'ended', endDate: date, endReasonAr: note } },
  );
  return { riders, endedOrders: orders.modifiedCount || 0 };
}

async function revokeAuthorization(vmOrId, ctx = {}) {
  const { LightTransportOrder } = Models();
  const vm = await loadVehicle(vmOrId);
  const holder = VA.holderOf(vm);
  const reason = S(ctx.reason).slice(0, 500);
  const source = S(ctx.source) || 'سجل المركبات';

  let r;
  if (holder) {
    r = await VA.setHolder(vm, null, {
      userId: ctx.user?._id, byName: nameOf(ctx.user), reason: reason || `أُلغي من ${source}`,
    });
  } else {
    // An empty paper may still leave an open assignment in an employee file (written before the registers were joined); close it rather than refuse.
    r = await VA.syncLegacyFromMaster(vm.toObject(), { reason: reason || `أُلغي من ${source}`, userId: ctx.user?._id });
    if (!r.closed) throw fail(400, `لا تفويضَ قائمٌ على المركبة ${vm.plateNumber}`);
  }

  // The running operating order carries the authorization it was issued with; once revoked, no number or term may still show there.
  const orders = await LightTransportOrder.updateMany(
    { vehicle: vm._id, status: { $in: ['active', 'hold'] }, $or: [{ authorizationMoved: true }, { authorizationNumber: { $nin: ['', null] } }, { authorizationStart: { $ne: null } }, { authorizationEnd: { $ne: null } }] },
    { $set: { authorizationMoved: false, authorizationNumber: '', authorizationStart: null, authorizationEnd: null } },
  );

  // Owner, 2026-11-12: a revoked vehicle is not ridden either; its rider is released and his running order ended.
  const released = await releaseRiders(vm, `أُلغي التفويض${reason ? ` — ${reason}` : ''}`, new Date(), ctx);

  await logAudit({
    user: ctx.user, action: 'revoke_vehicle_authorization', entity: 'VehicleMaster', entityId: vm._id,
    changes: { after: { plateNumber: vm.plateNumber, previousHolder: holder?.name || '', previousIdNumber: holder?.idNumber || '', authorizationNumber: holder?.authorizationNumber || '', closedAssignments: r.closed, clearedOrders: orders.modifiedCount || 0, releasedRiders: released.riders.length, endedOrders: released.endedOrders, reason, source } },
    ipAddress: ctx.ip,
  });
  // setHolder already announced; the order change above needs its own clear-then-emit.
  announceVehicles({ id: String(vm._id) }, {
    events: [['vehicle:authorization', { vehicle: String(vm._id) }], ...(r.employees || []).map((e) => ['hr:employee', { id: e }])],
  });

  const who = holder?.name || '';
  return {
    message: r.closed
      ? `أُلغي التفويض عن ${vm.plateNumber}${who ? ` (${who})` : ''} — وأُغلق ${r.closed} إسنادًا في ملفّ الموظّف.`
      : `أُلغي التفويض عن ${vm.plateNumber}${who ? ` (${who})` : ''}.`,
    closedAssignments: r.closed,
    clearedOrders: orders.modifiedCount || 0,
    releasedRiders: released.riders.length,
    vehicle: vm,
  };
}

/**
 * Ends the vehicle's service and moves it to the archive. Refused while someone is authorized on it.
 * @param body { reason, date }
 */
async function endService(vmOrId, body = {}, ctx = {}) {
  const { Vehicle } = Models();
  const vm = await loadVehicle(vmOrId, { withArchived: true });
  if (vm.archived) throw fail(409, `المركبة ${vm.plateNumber} في الأرشيف بالفعل`, { code: 'ALREADY_ARCHIVED' });
  const holder = VA.holderOf(vm);
  if (holder) {
    const who = holder.name || holder.idNumber;
    throw fail(409, `المركبة ما زالت مفوَّضة لـ ${who} — ألغِ التفويض أولًا`, { code: 'VEHICLE_AUTHORIZED', holder });
  }
  const reason = S(body.reason).slice(0, 500);
  if (!reason) throw fail(400, 'سبب إنهاء الخدمة مطلوب');
  const date = parseDate(body.date);
  if (!date) throw fail(400, 'تاريخ إنهاء الخدمة مطلوب');

  const by = ctx.user?._id || null;
  const byName = nameOf(ctx.user);
  const note = `انتهت خدمة المركبة — ${reason}`;

  // Its rider is released and his running order closed: a vehicle that is no longer ours cannot be ridden in the section.
  const { riders, endedOrders } = await releaseRiders(vm, note, date, ctx);
  const orders = { modifiedCount: endedOrders };
  // The legacy register mirror stops counting it as available.
  const legacy = await VA.legacyVehiclesOf(vm);
  if (legacy.length) await Vehicle.updateMany({ _id: { $in: legacy.map((x) => x._id) } }, { $set: { status: 'out_of_service' } });

  vm.archived = true;
  vm.archive = { endDate: date, reason, by, byName, at: new Date(), lastRider: riders.map((l) => S(l.name)).filter(Boolean).join('، ') };
  vm.archiveLog = vm.archiveLog || [];
  vm.archiveLog.push({ action: 'end', date, reason, by, byName, at: new Date() });
  await vm.save();

  await logAudit({
    user: ctx.user, action: 'end_vehicle_service', entity: 'VehicleMaster', entityId: vm._id,
    changes: { after: { plateNumber: vm.plateNumber, reason, endDate: date, releasedRiders: riders.length, endedOrders: orders.modifiedCount || 0 } },
    ipAddress: ctx.ip,
  });
  announceVehicles({ id: String(vm._id), archived: true }, { events: [['vehicle:updated', { id: String(vm._id) }]] });
  return {
    message: `أُنهيت خدمة المركبة ${vm.plateNumber} ونُقلت إلى الأرشيف.`,
    releasedRiders: riders.length,
    endedOrders: orders.modifiedCount || 0,
    vehicle: vm,
  };
}

/** Brings an archived vehicle back to the active registry; its history stays as it was. */
async function restoreService(vmOrId, body = {}, ctx = {}) {
  const { Vehicle } = Models();
  const vm = await loadVehicle(vmOrId, { withArchived: true });
  if (!vm.archived) throw fail(400, `المركبة ${vm.plateNumber} ليست في الأرشيف`);
  const reason = S(body.reason).slice(0, 500);
  const by = ctx.user?._id || null;
  const byName = nameOf(ctx.user);

  vm.archived = false;
  vm.archiveLog = vm.archiveLog || [];
  vm.archiveLog.push({ action: 'restore', date: new Date(), reason, by, byName, at: new Date() });
  vm.archive = { endDate: null, reason: '', by: null, byName: '', at: null, lastRider: '' };
  await vm.save();

  const legacy = await VA.legacyVehiclesOf(vm);
  if (legacy.length) {
    await Vehicle.updateMany({ _id: { $in: legacy.map((x) => x._id) }, status: 'out_of_service' }, { $set: { status: 'available' } });
  }

  await logAudit({
    user: ctx.user, action: 'restore_vehicle_service', entity: 'VehicleMaster', entityId: vm._id,
    changes: { after: { plateNumber: vm.plateNumber, reason } }, ipAddress: ctx.ip,
  });
  announceVehicles({ id: String(vm._id), restored: true }, { events: [['vehicle:updated', { id: String(vm._id) }]] });
  return { message: `أُعيدت المركبة ${vm.plateNumber} إلى سجل المركبات.`, vehicle: vm };
}

/** Express adapter: the same status, code and message from every route. */
function reply(res, e, fallback) {
  if (e && e.status) return res.status(e.status).json({ message: e.message, code: e.code, holder: e.holder });
  console.error(fallback, e);
  return res.status(500).json({ message: fallback });
}

module.exports = { revokeAuthorization, endService, restoreService, reply };
