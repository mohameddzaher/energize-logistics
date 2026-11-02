/**
 * Light transport custody: three accounts (cash, purchases card, workshop). Every entry is in or out on one account; the balance is ins minus outs, computed on read and never stored.
 * Inbound sources: cash from card, workshop, bank or a rep; card from bank; workshop from maintenance. Outbound goes to a rep (by residence number, data captured from HR) or the company (with a statement); card and workshop can also pay out to cash.
 * A transfer is two entries sharing one `transferId`, written together so neither side is recorded or deleted alone.
 */
const mongoose = require('mongoose');
const { ACCOUNTS, IN_SOURCES, TO_CASH, buildCustodySchema } = require('./custodyLedger');

const ltCustodySchema = buildCustodySchema();

module.exports = mongoose.models.LtCustodyEntry || mongoose.model('LtCustodyEntry', ltCustodySchema);
module.exports.ACCOUNTS = ACCOUNTS;
module.exports.IN_SOURCES = IN_SOURCES;
module.exports.TO_CASH = TO_CASH;
