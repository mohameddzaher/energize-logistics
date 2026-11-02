/**
 * Links our fleet in shipment orders to the registries: truck to VehicleMaster, driver to their HR Employee.
 * The single-record rule means edits should show everywhere, but these trucks (ownership 'ours') were copies, some written two or three times with different plate spellings, and carrier drivers included our employees by iqama with no link.
 * Each of our trucks resolves by plate (utils/vehicleRef, unified Arabic/Latin key) and gets vehicleMaster; several rows resolving to one vehicle are printed as duplicates, not merged, since orders point at the rows. Each driver whose iqama number is in HR gets employee. Carrier trucks and outside drivers are untouched.
 * Usage: [--apply]; idempotent.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const V = require(`${ROOT}/models/ShipmentOrderVehicle`);
  const D = require(`${ROOT}/models/ShipmentOrderDriver`);
  const { resolveMany, canonicalPlateKey } = require(`${ROOT}/utils/vehicleRef`);
  const { byIdNumbers, idKey, displayName } = require(`${ROOT}/utils/personLookup`);

  // 1. Trucks.
  const ours = await V.find({ ownership: 'ours' }).select('plate vehicleMaster isActive').lean();
  const vm = await resolveMany(ours.map((v) => v.plate), '_id plateNumber canonKey');
  const vOps = []; const unresolved = []; const byVm = new Map();
  for (const v of ours) {
    const hit = vm.get(canonicalPlateKey(v.plate));
    if (!hit) { unresolved.push(v); continue; }
    const k = String(hit._id);
    if (!byVm.has(k)) byVm.set(k, { plate: hit.plateNumber, rows: [] });
    byVm.get(k).rows.push(v);
    if (String(v.vehicleMaster || '') !== k) {
      vOps.push({ updateOne: { filter: { _id: v._id }, update: { $set: { vehicleMaster: hit._id } } } });
    }
  }
  const dupes = [...byVm.values()].filter((x) => x.rows.length > 1);
  console.log(`شاحناتٌ «لنا»=${ours.length} · حُلّت إلى السجلّ=${ours.length - unresolved.length} على ${byVm.size} مركبة · لم تُحلّ=${unresolved.length}`);
  console.log(`  تُكتب صلتُها=${vOps.length} · مربوطةٌ سلفًا=${ours.length - unresolved.length - vOps.length}`);
  console.log(`  مركباتٌ لها أكثرُ من صفّ (تكرار)=${dupes.length} · صفوفٌ زائدة=${dupes.reduce((n, d) => n + d.rows.length - 1, 0)}`);
  dupes.slice(0, 20).forEach((d) => console.log(`    ${d.plate} ← ${d.rows.map((r) => `«${r.plate}»${r.isActive === false ? '(موقوف)' : ''}`).join(' · ')}`));
  unresolved.slice(0, 10).forEach((v) => console.log(`  لم تُحلّ: «${v.plate}»`));

  // 2. Drivers.
  const drivers = await D.find({ residenceNumber: { $nin: ['', null] } }).select('name residenceNumber employee').lean();
  const emps = await byIdNumbers(drivers.map((d) => d.residenceNumber));
  const dOps = []; let matched = 0; const sample = [];
  const perEmp = new Map();
  for (const d of drivers) {
    const e = emps.get(idKey(d.residenceNumber));
    if (!e) continue;
    matched += 1;
    perEmp.set(String(e._id), (perEmp.get(String(e._id)) || 0) + 1);
    if (String(d.employee || '') !== String(e._id)) {
      dOps.push({ updateOne: { filter: { _id: d._id }, update: { $set: { employee: e._id } } } });
      if (sample.length < 8) sample.push(`${d.name} (${d.residenceNumber}) ← ${displayName(e)}`);
    }
  }
  console.log(`\nسائقون برقم إقامة=${drivers.length} · موظّفونا=${matched} (${perEmp.size} موظّفًا) · تُكتب صلتُهم=${dOps.length}`);
  console.log(`  موظّفٌ له أكثرُ من صفّ سائق=${[...perEmp.values()].filter((n) => n > 1).length}`);
  sample.forEach((s) => console.log(`    ${s}`));

  if (!APPLY) { console.log('\n(معاينةٌ فقط — أضِف --apply)'); await mongoose.disconnect(); return; }
  if (vOps.length) await V.bulkWrite(vOps, { ordered: false });
  if (dOps.length) await D.bulkWrite(dOps, { ordered: false });
  try { require(`${ROOT}/utils/ttlCache`).clear('so:'); } catch (_) { /* */ }
  console.log(`\nكُتب: شاحنات=${vOps.length} · سائقون=${dOps.length}`);
  await mongoose.disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
