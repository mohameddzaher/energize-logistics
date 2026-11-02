/**
 * repairCashPlaceholders: '0' in a text field is not a value. Usage: node src/scripts/repairCashPlaceholders.js [--yes] (dry run by default). Cause: locking a cash statement wrote '0' into text
 * fields as it does for numeric ones. A numeric zero is meaningful, but 'invoice number 0' is an empty field posing as a number. Effect: the tax-invoices page groups statements by invoice number,
 * producing an 'invoice 0' that grouped six statements for five customers (two of them cash) and cannot be opened. The lock is fixed at its source (`cashLockedValues`); this cleans what it wrote.
 * Also deletes the ledger entry born from it: `ensureLedgerInvoice` accepted '0' as an invoice number and recorded it in the invoice ledger, an entry for an invoice that does not exist.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const YES = process.argv.includes('--yes');
// Text fields touched by the lock; see CASH_LOCKED_FIELDS.
const TEXT_FIELDS = ['invoiceNumber', 'documentNumber', 'finalReportDestination'];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const W = require('../models/OperationsWorkflow');
  const CI = require('../models/CollectionInvoice');

  console.log(YES ? '── تنفيذ ──\n' : '── تجربة، بلا كتابة ──\n');

  for (const f of TEXT_FIELDS) {
    const n = await W.countDocuments({ [f]: '0' });
    console.log(`${f.padEnd(24)} «0» في ${n} كشفًا`);
  }

  const rows = await W.find({ $or: TEXT_FIELDS.map((f) => ({ [f]: '0' })) })
    .select(`reportNumber username paymentType ${TEXT_FIELDS.join(' ')}`).lean();
  console.log(`\nالكشوفُ المتأثّرة: ${rows.length}`);
  rows.slice(0, 10).forEach((r) => console.log(`  ${r.reportNumber} · ${r.username || '—'} · ${r.paymentType || '—'}`));

  // Ledger entries born from a number that is not a number.
  const BAD = ['0', 'no inv', 'no Inv', 'ىى', ''];
  const badLedger = await CI.find({ invoiceNumber: { $in: BAD } }).select('invoiceNumber partyName sheetCode').lean();
  console.log(`\nقيودُ دفترٍ برقمٍ ليس رقمًا: ${badLedger.length}`);
  badLedger.forEach((r) => console.log(`  «${r.invoiceNumber}» · ${r.partyName || '—'} · ${r.sheetCode || '—'}`));

  if (!YES) { console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  let cleared = 0;
  for (const f of TEXT_FIELDS) {
    const r = await W.updateMany({ [f]: '0' }, { $set: { [f]: '' } });
    cleared += r.modifiedCount || 0;
  }
  console.log(`\n✓ فُرِّغت ${cleared} خانة`);
  if (badLedger.length) {
    const r = await CI.deleteMany({ _id: { $in: badLedger.map((x) => x._id) } });
    console.log(`✓ حُذف ${r.deletedCount} قيدًا من الدفتر`);
  }
  try { const c = require('../utils/ttlCache'); c.clear('wf:'); c.clear('colledger:'); c.clear('coll:'); } catch (_) {}
  await mongoose.disconnect();
})();
