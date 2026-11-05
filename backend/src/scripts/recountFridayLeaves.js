/**
 * Recounts leave requests saved under the cancelled Friday rule (countsFridays: false) as calendar days, Friday included.
 * Fixes `days`, the balance snapshot (requested, remaining after) and the flag; each change is written to the audit log. Idempotent. `--dry` lists only.
 *   node src/scripts/recountFridayLeaves.js [--dry]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { leaveDays, leaveDeducts } = require('../utils/leaveBalance');

(async () => {
  const dry = process.argv.includes('--dry');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const types = Object.fromEntries((await db.collection('leavetypes').find({}).toArray()).map((t) => [String(t._id), t]));
  const owner = await db.collection('users').findOne({ email: 'zaher@energize.com' });
  const rows = await db.collection('leaverequests').find({ countsFridays: false }).toArray();
  for (const l of rows) {
    const days = leaveDays(l.startDate, l.endDate);
    const delta = days - (Number(l.days) || 0);
    const cut = leaveDeducts({ ...l, leaveType: types[String(l.leaveType)] }) ? delta : 0;
    const emp = await db.collection('employees').findOne({ _id: l.employee }, { projection: { arabicName: 1 } });
    console.log(`${dry ? 'would fix' : 'fixing'} ${emp?.arabicName || l.employee} ${l.startDate}→${l.endDate} [${l.status}]: ${l.days} → ${days}`);
    if (dry) continue;
    const set = { days, countsFridays: true };
    if (l.balanceSnapshot && typeof l.balanceSnapshot.remainingAfter === 'number') {
      set['balanceSnapshot.requested'] = days;
      set['balanceSnapshot.remainingAfter'] = Math.round((l.balanceSnapshot.remainingAfter - cut) * 100) / 100;
    }
    await db.collection('leaverequests').updateOne({ _id: l._id }, { $set: set });
    await db.collection('auditlogs').insertOne({
      user: owner && owner._id, userName: 'Mohamed Zaher', userEmail: owner && owner.email, bySystem: false,
      action: 'update', entity: 'LeaveRequest', entityId: l._id,
      changes: { before: { days: l.days }, after: { days }, details: 'إعادة عدّ الإجازة بالأيام التقويمية — أُلغيت قاعدة استثناء الجمعة' }, createdAt: new Date(),
    });
  }
  console.log(`done: ${rows.length} request(s)${dry ? ' (dry run)' : ''}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
