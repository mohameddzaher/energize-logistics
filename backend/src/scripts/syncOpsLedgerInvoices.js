/**
 * Tax-invoice ledger entries that originate from operations statements.
 * Usage: node src/scripts/syncOpsLedgerInvoices.js (reports only) | --apply
 * Visits every entry created from a statement (sheetCode 'workflow') and every tax invoice number on a statement without a ledger entry, and reconciles each with its statements using the same function the workflow save calls (syncOpsInvoices): an entry without a statement is removed, a stale amount takes the statements' total, a missing entry is created.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const CollectionInvoice = require('../models/CollectionInvoice');
  const { NO_INVOICE_RX, hasTaxInvoice } = require('../utils/paymentType');
  const { syncOpsInvoices } = require('../controllers/workflowController');

  const opsBorn = await CollectionInvoice.find({ sheetCode: 'workflow', kind: 'tax' }).select('invoiceNumber total').lean();
  const taxNums = await OperationsWorkflow.distinct('invoiceNumber', { paymentType: { $ne: 'cash' }, invoiceNumber: { $nin: [null, ''] } });
  const inLedger = new Set((await CollectionInvoice.find({ kind: 'tax' }).select('invoiceNumber').lean()).map((r) => String(r.invoiceNumber).trim()));
  const missing = [];
  for (const no of taxNums.map((n) => String(n).trim()).filter((n) => n && !NO_INVOICE_RX.test(n) && !inLedger.has(n))) {
    const ws = await OperationsWorkflow.find({ invoiceNumber: no }).select('invoiceNumber tax netInvoice paymentType').lean();
    if (ws.some((w) => w.paymentType !== 'cash' && hasTaxInvoice(w))) missing.push(no);
  }

  console.log(`قيودٌ من التشغيل: ${opsBorn.length}`);
  for (const r of opsBorn) {
    const reps = await OperationsWorkflow.find({ invoiceNumber: r.invoiceNumber }).select('totalInvoice').lean();
    const sum = Math.round(reps.reduce((a, w) => a + (Number(w.totalInvoice) || 0), 0) * 100) / 100;
    console.log(`  ${r.invoiceNumber}: كشوف ${reps.length} · في الدفتر ${r.total} · من الكشوف ${sum}${reps.length ? '' : '  ← بلا كشف (يُزال إن لم يُعمَل عليه)'}`);
  }
  console.log(`أرقامٌ ضريبيّةٌ على كشوفٍ بلا قيد: ${missing.length}${missing.length ? ` (${missing.slice(0, 20).join('، ')})` : ''}`);

  if (!APPLY) { console.log('\nللتنفيذ: --apply'); await mongoose.disconnect(); return; }
  const touched = await syncOpsInvoices([...opsBorn.map((r) => r.invoiceNumber), ...missing]);
  console.log(`\nنُفِّذ: ${touched} قيدًا تغيّر`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
