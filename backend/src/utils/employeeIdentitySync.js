/**
 * Correcting an employee's ID number in HR reaches everything that identifies him by it.
 * Outside HR an employee is known by ID number, not id: the vehicle authorization sheet `VehicleMaster.authorizedPerson.iqamaNumber`, the actual driver `VehicleMaster.actualDriver.idNumber`, the driver card `DriverCard.idNumber`, and his light-transport row `LightTransportEmployee.idNumber`.
 * If the number is corrected on his file alone, the link breaks silently: his authorization disappears from his file and clearance, and the vehicle stays tied to a number matching nobody.
 * The old number is replaced by the new one wherever found; writing to the sheet goes through the model hook so the assignment log follows (utils/vehicleAuthorization).
 */
const S = (v) => String(v == null ? '' : v).trim();

async function pushIdChange(emp, beforeIds, nowIds) {
  const gone = beforeIds.map(S).filter((x) => x && !nowIds.map(S).includes(x));
  const next = S(emp.idType === 'national_id' ? (emp.nationalId || emp.iqamaNumber) : (emp.iqamaNumber || emp.nationalId));
  if (!gone.length || !next) return { changed: 0 };
  const { VehicleMaster } = require('../models/VehicleMaster');
  const DriverCard = require('../models/DriverCard');
  let changed = 0;

  const a = await VehicleMaster.updateMany({ 'authorizedPerson.iqamaNumber': { $in: gone } }, { $set: { 'authorizedPerson.iqamaNumber': next } });
  const d = await VehicleMaster.updateMany({ 'actualDriver.idNumber': { $in: gone } }, { $set: { 'actualDriver.idNumber': next } });
  changed += (a.modifiedCount || 0) + (d.modifiedCount || 0);

  // The card is unique by ID number: the new number is not written over an existing card that has it.
  if (!(await DriverCard.exists({ idNumber: next }))) {
    const c = await DriverCard.updateMany({ idNumber: { $in: gone } }, { $set: { idNumber: next, employee: emp._id } });
    changed += c.modifiedCount || 0;
  }
  try {
    const { LightTransportEmployee } = require('../models/LightTransport');
    if (!(await LightTransportEmployee.exists({ idNumber: next }))) {
      const l = await LightTransportEmployee.updateMany({ employee: emp._id, idNumber: { $in: gone } }, { $set: { idNumber: next } });
      changed += l.modifiedCount || 0;
    }
  } catch (_) { /* */ }

  if (changed) {
    require('./vehicleAnnounce').announceVehicles({}, { events: [['hr:employee', { id: String(emp._id) }]] });
  }
  return { changed };
}

/**
 * Person data: HR wins. Name, phone and nationality had been copied to rows in other sections and drifted from the file, so every save touching them writes the copies:
 * `LightTransportEmployee` (name, phone, nationality; department-owned job and project untouched) plus the rider and order name snapshots, `DriverCard.name`, `VehicleMaster.authorizedPerson`, `VehicleMaster.actualDriver.name`.
 * Linking is by ID number (both columns) or id; empty on the file does not erase a copy. Vehicle writes skip `timestamps` and `skipAuthSync` since the holder is unchanged.
 */
const PERSON_FIELDS = ['firstName', 'lastName', 'arabicName', 'phone', 'nationality', 'project', 'department', 'employmentStatus'];
const COPIED_FIELDS = ['firstName', 'lastName', 'arabicName', 'phone', 'nationality'];

function announcePerson(emp) {
  require('./vehicleAnnounce').announceVehicles({}, { events: [['hr:employee', { id: String(emp._id) }]] });
}

/**
 * Writes the person's data from his file into its copies. `opts.emit=false` for scripts.
 * @returns {{ lt, ltRiders, ltOrders, cards, authorized, actual }} count changed in each copy
 */
