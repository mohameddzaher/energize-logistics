/**
 * Authorization: a single source for "who is authorized on this vehicle now?".
 * What happened: a light-transport vehicle had no authorized person, while the employee's HR file said it was authorized to a named employee since a given date, and ending his service said to cancel the authorization first. Cause: the authorization is written in two registers:
 * 1) `VehicleMaster.authorizedPerson` is the authorization sheet on the vehicle, read by the vehicles and light-transport screens. It is the reference.
 * 2) `VehicleAuthorization` (plus the legacy `Vehicle` pointers and `Employee.vehiclePlate`) is the per-employee assignment register, read by the employee file and clearance. Each write path wrote to only one: the authorizations page wrote both; B2C's section vehicle edit, operations orders and the registry's vehicle edit wrote only the first; the legacy vehicle page's buttons wrote only the second. So they diverged: one plate had its authorization cancelled from B2C while its open assignment stayed active. Rules: - The present state is written and read from the sheet (`authorizedPerson`) alone. - The assignment register is a mirror and history: it follows the sheet after every write to it, from any path, via `syncLegacyFromMaster`. The model hooks (models/VehicleMaster) call it, so a new path need not remember. - A write from the legacy path (the HR vehicle page) goes through `setHolder`: it writes the sheet first, then the mirror follows. - Readers (file, clearance, driver cards) ask `currentFor`. The assignment alone is read only for a legacy vehicle with no sheet in the registry. The link between `Vehicle` and `VehicleMaster` is by plate (`orderlessPlateKey`: no order or spaces, so a plate with two spaces equals the one with one), then pinned in `Vehicle.master` so it is not guessed again.
 */
const mongoose = require('mongoose');
const { orderlessPlateKey } = require('./plateKey');

