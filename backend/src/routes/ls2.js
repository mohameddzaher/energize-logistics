/**
 * /api/ls2 — Location Solutions (Wialon) telemetry section. Staff (fleet/ops/
 * workshop) can read the live dashboard, vehicles and alerts; the admin tier can
 * acknowledge alerts, mark vehicles serviced and edit thresholds.
 */
const express = require('express');
const router = express.Router();
// Two different ids under one name.
// `:id` is the store/tire/alert record id in most routes, but the unit number in Location Solutions in the `/vehicles` routes. One guard per name would be wrong, so each route gets its own guard; see utils/idParam.
const { objectIdParam, objectIdGuard, numericParam } = require('../utils/idParam');
const oid = objectIdGuard();
const unit = numericParam({ status: 400, message: 'Invalid vehicle id' });
router.param('repairId', objectIdParam());
router.param('movementId', objectIdParam());

const ls2 = require('../controllers/ls2Controller');
const assets = require('../controllers/ls2AssetsController');
const store = require('../controllers/ls2StoreController');
const ls2reports = require('../controllers/ls2ReportsController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { LS2_STAFF_ROLES, LS2_ADMIN_ROLES } = require('../config/constants');

const ADMIN = authorize(...LS2_ADMIN_ROLES);

router.use(authenticate);
// Finance adds store items, so it reaches the store screens and nothing else here.
const STORE_FINANCE = ['accountant', 'accounting_manager', 'cfo'];
const staffOnly = authorize(...LS2_STAFF_ROLES);
router.use((req, res, next) => (
  STORE_FINANCE.includes(req.user?.role) && /^\/(store|suppliers|vehicles)(\/|$)/.test(req.path) ? next() : staffOnly(req, res, next)));

router.get('/dashboard', ls2.getDashboard);
router.get('/settings', ls2.getSettings);
router.put('/settings', ADMIN, ls2.updateSettings);
router.post('/refresh', ADMIN, ls2.refresh);

// Fleet requests: 'I need this truck but its maintenance is overdue'. Read here and decided on.
// The decision is for management ranks: approving a maintenance postponement is a responsibility recorded by name.
const fleetRequests = require('../controllers/fleetRequestController');
router.get('/fleet-requests', fleetRequests.list);
router.post('/fleet-requests/:id/decide', oid, ADMIN, fleetRequests.decide);

router.get('/alerts', ls2.listAlerts);
router.patch('/alerts/:id/ack', oid, ls2.acknowledgeAlert);

router.get('/mileage', ls2.getMileage); // fleet distance over a period
router.post('/identity/refresh', ADMIN, ls2.refreshIdentity); // re-pull VIN/brand/SIM…
router.get('/registry-conflicts', ls2.registryConflicts); // Device to vehicle registry: manufacture year and chassis number.

// Reports — the whole fleet, or one truck in full, over any period.
router.get('/service-types', ls2.getServiceTypes); // the real 4 service types, for the workshop
router.get('/reports/fleet', ls2reports.getFleetReport); // ?from&to
router.get('/reports/vehicle/:id', ls2reports.getVehicleReport); // ?from&to[&heavy=0]

// Drivers — km attributed per day to whoever was on the truck that day
router.get('/drivers', ls2.listDrivers); // ?from&to
// Driver performance rating: score from trips, delivery time, loading time and speed.
// MUST come before /drivers/:driver so 'performance' isn't read as a driver name.
router.get('/drivers/performance', ls2.driverPerformance); // ?from&to[&deep=1]
router.get('/drivers/performance/:driver', ls2.driverPerformanceDetail); // ?from&to — always deep
router.get('/drivers/:driver', ls2.getDriver); // ?from&to

// Unscheduled/exceptional repairs (accidents, breakdowns) — ours only, never
// written to Wialon, which has no concept of non-periodic work.
router.get('/repairs', ls2.listRepairs); // ?unitId&category&status
router.post('/repairs', ADMIN, ls2.createRepair);
router.patch('/repairs/:repairId', ADMIN, ls2.updateRepair);
router.delete('/repairs/:repairId', ADMIN, ls2.deleteRepair);

// Fleet asset registry: trailers, tractors and tire sets, with movement history.
// The workshop's source of truth for WHICH physical tire/trailer is on a truck.
router.get('/assets/overview', assets.getOverview);
router.get('/assets/events', assets.listEvents);
router.get('/assets/sensor-check', assets.sensorCheck);
router.get('/assets/vehicle/:plate', assets.getVehicleAssets);
// One timeline per vehicle: tires, spare parts, repairs and maintenance.
router.get('/assets/vehicle/:plate/history', assets.getVehicleHistory);
router.post('/assets/import', ADMIN, assets.importAssets); // workshop JSON, idempotent
router.get('/assets/tires/next-number', assets.nextTireNumber);   // Before /assets/tires/:id.
router.post('/assets/tires', ADMIN, assets.createTire);
router.patch('/assets/tires/:id', oid, ADMIN, assets.updateTire);
router.get('/assets/tires/:id/profile', oid, assets.getTireProfile);   // Full life of a tire set.
router.post('/assets/tires/:id/move', oid, ADMIN, assets.moveTire);
router.post('/assets/tires/:id/renewal-result', oid, ADMIN, assets.tireRenewalResult); // Retread or scrap.
router.post('/assets/tires/:id/retire', oid, ADMIN, assets.retireTire);
router.post('/assets/tires/:id/status', oid, ADMIN, assets.setTireStatus); // Move between statuses.
// Rims: counted stock on the tire side (no serials), with an immutable movement ledger.
const rims = require('../controllers/ls2RimsController');
router.get('/assets/rims', rims.listRims);
router.get('/assets/rims/movements', rims.listMovements); // Before /assets/rims/:id routes.
router.post('/assets/rims', ADMIN, rims.createRim);
router.post('/assets/rims/vehicle-movement', ADMIN, rims.vehicleMovement);
router.post('/assets/rims/movements/:movementId/reverse', ADMIN, rims.reverseMovement);
router.patch('/assets/rims/:id', oid, ADMIN, rims.updateRim);
router.delete('/assets/rims/:id', oid, ADMIN, rims.hideRim);
router.post('/assets/rims/:id/movement', oid, ADMIN, rims.addMovement);
router.post('/assets/rims/:id/transfer', oid, ADMIN, rims.transfer);

// Heavy-transport store (spare parts): list/CRUD, in/out movements and log.
router.get('/store', store.listItems);
router.get('/store/dashboard', store.dashboard);
router.get('/store/movements', store.listMovements);
router.get('/store/issue-reasons', store.issueReasons); // The four issue reasons.
router.get('/store/unknown-plates', store.unknownPlates); // Plates on movements that have no vehicle in the registry.
// Adding items is for finance and the vehicles manager; section grants do not extend it.
const STORE_ADD = authorize.strict('super_admin', 'admin', 'it_manager', 'it_specialist', 'accountant', 'accounting_manager', 'cfo', 'vehicles_manager');
router.post('/store', STORE_ADD, store.createItem);
router.post('/store/bulk-create', STORE_ADD, store.createItemsBulk);   // Purchase invoice with several items.
// Suppliers the parts are bought from. Before /store/:id so it is not captured as an id.
router.get('/suppliers', store.listSuppliers);
router.post('/suppliers', ADMIN, store.createSupplier);
router.put('/suppliers/:id', oid, ADMIN, store.updateSupplier);
router.delete('/suppliers/:id', oid, ADMIN, store.deleteSupplier);
router.put('/store/:id', oid, ADMIN, store.updateItem);
router.delete('/store/:id', oid, ADMIN, store.deleteItem);
// Bulk movement (out or in) of several items with different quantities. Registered before /store/:id so 'bulk-out' is not read as an item id.
router.post('/store/bulk-out', ADMIN, store.addBulkOut);
router.post('/store/bulk-movement', ADMIN, store.addBulkMovement);
router.post('/store/:id/movement', oid, ADMIN, store.addMovement);
// Reversing a movement writes an opposite movement; it does not delete or edit a row. There is deliberately no PUT/PATCH on movements: a recorded movement is not edited (finance decision).
router.post('/store/movements/:movementId/reverse', ADMIN, store.reverseMovement);
router.post('/assets/trailers', ADMIN, assets.createTrailer);
router.post('/assets/trailers/:id/move', oid, ADMIN, assets.moveTrailer);
router.post('/assets/flatbeds', ADMIN, assets.createFlatbed);
router.patch('/assets/flatbeds/:id', oid, ADMIN, assets.updateFlatbed);

router.get('/deferrals', ls2.listDeferrals); // fleet-wide open deferred tasks (Maintenance page)
router.get('/vehicles', ls2.listVehicles);
router.get('/vehicles/:id', unit, ls2.getVehicle);
router.get('/vehicles/:id/tire-sensors', unit, ls2.getVehicleTireSensors); // Coverage breakdown when the window opens.
router.get('/vehicles/:id/mileage', unit, ls2.getVehicleMileage); // ?from&to[&source=report]
router.get('/vehicles/:id/history', unit, ls2.getVehicleHistory); // daily distance series
router.get('/vehicles/:id/trips', unit, ls2.getVehicleTrips); // ?from&to — trips + derived stops
router.get('/vehicles/:id/fuel', unit, ls2.getVehicleFuel); // ?from&to — CAN fuel consumption
router.get('/vehicles/:id/track', unit, ls2.getVehicleTrack); // ?from&to — GPS polyline
router.post('/vehicles/:id/service', unit, ADMIN, ls2.markServiced);
router.get('/vehicles/:id/maintenance', unit, ls2.getVehicleMaintenance); // intervals + full local service history
router.post('/vehicles/:id/register-service', unit, ADMIN, ls2.registerServiceInterval); // writes ONE interval to Location Solutions
router.post('/vehicles/:id/resolve-deferral', unit, ADMIN, ls2.resolveDeferral); // close ONE deferred task (done on its own, no full service)
router.patch('/vehicles/:id/meta', unit, ADMIN, ls2.updateVehicleMeta); // manual metadata (tire brand/type)

module.exports = router;
