/**
 * Seed the ls2 fleet-asset registry from data/masters/truck_tires_flat_5.json —
 * the workshop's fifth collection round (2 more trucks), flat rows like round
 * four with English section keys (head/trailer/spare) and a bare hasSensor
 * boolean. Translated to the exact /api/ls2/assets/import payload and pushed
 * through the same idempotent import (tires upsert by serial → a serial seen on
 * another truck is a TRANSFER; trailers by number; flatbeds by plate).
 *
 * Duplicate serials inside the sheet: first row wins, the rest are skipped and
 * reported — two physical tires cannot share one serial.
 *
 * Run: node src/seeds/seedLs2AssetsFlat5.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const rows = require('../data/masters/truck_tires_flat_5.json');
const assets = require('../controllers/ls2AssetsController');

// The registry stores the Arabic section names the first two rounds used.
const SECTION_AR = { head: 'الرأس', trailer: 'التيدر', spare: 'الاستبن' };

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
  if (!serial) { skipped.push({ reason: 'no serial', plate, tireNumber: r.tireNumber, label: r.label }); continue; }
  if (seenSerial.has(serial)) {
    skipped.push({ reason: 'duplicate serial', serial, plate, tireNumber: r.tireNumber, label: r.label, firstSeen: seenSerial.get(serial) });
    continue;
  }
  seenSerial.set(serial, `${plate} — tire ${r.tireNumber} (${r.label})`);
  byPlate.get(plate).tires.push({
    tire_number: String(r.tireNumber ?? ''),
    position: r.label || '',
    position_number: r.position ?? null,
    section: SECTION_AR[r.section] || String(r.section || ''),
    serial,
    type: r.brand || '',
    sensor: r.hasSensor ? 'يوجد' : 'لايوجد',
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
