/**
 * Attaches to each invoice the operations reports it carries.
 * Usage: node src/scripts/linkInvoiceReports.js --dry | --apply
 * The reports column was empty for every invoice because re-importing the ledger rebuilds invoices from the sheet, which knows nothing of our reports, resetting reportNumbers. Many reports carry their invoice number, and one invoice legitimately covers several reports.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { invoiceNumberKey } = require('../utils/invoiceNumberKey');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const CollectionInvoice = require('../models/CollectionInvoice');
  const OperationsWorkflow = require('../models/OperationsWorkflow');

  const invoices = await CollectionInvoice.find({ unused: { $ne: true } })
    .select('invoiceNumber kind reportNumbers').lean();
  const byKey = new Map();
  for (const i of invoices) {
    const k = invoiceNumberKey(i.invoiceNumber);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(i);
  }

  const sheets = await OperationsWorkflow.find({ invoiceNumber: { $nin: [null, ''] } })
    .select('reportNumber invoiceNumber').lean();

  // An invoice number can match two invoices (cash and tax with the same number). The report links to both, since the sheet does not distinguish and we do not invent a distinction.
  const want = new Map();   // _id → Set(reportNumber)
  let matched = 0; let noKey = 0; let unmatched = 0;
  for (const s of sheets) {
    const k = invoiceNumberKey(s.invoiceNumber);
    if (!k) { noKey += 1; continue; }
    const hits = byKey.get(k);
    if (!hits) { unmatched += 1; continue; }
    matched += 1;
    const rn = String(s.reportNumber || '').trim();
    if (!rn) continue;
    for (const h of hits) {
      const id = String(h._id);
      if (!want.has(id)) want.set(id, new Set());
      want.get(id).add(rn);
    }
  }

  console.log(`\n  فواتيرُ الدفتر        ${invoices.length}${APPLY ? '' : '   — تجربة، بلا كتابة —'}`);
  console.log(`  كشوفٌ عليها رقمُ فاتورة ${sheets.length}`);
  console.log(`     ✔ طابقت فاتورةً        ${matched}`);
  console.log(`     ⚠ «لا فاتورة» أو فارغ  ${noKey}`);
  console.log(`     ✘ رقمٌ ليس في الدفتر   ${unmatched}`);

  const sizes = [...want.values()].map((s) => s.size);
  console.log(`\n  فواتيرُ تحتها كشوف: ${want.size}`);
  console.log(`     واحد ${sizes.filter((x) => x === 1).length} · اثنان ${sizes.filter((x) => x === 2).length} · ثلاثةٌ فأكثر ${sizes.filter((x) => x >= 3).length} · أكبرُها ${sizes.length ? Math.max(...sizes) : 0}`);

  if (!APPLY) { console.log('\n  لم يُكتب شيء. أضف --apply للتنفيذ.\n'); await mongoose.disconnect(); return; }

  // Clear invoices that no longer have a report: a report's invoice number can be corrected and move, and adding the new link without removing the old one would leave an invoice claiming a report it no longer has.
  const ops = [];
  for (const inv of invoices) {
    const next = [...(want.get(String(inv._id)) || [])].sort();
    const prev = (inv.reportNumbers || []).map(String).sort();
    if (next.length === prev.length && next.every((v, i) => v === prev[i])) continue;
    ops.push({ updateOne: { filter: { _id: inv._id }, update: { $set: { reportNumbers: next } } } });
  }
  let changed = 0;
  for (let i = 0; i < ops.length; i += 1000) {
    const r = await CollectionInvoice.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    changed += r.modifiedCount || 0;
  }
  const withRn = await CollectionInvoice.countDocuments({ unused: { $ne: true }, 'reportNumbers.0': { $exists: true } });
  const agg = await CollectionInvoice.aggregate([
    { $match: { unused: { $ne: true } } },
    { $group: { _id: null, n: { $sum: { $size: { $ifNull: ['$reportNumbers', []] } } } } },
  ]);
  console.log(`\n  ✔ فواتيرُ تغيّر ربطُها: ${changed}`);
  console.log(`  ${withRn === want.size ? '✔' : '✘'} فواتيرُ لها كشوف   المتوقَّع ${want.size}   القاعدة ${withRn}`);
  console.log(`  ✔ مجموعُ الروابط: ${agg[0]?.n || 0}   (من ${matched} كشفًا مطابقًا)\n`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
