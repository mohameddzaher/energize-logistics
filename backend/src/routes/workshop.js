const express = require('express');
const router = express.Router();
const workshopController = require('../controllers/workshopController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

const workshopRoles = ['super_admin', 'workshop_manager', 'workshop_employee'];
const managerRoles = ['super_admin', 'workshop_manager'];
const purchasingRoles = ['super_admin', 'workshop_manager', 'purchasing'];
const allWorkshopRoles = ['super_admin', 'workshop_manager', 'workshop_employee', 'purchasing'];

router.use(authenticate);

// ─── Dashboard ──────────────────────────────────────────
router.get('/dashboard', authorize(...allWorkshopRoles), workshopController.getWorkshopDashboard);

// ─── Inventory ─────────────────────────────────────────
router.get('/inventory/search', authorize(...allWorkshopRoles), workshopController.searchInventory);
router.get('/inventory', authorize(...allWorkshopRoles), workshopController.getInventory);
router.post('/inventory', authorize(...purchasingRoles), workshopController.createInventoryItem);
router.put('/inventory/:id', authorize(...purchasingRoles), workshopController.updateInventoryItem);
router.put('/inventory/:id/approve', authorize(...managerRoles), workshopController.approveInventoryItem);
router.delete('/inventory/:id', authorize(...managerRoles), workshopController.deleteInventoryItem);

// ─── Maintenance Requests ───────────────────────────────
router.get('/maintenance', authorize(...workshopRoles), workshopController.getMaintenanceRequests);
router.get('/maintenance/:id', authorize(...workshopRoles), workshopController.getMaintenanceRequest);
router.post('/maintenance', authorize(...workshopRoles), workshopController.createMaintenanceRequest);
router.put('/maintenance/:id', authorize(...workshopRoles), workshopController.updateMaintenanceRequest);
router.put('/maintenance/:id/complete', authorize(...workshopRoles), workshopController.completeMaintenanceRequest);
router.delete('/maintenance/:id', authorize(...managerRoles), workshopController.deleteMaintenanceRequest);

// ─── Purchase Requests ──────────────────────────────────
router.get('/purchases', authorize(...allWorkshopRoles), workshopController.getPurchaseRequests);
router.post('/purchases', authorize(...workshopRoles), workshopController.createPurchaseRequest);
router.put('/purchases/:id/receive', authorize(...purchasingRoles), workshopController.receivePurchaseRequest);
router.put('/purchases/:id/received', authorize(...purchasingRoles), workshopController.receivePurchaseRequest);
router.put('/purchases/:id/fulfill', authorize(...purchasingRoles), workshopController.fulfillPurchaseRequest);
router.put('/purchases/:id/fulfilled', authorize(...purchasingRoles), workshopController.fulfillPurchaseRequest);

// ─── Technicians ────────────────────────────────────────
router.get('/technicians', authorize(...allWorkshopRoles), workshopController.getTechnicians);
router.post('/technicians', authorize(...workshopRoles), workshopController.createTechnician);
router.put('/technicians/:id', authorize(...workshopRoles), workshopController.updateTechnician);
router.delete('/technicians/:id', authorize(...managerRoles), workshopController.deleteTechnician);

// ─── Maintenance Types ──────────────────────────────────
router.get('/maintenance-types', authorize(...allWorkshopRoles), workshopController.getMaintenanceTypes);
router.post('/maintenance-types', authorize(...managerRoles), workshopController.createMaintenanceType);
router.put('/maintenance-types/:id', authorize(...managerRoles), workshopController.updateMaintenanceType);
router.delete('/maintenance-types/:id', authorize(...managerRoles), workshopController.deleteMaintenanceType);

// ─── Workshop Users (for assignment dropdowns) ──────────
router.get('/users', authorize(...allWorkshopRoles), workshopController.getWorkshopUsers);

// ─── Workshop Tasks ─────────────────────────────────────
router.get('/tasks', authorize(...workshopRoles), workshopController.getWorkshopTasks);
router.get('/tasks/my', authorize(...workshopRoles), workshopController.getMyWorkshopTasks);
router.post('/tasks', authorize(...managerRoles), workshopController.createWorkshopTask);
router.put('/tasks/:id/status', authorize(...workshopRoles), workshopController.updateWorkshopTaskStatus);
router.delete('/tasks/:id', authorize(...managerRoles), workshopController.deleteWorkshopTask);

module.exports = router;
