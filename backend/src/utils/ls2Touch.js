/**
 * A write in the heavy-transport section is heard across the section.
 * The section has three controllers (vehicles and maintenance, asset registry, store), each with its own cache and live event. A write in one cleared only its own cache, so a tyre moved in the asset registry left the dashboard and vehicle list stale for a minute, and maintenance logged left the asset summary stale.
 * So everything derived is cleared here and both events are announced; every screen in the section listens to one of them. The remote-telemetry cache (distances, trips, track from Wialon) stays: system writes do not change it and refetching is a heavy external call.
 */
const cache = require('./ttlCache');

const DERIVED = ['ls2assets:', 'ls2store:', 'ls2:dash', 'ls2:vehicles', 'ls2:whereabouts', 'ls2:rep', 'ls2:drvperf', 'ls2:maint'];

/** Clears what is derived from section records, in this worker and the other (see ttlCache). */
function clearLs2Derived() {
  for (const p of DERIVED) { try { cache.clear(p); } catch (_) { /* */ } }
}

/** Clears then announces, in that order (see announce-before-invalidate). */
function touchLs2(payload = {}) {
  clearLs2Derived();
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('ls2:updated', { at: Date.now(), ...payload });
    emitToAll('ls2:store', {});
  } catch (_) { /* A dropped socket link must not fail the save */ }
}

module.exports = { clearLs2Derived, touchLs2 };
