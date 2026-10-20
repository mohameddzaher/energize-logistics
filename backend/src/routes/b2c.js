const express = require('express');
const router = express.Router();

// معرّفٌ مشوَّهٌ في الرابط = لا سجلّ، لا عطلٌ في الخادم — راجع utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
const b2cController = require('../controllers/b2cController');
const duty = require('../controllers/b2cDutyController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { denyRepSupervisor: noSup } = require('../middleware/b2cGuards');

router.use(authenticate);

// Project managers currently have the same access as heads.
const READ = ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead'];
// مشرفُ المناديب: شاشتا التفقّد فقط، ومناديبُه هو (يحسمه المتحكّم).
// التفقّدُ للمشرفَين كليهما — التشغيليُّ يراه، والتفقّديُّ هو عملُه كلُّه.
const DUTY = [...READ, 'b2c_rep_supervisor', 'b2c_inspection_supervisor'];
const WRITE = ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead'];
const ADMIN_WRITE = ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead'];

// Projects
router.get('/projects', authorize(...READ), b2cController.getProjects);
router.post('/projects', noSup, authorize(...ADMIN_WRITE), b2cController.createProject);
router.put('/projects/:id', noSup, authorize(...ADMIN_WRITE), b2cController.updateProject);
router.delete('/projects/:id', noSup, authorize(...ADMIN_WRITE), b2cController.deleteProject);

// Reps
router.get('/reps', authorize(...READ), b2cController.getReps);
router.post('/reps', noSup, authorize(...WRITE), b2cController.createRep);
router.get('/reps/diagnose', authorize(...READ), b2cController.diagnoseReps);
router.get('/system-diagnostic', authorize(...READ), b2cController.getSystemDiagnostic);
router.put('/reps/:id', noSup, authorize(...WRITE), b2cController.updateRep);
router.delete('/reps/:id', noSup, authorize(...WRITE), b2cController.deleteRep);

// ── تفقُّد بداية الدوام ──────────────────────────────────────────────────────
// الحارسُ هنا يفتح الشاشةَ فحسب؛ ومَن يرى أيَّ مندوبٍ ومَن يكتب فيه محسومٌ في
// المتحكّم من `B2CRep.supervisor` لا من الدور. فمديرُ مشروعٍ بلا مندوبين
// مُسنَدين يفتح الشاشةَ ولا يجد أحدًا — وهو الصواب.
router.get('/duty/my-reps', authorize(...DUTY), duty.myReps);
router.post('/duty', authorize(...DUTY), duty.submit);
// المسارات الثابتة قبل `/:id` حتى لا تُقرأ «analytics» معرّفًا.
router.get('/duty/analytics', authorize(...DUTY), duty.analytics);
router.get('/duty/missing', authorize(...DUTY), duty.missing);
router.get('/duty/supervisors', authorize(...DUTY), duty.supervisors);
router.post('/duty/assign', noSup, authorize(...WRITE), duty.assign);
router.get('/duty', authorize(...DUTY), duty.list);
router.get('/duty/:id', authorize(...DUTY), duty.getOne);
router.patch('/duty/:id/review', authorize(...READ), duty.review);

// Daily orders — قراءةٌ فقط. الكتابةُ من «مدخلات الأوردرات» وحدَها (/entry).
router.get('/daily-orders', authorize(...READ), b2cController.getDailyOrders);

// ── مدخلات الأوردرات (صاحبُ الشركة، ٢٠٢٦/١٠/١٩) ────────────────────────────
// الأوردراتُ تُكتب على النظام لا في الشيتات. مديرُ المشروع والمشرفُ يرى مشاريعَه
// ويكتب فيها، والإدارةُ الكلّ (يحسمه المتحكّم — utils/b2cEntry). راجع b2cEntryController.
const entry = require('../controllers/b2cEntryController');
const ENTRY = require('../utils/b2cEntry').ENTRY_ROLES;
router.get('/entry', authorize(...ENTRY), entry.list);
router.put('/entry', authorize(...ENTRY), entry.save);
router.get('/entry/managers', authorize(...ENTRY), entry.managers);
router.put('/entry/managers/:userId', authorize(...ENTRY), entry.setManagerProjects);
// شيتاتُ الأوردرات (جوجل شيت لكلّ مشروع) — تُقرأ كلَّ دقيقة. راجع b2cOrderSheetController.
const orderSheets = require('../controllers/b2cOrderSheetController');
router.get('/order-sheets', authorize(...ENTRY), orderSheets.list);
router.get('/order-sheets/script', authorize(...ENTRY), orderSheets.script);
router.post('/order-sheets', authorize(...ENTRY), orderSheets.create);
router.delete('/order-sheets/:id', authorize(...ENTRY), orderSheets.remove);
router.post('/order-sheets/:id/sync', authorize(...ENTRY), orderSheets.syncNow);
// متابعةُ مناديب أمازون — الحضور (الغيابُ وحدَه يُكتب). راجع b2cAttendanceController.
const attendance = require('../controllers/b2cAttendanceController');
router.get('/attendance', authorize(...ENTRY), attendance.list);
router.put('/attendance', authorize(...ENTRY), attendance.save);

// Dashboard / analytics
router.get('/dashboard', authorize(...READ), b2cController.getDashboardSummary);
router.get('/months', authorize(...READ), b2cController.getMonthsAvailable);
router.get('/reps/:id/profile', authorize(...READ), b2cController.getRepProfile);
router.get('/evaluations', authorize(...READ), b2cController.getRepEvaluations);
router.get('/day-details', authorize(...READ), b2cController.getDayDetails);

// ── شيتاتُ جوجل ورفعُ الإكسيل أُلغيا (صاحبُ الشركة، ٢٠٢٦/١٠/١٩) ──────────────
// كانا يكتبان الأوردرات ويعرّفان المندوبَ باسمه في الشيت ويدمجان المتشابهين.
// النسخةُ الاحتياطيّةُ من الشيتات في backups/b2c-sheets-2026-10-19 على الخادم.

module.exports = router;
