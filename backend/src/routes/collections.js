const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const collectionController = require('../controllers/collectionController');
const authenticate = require('../middleware/auth');
const validate = require('../middleware/validate');
const authorize = require('../middleware/rbac');

router.use(authenticate);

router.post(
  '/',
  [
    body('customer').isMongoId(),
    body('type').isIn(['call', 'email', 'visit', 'promise', 'follow_up', 'note', 'whatsapp']),
    body('notes').notEmpty().trim(),
    body('contactType').optional().isIn(['call', 'visit', 'email', 'whatsapp']),
    body('status').optional().isIn(['done', 'postponed', 'cancelled']),
    body('amountCollected').optional().isFloat({ min: 0 }),
    body('nextFollowUpDate').optional().isISO8601(),
  ],
  validate,
  collectionController.logActivity
);

router.get('/', collectionController.getActivities);
router.get('/follow-ups', collectionController.getFollowUps);
router.put('/:id/promise', collectionController.markPromiseFulfilled);
router.put('/:id/complete', collectionController.completeFollowUp);
router.put('/:id', collectionController.updateActivity);
router.delete('/:id', authorize('super_admin', 'admin', 'collections_manager'), collectionController.deleteActivity);

module.exports = router;
