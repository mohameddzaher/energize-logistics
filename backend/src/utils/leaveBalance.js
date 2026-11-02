// Leave-balance maths for the HR section.
// The balance accrues progressively and is computed on every read (no jobs or stored counters):
// accrued = annualLeaveDays * (daysElapsed / 365); available = accrued - daysTaken
// `daysElapsed` is clamped to the contract window and starts from the actual work start date (`Employee.actualWorkStartDate`), not the contract start, with no exception. Earlier service has no leave record, so it is not deducted; a negative `Contract.carriedOverDays` can deduct it. `scripts/auditLeaveAccrualBasis.js` lists the affected employees.

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

/**
 * Day counting starts from: actual work start if known, otherwise contract start.
 * `opts.workStartDate` comes from `Employee.actualWorkStartDate`; `opts.contracts` is the employee's contract count. See the file header for why.
 */
function accrualStart(contract, opts = {}) {
  const work = toDate(opts.workStartDate);
  if (work) return work;                 // Work start is the basis, with no exception.
  return toDate(contract?.startDate);    // No work start recorded: count from the contract.
}

// Days elapsed as of `asOf`, from the accrual start, clamped to the contract end.
function contractDaysElapsed(contract, asOf = new Date(), opts = {}) {
  const start = accrualStart(contract, opts);
  if (!start) return 0;
  let now = asOf < start ? start : asOf;
  const end = toDate(contract?.endDate);
  if (end && now > end) now = end;
  return diffDaysInclusiveFloor(start, now);
}

// The full progressive computation. `daysTaken` is supplied by the caller
// (sum of approved leave whose type affects the balance).
function computeBalance(contract, daysTaken = 0, asOf = new Date(), opts = {}) {
  const annual = Number(contract?.annualLeaveDays) || 0;
  // Days carried over from the previous contract are added to the available balance: unused days do not lapse on renewal. See `models/Contract.carriedOverDays`.
  const carried = round2(Number(contract?.carriedOverDays) || 0);
  if (!contract || !annual) {
    return {
      entitlement: annual, carried, accrued: 0,
      taken: round2(daysTaken), available: round2(carried - daysTaken), daysElapsed: 0,
    };
  }
  const daysElapsed = contractDaysElapsed(contract, asOf, opts);
  const accrued = round2(annual * (daysElapsed / 365));
  const taken = round2(daysTaken);
  const start = accrualStart(contract, opts);
  return {
    entitlement: annual,
    carried,
    daysElapsed,
    accrued,
    taken,
    available: round2(carried + accrued - taken),
    // Also report the counting start day and its date, so a balance that differs from expectation explains itself.
    accrualFrom: start ? start.toISOString().slice(0, 10) : '',
    accrualBasis: start && opts.workStartDate && start.toISOString().slice(0, 10) === String(opts.workStartDate).slice(0, 10)
      ? 'workStart' : 'contract',
  };
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = { computeBalance, leaveDays, contractDaysElapsed, accrualStart };
