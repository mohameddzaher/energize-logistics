/** First day of branch custody; nothing before it exists. Earlier months held trial and first-import data (unexplained opening balances, test entries), so the ledger now starts from an agreed date and earlier days are nonexistent rather than ignored. The boundary blocks every write (add, edit, delete, close, reopen) and even opening an earlier day, because getOrCreateWallet creates the day on read. The opening balance on the start date is a declared figure (cash in the safe that morning), not computed; any day inserted before it would make it computed again. */

/** First custody day; earlier days are neither read nor written. */
const WALLET_START_DATE = '2026-09-01';

/** Dates are YYYY-MM-DD strings, so string comparison equals chronological comparison. */
const isBeforeWalletStart = (date) => !!date && String(date) < WALLET_START_DATE;

/** Today as YYYY-MM-DD in server time; not toISOString, which can jump a day. */
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * The ledger has an upper bound too: today and tomorrow only. getOrCreateWallet creates a day merely by being asked, so opening a date weeks ahead created a day that had not happened (three empty ones were found, one made 18 days early).
 * Tomorrow is included because work crosses midnight: a branch day is closed and tomorrow prepared with its carried balance, then a 1 a.m. entry belongs to tomorrow by calendar. Blocking it would force a wrong date or no record. Beyond tomorrow there is no real work, since cash is counted and closed the same day.
 */
const shiftDay = (base, days) => {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Last day that can be opened and written: tomorrow. */
const lastWritableDay = () => shiftDay(todayStr(), 1);

const isBeyondBook = (date) => !!date && String(date) > lastWritableDay();

const walletStartMessage = () =>
  `بدايةُ دفتر العهدة ${WALLET_START_DATE} — لا يُقرأ ولا يُكتب شيءٌ قبل هذا التاريخ.`;

const walletFutureMessage = () =>
  `لا يُفتَح يومٌ أبعدُ من الغد — آخرُ يومٍ في الدفتر ${lastWritableDay()}.`;

/** Who may work outside the window: super admin only. The bounds protect against everyday mistakes (a mistyped date, a screen opened on a future month), but real corrections still need a door: a forgotten entry in a past day. A door closed to everyone gets bypassed by recording the movement on the wrong day, making the ledger silently false. Not widened to admin or operations managers, since those work in the ledger daily and are exactly who the bounds protect. */
const mayWorkOutsideBook = (user) => !!user && require('./constants').isTopRole(user.role);

module.exports = {
  WALLET_START_DATE,
  isBeforeWalletStart,
  isBeyondBook,
  mayWorkOutsideBook,
  todayStr,
  lastWritableDay,
  shiftDay,
  walletStartMessage,
  walletFutureMessage,
};
