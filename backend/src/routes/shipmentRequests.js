const express = require('express');
const router = express.Router();
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
const c = require('../controllers/shipmentRequestsController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

// Shipment requests: one API for the three sections that show them (Shipment Orders, Sales, Vendors Management).
router.use(authenticate);
router.get('/', authorize(...c.READERS), c.list);
router.get('/pending-count', authorize(...c.READERS), c.pendingCount);
router.get('/team-members', authorize(...c.READERS), c.teamMembers);
router.get('/team-performance', authorize(...c.READERS), c.teamPerformance);
router.get('/approvers', authorize.strict(...c.ASKERS), c.getApprovers);
router.put('/approvers', authorize.strict(...c.ASKERS), c.setApprovers);
router.get('/:id', authorize(...c.READERS), c.get);
router.post('/', authorize.strict(...c.ASKERS), c.create);
router.put('/:id', authorize.strict(...c.ASKERS), c.update);
router.post('/:id/resubmit', authorize.strict(...c.ASKERS), c.resubmit);
router.post('/:id/cancel', authorize.strict(...c.ASKERS), c.cancel);
router.post('/:id/approve', authorize.strict(...c.ASKERS), c.decide);
router.post('/:id/return', authorize.strict(...c.ASKERS), c.decide);
router.post('/:id/decline', authorize.strict(...c.ASKERS), c.decide);
router.post('/:id/claim', authorize.strict(...c.WORKERS), c.claim);
router.post('/:id/release', authorize.strict(...c.WORKERS), c.claim);
router.post('/:id/sourcing', authorize.strict(...c.WORKERS), c.addSourcing);
router.put('/:id/sourcing/:entryId', authorize.strict(...c.WORKERS), c.updateSourcing);
router.delete('/:id/sourcing/:entryId', authorize.strict(...c.WORKERS), c.deleteSourcing);
router.post('/:id/place', authorize.strict(...c.PLACERS), c.place);
router.post('/:id/fleet-place', authorize.strict(...c.FLEET_PLACERS), c.fleetPlace);
router.post('/:id/reject', authorize.strict(...c.PLACERS), c.reject);

module.exports = router;
