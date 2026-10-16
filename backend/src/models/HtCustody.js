/**
 * عهدةُ النقل الثقيل — الكاش، وكارت المشتريات، والورشة. مثلُ عهدة النقل الخفيف
 * حرفًا بحرف (القواعدُ في models/LtCustody)، ويزيد القيدُ سيّارتَه: شاحنةٌ من
 * أسطول لوكيشن سوليوشن يُختار لها الواردُ أو الصادر، اختيارًا لا إلزامًا.
 */
const mongoose = require('mongoose');
const { ACCOUNTS, IN_SOURCES, TO_CASH, buildCustodySchema } = require('./custodyLedger');

const htCustodySchema = buildCustodySchema({ vehicles: true });

module.exports = mongoose.models.HtCustodyEntry || mongoose.model('HtCustodyEntry', htCustodySchema);
module.exports.ACCOUNTS = ACCOUNTS;
module.exports.IN_SOURCES = IN_SOURCES;
module.exports.TO_CASH = TO_CASH;
