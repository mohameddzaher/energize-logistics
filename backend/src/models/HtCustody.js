/** Heavy transport custody: cash, purchase card and workshop. Identical to light transport custody (rules in models/LtCustody), plus a vehicle per entry: a truck from the Location Solutions fleet chosen for incoming or outgoing, optional. */
const mongoose = require('mongoose');
const { ACCOUNTS, IN_SOURCES, TO_CASH, buildCustodySchema } = require('./custodyLedger');

const htCustodySchema = buildCustodySchema({ vehicles: true });

module.exports = mongoose.models.HtCustodyEntry || mongoose.model('HtCustodyEntry', htCustodySchema);
module.exports.ACCOUNTS = ACCOUNTS;
module.exports.IN_SOURCES = IN_SOURCES;
module.exports.TO_CASH = TO_CASH;
