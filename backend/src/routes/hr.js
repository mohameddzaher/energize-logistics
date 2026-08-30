const express = require('express');
const router = express.Router();
const hr = require('../controllers/hrController');
const hrm = require('../controllers/hrMasterController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

const STAFF = ['super_admin', 'admin', 'hr_manager', 'hr_specialist'];

router.use(authenticate);

// ── ماستر الموارد البشرية: النظرة الشاملة وصفحات كل مجموعة ──────────────────
// كارت لكل عمود بعدّادات «مطلوب / غير مطلوب / مملي»، وكل رقم بيفتح الناس اللي
// وراه. الملء بيتم من نفس المكان أو من صفحة الموظف — الاتنين بيعدّوا على نفس
// الـ endpoint فحالة «مطلوب» بتتشال بنفس الطريقة.
//
// ── ولماذا `authorize` على القراءة أيضًا ─────────────────────────────────────
// هذه الشاشات تُخرج أرقام الإقامات والجوازات والآيبان ورواتب كلّ الموظفين. لم
// يكن عليها تقييدُ دورٍ إطلاقًا، وحارسُ الأقسام يسمح بالمرور للأدوار التي لا
// نصيب لها في القسم (قاعدة «زيادة لا تضييق»). فكان كلُّ حسابٍ في النظام —
// وحسابات العملاء والموردين في البوّابة من بينها، فهي مستخدمون عاديّون —
// يقرأ الملفّ الوظيفيّ كاملًا بطلبٍ واحد.
router.get('/master/overview', authorize(...STAFF), hrm.overview);
router.get('/master/field-config', authorize(...STAFF), hrm.fieldConfig);
// الفلاتر المتاحة وقيمها بأعدادها — محسوبة على ما تبقّى بعد بقيّة الفلاتر
router.get('/master/filters', authorize(...STAFF), hrm.filterOptions);
router.get('/master/expiring', authorize(...STAFF), hrm.expiring);
router.get('/master/records/:group', authorize(...STAFF), hrm.records);
router.patch('/master/employees/:id/fields', authorize(...STAFF), hrm.updateFields);
// التجديد — فرديًّا وجماعيًّا. `renew-bulk` قبل أي مسار فيه معرّف حتى لا يُقرأ
// «renew-bulk» على أنه معرّف موظف.
router.post('/master/renew-bulk', authorize(...STAFF), hrm.renewBulk);
router.post('/master/renew', authorize(...STAFF), hrm.renew);

// ── Self-service (any authenticated user) ────────────────────────────────────
// Defined first so they aren't shadowed by the staff :id routes below.
router.get('/me/profile', hr.getMyProfile);
router.get('/me/team', hr.getMyTeam);
router.get('/me/leaves', hr.listMyLeaves);
router.post('/me/leaves', hr.createMyLeave);
router.patch('/me/leaves/:id/cancel', hr.cancelMyLeave);
// التعديل والحذف ما دام الطلب لم يمسَّه أحد — الحارس في المتحكّم لا هنا.
router.put('/me/leaves/:id', hr.updateMyLeave);
router.delete('/me/leaves/:id', hr.deleteMyLeave);
router.get('/me/requests', hr.listMyRequests);
router.post('/me/requests', hr.createMyRequest);
router.put('/me/requests/:id', hr.updateMyRequest);
router.delete('/me/requests/:id', hr.deleteMyRequest);
router.get('/team/leaves', hr.listTeamLeaves);

// Leave types: anyone can read the active list (for the request dropdown);
// only staff can mutate.
router.get('/leave-types', hr.listLeaveTypes);
router.post('/leave-types', authorize(...STAFF), hr.createLeaveType);
router.put('/leave-types/:id', authorize(...STAFF), hr.updateLeaveType);
router.delete('/leave-types/:id', authorize(...STAFF), hr.deleteLeaveType);

// Leave/request actions usable by managers (non-staff) too — the controller
// enforces who may act.
router.patch('/leaves/:id/decision', hr.decideLeave);
router.post('/requests/:id/reply', hr.replyRequest);

// Employee profile read is allowed for the owner; controller enforces it.
router.get('/employees/:id', hr.getEmployee);

// ── HR back-office (staff only) ──────────────────────────────────────────────
router.get('/dashboard', authorize(...STAFF), hr.getDashboard);
router.get('/options', authorize(...STAFF), hr.getOptions);

router.get('/employees', authorize(...STAFF), hr.listEmployees);
router.get('/employees-search', authorize(...STAFF), hr.searchEmployees);
router.post('/employees', authorize(...STAFF), hr.createEmployee);
router.put('/employees/:id', authorize(...STAFF), hr.updateEmployee);
router.delete('/employees/:id', authorize(...STAFF), hr.deleteEmployee);

// Profile actions (staff): renew a document, end of service, reactivate, history.
router.post('/employees/:id/renew', authorize(...STAFF), hr.renewDocument);
router.post('/employees/:id/terminate', authorize(...STAFF), hr.terminateEmployee);
router.post('/employees/:id/reactivate', authorize(...STAFF), hr.reactivateEmployee);
router.get('/employees/:id/audit', authorize(...STAFF), hr.getEmployeeAudit);

// Employee documents (file uploads — base64 data URL in JSON).
router.get('/employees/:id/documents', authorize(...STAFF), hr.listDocuments);
router.post('/employees/:id/documents', authorize(...STAFF), hr.uploadDocument);
router.put('/documents/:docId', authorize(...STAFF), hr.updateDocument);
router.delete('/documents/:docId', authorize(...STAFF), hr.deleteDocument);

router.get('/contracts', authorize(...STAFF), hr.listContracts);
router.post('/contracts', authorize(...STAFF), hr.createContract);
router.put('/contracts/:id', authorize(...STAFF), hr.updateContract);
router.post('/contracts/:id/terminate', authorize(...STAFF), hr.terminateContract);
router.delete('/contracts/:id', authorize(...STAFF), hr.deleteContract);

// إعدادات القسم — عتبات تنبيه انتهاء المستندات.
router.get('/settings', authorize(...STAFF), hr.getHrSettings);
router.put('/settings', authorize(...STAFF), hr.updateHrSettings);

router.get('/leaves', authorize(...STAFF), hr.listLeaves);
// تقييدُ إجازةٍ وقعت فعلًا — قبل المسار ذي المعامل وإلّا ابتلعه `/:id`.
router.post('/leaves/backdated', authorize(...STAFF), hr.createBackdatedLeave);
router.get('/leaves/:id', hr.getLeave); // single leave + signatures (for the PDF); access checked in controller

router.get('/requests', authorize(...STAFF), hr.listRequests);
router.patch('/requests/:id/status', authorize(...STAFF), hr.updateRequestStatus);

// Company licenses & subscriptions (التراخيص والاشتراكات) — staff only.
router.get('/licenses', authorize(...STAFF), hr.listLicenses);
router.post('/licenses', authorize(...STAFF), hr.createLicense);
router.put('/licenses/:id', authorize(...STAFF), hr.updateLicense);
router.delete('/licenses/:id', authorize(...STAFF), hr.deleteLicense);

router.get('/assets', authorize(...STAFF), hr.listAssets);
router.post('/assets', authorize(...STAFF), hr.createAsset);
router.put('/assets/:id', authorize(...STAFF), hr.updateAsset);
router.post('/assets/:id/return', authorize(...STAFF), hr.returnAsset);
router.delete('/assets/:id', authorize(...STAFF), hr.deleteAsset);

// HR's own store (المستودع) — separate shelf from the IT store, same Asset
// collection. Handing an item out turns the very same document into custody.
router.get('/stock', authorize(...STAFF), hr.listStock);
router.post('/stock', authorize(...STAFF), hr.createStock);
router.put('/stock/:id', authorize(...STAFF), hr.updateStock);
router.delete('/stock/:id', authorize(...STAFF), hr.deleteStock);
router.post('/stock/:id/assign', authorize(...STAFF), hr.assignFromStock);

module.exports = router;
