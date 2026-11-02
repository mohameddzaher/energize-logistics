const express = require('express');
const authenticate = require('../middleware/auth');
const { objectIdParam } = require('../utils/idParam');
const board = require('../controllers/opsBoardController');
const { primeRelatedSearch } = require('../controllers/workflowController');

const router = express.Router();
router.param('id', objectIdParam());
router.use(authenticate, board.gate);

router.get('/', primeRelatedSearch, board.list);
router.patch('/:id/status', board.setStatus);
router.get('/:id/waybill.pdf', board.waybill);

module.exports = router;
