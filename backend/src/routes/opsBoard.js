const express = require('express');
const authenticate = require('../middleware/auth');
const { objectIdParam } = require('../utils/idParam');
const board = require('../controllers/opsBoardController');
const { primeRelatedSearch } = require('../controllers/workflowController');

const router = express.Router();
router.param('id', objectIdParam());
router.use(authenticate, board.gate);

router.get('/', primeRelatedSearch, board.list);
// Before `/:id` routes, so 'filters' is not read as an id.
router.get('/filters', primeRelatedSearch, board.filters);
router.patch('/:id/status', board.setStatus);
router.get('/:id/waybill.pdf', board.waybill);

module.exports = router;
