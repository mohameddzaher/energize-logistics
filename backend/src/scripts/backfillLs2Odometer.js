/**
 * Backfill LS2 daily-odometer history so "km driven per month" works for PAST
 * months right away (the live poll only snapshots from the day it starts).
 *
 * Strategy — anchor on each unit's current Wialon odometer counter (cnm_km) and
 * walk backwards using Wialon's authoritative monthly "Mileage" report:
 *   odo(end of month M) = currentOdo − Σ km(months after M, up to now)
 * We store one snapshot per unit at the LAST day of each past month, so
 * mileageByUnit(firstOfMonth … lastOfMonth) = that month's real Wialon distance.
 * Current-month days are filled by the live poll going forward.
 *
 * Reports share one server-side slot per session, so every report runs
 * SEQUENTIALLY. ~2s/report → 57 units × N months. Idempotent (upsert by unit+date).
 *
 * Run:  node src/scripts/backfillLs2Odometer.js [months]   (default 3)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const client = require('../services/ls2Client');
const reports = require('../services/ls2Reports');
const cfg = require('../config/ls2Config');
const Ls2OdometerDaily = require('../models/Ls2OdometerDaily');
const { parseName } = require('../services/ls2Sensors');

const MONTHS = Math.max(1, Math.min(12, parseInt(process.argv[2], 10) || 3));

// Cairo is UTC+2 (no DST since 2015). Month math in Cairo local time.
const cairoEpoch = (y, m /*0-based*/, d, endOfDay = false) =>
  Math.floor(new Date(`${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}T${endOfDay ? '23:59:59' : '00:00:00'}+02:00`).getTime() / 1000);
const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

(async () => {
  if (!client.isConfigured()) { console.error('LS2 not configured (LS2_TOKEN missing).'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`\nBackfilling LS2 odometer history — last ${MONTHS} month(s).\n`);

  // Current odometer per unit (the anchor).
  const units = await client.searchUnits();
  console.log(`Fetched ${units.length} units.\n`);

  // Build the list of month windows to report on, newest → oldest, plus the
  // current partial month (now → back to its 1st) used to derive this month's start.
  const now = new Date();
  const nowY = Number(new Intl.DateTimeFormat('en', { timeZone: 'Africa/Cairo', year: 'numeric' }).format(now));
  const nowM = Number(new Intl.DateTimeFormat('en', { timeZone: 'Africa/Cairo', month: 'numeric' }).format(now)) - 1;
  const nowD = Number(new Intl.DateTimeFormat('en', { timeZone: 'Africa/Cairo', day: 'numeric' }).format(now));

  // Window list: index 0 = current month (1st → now); then each full past month.
  const windows = [];
  windows.push({ y: nowY, m: nowM, fromD: 1, toEpoch: Math.floor(now.getTime() / 1000), current: true });
  let y = nowY, m = nowM;
  for (let i = 0; i < MONTHS; i++) {
    m -= 1; if (m < 0) { m = 11; y -= 1; }
    windows.push({ y, m, fromD: 1, toEpoch: cairoEpoch(y, m, lastDayOfMonth(y, m), true), current: false });
  }

  let done = 0;
  for (const u of units) {
    const odoNow = u.cnm_km != null ? Math.round(u.cnm_km) : null;
    const { plate } = parseName(u.nm);
    if (odoNow == null) { console.log(`  skip ${u.nm} (no odometer)`); continue; }

    // Walk months newest→oldest, subtracting each window's km from the anchor.
    let runningOdo = odoNow; // odometer at the END of the window currently processed
    const ops = [];
    for (const w of windows) {
      let km = 0;
      try {
        const r = await reports.unitDistance(u.id, cairoEpoch(w.y, w.m, w.fromD), w.toEpoch);
        km = r.km || 0;
      } catch (e) {
        console.log(`  ! report failed ${plate} ${w.y}-${w.m + 1}: ${e.message}`);
      }
      // odometer at the START of this window = end − km driven in it.
      const odoStart = Math.round((runningOdo - km) * 10) / 10;
      // Snapshot the odometer at the end of the PREVIOUS (older) day = start of
      // this window. For full past months that is the last day of the month
      // BEFORE it; we store it as the last day of that older month below.
      if (!w.current) {
        // End-of-this-month odometer is `runningOdo`. Store it at month's last day.
        const day = lastDayOfMonth(w.y, w.m);
        ops.push({
          updateOne: {
            filter: { unitId: u.id, date: ymd(w.y, w.m, day) },
            update: { $set: { odometerKm: runningOdo, plate }, $setOnInsert: { unitId: u.id, date: ymd(w.y, w.m, day) } },
            upsert: true,
          },
        });
      }
      runningOdo = odoStart; // move anchor back to the start of this window
    }
    if (ops.length) await Ls2OdometerDaily.bulkWrite(ops, { ordered: false });
    done += 1;
    process.stdout.write(`\r  processed ${done}/${units.length} units…`);
  }

  console.log(`\n\nDone. Seeded end-of-month odometer for ${done} units over ${MONTHS} month(s).`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error('\nBackfill error:', e); process.exit(1); });
