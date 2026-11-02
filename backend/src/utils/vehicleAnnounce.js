/**
 * One door for announcing a vehicle registry change: every write touching `VehicleMaster` goes through it.
 * The owner's rule: any edit in the vehicle registry must show in the other pages and everywhere linked to the vehicle. A vehicle is read by several sections: the registry and its board, light transport (its vehicles and authorizations), fleet (truck identity and documents, utils/fleetIdentity), heavy transport (unit identity, services/ls2VehicleLink), the employee file (vehicles tab), legacy vehicles (the registry layer over them, vehicleController.registryIndex), and reports.
 * Every write path used to clear its own list from cache, ten different lists in ten files, so editing an authorization from one path cleared the fleet store and from another did not, leaving the fleet screen stale for a full minute with no obvious reason.
 * The list is now here alone and the order is fixed: clear the cache first, then emit the event, or the fastest listener fetches pre-edit data (see announce-before-invalidate).
 */
const cache = require('./ttlCache');

/** Every store that holds some of the vehicle's data. */
const VEHICLE_CACHES = [
  'vreg:',                 // Vehicle registry, its board, filters and expiries
  'lt:',                   // Light-transport vehicles and their document alerts
  'b2c:',                  // B2C board (authorization is read from the sheet, utils/b2cBoard)
  'veh:', 'vehicles:list', // Legacy vehicles and the registry layer over them
  'fleet:',                // Fleet truck identity and documents
  'hrm:', 'hr:employees:', 'dash:hr:', 'dash:vehicles:', // Employee file and the HR master
  'reports:doc:', 'reports:opts:vehicle:',               // Reports carry today's state
];

function clearVehicleCaches(extra = []) {
  for (const k of [...VEHICLE_CACHES, ...extra]) { try { cache.clear(k); } catch (_) { /* */ } }
  // Heavy-transport unit identity is read from the registry at display time, so its derived data is cleared with it.
  try { require('./ls2Touch').clearLs2Derived(); } catch (_) { /* */ }
}

/**
 * Clears, then announces: `vreg:updated` for the vehicles section, `lt:updated` for light transport, `ls2:updated` for heavy transport, then whatever is passed in `events` (such as `hr:employee`).
 * The `vreg:` prefix in the event name also wakes finance and the executive view (websocket/socketManager).
 */
function announceVehicles(payload = {}, { events = [], extraCaches = [] } = {}) {
  clearVehicleCaches(extraCaches);
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('vreg:updated', payload);
    emitToAll('lt:updated', { from: 'vehicles', ...payload });
    emitToAll('ls2:updated', { at: Date.now(), from: 'vehicles' });
    for (const e of events) {
      if (Array.isArray(e)) emitToAll(e[0], e[1] || {});
      else emitToAll(e, {});
    }
  } catch (_) { /* A dropped connection must not fail the save */ }
}

module.exports = { VEHICLE_CACHES, clearVehicleCaches, announceVehicles };
