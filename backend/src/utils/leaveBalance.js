// Leave-balance maths for the HR section.
//
// The balance accrues *progressively* over the life of a contract: an employee
// earns their annual entitlement day-by-day, so the longer the contract has
// run, the more leave is available — reaching the full annual amount after a
// year of service. This is computed on the fly on every read (pure arithmetic,
// no jobs, no stored counters) so it is always live and instant.
//
//   accruedPerYear = contract.annualLeaveDays
//   accrued        = annualLeaveDays * (daysElapsed / 365)
//   available      = accrued - daysTaken
//
// `daysElapsed` is clamped to the contract window (never before start, never
// after end), and `daysTaken` is the sum of approved, balance-affecting leave.

const DAY_MS = 86400000;

const toDate = (v) => (v instanceof Date ? v : v ? new Date(v) : null);

const diffDaysInclusiveFloor = (from, to) =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));

// Whole-day span between two YYYY-MM-DD strings or dates, inclusive of both
// ends (a single-day leave = 1 day). Mirrors remoteController.daysBetween.
function leaveDays(startDate, endDate) {
  const a = toDate(startDate);
  const b = toDate(endDate);
  if (!a || !b) return 0;
  const diff = Math.round((b.getTime() - a.getTime()) / DAY_MS);
  return diff >= 0 ? diff + 1 : 1;
}

// Days of the contract elapsed as of `asOf`, clamped to [start, end].
function contractDaysElapsed(contract, asOf = new Date()) {
  const start = toDate(contract?.startDate);
  if (!start) return 0;
  let now = asOf < start ? start : asOf;
  const end = toDate(contract?.endDate);
  if (end && now > end) now = end;
  return diffDaysInclusiveFloor(start, now);
}

// The full progressive computation. `daysTaken` is supplied by the caller
// (sum of approved leave whose type affects the balance).
function computeBalance(contract, daysTaken = 0, asOf = new Date()) {
  const annual = Number(contract?.annualLeaveDays) || 0;
  // ما رُحِّل من العقد السابق يُضاف إلى المتاح: أيّامٌ لم تُستهلَك، ولا تسقط
  // بتجديد العقد. راجع `models/Contract.carriedOverDays`.
  const carried = round2(Number(contract?.carriedOverDays) || 0);
  if (!contract || !annual) {
    return {
      entitlement: annual, carried, accrued: 0,
      taken: round2(daysTaken), available: round2(carried - daysTaken), daysElapsed: 0,
    };
  }
  const daysElapsed = contractDaysElapsed(contract, asOf);
  const accrued = round2(annual * (daysElapsed / 365));
  const taken = round2(daysTaken);
  return {
    entitlement: annual,
    carried,
    daysElapsed,
    accrued,
    taken,
    available: round2(carried + accrued - taken),
  };
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = { computeBalance, leaveDays, contractDaysElapsed };
