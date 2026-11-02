/**
 * ls2VehicleLink: a Location Solutions truck is the registry vehicle itself, not a copy.
 * Rule: one record per vehicle across the system, edits show in every section at once. The Wialon mirror (`Ls2Vehicle`) held plate, make, year and chassis number as unlinked text and disagreed with the vehicle registry in 22 model years and 18 chassis numbers, with no way to tell which was right.
 * So only the link is stored here:
 * `Ls2Vehicle.vehicleMaster`: from its plate by the unified key (Arabic or Latin).   `Ls2Flatbed.vehicleMaster`: from its truck. If the plate has letters, by the unified key; if digits only ("2708"), from the Location Solutions unit carrying the same digits, never by digits in the registry ("1080" is a motorbike there and a trailer here; see utils/plateKey).   For text stored in the store and custody: `resolveLs2Plate` with the same rule. Identity is read from the registry at display time (`attachRegistry`); what the device says stays beside it as "per device", and a conflict raises the flag.
 */
const Ls2Vehicle = require('../models/Ls2Vehicle');
const Ls2Flatbed = require('../models/Ls2Flatbed');
const { canonicalPlateKey, vehiclePlateKey, plateKey } = require('../utils/plateKey');

const VM = () => require('../models/VehicleMaster').VehicleMaster;

/** Whether the unified key has letters. "2708|" has none, so it is not matched in the registry. */
const hasLetters = (k) => !!k && !k.endsWith('|');

/** A Location Solutions unit's plate as read for linking: `plate`, then the file's registration plate, then the name. The name ("3450 JTA <driver name>") includes the driver's name whose Arabic letters corrupt the key, so only the digits and adjoining Latin letters are taken. */
function unitPlate(v) {
  if (!v) return '';
  const p = String(v.plate || v.profile?.registrationPlate || '').trim();
  if (p) return p;
  const m = String(v.name || '').match(/\d{1,4}\s*[A-Za-z]{2,3}\b|[A-Za-z]{2,3}\s*\d{1,4}/);
  return m ? m[0] : '';
}
const unitCanonKey = (v) => canonicalPlateKey(unitPlate(v));

async function registryByKeys(keys) {
  const list = [...new Set(keys.filter(hasLetters))];
  if (!list.length) return new Map();
  const rows = await VM().find({ canonKey: { $in: list } }).select('_id canonKey').lean();
  return new Map(rows.map((r) => [r.canonKey, r._id]));
}

/** Links every unit and flatbed to its registry vehicle. Writes only what changed and returns the counts. `apply=false` is a dry run (for the completion script). */
async function linkLs2Fleet({ apply = true } = {}) {
  const [units, flatbeds] = await Promise.all([
    Ls2Vehicle.find({}).select('unitId name plate profile.registrationPlate vehicleMaster').lean(),
    Ls2Flatbed.find({}).select('plate plateKey vehicleMaster').lean(),
  ]);
  const unitKeys = units.map(unitCanonKey);
  const flatKeys = flatbeds.map((f) => canonicalPlateKey(f.plate));
  const byKey = await registryByKeys([...unitKeys, ...flatKeys]);

  const out = { units: units.length, unitsLinked: 0, unitsChanged: 0, unitsUnlinked: [], flatbeds: flatbeds.length, flatbedsLinked: 0, flatbedsChanged: 0, flatbedsUnlinked: [], unitMap: new Map() };
  const unitOps = [];
  const vmByDigits = new Map(); // Unit digits -> its vehicle (for flatbeds without letters)
  units.forEach((u, i) => {
    const id = byKey.get(unitKeys[i]) || null;
    if (id) { out.unitsLinked += 1; vmByDigits.set(vehiclePlateKey(u), id); out.unitMap.set(u.unitId, id); } else out.unitsUnlinked.push(unitPlate(u) || u.name || String(u.unitId));
    if (String(u.vehicleMaster || '') !== String(id || '')) {
      out.unitsChanged += 1;
      unitOps.push({ updateOne: { filter: { _id: u._id }, update: { $set: { vehicleMaster: id } } } });
    }
  });
  const flatOps = [];
  flatbeds.forEach((f, i) => {
    const k = flatKeys[i];
    const id = (hasLetters(k) ? byKey.get(k) : vmByDigits.get(f.plateKey || plateKey(f.plate))) || null;
    if (id) out.flatbedsLinked += 1; else out.flatbedsUnlinked.push(f.plate);
    if (String(f.vehicleMaster || '') !== String(id || '')) {
      out.flatbedsChanged += 1;
      flatOps.push({ updateOne: { filter: { _id: f._id }, update: { $set: { vehicleMaster: id } } } });
    }
  });
  if (apply) {
    // No timestamps: linking is not an edit of the truck.
    if (unitOps.length) await Ls2Vehicle.bulkWrite(unitOps, { ordered: false, timestamps: false });
    if (flatOps.length) await Ls2Flatbed.bulkWrite(flatOps, { ordered: false, timestamps: false });
  }
  return out;
}

/** A plate written as text in Heavy Transport (store movement, custody entry) -> its vehicle. With letters: the registry by the unified key. With digits only: the Location Solutions unit carrying them (our heavy fleet is unique by digits), then its vehicle. Otherwise null, and the text stays as written. */
async function resolveLs2Plate(plate, opts = {}) {
  const raw = String(plate || '').trim();
  if (!raw) return null;
  return (await resolveLs2Plates([raw], opts)).get(raw) || null;
}

