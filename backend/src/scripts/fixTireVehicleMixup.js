/* eslint-disable no-console */
/**
 * fixTireVehicleMixup — ست فردات مسجّلة على العربية الغلط.
 *
 *   node src/scripts/fixTireVehicleMixup.js --dry
 *   node src/scripts/fixTireVehicleMixup.js --yes
 *
 * ── المشكلة ────────────────────────────────────────────────────────────────
 * ملف «2 trucks.json» فيه ٦ سيريالات مكتوبة **مرتين**: مرة على ٧٣٦٤ ومرة على
 * ٥٩١٦، في نفس المواقع (٧، ٨، ٩، ١٠، ١٢، ١٣). فردة واحدة ما تكونش على عربيتين،
 * فواحد من الصفّين غلط.
 *
 * ── الدليل: نمرة الإطار، مش السيريال ───────────────────────────────────────
 * الورشة بتلزق على كل فردة نمرة، والنمر بتتصرف على العربية الواحدة **متتالية**
 * وقت الجرد. فالبلوك بيقول الفردة بتاعة مين:
 *
 *   ٧٣٦٤  بلوكه ٨٦–٩٩، والناقص منه:  ٩٢ ٩٣ ٩٤ ٩٥ ٩٧ ٩٨
 *   ٥٩١٦  بلوكه ٤٦٨–٤٨١، والناقص منه: ٤٧٤ ٤٧٥ ٤٧٦ ٤٧٧ ٤٧٩ ٤٨٠
 *
 * والست فردات القاعدة دلوقتي على ٧٣٦٤ نمرها ٤٧٤ ٤٧٥ ٤٧٦ ٤٧٧ ٤٧٩ ٤٨٠ — يعني
 * من بلوك ٥٩١٦ بالظبط، وبتسدّ فراغه بالظبط. الفجوتين متكاملتين، وده مش صدفة.
 *
 * يبقى: الفردات دي على **٥٩١٦**، واتسجّلت غلط على ٧٣٦٤ في استيراد ١٩ يوليو.
 *
 * ── اللي السكربت بيعمله ────────────────────────────────────────────────────
 * بينقلها لـ ٥٩١٦ بحركة `transferred` مسجّلة بالسبب — مش بيعدّل السطر القديم.
 * السجل بيفضل موجود إن العربيتين كانوا كده، والتصحيح بيتقرا في التاريخ.
 *
 * بعده: ٥٩١٦ تبقى ١٤/١٤، و٧٣٦٤ تبقى ٨/١٤ — وده **الحقيقة**، مش تراجع. الست
 * فردات بتوعها (نمر ٩٢ ٩٣ ٩٤ ٩٥ ٩٧ ٩٨) سيرياﻻتها مش معروفة أصلاً: الشيت نسخ
 * فيها سيريالات ٥٩١٦ بدل ما يكتب سيرياﻻتها. محتاجة الورشة تروح تقراها.
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

  // ① السيريالات المكتوبة مرتين في الملف
  const bySerial = new Map();
  for (const r of rows) {
    if (!bySerial.has(r.serial)) bySerial.set(r.serial, []);
    bySerial.get(r.serial).push(r);
  }
  const conflicts = [...bySerial.entries()].filter(([, v]) => v.length > 1);
  console.log(`الملف: ${rows.length} صف · ${bySerial.size} سيريال · ${conflicts.length} سيريال مكتوب أكتر من مرة${DRY ? '   (تجربة)' : ''}\n`);
  if (!conflicts.length) { console.log('مفيش تعارض — استعمل importTireInventory عادي.'); process.exit(0); }

  // ② بلوك نمر الإطارات لكل عربية: أوسع مدى متصل بين نمر العربية دي في الملف
  const plates = [...new Set(rows.map((r) => r.vehicle_plate))];
  const blocks = new Map();
  for (const p of plates) {
    const nums = rows.filter((r) => r.vehicle_plate === p).map((r) => Number(r.tire_number)).filter(Number.isFinite);
    blocks.set(p, { min: Math.min(...nums), max: Math.max(...nums) });
  }
  console.log('بلوك نمر الإطارات لكل عربية (من الملف):');
  for (const [p, b] of blocks) console.log(`     ${String(p).padEnd(14)} ${b.min}–${b.max}`);

  // ③ لكل تعارض: مين صاحب الفردة؟ اللي نمرتها المسجّلة في السيستم من بلوكه.
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
    if (currentKey === plateKey(owner)) continue;   // مظبوطة أصلاً
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

  // ④ الوضع بعد التصحيح + اللي لسه ناقص
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
