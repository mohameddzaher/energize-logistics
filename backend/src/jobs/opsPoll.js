/**
 * opsPoll — near-real-time bridge for the external UPL Operations platform.
 *
 * UPL is REST-only (it exposes no socket/webhook to us), so to make changes made
 * *there* appear *here* without a refresh we poll on an interval and, when
 * something actually changed, broadcast over our own socket.io. Open Operations
 * pages listen for these events and refetch.
 *
 * ── والمنصّةُ لا تُرتَّب بآخرِ تعديل ────────────────────────────────────────
 * كان الاستطلاعُ السريع يطلب `sort[updated_at]=desc` ويسمّي ما يعود «أحدثَ مئةٍ
 * تغيّرت». والمنصّةُ **تتجاهل `sort` كلَّه** — أيَّ حقلٍ كان، حتّى اسمًا مخترعًا لا
 * وجودَ له — وتردّ دائمًا مرتَّبةً بـ`created_at` تنازليًّا. فالمئةُ التي كنّا
 * نقرؤها هي أحدثُ مئةٍ **أُنشئت**، لا أحدثُ مئةٍ **تغيّرت**.
 *
 * وأثرُه أنّ كشفًا أُنشئ قبل أيّامٍ ثمّ صارت حالتُه اليومَ «استُلم السند» يقع خارج
 * الصفحة الأولى — كشفٌ أُنشئ يومَ ٨ سبتمبر كان على الصفحة الرابعة — فلا يراه
 * الاستطلاعُ أبدًا، وينتظر المزامنةَ الكاملةَ كلَّ ستّ ساعات. وعلى تلك الحالة
 * بالذات يقف تسجيلُ المشتريات، فالناسُ يغيّرونها هناك وتتأخّر عندنا ساعاتٍ.
 *
 * والحلُّ أنّ ما **يتحرّك** قليل: كلُّ ما لم يصل إلى «استُلم السند» أو «ملغاة»
 * تسعُمئةٍ لا خمسةٌ وثلاثون ألفًا — عشرُ صفحات. فتُقرأ كلُّها بالحالة، ومَن خرج
 * منها يُسأل عنه مفردًا. راجع pollMovingShipments.
 *
 * Three cadences:
 *   - FAST   (UPL_POLL_INTERVAL_MS, default 6s):  newest-created shipments
 *   - MOVING (UPL_MOVING_INTERVAL_MS, default 45s): every shipment still in play
 *   - STATS  (UPL_STATS_INTERVAL_MS, default 30s): dashboard counts/status totals
 *
 * Events emitted:
 *   ops:stats              -> dashboard counts/status breakdown changed
 *   ops:shipments:changed  -> the most-recent shipments changed (new/updated/status)
 *
 * For genuinely instant updates, expose POST /api/ops/webhook to UPL (see
 * opsController.webhook) — it broadcasts the same events on demand.
 */
const upl = require('../services/uplClient');
const { emitToAll } = require('../websocket/socketManager');

let fastTimer = null;
let statsTimer = null;
let movingTimer = null;
let lastStatsSig = null;
let lastShipSig = null;
let movingRunning = false;

/**
 * الحالاتُ التي ما زالت تتحرّك — وهي وحدَها التي تُستطلَع.
 *
 * «استُلم السند» (٢٩ ألفًا) و«ملغاة» (٥ آلاف) خارجَها: هما نهايتان، وقراءتُهما
 * كلَّ دقيقةٍ قراءةُ أربعةٍ وثلاثين ألفَ صفٍّ لا يتغيّر منها شيء. ولو أُعيد كشفٌ
 * من «ملغاة» إلى الحياة أمسكته المزامنةُ الكاملة — وهو نادرٌ بما يحتمل الانتظار.
 */
const MOVING = ['requesting', 'loading', 'uploaded', 'on_way', 'arrived', 'bond_sent', 'late', 'invoiced'];

