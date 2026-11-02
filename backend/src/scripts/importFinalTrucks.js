/* eslint-disable no-console */
/**
 * Imports the last four trucks plus the standing trailers, and fixes the tire-to-trailer link (--dry, --yes).
 * The file (finaltrucks.json) has head_and_trailer (a real truck with a plate and 14 tires: 6 head + 6 trailer + 2 spare) and trailer_only (a trailer alone, no plate, 6 tires, not towed). A trailer is not a truck: trailers 59, 60 and 61 were registered as fake flatbeds (TR1/TR2/TR3), which inflated the flatbed count and showed in coverage reports as trucks missing tires. This script makes them real trailers and removes the fakes.
 * Main fix: trailer tires were stored under the truck's plate, so after a trailer moved they stayed on the old truck (342 tires were like that). The new trailerNumber field ties the tire to the trailer, and a transfer now moves its tires.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const DRY = !process.argv.includes('--yes');
const S = (v) => (v === null || v === undefined ? '' : String(v).trim());

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const Ls2Flatbed = require('../models/Ls2Flatbed');
  const Ls2Trailer = require('../models/Ls2Trailer');
  const Ls2TireAsset = require('../models/Ls2TireAsset');
  const Ls2AssetEvent = require('../models/Ls2AssetEvent');
  const { plateKey } = require('../utils/plateKey');

  const src = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'masters', 'finaltrucks.json'), 'utf8'));
  const records = src.records || [];
  const vehicles = records.filter((r) => r.vehicle?.record_type === 'head_and_trailer');
  const trailersOnly = records.filter((r) => r.vehicle?.record_type === 'trailer_only');
  console.log(`الملف: ${records.length} سجل — ${vehicles.length} عربية · ${trailersOnly.length} تيدر لوحده`
    + `  (${src.statistics?.total_tires} إطار)${DRY ? '   (تجربة)' : ''}\n`);

  const sum = {
    flatbeds: 0, trailers: 0, tires: 0, moved: 0, unchanged: 0,
    fakeFlatbedsRemoved: 0, backfilled: 0, events: 0, keptUserMoves: 0,
  };
  const notes = [];
  const userMoves = [];

  // Step 1: standing trailers. TR1/TR2/TR3 were fake flatbeds.
  console.log('── التيدرات الواقفة ──');
  for (const r of trailersOnly) {
    const num = S(r.trailer?.trailer_number);
    if (!num) { notes.push(`${r.record_id}: مفيش رقم تيدر`); continue; }
    const existing = await Ls2Trailer.findOne({ trailerNumber: num });
    // The fake flatbed created for it: its numbering equals the trailer number and its name is TR*.
    const fake = await Ls2Flatbed.findOne({ numbering: Number(num), plate: { $regex: '^TR' } });
    console.log(`   تيدر ${num.padEnd(4)}${existing ? 'موجود' : 'هيتعمل'}`
      + (fake ? `   ← وسطحة وهمية «${fake.plate}» هتتشال` : ''));
    if (!DRY) {
      if (!existing) {
        await Ls2Trailer.create({ trailerNumber: num, currentPlate: null, currentPlateKey: null, status: 'spare' });
        sum.trailers++;
      }
      if (fake) {
        // Tires that were attached to the fake flatbed move to the trailer and are cleared from the plate.
        await Ls2TireAsset.updateMany({ plateKey: fake.plateKey },
          { $set: { trailerNumber: num, plate: null, plateKey: null } });
        await Ls2Flatbed.deleteOne({ _id: fake._id });
        sum.fakeFlatbedsRemoved++;
      }
    }
  }

  // Step 2: trucks
  console.log('\n── العربيات ──');
  for (const r of vehicles) {
    const plate = S(r.vehicle?.plate_number_ar);
    const key = plateKey(plate);
    const tNum = S(r.trailer?.trailer_number);
    const fb = await Ls2Flatbed.findOne({ plateKey: key });
    const mounted = await Ls2TireAsset.countDocuments({ plateKey: key, status: 'mounted' });
    console.log(`   ${plate.padEnd(14)} تيدر ${tNum.padEnd(4)} — ${r.tires.length} إطار في الملف`
      + `، ${mounted} مسجّل دلوقتي${fb ? '' : '   ← السطحة مش موجودة، هتتعمل'}`);
    if (DRY) continue;
    if (!fb) { await Ls2Flatbed.create({ plate, plateKey: key }); sum.flatbeds++; }
    if (tNum) {
      const tr = await Ls2Trailer.findOne({ trailerNumber: tNum });
      if (!tr) { await Ls2Trailer.create({ trailerNumber: tNum, currentPlate: plate, currentPlateKey: key, status: 'active' }); sum.trailers++; }
      else if (tr.currentPlateKey !== key) { tr.set({ currentPlate: plate, currentPlateKey: key, status: 'active' }); await tr.save(); }
      await Ls2Flatbed.updateOne({ plateKey: key }, { currentTrailerNumber: tNum });
    }
  }

  // Step 3: tires
  if (!DRY) {
    for (const r of records) {
      const plate = S(r.vehicle?.plate_number_ar);
      const key = plate ? plateKey(plate) : null;
      const tNum = S(r.trailer?.trailer_number);
      const odo = r.vehicle?.odometer_km ?? null;
      const at = r.vehicle?.registration_date ? new Date(r.vehicle.registration_date) : new Date();

      for (const t of r.tires) {
        const serial = S(t.serial);
        if (!serial) continue;
        const isTrailerTire = t.assembly === 'trailer';
        const isSpare = t.assembly === 'spare';
        const fields = {
          tireNumber: S(t.tire_number),
          type: S(t.brand),
          sensor: t.has_sensor === true ? 'yes' : t.has_sensor === false ? 'no' : 'unknown',
          status: 'mounted',
          // A trailer tire is tied to the trailer; its plate is the plate of the truck currently towing it (or empty if the trailer stands alone).
          plate: key ? plate : null,
          plateKey: key,
          trailerNumber: isTrailerTire ? (tNum || null) : null,
          positionNumber: t.position_no ?? null,
          positionLabel: S(t.position_label_ar),
          section: S(t.assembly_ar),
          isSpare,
          notes: [S(t.side), odo ? `عداد ${odo}` : ''].filter(Boolean).join(' · '),
        };
        const existing = await Ls2TireAsset.findOne({ serial });

        // The sheet does not overwrite human work.
        // The inventory is a paper snapshot; what was done from the screen afterwards happened on the ground by someone looking at the truck. If the two differ on where a tire is, the screen wins; the sheet only advances data nobody touched (type, number, sensor).
        // Touched means there is a movement on that tire after the inventory date, not from an import.
        if (existing) {
          const touched = await Ls2AssetEvent.findOne({
            refId: existing._id,
            date: { $gt: at },
            notes: { $ne: 'استيراد جرد الورشة' },
          }).sort({ date: -1 }).lean();
          if (touched && String(existing.plateKey || '') !== String(fields.plateKey || '')) {
            existing.set({
              tireNumber: fields.tireNumber, type: fields.type, sensor: fields.sensor,
            });
            await existing.save();
            sum.keptUserMoves = (sum.keptUserMoves || 0) + 1;
            userMoves.push(`${serial}: الشيت بيقول ${plate || 'تيدر ' + tNum} — وموظف نقلها لـ${existing.plate || 'المخزن'} يوم ${new Date(touched.date).toISOString().slice(0, 10)}`);
            continue;
          }
        }

        if (!existing) {
          const made = await Ls2TireAsset.create({ serial, ...fields });
          sum.tires++;
          await Ls2AssetEvent.create({
            entityType: 'tire', refId: made._id, label: serial, action: 'registered',
            date: at, odometerKm: odo, notes: 'استيراد جرد الورشة',
          });
          await Ls2AssetEvent.create({
            entityType: 'tire', refId: made._id, label: serial, action: 'mounted',
            toPlate: fields.plate, toPlateKey: fields.plateKey,
            toPosition: fields.positionLabel + (tNum && isTrailerTire ? ` — تيدر ${tNum}` : ''),
            date: at, odometerKm: odo, notes: 'استيراد جرد الورشة',
          });
          sum.events += 2;
        } else {
          existing.set(fields);
          await existing.save();
          sum.moved++;
        }
      }
    }
  }

  // Step 4: the 342 tires whose trailer is unknown
  console.log('\n── ربط كاوتش التيدر بتيدره (الموجود من قبل) ──');
  const orphans = await Ls2TireAsset.find({
    status: 'mounted', section: /تيدر|تريل/, isSpare: { $ne: true },
    $or: [{ trailerNumber: null }, { trailerNumber: '' }],
    plateKey: { $nin: [null, ''] },
  }).select('_id serial plateKey').lean();
  const byKey = new Map();
  for (const f of await Ls2Flatbed.find({ currentTrailerNumber: { $nin: [null, ''] } }).select('plateKey currentTrailerNumber').lean()) {
    byKey.set(f.plateKey, f.currentTrailerNumber);
  }
  const resolvable = orphans.filter((t) => byKey.has(t.plateKey));
  console.log(`   ${orphans.length} إطار من غير رقم تيدر · ${resolvable.length} منهم عربيتهم عليها تيدر معروف`);
  if (orphans.length !== resolvable.length) {
    const stuck = orphans.filter((t) => !byKey.has(t.plateKey));
    console.log(`   ⚠ ${stuck.length} إطار عربيتهم مالهاش تيدر مسجّل — يحتاجوا مراجعة`);
    notes.push(`${stuck.length} إطار تيدر على عربيات مالهاش تيدر مسجّل`);
  }
  if (!DRY && resolvable.length) {
    for (const [k, num] of byKey) {
      const r = await Ls2TireAsset.updateMany(
        { status: 'mounted', section: /تيدر|تريل/, isSpare: { $ne: true }, plateKey: k,
          $or: [{ trailerNumber: null }, { trailerNumber: '' }] },
        { $set: { trailerNumber: String(num) } },
      );
      sum.backfilled += r.modifiedCount || 0;
    }
  }

  console.log(`\nالنتيجة: ${JSON.stringify(sum)}`);
  if (userMoves.length) {
    console.log(`\nاتساب زي ما هو — شغل موظف أحدث من الشيت (${userMoves.length}):`);
    userMoves.forEach((n) => console.log('   ' + n));
  }
  if (notes.length) { console.log('\nملاحظات:'); notes.forEach((n) => console.log('   ' + n)); }

  if (!DRY) {
    const fb = await Ls2Flatbed.countDocuments({});
    const tr = await Ls2Trailer.countDocuments({});
    const standing = await Ls2Trailer.countDocuments({ currentPlateKey: null });
    console.log(`\nسطحاتنا: ${fb} · تيدرات: ${tr} (منها ${standing} واقف لوحده)`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
