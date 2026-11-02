/**
 * Month is parsed from any written form and never crashes the page.
 * The DB `month` is a number 1-12 and was read as Number(req.query.month); a link with `month=2026-09` gave NaN, Mongoose rejected the cast and the call failed with a 500. Both forms are accepted (bare month number, or YYYY-MM which also yields the year); anything unparseable is ignored rather than failing the screen.
 */
const parseMonth = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return { month: null, year: null };
  const ym = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (ym) {
    const mo = Number(ym[2]);
    return { month: mo >= 1 && mo <= 12 ? mo : null, year: Number(ym[1]) };
  }
  const n = Number(s);
  return { month: Number.isInteger(n) && n >= 1 && n <= 12 ? n : null, year: null };
};

/** A plausible year or `null`; never NaN reaching the DB. */
const parseYear = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isInteger(n) && n >= 1900 && n <= 2999 ? n : null;
};

module.exports = { parseMonth, parseYear };
