/**
 * hrEngagement: employee engagement type and the archive; one rule read by every screen.
 * Type comes only from `registerNumber`: a numeric commercial register is sponsored, the freelancer label is freelancer, the training label is trainee, empty is unspecified. Freelancers and trainees have no contract.
 * Archived means ended and out of the system, or an ended freelancer; it is derived in the query, never stored.
 */
const SYSTEM_OUT = 'خارج النظام';
const SYSTEM_IN = 'داخل النظام';
const FREELANCE_RX = /فري\s*لانس|فريلانس|freelanc/i;
const TRAINEE_RX = /تدريب|متدرب|trainee/i;
const CR_RX = /^\s*\d{6,}\s*$/;

/** 'sponsored' | 'freelance' | 'trainee' | '' */
function engagementOf(e) {
  const r = String(e?.registerNumber ?? '').trim();
  if (!r) return '';
  if (FREELANCE_RX.test(r)) return 'freelance';
  if (TRAINEE_RX.test(r)) return 'trainee';
  if (CR_RX.test(r)) return 'sponsored';
  return '';
}
/** People who are not required to have a contract. */
const contractRequired = (e) => !['freelance', 'trainee'].includes(engagementOf(e));

const isArchived = (e) => e?.employmentStatus === 'terminated'
  && (String(e?.systemStatus || '').trim() === SYSTEM_OUT || engagementOf(e) === 'freelance');

// The same condition as a query (find and $match).
const ARCHIVED = {
  employmentStatus: 'terminated',
  $or: [{ systemStatus: SYSTEM_OUT }, { registerNumber: { $regex: FREELANCE_RX.source, $options: 'i' } }],
};
const NOT_ARCHIVED = { $nor: [ARCHIVED] };

/** Adds 'not archived' to an existing filter without clobbering its `$or`/`$nor`. */
const withoutArchived = (filter = {}) => ({ ...filter, $and: [...(filter.$and || []), NOT_ARCHIVED] });

// Engagement-type conditions as queries.
const ENGAGEMENT_MATCH = {
  sponsored: { registerNumber: { $regex: CR_RX.source } },
  freelance: { registerNumber: { $regex: FREELANCE_RX.source, $options: 'i' } },
  trainee: { registerNumber: { $regex: TRAINEE_RX.source, $options: 'i' } },
};

/**
 * Work status has three values: working, sister company, not working.
 * Sister company is a regular employee on our sponsorship working for a sister company; not a termination (`sisterCompany` on an existing file).
 * Not working is service ended: awaiting sponsorship transfer or final exit. Out of the system (or freelancer) archives at once; otherwise it waits for removal, then archive.
 */
const TERMINATION_KINDS = {
  transfer_pending: { ar: 'انتظار نقل الكفالة', en: 'Awaiting sponsorship transfer' },
  final_exit: { ar: 'خروج نهائي', en: 'Final exit' },
};
const SISTER = 'شركة شقيقة';
const TRANSFER_DAYS = 30;
const WORKING = 'يعمل';
const NOT_WORKING = 'لا يعمل';
/** Work-status text as written and shown; derived from the state, not typed by hand. */
// 'Not working' means off the job (termination); leave is not that.
const ON_LEAVE = 'إجازة';
const LEAVE_NO_SHOW = 'مخالفة — لم يعد من الإجازة';
function workStatusTextOf(e) {
  if (e?.employmentStatus !== 'terminated') {
    if (e?.leaveViolation?.since) return LEAVE_NO_SHOW;
    // Only a leave recorded in the system shows as leave; an old imported "on_leave" reads as working.
    if (e?.employmentStatus === 'on_leave' && e?.leaveStatusSource === 'leave') return ON_LEAVE;
    return e?.sisterCompany ? SISTER : WORKING;
  }
  const k = TERMINATION_KINDS[e?.terminationKind];
  return k ? `${NOT_WORKING} — ${k.ar}` : NOT_WORKING;
}
/** Ending his service archives him immediately, so no status is asked. */
const archivesOnTermination = (e) => String(e?.systemStatus || '').trim() === SYSTEM_OUT || engagementOf(e) === 'freelance';

module.exports = {
  TERMINATION_KINDS, TRANSFER_DAYS, WORKING, NOT_WORKING, SISTER, ON_LEAVE, LEAVE_NO_SHOW, workStatusTextOf, archivesOnTermination,
  SYSTEM_OUT, SYSTEM_IN, engagementOf, contractRequired, isArchived,
  ARCHIVED, NOT_ARCHIVED, withoutArchived, ENGAGEMENT_MATCH,
};
