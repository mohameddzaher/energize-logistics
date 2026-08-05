/* eslint-disable no-console */
/**
 * backfillTireIsSpare — يظبّط علَم `isSpare` من قسم الإطار.
 *
 *   node src/scripts/backfillTireIsSpare.js --dry
 *   node src/scripts/backfillTireIsSpare.js
 *
 * الموديل بيخزّن «هل الفردة دي استبن؟» في حقل مستقل عشان الشاشات تفلتر عليه،
 * والقسم (الرأس / التريلة / الاستبن) نص جنبه. الاتنين المفروض يقولوا نفس
 * الحاجة، لكن استيراد قديم سجّل عشر فردات قسمها «الاستبن» وعلَمها false —
 * فالشاشة اللي بتعدّ بالعلَم كانت بتقول «رأس ٧ · استبن ١» على عربية تقسيمتها
 * ٦ و٢. الرقم مش غلط في العرض، الغلط في الداتا نفسها.
 *
 * القسم هو المرجع هنا: هو اللي جاي من كشف الورشة، والعلَم مشتق منه.
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
