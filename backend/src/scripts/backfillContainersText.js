/**
 * Fills customsLink.containersText on reports linked before the field existed (see models/OperationsWorkflow).
 * Idempotent: only rows whose text differs from their containers are written. `--check` reports how many would change.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.db.collection('operationsworkflows');
  const joined = { $reduce: { input: { $ifNull: ['$customsLink.containers', []] }, initialValue: '', in: { $cond: [{ $eq: ['$$value', ''] }, '$$this', { $concat: ['$$value', ' ', '$$this'] }] } } };
  const stale = { 'customsLink.clearance': { $type: 'objectId' }, $expr: { $ne: [{ $ifNull: ['$customsLink.containersText', ''] }, joined] } };
  const n = await col.countDocuments(stale);
  console.log(`reports needing containersText: ${n}`);
  if (!process.argv.includes('--check') && n) {
    const r = await col.updateMany(stale, [{ $set: { 'customsLink.containersText': joined } }]);
    console.log(`written: ${r.modifiedCount}`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
