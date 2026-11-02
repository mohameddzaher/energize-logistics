/**
 * ls2FleetRegister: every Location Solutions truck gets a flatbed in the asset register.
 * The flatbed page shows the `Ls2Flatbed` register, previously filled by hand or import, so a truck added in Location Solutions showed in tracking but was missing from assets: nowhere to fit a tire and no trailer could be moved to it.
 * The flatbed is created from the live screen: plate, its key (`vehiclePlateKey`, the key the asset register uses to read the live truck), the next number and make. The 14 standard tire positions appear empty, waiting for the workshop.
 * Tires are not created: a tire is an asset with a serial engraved on it that Location Solutions does not know (the pressure sensor reports "position 3", not a serial), so inventing serials would fill the register with nonexistent assets. They are registered from the workshop like any tire. Called by the poller (on identity sync) and the general overview. Writes nothing if nothing is new; a race between two workers on one truck is settled by the unique index.
 */
const Ls2Vehicle = require('../models/Ls2Vehicle');
const Ls2Flatbed = require('../models/Ls2Flatbed');
const Ls2AssetEvent = require('../models/Ls2AssetEvent');
const { vehiclePlateKey, formatPlate } = require('../utils/plateKey');

async function ensureFlatbeds() {
  const [vehicles, flatbeds] = await Promise.all([
    Ls2Vehicle.find({}).select('unitId name plate profile.registrationPlate profile.brand').sort({ unitId: 1 }).lean(),
    Ls2Flatbed.find({}).select('plateKey numbering').lean(),
  ]);
  const have = new Set(flatbeds.map((f) => f.plateKey));
  let next = flatbeds.reduce((m, f) => Math.max(m, Number(f.numbering) || 0), 0);
  const created = [];
  for (const v of vehicles) {
    const key = vehiclePlateKey(v);
    if (!key || have.has(key)) continue;
    const plate = formatPlate(v.plate || v.profile?.registrationPlate || '') || key;
    next += 1;
    try {
      // eslint-disable-next-line no-await-in-loop
      const f = await Ls2Flatbed.create({
        plate, plateKey: key, numbering: next,
        brand: String(v.profile?.brand || '').trim(),
        notes: 'أُضيفت تلقائيًا من لوكيشن سوليوشن — الكاوتش يُسجَّل من الورشة',
      });
      have.add(key);
      created.push(f);
      // eslint-disable-next-line no-await-in-loop
      await Ls2AssetEvent.create({
        entityType: 'flatbed', refId: f._id, label: plate, action: 'registered',
        toPlate: plate, toPlateKey: key,
        reason: 'شاحنةٌ جديدة في لوكيشن سوليوشن — أُضيفت إلى سجلّ الأصول تلقائيًا',
        performedByName: 'النظام',
      });
    } catch (e) {
      if (e?.code !== 11000) throw e; // Another worker got there first; the flatbed exists.
      next -= 1;
    }
  }
  if (created.length) {
    // The new flatbed is linked to its registry vehicle from its truck (services/ls2VehicleLink).
    try { await require('./ls2VehicleLink').linkLs2Fleet(); } catch (_) { /* Retried on the next sync */ }
    try { require('../utils/ttlCache').clear('ls2assets'); } catch (_) { /* */ }
    try { require('./ls2TireSensors').clearLayoutCache(); } catch (_) { /* */ }
    try { require('../utils/ls2Touch').clearLs2Derived(); } catch (_) { /* */ }
  }
  return created;
}

module.exports = { ensureFlatbeds };
