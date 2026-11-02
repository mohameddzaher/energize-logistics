/* eslint-disable no-console */
/**
 * fixTireVehicleMixup: six tires registered on the wrong vehicle. --dry previews, --yes applies.
 * 2 trucks.json lists six serials under both 7364 and 5916. The tire numbers decide: the workshop numbers tires consecutively per truck; 5916's block 468-481 is missing exactly 474 475 476 477 479 480, the numbers on the six tires now on 7364.
 * They are moved to 5916 with a recorded transferred movement, leaving the old row. Result: 5916 is 14/14, 7364 is 8/14; the other six tires on 7364 (numbers 92 93 94 95 97 98) have unknown serials and need the workshop.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const DRY = !process.argv.includes('--yes');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const Ls2TireAsset = require('../models/Ls2TireAsset');
  const Ls2AssetEvent = require('../models/Ls2AssetEvent');
  const { plateKey } = require('../utils/plateKey');

  const file = path.join(__dirname, '..', 'data', 'masters', '2 trucks.json');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));

  // 1) serials written twice in the file
  const bySerial = new Map();
  for (const r of rows) {
    if (!bySerial.has(r.serial)) bySerial.set(r.serial, []);
    bySerial.get(r.serial).push(r);
  }
  const conflicts = [...bySerial.entries()].filter(([, v]) => v.length > 1);
  console.log(`الملف: ${rows.length} صف · ${bySerial.size} سيريال · ${conflicts.length} سيريال مكتوب أكتر من مرة${DRY ? '   (تجربة)' : ''}\n`);
  if (!conflicts.length) { console.log('مفيش تعارض — استعمل importTireInventory عادي.'); process.exit(0); }

  // 2) each truck's tire-number block: the widest contiguous range of that truck's numbers in the file
  const plates = [...new Set(rows.map((r) => r.vehicle_plate))];
  const blocks = new Map();
  for (const p of plates) {
    const nums = rows.filter((r) => r.vehicle_plate === p).map((r) => Number(r.tire_number)).filter(Number.isFinite);
    blocks.set(p, { min: Math.min(...nums), max: Math.max(...nums) });
  }
  console.log('بلوك نمر الإطارات لكل عربية (من الملف):');
  for (const [p, b] of blocks) console.log(`     ${String(p).padEnd(14)} ${b.min}–${b.max}`);

  // 3) for each conflict, the owner is the truck whose block contains the number registered in the system
  const moves = []; const unresolved = [];
  for (const [serial, dupRows] of conflicts) {
    const live = await Ls2TireAsset.findOne({ serial }).lean();
    if (!live) { unresolved.push(`${serial}: مش في السيستم`); continue; }
    const tag = Number(live.tireNumber);
    const owner = plates.find((p) => {
      const b = blocks.get(p);
      return Number.isFinite(tag) && tag >= b.min && tag <= b.max;
    });
    if (!owner) { unresolved.push(`${serial}: نمرتها ${live.tireNumber} مش في بلوك أي عربية`); continue; }
    const target = dupRows.find((r) => r.vehicle_plate === owner);
    if (!target) { unresolved.push(`${serial}: البلوك بيقول ${owner} بس مفيش صف ليها`); continue; }
    const currentKey = plateKey(live.plate || '');
    if (currentKey === plateKey(owner)) continue;   // Already correct
    moves.push({ serial, live, target, owner, tag });
  }

  console.log(`\nالقرار (بنمرة الإطار): ${moves.length} فردة مسجّلة على العربية الغلط`);
  for (const mv of moves) {
    console.log(`     ${mv.serial.padEnd(14)} نمرة ${String(mv.tag).padEnd(5)}`
      + `${String(mv.live.plate).padEnd(12)} موقع ${String(mv.live.positionNumber).padStart(2)}`
      + `  →  ${String(mv.owner).padEnd(12)} موقع ${String(mv.target.position_number).padStart(2)}`);
  }
  if (unresolved.length) {
    console.log(`\n⚠ محتاجة قرار بشري (${unresolved.length}):`);
    unresolved.forEach((u) => console.log('     ' + u));
  }

  if (!DRY && moves.length) {
    for (const mv of moves) {
      const toKey = plateKey(mv.owner);
      const from = {
        plate: mv.live.plate, key: mv.live.plateKey,
        pos: `${mv.live.positionLabel || ''}${mv.live.section ? ` — ${mv.live.section}` : ''}`,
      };
      await Ls2TireAsset.updateOne({ _id: mv.live._id }, {
        $set: {
          plate: mv.owner, plateKey: toKey, status: 'mounted',
          positionNumber: mv.target.position_number,
          positionLabel: mv.target.position_label_ar || '',
          section: mv.target.section_ar || mv.target.section || '',
          isSpare: /استبن/.test(String(mv.target.section_ar || '')),
        },
      });
      await Ls2AssetEvent.create({
        entityType: 'tire', refId: mv.live._id, label: mv.serial, action: 'transferred',
        fromPlate: from.plate, fromPlateKey: from.key, fromPosition: from.pos,
        toPlate: mv.owner, toPlateKey: toKey,
        toPosition: `${mv.target.position_label_ar || ''} — ${mv.target.section_ar || ''}`,
        odometerKm: mv.target.odometer_km ?? null,
        reason: `تصحيح تسجيل: نمرة الإطار ${mv.tag} من بلوك ${mv.owner}، اتسجّلت غلط على ${from.plate}`,
        notes: 'تصحيح بيانات — الفردة ما اتحركتش فعليًا',
      });
    }
    console.log(`\n✓ اتنقلت ${moves.length} فردة، وكل واحدة معاها سبب في السجل`);
  }

  // 4) state after the fix and what is still missing
  const FULL = 14;
  console.log('\nالوضع:');
  for (const p of plates) {
    const key = plateKey(p);
    const on = await Ls2TireAsset.find({ plateKey: key, status: 'mounted' }).select('positionNumber tireNumber').lean();
    const have = new Set(on.map((x) => x.positionNumber));
    const missing = rows.filter((r) => r.vehicle_plate === p && !have.has(r.position_number));
    console.log(`     ${String(p).padEnd(14)} ${on.length}/${FULL}`
      + (missing.length ? `   ناقص المواقع: ${missing.map((r) => r.position_number).sort((a, b) => a - b).join(', ')}` : '   مكتملة'));
    if (missing.length) {
      console.log('        الفردات دي سيرياﻻتها في الشيت مكرّرة من العربية التانية — محتاجة تتقرا من على الأرض:');
      missing.forEach((r) => console.log(`          موقع ${String(r.position_number).padStart(2)}  ${(r.position_label_ar || '').padEnd(22)}`
        + `نمرة ${r.tire_number}  (${r.brand})`));
    }
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
