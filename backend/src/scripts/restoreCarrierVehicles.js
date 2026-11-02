/**
 * Restore carrier trucks that were wrongly deactivated.
 * The carriers import from the operations platform copied the platform's state (`active`, `deleted_at`) and deactivated 754 trucks. Checking showed most of them carried our shipments, many worked in the last six months, and some carried on the day they were deactivated. The platform status is not a fact about the truck's existence: the platform marks vehicles deleted for its own reasons while the truck keeps running for us.
 * Stays deactivated: 51 rows that have another active copy with the same plate. Those are duplicates (one plate in two rows means two records for one truck, each with its own driver and history).
 * Usage: node src/scripts/restoreCarrierVehicles.js [--apply]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ShipmentOrderVehicle = require(`${ROOT}/models/ShipmentOrderVehicle`);
const ShipmentOrder = require(`${ROOT}/models/ShipmentOrder`);
const { registryPlateKey } = require(`${ROOT}/utils/plateKey`);

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const all = await ShipmentOrderVehicle.find({}).select('plate isActive').lean();
  const byKey = new Map();
  for (const v of all) {
    const k = registryPlateKey(v.plate);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(v);
  }

  const off = all.filter((v) => v.isActive === false);
  const restore = [];
  const keepOff = [];
  for (const v of off) {
    const k = registryPlateKey(v.plate);
    const twinAlive = (byKey.get(k) || []).some((x) => String(x._id) !== String(v._id) && x.isActive !== false);
    (twinAlive ? keepOff : restore).push(v);
  }

  // How many actually worked for us, measured by plate and not by reference: our orders carry the plate as a snapshot, and the truck reference was not written into them before this week.
  const worked = await ShipmentOrder.aggregate([
    { $match: { vehiclePlate: { $nin: ['', null] } } },
    { $group: { _id: '$vehiclePlate', n: { $sum: 1 }, last: { $max: '$createdAt' } } },
  ]);
  const workedKeys = new Map();
  for (const w of worked) {
    const k = registryPlateKey(w._id);
    if (!k) continue;
    const prev = workedKeys.get(k);
    workedKeys.set(k, { n: (prev?.n || 0) + w.n, last: prev && prev.last > w.last ? prev.last : w.last });
  }
  const cut = Date.now() - 180 * 86400000;
  const did = restore.filter((v) => workedKeys.has(registryPlateKey(v.plate)));
  const recent = did.filter((v) => new Date(workedKeys.get(registryPlateKey(v.plate)).last).getTime() > cut);

  console.log(`الموقوفة: ${off.length}`);
  console.log(`   تُرجَع (النسخةُ الوحيدة للوحتها): ${restore.length}`);
  console.log(`      منها حملت لنا فعلًا: ${did.length} · وفي آخر ٦ أشهر: ${recent.length}`);
  console.log(`   تبقى موقوفةً (لها نسخةٌ نشطةٌ بنفس اللوحة): ${keepOff.length}`);

  if (APPLY && restore.length) {
    const ids = restore.map((v) => v._id);
    for (let i = 0; i < ids.length; i += 500) {
      // eslint-disable-next-line no-await-in-loop
      await ShipmentOrderVehicle.updateMany({ _id: { $in: ids.slice(i, i + 500) } }, { $set: { isActive: true } });
    }
    const live = await ShipmentOrderVehicle.countDocuments({ isActive: { $ne: false } });
    console.log(`\nأُرجعت. شاحناتُ الناقلين النشطةُ الآن: ${live}`);
  } else {
    console.log('\n(عرضٌ فقط — أضِف --apply)');
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
