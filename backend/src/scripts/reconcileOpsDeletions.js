/**
 * reconcileOpsDeletions — ما اختفى من المنصّة يختفي عندنا.
 *
 *   node src/scripts/reconcileOpsDeletions.js         # فحصٌ فقط
 *   node src/scripts/reconcileOpsDeletions.js --yes   # تنفيذ
 *
 * ── الثغرة ──────────────────────────────────────────────────────────────────
 * المزامنةُ تحذف الشحنةَ إذا أعادتها المنصّةُ ومعها `deleted_at`. لكنّ الصفَّ
 * الذي يُحذف حذفًا نهائيًّا لا يعود في أيّ صفحة، فلا يمرّ على المزامنة أصلًا —
 * فيبقى عندنا إلى الأبد كشفًا لا وجودَ له.
 *
 * وشيتُ المتابعة يكتشفها: خانةُ تاريخ الكشف تصير `#N/A` لأنّ البحثَ في المنصّة
 * لم يجد الرقم. ألفٌ ومئةٌ وثلاثةٌ وعشرون صفًّا في الشيت هكذا، ولا واحدَ منها
 * موجودٌ في المنصّة — فالإشارةُ صحيحة. وما ينقصنا هو أن نقرأها نحن أيضًا.
 *
 * فتُمسح القائمةُ كاملةً من المنصّة مرّةً، ويُقارَن ما عندنا بها. والمقارنةُ لا
 * تُنفَّذ إلّا إذا اكتمل المسح: لو انقطع في منتصفه لَبدا كلُّ ما لم يُقرأ بعدُ
 * محذوفًا، فتُمسح آلافُ الصفوف الحيّة.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const upl = require('../services/uplClient');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const ShipmentOrder = require('../models/ShipmentOrder');

const APPLY = process.argv.includes('--yes');

async function sweepPlatform() {
  const nums = new Set(); const ids = new Set();
  let page = 1; let total = null; let seen = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const out = await upl.get('/admin/shipments', { query: { limit: 100, page, 'sort[updated_at]': 'desc' } });
    const items = (out.data && out.data.items) || [];
    const meta = (out.data && out.data.meta) || {};
    if (total === null) total = meta.total ?? null;
    if (!items.length) break;
    items.forEach((s) => {
      if (s.deleted_at) return;
      if (s.graduation_statement_num != null) nums.add(String(s.graduation_statement_num).trim());
      if (s.id) ids.add(String(s.id));
    });
    seen += items.length;
    process.stdout.write(`\r  مسحُ المنصّة: ${seen}${total ? '/' + total : ''}   `);
    if (!meta.hasNextPage) break;
    page += 1;
  }
  console.log('');
  return { nums, ids, seen, total };
}

(async () => {
  console.log('\n' + '='.repeat(72));
  console.log(APPLY ? '  مطابقةُ المحذوف من المنصّة — تنفيذ' : '  مطابقةُ المحذوف من المنصّة — فحصٌ فقط');
  console.log('='.repeat(72));
  if (!upl.isConfigured()) { console.error('  ✗ اتّصالُ المنصّة غير مهيّأ'); process.exit(1); }

  const { nums, ids, seen, total } = await sweepPlatform();
  console.log(`  المنصّة: ${nums.size} رقمَ كشفٍ حيّ (قُرئ ${seen}${total ? ' من ' + total : ''})`);

  // ── شرطُ السلامة ──────────────────────────────────────────────────────────
  // مسحٌ ناقصٌ يجعل الحيَّ يبدو محذوفًا. فإن لم يُقرأ ما وعدت به المنصّةُ، يُوقَف.
  if (total && seen < total) {
    console.error(`  ✗ المسحُ ناقص (${seen}/${total}) — يُوقَف كي لا يُمسح حيٌّ.`);
    process.exit(1);
  }
  if (nums.size < 1000) {
    console.error(`  ✗ المنصّةُ أعادت ${nums.size} صفًّا فقط — رقمٌ غيرُ معقول، يُوقَف.`);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const wf = await OperationsWorkflow.find({}).select('reportNumber reportDate applicationStatus').lean();
  const so = await ShipmentOrder.find({ source: 'platform' }).select('externalId graduationNumber reference').lean();

  const wfGone = wf.filter((d) => !nums.has(String(d.reportNumber).trim()));
  const soGone = so.filter((d) => !ids.has(String(d.externalId)));

  console.log(`\n  سير عمل التشغيل: ${wf.length} · لا نظيرَ لها: ${wfGone.length}`);
  console.log(`  طلبات الشحنات  : ${so.length} · لا نظيرَ لها: ${soGone.length}`);
  if (wfGone.length) console.log('    مثال:', wfGone.slice(0, 8).map((d) => d.reportNumber).join(' '));
  if (soGone.length) console.log('    مثال:', soGone.slice(0, 8).map((d) => d.reference).join(' '));

  if (!APPLY) { console.log('\n  فحصٌ فقط — أضِف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }
  if (!wfGone.length && !soGone.length) { console.log('\n  لا شيءَ يُمسح.\n'); await mongoose.disconnect(); return; }

  const dir = path.join(__dirname, '../../backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `opsDeletions-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  // تُحفظ الوثيقةُ كاملةً لا مفتاحُها: المحذوفُ لا يُستعاد من رقمٍ وحدَه.
  const wfFull = wfGone.length ? await OperationsWorkflow.find({ _id: { $in: wfGone.map((d) => d._id) } }).lean() : [];
  const soFull = soGone.length ? await ShipmentOrder.find({ _id: { $in: soGone.map((d) => d._id) } }).lean() : [];
  fs.writeFileSync(backup, JSON.stringify({ at: new Date(), workflows: wfFull, shipmentOrders: soFull }, null, 1));
  console.log(`\n  نسخةٌ محفوظة: ${path.relative(process.cwd(), backup)}`);

  const a = wfGone.length ? await OperationsWorkflow.deleteMany({ _id: { $in: wfGone.map((d) => d._id) } }) : { deletedCount: 0 };
  const b = soGone.length ? await ShipmentOrder.deleteMany({ _id: { $in: soGone.map((d) => d._id) } }) : { deletedCount: 0 };
  console.log(`  مُسح: ${a.deletedCount} كشفًا و${b.deletedCount} شحنة\n`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
