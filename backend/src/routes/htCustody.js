/**
 * /api/ls2/custody: heavy-transport custody; see controllers/htCustodyController.
 * Mounted before /api/ls2 in server.js with its own guard, because the section router limits every route to section roles and finance roles are not among them.
 * The guard is middleware/custodyGate, mounted in server.js: owner roles, or a role granted on the permissions screen; the section's default roles never.
 */
const express = require('express');
const router = express.Router();
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam({ status: 400 }));
const custody = require('../controllers/htCustodyController');

router.get('/', custody.list);
router.get('/rep', custody.lookupRep);
router.get('/vehicles', custody.listVehicles);
router.post('/', custody.create);
router.put('/:id', custody.update);      // The controller restricts this to the system admin and finance roles.
router.delete('/:id', custody.remove);

module.exports = router;
