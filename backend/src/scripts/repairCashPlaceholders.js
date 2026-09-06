/**
 * repairCashPlaceholders — «0» في خانةٍ نصّيّةٍ ليست قيمة.
 *
 *   node src/scripts/repairCashPlaceholders.js          تجربة
 *   node src/scripts/repairCashPlaceholders.js --yes    تنفيذ
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * قفلُ الكشف النقديّ كان يكتب «0» في الخانات النصّيّة كما يكتب الصفرَ في
 * الرقميّة. والصفرُ الرقميُّ صحيح — «صافي الفاتورة صفر» جملةٌ لها معنى — أمّا
 * «رقم الفاتورة 0» فخانةٌ فارغةٌ تتنكّر في صورة رقم.
 *
 * وأثرُه ظهر في الشاشة: صفحةُ الفواتير الضريبيّة تجمع الكشوفَ على رقم الفاتورة،
 * فصنعت «فاتورة 0» تضمّ ستّةَ كشوفٍ لخمسة عملاء — منها كشفان نقديّان. ويُضغَط
 * عليها فلا تُفتَح، لأنّه ليس رقمَ فاتورةٍ أصلًا.
 *
 * ويُصلَح القفلُ في مصدره (`cashLockedValues`)، ويُنظَّف ما كتبه هنا.
 *
 * ── ويُحذَف قيدُ الدفتر المولود منه ────────────────────────────────────────
 * `ensureLedgerInvoice` صدّقت «0» رقمَ فاتورةٍ فقيَّدته في دفتر الفواتير. وهو
 * قيدٌ لفاتورةٍ لا وجودَ لها.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const YES = process.argv.includes('--yes');
// الخاناتُ النصّيّةُ التي يمسّها القفل — راجع CASH_LOCKED_FIELDS.
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

  // قيودُ دفترٍ وُلدت من رقمٍ ليس رقمًا.
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
