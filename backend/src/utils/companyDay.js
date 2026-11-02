/**
 * Company day: day boundaries are computed in Riyadh time, not GMT.
 * Period filters used to build bounds as `$gte: new Date(`${from}T00:00:00.000Z`)` and `$lte: new Date(`${to}T23:59:59.999Z`)`, which is GMT midnight = 03:00 Riyadh. A filter 'from Jan 1' lost everything between midnight and 03:00 and gained the first three hours of the day after the last selected day: the whole window shifted three hours. In operations alone 2121 of 33917 statements fall in those three hours.
 * Some places were worse: `new Date('2026-01-01T00:00:00')` without `Z` is read in server time, so developer machine and server disagreed.
 * Why `Intl` and not a hard-coded '+03:00': Saudi Arabia has no DST so it is correct today, but a hard-coded constant fails silently when the base changes (a branch in a DST country, or `COMPANY_TZ` set to another zone). The offset is asked of the system at compute time instead of assumed.
 */

const COMPANY_TZ = process.env.COMPANY_TZ || 'Asia/Riyadh';
const DAY_MS = 24 * 60 * 60 * 1000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Zone offset in minutes at a given instant (positive east of GMT). */
function offsetMinutesAt(instant, tz = COMPANY_TZ) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).reduce((o, p) => { o[p.type] = p.value; return o; }, {});
  const asIfUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return (asIfUTC - instant.getTime()) / 60000;
}

/** First instant of a day in company time, as an absolute date. */
function startOfDay(ymd, tz = COMPANY_TZ) {
  const key = String(ymd || '').slice(0, 10);
  if (!YMD.test(key)) return null;
  const naive = new Date(`${key}T00:00:00.000Z`);
  // Estimate then correct: the offset is measured at the resulting instant, so if the estimate lands across a DST change it is corrected with that offset.
  const first = new Date(naive.getTime() - offsetMinutesAt(naive, tz) * 60000);
  const second = new Date(naive.getTime() - offsetMinutesAt(first, tz) * 60000);
  return second;
}

/** Last instant of a day in company time (23:59:59.999 there). */
function endOfDay(ymd, tz = COMPANY_TZ) {
  const s = startOfDay(ymd, tz);
  return s ? new Date(s.getTime() + DAY_MS - 1) : null;
}

/**
 * Ready Mongo range from two UI dates (YYYY-MM-DD), inclusive on both ends.
 * An empty 'to' means 'until now', not unbounded: an open range admits future-dated rows (mistyped or with reversed dates) and the user reads a larger count than happened. Disable with `openEnd: true` where the future is intended (upcoming appointment, document expiring later).
 */
function dayRange(from, to, { openEnd = false } = {}) {
  const gte = startOfDay(from);
  const lte = to ? endOfDay(to) : (openEnd ? null : new Date());
  if (!gte && !lte) return null;
  const r = {};
  if (gte) r.$gte = gte;
  if (lte) r.$lte = lte;
  return r;
}

/** Day of a date in company time, YYYY-MM-DD. */
function dayKeyOf(date, tz = COMPANY_TZ) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(d);
}

/**
 * Number of days between two dates, computed on the company calendar not on hours.
 * A millisecond difference divided by 86400000 gives zero between 11 pm and 1 am although they are two days. Days are compared, not instants.
 */
function daysBetween(fromDate, toDate) {
  const a = startOfDay(dayKeyOf(fromDate));
  const b = startOfDay(dayKeyOf(toDate));
  if (!a || !b) return null;
  return Math.round((b - a) / DAY_MS);
}

/** Days until a date on the company calendar: negative for the past, zero for the same day. */
function daysUntil(date) {
  return daysBetween(new Date(), date);
}

/** Current day in company time, YYYY-MM-DD. */
function todayKey(tz = COMPANY_TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

module.exports = {
  COMPANY_TZ, DAY_MS,
  startOfDay, endOfDay, dayRange,
  dayKeyOf, daysBetween, daysUntil, todayKey,
  offsetMinutesAt,
};
