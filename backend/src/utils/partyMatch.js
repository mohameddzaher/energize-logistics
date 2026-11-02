/**
 * Is this customer an existing account under another name? Checked before giving a new code.
 * Operations names are abbreviated ('PV Hardware Middle east factory') while ledger names are official ('PV Hardware Middle East Factory Co., Ltd', code 11040037). A new code for the short name would split one customer's debt across two accounts.
 * Similarity uses the same rule as the ledger import (scripts/importCollectionsWorkbook): distinctive words, intersection over union, plus containment (all words of the short name appear in the account name).
 */
const STOP = new Set(['شركه', 'شركة', 'مؤسسه', 'مؤسسة', 'موسسه', 'مصنع', 'مكتب', 'المحدوده', 'المحدودة',
  'شخص', 'واحد', 'التجاريه', 'التجارية', 'للخدمات', 'الخدمات', 'اللوجستيه', 'اللوجستية',
  'للنقليات', 'النقليات', 'للتجاره', 'للتجارة', 'co', 'ltd', 'company', 'est', 'for', 'and', 'the']);
const AUTO_LINK = 0.85;
const REVIEW_FLOOR = 0.30;

function toks(s) {
  const { fold } = require('../models/CollectionsParty');
  return new Set(fold(s).replace(/[.,()،\-/]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}
const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i += 1; const u = a.size + b.size - i; return u ? i / u : 0; };
const contains = (small, big) => small.size > 0 && [...small].every((x) => big.has(x));

/**
 * @returns {{ level: 'auto'|'review'|'none', best?: object, score: number }}
 * auto   - one unambiguous account: link to it.
 * review - a lookalike shown to the collections manager; no code until they decide.
 * none   - no lookalike: a genuinely new customer.
 */
function matchAccount(name, accounts) {
  const t = toks(name);
  const scored = accounts.map((a) => {
    const at = a._t || (a._t = toks(a.name));
    const j = jac(t, at);
    const c = contains(t, at) || contains(at, t);
    return { a, score: c ? Math.max(j, 0.9) : j, jac: j, contained: c };
  }).filter((x) => x.score >= REVIEW_FLOOR).sort((x, y) => y.score - x.score);
  if (!scored.length) return { level: 'none', score: 0 };
  const [top, second] = scored;
  // Auto-link only on match alone (intersection >= 0.85) with no competitor, the same rule as the ledger import. Containment is shown but not linked: a short name contained in a longer one does not mean they are the same company.
  const unique = !second || second.score < top.score - 0.1;
  const strong = top.jac >= AUTO_LINK && unique;
  return { level: strong ? 'auto' : 'review', best: top.a, score: top.score, runnerUp: second?.a };
}

module.exports = { matchAccount, toks, jac, AUTO_LINK, REVIEW_FLOOR };
