/**
 * Tiny in-process TTL cache. Used to coalesce identical UPL proxy reads across
 * concurrent users (the UPL data is global, not per-user), so 100 users hitting
 * the dashboard in the same second cost ONE upstream call, not 100.
 *
 * Short TTLs only — the poll broadcasts changes within seconds and writes bust
 * the cache, so staleness is bounded.
 */
const store = new Map();
let lastSweep = 0;

function sweep() {
  const now = Date.now();
  if (now - lastSweep < 30000) return; // amortize cleanup
  lastSweep = now;
  for (const [k, e] of store) if (e.exp <= now) store.delete(k);
}

function get(key) {
  maybePoll();                 // What another worker invalidated is cleared here; see syncStamps
  const e = store.get(key);
  if (!e) return undefined;
  if (e.exp <= Date.now()) { store.delete(key); return undefined; }
  return e.val;
}

function set(key, val, ttlMs) {
  store.set(key, { val, exp: Date.now() + ttlMs });
  sweep();
}

// Drop everything (no prefix) or every key starting with `prefix`.
function clearLocal(prefix) {
  if (!prefix) { store.clear(); inflight.clear(); return; }
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
  // In-flight promises are dropped too: one started before the write would store its old result over the cache just invalidated, and the screen would revert to pre-edit data for no visible reason.
  for (const k of inflight.keys()) if (k.startsWith(prefix)) inflight.delete(k);
}

// Invalidation crosses to the other worker.
// Prod runs two workers (PM2 cluster), each with its own cache. A call that closed an alert hit one worker and cleared only its cache, and the next read alternated between workers, so the alert disappeared, came back and disappeared. Measured: twelve reads after closing one alert gave 43 and 42 alternately, twelve times with no exception.
// This affects every invalidation on the platform, not only alerts (vehicle registry, statement filters, boards): any write followed by a read on the other worker returns pre-write data.
// So invalidation is recorded in the shared DB (one stamp per prefix) and each worker reads the stamps at most once a second and clears locally what was cleared elsewhere. One small query per second per worker, with a one-second staleness bound, instead of a page that lies half the time.
const STAMP_COLL = 'cachestamps';
const POLL_MS = 1000;
const seen = new Map();          // Prefix to the last stamp seen
let lastPoll = 0;
let polling = false;

const db = () => {
  try {
    const mongoose = require('mongoose');
    return mongoose.connection?.readyState === 1 ? mongoose.connection.db : null;
  } catch (_) { return null; }
};

// Better than polling: a change stream.
// Polling once a second leaves a window: a worker that polled 200 ms before the invalidation serves its cache until its second elapses (measured: two stale reads out of every four, not one).
// `cachestamps` is a small collection on a cluster that supports `watch`, so one change stream per worker is opened on it: a stamp written by any worker reaches the other in milliseconds with no query. Polling stays as a safety net: if the cluster lacks change streams or the stream drops, behaviour falls back to one second instead of losing consistency entirely.
let watcher = null;
function startWatch() {
  const d = db();
  if (!d || watcher) return;
  try {
    watcher = d.collection(STAMP_COLL).watch([], { fullDocument: 'updateLookup' });
    watcher.on('change', (ev) => {
      const id = ev.documentKey?._id;
      if (!id) return;
      const at = ev.fullDocument?.at ? new Date(ev.fullDocument.at).getTime() : Date.now();
      if (seen.get(id) === at) return;              // Our own stamp
      seen.set(id, at);
      clearLocal(id === '*' ? undefined : id);
    });
    watcher.on('error', () => { try { watcher.close(); } catch (_) {} watcher = null; });
    watcher.on('close', () => { watcher = null; });
  } catch (_) { watcher = null; }
}

/** Reads the stamps and clears locally what another worker invalidated. Never throws. */
async function syncStamps() {
  const d = db();
  if (!d) return;
  startWatch();
  try {
    const rows = await d.collection(STAMP_COLL).find({}).toArray();
    for (const r of rows) {
      const prev = seen.get(r._id);
      const at = r.at ? new Date(r.at).getTime() : 0;
      // A stamp seen for the first time is not exempt.
      // It used to be recorded without clearing, so the cache would not be wiped at startup. That was wrong: at startup the cache is empty anyway so clearing costs nothing, but a worker that cached before it ever saw its peer's stamp is seeing it for the first time, which is exactly when it must clear. With that exemption the alternation persisted after deploy (43 and 42, twelve times).
      // Our own stamp does not make us clear again: `clear` records it in `seen` before writing it.
      if (prev === undefined || at > prev) {
        seen.set(r._id, at);
        clearLocal(r._id === '*' ? undefined : r._id);
      }
    }
  } catch (_) { /* The cache is an optimisation, not a requirement */ }
}

