/* eslint-disable no-console */
/**
 * migrateTireConditions — ينقل درجات الكاوتش للخانات الجديدة.
 *
 *   node src/scripts/migrateTireConditions.js --dry
 *   node src/scripts/migrateTireConditions.js
 *
 * المخزن كان بيقسم الكاوتش غير المركّب على خانتين منفصلتين: «مستعمل» و«مجدد».
 * التقسيمة دي ماكانتش بتفرق في الشغل — نفس الرفّ، ونفس المواضع اللي بتتركّب
 * فيها — وكانت بتغذّي قاعدة «المجدد للتيدر بس» اللي الورشة بتخالفها كل يوم
 * (بتركّبه في الأربعة اللي ورا الرأس). فاتدمجوا في خانة واحدة.
 *
 * اتّجاه الدمج مقصود: «مجدد» ⇐ «مستعمل»، مش العكس. الفردة المجدَّدة مستعملة
 * فعلًا، فالوصف يفضل صحيح؛ لكن لو دمجنا في الاتجاه التاني كنا هنوصف مئات
 * الفردات المستعملة العادية بإنها اتجدّدت في مصنع — دي حاجة مادية حصلت أو
 * ماحصلتش، ومينفعش السيستم يدّعيها.
 *
 * وفي خانة جديدة: «في المصنع» (at_factory) — الفردة اللي برّه عند مصنع التجديد
 * دلوقتي. الحالة `in_repair` هي مصدر الحقيقة لده وموجودة أصلًا، فالسكربت
 * بيولّد الدرجة منها بدل ما يخمّن.
 *
 * السكربت idempotent: بيشتغل على اللي لسه على القيم القديمة بس، وتشغيله تاني
 * بيطبع صفر من غير ما يكتب حاجة.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const Ls2TireAsset = require('../models/Ls2TireAsset');

  // بنقرا بالـ driver مباشرة: الموديل بقى enum فيه ['new','used','at_factory']،
  // فأي استعلام أو تحديث بيعدّي على mongoose هيرفض القيمة القديمة «renewed»
  // اللي إحنا أصلًا جايين نشيلها.
  const col = mongoose.connection.collection(Ls2TireAsset.collection.collectionName);

  const renewed = await col.find({ condition: 'renewed' }).project({ serial: 1, status: 1 }).toArray();
  // الحالة هي المرجع: أي فردة عند المصنع لازم درجتها تقول كده، مهما كانت
  // درجتها المسجّلة (جديدة راحت تتجدّد، أو مستعملة، أو مجددة راحت تاني مرة).
  const atFactory = await col.find({ status: 'in_repair', condition: { $nin: ['at_factory', 'new'] } })
    .project({ serial: 1, condition: 1 }).toArray();
  // والعكس: فردة درجتها «في المصنع» وهي مش عند المصنع — تناقض ما ينفعش يفضل.
  const backFromFactory = await col.find({ condition: 'at_factory', status: { $ne: 'in_repair' } })
    .project({ serial: 1, status: 1 }).toArray();

  const total = await col.countDocuments({});
  console.log(`${total} فردة في السجل${DRY ? '   (تجربة — مش هيتكتب حاجة)' : ''}`);
  console.log(`   مجدد ⇐ مستعمل            : ${renewed.length}`);
  console.log(`   في المصنع (من الحالة)     : ${atFactory.length}`);
  console.log(`   رجعت من المصنع ⇐ مستعمل  : ${backFromFactory.length}`);

  const show = (rows, fmt) => rows.slice(0, 40).forEach((t) => console.log(`      ${String(t.serial).padEnd(18)}${fmt(t)}`));
  if (renewed.length) { console.log('\n   ── مجدد ⇐ مستعمل'); show(renewed, (t) => `حالتها: ${t.status}`); }
  if (atFactory.length) { console.log('\n   ── في المصنع'); show(atFactory, (t) => `درجتها كانت: ${t.condition || '—'}`); }
  if (backFromFactory.length) { console.log('\n   ── رجعت من المصنع'); show(backFromFactory, (t) => `حالتها: ${t.status}`); }

  if (!DRY) {
    // الترتيب مهم: «مجدد ⇐ مستعمل» الأول، وبعدين الفردات اللي عند المصنع —
    // عشان الفردة المجدَّدة اللي راجعة تتجدّد تاني تخرج بدرجة at_factory مش used.
    const r1 = renewed.length ? await col.updateMany({ condition: 'renewed' }, { $set: { condition: 'used' } }) : { modifiedCount: 0 };
    const r2 = await col.updateMany({ status: 'in_repair', condition: { $nin: ['at_factory', 'new'] } }, { $set: { condition: 'at_factory' } });
    const r3 = await col.updateMany({ condition: 'at_factory', status: { $ne: 'in_repair' } }, { $set: { condition: 'used' } });

    const left = await col.countDocuments({
      $or: [
        { condition: { $nin: ['new', 'used', 'at_factory'] } },
        { status: 'in_repair', condition: { $nin: ['at_factory', 'new'] } },
        { condition: 'at_factory', status: { $ne: 'in_repair' } },
      ],
    });
    console.log(`\n✓ اتعدّل ${r1.modifiedCount} + ${r2.modifiedCount} + ${r3.modifiedCount} · باقي مخالف: ${left}`);

    const byCondition = await col.aggregate([{ $group: { _id: '$condition', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray();
    console.log('   التوزيع النهائي: ' + byCondition.map((g) => `${g._id || '(فاضي)'}=${g.n}`).join(' · '));
  }

  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
