/* eslint-disable no-console */
// استيراد جرد الكاوتش (truck_tire_inventory_v7_flat.json → 238 إطار) إلى سجل
// أصول LS2 — نفس منطق /assets/import: idempotent بالـ serial، يضمن وجود
// السطحة (Flatbed) والتيدر (Trailer) ويثبّت/ينقل كل إطار على مكانه.
//   node src/scripts/importTireInventory.js
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const plateKey = require('../utils/plateKey');
const Ls2TireAsset = require('../models/Ls2TireAsset');
const Ls2Flatbed = require('../models/Ls2Flatbed');
const Ls2Trailer = require('../models/Ls2Trailer');

const pk = (p) => (typeof plateKey === 'function' ? plateKey(p) : plateKey.plateKey(p));

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('No MONGODB_URI in env');
  await mongoose.connect(uri);

  const file = path.join(__dirname, '..', 'data', 'masters', 'truck_tire_inventory_v7_flat.json');
  const raw = require(file);
  const rows = Array.isArray(raw) ? raw : (raw.records || raw.rows || raw.data || []);
  console.log(`Loaded ${rows.length} tire rows`);

  // تجميع حسب المركبة.
  const byPlate = new Map();
  for (const r of rows) {
    const plate = String(r.vehicle_plate || '').trim();
    if (!plate) continue;
    if (!byPlate.has(plate)) byPlate.set(plate, { trailer_number: r.trailer_number, tires: [] });
    byPlate.get(plate).tires.push(r);
  }

  const summary = { flatbeds: 0, trailers: 0, tiresNew: 0, tiresMoved: 0, tiresUnchanged: 0 };

  for (const [plate, v] of byPlate) {
    const key = pk(plate);
    // السطحة.
    if (!(await Ls2Flatbed.findOne({ plateKey: key }))) {
      await Ls2Flatbed.create({ plate, plateKey: key });
      summary.flatbeds++;
    }
    // التيدر.
    if (v.trailer_number != null && String(v.trailer_number).trim()) {
      const tn = String(v.trailer_number).trim();
      let trailer = await Ls2Trailer.findOne({ trailerNumber: tn });
      if (!trailer) {
        await Ls2Trailer.create({ trailerNumber: tn, currentPlate: plate, currentPlateKey: key, status: 'active' });
        summary.trailers++;
      } else if (trailer.currentPlateKey !== key) {
        trailer.set({ currentPlate: plate, currentPlateKey: key, status: 'active' });
        await trailer.save();
        summary.trailers++;
      }
      await Ls2Flatbed.updateOne({ plateKey: key }, { currentTrailerNumber: tn });
    }
    // الكاوتش.
    for (const t of v.tires) {
      const serial = String(t.serial || '').trim();
      if (!serial) continue;
      const sensor = t.tpms_sensor === true ? 'yes' : t.tpms_sensor === false ? 'no' : 'unknown';
      const noteBits = [t.side, t.axis != null ? `محور ${t.axis}` : '', t.odometer_km ? `عداد ${t.odometer_km}` : '']
        .filter(Boolean).join(' · ');
      const fields = {
        tireNumber: String(t.tire_number ?? ''),
        type: t.brand || '',
        sensor,
        status: 'mounted',
        plate, plateKey: key,
        positionNumber: t.position_number ?? null,
        positionLabel: t.position_label_ar || '',
        section: t.section_ar || t.section || '',
        isSpare: /استبن/.test(String(t.section_ar || '')),
        notes: noteBits,
      };
      const existing = await Ls2TireAsset.findOne({ serial });
      if (!existing) {
        await Ls2TireAsset.create({ serial, ...fields });
        summary.tiresNew++;
      } else if (existing.plateKey !== key || existing.positionNumber !== (t.position_number ?? null)) {
        existing.set(fields);
        await existing.save();
        summary.tiresMoved++;
      } else {
        existing.set({ tireNumber: fields.tireNumber, type: fields.type, sensor: fields.sensor, positionLabel: fields.positionLabel, section: fields.section, isSpare: fields.isSpare, notes: fields.notes });
        await existing.save();
        summary.tiresUnchanged++;
      }
    }
  }

  console.log('Import summary:', summary);
  console.log(`Vehicles: ${byPlate.size}`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
