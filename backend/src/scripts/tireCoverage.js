/* eslint-disable no-console */
/**
 * tireCoverage — أنهي عربية مسجّل عليها كام كاوتش، ومين لسه ناقص.
 *
 *   node src/scripts/tireCoverage.js
 *
 * العربية الكاملة = **١٤ إطار**: ٦ في الرأس، ٦ في التيدر، ٢ استبن. أي رقم أقل
 * من كده معناه إن الورشة لسه ما جردتش العربية دي — مش إن العربية ناقصة كاوتش
 * فعلاً. الفرق مهم: التقرير ده قايمة شغل جرد، مش قايمة أعطال.
 *
 * المصدر: Ls2Flatbed (كل سطحاتنا) مقابل Ls2TireAsset المثبّتة عليها بالـ
 * plateKey — نفس المفتاح اللي الشاشات بتوصل بيه، فالرقم هنا هو نفس الرقم هناك.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const FULL = 14;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const Ls2Flatbed = require('../models/Ls2Flatbed');
  const Ls2TireAsset = require('../models/Ls2TireAsset');

  const flatbeds = await Ls2Flatbed.find({}).select('plate plateKey currentTrailerNumber').lean();
  const mounted = await Ls2TireAsset.find({ status: 'mounted' }).select('plateKey section isSpare').lean();

  const byKey = new Map();
  for (const t of mounted) {
    if (!t.plateKey) continue;
    const c = byKey.get(t.plateKey) || { total: 0, head: 0, trailerTires: 0, spare: 0 };
    c.total++;
    if (t.isSpare || /استبن/.test(t.section || '')) c.spare++;
    else if (/تيدر|تريل/.test(t.section || '')) c.trailerTires++;
    else c.head++;
    byKey.set(t.plateKey, c);
  }

  const rows = flatbeds.map((f) => ({
    plate: f.plate,
    trailerNo: f.currentTrailerNumber || '—',
    ...(byKey.get(f.plateKey) || { total: 0, head: 0, trailerTires: 0, spare: 0 }),
  })).sort((a, b) => a.total - b.total || String(a.plate).localeCompare(String(b.plate), 'ar'));

  const none = rows.filter((r) => r.total === 0);
  const partial = rows.filter((r) => r.total > 0 && r.total < FULL);
  const full = rows.filter((r) => r.total >= FULL);

  const show = (r) => console.log(
    `   ${String(r.plate).padEnd(14)}تيدر ${String(r.trailerNo).padEnd(6)}`
    + `${String(r.total).padStart(2)}/${FULL}    رأس ${r.head} · تيدر ${r.trailerTires} · استبن ${r.spare}`
    + (r.total > 0 && r.total < FULL ? `    ← ناقص ${FULL - r.total}` : ''),
  );

  console.log(`سطحاتنا: ${rows.length} · مكتملة (${FULL} إطار): ${full.length}`
    + ` · ناقصة: ${partial.length} · مفيهاش أي إطار: ${none.length}\n`);

  if (partial.length) { console.log(`⚠ أقل من ${FULL} إطار (${partial.length}):`); partial.forEach(show); console.log(''); }
  if (none.length) { console.log(`✗ مفيش أي كاوتش مسجّل — لسه لم تُجرَد بعد (${none.length}):`); none.forEach(show); console.log(''); }
  console.log(`✓ مكتملة (${full.length}):`);
  full.forEach(show);

  const totalMounted = mounted.filter((t) => t.plateKey).length;
  const storeTires = await Ls2TireAsset.countDocuments({ status: { $ne: 'mounted' } });
  console.log(`\nالكاوتش المثبّت: ${totalMounted} · في المخزن/التجديد: ${storeTires}`);
  console.log(`المطلوب لتغطية كل السطحات: ${rows.length * FULL} · الناقص: ${Math.max(0, rows.length * FULL - totalMounted)}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
