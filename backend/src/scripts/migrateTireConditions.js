/* eslint-disable no-console */
/**
 * Moves tire grades to the new slots.
 * Usage: node src/scripts/migrateTireConditions.js [--dry]
 * The store split uninstalled tires into used and renewed, which made no practical difference and fed a renewed-only-for-trailer rule the workshop breaks daily, so they merge into one. Direction is renewed to used: a renewed tire is genuinely used, whereas the reverse would claim many ordinary tires were factory-renewed, a physical fact the system must not assert.
 * New grade at_factory means the tire is currently at the renewal factory, derived from the existing in_repair status rather than guessed. Idempotent: only old values are touched and a rerun prints zero.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const Ls2TireAsset = require('../models/Ls2TireAsset');

  // Read through the driver directly: the model is now an enum of new, used, at_factory, so mongoose would reject the old renewed value being removed.
  const col = mongoose.connection.collection(Ls2TireAsset.collection.collectionName);

  const renewed = await col.find({ condition: 'renewed' }).project({ serial: 1, status: 1 }).toArray();
  // Status is the authority: any tire at the factory must carry that grade, whatever its recorded grade was.
  const atFactory = await col.find({ status: 'in_repair', condition: { $nin: ['at_factory', 'new'] } })
    .project({ serial: 1, condition: 1 }).toArray();
  // Conversely, a tire graded at-factory that is not at the factory is a contradiction that cannot remain.
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
    // Order matters: renewed to used first, then tires at the factory, so a renewed tire going back for renewal ends as at_factory, not used.
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
