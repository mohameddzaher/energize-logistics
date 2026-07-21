/**
 * Repair "last service" dates in Location Solutions (Wialon).
 *
 * Services registered before ls2Client.registerService accepted a date were
 * stamped with the write moment, so Wialon reports "last service: today" while
 * OUR Ls2ServiceLog holds the date the user actually entered. This pushes our
 * (authoritative) dates back to Wialon.
 *
 * Only the date field (`pt`) is written — the executions count and the
 * mileage/engine-hours readings are preserved, so no phantom services appear.
 *
 * Usage:
 *   node scripts/fixLs2ServiceDates.js          # dry run — prints the plan only
 *   node scripts/fixLs2ServiceDates.js --apply  # actually writes to Wialon
 */
require('dotenv').config();
const mongoose = require('mongoose');
const client = require('../src/services/ls2Client');
const Ls2ServiceLog = require('../src/models/Ls2ServiceLog');
const Ls2Vehicle = require('../src/models/Ls2Vehicle');

const APPLY = process.argv.includes('--apply');
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  // The authoritative date per (unit, interval) is the LATEST service we logged.
  const logs = await Ls2ServiceLog.find({ action: 'serviced', serviceDate: { $ne: null } })
    .sort({ serviceDate: 1, createdAt: 1 }).lean();
  const want = new Map();
  for (const l of logs) if (l.intervalId != null) want.set(`${l.unitId}:${l.intervalId}`, l);

  // What Wialon currently reports, from our mirror.
  const current = new Map();
  for (const v of await Ls2Vehicle.find({}).lean()) {
    for (const iv of v.serviceIntervals || []) current.set(`${v.unitId}:${iv.id}`, { iv, plate: v.plate });
  }

  const todo = [];
  for (const [key, log] of want) {
    const cur = current.get(key);
    if (!cur) continue; // interval no longer exists in Wialon
    if (day(cur.iv.lastServiceAt) === day(log.serviceDate)) continue; // already right
    todo.push({
      unitId: log.unitId,
      intervalId: log.intervalId,
      plate: cur.plate || log.plate,
      name: log.intervalName || cur.iv.name || '',
      from: day(cur.iv.lastServiceAt),
      to: day(log.serviceDate),
      date: log.serviceDate,
    });
  }
  todo.sort((a, b) => new Date(a.date) - new Date(b.date));

  console.log(`${todo.length} interval(s) to correct${APPLY ? '' : '  [DRY RUN — pass --apply to write]'}\n`);
  let ok = 0;
  const failed = [];
  for (const t of todo) {
    const label = `${String(t.plate).padEnd(10)} | ${t.name.slice(0, 22).padEnd(22)} | ${t.from} -> ${t.to}`;
    if (!APPLY) { console.log(`  [plan] ${label}`); continue; }
    try {
      await client.setServiceDate(t.unitId, t.intervalId, t.date);
      ok++;
      console.log(`  [ok]   ${label}`);
    } catch (e) {
      failed.push({ ...t, error: e.message });
      console.log(`  [FAIL] ${label}  — ${e.message}`);
    }
  }

  if (APPLY) {
    console.log(`\nCorrected: ${ok} | Failed: ${failed.length}`);
    if (ok) {
      // Refresh our mirror so the UI shows the corrected dates without waiting
      // for the next poll tick.
      try { await require('../src/jobs/ls2Poll').tick(); console.log('Mirror refreshed from Wialon.'); }
      catch (e) { console.log('Mirror refresh failed (next poll will catch up):', e.message); }
    }
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