/** Called from `get`: triggers background sync at most once a second. */
function maybePoll() {
  const now = Date.now();
  if (polling || now - lastPoll < POLL_MS) return;
  lastPoll = now;
  polling = true;
  syncStamps().finally(() => { polling = false; });
}

/**
 * A sync that is awaited before serving the request, called from middleware on every call.
 * Why awaited and not left in the background: a background sync leaves the first read after an invalidation stale, because an idle worker only wakes on a request, serves it from its cache and then syncs. The first read after a write is exactly what the user does: press close and the page reloads immediately. Measured after deploy: first read 43, the eleven after it 42.
 * So it is awaited at most once a second: one small query borne by one request per second, while the other requests compare a number and wait for nothing.
 */
async function syncIfDue() {
  const now = Date.now();
  if (polling || now - lastPoll < POLL_MS) return;
  lastPoll = now;
  polling = true;
  try { await syncStamps(); } finally { polling = false; }
}

function clear(prefix) {
  clearLocal(prefix);
  const d = db();
  if (!d) return;
  const key = prefix || '*';
  const at = Date.now();
  seen.set(key, at);            // Our own stamp, so we do not clear a second time because of it
  d.collection(STAMP_COLL)
    .updateOne({ _id: key }, { $set: { at: new Date(at) } }, { upsert: true })
    .catch(() => { /* Local invalidation is done; propagation is an optimisation */ });
}

/**
 * `clear` awaited, for scripts.
 * A script that writes to the DB and then closes its connection has no cache to clear; what it needs is for its stamp to reach both workers. `clear` writes the stamp without awaiting it, so the connection closes before it arrives and nobody learns of it. Here it is awaited until written.
 */
async function clearShared(prefix) {
  clearLocal(prefix);
  const d = db();
  if (!d) return false;
  const key = prefix || '*';
  const at = Date.now();
  seen.set(key, at);
  await d.collection(STAMP_COLL).updateOne({ _id: key }, { $set: { at: new Date(at) } }, { upsert: true });
  return true;
}

// Single-flight.
// `wrap` used to read the cache and then compute, with a gap between. When forty staff open the same board in the same second (as happens every morning) they all miss, and the same result is computed forty times against the DB. Measured under forty concurrent users: 3 to 6.6 seconds at p95, all of it waiting on duplicated work.
// Now the promise is stored, not just the result: the first caller starts the computation and anyone arriving while it runs awaits the same promise. One computation serves all forty.
// The promise is removed on failure: if kept, every later caller would inherit an error that happened once, turning a transient fault into a persistent one until the TTL ends.
const inflight = new Map();

async function wrap(key, ttlMs, producer) {
  const hit = get(key);
  if (hit !== undefined) return hit;

  const running = inflight.get(key);
  if (running) return running;

  const p = (async () => {
    const val = await producer();
    set(key, val, ttlMs);
    return val;
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

/**
 * Serve the stale value and recompute in the background.
 * Boards refetched on every live event (operations sync broadcasts every few seconds) expired every minute, and the first opener afterwards paid the full computation, seconds in front of a loading spinner. Here the last answer is served immediately while younger than `maxMs`, and once past `freshMs` it is recomputed once in the background (single-flight) so the next caller finds it fresh. Nobody waits except when there is no answer at all: the first time, or after a real `clear` from a write in the section.
 */
async function wrapStale(key, freshMs, maxMs, producer) {
  const hit = get(key);
  const run = () => {
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      const val = await producer();
      set(key, { val, at: Date.now() }, maxMs);
      return val;
    })();
    inflight.set(key, p);
    p.catch(() => {}).finally(() => inflight.delete(key));
    return p;
  };
  if (hit !== undefined && hit && typeof hit === 'object' && 'at' in hit) {
    if (Date.now() - hit.at > freshMs) run().catch(() => { /* The stale value stays served */ });
    return hit.val;
  }
  return run();
}

module.exports = { get, set, clear, clearShared, wrap, wrapStale, syncStamps, syncIfDue };
