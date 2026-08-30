/**
 * opsReconcile — ما اختفى من منصّة الأوبريشن يختفي عندنا.
 *
 * ── الثغرة التي يسدُّها ─────────────────────────────────────────────────────
 * المزامنةُ اللحظيّة تحذف الشحنةَ إذا أعادتها المنصّةُ ومعها `deleted_at`. لكنّ
 * الصفَّ المحذوفَ حذفًا نهائيًّا لا يعود في أيّ صفحة — فلا يمرُّ على المزامنة
 * أصلًا، ويبقى عندنا كشفًا لا وجودَ له، يُعدُّ في «فواتير لم تصل» وفي كلّ تقرير.
 *
 * وشيتُ المتابعة يكتشفها: خانةُ تاريخ الكشف تصير `#N/A` لأنّ البحثَ في المنصّة
 * لم يجد الرقم. فالإشارةُ موجودةٌ ونحن لا نقرؤها.
 *
 * ── ولماذا مرّةً في اليوم لا كلَّ دقيقة ─────────────────────────────────────
 * المطابقةُ تتطلّب مسحَ القائمة كاملةً: ثلاثمئةٍ وأربعون صفحةً من مئة. وهو ثمنٌ
 * لا يُدفع كلَّ دقيقةٍ لأجل حذفٍ يقع مرّةً في أسابيع. فيُمسح ليلًا حين لا أحدَ
 * يعمل، ويُترك اللحظيُّ للإضافة والتعديل.
 *
 * ── وشرطُ السلامة ───────────────────────────────────────────────────────────
 * مسحٌ ناقصٌ يجعل الحيَّ يبدو محذوفًا. فإن انقطع الاتّصالُ في منتصف المسح، أو
 * أعادت المنصّةُ عددًا غيرَ معقول، يُوقَف كلُّ شيء ولا يُمسح صفٌّ واحد. الخطأُ
 * في هذا الاتّجاه يُصلَح في الدورة التالية؛ وفي الاتّجاه الآخر يُفقد عمل.
 */
const upl = require('../services/uplClient');

let timer = null;
let running = false;

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_PLAUSIBLE = 1000;

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
    for (const s of items) {
      if (s.deleted_at) continue;
      if (s.graduation_statement_num != null) nums.add(String(s.graduation_statement_num).trim());
      if (s.id) ids.add(String(s.id));
    }
    seen += items.length;
    if (!meta.hasNextPage) break;
    page += 1;
  }
  return { nums, ids, seen, total };
}

async function reconcileOnce({ log = true, apply = true } = {}) {
  if (running) return { skipped: 'already-running' };
  if (!upl.isConfigured()) return { skipped: 'upl-not-configured' };
  running = true;
  try {
    const { nums, ids, seen, total } = await sweepPlatform();
    if (total && seen < total) return { skipped: `partial-sweep ${seen}/${total}` };
    if (nums.size < MIN_PLAUSIBLE) return { skipped: `implausible ${nums.size}` };

    const OperationsWorkflow = require('../models/OperationsWorkflow');
    const ShipmentOrder = require('../models/ShipmentOrder');

    const wf = await OperationsWorkflow.find({}).select('reportNumber').lean();
    const gone = wf.filter((d) => !nums.has(String(d.reportNumber).trim())).map((d) => d._id);
    // شحناتُنا (`source: 'system'`) لا معرّفَ خارجيًّا لها ولا تُمسّ أبدًا.
    const so = await ShipmentOrder.find({ source: 'platform' }).select('externalId').lean();
    const goneSo = so.filter((d) => !ids.has(String(d.externalId))).map((d) => d._id);

    if (!apply) return { wouldRemove: gone.length, wouldRemoveOrders: goneSo.length, seen };

    let removed = 0; let removedOrders = 0;
    if (gone.length) removed = (await OperationsWorkflow.deleteMany({ _id: { $in: gone } })).deletedCount || 0;
    if (goneSo.length) removedOrders = (await ShipmentOrder.deleteMany({ _id: { $in: goneSo } })).deletedCount || 0;
    if (log && (removed || removedOrders)) {
      console.log(`[opsReconcile] removed ${removed} workflow rows, ${removedOrders} shipment orders (platform has ${nums.size})`);
    }
    return { removed, removedOrders, seen };
  } catch (e) {
    console.error('opsReconcile error:', e.message);
    return { error: e.message };
  } finally {
    running = false;
  }
}

function startOpsReconcile() {
  if (timer) return;
  if (!upl.isConfigured()) {
    console.log('[opsReconcile] UPL not configured — reconciliation disabled');
    return;
  }
  // بعد عشر دقائق من الإقلاع كي لا يزاحم بدءَ الخدمة، ثمّ كلَّ أربعٍ وعشرين ساعة.
  setTimeout(() => { reconcileOnce().catch(() => {}); }, 10 * 60 * 1000);
  timer = setInterval(() => { reconcileOnce().catch(() => {}); }, DAY_MS);
  console.log('Ops deletion reconciliation scheduled (daily)');
}

module.exports = { startOpsReconcile, reconcileOnce };
