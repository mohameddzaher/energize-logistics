/**
 * Change stamp: answers 'did anything change in these collections?' with one tiny query.
 * The Atlas cluster is slow to transfer, not to compute (about 1s per 100 KB), so a big list is pushed once and cached, and each read first fetches a stamp of a few bytes: count, sum of `updatedAt`, and its max. Any add, delete or edit through mongoose changes the sum, even when the writer's clock is behind and the max does not move.
 * Memory correctness therefore does not depend on every write path remembering to clear it; the max age is a safety net for raw writes that skip `updatedAt` (import scripts).
 */
const cache = require('./ttlCache');

const group = (tag) => [{
  $group: {
    _id: tag,
    n: { $sum: 1 },
    s: { $sum: { $toLong: { $ifNull: ['$updatedAt', new Date(0)] } } },
    u: { $max: '$updatedAt' },
  },
}];

/** Stamp for several collections in a single round trip ($unionWith). */
async function stampOf(models) {
  const [first, ...rest] = models;
  const pipeline = [...group(first.collection.name)];
  for (const m of rest) pipeline.push({ $unionWith: { coll: m.collection.name, pipeline: group(m.collection.name) } });
  const rows = await first.aggregate(pipeline);
  return rows.map((r) => `${r._id}:${r.n}:${r.s}`).sort().join('|');
}

const inflight = new Map();

/** Like `cache.wrap`, but validity follows the stamp rather than the clock: the value is served while the collections' stamp is unchanged and rebuilt when it changes. Prefix clearing (`cache.clear`) still works because the value lives in the same memory. */
async function freshWrap(key, maxTtlMs, models, producer) {
  const stamp = await stampOf(models);
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp) return hit.val;
  const ik = `${key}@${stamp}`;
  if (inflight.has(ik)) return inflight.get(ik);
  const p = (async () => {
    const val = await producer();
    cache.set(key, { stamp, val }, maxTtlMs);
    return val;
  })();
  inflight.set(ik, p);
  try { return await p; } finally { inflight.delete(ik); }
}

/**
 * Mirror of a whole collection with selected fields, refreshed by diff instead of full transfer.
 * `rowsFor(filter)` asks the database only for matching ids (a few KB, in the order the database would return) and takes the rows from the mirror, so editing one vehicle fetches only that vehicle.
 */
function mirror(Model, fields, { maxAgeMs = 10 * 60 * 1000 } = {}) {
  const sel = [...new Set([...String(fields).split(/\s+/).filter(Boolean), 'updatedAt'])].join(' ');
  let state = null;
  let loading = null;

  const serverStamp = async () => {
    const [r] = await Model.aggregate(group(null));
    return r ? { n: r.n, s: Number(r.s) } : { n: 0, s: 0 };
  };
  const build = (byId) => {
    let s = 0; let u = null;
    for (const d of byId.values()) {
      const t = d.updatedAt ? new Date(d.updatedAt).getTime() : 0;
      s += t;
      if (d.updatedAt && (!u || t > u.getTime())) u = new Date(t);
    }
    return { byId, n: byId.size, s, u, at: Date.now() };
  };
  const full = async () => {
    const all = await Model.find({}).select(sel).lean();
    return build(new Map(all.map((d) => [String(d._id), d])));
  };

  async function sync(force = false) {
    const st = await serverStamp();
    const young = state && Date.now() - state.at < maxAgeMs;
    if (!force && young && state.n === st.n && state.s === st.s) return state;
    const lk = `${force}:${st.n}:${st.s}`;
    if (loading && loading.key === lk) return loading.p;
    const p = (async () => {
      let next = null;
      if (!force && young && state.u) {
        // Only the diff: what changed since the last stamp. '>=' not '>' so a change in the same millisecond is not missed.
        const changed = await Model.find({ updatedAt: { $gte: state.u } }).select(sel).lean();
        const byId = new Map(state.byId);
        for (const d of changed) byId.set(String(d._id), d);
        const cand = build(byId);
        cand.at = state.at; // A diff does not renew the mirror's age: the safety net stays
        // A delete or a lagging clock is not caught by the diff; it shows in the stamp and everything is reloaded.
        if (cand.n === st.n && cand.s === st.s) next = cand;
      }
      state = next || await full();
      return state;
    })();
    loading = { key: lk, p };
    try { return await p; } finally { if (loading && loading.p === p) loading = null; }
  }

  async function rowsFor(filter) {
    const [ids, s] = await Promise.all([Model.find(filter).select('_id').lean(), sync()]);
    let rows = ids.map((x) => s.byId.get(String(x._id)));
    if (rows.some((r) => !r)) {
      // A vehicle was added between the two queries: reload once and take the rows from that.
      const f = await sync(true);
      rows = ids.map((x) => f.byId.get(String(x._id))).filter(Boolean);
    }
    return rows;
  }

  return { rowsFor, sync, reset: () => { state = null; } };
}

module.exports = { stampOf, freshWrap, mirror };
