/**
 * settleCustomsHistory — يضبط حالةَ معاملات التخليص القديمة كما قالها صاحبُ الشركة
 * يومَ ٢٠٢٦/١٠/١١، مرّةً واحدة.
 *
 *   node src/scripts/settleCustomsHistory.js            ← تجربة، بلا كتابة
 *   node src/scripts/settleCustomsHistory.js --apply
 *
 * القاعدةُ كما قيلت:
 *   · القادمةُ تبقى قادمة.
 *   · `IN_PROGRESS` ما زالت تجري — لا تُمسّ.
 *   · `AWAITING_INVOICE` أنهت دورتَها كلَّها ولم تُفوتَر: **مغلقةٌ** (صحّحها صاحبُ
 *     الشركة: مغلقةٌ ولم تُفوتَر، لا مفتوحة)، مراحلُها مُنجَزةٌ إلّا «إصدار
 *     الفاتورة»، وحالةُ فاتورتها فارغة — فتظهر في لوحة القسم «مغلقة لم تُفوتَر»
 *     حتى تُصدَر فاتورتُها. وما لم يُعرَف طريقُه بعد أمر النقل يُكتب «إلى العميل
 *     مباشرةً» — يُصحَّح من شاشة المعاملة إن كان غيرَ ذلك.
 *   · وكلُّ ما عدا ذلك تاريخ: أُغلق وفُوتر.
 *
 * والإغلاقُ يُؤرَّخ بآخر يومٍ من شهر المعاملة لا باليوم، وباسم «سجلّ سابق».
 * يُعاد تشغيلُه بلا ضرر.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const BY = 'سجلّ سابق';
const IN_PROGRESS = ['XT26220LJED003'];
const AWAITING_INVOICE = [
  'NAM8290392', '106559LYG142', 'AKKCND26037536', 'HR2603LYGJE206',
  'HR2603LYGJE216', 'HLCUSEL260707940', 'HLCUSEL260747840',
];
const norm = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const CustomsClearance = require('../models/CustomsClearance');
  const { STAGES, readStages, lockReason, pipelineOf } = CustomsClearance;
  const rows = await CustomsClearance.find({ upcoming: { $ne: true }, cancelled: { $ne: true } })
    .select('refNumber blNumber stage stagesDone pipelineVersion transportRoute cargoType stageDone billing isCompleted saleInvoiceNumber periodYear periodMonth createdAt').lean();

  const closedAt = (r) => (r.periodYear && r.periodMonth
    ? new Date(Date.UTC(r.periodYear, r.periodMonth, 0, 9, 0, 0)) : new Date(r.createdAt));
  /** المراحلُ اللازمةُ لهذه المعاملة كلُّها مُنجَزة — مع الفاتورة أو بدونها. */
  const allDone = (r, withInvoice) => {
    const { route: known } = readStages(r);
    const route = known || 'customer';
    const stagesDone = STAGES.filter((k) => !lockReason(k, route, r.cargoType) && (withInvoice || k !== 'invoiced'));
    return { stagesDone, transportRoute: route, pipelineVersion: 2, stage: withInvoice ? 'invoiced' : stagesDone[stagesDone.length - 1], guessed: !known };
  };

  const plan = []; const missing = new Set([...IN_PROGRESS, ...AWAITING_INVOICE]);
  for (const r of rows) {
    const bl = norm(r.blNumber);
    missing.delete(bl);
    if (IN_PROGRESS.includes(bl)) { plan.push({ r, kind: 'progress', set: null }); continue; }
    if (AWAITING_INVOICE.includes(bl)) {
      const { guessed, ...st } = allDone(r, false);
      plan.push({ r, kind: 'awaiting', guessed, set: {
        ...st, 'billing.invoiceStatus': '',
        ...(r.isCompleted ? {} : { isCompleted: true, completedAt: closedAt(r), completedBy: null, completedByName: BY }),
      } });
      continue;
    }
    const { guessed, ...st } = allDone(r, true);
    const status = String((r.billing && r.billing.invoiceStatus) || '').trim();
    const set = { ...st, ...(status ? {} : { 'billing.invoiceStatus': 'مفوترة' }) };
    if (!r.isCompleted) Object.assign(set, { isCompleted: true, completedAt: closedAt(r), completedBy: null, completedByName: BY });
    plan.push({ r, kind: 'history', set });
  }

  const n = (k) => plan.filter((p) => p.kind === k).length;
  console.log(`\n  غيرُ القادمة: ${rows.length} · تجري ولا تُمسّ: ${n('progress')} · مغلقةٌ لم تُفوتَر: ${n('awaiting')} · تاريخٌ يُغلَق ويُفوتَر: ${n('history')}`);
  console.log(`  من التاريخ: مفتوحةٌ ستُغلَق ${plan.filter((p) => p.kind === 'history' && !p.r.isCompleted).length} · مغلقةٌ تُكمَل مراحلُها ${plan.filter((p) => p.kind === 'history' && p.r.isCompleted).length}`);
  for (const p of plan.filter((x) => x.kind !== 'history')) {
    console.log(`   ${p.kind === 'progress' ? 'تجري' : 'مغلقةٌ لم تُفوتَر'} · ${p.r.blNumber} (${p.r.refNumber}) · الآن ${p.r.stage} ${pipelineOf(p.r).percent}%${p.r.isCompleted ? ' · مغلقة' : ''}${p.guessed ? ' · طريقُها غيرُ معروف → إلى العميل مباشرةً' : ''}`);
  }
  if (missing.size) { console.error(`  ✗ بوالصُ لم تُوجَد: ${[...missing].join('، ')} — لا يُكتب شيء.`); await mongoose.disconnect(); process.exit(1); }
  if (!APPLY) { console.log('  — تجربة، بلا كتابة. أضف --apply للتنفيذ.\n'); await mongoose.disconnect(); return; }

  let done = 0;
  for (const p of plan) {
    if (!p.set) continue;
    const res = await CustomsClearance.updateOne({ _id: p.r._id }, { $set: p.set }, { timestamps: false });
    done += res.modifiedCount || 0;
  }
  try { require('../utils/ttlCache').clear('customs:'); } catch (_) { /* */ }
  const after = await CustomsClearance.find({ upcoming: { $ne: true }, cancelled: { $ne: true } })
    .select('stage stagesDone pipelineVersion transportRoute cargoType isCompleted saleInvoiceNumber blNumber').lean();
  const open = after.filter((r) => !r.isCompleted);
  console.log(`  كُتب على ${done} معاملة · المغلقةُ ${after.length - open.length} (كلُّها ١٠٠٪: ${after.filter((r) => r.isCompleted).every((r) => pipelineOf(r).percent === 100)}) · المفتوحةُ ${open.length}:`);
  for (const r of open) console.log(`   ${r.blNumber} · ${pipelineOf(r).percent}% · التالية ${pipelineOf(r).next || '—'}`);
  console.log('');
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
