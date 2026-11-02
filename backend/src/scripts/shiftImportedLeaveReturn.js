/**
 * Restores the return date of imported leaves to the sheet value (+1 day).
 * The sheet's duration is return minus departure, so it excludes the return day, while our count is inclusive. Import had subtracted a day from the return date; the sheet is the comparison reference, so the date is restored and the duration follows (+1). Only rows imported from that sheet (reason carries the import tag) are touched, not leaves HR entered by hand.
 * Usage: node src/scripts/shiftImportedLeaveReturn.js [--apply] [--undo --apply]; previews without --apply.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LeaveRequest = require(`${ROOT}/models/LeaveRequest`);
const { leaveDays } = require(`${ROOT}/utils/leaveBalance`);

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const STEP = UNDO ? -1 : 1;
const IMPORT_TAG = 'مستورَدة من ملفّ إجازات الموظفين';

/** YYYY-MM-DD plus days gives YYYY-MM-DD, using calendar arithmetic rather than string handling. */
const shift = (ymd, days) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const rows = await LeaveRequest.find({ reason: new RegExp(IMPORT_TAG) })
    .select('employee startDate endDate days leaveTypeCode reason').lean();
  console.log(`إجازاتٌ مستورَدة: ${rows.length}${UNDO ? ' (رجوع: −يوم)' : ' (+يوم على العودة)'}`);
  if (!rows.length) { await mongoose.disconnect(); return; }

  const plan = [];
  for (const r of rows) {
    const nextEnd = shift(r.endDate, STEP);
    if (!nextEnd) { console.log(`   ✗ تاريخٌ غيرُ مقروء: ${r._id} «${r.endDate}»`); continue; }
    const nextDays = leaveDays(r.startDate, nextEnd);
    if (nextEnd === r.endDate && nextDays === r.days) continue;
    plan.push({ r, nextEnd, nextDays });
  }
  console.log(`   ستُعدَّل: ${plan.length}`);
  const sample = plan.slice(0, 5);
  sample.forEach(({ r, nextEnd, nextDays }) => console.log(`      ${r.startDate} → ${r.endDate} (${r.days} يومًا)  ⇒  ${r.startDate} → ${nextEnd} (${nextDays} يومًا)`));

  // Overlaps created by the shift are reported before applying.
  // Adding a day restores adjacency, e.g. an annual leave ending the day a holiday leave starts. The system blocks two leaves on one day, but these are existing rows, not new requests, so nothing blocks them; they would count two days in the balance.
  const byEmp = new Map();
  for (const { r, nextEnd } of plan) {
    const k = String(r.employee);
    if (!byEmp.has(k)) byEmp.set(k, []);
    byEmp.get(k).push({ id: String(r._id), start: r.startDate, end: nextEnd });
  }
  let clashes = 0;
  for (const [, list] of byEmp) {
    list.sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].start <= list[i - 1].end) {
        clashes += 1;
        if (clashes <= 6) console.log(`      ⚠ تلاصقٌ: ${list[i - 1].start}→${list[i - 1].end} ثمّ ${list[i].start}→${list[i].end}`);
      }
    }
  }
  console.log(`   أزواجٌ ستتلاصق أو تتداخل: ${clashes}`);

  if (!APPLY) { console.log('\n(عرضٌ فقط — أضِف --apply)'); await mongoose.disconnect(); return; }

  let done = 0;
  for (const { r, nextEnd, nextDays } of plan) {
    // eslint-disable-next-line no-await-in-loop
    await LeaveRequest.updateOne({ _id: r._id }, { $set: { endDate: nextEnd, days: nextDays } });
    done += 1;
  }
  const after = await LeaveRequest.aggregate([
    { $match: { reason: new RegExp(IMPORT_TAG) } },
    { $group: { _id: null, n: { $sum: 1 }, days: { $sum: '$days' } } },
  ]);
  console.log(`\nعُدِّلت ${done} إجازة · المجموعُ الآن: ${after[0]?.n || 0} إجازة · ${after[0]?.days || 0} يومًا`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
