const express = require('express');
const router = express.Router();
const complaintController = require('../controllers/complaintController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

const allRoles = [
  'super_admin', 'admin', 'employee', 'operations_manager', 'operations',
  'moderator', 'workshop_manager', 'workshop_employee', 'purchasing',
];
const managerRoles = ['super_admin', 'admin', 'operations_manager', 'workshop_manager'];

router.use(authenticate);

router.get('/', authorize(...allRoles), complaintController.getComplaints);
router.get('/:id', authorize(...allRoles), complaintController.getComplaint);
router.post('/', authorize(...allRoles), complaintController.createComplaint);
router.put('/:id', authorize(...managerRoles), complaintController.updateComplaint);
router.put('/:id/resolve', authorize(...managerRoles), complaintController.resolveComplaint);
router.delete('/:id', authorize(...managerRoles), complaintController.deleteComplaint);

module.exports = router;
