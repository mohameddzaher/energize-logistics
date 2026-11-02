/**
 * Section requests to HR.
 * Why a route outside `/api/hr`: both sides are sections, the sender from its own section (individuals, light transport) and the receiver from HR. Under `/api/hr` it would be guarded by `sectionGate('HR')` and the reps' supervisor, who owns the request, could not send one.
 * So the guard is in the controller: sending is for any signed-in user, reading is limited to the reader's section or what he sent, and answering is for HR alone.
 */
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const c = require('../controllers/staffStatusRequestController');
const { objectIdParam } = require('../utils/idParam');

router.use(authenticate);
router.param('id', objectIdParam({ status: 400 }));
router.param('sid', objectIdParam({ status: 400 }));

router.get('/', c.list);
router.post('/', c.create);
router.patch('/:id', c.decide);
router.patch('/:id/subjects/:sid', c.decideSubject);

module.exports = router;
