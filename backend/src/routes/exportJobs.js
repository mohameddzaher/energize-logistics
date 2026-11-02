const express = require('express');
const router = express.Router();

// A malformed id means no record, not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());

const ctrl = require('../controllers/exportJobsController');
const authenticate = require('../middleware/auth');

// Large exports are requested from several sections, so they belong to none: each request is locked to its owner (reads only its own file) and built with that user's own permissions; see exportJobsController.
router.use(authenticate);
router.get('/jobs', ctrl.list);
router.post('/jobs', ctrl.create);
router.get('/jobs/:id', ctrl.status);
router.get('/jobs/:id/download', ctrl.download);

module.exports = router;
