/**
 * convertTaxToDeferredInvoice: statements marked tax with no subtype become deferred invoice. Dry run by default; --apply writes.
 * The family stays tax and only paymentSubtype = 'deferred_invoice' is set, so rules keyed on paymentType do not move; paymentTypeSource is left so derivation stays derived.
 * Safe to rerun. It writes invalidation stamps (ttlCache.clearShared) so both workers clear their caches.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

const FILTER = {
  paymentType: 'tax',
  $or: [{ paymentSubtype: { $exists: false } }, { paymentSubtype: null }, { paymentSubtype: '' }],
};

// Readers and writers of payment type: the workflow, the collections section and its dedicated page.
const CACHE_PREFIXES = ['wf:', 'wfparty:', 'collections-dept:', 'cdr:', 'colledger:', 'opsprivate:'];

async function run({ apply = APPLY, log = console.log } = {}) {
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const { TAX_SUBTYPE } = require('../utils/paymentType');

  const [total, bySource] = await Promise.all([
    OperationsWorkflow.countDocuments(FILTER),
    OperationsWorkflow.aggregate([
      { $match: FILTER },
      { $group: { _id: { $ifNull: ['$paymentTypeSource', ''] }, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
  ]);

  log(apply ? '── تنفيذ ──' : '── تجربة، بلا كتابة ──');
  log(`كشوفٌ «ضريبي» بلا نوع: ${total}`);
  for (const s of bySource) log(`  مصدرُ النوع ${s._id || '(فارغ)'}: ${s.n}`);

  if (!apply || !total) {
    if (!apply) log('— تجربةٌ فقط. أضف --apply للتنفيذ.');
    return { total, modified: 0, bySource };
  }

  const r = await OperationsWorkflow.updateMany(FILTER, { $set: { paymentSubtype: TAX_SUBTYPE } });
  const modified = r.modifiedCount || 0;
  log(`✓ كُتب «آجل - فاتورة» على ${modified} كشفًا`);

  const cache = require('../utils/ttlCache');
  for (const p of CACHE_PREFIXES) {
    try { await cache.clearShared(p); } catch (e) { log(`  تعذّر ختمُ ${p}: ${e.message} — المهلةُ أو pm2 reload`); }
  }
  log(`  أُبطلت الذاكرة: ${CACHE_PREFIXES.join(' ')}`);
  return { total, modified, bySource };
}

module.exports = { run, FILTER };

if (require.main === module) {
  (async () => {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
    try { await run(); } finally { await mongoose.disconnect(); }
  })().catch((e) => { console.error(e); process.exit(1); });
}
