/**
 * Search by who and what belongs to the shipment, not by what is written on its row.
 * A shipment (order or operations statement) carries a snapshot of the driver's name, phone and plate, but not the driver's residence number or the truck chassis. Residence lives in the owners' registers (shipment-order drivers, fleet drivers, the employee file) and chassis and serial in the vehicle registry.
 * So a number is first translated to its owners (name, phone, plate) and then shipments are matched on those; this is why a residence number returns all shipments of that driver.
 * Called for numbers only (six digits or more): names are searched on the shipment directly, and a short number matches in every register.
 */
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Last nine digits, so "+966 50..." and "050..." are one phone. */
const phoneTail = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 7 ? d.slice(-9) : '';
};

/**
 * @param {string} bare Digits only.
 * @returns {Promise<{ names: string[], phones: string[], plates: string[] }>}
 */
async function relatedByNumber(bare) {
  const out = { names: new Set(), phones: new Set(), plates: new Set() };
  if (!bare || bare.length < 6) return { names: [], phones: [], plates: [] };
  const rx = new RegExp(esc(bare));
  const tail = phoneTail(bare);
  const tailRx = tail ? new RegExp(`${esc(tail)}$`) : null;
  const add = (name, phone) => {
    if (String(name || '').trim()) out.names.add(String(name).trim());
    const t = phoneTail(phone);
    if (t) out.phones.add(t);
  };

  const safe = (p) => p.catch(() => []);
  const ShipmentOrderDriver = require('../models/ShipmentOrderDriver');
  const { FleetDriver } = require('../models/FleetModels');
  const Employee = require('../models/Employee');
  const { VehicleMaster } = require('../models/VehicleMaster');

  const [soDrivers, fleetDrivers, employees, vehicles] = await Promise.all([
    safe(ShipmentOrderDriver.find({ $or: [
      { residenceNumber: rx }, { driverCardNumber: rx },
      ...(tailRx ? [{ phone: tailRx }] : []),
    ] }).select('name phone').limit(30).lean()),
    safe(FleetDriver.find({ $or: [{ iqama: rx }, ...(tailRx ? [{ phone: tailRx }] : [])] })
      .select('name phone').limit(30).lean()),
    safe(Employee.find({ $or: [
      { iqamaNumber: rx }, { nationalId: rx }, { passportNumber: rx }, { employeeNumber: bare },
      ...(tailRx ? [{ phone: tailRx }] : []),
    ] }).select('firstName lastName phone').limit(30).lean()),
    // Chassis and serial number in the vehicle registry map to its plate.
    safe(VehicleMaster.find({ $or: [{ chassisNumber: rx }, { serialNumber: rx }] })
      .select('plateNumber').limit(30).lean()),
  ]);

  soDrivers.forEach((d) => add(d.name, d.phone));
  fleetDrivers.forEach((d) => add(d.name, d.phone));
  employees.forEach((e) => add(`${e.firstName || ''} ${e.lastName || ''}`.trim(), e.phone));
  vehicles.forEach((v) => { if (String(v.plateNumber || '').trim()) out.plates.add(String(v.plateNumber).trim()); });

  return { names: [...out.names], phones: [...out.phones], plates: [...out.plates] };
}

/**
 * `$or` conditions that match a shipment through the number's owners.
 * @param {string} bare
 * @param {{ name: string[], phone: string[], plate: string[] }} fields The shipment's fields for each kind.
 */
async function relatedClauses(bare, fields) {
  const r = await relatedByNumber(bare);
  const { plateDigitsRegex } = module.exports;
  const or = [];
  // The name must match entirely (case and extra spaces ignored), not as a substring, so a common first name does not pull in every person with it.
  for (const n of r.names) {
    const nameRx = new RegExp(`^\\s*${esc(n).replace(/\s+/g, '\\s+')}\\s*$`, 'i');
    fields.name.forEach((f) => or.push({ [f]: nameRx }));
  }
  for (const t of r.phones) fields.phone.forEach((f) => or.push({ [f]: new RegExp(`${esc(t)}$`) }));
  for (const p of r.plates) {
    const prx = plateDigitsRegex(p);
    if (prx) fields.plate.forEach((f) => or.push({ [f]: prx }));
  }
  return or;
}

/** Plate digits alone, bounded so that "1082" does not match "21082". */
const plateDigitsRegex = (plate) => {
  const d = String(plate || '').replace(/\D/g, '');
  return d.length >= 3 ? new RegExp(`(^|\\D)${d}(\\D|$)`) : null;
};

module.exports = { relatedByNumber, relatedClauses, plateDigitsRegex, phoneTail };
