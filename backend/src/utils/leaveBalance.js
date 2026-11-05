// Leave-balance maths for the HR section.
// The balance accrues progressively and is computed on every read (no jobs or stored counters):
// accrued = annualLeaveDays * (daysElapsed / 365); available = accrued - daysTaken
// `daysElapsed` is clamped to the contract window and starts from the actual work start date (`Employee.actualWorkStartDate`), not the contract start, with no exception. Days taken are counted from that same day (hrController.computeEmployeeBalance), so accrual and use cover one period. Leave from before the system kept records is deducted with a negative `Contract.carriedOverDays`. `scripts/auditLeaveAccrualBasis.js` lists the affected employees.

const DAY_MS = 86400000;

const toDate = (v) => (v instanceof Date ? v : v ? new Date(v) : null);

const diffDaysInclusiveFloor = (from, to) =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));

/**
 * Leave days between two YYYY-MM-DD dates, both ends included: calendar days, Friday counted like any other day.
 * A Friday exclusion existed briefly (2026-11-05) and the owner cancelled it; `countFridays` is accepted and ignored so older callers keep working.
 * Days are read in UTC from the date strings, so the count never shifts with the server's time zone.
 */
function leaveDays(startDate, endDate) {
  const a = toDate(startDate);
  const b = toDate(endDate);
  if (!a || !b) return 0;
  const diff = Math.round((b.getTime() - a.getTime()) / DAY_MS);
  if (diff < 0) return 1;
  return diff + 1;
}

/** Kept for callers that stored the rule on a request; every request now counts Fridays. */
const fridayRuleOf = () => true;
const leaveDaysOf = (leave, startDate, endDate) => leaveDays(startDate, endDate);

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
  // When accrual already runs from a work start before this contract, the earlier contracts' days are inside it, and adding what was carried would count them twice.
  const startAt = accrualStart(contract, opts);
  const coversEarlier = !!(startAt && contract?.startDate && startAt < toDate(contract.startDate));
  // A negative value is HR's deduction for leave taken before the system kept records, so it applies either way.
  const rawCarried = round2(Number(contract?.carriedOverDays) || 0);
  const carried = coversEarlier && rawCarried > 0 ? 0 : rawCarried;
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

/** First day (YYYY-MM-DD) whose leave counts as taken: the day accrual counts from, so both cover one period. Every balance reader uses this. */
const takenSince = (contract, opts = {}) => String(opts.workStartDate || contract?.startDate || '').slice(0, 10);

/** Days taken from a list of leave requests (needs `leaveType.affectsBalance` populated): approved, from takenSince, deducting. */
function countTaken(leaves, contract, opts = {}) {
  const from = takenSince(contract, opts);
  return (leaves || []).filter((l) => l.status === 'approved' && (!from || String(l.startDate || '') >= from))
    .reduce((s, l) => s + (leaveDeducts(l) ? (Number(l.days) || 0) : 0), 0);
}

/**
 * Does this leave come off the balance? HR's choice on the request wins (`deductsBalance`, set at the HR stage);
 * without one (older records), the leave type decides. Needs `leaveType` populated with `affectsBalance`.
 */
const leaveDeducts = (l) => (typeof l?.deductsBalance === 'boolean'
  ? l.deductsBalance
  : (l?.leaveType?.affectsBalance ?? true));

module.exports = { computeBalance, leaveDays, leaveDaysOf, fridayRuleOf, contractDaysElapsed, accrualStart, leaveDeducts, takenSince, countTaken };
