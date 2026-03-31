const express = require('express');
const router = express.Router();
const { clearData } = require('../controllers/adminController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

router.use(authenticate);
router.post('/clear-data', authorize('super_admin'), clearData);

module.exports = router;
