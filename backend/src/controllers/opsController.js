/**
 * opsController — proxies our authenticated /api/ops requests to the external
 * UPL Operations platform and broadcasts changes over socket.io so every open
 * Operations page updates live without a refresh.
 *
 * Reads are passed straight through (UPL stays the single source of truth);
 * writes are forwarded and then echoed to all clients as `ops:<resource>:changed`.
 */
const upl = require('../services/uplClient');
const { OPS_RESOURCES } = require('../config/opsResources');
const { emitToAll } = require('../websocket/socketManager');
const cache = require('../utils/ttlCache');

// Short cache so a burst of concurrent users shares one upstream call. Bounded
// staleness: the poll broadcasts changes within seconds and writes bust it.
const CACHE_TTL = 8000;

const langOf = (req) => req.query.lang || req.headers['x-lang'] || undefined;

// UPL treats `date_to` as EXCLUSIVE of that day (i.e. `< date_to 00:00`), so a
// plain date drops the end day's records. Make it inclusive by pushing it to the
// end of the day.
const endOfDay = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T23:59:59` : d);

// UPL validates query params strictly (forbidNonWhitelisted), so strip our own
// control params (`lang` is sent as a header instead) before forwarding.
const upstreamQuery = (req) => {
  const q = { ...req.query };
  delete q.lang;
  if (q.date_to) q.date_to = endOfDay(q.date_to);
  return q;
};

/** Map an upstream/uplClient error onto a clean HTTP response. */
function fail(res, error, fallback) {
  const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
  if (status >= 500) console.error(`${fallback}:`, error.message);
  res.status(status).json({ message: error.message || fallback, upstream: error.upstream });
}

/** Resolve + validate the :resource param against the whitelist. */
function resolve(req, res) {
  const cfg = OPS_RESOURCES[req.params.resource];
  if (!cfg) {
    res.status(404).json({ message: `Unknown operations resource: ${req.params.resource}` });
    return null;
  }
  return cfg;
}

function broadcast(resource, action, payload = {}) {
  try { cache.clear('ops:'); } catch (e) {} // a write happened — serve fresh data
  try { emitToAll(`ops:${resource}:changed`, { resource, action, ...payload, at: Date.now() }); } catch (e) {}
}

// ---- Dashboard ------------------------------------------------------------

// Combined operations dashboard: header stats, full report stats, and the
// charts/maps/tables payload — fetched in parallel, partial failures tolerated.
exports.getDashboard = async (req, res) => {
  try {
    const lang = langOf(req);
    const key = `ops:dash:${lang || ''}:${req.query.date_from || ''}:${req.query.date_to || ''}:${req.query.branches || ''}`;
    const hit = cache.get(key);
    if (hit) return res.json(hit);

    const query = {
      date_from: req.query.date_from,
      date_to: endOfDay(req.query.date_to),
      branches: req.query.branches,
    };
    const [home, stats, charts] = await Promise.allSettled([
      upl.get('/admins/operation-app-home', { lang }),
      upl.get('/admin/reports/stats', { query, lang }),
      upl.get('/admin/reports/charts-maps-tables', { query, lang }),
    ]);
    const payload = {
      home: home.status === 'fulfilled' ? home.value.data : null,
      stats: stats.status === 'fulfilled' ? stats.value.data : null,
      charts: charts.status === 'fulfilled' ? charts.value.data : null,
    };
    cache.set(key, payload, CACHE_TTL);
    res.json(payload);
  } catch (error) {
    fail(res, error, 'Failed to load operations dashboard');
  }
};

// ---- Generic resource CRUD ------------------------------------------------

exports.list = async (req, res) => {
  const cfg = resolve(req, res);
  if (!cfg) return;
  try {
    const q = upstreamQuery(req);
    const key = `ops:list:${req.params.resource}:${langOf(req) || ''}:${JSON.stringify(q)}`;
    const hit = cache.get(key);
    if (hit) return res.json(hit);
    const out = await upl.get(cfg.path, { query: q, lang: langOf(req) });
    const data = out.data ?? out;
    cache.set(key, data, CACHE_TTL);
    res.json(data);
  } catch (error) {
    fail(res, error, `Failed to list ${req.params.resource}`);
  }
};

exports.getOne = async (req, res) => {
  const cfg = resolve(req, res);
  if (!cfg) return;
  try {
    const out = await upl.get(`${cfg.path}/${encodeURIComponent(req.params.id)}`, { lang: langOf(req) });
    res.json(out.data ?? out);
  } catch (error) {
    fail(res, error, `Failed to fetch ${req.params.resource}`);
  }
};

exports.create = async (req, res) => {
  const cfg = resolve(req, res);
  if (!cfg) return;
  if (cfg.readOnly) return res.status(405).json({ message: `${req.params.resource} is read-only` });
  try {
    const opts = cfg.form ? { form: req.body } : { body: req.body };
    const out = await upl.post(cfg.path, { ...opts, lang: langOf(req) });
    broadcast(req.params.resource, 'created');
    res.status(201).json(out.data ?? out);
  } catch (error) {
    fail(res, error, `Failed to create ${req.params.resource}`);
  }
};

exports.update = async (req, res) => {
  const cfg = resolve(req, res);
  if (!cfg) return;
  if (cfg.readOnly) return res.status(405).json({ message: `${req.params.resource} is read-only` });
  try {
    const opts = cfg.form ? { form: req.body } : { body: req.body };
    const out = await upl.patch(`${cfg.path}/${encodeURIComponent(req.params.id)}`, { ...opts, lang: langOf(req) });
    broadcast(req.params.resource, 'updated', { id: req.params.id });
    res.json(out.data ?? out);
  } catch (error) {
    fail(res, error, `Failed to update ${req.params.resource}`);
  }
};

exports.remove = async (req, res) => {
  const cfg = resolve(req, res);
  if (!cfg) return;
  if (cfg.readOnly) return res.status(405).json({ message: `${req.params.resource} is read-only` });
  try {
    const out = await upl.del(`${cfg.path}/${encodeURIComponent(req.params.id)}`, { lang: langOf(req) });
    broadcast(req.params.resource, 'deleted', { id: req.params.id });
    res.json(out.data ?? out ?? { ok: true });
  } catch (error) {
    fail(res, error, `Failed to delete ${req.params.resource}`);
  }
};

exports.restore = async (req, res) => {
  const cfg = resolve(req, res);
  if (!cfg) return;
  if (cfg.readOnly) return res.status(405).json({ message: `${req.params.resource} is read-only` });
  try {
    const out = await upl.patch(`${cfg.path}/restore/${encodeURIComponent(req.params.id)}`, { lang: langOf(req) });
    broadcast(req.params.resource, 'restored', { id: req.params.id });
    res.json(out.data ?? out);
  } catch (error) {
    fail(res, error, `Failed to restore ${req.params.resource}`);
  }
};

// ---- Shipment-specific extras --------------------------------------------

// Bulk/inline status change: body { status, ids: [...], status_log_details? }
exports.updateShipmentStatus = async (req, res) => {
  try {
    const out = await upl.patch('/admin/shipments/status', { body: req.body, lang: langOf(req) });
    broadcast('shipments', 'status', { ids: req.body?.ids, status: req.body?.status });
    res.json(out.data ?? out);
  } catch (error) {
    fail(res, error, 'Failed to update shipment status');
  }
};

// ---- Inbound webhook (genuinely-instant push, if UPL is configured to call us)
// Unauthenticated by design (UPL can't carry our cookie) but gated by a shared
// secret. UPL should POST { resource, action, id?, ids?, status? } whenever data
// changes on their side; we rebroadcast it to all clients immediately.
exports.webhook = async (req, res) => {
  const secret = process.env.UPL_WEBHOOK_SECRET;
  const provided = req.headers['x-webhook-secret'] || req.query.secret;
  if (!secret || provided !== secret) return res.status(401).json({ message: 'Invalid webhook secret' });

  const { resource = 'shipments', action = 'sync', id, ids, status } = req.body || {};
  try { cache.clear('ops:'); } catch (e) {}
  try { emitToAll(`ops:${resource}:changed`, { resource, action, id, ids, status, at: Date.now() }); } catch (e) {}
  // Refresh the cached snapshots so dashboards reflect the change right away.
  try {
    const { pollStats, pollShipments } = require('../jobs/opsPoll');
    pollStats().catch(() => {});
    pollShipments().catch(() => {});
  } catch (e) {}
  res.json({ ok: true });
};

exports.shipmentTimeline = async (req, res) => {
  try {
    const out = await upl.get(`/admin/shipments/timeline/${encodeURIComponent(req.params.id)}`, { lang: langOf(req) });
    res.json(out.data ?? out);
  } catch (error) {
    fail(res, error, 'Failed to load shipment timeline');
  }
};
