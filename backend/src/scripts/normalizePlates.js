/**
 * Normalizes plate format across all records.
 * The same plate is written differently by screen (Arabic letters with spaces, Latin letters, carrier plates in lowercase), with meaningless differences in spaces, case and digit script.
 * Fixes whitespace, alphabet and digit script. Does not reorder letters and number, since that changes the statement rather than formatting it and plates are matched by text in imports and with Location Solutions. The derived plateKey is already folded and must not change; the script verifies this before writing and refuses any row whose key would change.
 * Usage: [--apply]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { formatPlate, registryPlateKey } = require(`${ROOT}/utils/plateKey`);

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const { VehicleMaster } = require(`${ROOT}/models/VehicleMaster`);
  const { FleetVehicle } = require(`${ROOT}/models/FleetModels`);
  const Ls2Vehicle = require(`${ROOT}/models/Ls2Vehicle`);
  const { LightTransportEmployee } = require(`${ROOT}/models/LightTransport`);
  const ShipmentOrderVehicle = require(`${ROOT}/models/ShipmentOrderVehicle`);
  const VehicleClaim = require(`${ROOT}/models/VehicleClaim`);

  const targets = [
    ['سجلّ المركبات', VehicleMaster, 'plateNumber'],
    ['إدارة الأسطول', FleetVehicle, 'plate'],
    ['لوكيشن سوليوشن', Ls2Vehicle, 'plate'],
    ['النقل الخفيف', LightTransportEmployee, 'vehiclePlate'],
    ['شاحنات الناقلين', ShipmentOrderVehicle, 'plate'],
    ['الحوادث', VehicleClaim, 'vehiclePlate'],
  ];

  let grandTotal = 0;
  for (const [label, Model, field] of targets) {
    const rows = await Model.find({ [field]: { $nin: ['', null] } }).select(field).limit(50000).lean();
    const ops = [];
    const samples = [];
    let keyMoved = 0;
    for (const r of rows) {
      const before = String(r[field] || '');
      const after = formatPlate(before);
      if (after === before || !after) continue;
      // Guard: the matching key must not change. If it would, this is an edit of the statement, not formatting, so the row is skipped and reported.
      if (registryPlateKey(before) !== registryPlateKey(after)) { keyMoved += 1; continue; }
      if (samples.length < 4) samples.push(`«${before}» → «${after}»`);
      ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { [field]: after } } } });
    }
    grandTotal += ops.length;
    console.log(`${label}: ${rows.length} صفًّا · يُضبَط ${ops.length}${keyMoved ? ` · تُركت ${keyMoved} لتغيُّر مفتاحها` : ''}`);
    if (samples.length) console.log(`   ${samples.join(' · ')}`);
    if (APPLY && ops.length) {
      for (let i = 0; i < ops.length; i += 500) await Model.bulkWrite(ops.slice(i, i + 500));
    }
  }

  console.log(APPLY ? `\nكُتب: ${grandTotal} لوحة.` : `\nالمجموع: ${grandTotal} لوحة — (عرضٌ فقط، أضِف --apply)`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
