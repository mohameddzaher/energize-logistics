/**
 * ls2DriverPerformance — تقييم أداء السائقين من التليمتري.
 *
 * "How good is this driver?" answered from what the trucks actually report, not
 * from an opinion. Two depths, because the two data sources cost very different
 * amounts:
 *
 *   • SHALLOW (free) — from the mirrored daily-odometer snapshots we already
 *     store: distance, active days, km/day, how many trucks they moved between.
 *     Instant for the whole fleet.
 *
 *   • DEEP (on demand) — runs Wialon's "Trips with Map" report for each truck the
 *     driver was on in the period. That is one upstream report PER TRUCK, so it is
 *     never done for the whole fleet implicitly: the list computes it only when
 *     asked (`deep=1`) and one driver's profile always does. Results are cached
 *     for 30 minutes — the underlying report changes only as new trips close.
 *
 * The deep pass is what the section was asked for: مدة الوصول (trip duration),
 * مدة التحميل (how long the truck sat at each end — the gap between trips), and
 * عدد الرحلات. Those three plus speed discipline and utilisation make the score.
 */
const reports = require('./ls2Reports');
const cache = require('../utils/ttlCache');

const MAX_UNITS_PER_DRIVER = 4;  // a driver on more trucks than this in one period is a data problem, not a workload

const round = (n, d = 1) => {
  const p = 10 ** d;
  return Math.round((Number(n) || 0) * p) / p;
};
const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
const secToHours = (s) => round((Number(s) || 0) / 3600, 1);

// Epoch seconds for a YYYY-MM-DD day boundary, in the fleet's local (Riyadh)
// offset — same convention the rest of the section uses for report windows.
const TZ_OFFSET_SEC = 3 * 3600;
const dayStartEpoch = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000) - TZ_OFFSET_SEC;
const dayEndEpoch = (d) => Math.floor(Date.parse(`${d}T23:59:59Z`) / 1000) - TZ_OFFSET_SEC;

/**
 * The weights behind the 0–100 score. Every metric is normalised to 0–1 first so
 * the weights stay readable and the breakdown can be shown to the driver.
 *
 * Deliberately NOT "more km = better": a driver who covers ground fast but stops
 * for six hours at every gate is not outperforming one who turns around quickly.
 */
const WEIGHTS = {
  trips: 25,        // عدد الرحلات — volume delivered
  tripSpeed: 20,    // مدة الوصول — how long a trip takes for its distance
  loading: 20,      // مدة التحميل/الانتظار — turnaround at each end
  utilisation: 15,  // أيام العمل — how much of the period they actually worked
  distance: 10,     // المسافة — raw ground covered
  safety: 10,       // الالتزام بالسرعة — over-speed discipline
};

// Reference points a "full mark" is measured against. Tuned for Saudi long-haul
// heavy transport; the section can revisit them as real numbers accumulate.
const TARGETS = {
  tripsPerActiveDay: 1.5,     // 1.5 closed trips a day ⇒ full volume mark
  kmPerActiveDay: 350,        // 350 km a day ⇒ full distance mark
  minKmPerHourDriving: 55,    // effective km/h across a trip incl. its own pauses
  goodLoadingHours: 3,        // ≤3h turnaround ⇒ full mark
  badLoadingHours: 12,        // ≥12h turnaround ⇒ zero
  utilisationDays: 0.8,       // working 80% of the period's days ⇒ full mark
};

const BANDS = [
  { min: 90, key: 'excellent', ar: 'ممتاز', en: 'Excellent', color: '#16a34a' },
  { min: 75, key: 'very_good', ar: 'جيد جدًا', en: 'Very good', color: '#22c55e' },
  { min: 60, key: 'good', ar: 'جيد', en: 'Good', color: '#eab308' },
  { min: 45, key: 'fair', ar: 'مقبول', en: 'Fair', color: '#f97316' },
  { min: 0, key: 'weak', ar: 'ضعيف', en: 'Needs improvement', color: '#ef4444' },
];
const bandOf = (score) => BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1];

// A window that ended before today can never change; one that includes today is
// still accumulating. That single distinction is what makes reports fast.
const isClosedWindow = (to) => to < new Date().toISOString().slice(0, 10);
const OPEN_WINDOW_TTL_MS = 10 * 60 * 1000;

/**
 * Deep trip metrics for ONE unit over a period.
 *
 * Three layers, cheapest first: the in-process cache (same request/burst), the
 * shared Mongo cache (any user, any process, survives restarts), then Wialon
 * itself. A closed window is written to Mongo without an expiry, so it is
 * computed exactly once, ever.
 */
