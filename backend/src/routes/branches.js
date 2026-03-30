const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const branchController = require('../controllers/branchController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');

router.use(authenticate);

router.get('/', branchController.getBranches);

router.post(
  '/',
  authorize('super_admin'),
  [body('name').notEmpty().withMessage('Branch name is required')],
  validate,
  branchController.createBranch
);

router.put(
  '/:id',
  authorize('super_admin'),
  [body('name').notEmpty().withMessage('Branch name is required')],
  validate,
  branchController.updateBranch
);

router.delete('/:id', authorize('super_admin'), branchController.deleteBranch);

module.exports = router;
