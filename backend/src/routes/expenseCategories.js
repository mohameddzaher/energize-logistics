const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const controller = require('../controllers/expenseCategoryController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');

router.use(authenticate);

router.get('/', controller.getCategories);

router.post(
  '/',
  authorize('super_admin'),
  [body('name').notEmpty().withMessage('Category name is required')],
  validate,
  controller.createCategory
);

router.put(
  '/:id',
  authorize('super_admin'),
  [body('name').notEmpty().withMessage('Category name is required')],
  validate,
  controller.updateCategory
);

router.delete('/:id', authorize('super_admin'), controller.deleteCategory);

module.exports = router;
