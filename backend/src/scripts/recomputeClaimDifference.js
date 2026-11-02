/**
 * recomputeClaimDifference: the claim 'difference' is computed for closed claims only.
 * Usage: node src/scripts/recomputeClaimDifference.js [--apply] (dry run by default). Open claims are cleared, closed ones recomputed (see claimDifference in vehicleRegistryController).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const APPLY = process.argv.includes('--apply');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const VehicleClaim = require('../models/VehicleClaim');
  const { _claimDifference } = require('../controllers/vehicleRegistryController');
  const rows = await VehicleClaim.find({}).select('statusCode claim').lean();
  const ops = []; let cleared = 0; let closed = 0; let sumBefore = 0; let sumAfter = 0;
  for (const r of rows) {
    const next = _claimDifference(r);
    const cur = r.claim?.recoveryGapSar ?? null;
    sumBefore += Number(cur) || 0; sumAfter += Number(next) || 0;
    if (cur === next) continue;
    if (next === null) cleared += 1; else closed += 1;
    ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { 'claim.recoveryGapSar': next } } } });
  }
  console.log(`مطالبات: ${rows.length} · مقفلة: ${rows.filter((r) => r.statusCode === 'closed').length}`);
  console.log(`تُفرَّغ (مفتوحة): ${cleared} · يُعاد حسابُها (مقفلة): ${closed}`);
  console.log(`مجموعُ الفرق: قبل ${sumBefore} ← بعد ${sumAfter}`);
  if (APPLY && ops.length) { const r = await VehicleClaim.bulkWrite(ops); console.log(`نُفِّذ: ${r.modifiedCount}`); }
  else if (!APPLY) console.log('للتنفيذ: --apply');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
