/**
 * opsPoll: near-real-time bridge for the external UPL Operations platform. UPL is REST-only, so we poll and broadcast over our own socket.io when something changed; open Operations pages refetch.
 * The platform ignores `sort` and always returns rows by `created_at` descending, so the newest 100 are the newest created, not changed. A report whose status changed days after creation fell off page one and waited for the six-hourly full sync, so the moving set (about 900 rows, ten pages) is read by status and rows that left are queried individually (pollMovingShipments).
 * Cadences: FAST (UPL_POLL_INTERVAL_MS, 6s) newest created; MOVING (UPL_MOVING_INTERVAL_MS, 45s) every shipment still in play; STATS (UPL_STATS_INTERVAL_MS, 30s) dashboard counts.
 * Events: ops:stats, ops:shipments:changed. POST /api/ops/webhook (opsController.webhook) broadcasts the same events on demand.
 */
const upl = require('../services/uplClient');
const { emitToAll } = require('../websocket/socketManager');
const cache = require('../utils/ttlCache');

/**
 * Invalidate the cache before broadcasting. The `/api/ops` read endpoints are cached for 8 seconds (opsController CACHE_TTL) so concurrent users share one external call. Broadcasting without clearing it made the screen refetch a stale page and stay one change behind.
 * `cache.clear` also crosses to the other worker (stamp in `cachestamps`, see utils/ttlCache); otherwise the second worker keeps serving stale data.
 */
const invalidateOps = () => { try { cache.clear('ops:'); } catch (_) { /* The cache is an optimization, not a requirement. */ } };

let fastTimer = null;
let statsTimer = null;
let movingTimer = null;
let lastStatsSig = null;
let lastShipSig = null;
let movingRunning = false;

/** Statuses still moving; only these are polled. The receipt-of-document status (about 29k rows) and the cancelled status (about 5k) are terminal; reading 34k unchanged rows every minute is wasteful. A report revived from cancelled is caught by the full sync, which is rare enough to wait. */
const MOVING = ['requesting', 'loading', 'uploaded', 'on_way', 'arrived', 'bond_sent', 'late', 'invoiced'];

/**
 * The heavy cycle runs on one worker only. Production runs two workers in cluster mode and everything in this file runs in both; unguarded, the external platform would be read twenty pages a minute instead of ten, and both workers would query the same departed rows.
 * Require the first worker: pm2 sets `NODE_APP_INSTANCE` and keeps it for the replacement when a worker restarts. With no cluster (single run or local) the value is absent and the job runs as is.
 */
const isPollWorker = () => {
  const i = process.env.NODE_APP_INSTANCE;
  return i === undefined || i === '' || i === '0';
};

async function pollShipments() {
  try {
    // Only the newest 100 created, nothing more (`sort` is ignored by the platform; see the file header). This call catches a new shipment within seconds but not a status change on an older report; that is pollMovingShipments.
    const out = await upl.get('/admin/shipments', { query: { limit: 100, page: 1 } });
    const items = (out.data && out.data.items) || [];
    const sig = JSON.stringify(items.map((s) => [s.id, s.status, s.updated_at, s.deleted_at]));
    if (sig !== lastShipSig) {
      const firstRun = lastShipSig === null;
      lastShipSig = sig;
      if (!firstRun) {
        invalidateOps();
        emitToAll('ops:shipments:changed', { resource: 'shipments', action: 'sync', at: Date.now() });
        // Keep the internal Operations workflow rows live too (within ~seconds).
        try {
          const { upsertShipments } = require('../services/opsWorkflowSyncService');
          await upsertShipments(items);
          emitToAll('workflow:bulkImported', { source: 'ops_upl', live: true });
        } catch (e) { /* sync hiccup — the full pass will reconcile */ }

        // Also persisted into the shipment-orders section. That section is not a mirror: it is our own system that analyzes, filters and prints the waybill, so shipments created on the platform become ours in the same cycle and survive an outage.
        try {
          const { upsertPlatformShipments } = require('../services/shipmentOrderSyncService');
          const r = await upsertPlatformShipments(items);
          if (r.created || r.updated) emitToAll('shipmentOrders:updated', { source: 'platform', ...r });
        } catch (e) { /* The full sync repairs anything missed. */ }
      }
    }
  } catch (e) { /* transient network/token hiccup — retry next tick */ }
}