/** Digits of every fleet unit -> its registry vehicle, computed from the unit's plate by the unified key and not from the stored field, so it is right before and after completion. */
async function fleetByDigits() {
  const units = await Ls2Vehicle.find({}).select('plate name profile.registrationPlate').lean();
  const keys = units.map(unitCanonKey);
  const byKey = await registryByKeys(keys);
  const m = new Map();
  units.forEach((u, i) => { const id = byKey.get(keys[i]); if (id) m.set(vehiclePlateKey(u), id); });
  return m;
}

/** Resolves many plates in one pass: Map from the text as written to the id or null. */
async function resolveLs2Plates(plates, { heavy = true } = {}) {
  const list = [...new Set((plates || []).map((p) => String(p || '').trim()).filter(Boolean))];
  const out = new Map();
  if (!list.length) return out;
  const keys = list.map(canonicalPlateKey);
  const byKey = await registryByKeys(keys);
  let byDigits = null;
  for (let i = 0; i < list.length; i += 1) {
    let id = hasLetters(keys[i]) ? byKey.get(keys[i]) || null : null;
    // Digits alone only when the text is digits and nothing else ("2708"): text containing a number ("workshop car/ 6939", "invoice 11020") is not a plate and is not guessed.
    if (!id && heavy && /^\s*[0-9٠-٩]+\s*$/.test(list[i])) {
      const d = plateKey(list[i]);
      if (d) {
        // eslint-disable-next-line no-await-in-loop
        if (!byDigits) byDigits = await fleetByDigits();
        id = byDigits.get(d) || null;
      }
    }
    out.set(list[i], id);
  }
  return out;
}

// Identity from the registry at display time

const REG_SELECT = 'plateNumber brandAr modelAr modelYear chassisNumber sectorAr sectorCode serviceStatusAr '
  + 'vehicleLicense.expiryDate vehicleLicense.statusCode inspection.expiryDate inspection.statusCode '
  + 'insurance.expiryDate insurance.statusCode operatingCard.expiryDate operatingCard.statusCode '
  + 'authorizedPerson.name authorizedPerson.expiryDate authorizedPerson.statusCode';
const REG_DOCS = ['vehicleLicense', 'inspection', 'insurance', 'operatingCard', 'authorization'];

const normVin = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** What the device says vs. what the registry says. Empty is not a conflict (missing, not disagreeing). A device chassis number that is the tail of the registry number ("546250") is partial, not conflicting. */
function compareIdentity(profile, reg) {
  const out = {};
  const dYear = String(profile?.modelYear || '').trim();
  const rYear = reg?.modelYear != null ? String(reg.modelYear) : '';
  if (dYear && rYear && dYear !== rYear) out.year = { registry: rYear, device: dYear };
  const dVin = normVin(profile?.vin);
  const rVin = normVin(reg?.chassisNumber);
  if (dVin && rVin && dVin !== rVin) {
    out.vin = { registry: reg.chassisNumber, device: profile.vin, partial: rVin.endsWith(dVin) || dVin.endsWith(rVin) };
  }
  return out;
}

let alertsCache = { at: 0, v: {} };
async function docAlerts() {
  if (Date.now() - alertsCache.at < 60000) return alertsCache.v;
  const { VehicleRegistryConfig } = require('../models/VehicleMaster');
  const cfg = await VehicleRegistryConfig.findOne({ key: 'vehicle-registry' }).select('alerts').lean().catch(() => null);
  alertsCache = { at: Date.now(), v: cfg?.alerts || {} };
  return alertsCache.v;
}

function registryCard(reg, alerts) {
  const VDOC = require('../config/vehicleDocuments');
  const docs = {};
  for (const key of REG_DOCS) {
    const d = key === 'authorization' ? reg.authorizedPerson : reg[key];
    const st = VDOC.stateOf(d?.expiryDate, d?.statusCode, alerts?.[key] || {});
    docs[key] = { expiryDate: d?.expiryDate || null, state: VDOC.publicState(st.state), days: st.days };
  }
  return {
    _id: reg._id,
    plateNumber: reg.plateNumber || '',
    brand: reg.brandAr || '',
    model: reg.modelAr || '',
    modelYear: reg.modelYear ?? null,
    chassisNumber: reg.chassisNumber || '',
    sector: reg.sectorAr || '',
    serviceStatus: reg.serviceStatusAr || '',
    authorizedPerson: reg.authorizedPerson?.name || '',
    docs,
  };
}

/** Attaches to each row `registry` (registry identity and documents) and `conflicts`. Read from the registry on every request, bypassing the section cache, so an edit in the vehicle registry shows on the next request and the Vehicles section need not know this section's cache. */
async function attachRegistry(rows) {
  const ids = [...new Set(rows.map((r) => r.vehicleMaster && String(r.vehicleMaster)).filter(Boolean))];
  const [regs, alerts] = await Promise.all([
    ids.length ? VM().find({ _id: { $in: ids } }).select(REG_SELECT).lean() : [],
    ids.length ? docAlerts() : {},
  ]);
  const byId = new Map(regs.map((r) => [String(r._id), r]));
  return rows.map((r) => {
    const reg = r.vehicleMaster ? byId.get(String(r.vehicleMaster)) : null;
    return { ...r, registry: reg ? registryCard(reg, alerts) : null, conflicts: reg ? compareIdentity(r.profile, reg) : {} };
  });
}

module.exports = {
  linkLs2Fleet, resolveLs2Plate, resolveLs2Plates, attachRegistry, compareIdentity, unitPlate, unitCanonKey,
};
