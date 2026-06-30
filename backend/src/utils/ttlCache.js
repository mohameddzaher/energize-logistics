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
function clear(prefix) {
  if (!prefix) { store.clear(); return; }
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

module.exports = { get, set, clear };
