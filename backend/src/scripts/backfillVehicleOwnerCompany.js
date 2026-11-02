/* eslint-disable no-console */
/**
 * backfillVehicleOwnerCompany: fill the owning company from the owner when it is by name one of the two group companies.
 * Usage: node src/scripts/backfillVehicleOwnerCompany.js (dry run) | --apply
 * Written only on a whole-name match with the vehicle_owner_company list after light normalization; the list's own nameAr is stored. Banks, individuals and ambiguous names are reported, and existing values are never touched.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

const fold = (s) => String(s || '')
  .replace(/[ً-ٟـ]/g, '')
  .replace(/^\s*شركة\s+/, '')
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/لوجيست/g, 'لوجست')
  .replace(/[\s ​-‏]+/g, '')
  .trim();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const companies = await db.collection('lookups')
    .find({ type: 'vehicle_owner_company', isActive: { $ne: false }, deleted: { $ne: true } })
    .project({ nameAr: 1 }).toArray();
  const byFold = new Map(companies.map((c) => [fold(c.nameAr), c.nameAr]));
  console.log(`الشركات في القائمة: ${companies.map((c) => c.nameAr).join(' · ')}`);

  const vehicles = await db.collection('vehiclemasters')
    .find({ isActive: { $ne: false }, $or: [{ ownerCompanyAr: null }, { ownerCompanyAr: '' }, { ownerCompanyAr: { $exists: false } }] })
    .project({ plateNumber: 1, ownerNameAr: 1 }).toArray();

  const plan = new Map(); // nameAr → [ids]
  const left = new Map(); // ownerNameAr → count
  for (const v of vehicles) {
    const hit = byFold.get(fold(v.ownerNameAr));
    if (hit) {
      if (!plan.has(hit)) plan.set(hit, []);
      plan.get(hit).push(v._id);
    } else {
      const k = v.ownerNameAr || '(فارغ)';
      left.set(k, (left.get(k) || 0) + 1);
    }
  }

  console.log(`\nمركباتٌ بلا شركةٍ مالكة: ${vehicles.length}`);
  for (const [name, ids] of plan) console.log(`  ← «${name}»: ${ids.length}`);
  const leftTotal = [...left.values()].reduce((a, b) => a + b, 0);
  console.log(`\nتُترَك بلا تخمين: ${leftTotal}`);
  for (const [k, n] of [...left.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${k}`);

  if (!APPLY) { console.log('\n— تجربةٌ فقط، لم يُكتب شيء. أعد التشغيل بـ --apply للكتابة.\n'); process.exit(0); }

  let written = 0;
  for (const [name, ids] of plan) {
    const r = await db.collection('vehiclemasters').updateMany(
      { _id: { $in: ids }, $or: [{ ownerCompanyAr: null }, { ownerCompanyAr: '' }, { ownerCompanyAr: { $exists: false } }] },
      { $set: { ownerCompanyAr: name, updatedAt: new Date() } },
    );
    written += r.modifiedCount;
  }
  console.log(`\nكُتب: ${written}. شاشاتُ السجلّ تقرأ القيمةَ الجديدة بعد انتهاء مخزونها (٣٠ ثانية) أو بعد أيّ تعديلٍ في القسم.\n`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
