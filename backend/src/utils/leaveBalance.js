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
//
// ── ومن أيِّ يومٍ يبدأ العدّ ─────────────────────────────────────────────────
// كان من `contract.startDate` — تاريخِ الورقة. والرصيدُ لا يُستحَقّ بالورقة بل
// بالعمل: الموظّفُ يستحقّ إجازتَه من **يوم مباشرته العمل**
// (`Employee.actualWorkStartDate`)، وهو تاريخٌ آخر غيرُ تاريخ التعيين.
//
// وقياسُه على البيانات: من ٢٩٦ عقدًا، ١٧٥ مباشرتُها **قبل** بداية العقد (عمل
// ثمّ وُثّق عقدُه) و١٦ **بعدها** (وُقّع العقدُ ثمّ تأخّرت المباشرة). فالعدُّ من
// الورقة يظلم الأوّلين ويحسب للآخرين أيّامًا لم يعملوها.
//
// وقرارُ صاحب العمل صريح: **من تاريخ المباشرة، لا من تاريخ العقد** — وفي كلّ
// حال. فلا حدَّ ولا استثناء: لا لمن سبقت مباشرتُه عقدَه بسنواتٍ (٥٣ موظّفًا،
// أكبرُهم مباشرتُه ٢٠١٨ وعقدُه ٢٠٢٦)، ولا لمن تعدّدت عقودُه.
//
// ويتبع ذلك أمرٌ يجب أن يُعرَف لا أن يُخفى: مَن خدم سنواتٍ قبل عقده المسجَّل
// يستحقّ الآن رصيدَ تلك السنوات كاملًا، **وما أخذه فيها من إجازاتٍ لا سجلَّ له
// عندنا** فلا يُخصَم. فإن أُريد خصمُه فموضعُه `Contract.carriedOverDays` برقمٍ
// سالبٍ يكتبه من يعرفه — لا رقمٌ يخترعه النظامُ من فرق تاريخين.
// و`scripts/auditLeaveAccrualBasis.js` يسمّي هؤلاء ويقول كم زاد رصيدُ كلٍّ.

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
 * اليومُ الذي يبدأ منه العدّ: مباشرةُ العمل إن عُرفت، وإلّا بدايةُ العقد.
 * `opts.workStartDate` يأتي من `Employee.actualWorkStartDate`، و`opts.contracts`
 * عددُ عقود الموظّف — راجع رأسَ الملفّ لسبب الحدّ.
 */
function accrualStart(contract, opts = {}) {
  const work = toDate(opts.workStartDate);
  if (work) return work;                 // المباشرةُ هي الأصل، بلا استثناء
  return toDate(contract?.startDate);    // ولا مباشرةَ مسجَّلة: يُعَدّ من العقد
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
  // ما رُحِّل من العقد السابق يُضاف إلى المتاح: أيّامٌ لم تُستهلَك، ولا تسقط
  // بتجديد العقد. راجع `models/Contract.carriedOverDays`.
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
    // ويُقال من أيِّ يومٍ عُدَّ، وبأيّ تاريخٍ — فمن يقرأ رصيدًا لا يطابق
    // توقّعَه يجد السببَ في السطر نفسِه بدل أن يسأل.
    accrualFrom: start ? start.toISOString().slice(0, 10) : '',
    accrualBasis: start && opts.workStartDate && start.toISOString().slice(0, 10) === String(opts.workStartDate).slice(0, 10)
      ? 'workStart' : 'contract',
  };
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = { computeBalance, leaveDays, contractDaysElapsed, accrualStart };
