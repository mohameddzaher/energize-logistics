/**
 * Arabic-folding join key.
 * The same company is written many ways across sections and no shared id links the rows, so a normalised name is the only join.
 * Folding: hamza forms to alef, alef maksura to ya, ta marbuta to ha, hamza-on-waw to waw, hamza-on-ya to ya, and every non-letter/digit removed. The `\bal` rule fires only on Latin text, so Arabic definite articles are kept on purpose: this key gates what a portal customer sees, and over-matching would leak shipments while under-matching is recoverable.
 * Extracted verbatim from contractsController so scorecards, contracts analysis and the portal group companies identically.
 */
const nameKey = (s) => String(s || '')
  .replace(/[أإآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/\bال/g, '')
  .replace(/[^؀-ۿa-zA-Z0-9]/g, '')
  .toLowerCase();

/** Case/space-insensitive regex that matches a name anywhere (for Mongo queries). */
const nameRegex = (s) => new RegExp(String(s || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

module.exports = { nameKey, nameRegex };
