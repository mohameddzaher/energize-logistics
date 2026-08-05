const express = require('express');
const router = express.Router();
const workshopController = require('../controllers/workshopController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

const workshopRoles = ['super_admin', 'workshop_manager', 'workshop_employee'];
const managerRoles = ['super_admin', 'workshop_manager'];
const purchasingRoles = ['super_admin', 'workshop_manager', 'procurement_staff'];
const allWorkshopRoles = ['super_admin', 'workshop_manager', 'workshop_employee', 'procurement_staff'];

router.use(authenticate);

// ─── Dashboard ──────────────────────────────────────────
router.get('/dashboard', authorize(...allWorkshopRoles), workshopController.getWorkshopDashboard);

// ─── Store (المستودع) — fleet assets + spare parts in one view ─────────
router.get('/store', authorize(...allWorkshopRoles), workshopController.getWorkshopStore);

// ─── Inventory ─────────────────────────────────────────
// Issues (الصرف) — parts leaving the shelf onto a vehicle. Declared before
// /inventory/:id so "issues" is never swallowed as an id.
router.get('/inventory/issues', authorize(...allWorkshopRoles), workshopController.listInventoryIssues);
router.post('/inventory/:id/issue', authorize(...allWorkshopRoles), workshopController.issueInventoryItem);
router.post('/inventory/:id/renewal-result', authorize(...allWorkshopRoles), workshopController.inventoryRenewalResult); // مجدد أو سكراب
router.delete('/inventory/issues/:id', authorize(...managerRoles), workshopController.deleteInventoryIssue);

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
// Record + receive is ONE flow in the UI ("سجّل وأضف للمخزون"): every role that
// may record a purchase must also be able to receive it, or the row records and
// then sticks at pending with a 403 the user never asked for. So all four verbs
// take the same union list — the purchasing officer AND the workshop floor.
router.get('/purchases', authorize(...allWorkshopRoles), workshopController.getPurchaseRequests);
router.post('/purchases', authorize(...allWorkshopRoles), workshopController.createPurchaseRequest);
router.put('/purchases/:id/receive', authorize(...allWorkshopRoles), workshopController.receivePurchaseRequest);
router.put('/purchases/:id/received', authorize(...allWorkshopRoles), workshopController.receivePurchaseRequest);
router.put('/purchases/:id/fulfill', authorize(...allWorkshopRoles), workshopController.fulfillPurchaseRequest);
router.put('/purchases/:id/fulfilled', authorize(...allWorkshopRoles), workshopController.fulfillPurchaseRequest);
// Deleting reverses the stock this request added, so it is manager-only.
router.delete('/purchases/:id', authorize(...managerRoles), workshopController.deletePurchaseRequest);

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
