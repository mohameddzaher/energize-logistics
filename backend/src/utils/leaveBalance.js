// Leave-balance maths for the HR section.
// The balance accrues progressively and is computed on every read (no jobs or stored counters):
// accrued = annualLeaveDays * (daysElapsed / 365); available = accrued - daysTaken
// `daysElapsed` is clamped to the contract window and starts from the actual work start date (`Employee.actualWorkStartDate`), not the contract start, with no exception. Earlier service has no leave record, so it is not deducted; a negative `Contract.carriedOverDays` can deduct it. `scripts/auditLeaveAccrualBasis.js` lists the affected employees.

const DAY_MS = 86400000;

const toDate = (v) => (v instanceof Date ? v : v ? new Date(v) : null);

const diffDaysInclusiveFloor = (from, to) =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));

/**
 * Leave days between two YYYY-MM-DD dates, both ends included.
 * Friday is the company's weekly day off, so it is not a leave day unless `countFridays` (the leave type's choice, e.g. sick leave counted in calendar days).
 * Days are read in UTC from the date strings, so the weekday never shifts with the server's time zone.
 */
const FRIDAY = 5;
function leaveDays(startDate, endDate, { countFridays = true } = {}) {
  const a = toDate(startDate);
  const b = toDate(endDate);
  if (!a || !b) return 0;
  const diff = Math.round((b.getTime() - a.getTime()) / DAY_MS);
  if (diff < 0) return 1;
  const span = diff + 1;
  if (countFridays) return span;
  const full = Math.floor(span / 7);
  let fridays = full;
  const startDay = a.getUTCDay();
  for (let i = 0; i < span % 7; i += 1) if ((startDay + i) % 7 === FRIDAY) fridays += 1;
  return span - fridays;
}

/**
 * The Friday rule of a request: from its leave type when the type is given (a new or re-typed request, written onto the request), else the rule stored on the request.
 * Requests from before the rule have none stored and keep counting calendar days, so their days and balances never change after the fact.
 */
function fridayRuleOf(leave, leaveType) {
  if (leaveType) return leaveType.countsFridays === true;
  return !(leave && leave.countsFridays === false);
}
const leaveDaysOf = (leave, startDate, endDate, leaveType) => leaveDays(startDate, endDate, { countFridays: fridayRuleOf(leave, leaveType) });

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

/**
 * Does this leave come off the balance? HR's choice on the request wins (`deductsBalance`, set at the HR stage);
 * without one (older records), the leave type decides. Needs `leaveType` populated with `affectsBalance`.
 */
const leaveDeducts = (l) => (typeof l?.deductsBalance === 'boolean'
  ? l.deductsBalance
  : (l?.leaveType?.affectsBalance ?? true));

module.exports = { computeBalance, leaveDays, leaveDaysOf, fridayRuleOf, contractDaysElapsed, accrualStart, leaveDeducts };
