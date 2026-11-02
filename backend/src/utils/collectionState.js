/**
 * Collection state: three, not two: not collected, partial, fully collected.
 * One definition because it is read in the filter, status column, cards, debt board, account statement and wallet collection; separate definitions made screens disagree on the same statement.
 * Cash (operating statement): fully collected = has a collection date, or the cash ledger says 'Collected' with no date. Partial = neither, but has received money (`collectedAmount > 0`). Not collected = no date and nothing received. The date is written when received reaches the value, not before; see recordCollection.
 * Tax (invoice ledger): see CollectionInvoice.stateOf / PARTIAL / NOT_STARTED; same definition on state instead of date (the ledger's state is the verdict).
 */
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
/** A difference of one halala is not a remainder: amounts have two decimals. */
const EPS = 0.005;

const CASH_COLLECTED = Object.freeze({ $or: [{ collectionDate: { $ne: null } }, { cashCollectionStatus: 'collected' }] });
const CASH_OPEN = Object.freeze({ collectionDate: null, cashCollectionStatus: { $ne: 'collected' } });

/**
 * Collection-state condition on cash statements, added to `$and`.
 * `open` = not complete (not collected + partial): what the debt counts.
 */
function cashStateMatch(state) {
  switch (state) {
    case 'yes': return CASH_COLLECTED;
    case 'no': return { ...CASH_OPEN, collectedAmount: { $not: { $gt: 0 } } };
    case 'partial': return { ...CASH_OPEN, collectedAmount: { $gt: 0 } };
    case 'open': return CASH_OPEN;
    default: return null;
  }
}

/** The same condition inside an aggregation: fully collected. */
const cashCollectedExpr = { $or: [{ $ifNull: ['$collectionDate', false] }, { $eq: ['$cashCollectionStatus', 'collected'] }] };
/** 'Partial' inside an aggregation. */
const cashPartialExpr = { $and: [{ $not: [cashCollectedExpr] }, { $gt: [{ $ifNull: ['$collectedAmount', 0] }, 0] }] };
/** Remainder inside an aggregation: zero when collected, otherwise value minus received (never below zero). */
const cashRemainingExpr = {
  $cond: [cashCollectedExpr, 0, { $max: [0, { $subtract: [{ $ifNull: ['$sellingValue', 0] }, { $ifNull: ['$collectedAmount', 0] }] }] }],
};

const cashIsCollected = (w) => !!(w && (w.collectionDate || w.cashCollectionStatus === 'collected'));
/** 'full' | 'partial' | 'none' */
const cashState = (w) => {
  if (cashIsCollected(w)) return 'full';
  return (Number(w && w.collectedAmount) || 0) > 0 ? 'partial' : 'none';
};
/** What remains on the statement; the value is the selling value and the result is never below zero. */
const cashRemaining = (w) => (cashIsCollected(w) ? 0 : Math.max(0, r2((Number(w && w.sellingValue) || 0) - (Number(w && w.collectedAmount) || 0))));

/** The payment as displayed, without the database-only fields. */
const paymentView = (p) => ({
  _id: String(p._id),
  amount: r2(p.amount),
  date: p.date || null,
  byName: p.byName || '',
  note: p.note || '',
  mode: p.mode || 'partial',
  at: p.at || null,
});

const STATE_AR = { none: 'لم تُحصَّل', partial: 'محصَّلة جزئيًّا', full: 'محصَّلة بالكامل' };
const STATE_EN = { none: 'Not collected', partial: 'Partially collected', full: 'Fully collected' };

module.exports = {
  r2, EPS,
  CASH_COLLECTED, CASH_OPEN, cashStateMatch,
  cashCollectedExpr, cashPartialExpr, cashRemainingExpr,
  cashIsCollected, cashState, cashRemaining,
  paymentView, STATE_AR, STATE_EN,
};