async function pollShipments() {
  try {
    // أحدثُ مئةٍ **أُنشئت** — لا أكثر. (`sort` مُهمَلٌ في المنصّة؛ راجع رأسَ
    // الملفّ.) فهذا النداءُ يمسك الشحنةَ الجديدةَ في ثوانٍ، ولا يمسك تغيُّرَ حالةٍ
    // على كشفٍ أقدم — ذاك عملُ pollMovingShipments.
    const out = await upl.get('/admin/shipments', { query: { limit: 100, page: 1 } });
    const items = (out.data && out.data.items) || [];
    const sig = JSON.stringify(items.map((s) => [s.id, s.status, s.updated_at, s.deleted_at]));
    if (sig !== lastShipSig) {
      const firstRun = lastShipSig === null;
      lastShipSig = sig;
      if (!firstRun) {
        emitToAll('ops:shipments:changed', { resource: 'shipments', action: 'sync', at: Date.now() });
        // Keep the internal Operations workflow rows live too (within ~seconds).
        try {
          const { upsertShipments } = require('../services/opsWorkflowSyncService');
          await upsertShipments(items);
          emitToAll('workflow:bulkImported', { source: 'ops_upl', live: true });
        } catch (e) { /* sync hiccup — the full pass will reconcile */ }

        // ── وتُثبَّت في قسم طلبات الشحنات ───────────────────────────────────
        // القسمُ ليس مرآةً: هو نظامُنا الذي يُحلِّل ويُفلتِر ويطبع البوليصة.
        // فما يُنشأ في المنصّة يصير عندنا في الدورة نفسِها، ويبقى لو انقطعت.
        try {
          const { upsertPlatformShipments } = require('../services/shipmentOrderSyncService');
          const r = await upsertPlatformShipments(items);
          if (r.created || r.updated) emitToAll('shipmentOrders:updated', { source: 'platform', ...r });
        } catch (e) { /* المزامنةُ الكاملة تُصلح ما فات */ }
      }
    }
  } catch (e) { /* transient network/token hiccup — retry next tick */ }
}

/**
 * pollMovingShipments — كلُّ ما لم يستقرَّ بعد، مقروءًا بالحالة لا بالترتيب.
 *
 * خطوتان:
 *  ① تُقرأ دِلاءُ الحالات المتحرّكة كلُّها (عشرُ صفحاتٍ تقريبًا) وتُكتب كما هي.
 *    فأيُّ انتقالٍ **بين** حالتين متحرّكتين يصل عندنا في الدورة نفسِها.
 *  ② ومَن كان عندنا متحرّكًا ولم يعد في تلك الدِلاء فقد **خرج** منها — صار
 *    «استُلم السند» أو «ملغاة». وهما الدلوان الكبيران اللذان لا يُقرآن، فيُسأل
 *    عن كلِّ خارجٍ مفردًا بـ`GET /admin/shipments/:id`. وعددُهم في الدورة
 *    الواحدة أفرادٌ، فالثمنُ نداءٌ أو نداءان.
 *
 * وبهذا يصل «استُلم السند» في أقلَّ من دقيقة بدل ستّ ساعات.
 */