async function pushPersonChange(emp, { emit = true, fields = PERSON_FIELDS } = {}) {
  const out = { lt: 0, ltRiders: 0, ltOrders: 0, cards: 0, authorized: 0, actual: 0 };
  if (!emp || !emp._id) return out;
  const P = require('./personRef');
  const ids = P.idsOf(emp);
  const name = P.canonicalName(emp);
  const phone = S(emp.phone);
  const nat = S(emp.nationality);
  const copies = fields.some((f) => COPIED_FIELDS.includes(f));

  if (copies && (ids.length || emp._id)) {
    try {
      const { LightTransportEmployee, LightTransportOrder } = require('../models/LightTransport');
      const rows = await LightTransportEmployee.find({ $or: [{ employee: emp._id }, ...(ids.length ? [{ idNumber: { $in: ids } }] : [])] })
        .select('_id name phone nationalityAr').lean();
      const ops = [];
      const renamed = [];
      for (const r of rows) {
        const $set = {};
        if (name && S(r.name) !== name) { $set.name = name; renamed.push(r._id); }
        if (phone && S(r.phone) !== phone) $set.phone = phone;
        if (nat && S(r.nationalityAr) !== nat) $set.nationalityAr = nat;
        if (Object.keys($set).length) ops.push({ updateOne: { filter: { _id: r._id }, update: { $set } } });
      }
      if (ops.length) out.lt = (await LightTransportEmployee.bulkWrite(ops, { ordered: false })).modifiedCount || ops.length;
      if (name && rows.length) {
        const ltIds = rows.map((r) => r._id);
        const { VehicleMaster } = require('../models/VehicleMaster');
        out.ltRiders = (await VehicleMaster.updateMany({ 'b2cRider.lt': { $in: ltIds }, 'b2cRider.name': { $ne: name } },
          { $set: { 'b2cRider.name': name } }, { timestamps: false, skipAuthSync: true })).modifiedCount || 0;
        out.ltOrders = (await LightTransportOrder.updateMany({ ltEmployee: { $in: ltIds }, status: { $in: ['active', 'hold'] }, employeeName: { $ne: name } },
          { $set: { employeeName: name } })).modifiedCount || 0;
      }
    } catch (e) { console.error('person → light transport:', e.message); }

    if (name) {
      try {
        const DriverCard = require('../models/DriverCard');
        out.cards = (await DriverCard.updateMany({ $or: [{ employee: emp._id }, ...(ids.length ? [{ idNumber: { $in: ids } }] : [])], name: { $ne: name } },
          { $set: { name } })).modifiedCount || 0;
      } catch (e) { console.error('person → driver card:', e.message); }
    }

    if (ids.length) {
      try {
        const { VehicleMaster } = require('../models/VehicleMaster');
        const opt = { timestamps: false, skipAuthSync: true };
        if (name) {
          out.authorized += (await VehicleMaster.updateMany({ 'authorizedPerson.iqamaNumber': { $in: ids }, 'authorizedPerson.name': { $ne: name } },
            { $set: { 'authorizedPerson.name': name } }, opt)).modifiedCount || 0;
          out.actual = (await VehicleMaster.updateMany({ 'actualDriver.idNumber': { $in: ids }, 'actualDriver.name': { $ne: name } },
            { $set: { 'actualDriver.name': name } }, opt)).modifiedCount || 0;
        }
        if (phone) {
          out.authorized += (await VehicleMaster.updateMany({ 'authorizedPerson.iqamaNumber': { $in: ids }, 'authorizedPerson.phone': { $ne: phone } },
            { $set: { 'authorizedPerson.phone': phone } }, opt)).modifiedCount || 0;
        }
      } catch (e) { console.error('person → vehicles:', e.message); }
    }
  }
  if (emit) announcePerson(emp);
  return out;
}

/** Which person fields changed between two snapshots? */
const personSnapshot = (doc) => Object.fromEntries(PERSON_FIELDS.map((k) => [k, S(doc?.[k])]));
const changedPersonFields = (before, now) => PERSON_FIELDS.filter((k) => S(before?.[k]) !== S(now?.[k]));

module.exports = { pushIdChange, pushPersonChange, PERSON_FIELDS, COPIED_FIELDS, personSnapshot, changedPersonFields, announcePerson };
