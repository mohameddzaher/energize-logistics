/**
 * Recurring business review meetings (the daily meeting and the like).
 * Each scheduled day gets its own BrMeeting: its own attendance, minutes and actions, one minutes section per department.
 * Generation is idempotent: the unique (series, seriesDay) index makes a second worker or a second click return the existing meeting.
 */
const { BrSeries, BrMeeting } = require('../models/BusinessReview');
const User = require('../models/User');
require('../models/Employee');
const { startOfDay, todayKey, COMPANY_TZ } = require('../utils/companyDay');
const { sectionLabel } = require('../config/sections');

const fullName = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

/** Weekday (0 = Sunday) of a company day. */
const weekdayOf = (ymd) => new Date(`${ymd}T12:00:00.000Z`).getUTCDay();

/** Instant of HH:mm on a company day. */
function at(ymd, hhmm) {
  const [h, m] = String(hhmm || '09:00').split(':').map(Number);
  return new Date(startOfDay(ymd).getTime() + ((h || 0) * 60 + (m || 0)) * 60000);
}

const dmy = (ymd) => ymd.split('-').reverse().join('/');

/** Ensure the meeting of `series` on `ymd` exists; returns { meeting, created }. Skips days not in the schedule unless forced. */
async function ensureDay(series, ymd = todayKey(), { force = false, actor = null } = {}) {
  if (!series || (!series.active && !force)) return { meeting: null, created: false };
  if (!force && !(series.weekdays || []).includes(weekdayOf(ymd))) return { meeting: null, created: false };
  const existing = await BrMeeting.findOne({ series: series._id, seriesDay: ymd });
  if (existing) return { meeting: existing, created: false };

  const users = await User.find({ _id: { $in: series.attendees || [] }, isActive: { $ne: false } })
    .select('firstName lastName role linkedEmployee').populate('linkedEmployee', 'department').lean();
  const departments = series.departments || [];
  try {
    const meeting = await BrMeeting.create({
      title: `${series.title} — ${dmy(ymd)}`,
      cadence: series.cadence || 'daily',
      departments,
      scheduledAt: at(ymd, series.time),
      durationMinutes: series.durationMinutes || 30,
      location: series.location || '',
      meetingLink: series.meetingLink || '',
      attendees: users.map((u) => ({
        user: u._id, name: fullName(u), role: u.role, department: u.linkedEmployee?.department || '', attendance: 'invited',
      })),
      // Each department reports in its own turn and gets its own section of the minutes.
      agenda: departments.map((d, i) => ({ title: `متابعة ${sectionLabel(d, 'ar')}`, department: d, order: i })),
      minutes: departments.map((d, i) => ({ heading: sectionLabel(d, 'ar'), body: '', department: d, order: i })),
      series: series._id,
      seriesDay: ymd,
      createdBy: actor?._id || series.createdBy || null,
      createdByName: actor ? fullName(actor) : (series.createdByName || ''),
      scribe: actor?._id || series.createdBy || null,
      scribeName: actor ? fullName(actor) : (series.createdByName || ''),
    });
    return { meeting, created: true };
  } catch (e) {
    if (e && e.code === 11000) return { meeting: await BrMeeting.findOne({ series: series._id, seriesDay: ymd }), created: false };
    throw e;
  }
}

/** Today's meetings for every active schedule; called by the hourly sweep and at boot. */
async function generateToday() {
  const ymd = todayKey();
  const list = await BrSeries.find({ active: true }).lean();
  const created = [];
  for (const s of list) {
    try {
      const r = await ensureDay(s, ymd);
      if (r.created) created.push(r.meeting);
    } catch (e) { console.error('[brSeries] generate:', s.title, e.message); }
  }
  return created;
}

module.exports = { ensureDay, generateToday, weekdayOf, COMPANY_TZ };
