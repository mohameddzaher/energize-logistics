/**
 * Seed the ls2 fleet-asset registry from data/masters/truck_tire_inventory_flat2.json —
 * the second workshop collection round (7 more trucks), captured as FLAT rows
 * (one row per tire) instead of the nested shape the first round used.
 *
 * Rows are grouped by plate and translated to the exact payload
 * /api/ls2/assets/import accepts, then pushed through the same idempotent
 * import logic (tires upsert by serial → a serial seen on another truck is a
 * TRANSFER with the event to prove it; trailers by number; flatbeds by plate).
 *
 * A serial appearing twice in the sheet is a data-entry error (two physical
 * tires cannot share one serial): the first row wins, the rest are skipped and
 * reported so the workshop can supply the real serial.
 *
 * Run: node src/seeds/seedLs2AssetsFlat2.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const rows = require('../data/masters/truck_tire_inventory_flat2.json');
const assets = require('../controllers/ls2AssetsController');

const byPlate = new Map();
const seenSerial = new Map();
const skipped = [];

for (const r of rows) {
  const plate = String(r.plateNumber || '').trim();
  if (!plate) { skipped.push({ reason: 'no plate', row: r }); continue; }
  if (!byPlate.has(plate)) {
    byPlate.set(plate, {
      vehicle_number: plate,
      trailer_number: r.trailerNumber != null ? String(r.trailerNumber).trim() : '',
      tires: [],
    });
  }
  const serial = String(r.serial || '').trim();
  if (!serial) { skipped.push({ reason: 'no serial', plate, tireNumber: r.tireNumber, positionLabel: r.positionLabel }); continue; }
  if (seenSerial.has(serial)) {
    skipped.push({ reason: 'duplicate serial', serial, plate, tireNumber: r.tireNumber, positionLabel: r.positionLabel, firstSeen: seenSerial.get(serial) });
    continue;
  }
  seenSerial.set(serial, `${plate} — tire ${r.tireNumber} (${r.positionLabel})`);
  byPlate.get(plate).tires.push({
    tire_number: String(r.tireNumber ?? ''),
    position: r.positionLabel || '',
    position_number: r.position ?? null,
    section: r.groupLabel || '',
    serial,
    type: r.brand || '',
    sensor: r.sensorLabel || (r.hasSensor ? 'يوجد' : 'لايوجد'),
  });
}

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const payload = { vehicles: [...byPlate.values()], flatbeds: [] };
    console.log(`Importing ${payload.vehicles.length} trucks / ${payload.vehicles.reduce((s, v) => s + v.tires.length, 0)} tires…`);

    const result = await new Promise((resolve, reject) => {
      assets.importAssets(
        { body: payload, user: null },
        { json: resolve, status: () => ({ json: (o) => reject(new Error(o?.message || 'import failed')) }) }
      );
    });
    console.log('Seeded ls2 assets:', result.summary);
    if (skipped.length) {
      console.log('\nSKIPPED ROWS (fix at the source and re-run — the import is idempotent):');
      for (const s of skipped) console.log(' -', JSON.stringify(s));
    }
    process.exit(0);
  } catch (e) {
    console.error('Seed error:', e.message);
    process.exit(1);
  }
})();
