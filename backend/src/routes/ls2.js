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

router.get('/vehicles', ls2.listVehicles);
router.get('/vehicles/:id', ls2.getVehicle);
router.post('/vehicles/:id/service', ADMIN, ls2.markServiced);

module.exports = router;
