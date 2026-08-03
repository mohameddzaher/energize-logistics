/**
 * /api/ls2 — Location Solutions (Wialon) telemetry section. Staff (fleet/ops/
 * workshop) can read the live dashboard, vehicles and alerts; the admin tier can
 * acknowledge alerts, mark vehicles serviced and edit thresholds.
 */
const express = require('express');
const router = express.Router();
const ls2 = require('../controllers/ls2Controller');
const assets = require('../controllers/ls2AssetsController');
const ls2reports = require('../controllers/ls2ReportsController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { LS2_STAFF_ROLES, LS2_ADMIN_ROLES } = require('../config/constants');

const ADMIN = authorize(...LS2_ADMIN_ROLES);

router.use(authenticate);
router.use(authorize(...LS2_STAFF_ROLES));

router.get('/dashboard', ls2.getDashboard);
router.get('/settings', ls2.getSettings);
router.put('/settings', ADMIN, ls2.updateSettings);
router.post('/refresh', ADMIN, ls2.refresh);

router.get('/alerts', ls2.listAlerts);
router.patch('/alerts/:id/ack', ls2.acknowledgeAlert);

router.get('/mileage', ls2.getMileage); // fleet distance over a period
router.post('/identity/refresh', ADMIN, ls2.refreshIdentity); // re-pull VIN/brand/SIM…

// Reports — the whole fleet, or one truck in full, over any period.
router.get('/service-types', ls2.getServiceTypes); // the real 4 service types, for the workshop
router.get('/reports/fleet', ls2reports.getFleetReport); // ?from&to
router.get('/reports/vehicle/:id', ls2reports.getVehicleReport); // ?from&to[&heavy=0]

// Drivers — km attributed per day to whoever was on the truck that day
router.get('/drivers', ls2.listDrivers); // ?from&to
router.get('/drivers/:driver', ls2.getDriver); // ?from&to

// Unscheduled/exceptional repairs (accidents, breakdowns) — ours only, never
// written to Wialon, which has no concept of non-periodic work.
router.get('/repairs', ls2.listRepairs); // ?unitId&category&status
router.post('/repairs', ADMIN, ls2.createRepair);
router.patch('/repairs/:repairId', ADMIN, ls2.updateRepair);
router.delete('/repairs/:repairId', ADMIN, ls2.deleteRepair);

// Fleet asset registry — سطحات وتيدرات وفردات كاوتش, with movement history.
// The workshop's source of truth for WHICH physical tire/trailer is on a truck.
router.get('/assets/overview', assets.getOverview);
router.get('/assets/events', assets.listEvents);
router.get('/assets/sensor-check', assets.sensorCheck);
router.get('/assets/vehicle/:plate', assets.getVehicleAssets);
router.post('/assets/import', ADMIN, assets.importAssets); // workshop JSON, idempotent
router.post('/assets/tires', ADMIN, assets.createTire);
router.patch('/assets/tires/:id', ADMIN, assets.updateTire);
router.post('/assets/tires/:id/move', ADMIN, assets.moveTire);
router.post('/assets/tires/:id/renewal-result', ADMIN, assets.tireRenewalResult); // مجدد أو سكراب
router.post('/assets/tires/:id/retire', ADMIN, assets.retireTire);
router.post('/assets/tires/:id/status', ADMIN, assets.setTireStatus); // نقل بين الحالات
router.post('/assets/trailers', ADMIN, assets.createTrailer);
router.post('/assets/trailers/:id/move', ADMIN, assets.moveTrailer);
router.post('/assets/flatbeds', ADMIN, assets.createFlatbed);
router.patch('/assets/flatbeds/:id', ADMIN, assets.updateFlatbed);

router.get('/deferrals', ls2.listDeferrals); // fleet-wide open deferred tasks (Maintenance page)
router.get('/vehicles', ls2.listVehicles);
router.get('/vehicles/:id', ls2.getVehicle);
router.get('/vehicles/:id/mileage', ls2.getVehicleMileage); // ?from&to[&source=report]
router.get('/vehicles/:id/history', ls2.getVehicleHistory); // daily distance series
router.get('/vehicles/:id/trips', ls2.getVehicleTrips); // ?from&to — trips + derived stops
router.get('/vehicles/:id/fuel', ls2.getVehicleFuel); // ?from&to — CAN fuel consumption
router.get('/vehicles/:id/track', ls2.getVehicleTrack); // ?from&to — GPS polyline
router.post('/vehicles/:id/service', ADMIN, ls2.markServiced);
router.get('/vehicles/:id/maintenance', ls2.getVehicleMaintenance); // intervals + full local service history
router.post('/vehicles/:id/register-service', ADMIN, ls2.registerServiceInterval); // writes ONE interval to Location Solutions
router.post('/vehicles/:id/resolve-deferral', ADMIN, ls2.resolveDeferral); // close ONE deferred task (done on its own, no full service)
router.patch('/vehicles/:id/meta', ADMIN, ls2.updateVehicleMeta); // manual metadata (tire brand/type)

module.exports = router;
