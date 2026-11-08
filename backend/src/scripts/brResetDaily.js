/**
 * Business review: clear the trial meetings and tasks and set up the daily meeting.
 * Dry run by default (prints what it would do). `--apply` backs up every BR collection to JSON first, then deletes meetings, actions and delegations, and creates the daily schedule (today's meeting is generated with it).
 * Usage: node src/scripts/brResetDaily.js [--apply] [--time=09:00]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  // Standalone: register every model so populate never meets a missing schema.
  fs.readdirSync(path.join(__dirname, '../models')).forEach((f) => { if (f.endsWith('.js')) require(`../models/${f}`); });
  const { BrMeeting, BrAction, BrAssignment, BrSeries } = require('../models/BusinessReview');
  const User = mongoose.model('User');
  const { sectionOfRole } = require('../config/roles');
  const { todayKey } = require('../utils/companyDay');
  const apply = process.argv.includes('--apply');
  const time = (process.argv.find((a) => a.startsWith('--time=')) || '--time=09:00').slice(7);

  const [meetings, actions, assignments, series] = await Promise.all([
    BrMeeting.find({}).lean(), BrAction.find({}).lean(), BrAssignment.find({}).lean(), BrSeries.find({}).lean(),
  ]);
  console.log(`meetings ${meetings.length}, actions ${actions.length}, delegations ${assignments.length}, schedules ${series.length}`);
  for (const m of meetings) console.log(`  ${m.refNumber} · ${m.title} · ${m.status}`);

  // Department heads: active users whose *_manager role belongs to a section.
  const users = await User.find({ isActive: { $ne: false }, role: /_manager$/ }).select('firstName lastName role').lean();
  const heads = users.filter((u) => sectionOfRole(u.role));
  const departments = [...new Set(heads.map((u) => sectionOfRole(u.role)))];
  console.log(`daily meeting: ${time}, Sun–Thu, ${departments.length} departments, ${heads.length} attendees`);
  for (const u of heads) console.log(`  ${u.firstName} ${u.lastName} · ${u.role} → ${sectionOfRole(u.role)}`);

  if (!apply) { console.log('\nDry run. Re-run with --apply.'); process.exit(0); }

  const dir = '/opt/energize/backups';
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `business-review-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ meetings, actions, assignments, series }, null, 1));
  console.log(`backup: ${file}`);

  await BrAssignment.deleteMany({});
  await BrAction.deleteMany({});
  await BrMeeting.deleteMany({});
  console.log('trial meetings, tasks and delegations removed');

  let s = await BrSeries.findOne({ title: 'الاجتماع اليومي' });
  if (!s) {
    s = await BrSeries.create({
      title: 'الاجتماع اليومي', cadence: 'daily', weekdays: [0, 1, 2, 3, 4], time, durationMinutes: 30,
      departments, attendees: heads.map((u) => u._id), location: 'مقر الشركة', active: true, createdByName: 'النظام',
    });
  }
  const r = await require('../services/brSeries').ensureDay(s, todayKey());
  console.log(`schedule ${s._id}; today's meeting ${r.meeting ? r.meeting.refNumber : 'not a scheduled day'}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
