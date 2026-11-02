/* eslint-disable no-console */
/**
 * fixItTicketResolutionTimes: recompute IT support ticket resolution times.
 * --dry previews.
 * Resolution time was computed by subtracting UTC midnight of the ticket day from the record's save time, which is wrong in two ways: UTC midnight precedes Riyadh work start by three hours, and tickets were bulk-entered already closed, so it measured data-entry lag. The ticket date also has no time of day, so minute precision is unavailable.
 * Fix: resolvedDate becomes the declared resolution day, derived from resolvedAt in Riyadh time for past rows; duration is recomputed in whole days, stored as minutes x 1440 so dashboard and report averages keep working.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;
const CLOSED = ['resolved', 'closed'];

const dateInRiyadh = (t) => new Date(new Date(t).getTime() + RIYADH_OFFSET_MS).toISOString().slice(0, 10);

const daysBetween = (a, b) => {
  const x = Date.parse(`${a}T00:00:00Z`);
  const y = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return Math.max(0, Math.round((y - x) / 86400000));
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const ItTicket = require('../models/ItTicket');

  const rows = await ItTicket.find({})
    .select('ticketNumber status reportedAt resolvedAt resolvedDate resolutionMinutes createdAt')
    .lean();

  const ops = [];
  let cleared = 0;

  rows.forEach((t) => {
    const isClosed = CLOSED.includes(t.status);

    // An open ticket has no resolution time; some rows hold a stale value from a cancelled close.
    if (!isClosed) {
      if (t.resolutionMinutes !== undefined || t.resolvedAt || t.resolvedDate) {
        cleared += 1;
        ops.push({ updateOne: { filter: { _id: t._id }, update: { $unset: { resolutionMinutes: '', resolvedAt: '', resolvedDate: '' } } } });
      }
      return;
    }

    // Resolution day: the declared one if present, else the Riyadh-time stamp day, else the ticket day.
    const resolvedDate = t.resolvedDate
      || (t.resolvedAt ? dateInRiyadh(t.resolvedAt) : null)
      || t.reportedAt;
    if (!resolvedDate || !t.reportedAt) return;

    const days = daysBetween(t.reportedAt, resolvedDate);
    if (days === undefined) return;
    const minutes = days * 1440;

    if (t.resolvedDate === resolvedDate && t.resolutionMinutes === minutes) return;

    ops.push({
      updateOne: {
        filter: { _id: t._id },
        update: { $set: { resolvedDate, resolvedAt: new Date(`${resolvedDate}T00:00:00Z`), resolutionMinutes: minutes } },
      },
    });
  });

  console.log(`${rows.length} بلاغ · ${ops.length} يحتاج تصحيحاً (منها ${cleared} بلاغ مفتوح يحمل زمن حل)${DRY ? '   (تجربة)' : ''}`);

  rows.slice(0, 10).forEach((t) => {
    if (!CLOSED.includes(t.status)) return;
    const rd = t.resolvedDate || (t.resolvedAt ? dateInRiyadh(t.resolvedAt) : t.reportedAt);
    const d = daysBetween(t.reportedAt, rd);
    console.log(`  ${t.ticketNumber}  ${t.reportedAt} → ${rd}   ${t.resolutionMinutes} د  ⇒  ${d} يوم`);
  });

  if (ops.length && !DRY) {
    const r = await ItTicket.bulkWrite(ops, { ordered: false });
    console.log(`\nصُحّح ${r.modifiedCount} بلاغ.`);
  }
  if (DRY) console.log('\nلم يُكتب شيء. أعد التشغيل بدون --dry للتنفيذ.');
  await mongoose.disconnect();
})().catch((e) => { console.error('فشل:', e.message); process.exit(1); });
