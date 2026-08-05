/* eslint-disable no-console */
// استيراد جرد الكاوتش من ملف الورشة إلى سجل أصول LS2.
//
//   node src/scripts/importTireInventory.js                        # الجرد الأصلي
//   node src/scripts/importTireInventory.js newtrucks.json          # أي ملف تاني
//   node src/scripts/importTireInventory.js newtrucks.json --dry    # يقول هيعمل إيه
//
// idempotent بالـ serial: نفس الملف يتنفّذ عشر مرات يطلع نفس النتيجة. بيضمن
// وجود السطحة (Flatbed) والتيدر (Trailer) وبيثبّت كل إطار على مكانه.
//
// وبيكتب في سجل الحركة (Ls2AssetEvent): كل إطار جديد بياخد `registered` وبعده
// `mounted`، واللي بيتنقل من عربية لعربية بياخد `transferred` بالمكان القديم
// والجديد. من غير ده، بروفايل العربية بيعرض ١٤ كاوتش من غير ما حد يعرف جُم
// منين ولا إمتى — والتاريخ ده هو اللي بيخلّي الورشة تحاسب على عمر الإطار.
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const plateKey = require('../utils/plateKey');
const Ls2TireAsset = require('../models/Ls2TireAsset');
const Ls2Flatbed = require('../models/Ls2Flatbed');
const Ls2Trailer = require('../models/Ls2Trailer');
const Ls2AssetEvent = require('../models/Ls2AssetEvent');

const pk = (p) => (typeof plateKey === 'function' ? plateKey(p) : plateKey.plateKey(p));
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const FILE = args.find((a) => !a.startsWith('--')) || 'truck_tire_inventory_v7_flat.json';

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('No MONGODB_URI in env');
  await mongoose.connect(uri);

  const file = path.isAbsolute(FILE) ? FILE : path.join(__dirname, '..', 'data', 'masters', FILE);
  if (!fs.existsSync(file)) throw new Error(`الملف مش موجود: ${file}`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = Array.isArray(raw) ? raw : (raw.records || raw.rows || raw.data || []);
  console.log(`${path.basename(file)}: ${rows.length} إطار${DRY ? '   (تجربة)' : ''}`);

  // تجميع حسب المركبة.
  const byPlate = new Map();
  for (const r of rows) {
    const plate = String(r.vehicle_plate || '').trim();
    if (!plate) continue;
    if (!byPlate.has(plate)) byPlate.set(plate, { trailer_number: r.trailer_number, odometer_km: r.odometer_km, tires: [] });
    byPlate.get(plate).tires.push(r);
  }

  const summary = { flatbeds: 0, trailers: 0, tiresNew: 0, tiresMoved: 0, tiresUnchanged: 0, events: 0 };
  const moves = [];

  for (const [plate, v] of byPlate) {
    const key = pk(plate);
    // السطحة.
    if (!(await Ls2Flatbed.findOne({ plateKey: key }))) {
      if (!DRY) await Ls2Flatbed.create({ plate, plateKey: key });
      summary.flatbeds++;
    }
    // التيدر.
    if (v.trailer_number != null && String(v.trailer_number).trim()) {
      const tn = String(v.trailer_number).trim();
      const trailer = await Ls2Trailer.findOne({ trailerNumber: tn });
      if (!trailer) {
        if (!DRY) await Ls2Trailer.create({ trailerNumber: tn, currentPlate: plate, currentPlateKey: key, status: 'active' });
        summary.trailers++;
      } else if (trailer.currentPlateKey !== key) {
        if (!DRY) { trailer.set({ currentPlate: plate, currentPlateKey: key, status: 'active' }); await trailer.save(); }
        summary.trailers++;
      }
      if (!DRY) await Ls2Flatbed.updateOne({ plateKey: key }, { currentTrailerNumber: tn });
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
      const at = t.registration_date ? new Date(t.registration_date) : new Date();
      const odo = t.odometer_km ?? v.odometer_km ?? null;
      const ev = async (action, extra = {}) => {
        summary.events++;
        if (DRY) return;
        const tire = await Ls2TireAsset.findOne({ serial }).select('_id').lean();
        await Ls2AssetEvent.create({
          entityType: 'tire', refId: tire._id, label: serial, action,
          toPlate: plate, toPlateKey: key, toPosition: fields.positionLabel,
          date: at, odometerKm: odo, notes: 'استيراد جرد الورشة', ...extra,
        });
      };

      const existing = await Ls2TireAsset.findOne({ serial });
      if (!existing) {
        if (!DRY) await Ls2TireAsset.create({ serial, ...fields });
        summary.tiresNew++;
        await ev('registered', { toPlate: null, toPlateKey: null, toPosition: '' });
        await ev('mounted');
      } else if (existing.plateKey !== key || existing.positionNumber !== (t.position_number ?? null)) {
        moves.push(`${serial}: ${existing.plate || 'مخزن'} ${existing.positionLabel || ''} → ${plate} ${fields.positionLabel}`);
        if (!DRY) { existing.set(fields); await existing.save(); }
        summary.tiresMoved++;
        await ev(existing.plateKey && existing.plateKey !== key ? 'transferred' : 'mounted', {
          fromPlate: existing.plate || null, fromPlateKey: existing.plateKey || null,
          fromPosition: existing.positionLabel || '',
        });
      } else {
        if (!DRY) {
          existing.set({
            tireNumber: fields.tireNumber, type: fields.type, sensor: fields.sensor,
            positionLabel: fields.positionLabel, section: fields.section,
            isSpare: fields.isSpare, notes: fields.notes,
          });
          await existing.save();
        }
        summary.tiresUnchanged++;
      }
    }
  }

  console.log(`عربيات في الملف: ${byPlate.size}`);
  console.log('النتيجة:', summary);
  if (moves.length) {
    console.log(`\nكاوتشات اتنقلت (${moves.length}):`);
    moves.slice(0, 30).forEach((m) => console.log('   ' + m));
    if (moves.length > 30) console.log(`   … و${moves.length - 30} كمان`);
  }
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
