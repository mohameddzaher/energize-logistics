/**
 * A driver card is one record, in the vehicles section; its snapshot on the employee file follows it.
 * Sync used to run on one path under one condition, so cards renewed in vehicles stayed expired in HR. Now it is two-way and called from every writing path: `pushCardToEmployee` / `clearEmployeeCard` (vehicles to HR) and `pushEmployeeToCard` (HR to vehicles, written to the registry and read back).
 * Linking is by id if present, otherwise by ID number in both columns (`iqamaNumber` for residents, `nationalId` for Saudis); the id is saved once known.
 */
const CARD_FIELDS_ON_EMPLOYEE = ['driverCardNumber', 'driverCardType', 'driverCardExpiry'];

const clean = (v) => String(v ?? '').trim();

// Invalidate before announce: the event used to be sent and then the cache cleared, so the fastest listener fetched the old list and stayed one change behind.
function emitAll() {
  require('./vehicleAnnounce').announceVehicles({}, { events: ['hr:master', 'hr:employee'] });
}

// Vehicles side only, when the controller (HR) announces its own side. HR's card write was called with `emit: false`, so the driver cards page did not know until reopened.
function emitVehicles() {
  require('./vehicleAnnounce').announceVehicles({});
}

async function employeeOfCard(card) {
  const Employee = require('../models/Employee');
  if (card.employee) {
    const e = await Employee.findById(card.employee);
    if (e) return e;
  }
  const id = clean(card.idNumber);
  if (!id) return null;
  return Employee.findOne({ isHrRecord: { $ne: false }, $or: [{ iqamaNumber: id }, { nationalId: id }] });
}

/** A Riyadh-time date 'YYYY-MM-DD'; a string is left as is. */
const ymdRiyadh = (v) => {
  if (v instanceof Date) return isNaN(v) ? '' : v.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  return clean(v);
};

/** Vehicles to HR. */
async function pushCardToEmployee(card, { emit = true } = {}) {
  if (!card) return null;
  const emp = await employeeOfCard(card);
  if (!emp) return null;
  const DriverCard = require('../models/DriverCard');
  if (!card.employee) await DriverCard.updateOne({ _id: card._id }, { $set: { employee: emp._id } });
  // A record with no number and no date (a listed driver whose card is not issued yet) writes nothing: it has nothing new, and writing it would erase a decision on the file such as 'not required'.
  if (!clean(card.cardNumber) && !clean(card.expiryDate)) return null;
  const set = {
    driverCardNumber: clean(card.cardNumber),
    driverCardType: clean(card.cardType),
    // The card date is a Date object while the file field is a 'YYYY-MM-DD' string. `String(date)` used to be written ('Sat Oct 24 2026 03:00:00 GMT+0300...'), which the expiries page reads but the dashboard counters cannot, so the two numbers differed by one.
    driverCardExpiry: ymdRiyadh(card.expiryDate),
  };
  const same = CARD_FIELDS_ON_EMPLOYEE.every((k) => ymdRiyadh(emp[k]) === set[k]);
  // A card that exists in the registry is neither 'not required' nor 'required': it is available. Flags are stored per field by name (`driverCardExpiryStatus` ...); see hrFields.statusKeyOf. 'Not required' was sometimes written into the number field itself.
  const STATUS_KEYS = ['driverCardNumberStatus', 'driverCardExpiryStatus', 'driverCardStatusStatus'];
  const fs = emp.fieldStatus || new Map();
  const get = (k) => (typeof fs.get === 'function' ? fs.get(k) : fs[k]);
  const hasCard = !!clean(card.cardNumber);
  const staleStatus = hasCard && STATUS_KEYS.some((k) => get(k));
  // Existing vocabulary on the file: the 'exists' and 'does not exist' words.
  if (hasCard) set.driverCardStatus = 'يوجد';
  const sameStatus = !hasCard || clean(emp.driverCardStatus) === 'يوجد';
  if (same && sameStatus && !staleStatus) return null;
  const update = { $set: set };
  if (staleStatus) update.$unset = Object.fromEntries(STATUS_KEYS.map((k) => [`fieldStatus.${k}`, 1]));
  const Employee = require('../models/Employee');
  await Employee.updateOne({ _id: emp._id }, update);
  if (emit) emitAll();
  return { employee: emp._id, set };
}

/** The card was deleted from the registry, so its snapshot is cleared from the file. */
async function clearEmployeeCard(card, { emit = true } = {}) {
  if (!card) return null;
  const emp = await employeeOfCard(card);
  if (!emp) return null;
  const Employee = require('../models/Employee');
  await Employee.updateOne({ _id: emp._id }, { $set: { driverCardNumber: '', driverCardType: '', driverCardExpiry: '' } });
  if (emit) emitAll();
  return { employee: emp._id };
}

/** HR to vehicles. `emp` is after save. The card is written to the registry (or created if it has a number and no record) and its snapshot returns from there. */
async function pushEmployeeToCard(emp, { userId = null, emit = true } = {}) {
  if (!emp) return null;
  const DriverCard = require('../models/DriverCard');
  const idNumber = clean(emp.idType === 'national_id' ? (emp.nationalId || emp.iqamaNumber) : (emp.iqamaNumber || emp.nationalId));
  let card = await DriverCard.findOne({ employee: emp._id });
  if (!card && idNumber) card = await DriverCard.findOne({ idNumber });
  const toStr = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : clean(v));
  const want = {
    cardNumber: toStr(emp.driverCardNumber),
    cardType: toStr(emp.driverCardType),
    expiryDate: toStr(emp.driverCardExpiry),
  };
  // Administrative words ('required', 'not required', 'does not exist') are sometimes typed into the fields: they are neither a date nor a card number, so they create no card and are not written to the registry.
  if (want.expiryDate && !/^\d{4}-\d{2}-\d{2}/.test(want.expiryDate)) want.expiryDate = '';
  if (want.cardNumber && !/\d/.test(want.cardNumber)) want.cardNumber = '';
  if (!card) {
    if (!want.cardNumber || !idNumber) return null;
    card = await DriverCard.create({
      idNumber, employee: emp._id, name: emp.arabicName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
      ...want, createdBy: userId || undefined,
    });
  } else {
    // Empty does not erase the registry: a field cleared in HR (or given a word) does not delete an existing card number in vehicles; deletion happens there.
    const real = Object.fromEntries(Object.entries(want).filter(([, v]) => v));
    const changed = Object.keys(real).some((k) => clean(card[k]) !== real[k]);
    if (!changed && String(card.employee || '') === String(emp._id)) return null;
    card.set({ ...real, employee: emp._id, lastModifiedBy: userId || card.lastModifiedBy });
    await card.save();
  }
  // Then the file snapshot returns from the registry, so both sides hold one value.
  await pushCardToEmployee(card, { emit: false });
  if (emit) emitAll(); else emitVehicles();
  return { card: card._id };
}

module.exports = { pushCardToEmployee, clearEmployeeCard, pushEmployeeToCard, CARD_FIELDS_ON_EMPLOYEE };
