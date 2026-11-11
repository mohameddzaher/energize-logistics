/** /api/data-support: Data & Decision Support analysis pages. Read-only; every figure comes from its section (controllers/dataSupportController). */
const express = require('express');
const router = express.Router();
const authorize = require('../middleware/rbac');
const { TOP_ROLES } = require('../config/constants');
const { DATA_ROLES } = require('../config/roles');
const ctrl = require('../controllers/dataSupportController');

// Baseline list; a role granted the section on the permissions page passes through the section stamp (rbac).
const ROLES = [...TOP_ROLES, 'cfo', ...DATA_ROLES];

router.get('/overview', authorize(...ROLES), ctrl.overview);
router.get('/sections/:key', authorize(...ROLES), ctrl.section);

module.exports = router;
