/**
 * reapplyPaymentTypeUnify — يُعيد توحيدَ العملاء الذين وُحِّدوا قبل أن يثبت التوحيد.
 *
 *   node src/scripts/reapplyPaymentTypeUnify.js            ← عرضٌ فقط (لا يكتب شيئًا)
 *   node src/scripts/reapplyPaymentTypeUnify.js --apply    ← يكتب
 *
 * ── لماذا ───────────────────────────────────────────────────────────────────
 * كان «توحيد» في صفحة أنواع الدفع يكتب `paymentTypeSource: 'auto'`، والمزامنةُ
 * تعيد اشتقاقَ كلِّ `auto` في كلّ دورة: كشوفُ العملاء الضريبيّين التي تقول عنها
 * المنصّةُ «cash» عادت كاشًا، وكشوفُ عملاء الكاش ذاتُ الفواتير الصادرة عادت
 * ضريبيّة. فعاد عددُ «المخالف» بعد كلّ توحيد.
 *
 * صار التوحيدُ يكتب `unified` فيثبت. وهذا السكربت يُعيد قرارَ مَن وُحِّد من قبل:
 * كلُّ عميلٍ في سجلّ التدقيق له `unify_customer_payment_type` وما زالت صفتُه هي
 * الصفةَ التي وُحِّد عليها آخرَ مرّة — يُطبَّق عليه الشرطُ نفسُه الذي يطبّقه الزرّ
 * (`unifyFilter`): لا يُمسّ اختيارُ اليد، ولا كشفُ عميلِ كاشٍ صدرت له فاتورة.
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

  // آخرُ توحيدٍ لكلّ عميل.
  const logs = await AuditLog.find({ action: 'unify_customer_payment_type' })
    .sort({ createdAt: 1 }).select('entityId changes createdAt').lean();
  const last = new Map();
  for (const l of logs) if (l.entityId) last.set(String(l.entityId), l);

  let customers = 0; let reports = 0; let changed = 0; const lines = [];
  for (const [id, log] of last) {
    const party = await CollectionsParty.findById(id).select('name nameKey paymentType').lean();
    if (!party) continue;
    const wanted = log.changes?.after?.paymentType;
    // الصفةُ تغيّرت بعد التوحيد — القرارُ القديمُ لم يعد قائمًا.
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