const S = (v) => String(v == null ? '' : v).trim();
const fold = (x) => String(x || '')
  .replace(/[أإآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[^؀-ۿa-zA-Z0-9]/g, '').toLowerCase();
const ymd = (d) => {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
};
const todayKey = () => { try { return require('./companyDay').todayKey(); } catch (_) { return new Date().toISOString().slice(0, 10); } };

const M = () => ({
  VehicleMaster: require('../models/VehicleMaster').VehicleMaster,
  Vehicle: require('../models/Vehicle'),
  VehicleAuthorization: require('../models/VehicleAuthorization'),
  Employee: require('../models/Employee'),
});

/** Who is on the sheet? `null` if empty. */
function holderOf(vm) {
  const a = vm?.authorizedPerson || {};
  const name = S(a.name); const id = S(a.iqamaNumber).replace(/\s+/g, '');
  return (name || id) ? { name, idNumber: id, authorizationNumber: S(a.authorizationNumber), startDate: a.startDate || null, expiryDate: a.expiryDate || null } : null;
}

const empName = (e) => S(`${e?.firstName || ''} ${e?.lastName || ''}`) || S(e?.arabicName) || S(e?.fullName);
const empIds = (e) => [S(e?.iqamaNumber), S(e?.nationalId)].filter(Boolean);

/** Employee by ID number (both columns); the active HR file first. */
async function employeeByIdNumber(id) {
  const n = S(id);
  if (!n) return null;
  const { Employee } = M();
  const rows = await Employee.find({ $or: [{ iqamaNumber: n }, { nationalId: n }] })
    .select('firstName lastName arabicName iqamaNumber nationalId vehiclePlate isHrRecord employmentStatus').lean();
  if (!rows.length) return null;
  const rank = (e) => (e.isHrRecord !== false ? 2 : 0) + (e.employmentStatus !== 'terminated' ? 1 : 0);
  return rows.sort((a, b) => rank(b) - rank(a))[0];
}

/** Legacy-register vehicles that are this vehicle, by pointer first and then by plate. */
async function legacyVehiclesOf(vm) {
  const { Vehicle } = M();
  const key = orderlessPlateKey(vm.plateNumber);
  const all = await Vehicle.find({}).select('plateNumber master status currentEmployee currentAuthorization type').lean();
  return all.filter((x) => (x.master && String(x.master) === String(vm._id)) || (key && orderlessPlateKey(x.plateNumber) === key));
}

/** The registry vehicle (sheet) for a legacy vehicle, or null if it is not in the registry. */
async function masterOfLegacy(vehicle) {
  const { VehicleMaster } = M();
  if (!vehicle) return null;
  if (vehicle.master) {
    const vm = await VehicleMaster.findById(vehicle.master);
    if (vm) return vm;
  }
  const key = orderlessPlateKey(vehicle.plateNumber);
  if (!key) return null;
  const digits = key.split('|')[0];
  const cands = await VehicleMaster.find(digits ? { plateNumber: new RegExp(digits.split('').join('\\D*')) } : {})
    .select('_id plateNumber');
  const hit = cands.find((v) => orderlessPlateKey(v.plateNumber) === key);
  return hit ? VehicleMaster.findById(hit._id) : null;
}

/** Creates a legacy mirror for the vehicle when an assignment must be opened and none exists. */
async function ensureLegacyMirror(vm) {
  const { Vehicle } = M();
  const reg = S(vm.registrationTypeAr);
  const type = /دراج/.test(reg) ? 'motorcycle' : /نقل|شاحن/.test(reg) ? 'heavy_truck' : 'car';
  try {
    return (await Vehicle.create({
      plateNumber: vm.plateNumber, type, master: vm._id,
      department: S(vm.sectorAr), project: S(vm.departmentAr), status: 'available',
    })).toObject();
  } catch (e) {
    // Race with another writer on the same (unique) plate; read the existing one.
    const again = await legacyVehiclesOf(vm);
    if (again.length) return again[0];
    throw e;
  }
}

/** Makes the legacy vehicle's pointers match its single active assignment. */
async function syncPointers(vehicleId, masterId) {
  const { Vehicle, VehicleAuthorization } = M();
  const active = await VehicleAuthorization.findOne({ vehicle: vehicleId, status: 'active' }).sort({ createdAt: -1 });
  const cur = await Vehicle.findById(vehicleId).select('status').lean();
  const keepStatus = cur && ['maintenance', 'out_of_service'].includes(cur.status);
  const set = active
    ? { currentAuthorization: active._id, currentEmployee: active.employee, ...(keepStatus ? {} : { status: 'authorized' }) }
    : { ...(keepStatus ? {} : { status: cur?.status === 'authorized' ? 'parked' : (cur?.status || 'available') }) };
  if (masterId) set.master = masterId;
  await Vehicle.updateOne({ _id: vehicleId }, active ? { $set: set } : { $set: set, $unset: { currentAuthorization: 1, currentEmployee: 1 } });
}

/**
 * The assignment register follows the sheet.
 * @param vmOrId  registry vehicle (document or id)
 * @param opts.employee  the employee if known by something other than ID number (from the legacy path)
 * @param opts.meta      fields for the new assignment: authorizationType, issuedBy, notes @param opts.reason    closing reason when the sheet is emptied @param opts.userId    who acted @returns {{ changed, opened, closed, employees: string[], vehicles: string[], unlinkedHolder }}
 */
async function syncLegacyFromMaster(vmOrId, opts = {}) {
  const { VehicleMaster, VehicleAuthorization, Employee } = M();
  const vm = vmOrId && vmOrId.plateNumber ? vmOrId : await VehicleMaster.findById(vmOrId).lean();
  const out = { changed: false, opened: 0, closed: 0, updated: 0, employees: [], vehicles: [], unlinkedHolder: false };
  if (!vm) return out;
  const holder = holderOf(vm);
  const at = S(opts.at).slice(0, 10) || todayKey();
  const userId = opts.userId || null;

  let emp = opts.employee || null;
  if (emp && !emp._id) emp = await Employee.findById(emp).lean();
  if (!emp && holder?.idNumber) emp = await employeeByIdNumber(holder.idNumber);

  let legacy = await legacyVehiclesOf(vm);
  const legacyIds = legacy.map((x) => x._id);
  const actives = legacyIds.length
    ? await VehicleAuthorization.find({ vehicle: { $in: legacyIds }, status: 'active' })
      .populate('employee', 'firstName lastName arabicName iqamaNumber nationalId').sort({ createdAt: -1 })
    : [];

  // Which active assignment belongs to the sheet's holder? By employee if known, else by folded name (a sheet without an ID number written by the legacy path for an employee with no recorded residence).
  const isHolder = (a) => {
    if (!holder) return false;
    const e = a.employee || {};
    if (emp) return String(e._id || a.employee) === String(emp._id);
    if (holder.idNumber && empIds(e).includes(holder.idNumber)) return true;
    return !!holder.name && [fold(empName(e)), fold(e.arabicName)].includes(fold(holder.name));
  };
  const keep = actives.find(isHolder) || null;
  const touched = new Set();

  for (const a of actives) {
    if (keep && String(a._id) === String(keep._id)) continue;
    const prev = a.employee?._id || a.employee;
    a.status = holder && emp ? 'transferred' : 'revoked';
    a.endDate = at;
    a.endReason = a.status;
    if (a.status === 'transferred') a.transferredTo = emp._id;
    else {
      a.revokedReason = S(opts.reason) || (holder
        ? `نُقل التفويضُ إلى ${holder.name || holder.idNumber} في سجل المركبات`
        : 'أُلغي التفويض في سجل المركبات');
    }
    a.endedBy = userId || a.endedBy;
    a.depopulate?.('employee');
    await a.save();
    out.closed += 1; out.changed = true;
    if (prev) touched.add(String(prev));
  }

  if (keep) {
    // The sheet is the reference for its number and term too.
    const want = { documentNumber: holder.authorizationNumber, documentExpiry: ymd(holder.expiryDate) };
    const diff = Object.entries(want).filter(([k, v]) => v && S(keep[k]) !== v);
    if (diff.length) {
      for (const [k, v] of diff) keep[k] = v;
      keep.depopulate?.('employee');
      await keep.save();
      out.updated += 1; out.changed = true;
    }
  } else if (holder && emp) {
    if (!legacy.length) legacy = [await ensureLegacyMirror(vm)];
    const meta = opts.meta || {};
    await VehicleAuthorization.create({
      vehicle: legacy[0]._id, employee: emp._id, status: 'active',
      startDate: ymd(holder.startDate) || at,
      documentNumber: holder.authorizationNumber || undefined,
      documentExpiry: ymd(holder.expiryDate) || undefined,
      authorizationType: S(meta.authorizationType) || undefined,
      issuedBy: S(meta.issuedBy) || undefined,
      notes: S(meta.notes) || undefined,
      transferredFrom: actives[0]?.employee?._id || actives[0]?.employee || undefined,
      createdBy: userId || undefined,
    });
    out.opened += 1; out.changed = true;
  } else if (holder && !emp) {
    out.unlinkedHolder = true; // A sheet in the name of someone with no HR file
  }

  for (const v of legacy) { await syncPointers(v._id, vm._id); out.vehicles.push(String(v._id)); }

  // The plate snapshot on the employee file (`vehiclePlate`): one person may be authorized on two vehicles but there is one field. It used to take the plate of the last synced vehicle and flip between the two on every pass. It now holds all his plates, sorted.
  const key = orderlessPlateKey(vm.plateNumber);
  if (emp) {
    touched.add(String(emp._id));
    if (await refreshPlateSnapshot(emp)) out.changed = true;
  }
  const digits = (key || '').split('|')[0];
  if (digits) {
    const others = await Employee.find({ vehiclePlate: new RegExp(digits.split('').join('\\D*')) })
      .select('_id vehiclePlate iqamaNumber nationalId').lean();
    for (const o of others) {
      if (emp && String(o._id) === String(emp._id)) continue;
      if (!plateKeysOf(o.vehiclePlate).includes(key)) continue;
      if (await refreshPlateSnapshot(o)) { touched.add(String(o._id)); out.changed = true; }
    }
  }
  out.employees = [...touched];
  return out;
}

/** Clears everything the authorization is read from, then announces. Invalidation comes before the announcement, or the listener fetches stale state and the screen lags one change (see the announce-before-invalidate note). */
/** The field's plates: it may hold more than one, separated by a middle dot. */
const PLATE_SEP = ' · ';
const plateKeysOf = (txt) => S(txt).split(/\s*[·،,]\s*/).map(orderlessPlateKey).filter(Boolean);

/** The plates the employee currently holds in the vehicle registry, sorted. */
async function currentPlatesOf(emp) {
  const ids = empIds(emp);
  if (!ids.length) return [];
  const { VehicleMaster } = M();
  const rows = await VehicleMaster.find({ 'authorizedPerson.iqamaNumber': { $in: ids } }).select('plateNumber').lean();
  return [...new Set(rows.map((r) => S(r.plateNumber)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
}

/** Does the field match what he holds? As a set, not an order. */
async function plateSnapshotOk(emp) {
  const want = (await currentPlatesOf(emp)).map(orderlessPlateKey).sort();
  if (!want.length) return true; // No authorization: leave the field alone (it may say not required)
  const have = plateKeysOf(emp.vehiclePlate).sort();
  return want.length === have.length && want.every((k, i) => k === have[i]);
}

/** Writes his plates to the field if they differ, and clears it if it holds a plate he no longer has. */
async function refreshPlateSnapshot(emp) {
  const { Employee } = M();
  const plates = await currentPlatesOf(emp);
  if (plates.length) {
    if (await plateSnapshotOk(emp)) return false;
    await Employee.updateOne({ _id: emp._id }, { $set: { vehiclePlate: plates.join(PLATE_SEP) } });
    return true;
  }
  if (plateKeysOf(emp.vehiclePlate).length) {
    await Employee.updateOne({ _id: emp._id }, { $set: { vehiclePlate: '' } });
    return true;
  }
  return false;
}

// Clearing and announcing go through the shared door (utils/vehicleAnnounce), followed by the authorization and employee-file events.
function announce(result = {}) {
  const vs = result.vehicles || [];
  require('./vehicleAnnounce').announceVehicles({}, {
    events: [
      ...(vs.length ? vs.map((v) => ['vehicle:authorization', { vehicle: v }]) : [['vehicle:authorization', {}]]),
      ...(result.employees || []).map((e) => ['hr:employee', { id: e }]),
    ],
  });
}

/** After every write to the sheet (from model hooks). Never fails the write itself. */
async function afterMasterWrite(vmId, ctx = {}) {
  try {
    const r = await syncLegacyFromMaster(vmId, ctx);
    announce(r);
    return r;
  } catch (e) {
    console.error('[vehicle-auth] sync failed:', e.message);
    return null;
  }
}

/**
 * Writes the sheet's holder (or empties it), then makes the assignment register follow. For the legacy path and anyone who knows the employee by id.
 * @param holder  null to cancel, or { employee?, name?, idNumber?, jobTitleAr?, phone?, authorizationNumber?, startDate?, expiryDate? }
 * @param ctx     { userId, byName, reason, note, meta }
 */
async function setHolder(vmOrId, holder, ctx = {}) {
  const { VehicleMaster, Employee } = M();
  const vm = vmOrId && vmOrId.save ? vmOrId : await VehicleMaster.findById(vmOrId);
  if (!vm) throw Object.assign(new Error('المركبة غير موجودة في سجل المركبات'), { status: 404 });
  const before = holderOf(vm);
  let emp = null;
  if (holder) {
    if (holder.employee) emp = holder.employee._id ? holder.employee : await Employee.findById(holder.employee).lean();
    const ids = emp ? empIds(emp) : [];
    vm.authorizedPerson = {
      ...(vm.authorizedPerson?.toObject ? vm.authorizedPerson.toObject() : (vm.authorizedPerson || {})),
      // The HR name wins once the employee is known; see utils/personRef.
      name: (emp && require('./personRef').canonicalName(emp)) || S(holder.name) || empName(emp),
      iqamaNumber: S(holder.idNumber) || ids[0] || '',
      jobTitleAr: holder.jobTitleAr !== undefined ? S(holder.jobTitleAr) : S(vm.authorizedPerson?.jobTitleAr),
      phone: holder.phone !== undefined ? S(holder.phone) : S(vm.authorizedPerson?.phone),
      authorizationNumber: S(holder.authorizationNumber),
      startDate: holder.startDate || new Date(`${todayKey()}T00:00:00.000Z`),
      expiryDate: holder.expiryDate || null,
      statusCode: '',
    };
  } else {
    vm.authorizedPerson = { name: '', iqamaNumber: '', jobTitleAr: '', phone: '', authorizationNumber: '', startDate: null, expiryDate: null, statusCode: '' };
  }
  // An entry in the vehicle's log: who before whom, and through which path.
  if (ctx.note !== false) {
    vm.renewals = vm.renewals || [];
    vm.renewals.push({
      document: 'authorization',
      newExpiry: vm.authorizedPerson.expiryDate || new Date(),
      previousNumber: before?.name || '',
      newNumber: vm.authorizedPerson.name || '',
      note: S(ctx.note) || (holder ? 'فُوِّضت المركبة' : `أُلغي التفويض${S(ctx.reason) ? ` — ${S(ctx.reason)}` : ''}`),
      byName: S(ctx.byName), at: new Date(),
    });
  }
  vm.$locals.skipAuthSync = true; // The sync is called explicitly here, with the employee.
  await vm.save();
  const r = await syncLegacyFromMaster(vm.toObject(), { employee: emp, meta: ctx.meta, reason: ctx.reason, userId: ctx.userId });
  announce(r);
  return { vehicle: vm, ...r };
}

/**
 * What this employee holds now: the single answer for his file, his clearance and the driver cards.
 * From the sheet by ID number (then by folded name if no number matched), and from the legacy assignment only for a vehicle that has no sheet in the registry.
 */
async function currentFor(employeeOrId) {
  const { VehicleMaster, VehicleAuthorization, Employee } = M();
  const emp = employeeOrId && employeeOrId._id && (employeeOrId.firstName !== undefined || employeeOrId.iqamaNumber !== undefined)
    ? employeeOrId
    : await Employee.findById(employeeOrId).select('firstName lastName arabicName fullName iqamaNumber nationalId').lean();
  if (!emp) return [];
  const ids = empIds(emp);
  const SEL = 'plateNumber authorizedPerson registrationTypeAr registrationTypeCode sectorAr departmentAr ownerNameAr fuelCard.cardNumber';
  let regs = ids.length ? await VehicleMaster.find({ 'authorizedPerson.iqamaNumber': { $in: ids } }).select(SEL).lean() : [];
  if (!regs.length) {
    const names = [fold(empName(emp)), fold(emp.arabicName), fold(emp.fullName)].filter(Boolean);
    if (names.length) {
      const all = await VehicleMaster.find({ 'authorizedPerson.name': { $nin: ['', null] }, 'authorizedPerson.iqamaNumber': { $in: ['', null] } }).select(SEL).lean();
      regs = all.filter((v) => names.includes(fold(v.authorizedPerson?.name)));
    }
  }
  const out = regs.map((v) => ({
    source: 'registry',
    registryId: String(v._id),
    plateNumber: v.plateNumber,
    registrationTypeAr: v.registrationTypeAr || '',
    registrationTypeCode: v.registrationTypeCode || '',
    sectorAr: v.sectorAr || '', projectAr: v.departmentAr || '',
    authorizationNumber: S(v.authorizedPerson?.authorizationNumber),
    startDate: ymd(v.authorizedPerson?.startDate),
    expiryDate: ymd(v.authorizedPerson?.expiryDate),
  }));

  // Legacy assignment: read for a vehicle with no sheet; otherwise the sheet has spoken.
  const legacy = await VehicleAuthorization.find({ employee: emp._id, status: 'active' })
    .populate('vehicle', 'plateNumber type department project master').lean();
  if (legacy.length) {
    const regKeys = new Set((await VehicleMaster.find({}).select('plateNumber').lean()).map((v) => orderlessPlateKey(v.plateNumber)));
    for (const a of legacy) {
      const v = a.vehicle || {};
      if (v.master || regKeys.has(orderlessPlateKey(v.plateNumber))) continue;
      out.push({
        source: 'legacy', legacyVehicleId: String(v._id || ''), authorizationId: String(a._id),
        plateNumber: v.plateNumber || '', registrationTypeAr: v.department || v.type || '', registrationTypeCode: '',
        sectorAr: v.department || '', projectAr: v.project || '',
        authorizationNumber: S(a.documentNumber), startDate: S(a.startDate), expiryDate: S(a.documentExpiry),
      });
    }
  }
  return out;
}

/** Does the sheet have a say on this legacy vehicle? A set of registry plate keys. */
async function registryPlateKeys() {
  const { VehicleMaster } = M();
  return new Set((await VehicleMaster.find({}).select('plateNumber').lean()).map((v) => orderlessPlateKey(v.plateNumber)));
}

module.exports = {
  holderOf, employeeByIdNumber, legacyVehiclesOf, masterOfLegacy, syncLegacyFromMaster,
  syncPointers, announce, afterMasterWrite, setHolder, currentFor, registryPlateKeys, fold, empName, ymd,
  plateSnapshotOk, refreshPlateSnapshot, currentPlatesOf, plateKeysOf,
};
