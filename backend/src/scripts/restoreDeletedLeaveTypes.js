/**
 * Restores leave types that were deleted while leave requests still use them, from the deletedrecords safety net.
 * Without its type a request falls back to "deducts" (utils/leaveBalance.leaveDeducts), so non-deducting leave was taken off the balance.
 * refId is matched as ObjectId or string (the safety net has written both).
 * Idempotent: a type that exists is left alone. `--dry` lists only.
 *   node src/scripts/restoreDeletedLeaveTypes.js [--dry]
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const dry = process.argv.includes('--dry');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const orphans = await db.collection('leaverequests').aggregate([
    { $group: { _id: '$leaveType', requests: { $sum: 1 } } },
    { $lookup: { from: 'leavetypes', localField: '_id', foreignField: '_id', as: 't' } },
    { $match: { t: { $size: 0 }, _id: { $ne: null } } },
  ]).toArray();
  let restored = 0;
  for (const o of orphans) {
    const rec = await db.collection('deletedrecords').find({ model: 'LeaveType', refId: { $in: [o._id, String(o._id)] } }).sort({ deletedAt: -1 }).limit(1).next();
    if (!rec || !rec.data) { console.log(`no backup for ${o._id} (${o.requests} requests)`); continue; }
    const doc = { ...rec.data, _id: o._id };
    for (const k of ['createdAt', 'updatedAt']) if (typeof doc[k] === 'string') doc[k] = new Date(doc[k]);
    console.log(`${dry ? 'would restore' : 'restoring'} ${doc.nameAr || doc.nameEn} (${o._id}) — ${o.requests} requests, affectsBalance=${doc.affectsBalance}`);
    if (!dry) { await db.collection('leavetypes').insertOne(doc); restored += 1; }
  }
  console.log(`done: ${orphans.length} missing, ${restored} restored`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
