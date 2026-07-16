/**
 * /api/ls2 — Location Solutions (Wialon) telemetry section. Staff (fleet/ops/
 * workshop) can read the live dashboard, vehicles and alerts; the admin tier can
 * acknowledge alerts, mark vehicles serviced and edit thresholds.
 */
const express = require('express');
const router = express.Router();
const ls2 = require('../controllers/ls2Controller');
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

// Drivers — km attributed per day to whoever was on the truck that day
router.get('/drivers', ls2.listDrivers); // ?from&to
router.get('/drivers/:driver', ls2.getDriver); // ?from&to

router.get('/vehicles', ls2.listVehicles);
router.get('/vehicles/:id', ls2.getVehicle);
router.get('/vehicles/:id/mileage', ls2.getVehicleMileage); // ?from&to[&source=report]
router.get('/vehicles/:id/history', ls2.getVehicleHistory); // daily distance series
router.get('/vehicles/:id/trips', ls2.getVehicleTrips); // ?from&to — trips + derived stops
router.get('/vehicles/:id/fuel', ls2.getVehicleFuel); // ?from&to — CAN fuel consumption
router.get('/vehicles/:id/track', ls2.getVehicleTrack); // ?from&to — GPS polyline
router.post('/vehicles/:id/service', ADMIN, ls2.markServiced);
router.post('/vehicles/:id/register-service', ADMIN, ls2.registerServiceInterval); // writes ONE interval to Location Solutions
router.patch('/vehicles/:id/meta', ADMIN, ls2.updateVehicleMeta); // manual metadata (tire brand/type)

module.exports = router;
