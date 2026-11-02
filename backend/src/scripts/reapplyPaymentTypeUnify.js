/**
 * Reapplies unification for customers unified before it became sticky.
 * Usage: node src/scripts/reapplyPaymentTypeUnify.js [--apply]; view only otherwise.
 * The unify action wrote paymentTypeSource 'auto' and sync re-derives every auto each cycle, so tax customers' statements the platform calls cash reverted to cash and cash customers with issued invoices reverted to tax, bringing the mismatch count back. Unify now writes 'unified', which sticks. This script reapplies earlier decisions: every customer with a unify_customer_payment_type audit entry whose attribute still equals the unified one gets the same condition the button uses (unifyFilter): manual choices are untouched, as are statements of cash customers with an issued invoice.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const AuditLog = require('../models/AuditLog');
  const CollectionsParty = require('../models/CollectionsParty');
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const { unifyFilter } = require('../controllers/paymentTypesController');

  // Last unify per customer.
  const logs = await AuditLog.find({ action: 'unify_customer_payment_type' })
    .sort({ createdAt: 1 }).select('entityId changes createdAt').lean();
  const last = new Map();
  for (const l of logs) if (l.entityId) last.set(String(l.entityId), l);

  let customers = 0; let reports = 0; let changed = 0; const lines = [];
  for (const [id, log] of last) {
    const party = await CollectionsParty.findById(id).select('name nameKey paymentType').lean();
    if (!party) continue;
    const wanted = log.changes?.after?.paymentType;
    // The attribute changed after unification, so the old decision no longer holds.
    if (!wanted || wanted !== party.paymentType) continue;
    const filter = await unifyFilter(party);
    if (!filter) continue;
    const n = await OperationsWorkflow.countDocuments(filter);
    if (!n) continue;
    customers += 1; reports += n;
    lines.push(`  ${party.name} → ${wanted}: ${n}`);
    if (APPLY) {
      const r = await OperationsWorkflow.updateMany(filter, { $set: { paymentType: wanted, paymentSubtype: wanted === 'tax' ? 'deferred_invoice' : '', paymentTypeSource: 'unified' } });
      changed += r.modifiedCount || 0;
    }
  }
  console.log(lines.join('\n'));
  console.log(`\n${APPLY ? 'كُتب' : 'سيُكتب (عرض فقط — أضف --apply)'}: ${customers} عميلًا · ${APPLY ? changed : reports} كشفًا`);
  if (APPLY) console.log('أعد تحميل الخادم أو انتظر انتهاء ذاكرة wf:/colledger: المؤقّتة (٢٠–٦٠ ثانية).');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
