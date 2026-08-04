/**
 * ls2TripWarm — pre-computes trip metrics so nobody waits for them.
 *
 * Trip data comes from Wialon one truck at a time (the report engine has a
 * single slot), at ~4s each. Cached, a driver or vehicle report is instant — but
 * only for the SECOND person to ask. This job makes sure that person is never a
 * manager sitting in front of a spinner: it walks the fleet in the quiet hours
 * and fills the cache for the windows people actually report on.
 *
 * Two rules that make it safe to run against a live system:
 *
 *  1. ONE unit at a time, awaited. Every report enqueues on the shared Wialon
 *     queue, so if this job queued all 57 trucks at once a live request would
 *     wait behind all of them. Enqueuing one and waiting means a live request
 *     ever only queues behind a single in-flight report (~4s).
 *
 *  2. Closed windows only get computed once, ever — Ls2TripCache stores them
 *     without an expiry — so each nightly pass does real work only for the
 *     trucks and months it has not already covered.
 */
const Ls2Vehicle = require('../models/Ls2Vehicle');
const Ls2TripCache = require('../models/Ls2TripCache');
const perf = require('../services/ls2DriverPerformance');
const cfg = require('../config/ls2Config');

let timer = null;
let running = false;

const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * The windows worth pre-computing: the current month so far, and the previous
 * two whole months. Those cover "this month", "last month" and a quarter's worth
 * of look-back, which is what the report pickers default to.
 */
function windowsToWarm(now = new Date()) {
  const out = [];
  const firstOfThis = new Date(now.getFullYear(), now.getMonth(), 1);
  out.push({ from: key(firstOfThis), to: key(now) }); // month to date (open)
  for (let back = 1; back <= 2; back++) {
    const start = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - back + 1, 0); // last day
    out.push({ from: key(start), to: key(end) }); // whole month (closed)
  }
  return out;
}

async function warmOnce({ log = true } = {}) {
  if (running) return { skipped: 'already-running' };
  if (!cfg.isConfigured()) return { skipped: 'not-configured' };
  running = true;
  const started = Date.now();
  let computed = 0; let skipped = 0; let failed = 0;
  try {
    const units = await Ls2Vehicle.find({}).select('unitId').lean();
    const windows = windowsToWarm();

    for (const w of windows) {
      for (const u of units) {
        // Already known? Closed windows are stored permanently, so this is the
        // common case after the first pass and costs one indexed lookup.
        const have = await Ls2TripCache.findOne({ unitId: u.unitId, from: w.from, to: w.to })
          .select('_id').lean().catch(() => null);
        if (have) { skipped += 1; continue; }
        try {
          // One at a time, awaited — see rule 1 in the header.
          await perf.unitTripMetrics(u.unitId, w.from, w.to);
          computed += 1;
        } catch (e) {
          failed += 1; // an unreadable truck must not stop the sweep
        }
      }
    }
    const secs = Math.round((Date.now() - started) / 1000);
    if (log && (computed || failed)) {
      console.log(`[ls2TripWarm] computed ${computed}, cached ${skipped}, failed ${failed} in ${secs}s`);
    }
    return { computed, skipped, failed, seconds: secs };
  } finally {
    running = false;
  }
}

/**
 * Run nightly. The first pass is deliberately delayed well past boot so it never
 * competes with the startup burst, and the interval is long because the work it
 * does shrinks to almost nothing once the back-catalogue is cached.
 */
function startLs2TripWarm() {
  if (!cfg.isConfigured()) return;
  if (timer) return;
  const FIRST_DELAY_MS = 10 * 60 * 1000; // 10 min after boot
  const EVERY_MS = 12 * 60 * 60 * 1000;  // twice a day
  setTimeout(() => { warmOnce().catch(() => {}); }, FIRST_DELAY_MS);
  timer = setInterval(() => { warmOnce().catch(() => {}); }, EVERY_MS);
  console.log('LS2 trip-cache warmer scheduled (first pass in 10 min, then every 12h)');
}

module.exports = { startLs2TripWarm, warmOnce, windowsToWarm };
