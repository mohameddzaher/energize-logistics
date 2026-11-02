/* eslint-disable no-console */
/**
 * backfillTireIsSpare: align the isSpare flag with the tire's section.
 * Usage: node src/scripts/backfillTireIsSpare.js --dry | (no flag to write)
 * The model stores "is this tire a spare" in its own field so screens can filter on it, with the section (head / trailer / spare) as text beside it. They should agree, but an old import recorded ten tires with section spare and flag false, so a screen counting by flag showed "head 7, spare 1" on a truck split 6 and 2. The display is right; the data is wrong.
 * The section is the reference because it comes from the workshop sheet; the flag is derived from it.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const SPARE = /استبن/;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const Ls2TireAsset = require('../models/Ls2TireAsset');

  const all = await Ls2TireAsset.find({}).select('serial section isSpare plate positionNumber').lean();
  const shouldBe = (t) => SPARE.test(String(t.section || ''));
  const wrong = all.filter((t) => shouldBe(t) !== !!t.isSpare);

  console.log(`${all.length} فردة · ${wrong.length} علَمها مش مطابق لقسمها${DRY ? '   (تجربة)' : ''}`);
  wrong.forEach((t) => console.log(`   ${t.serial.padEnd(16)} ${(t.plate || 'مخزن').padEnd(14)}`
    + `موقع ${String(t.positionNumber ?? '—').padEnd(4)}${(t.section || '—').padEnd(12)}`
    + `isSpare: ${t.isSpare} → ${shouldBe(t)}`));

  if (!DRY && wrong.length) {
    for (const t of wrong) {
      await Ls2TireAsset.updateOne({ _id: t._id }, { $set: { isSpare: shouldBe(t) } });
    }
    const left = (await Ls2TireAsset.find({}).select('section isSpare').lean())
      .filter((t) => SPARE.test(String(t.section || '')) !== !!t.isSpare).length;
    console.log(`\n✓ اتظبط ${wrong.length} · باقي مش مطابق: ${left}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
