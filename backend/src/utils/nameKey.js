/**
 * Arabic-folding join key.
 *
 * The same company is written half a dozen ways across the sections: «شركة
 * التنشيط»، «التنشيط»، «Al Tanshit»، with and without hamza, ta marbuta or the
 * definite article. Nothing links those rows by id — they were entered
 * independently in each register — so a normalised name is the only join we have.
 *
 * Folding rules: hamza forms → ا, ى → ي, ة → ه, ؤ → و, ئ → ي, and every
 * non-letter/digit character (spaces, punctuation, «شركة»-style separators) is
 * stripped. The `\bال` rule only fires on Latin text — JS word boundaries are
 * defined over [A-Za-z0-9_] — so Arabic definite articles are kept. That is
 * deliberate now: this key gates what a customer can see through the portal, and
 * a looser fold that merged «الأمانة» with «أمانة» would show one company another
 * company's shipments. Under-matching is recoverable; over-matching is a leak.
 *
 * Extracted verbatim from contractsController, where this key first proved itself
 * against the real vendor sheets, so the CRM scorecards, the contracts analysis
 * and the customer portal all group companies identically.
 */
const nameKey = (s) => String(s || '')
  .replace(/[أإآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/\bال/g, '')
  .replace(/[^؀-ۿa-zA-Z0-9]/g, '')
  .toLowerCase();

/** Case/space-insensitive regex that matches a name anywhere (for Mongo queries). */
const nameRegex = (s) => new RegExp(String(s || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

module.exports = { nameKey, nameRegex };
