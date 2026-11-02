/**
 * vehicleRef: which vehicle in the vehicle registry is this, whichever section asks.
 * A vehicle is one record (VehicleMaster) and every section holds a reference to it, not a copy (owner: a vehicle is linked to what it needs in any section, even one added later). This is the single linking door: an Arabic or Latin plate to the vehicle id, via the unified key (utils/plateKey canonicalPlateKey).
 * New section checklist:
 * 1) Store the vehicle reference (`vehicle`/`vehicleMaster: ObjectId`) resolved from here on create (`resolve`), and the person reference (`employee: ObjectId`) from utils/personRef. 2) Show identity and documents from the registry itself, and the name from the HR file (`personRef.displayName`), not from a local copy. 3) If a snapshot (plate or name) is needed for history or search, add it to `pushVehicleChange` here or `employeeIdentitySync.pushPersonChange` so it follows the source. 4) Listen to `vreg:updated` and `hr:employee` and refetch.
 */
const { canonicalPlateKey } = require('./plateKey');

/** Registry vehicle id for a plate, or null. Returns the document if fields are requested. */
async function resolve(plate, select = '_id') {
  const key = canonicalPlateKey(plate);
  if (!key) return null;
  const { VehicleMaster } = require('../models/VehicleMaster');
  return VehicleMaster.findOne({ canonKey: key }).select(select).lean();
}

/** Batch resolution: Map from unified key to vehicle. */
async function resolveMany(plates, select = '_id plateNumber canonKey') {
  const keys = [...new Set((plates || []).map(canonicalPlateKey).filter(Boolean))];
  if (!keys.length) return new Map();
  const { VehicleMaster } = require('../models/VehicleMaster');
  const rows = await VehicleMaster.find({ canonKey: { $in: keys } }).select(select).lean();
  return new Map(rows.map((r) => [r.canonKey, r]));
}

/**
 * A plate or registration-type change in the registry reaches its copies.
 * A plate corrected in the registry used to stay old in the light-transport row, the active operating order, the accident and the employee-file snapshot, so searching the new one found nothing. Called from models/VehicleMaster hooks after any write touching `plateNumber` or `registrationTypeAr`.
 * The vehicle type on a light-transport row is the section's list (motorbike, van, Kia), not the registration type (motorised bike, public transport, private), so it is overwritten only when it is a literal copy of the old value. An operating order carries the registration type itself.
 * @param before  { plateNumber, registrationTypeAr } before the write
 */
async function pushVehicleChange(id, before = {}, { emit = true } = {}) {
  const S = (v) => String(v == null ? '' : v).trim();
  const out = { lt: 0, orders: 0, claims: 0, employees: [] };
  const { VehicleMaster } = require('../models/VehicleMaster');
  const vm = await VehicleMaster.findById(id).select('plateNumber plateKey registrationTypeAr authorizedPerson').lean();
  if (!vm) return out;
  const plate = S(vm.plateNumber);
  const type = S(vm.registrationTypeAr);
  const plateChanged = before.plateNumber !== undefined && S(before.plateNumber) !== plate;
  const typeChanged = before.registrationTypeAr !== undefined && S(before.registrationTypeAr) !== type;
  if (!plateChanged && !typeChanged) return out;
  const { LightTransportEmployee, LightTransportOrder } = require('../models/LightTransport');
  const LIVE = { $in: ['active', 'hold'] };

  if (plateChanged && plate) {
    out.lt += (await LightTransportEmployee.updateMany({ vehicle: vm._id, vehiclePlate: { $ne: plate } }, { $set: { vehiclePlate: plate } })).modifiedCount || 0;
    out.orders += (await LightTransportOrder.updateMany({ vehicle: vm._id, status: LIVE, vehiclePlate: { $ne: plate } }, { $set: { vehiclePlate: plate } })).modifiedCount || 0;
    // Accidents: those linked by reference, and unlinked ones carrying the old plate key.
    const { registryPlateKey } = require('./plateKey');
    const oldKey = registryPlateKey(before.plateNumber);
    const VehicleClaim = require('../models/VehicleClaim');
    const r = await VehicleClaim.updateMany(
      { $or: [{ vehicle: vm._id }, ...(oldKey ? [{ vehicle: null, vehiclePlateKey: oldKey }] : [])] },
      { $set: { vehicle: vm._id, vehiclePlate: plate, vehiclePlateKey: vm.plateKey || registryPlateKey(plate) || '' } },
    );
    out.claims = r.modifiedCount || 0;
    if (out.claims && vm.plateKey) {
      const n = await VehicleClaim.countDocuments({ vehiclePlateKey: vm.plateKey, isActive: true });
      await VehicleMaster.updateMany({ plateKey: vm.plateKey }, { $set: { accidentCount: n } }, { timestamps: false });
    }
    // The plate snapshot on the employee file: the sheet's holder, and anyone whose snapshot carries the old plate.
    try {
      const VA = require('./vehicleAuthorization');
      const Employee = require('../models/Employee');
      const { orderlessPlateKey } = require('./plateKey');
      const seen = new Set();
      const holder = await VA.employeeByIdNumber(vm.authorizedPerson?.iqamaNumber);
      const cands = holder ? [holder] : [];
      const oldOrderless = orderlessPlateKey(before.plateNumber);
      const digits = (oldOrderless || '').split('|')[0];
      if (digits) {
        const rows = await Employee.find({ vehiclePlate: new RegExp(digits.split('').join('\\D*')) })
          .select('_id vehiclePlate iqamaNumber nationalId').lean();
        cands.push(...rows.filter((e) => VA.plateKeysOf(e.vehiclePlate).includes(oldOrderless)));
      }
      for (const e of cands) {
        if (seen.has(String(e._id))) continue;
        seen.add(String(e._id));
        if (await VA.refreshPlateSnapshot(e)) out.employees.push(String(e._id)); // eslint-disable-line no-await-in-loop
      }
    } catch (e) { console.error('[vehicle-ref] plate snapshot:', e.message); }
  }

  if (typeChanged && type) {
    const was = S(before.registrationTypeAr);
    out.orders += (await LightTransportOrder.updateMany({ vehicle: vm._id, status: LIVE, vehicleTypeAr: was }, { $set: { vehicleTypeAr: type } })).modifiedCount || 0;
    if (was) out.lt += (await LightTransportEmployee.updateMany({ vehicle: vm._id, vehicleTypeAr: was }, { $set: { vehicleTypeAr: type } })).modifiedCount || 0;
  }

  if (emit) {
    // Shared door: clears everything that carries the vehicle, then announces (utils/vehicleAnnounce).
    require('./vehicleAnnounce').announceVehicles({ vehicle: String(vm._id) }, {
      events: out.employees.map((e) => ['hr:employee', { id: e }]),
    });
  }
  return out;
}

module.exports = { resolve, resolveMany, canonicalPlateKey, pushVehicleChange };
