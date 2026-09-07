/**
 * applyCashInvoiceRule — ما دُفع هو ما يُفوتَر، للكشوف النقديّة القائمة.
 *
 *   node src/scripts/applyCashInvoiceRule.js          تجربة
 *   node src/scripts/applyCashInvoiceRule.js --yes    تنفيذ
 *
 * القاعدةُ الجديدة: مبلغُ السداد يذهب إلى صافي الفاتورة وإلى إجماليها،
 * والضريبةُ صفر — لا ضريبةَ على نقد. وهذه الكشوفُ صُفِّرت بالقفل القديم، فتُملأ
 * بما دُفع. ولا يُمَسّ كشفٌ كُتب فيه صافٍ بيدٍ (غيرُ صفر).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const YES = process.argv.includes('--yes');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const OperationsWorkflow = require('../models/OperationsWorkflow');

  const rows = await OperationsWorkflow.find({
    paymentType: 'cash',
    paymentAmount: { $gt: 0 },
    // ما لم يُكتب فيه صافٍ بيد — الصفرُ أثرُ القفل لا قصدُ إنسان.
    $or: [{ netInvoice: 0 }, { netInvoice: null }, { netInvoice: { $exists: false } }],
  }).select('reportNumber username paymentAmount netInvoice tax totalInvoice').lean();

  console.log(YES ? '── تنفيذ ──\n' : '── تجربة، بلا كتابة ──\n');
  console.log(`كشوفٌ نقديّةٌ بمبلغِ سدادٍ وصافٍ صفر: ${rows.length}\n`);
  rows.forEach((r) => console.log(`  ${String(r.reportNumber).padEnd(8)} ${String(r.username || '').slice(0, 26).padEnd(26)} سداد=${r.paymentAmount} → صافي/إجمالي=${r.paymentAmount} ضريبة=0`));

  if (!YES) { console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }
  let n = 0;
  for (const r of rows) {
    await OperationsWorkflow.updateOne({ _id: r._id }, {
      $set: { netInvoice: r.paymentAmount, totalInvoice: r.paymentAmount, tax: 0 },
    });
    n += 1;
  }
  try { const c = require('../utils/ttlCache'); c.clear('wf:'); c.clear('coll:'); } catch (_) {}
  console.log(`\n✓ حُدِّث ${n} كشفًا`);
  await mongoose.disconnect();
})();
