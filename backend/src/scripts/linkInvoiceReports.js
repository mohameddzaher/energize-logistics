/**
 * linkInvoiceReports — يضع تحتَ كلّ فاتورةٍ كشوفَ التشغيل التي تحملها.
 *
 *   node src/scripts/linkInvoiceReports.js --dry
 *   node src/scripts/linkInvoiceReports.js --apply
 *
 * ── ما كان ─────────────────────────────────────────────────────────────────
 * عمودُ «كشوف التشغيل» في دفتر التحصيل كان يقول «لا كشوف» لكلّ فاتورةٍ بلا
 * استثناء — عشرةُ آلافٍ وثمانمئةٍ وثمانٍ وثمانون فاتورةً، صفرٌ منها مربوط.
 * وليس ذلك لأنّ الربطَ غيرُ ممكن: خمسةُ آلافٍ ومئتان وسبعةٌ وسبعون كشفًا تحمل
 * رقمَ فاتورتها مكتوبًا عليها.
 *
 * السببُ أنّ إعادةَ استيراد الدفتر تبني كلَّ فاتورةٍ من الورقة، والورقةُ لا
 * تعرف كشوفَنا — فتُكتب `reportNumbers` فارغةً فوق ما كان.
 *
 * ── والفاتورةُ تجمع كشوفًا ──────────────────────────────────────────────────
 * وهو المقصود: الفاتورةُ الواحدة تُصدَر عن شحناتٍ عدّة. من الخمسمئةِ وثمانٍ
 * وخمسين فاتورةً التي لها كشوفٌ، ثلاثُمئةٍ وثمانٍ وخمسون تحتها ثلاثةُ كشوفٍ
 * فأكثر، وأكبرُها تحتها أحدٌ وعشرون. فالعمودُ ليس زينةً: به يُراجَع ما فُوتِر.
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

  // رقمُ الفاتورة قد يقع على فاتورتين (نقديّةٍ وضريبيّة بالرقم نفسِه). يُربط
  // الكشفُ بكلتيهما: الورقةُ لا تفرّق، ونحن لا نخترع تفريقًا ليس فيها.
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

  // ── وما لم يعد له كشفٌ يُفرَّغ ────────────────────────────────────────────
  // الكشفُ قد يُصحَّح رقمُ فاتورته، فتنتقل نسبتُه. ولو أُضيف الجديدُ ولم يُرفَع
  // القديمُ لبقيت فاتورةٌ تدّعي كشفًا لم يعد لها — ويُراجَع عليها.
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
