/* eslint-disable no-console */
// Fills balanceSnapshot.available on requests filed before it was stored. It is restated from what the request
// already holds: remaining after the leave plus the days, when the leave comes off the balance. Only adds the field.
//   node src/scripts/backfillLeaveAvailable.js [--apply]
require('dotenv').config();
const mongoose = require('mongoose');
require('../models/LeaveType');
const LeaveRequest = require('../models/LeaveRequest');
const { leaveDeducts } = require('../utils/leaveBalance');

(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const rows = await LeaveRequest.find({
    'balanceSnapshot.remainingAfter': { $type: 'number' }, 'balanceSnapshot.available': { $exists: false },
  }).select('days deductsBalance leaveType balanceSnapshot').populate('leaveType', 'affectsBalance').lean();
  const ops = rows.map((l) => {
    const snap = l.balanceSnapshot;
    const days = typeof snap.requested === 'number' ? snap.requested : (l.days || 0);
    const available = Math.round((snap.remainingAfter + (leaveDeducts(l) ? days : 0)) * 100) / 100;
    return { updateOne: { filter: { _id: l._id }, update: { $set: { 'balanceSnapshot.available': available } } } };
  });
  console.log(`${ops.length} requests to fill`);
  if (apply && ops.length) console.log('written', (await LeaveRequest.bulkWrite(ops)).modifiedCount);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
