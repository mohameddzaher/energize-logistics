/**
 * /api/ls2/custody: heavy-transport custody; see controllers/htCustodyController.
 * Mounted before /api/ls2 in server.js with its own guard, because the section router limits every route to section roles and finance roles are not among them.
 * Only this list decides access (`strict`); a section grant does not open it to the section's staff.
 */
const express = require('express');
const router = express.Router();
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam({ status: 400 }));
const authorize = require('../middleware/rbac');
const custody = require('../controllers/htCustodyController');

const CUSTODY = authorize.strict(...custody.CUSTODY_ROLES);
router.get('/', CUSTODY, custody.list);
router.get('/rep', CUSTODY, custody.lookupRep);
router.get('/vehicles', CUSTODY, custody.listVehicles);
router.post('/', CUSTODY, custody.create);
router.put('/:id', CUSTODY, custody.update);      // The controller restricts this to the system admin and finance roles.
router.delete('/:id', CUSTODY, custody.remove);

module.exports = router;
