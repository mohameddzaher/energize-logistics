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
router.get('/:id', authorize(...c.READERS), c.get);
router.post('/', authorize.strict(...c.ASKERS), c.create);
router.put('/:id', authorize.strict(...c.ASKERS), c.update);
router.post('/:id/resubmit', authorize.strict(...c.ASKERS), c.resubmit);
router.post('/:id/cancel', authorize.strict(...c.ASKERS), c.cancel);
router.post('/:id/claim', authorize.strict(...c.PLACERS), c.claim);
router.post('/:id/release', authorize.strict(...c.PLACERS), c.claim);
router.post('/:id/place', authorize.strict(...c.PLACERS), c.place);
router.post('/:id/reject', authorize.strict(...c.PLACERS), c.reject);

module.exports = router;
