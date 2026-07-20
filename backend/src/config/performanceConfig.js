/**
 * Performance (KPI) evaluation — company-wide defaults.
 *
 * The scoring rule, fixed across every department:
 *   weightedScore = Σ (score(1..5) × weight%)      → a number out of 5
 *   percentage    = weightedScore × 20             → 0..100%
 *   band          = which performance bracket that % falls in
 *   bonus         = looked up from the team's TIER table, in MONTHLY SALARIES
 *
 * Everything below is only the seed: super-admin edits bands, tier tables and
 * each template's criteria/weights from the Performance → Settings page, and
 * those overrides live in PerfSettings (a singleton).
 */

// Performance brackets. min inclusive, max exclusive — except the top band,
// which includes 100 so a perfect score lands somewhere.
const DEFAULT_BANDS = [
  { key: 'not_eligible', en: 'Not eligible', ar: 'غير مستحِق', min: 0, max: 70, color: 'red' },
  { key: 'good', en: 'Good', ar: 'جيد', min: 70, max: 80, color: 'amber' },
  { key: 'very_good', en: 'Very good', ar: 'جيد جداً', min: 80, max: 90, color: 'blue' },
  { key: 'excellent', en: 'Excellent', ar: 'ممتاز', min: 90, max: 100, color: 'emerald' },
];

// Bonus per tier, expressed in MONTHLY SALARIES (not currency — the system holds
// no payroll figures; a salary typed on the evaluation page is used only to show
// the cash equivalent, and is never stored on the employee).
const DEFAULT_TIERS = [
  {
    tier: 1, en: 'Tier 1', ar: 'الطبقة الأولى', cap: 1.5,
    bonus: { not_eligible: 0, good: 0.5, very_good: 1, excellent: 1.5 },
  },
  {
    tier: 2, en: 'Tier 2', ar: 'الطبقة الثانية', cap: 1,
    bonus: { not_eligible: 0, good: 0.5, very_good: 0.75, excellent: 1 },
  },
  {
    tier: 3, en: 'Tier 3', ar: 'الطبقة الثالثة', cap: 0.75,
    bonus: { not_eligible: 0, good: 0.25, very_good: 0.5, excellent: 0.75 },
  },
];

// The 1..5 answer cards shown under every criterion. A template may override the
// wording per criterion (e.g. "٥ بلا غرامات · ٤ نادرة …") but the shape is fixed.
const DEFAULT_SCALE = [
  { score: 1, en: 'Poor', ar: 'ضعيف' },
  { score: 2, en: 'Below', ar: 'دون' },
  { score: 3, en: 'Acceptable', ar: 'مقبول' },
  { score: 4, en: 'Good', ar: 'جيد' },
  { score: 5, en: 'Excellent', ar: 'ممتاز' },
];

// Evaluation periods. Quarterly is the default because bonuses are paid per quarter.
const PERIOD_TYPES = ['quarter', 'month', 'year', 'custom'];

const SCORE_MIN = 1;
const SCORE_MAX = 5;
// weightedScore is out of SCORE_MAX; ×20 turns 5 into 100%.
const PERCENT_FACTOR = 100 / SCORE_MAX;

// Resolve a percentage to its band using the (possibly customised) band list.
function bandFor(percentage, bands = DEFAULT_BANDS) {
  if (percentage == null || Number.isNaN(percentage)) return null;
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  for (const b of sorted) {
    const isTop = b === sorted[sorted.length - 1];
    if (percentage >= b.min && (isTop ? percentage <= b.max : percentage < b.max)) return b;
  }
  return sorted[0] || null;
}

/**
 * The one place the score is computed, so the API, the PDF and the live preview
 * can never disagree. `answers` = [{ weight, score }] for ANSWERED criteria only.
 *
 * Unanswered criteria are excluded and the remaining weights are renormalised,
 * so a half-finished evaluation shows a fair running score instead of one
 * dragged toward zero by questions nobody has reached yet. `complete` tells the
 * caller whether every criterion was answered.
 */
function computeScore(answers, { bands = DEFAULT_BANDS, tier = null, totalWeight = null } = {}) {
  const answered = (answers || []).filter((a) => a && a.score != null && Number.isFinite(Number(a.score)));
  const answeredWeight = answered.reduce((s, a) => s + (Number(a.weight) || 0), 0);
  const expectedWeight = totalWeight == null ? answeredWeight : Number(totalWeight);

  if (!answered.length || answeredWeight <= 0) {
    return {
      weightedScore: null, percentage: null, band: null,
      bonusMultiplier: null, answeredWeight: 0, complete: false,
    };
  }
  // Renormalise over what has actually been answered.
  const weightedScore = answered.reduce(
    (s, a) => s + (Number(a.score) * (Number(a.weight) || 0)) / answeredWeight, 0
  );
  const percentage = weightedScore * PERCENT_FACTOR;
  const band = bandFor(percentage, bands);
  const bonusMultiplier = tier && band ? (tier.bonus?.[band.key] ?? 0) : null;

  return {
    weightedScore: Math.round(weightedScore * 100) / 100,
    percentage: Math.round(percentage * 10) / 10,
    band: band ? band.key : null,
    bandLabel: band || null,
    bonusMultiplier,
    answeredWeight,
    complete: Math.abs(answeredWeight - expectedWeight) < 0.01,
  };
}

module.exports = {
  DEFAULT_BANDS,
  DEFAULT_TIERS,
  DEFAULT_SCALE,
  PERIOD_TYPES,
  SCORE_MIN,
  SCORE_MAX,
  PERCENT_FACTOR,
  bandFor,
  computeScore,
};
