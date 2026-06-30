/**
 * /api/ops — authenticated proxy to the external UPL Operations platform.
 * Staff roles can read; the admin tier can create/update/delete (writes are
 * forwarded to UPL and broadcast live over socket.io).
 */
const express = require('express');
const router = express.Router();
const ops = require('../controllers/opsController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { OPS_PLATFORM_STAFF_ROLES, OPS_PLATFORM_ADMIN_ROLES } = require('../config/constants');

const ADMIN = authorize(...OPS_PLATFORM_ADMIN_ROLES);

// Inbound webhook from UPL — unauthenticated (gated by shared secret) so it must
// be declared BEFORE the auth middlewares below.
router.post('/webhook', ops.webhook);

router.use(authenticate);
router.use(authorize(...OPS_PLATFORM_STAFF_ROLES));

// Dashboard (combined stats + charts)
router.get('/dashboard', ops.getDashboard);

// Shipment-specific routes — MUST come before the generic /:resource matchers
router.patch('/shipments/status', ADMIN, ops.updateShipmentStatus);
router.get('/shipments/timeline/:id', ops.shipmentTimeline);

// Generic resource CRUD
router.get('/:resource', ops.list);
router.get('/:resource/:id', ops.getOne);
router.post('/:resource', ADMIN, ops.create);
router.patch('/:resource/restore/:id', ADMIN, ops.restore);
router.patch('/:resource/:id', ADMIN, ops.update);
router.delete('/:resource/:id', ADMIN, ops.remove);

module.exports = router;
