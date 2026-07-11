/**
 * ls2Identity — mirror each unit's IDENTITY from Location Solutions: the vehicle
 * profile (VIN, brand, model year, type, registration plate) + admin custom
 * fields (SIM ICCID, install date, LS Unit ID). This data barely changes, so we
 * sync it on a slow cadence instead of on every 20s telemetry poll.
 */
const client = require('./ls2Client');
const Ls2Vehicle = require('../models/Ls2Vehicle');

// Wialon field collection → { fieldName: value } (skips blanks).
function fieldMap(coll) {
  const o = {};
  for (const k of Object.keys(coll || {})) {
    const f = coll[k];
    if (f && f.n != null) o[f.n] = f.v;
  }
  return o;
}

// Extract the identity shape from a raw unit fetched with IDENTITY_FLAGS.
function extractIdentity(unit) {
  const prof = fieldMap(unit.pflds);
  const custom = fieldMap(unit.flds);
  const known = new Set(['ICCID', 'DOI', 'LS Unit ID']);
  const extra = Object.entries(custom)
    .filter(([k, v]) => !known.has(k) && v)
    .map(([label, value]) => ({ label, value: String(value) }));
  return {
    vin: prof.vin || '',
    brand: prof.brand || '',
    modelYear: prof.year || '',
    vehicleType: prof.vehicle_type || '',
    registrationPlate: prof.registration_plate || '',
    simIccid: custom.ICCID || '',
    installDate: custom.DOI || '',
    lsUnitId: custom['LS Unit ID'] || '',
    extra,
    syncedAt: new Date(),
  };
}

// Fetch all units with identity flags and upsert their profile onto Ls2Vehicle.
async function syncIdentity() {
  if (!client.isConfigured()) return 0;
  const units = await client.searchIdentity();
  if (!units.length) return 0;
  const ops = units.map((u) => ({
    updateOne: {
      filter: { unitId: u.id },
      update: { $set: { profile: extractIdentity(u) } },
    },
  }));
  if (ops.length) await Ls2Vehicle.bulkWrite(ops, { ordered: false });
  return ops.length;
}

module.exports = { syncIdentity, extractIdentity };
