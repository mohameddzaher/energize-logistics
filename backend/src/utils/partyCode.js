/**
 * Account code, generated in the ledger's convention.
 * The ledger has two series: tax `1104xxxx` and cash `C####` (from C0001). A new account takes the next code in its type's series, so a column never mixes formats.
 * The next code is the largest existing code plus one, read from the database; a stored counter would drift after an import or delete.
 */
const TAX_PREFIX = '1104';
const CASH_PREFIX = 'C';

/**
 * @param {'cash'|'tax'} paymentType
 * @returns {Promise<string>} the next code in the type's series.
 */
async function nextPartyCode(paymentType) {
  const CollectionsParty = require('../models/CollectionsParty');
  const cash = paymentType === 'cash';
  const rx = cash ? /^C(\d+)$/i : new RegExp(`^${TAX_PREFIX}(\\d+)$`);

  const codes = await CollectionsParty.distinct('code', { code: { $type: 'string', $gt: '' } });
  let max = 0;
  for (const c of codes) {
    const m = rx.exec(String(c).trim());
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }

  if (cash) return `${CASH_PREFIX}${String(max + 1).padStart(4, '0')}`;
  // Tax starts where the ledger ended; if empty, from the start of the series.
  return `${TAX_PREFIX}${String(max + 1).padStart(4, '0')}`;
}

module.exports = { nextPartyCode, TAX_PREFIX, CASH_PREFIX };
