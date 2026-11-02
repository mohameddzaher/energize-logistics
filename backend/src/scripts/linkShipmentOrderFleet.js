/**
 * Links shipment-order trucks to their owners and distinguishes our fleet from carrier trucks.
 * Trucks imported from order history had no vendor reference, and no vendor was read as our fleet, inflating the fleet counter and leaving vendor forms without trucks.
 * Each order snapshot carries vendor name and plate: a plate seen with only one vendor in all history has a certain owner; plates seen with several vendors are skipped, since a guess must not be stored. Our fleet is identified by plate across the vehicle registry, fleet management and Location Solutions.
 * Usage: [--apply]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ShipmentOrder = require(`${ROOT}/models/ShipmentOrder`);
const ShipmentOrderVehicle = require(`${ROOT}/models/ShipmentOrderVehicle`);
const ShipmentOrderSupplier = require(`${ROOT}/models/ShipmentOrderSupplier`);
const { VehicleMaster } = require(`${ROOT}/models/VehicleMaster`);
const { FleetVehicle } = require(`${ROOT}/models/FleetModels`);
const Ls2Vehicle = require(`${ROOT}/models/Ls2Vehicle`);

const APPLY = process.argv.includes('--apply');

/**
 * The plate key is the shared rule, not a third one. registryPlateKey is what the vehicle registry uses: digits and letters (Arabic or Latin), folded, no spaces. A private key would let two rules drift apart.
 * Letters must be included: our plates look like 5803 RXA, so dropping letters yields 5803, which would match carrier trucks with digit-only plates and wrongly count them as ours.
 */
const { registryPlateKey: plateKey } = require(`${ROOT}/utils/plateKey`);

/** Vendor name fold: letter variants and spacing must not create a second vendor. */
const nameKey = (v) => String(v || '')
  .replace(/[ً-ْ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/\s+/g, ' ').trim().toLowerCase();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  // 1. Our fleet by plates.
  const oursKeys = new Set();
  for (const rows of [
    await VehicleMaster.find({}).select('plateNumber').lean(),
    await FleetVehicle.find({}).select('plate').lean(),
    await Ls2Vehicle.find({}).select('plate').lean(),
  ]) for (const r of rows) { const k = plateKey(r.plateNumber || r.plate); if (k) oursKeys.add(k); }
  console.log(`مفاتيحُ لوحاتِ أسطولنا: ${oursKeys.size}`);

  // 2. Plate to its vendor from order history, if only one.
  const pairs = await ShipmentOrder.aggregate([
    { $match: { vehiclePlate: { $nin: ['', null] }, supplierName: { $nin: ['', null] } } },
    { $group: { _id: { p: '$vehiclePlate', s: '$supplierName' }, n: { $sum: 1 } } },
  ]);
  const byPlate = new Map();
  for (const x of pairs) {
    const k = plateKey(x._id.p);
    if (!k) continue;
    if (!byPlate.has(k)) byPlate.set(k, new Map());
    const m = byPlate.get(k);
    const nk = nameKey(x._id.s);
    m.set(nk, (m.get(nk) || 0) + x.n);
  }
  const decisive = new Map();          // Plate key to folded vendor name.
  let ambiguous = 0;
  for (const [k, m] of byPlate) {
    if (m.size === 1) decisive.set(k, [...m.keys()][0]);
    else ambiguous += 1;
  }
  console.log(`لوحاتٌ في الطلبات=${byPlate.size} · موردٌ واحدٌ قاطع=${decisive.size} · ملتبسة=${ambiguous}`);

  // 3. Existing vendors by folded name.
  const sups = await ShipmentOrderSupplier.find({}).select('name').lean();
  const supByName = new Map();
  for (const s of sups) { const k = nameKey(s.name); if (k && !supByName.has(k)) supByName.set(k, s); }
  console.log(`الموردون المسجَّلون=${sups.length} (بأسماءَ مطويّةٍ مميَّزة=${supByName.size})`);

  // 4. Write plan.
  const vehicles = await ShipmentOrderVehicle.find({}).select('plate supplier ownership').lean();
  const plan = { ours: [], supplier: [], unknown: [], noSupplierRow: new Set() };
  for (const v of vehicles) {
    const k = plateKey(v.plate);
    if (k && oursKeys.has(k)) { plan.ours.push(v._id); continue; }
    const nk = k ? decisive.get(k) : null;
    const sup = nk ? supByName.get(nk) : null;
    if (sup) { plan.supplier.push({ id: v._id, sup: sup._id }); continue; }
    if (nk && !sup) plan.noSupplierRow.add(nk);
    plan.unknown.push(v._id);
  }
  console.log(`\nالخطّة على ${vehicles.length} شاحنة:`);
  console.log(`  أسطولُنا           = ${plan.ours.length}`);
  console.log(`  شاحنةُ مورّدٍ معروف  = ${plan.supplier.length}`);
  console.log(`  لم يُعرَف مالكُها    = ${plan.unknown.length}`);
  if (plan.noSupplierRow.size) console.log(`  (أسماءُ موردين في الطلبات بلا صفٍّ في سجلّ الموردين: ${plan.noSupplierRow.size})`);

  if (!APPLY) { console.log('\n(عرضٌ فقط — أضِف --apply)'); await mongoose.disconnect(); return; }

  if (plan.ours.length) {
    await ShipmentOrderVehicle.updateMany({ _id: { $in: plan.ours } },
      { $set: { ownership: 'ours', supplier: null } });
  }
  // Written in batches per vendor: one update per vendor, not per truck.
  const bySup = new Map();
  for (const x of plan.supplier) {
    const k = String(x.sup);
    if (!bySup.has(k)) bySup.set(k, []);
    bySup.get(k).push(x.id);
  }
  for (const [sup, ids] of bySup) {
    await ShipmentOrderVehicle.updateMany({ _id: { $in: ids } }, { $set: { supplier: sup, ownership: 'supplier' } });
  }
  if (plan.unknown.length) {
    await ShipmentOrderVehicle.updateMany({ _id: { $in: plan.unknown } }, { $set: { ownership: 'unknown' } });
  }
  console.log(`\nكُتب: أسطولُنا=${plan.ours.length} · موردون=${plan.supplier.length} (على ${bySup.size} موردًا) · مجهول=${plan.unknown.length}`);

  const after = await ShipmentOrderVehicle.aggregate([{ $group: { _id: '$ownership', n: { $sum: 1 } } }]);
  console.log('بعد الكتابة:', after.map((a) => `${a._id}=${a.n}`).join(' · '));
  try { require(`${ROOT}/utils/ttlCache`).clear('so:'); } catch (e) { /* */ }
  await mongoose.disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
