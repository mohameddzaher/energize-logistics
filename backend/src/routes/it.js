const express = require('express');
const router = express.Router();
const it = require('../controllers/itController');
const emails = require('../controllers/companyEmailController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

const EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];

router.use(authenticate);

// ── Dashboard ───────────────────────────────────────────────────────────────
router.get('/dashboard', it.getDashboard);

// ── بريد الشركة (@energize-logistics.com) ───────────────────────────────────
// صناديق البريد على هوستنجر — مش حسابات الدخول للسيستم. المسار الوحيد اللي
// بيرجّع كلمة المرور هو /reveal، وهو بيتسجّل مع كل استخدام.
router.get('/emails', emails.list);
router.get('/emails/employees', emails.searchEmployees);   // قبل /emails/:id
// تصدير بكلمات المرور — نفس صلاحية الكشف، ومسجَّل في سجل التدقيق.
router.get('/emails/export', authorize(...EDIT_ROLES), emails.exportWithPasswords);
router.post('/emails', authorize(...EDIT_ROLES), emails.create);
router.post('/emails/:id/reveal', authorize(...EDIT_ROLES), emails.revealPassword);
router.put('/emails/:id', authorize(...EDIT_ROLES), emails.update);
router.delete('/emails/:id', authorize(...EDIT_ROLES), emails.remove);

// ── Tickets ─────────────────────────────────────────────────────────────────
// /tickets/recurring MUST be declared before /tickets/:id, otherwise the param
// route swallows "recurring" and treats it as an id.
router.get('/tickets/recurring', it.getRecurring);
router.get('/tickets', it.listTickets);
router.post('/tickets', authorize(...EDIT_ROLES), it.createTicket);
router.get('/tickets/:id', it.getTicket);
router.put('/tickets/:id', authorize(...EDIT_ROLES), it.updateTicket);
router.delete('/tickets/:id', authorize(...EDIT_ROLES), it.deleteTicket);

// ── Custody (العهد) — writes into the shared HR Asset collection ────────────
router.get('/custody', it.listCustody);
router.post('/custody', authorize(...EDIT_ROLES), it.createCustody);
router.put('/custody/:id', authorize(...EDIT_ROLES), it.updateCustody);
router.post('/custody/:id/return', authorize(...EDIT_ROLES), it.returnCustody);
router.delete('/custody/:id', authorize(...EDIT_ROLES), it.deleteCustody);

// Movements. Each one moves the Asset and appends to its AssetEvent trail.
// The two GETs must sit above nothing else — they are distinct paths, but
// /custody/:id/history has to be declared before any broader /custody/:id use.
router.get('/custody/:id/history', it.custodyHistory);
router.get('/custody/by-employee/:employeeId', it.custodyByEmployee);
router.post('/custody/:id/transfer', authorize(...EDIT_ROLES), it.transferCustody);
// «تالف» صار إجراءً واحداً: المساران يشيران إلى معالجٍ واحد. /retire يبقى
// معلناً لأن نسخ الموبايل المثبَّتة تناديه، لا لأنه سلوكٌ آخر.
router.post('/custody/:id/report', authorize(...EDIT_ROLES), it.markFaulty);
router.post('/custody/:id/retire', authorize(...EDIT_ROLES), it.markFaulty);
router.post('/custody/handover', authorize(...EDIT_ROLES), it.handoverCustody);

// ── Stock (المستودع) — unassigned items waiting on the shelf ────────────────
// Same Asset collection: a stock item is one that simply has no holder yet.
router.get('/stock', it.listStock);
router.post('/stock', authorize(...EDIT_ROLES), it.createStock);
router.put('/stock/:id', authorize(...EDIT_ROLES), it.updateStock);
router.delete('/stock/:id', authorize(...EDIT_ROLES), it.deleteStock);
router.post('/stock/:id/assign', authorize(...EDIT_ROLES), it.assignFromStock);

// Employee picker for the custody modal (/api/hr/employees is HR-roles only).
router.get('/employees', it.listEmployees);

// قوائم نموذج البلاغ — الأقسام الحقيقية ومن يجوز إسناد الحل إليه.
router.get('/departments', it.listDepartments);
router.get('/assignees', it.listAssignees);

// ── Systems & services ──────────────────────────────────────────────────────
router.get('/systems', it.listSystems);
router.post('/systems', authorize(...EDIT_ROLES), it.createSystem);
router.put('/systems/:id', authorize(...EDIT_ROLES), it.updateSystem);
router.delete('/systems/:id', authorize(...EDIT_ROLES), it.deleteSystem);

module.exports = router;