/**
 * pollMovingShipments: everything not yet settled, read by status rather than by order.
 * 1. Read all moving status buckets (about ten pages) and write them as is, so transitions between moving statuses arrive in the same cycle.
 * 2. Anything we hold as moving that is no longer in the buckets has left them (receipt-of-document or cancelled, the unread large buckets), so each is queried individually with GET /admin/shipments/:id; only a few leave per cycle.
 */
async function pollMovingShipments() {
  if (movingRunning) return { skipped: 'running' };
  movingRunning = true;
  try {
    const { upsertShipments } = require('../services/opsWorkflowSyncService');
    // Buckets are read concurrently, not one after another. Ten sequential buckets take about 15 seconds per cycle and forced a long wait between cycles. They are fully independent, so reading them together makes the cycle take as long as the slowest bucket (a few seconds) and it can repeat every 15 seconds.
    const buckets = await Promise.all(MOVING.map(async (status) => {
      const rows = [];
      for (let page = 1; page <= 50; page++) {
        const out = await upl.get('/admin/shipments', { query: { limit: 100, page, status } });
        const batch = (out.data && out.data.items) || [];
        rows.push(...batch);
        const meta = out.data && out.data.meta;
        if (!meta || !meta.hasNextPage) break;
      }
      return rows;
    }));
    const items = [];
    const seen = new Set();
    for (const rows of buckets) for (const s of rows) { items.push(s); seen.add(String(s.id)); }
    // A completely empty bucket means a failed call, not a settled fleet, so no "left the moving set" judgment is built on it; otherwise the whole fleet would be queried at once.
    if (!items.length) return { skipped: 'empty' };

    const OperationsWorkflow = require('../models/OperationsWorkflow');
    const ourMoving = await OperationsWorkflow
      .find({ externalSource: 'ops_upl', applicationStatus: { $in: MOVING } })
      // No `_id` (not read here), so it is answered from the index alone; see the model's index.
      .select('-_id externalId externalUpdatedAt applicationStatus').lean();

    // Only changed rows are written. The 900 rows are read every cycle but only a few change per minute, and writing all of them costs a third of a minute per cycle for nothing. So the platform stamp (`updated_at`) is compared with the stored one and only different and new rows are written.
    const stampById = new Map(ourMoving.map((r) => [String(r.externalId), String(r.externalUpdatedAt || '')]));
    const touched = items.filter((s) => {
      const known = stampById.get(String(s.id));
      // A row with no stamp on our side (new, or from before the stamp existed) is written once and gets stamped.
      return known === undefined || known !== String(s.updated_at || '');
    });
    const res = touched.length ? await upsertShipments(touched) : { created: 0, updated: 0, removed: 0 };

    // The shipment-orders section follows the moving set too. This cycle used to write only workflow reports, and shipment orders were updated only by the fast cycle, which reads the newest created, not the changed. A shipment created yesterday whose status changed today stayed stale until a full sync (observed: ours in transit, platform at receipt-of-document).
    if (touched.length) {
      try {
        const { upsertPlatformShipments } = require('../services/shipmentOrderSyncService');
        const r2 = await upsertPlatformShipments(touched);
        if (r2.created || r2.updated) emitToAll('shipmentOrders:updated', { source: 'platform', ...r2 });
      } catch (e) { /* The full sync repairs anything missed. */ }
    }

    // Step 2: those that left the moving set.
    const left = ourMoving.map((r) => String(r.externalId)).filter((id) => id && !seen.has(id));

    // Upper bound on individual queries: the first cycle after a long outage may find dozens, and they must not flood the platform in one tick. The rest go in the next cycle.
    const statusById = new Map(ourMoving.map((r) => [String(r.externalId), String(r.applicationStatus || '')]));
    const resolved = [];
    for (const id of left.slice(0, 40)) {
      try {
        const one = await upl.get(`/admin/shipments/${id}`);
        if (one && one.data && one.data.id) resolved.push(one.data);
      } catch (e) { /* A deleted shipment or a failed call; the full sync repairs it. */ }
    }
    if (resolved.length) {
      await upsertShipments(resolved);
      try {
        const { upsertPlatformShipments } = require('../services/shipmentOrderSyncService');
        const r3 = await upsertPlatformShipments(resolved);
        if (r3.created || r3.updated) emitToAll('shipmentOrders:updated', { source: 'platform', ...r3 });
      } catch (e) { /* */ }
    }

    // Count what really changed. `modifiedCount` is wrong here: every write carries a new `lastSyncedAt`, so each counts as modified even if nothing else changed, and broadcasting on it would wake every open screen each minute for nothing.
    // A departed row is not counted merely for leaving: the platform's pagination shifts while we read, so a row can drop out of a page unchanged. Count rows whose status differs.
    const movedOn = resolved.filter((s) => String(s.status || '') !== statusById.get(String(s.id)));
    const changed = touched.length + movedOn.length;
    if (changed) {
      invalidateOps();
      // The status is sent with the event rather than queried. The screen can recolor the row from the event itself without a second call, so the status changes in front of the user the moment the event arrives.
      const statuses = [...touched, ...movedOn]
        .filter((s) => String(s.status || '') !== statusById.get(String(s.id)))
        .map((s) => ({ id: String(s.id), status: String(s.status || '') }));
      emitToAll('workflow:bulkImported', { source: 'ops_upl', live: true, moving: true, statuses });
      emitToAll('ops:shipments:changed', {
        resource: 'shipments', action: 'moving', statuses, at: Date.now(),
      });
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
  // Warm the platform dashboard without a filter (Arabic and English) so the first person to open the page finds its numbers ready; see getDashboard in opsController.
  try {
    const { fetchDashboard } = require('../controllers/opsController');
    fetchDashboard('ar', {}).catch(() => {});
    fetchDashboard('en', {}).catch(() => {});
  } catch (_) { /* */ }
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
  // The delay is measured from the end of a cycle, not its start. A fixed interval counts from launch, so a long cycle (platform network trouble) makes cycles overlap or get lost, and `movingRunning` drops the extra so latency doubles unnoticed. Chain instead: run, wait a short gap, run the next. The platform is never asked in two cycles at once, and latency is always cycle time (about 8s for 800 shipments) plus the gap.
  const movingGapMs = Math.max(2000, parseInt(process.env.UPL_MOVING_INTERVAL_MS || '5000', 10));
  fastTimer = setInterval(() => { pollShipments().catch(() => {}); }, fastMs);
  statsTimer = setInterval(() => { pollStats().catch(() => {}); }, statsMs);
  const movingLoop = () => {
    pollMovingShipments()
      .catch(() => {})
      .finally(() => { movingTimer = setTimeout(movingLoop, movingGapMs); });
  };
  // Warm the caches shortly after boot.
  setTimeout(() => { pollShipments().catch(() => {}); pollStats().catch(() => {}); }, 4000);
  if (isPollWorker()) movingTimer = setTimeout(movingLoop, 12000);
  const moving = isPollWorker() ? `${movingGapMs}ms after each cycle` : 'on worker 0 only';
  console.log(`[opsPoll] live polling started — new shipments every ${fastMs}ms, moving statuses ${moving}, stats every ${statsMs}ms`);
}

module.exports = {
  startOpsPoll, pollShipments, pollStats, pollMovingShipments, MOVING,
};
