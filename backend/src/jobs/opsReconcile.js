/**
 * opsReconcile: what disappears from the operations platform disappears here.
 * Gap: a hard-deleted platform row never appears on any page, so realtime sync never deletes it and it stays as a phantom report counted in the invoices-not-received figure; the follow-up sheet shows it as `#N/A` in the report date.
 * Runs daily at night because it scans the full list (340 pages of 100). Safety: if the scan is incomplete or the count implausible, nothing is removed, since a partial scan makes live rows look deleted.
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
    // `sort` is ignored by the platform, which always returns creation order; see jobs/opsPoll.
    // eslint-disable-next-line no-await-in-loop
    const out = await upl.get('/admin/shipments', { query: { limit: 100, page } });
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

// Reports only unless a caller passes `apply`: absence from the platform never
// deletes our data on its own.
async function reconcileOnce({ log = true, apply = false } = {}) {
  if (running) return { skipped: 'already-running' };
  if (!upl.isConfigured()) return { skipped: 'upl-not-configured' };
  running = true;
  try {
    const { nums, ids, seen, total } = await sweepPlatform();
    if (total && seen < total) return { skipped: `partial-sweep ${seen}/${total}` };
    if (nums.size < MIN_PLAUSIBLE) return { skipped: `implausible ${nums.size}` };

    const OperationsWorkflow = require('../models/OperationsWorkflow');
    const ShipmentOrder = require('../models/ShipmentOrder');

    // Platform rows only: a row created on our system is on no platform page.
    const wf = await OperationsWorkflow.find({ externalSource: 'ops_upl' }).select('reportNumber').lean();
    const gone = wf.filter((d) => !nums.has(String(d.reportNumber).trim())).map((d) => d._id);
    // Our own shipments (`source: 'system'`) have no external id and are never touched.
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
  // Ten minutes after boot so it does not compete with service startup, then every 24 hours.
  setTimeout(() => { reconcileOnce().catch(() => {}); }, 10 * 60 * 1000);
  timer = setInterval(() => { reconcileOnce().catch(() => {}); }, DAY_MS);
  console.log('Ops deletion reconciliation scheduled (daily)');
}

module.exports = { startOpsReconcile, reconcileOnce };