async function unitTripMetrics(unitId, from, to) {
  const key = `ls2:drvperf:unit:${unitId}:${from}:${to}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const closed = isClosedWindow(to);
  const Ls2TripCache = require('../models/Ls2TripCache');
  try {
    const stored = await Ls2TripCache.findOne({ unitId: Number(unitId), from, to }).lean();
    if (stored && stored.metrics) {
      cache.set(key, stored.metrics, closed ? 60 * 60 * 1000 : OPEN_WINDOW_TTL_MS);
      return stored.metrics;
    }
  } catch (e) { /* a cache miss must never fail the report */ }

  const { trips, stops, summary } = await reports.unitTrips(unitId, dayStartEpoch(from), dayEndEpoch(to));
  const out = {
    unitId: Number(unitId),
    tripCount: summary.tripCount,
    totalKm: summary.totalKm,
    totalDriveSec: summary.totalDriveSec,
    maxSpeed: summary.maxSpeed,
    // Wialon's "stops" here are the gaps BETWEEN trips: the truck standing at the
    // place the previous trip ended. For a haulage fleet that gap is loading,
    // unloading or waiting — which is exactly the turnaround we want to measure.
    stopCount: stops.length,
    totalStopSec: stops.reduce((s, x) => s + (x.durationSec || 0), 0),
    longestStopSec: stops.reduce((m, x) => Math.max(m, x.durationSec || 0), 0),
    trips: trips.slice(0, 500),
    stops: stops.slice(0, 500),
  };
  cache.set(key, out, closed ? 60 * 60 * 1000 : OPEN_WINDOW_TTL_MS);
  try {
    await Ls2TripCache.updateOne(
      { unitId: Number(unitId), from, to },
      { $set: { metrics: out, closed, expiresAt: closed ? null : new Date(Date.now() + OPEN_WINDOW_TTL_MS) } },
      { upsert: true },
    );
  } catch (e) { /* failing to remember is not failing to answer */ }
  return out;
}

/** Merge the per-unit deep metrics of every truck a driver was on. */
function mergeUnitMetrics(list) {
  const acc = {
    tripCount: 0, totalKm: 0, totalDriveSec: 0, maxSpeed: 0,
    stopCount: 0, totalStopSec: 0, longestStopSec: 0,
  };
  for (const m of list) {
    if (!m) continue;
    acc.tripCount += m.tripCount || 0;
    acc.totalKm += m.totalKm || 0;
    acc.totalDriveSec += m.totalDriveSec || 0;
    acc.stopCount += m.stopCount || 0;
    acc.totalStopSec += m.totalStopSec || 0;
    acc.maxSpeed = Math.max(acc.maxSpeed, m.maxSpeed || 0);
    acc.longestStopSec = Math.max(acc.longestStopSec, m.longestStopSec || 0);
  }
  acc.totalKm = round(acc.totalKm, 1);
  return acc;
}

/**
 * Turn raw numbers into the 0–100 score + a per-metric breakdown.
 *
 * `deep` may be null — then the trip/loading/safety components have nothing to
 * measure and are dropped, and the remaining weights are rescaled so the score
 * stays on the same 0–100 axis instead of silently capping at 25.
 */
function scoreDriver({ km, activeDays, periodDays, deep, speedLimitKmh }) {
  const parts = [];
  const add = (key, ar, en, weight, value, detail) =>
    parts.push({ key, ar, en, weight, value: round(clamp01(value) * 100, 0), detail });

  // ── Always available (odometer-derived) ──────────────────────────────────
  add('utilisation', 'الالتزام بأيام العمل', 'Working days', WEIGHTS.utilisation,
    periodDays ? (activeDays / periodDays) / TARGETS.utilisationDays : 0,
    { activeDays, periodDays });

  const kmPerDay = activeDays ? km / activeDays : 0;
  add('distance', 'المسافة المقطوعة', 'Distance covered', WEIGHTS.distance,
    kmPerDay / TARGETS.kmPerActiveDay,
    { km: round(km, 1), kmPerActiveDay: round(kmPerDay, 1), target: TARGETS.kmPerActiveDay });

  // ── Deep only (trip report) ──────────────────────────────────────────────
  if (deep) {
    const tripsPerDay = activeDays ? deep.tripCount / activeDays : 0;
    add('trips', 'عدد الرحلات', 'Trips completed', WEIGHTS.trips,
      tripsPerDay / TARGETS.tripsPerActiveDay,
      { tripCount: deep.tripCount, tripsPerActiveDay: round(tripsPerDay, 2), target: TARGETS.tripsPerActiveDay });

    // مدة الوصول: effective km/h over the whole trip (driving time only). Slow
    // trips for their distance mean stopping, detours or crawling.
    const effKmh = deep.totalDriveSec ? (deep.totalKm / (deep.totalDriveSec / 3600)) : 0;
    add('tripSpeed', 'مدة الوصول', 'Delivery time', WEIGHTS.tripSpeed,
      effKmh / TARGETS.minKmPerHourDriving,
      {
        avgTripDurationHours: deep.tripCount ? round((deep.totalDriveSec / deep.tripCount) / 3600, 1) : 0,
        avgTripKm: deep.tripCount ? round(deep.totalKm / deep.tripCount, 1) : 0,
        effectiveKmh: round(effKmh, 1),
        target: TARGETS.minKmPerHourDriving,
      });

    // مدة التحميل: average turnaround. Lower is better, so the ratio is inverted
    // between the "good" and "bad" reference hours.
    const avgStopH = deep.stopCount ? (deep.totalStopSec / deep.stopCount) / 3600 : null;
    const loadingScore = avgStopH == null
      ? 0.5 // no completed turnaround in the period → neutral, don't punish
      : (TARGETS.badLoadingHours - avgStopH) / (TARGETS.badLoadingHours - TARGETS.goodLoadingHours);
    add('loading', 'مدة التحميل والانتظار', 'Loading / waiting time', WEIGHTS.loading, loadingScore,
      {
        avgLoadingHours: avgStopH == null ? null : round(avgStopH, 1),
        longestStopHours: secToHours(deep.longestStopSec),
        stopCount: deep.stopCount,
        goodHours: TARGETS.goodLoadingHours,
        badHours: TARGETS.badLoadingHours,
      });

    // الالتزام بالسرعة: full mark at or under the limit, zero at limit + 40 km/h.
    const over = Math.max(0, (deep.maxSpeed || 0) - speedLimitKmh);
    add('safety', 'الالتزام بالسرعة', 'Speed discipline', WEIGHTS.safety, 1 - over / 40,
      { maxSpeed: round(deep.maxSpeed, 0), limit: speedLimitKmh, overBy: round(over, 0) });
  }

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0) || 1;
  const score = round(parts.reduce((s, p) => s + (p.value / 100) * p.weight, 0) * (100 / totalWeight), 0);

  // Without the trip report only utilisation + distance were measured — a
  // quarter of the model, rescaled. That number says "this driver worked and
  // covered ground", which nearly everyone does, so it must NOT be dressed up
  // as a band: calling a driver ممتاز off two metrics is a claim we haven't
  // earned. Basic runs return a neutral, explicitly provisional label instead,
  // and the real bands appear once the deep pass has run.
  if (!deep) {
    return {
      score,
      band: 'provisional',
      bandAr: 'مؤشر مبدئي',
      bandEn: 'Provisional',
      bandColor: '#64748b',
      provisional: true,
      measured: parts.map((p) => p.key),
      depth: 'basic',
      breakdown: parts.map((p) => ({ ...p, weightPct: round((p.weight / totalWeight) * 100, 0) })),
    };
  }

  const band = bandOf(score);
  return {
    score,
    band: band.key,
    bandAr: band.ar,
    bandEn: band.en,
    bandColor: band.color,
    provisional: false,
    depth: 'deep',
    breakdown: parts.map((p) => ({ ...p, weightPct: round((p.weight / totalWeight) * 100, 0) })),
  };
}

/**
 * Deep metrics for one driver: run the trip report for every truck they were on
 * in the period (bounded), merged. Units are processed sequentially — Wialon's
 * report engine is single-session and parallel exec requests trip over each other.
 */
async function deepForDriver(unitIds, from, to) {
  const ids = [...new Set(unitIds)].slice(0, MAX_UNITS_PER_DRIVER);
  const out = [];
  for (const id of ids) {
    try {
      out.push(await unitTripMetrics(id, from, to));
    } catch (e) {
      // One unreadable truck must not void the whole driver's card.
      out.push(null);
    }
  }
  return { merged: mergeUnitMetrics(out), perUnit: out.filter(Boolean) };
}

module.exports = {
  WEIGHTS,
  TARGETS,
  BANDS,
  bandOf,
  scoreDriver,
  unitTripMetrics,
  mergeUnitMetrics,
  deepForDriver,
  dayStartEpoch,
  dayEndEpoch,
  secToHours,
  round,
};
