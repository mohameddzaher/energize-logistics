/**
 * opsPoll — near-real-time bridge for the external UPL Operations platform.
 *
 * UPL is REST-only (it exposes no socket/webhook to us), so to make changes made
 * *there* appear *here* without a refresh we poll on an interval and, when
 * something actually changed, broadcast over our own socket.io. Open Operations
 * pages listen for these events and refetch.
 *
 * Two cadences so we feel instant without hammering their heavy aggregate query:
 *   - FAST  (UPL_POLL_INTERVAL_MS, default 6s): most-recently-updated shipments
 *   - STATS (UPL_STATS_INTERVAL_MS, default 30s): dashboard counts/status totals
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
let lastStatsSig = null;
let lastShipSig = null;

async function pollShipments() {
  try {
    // Pull the 100 most-recently-touched shipments (UPL's page cap) each tick so a
    // burst of changes in the same window is still caught live — it's one call.
    const out = await upl.get('/admin/shipments', { query: { limit: 100, page: 1, 'sort[updated_at]': 'desc' } });
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
  fastTimer = setInterval(() => { pollShipments().catch(() => {}); }, fastMs);
  statsTimer = setInterval(() => { pollStats().catch(() => {}); }, statsMs);
  // Warm both caches shortly after boot.
  setTimeout(() => { pollShipments().catch(() => {}); pollStats().catch(() => {}); }, 4000);
  console.log(`[opsPoll] live polling started — shipments every ${fastMs}ms, stats every ${statsMs}ms`);
}

module.exports = { startOpsPoll, pollShipments, pollStats };
