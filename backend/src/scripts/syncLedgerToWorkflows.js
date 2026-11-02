/**
 * Brings what the collections ledger knows into the statements (workflows).
 * Usage: node src/scripts/syncLedgerToWorkflows.js [--dry]
 * The ledger can know delivery and collection for an invoice while the operations statement has both empty, so the two views disagree about the same invoice; thousands of statements are affected. Rule: fill empties, never overwrite written values; conflicts are counted and shown, not applied. Direction is ledger to statement because the ledger covers far more invoices than the statements; new screen entries now write both sides (see syncInvoiceLedger).
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
// Why delivery is kept separate from collection.
// The collection date means the same thing in both ledgers (money received), so they almost always agree. The delivery date is doubtful: in the tracking sheet it is the statement handed to accounts, in the collections ledger it is the invoice handed to the customer, and the two rarely match. So neither is filled from the other by guessing; --with-delivery is an explicit decision once the ledger owner confirms they are the same thing.
const WITH_DELIVERY = process.argv.includes('--with-delivery');
const sameDay = (a, b) => a && b && new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const CollectionInvoice = require('../models/CollectionInvoice');
  const OW = require('../models/OperationsWorkflow');

  console.log(DRY ? '— تجربة، بلا كتابة —\n' : '');
  const invs = await CollectionInvoice.find({
    $or: [{ deliveryDate: { $ne: null } }, { collectionDate: { $ne: null } }],
  }).select('invoiceNumber deliveryDate collectionDate status').lean();
  console.log(`فواتيرُ الدفتر ولها تاريخُ تسليمٍ أو تحصيل: ${invs.length}`);

  const byNo = new Map();
  for (const i of invs) {
    const no = String(i.invoiceNumber || '').trim();
    if (!no) continue;
    // One invoice may be recorded as both cash and tax; take the one that has a date.
    const cur = byNo.get(no);
    if (!cur || (!cur.deliveryDate && i.deliveryDate) || (!cur.collectionDate && i.collectionDate)) byNo.set(no, i);
  }

  const nums = [...byNo.keys()];
  const ops = [];
  const stat = { deliveryFilled: 0, collectionFilled: 0, deliverySame: 0, collectionSame: 0, deliveryConflict: 0, collectionConflict: 0 };
  const conflicts = [];
  let seen = 0;

  for (let i = 0; i < nums.length; i += 500) {
    const part = await OW.find({ invoiceNumber: { $in: nums.slice(i, i + 500) } })
      .select('reportNumber invoiceNumber deliveryDate collectionDate').lean();
    seen += part.length;
    for (const w of part) {
      const inv = byNo.get(String(w.invoiceNumber).trim());
      if (!inv) continue;
      const patch = {};
      if (inv.deliveryDate) {
        if (!w.deliveryDate) { if (WITH_DELIVERY) patch.deliveryDate = inv.deliveryDate; stat.deliveryFilled += 1; }
        else if (sameDay(w.deliveryDate, inv.deliveryDate)) stat.deliverySame += 1;
        else { stat.deliveryConflict += 1; conflicts.push(`كشف ${w.reportNumber} فاتورة ${w.invoiceNumber}: تسليمُنا ${String(w.deliveryDate).slice(0, 10)} والدفتر ${String(inv.deliveryDate).slice(0, 10)}`); }
      }
      if (inv.collectionDate) {
        if (!w.collectionDate) { patch.collectionDate = inv.collectionDate; stat.collectionFilled += 1; }
        else if (sameDay(w.collectionDate, inv.collectionDate)) stat.collectionSame += 1;
        else { stat.collectionConflict += 1; conflicts.push(`كشف ${w.reportNumber} فاتورة ${w.invoiceNumber}: تحصيلُنا ${String(w.collectionDate).slice(0, 10)} والدفتر ${String(inv.collectionDate).slice(0, 10)}`); }
      }
      if (Object.keys(patch).length) ops.push({ updateOne: { filter: { _id: w._id }, update: { $set: patch } } });
    }
    process.stdout.write(`\r  فُحص ${Math.min(i + 500, nums.length)}/${nums.length} رقمَ فاتورة…`);
  }
  console.log(`\nكشوفٌ تحمل أرقامَ تلك الفواتير: ${seen}\n`);

  console.log('             يُملأ   مطابق   مختلف (يُترك)');
  console.log('─'.repeat(48));
  console.log(`  التسليم  ${String(stat.deliveryFilled).padStart(8)} ${String(stat.deliverySame).padStart(7)} ${String(stat.deliveryConflict).padStart(8)}`
    + (WITH_DELIVERY ? '' : '   ← لا يُكتب بلا --with-delivery'));
  console.log(`  التحصيل  ${String(stat.collectionFilled).padStart(8)} ${String(stat.collectionSame).padStart(7)} ${String(stat.collectionConflict).padStart(8)}`);
  console.log('─'.repeat(48));
  console.log(`\nكشوفٌ ستتغيّر: ${ops.length}`);
  if (conflicts.length) {
    console.log(`\nاختلافاتٌ تُترك للمراجعة (${conflicts.length}):`);
    for (const c of conflicts.slice(0, 20)) console.log('    ' + c);
    if (conflicts.length > 20) console.log(`    … و${conflicts.length - 20} غيرها`);
  }

  if (!DRY && ops.length) {
    let done = 0;
    for (let i = 0; i < ops.length; i += 500) {
      const r = await OW.bulkWrite(ops.slice(i, i + 500), { ordered: false });
      done += r.modifiedCount || 0;
    }
    console.log(`\n✓ عُدِّل ${done} كشفًا`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
