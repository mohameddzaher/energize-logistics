const express = require('express');
const router = express.Router();

// معرّفٌ مشوَّهٌ في الرابط = لا سجلّ، لا عطلٌ في الخادم — راجع utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
const lookupController = require('../controllers/lookupController');
const authenticate = require('../middleware/auth');

// All routes require auth. Read is open to any authenticated user (dropdowns are
// needed everywhere); per-type write permission is enforced inside the controller
// against the lookupTypes registry.
router.use(authenticate);

router.get('/types', lookupController.getTypes);
router.get('/', lookupController.getLookups);
router.post('/', lookupController.createLookup);
router.put('/:id', lookupController.updateLookup);
router.delete('/:id', lookupController.deleteLookup);

module.exports = router;
