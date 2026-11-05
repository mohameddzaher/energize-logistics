/**
 * Folds the duplicate «إجازة عيد» type into «اجازة عيد الفطر» / «اجازة عيد الأضحى»: each request goes to the Eid its dates fall on, then the empty duplicate is removed.
 * Both targets do not deduct, like the duplicate, so no balance changes. A request near neither Eid is left alone and reported.
 * Each moved request and the removed type are written to deletedrecords/auditlogs first. Idempotent. `--dry` lists only.
 *   node src/scripts/mergeEidLeaveType.js [--dry]
 */
require('dotenv').config();
const mongoose = require('mongoose');

// Eid dates (Saudi announcement); a leave belongs to the Eid within WINDOW days of its period.
const EIDS = [
  ['fitr', '2025-03-30'], ['adha', '2025-06-06'],
  ['fitr', '2026-03-20'], ['adha', '2026-05-27'],
  ['fitr', '2027-03-10'], ['adha', '2027-05-16'],
];
const WINDOW = 20;
const DAY = 86400000;
const t = (s) => Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`);

function eidOf(l) {
  const a = t(l.startDate); const b = t(l.endDate || l.startDate);
  let best = null;
  for (const [kind, d] of EIDS) {
    const x = t(d);
    const gap = x < a ? (a - x) / DAY : x > b ? (x - b) / DAY : 0;
    if (gap <= WINDOW && (!best || gap < best.gap)) best = { kind, gap };
  }
  return best && best.kind;
}

(async () => {
  const dry = process.argv.includes('--dry');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const types = await db.collection('leavetypes').find({}).toArray();
  const dup = types.find((x) => x.code === 'eid' && x.nameAr === 'إجازة عيد');
  const target = { fitr: types.find((x) => /عيد الفطر/.test(x.nameAr)), adha: types.find((x) => /عيد الا?ض?حى|الأضحى|الاضحى/.test(x.nameAr)) };
  if (!target.fitr || !target.adha) throw new Error('Fitr or Adha leave type not found');
  if (!dup) { console.log('no duplicate «إجازة عيد» type — nothing to do'); process.exit(0); }
  const owner = await db.collection('users').findOne({ email: 'zaher@energize.com' });

  const reqs = await db.collection('leaverequests').find({ leaveType: dup._id }).toArray();
  let moved = 0; const left = [];
  for (const l of reqs) {
    const kind = eidOf(l);
    if (!kind) { left.push(l); continue; }
    const to = target[kind];
    console.log(`${dry ? 'would move' : 'moving'} ${l._id} ${l.startDate}→${l.endDate} → ${to.nameAr}`);
    if (dry) continue;
    await db.collection('auditlogs').insertOne({ user: owner && owner._id, userName: 'Mohamed Zaher', userEmail: owner && owner.email, bySystem: false,
      action: 'update', entity: 'LeaveRequest', entityId: l._id,
      changes: { before: { leaveType: dup.nameAr }, after: { leaveType: to.nameAr }, details: 'دمج «إجازة عيد» المكررة في عيد الفطر/الأضحى' }, createdAt: new Date() });
    await db.collection('leaverequests').updateOne({ _id: l._id }, { $set: { leaveType: to._id, leaveTypeCode: to.code } });
    moved += 1;
  }
  for (const l of left) console.log(`left alone (near no Eid): ${l._id} ${l.startDate}→${l.endDate}`);

  if (!dry && (await db.collection('leaverequests').countDocuments({ leaveType: dup._id })) === 0) {
    await db.collection('deletedrecords').insertOne({ model: 'LeaveType', refId: dup._id, data: dup, deletedAt: new Date(), reason: 'duplicate of Eid al-Fitr / Eid al-Adha, merged' });
    await db.collection('leavetypes').deleteOne({ _id: dup._id });
    console.log('duplicate type removed (kept in deletedrecords)');
  }
  console.log(`done: ${reqs.length} requests, ${moved} moved, ${left.length} left${dry ? ' (dry run)' : ''}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