async function pollMovingShipments() {
  if (movingRunning) return { skipped: 'running' };
  movingRunning = true;
  try {
    const { upsertShipments } = require('../services/opsWorkflowSyncService');
    const items = [];
    const seen = new Set();
    for (const status of MOVING) {
      for (let page = 1; page <= 50; page++) {
        const out = await upl.get('/admin/shipments', { query: { limit: 100, page, status } });
        const batch = (out.data && out.data.items) || [];
        for (const s of batch) { items.push(s); seen.add(String(s.id)); }
        const meta = out.data && out.data.meta;
        if (!meta || !meta.hasNextPage) break;
      }
    }
    // دلوٌ فارغٌ تمامًا يعني نداءً فشل لا أسطولًا استقرّ — فلا يُبنى عليه حكمُ
    // «خرج من الحركة»، وإلّا سُئل عن الأسطول كلِّه مرّةً واحدة.
    if (!items.length) return { skipped: 'empty' };

    const OperationsWorkflow = require('../models/OperationsWorkflow');
    const ourMoving = await OperationsWorkflow
      .find({ externalSource: 'ops_upl', applicationStatus: { $in: MOVING } })
      .select('externalId externalUpdatedAt applicationStatus').lean();

    // ── ولا يُكتب إلّا ما تبدّل ───────────────────────────────────────────
    // التسعُمئةُ تُقرأ كلَّ دورة ولا يتغيّر منها في الدقيقة إلّا أفراد. وكتابتُها
    // جميعًا تكلّف ثلثَ دقيقةٍ لكلّ دورةٍ بلا طائل — فيُقارَن ختمُ المنصّة
    // (`updated_at`) بالمحفوظ، ويُكتب المختلفُ والجديدُ وحدَهما.
    const stampById = new Map(ourMoving.map((r) => [String(r.externalId), String(r.externalUpdatedAt || '')]));
    const touched = items.filter((s) => {
      const known = stampById.get(String(s.id));
      // صفٌّ لا ختمَ له عندنا (جديدٌ، أو من قبل إضافة الختم) يُكتب مرّةً فيُختَم.
      return known === undefined || known !== String(s.updated_at || '');
    });
    const res = touched.length ? await upsertShipments(touched) : { created: 0, updated: 0, removed: 0 };

    // ② مَن غادر الحركة.
    const left = ourMoving.map((r) => String(r.externalId)).filter((id) => id && !seen.has(id));

    // وحدٌّ أعلى للسؤال المفرد: أوّلُ دورةٍ بعد انقطاعٍ طويل قد تجد عشراتٍ، ولا
    // يُغرَق بها المنصّةُ في تِكّةٍ واحدة — البقيّةُ في الدورة التالية.
    const statusById = new Map(ourMoving.map((r) => [String(r.externalId), String(r.applicationStatus || '')]));
    const resolved = [];
    for (const id of left.slice(0, 40)) {
      try {
        const one = await upl.get(`/admin/shipments/${id}`);
        if (one && one.data && one.data.id) resolved.push(one.data);
      } catch (e) { /* شحنةٌ حُذفت أو نداءٌ تعثّر — المزامنةُ الكاملة تُصلحه */ }
    }
    if (resolved.length) await upsertShipments(resolved);

    // ── وعدُّ ما تغيّر حقًّا ──────────────────────────────────────────────────
    // لا يصحّ أن يُقاس بـ`modifiedCount`: كلُّ كتابةٍ تحمل `lastSyncedAt` جديدًا
    // فتُعَدّ «تعديلًا» ولو لم يتبدّل حرف. ولو بُني عليه البثُّ لأيقظ كلَّ شاشةٍ
    // مفتوحةٍ كلَّ دقيقةٍ بلا خبر.
    //
    // والمغادرُ لا يُعَدّ لمجرّد مغادرته: ترقيمُ المنصّة يُزحزَح والصفوفُ تتحرّك
    // بينما نقرأ، فيسقط صفٌّ من الترقيم وهو على حاله. يُعَدُّ من اختلفت حالتُه.
    const movedOn = resolved.filter((s) => String(s.status || '') !== statusById.get(String(s.id)));
    const changed = touched.length + movedOn.length;
    if (changed) {
      emitToAll('workflow:bulkImported', { source: 'ops_upl', live: true, moving: true });
      emitToAll('ops:shipments:changed', { resource: 'shipments', action: 'moving', at: Date.now() });
    }
    return {
      scanned: items.length, touched: touched.length, left: left.length, resolved: resolved.length, changed,
    };
  } catch (e) {
    return { error: e.message };
  } finally {
    movingRunning = false;
  }
}

async function pollStats() {
  try {
    const out = await upl.get('/admin/reports/stats');
    const sig = JSON.stringify(out.data || {});
    if (sig !== lastStatsSig) {
      lastStatsSig = sig;
      emitToAll('ops:stats', out.data);
    }
  } catch (e) { /* ignore */ }
}

function startOpsPoll() {
  if (fastTimer) return;
  if (!upl.isConfigured()) {
    console.log('[opsPoll] UPL not configured (UPL_* env vars missing) — live polling disabled');
    return;
  }
  const fastMs = Math.max(3000, parseInt(process.env.UPL_POLL_INTERVAL_MS || '6000', 10));
  const statsMs = Math.max(10000, parseInt(process.env.UPL_STATS_INTERVAL_MS || '30000', 10));
  // الدورةُ المستقرّةُ نحوَ خمسَ عشرةَ ثانيةً (عشرُ صفحاتٍ وكتابةُ ما تبدّل
  // وحدَه)، فدقيقةٌ بينها مريحة. وتراكبُ الدورات ممنوعٌ بـ`movingRunning` على
  // أيّ حال، فالمهلةُ هنا للراحة لا للسلامة.
  const movingMs = Math.max(20000, parseInt(process.env.UPL_MOVING_INTERVAL_MS || '60000', 10));
  fastTimer = setInterval(() => { pollShipments().catch(() => {}); }, fastMs);
  statsTimer = setInterval(() => { pollStats().catch(() => {}); }, statsMs);
  movingTimer = setInterval(() => { pollMovingShipments().catch(() => {}); }, movingMs);
  // Warm the caches shortly after boot.
  setTimeout(() => { pollShipments().catch(() => {}); pollStats().catch(() => {}); }, 4000);
  setTimeout(() => { pollMovingShipments().catch(() => {}); }, 12000);
  console.log(`[opsPoll] live polling started — new shipments every ${fastMs}ms, moving statuses every ${movingMs}ms, stats every ${statsMs}ms`);
}

module.exports = {
  startOpsPoll, pollShipments, pollStats, pollMovingShipments, MOVING,
};
