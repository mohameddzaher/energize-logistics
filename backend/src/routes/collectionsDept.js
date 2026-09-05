const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/collectionsDeptController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

router.use(authenticate);

// مَن يقرأ القسم. `sectionGate` مركَّبٌ فوق هذه البادئة في server.js، فمن مُنح
// «Collections» من صفحة الصلاحيّات يمرّ من هنا أيضًا (rbac يقرأ req.sectionAccess).
const READ_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'collections_manager', 'collections_staff',
  'operations_manager', 'finance_manager', 'accountant',
];
// ومَن يكتب: القسمُ صاحبُ عمله، والمالُ يشاركه فيه.
//
// ── ولا قائمةَ أضيقُ منها للحذف ────────────────────────────────────────────
// كُتبت هنا أوّلًا قائمةٌ للحذف تقتصر على المدير، ثمّ أثبت الفحصُ الحيّ أنّ
// الموظّف يحذف بها: `authorize` تمرّ أيضًا حين يمنح `sectionGate` القسمَ
// تعديلًا — ومنحُ «تعديل» على قسمٍ يمرّ كلَّ نقطةٍ فيه بالتصميم. فقائمةٌ
// أضيقُ من منح القسم لا تمنع شيئًا؛ هي سطرٌ يقول ما لا يفعله، وذلك أسوأُ من
// غيابه: مَن يقرؤه يظنّ الحذفَ محروسًا.
//
// والحذفُ هنا ليس خطرًا يستحقّ حارسًا ثانيًا: مَن له كشوفٌ يُعطَّل ولا يُحذف
// (انظر `deleteParty`)، فالذي يُمحى فعلًا صفٌّ بلا تاريخ. فالقائمةُ واحدة.
const EDIT_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'collections_manager', 'collections_staff', 'finance_manager',
];

router.get('/dashboard', authorize(...READ_ROLES), ctrl.dashboard);
router.get('/dashboard/filters', authorize(...READ_ROLES), ctrl.dashboardFilterOptions);
// قبل `/parties/:id` لا بعده: «filters» لو جاءت بعدَه قُرئت معرّفَ طرف.
router.get('/parties/filters', authorize(...READ_ROLES), ctrl.filterOptions);
router.get('/parties', authorize(...READ_ROLES), ctrl.listParties);
router.post('/parties', authorize(...EDIT_ROLES), ctrl.createParty);
router.get('/parties/:id', authorize(...READ_ROLES), ctrl.getPartyProfile);
router.put('/parties/:id', authorize(...EDIT_ROLES), ctrl.updateParty);
router.delete('/parties/:id', authorize(...EDIT_ROLES), ctrl.deleteParty);

// ── المتابعات ─────────────────────────────────────────────────────────────
// «المستحقّ» قبل `/parties/:id/...` لأنّه لا يخصّ طرفًا بعينه.
router.get('/follow-ups/due', authorize(...READ_ROLES), ctrl.dueFollowUps);
router.get('/parties/:id/follow-ups', authorize(...READ_ROLES), ctrl.listFollowUps);
router.post('/parties/:id/follow-ups', authorize(...EDIT_ROLES), ctrl.createFollowUp);
router.put('/follow-ups/:fuId', authorize(...EDIT_ROLES), ctrl.updateFollowUp);
router.delete('/follow-ups/:fuId', authorize(...EDIT_ROLES), ctrl.deleteFollowUp);

// ── الفواتير ──────────────────────────────────────────────────────────────
// من هاتين الصفحتين يعمل القسم: الكاشُ بالكشف، والضريبيُّ بالفاتورة.
router.get('/invoices/filters', authorize(...READ_ROLES), ctrl.invoiceFilterOptions);
router.get('/invoices/cash', authorize(...READ_ROLES), ctrl.cashInvoices);
router.get('/invoices/tax', authorize(...READ_ROLES), ctrl.taxInvoices);
// الرقمُ قد يحمل شرطاتٍ ومسافات — يُلتقط كما هو.
router.get('/invoices/tax/:invoiceNumber', authorize(...READ_ROLES), ctrl.taxInvoiceDetail);
router.post('/invoices/collect', authorize(...EDIT_ROLES), ctrl.recordCollection);
// التسليمُ خطوةٌ قبل التحصيل: منها تُعَدُّ المدّةُ المتّفق عليها.
router.post('/invoices/deliver', authorize(...EDIT_ROLES), ctrl.recordDelivery);
// وتفصيلُ التحصيل: من أين وصل المال — قائمةٌ تُدار من إعدادات القسم.
router.put('/invoices/detail', authorize(...EDIT_ROLES), ctrl.setCollectionDetail);
// وصفُّ الكاش يُحفَظ كما يحفظه التطبيق أيَّ صفّ: PUT على معرّفه.
router.put('/invoices/cash/:id', authorize(...EDIT_ROLES), ctrl.updateCashInvoice);

// ── دفترُ التحصيل ──────────────────────────────────────────────────────────
// سجلُّ الحسابات بأعماره، ودفترُ الفواتير، والتنبيهاتُ والخطّةُ والتقييم.
// مبنيٌّ على `CollectionInvoice` لا على كشوف التشغيل — انظر رأسَ المتحكِّم.
const ledger = require('../controllers/collectionsLedgerController');

router.get('/ledger/aging/filters', authorize(...READ_ROLES), ledger.agingFilters);
router.get('/ledger/aging', authorize(...READ_ROLES), ledger.aging);
router.get('/ledger/invoices/filters', authorize(...READ_ROLES), ledger.invoiceFilters);
router.get('/ledger/invoices', authorize(...READ_ROLES), ledger.invoices);

router.get('/ledger/alerts', authorize(...READ_ROLES), ledger.alerts);
router.post('/ledger/alerts/ack', authorize(...EDIT_ROLES), ledger.ackAlert);

router.get('/ledger/tasks', authorize(...READ_ROLES), ledger.listTasks);
router.post('/ledger/tasks', authorize(...EDIT_ROLES), ledger.createTask);
router.put('/ledger/tasks/:id', authorize(...EDIT_ROLES), ledger.updateTask);
router.delete('/ledger/tasks/:id', authorize(...EDIT_ROLES), ledger.deleteTask);

router.get('/ledger/team', authorize(...READ_ROLES), ledger.team);
router.put('/ledger/team/assign', authorize(...EDIT_ROLES), ledger.assignOfficer);
router.get('/ledger/performance', authorize(...READ_ROLES), ledger.performance);

router.get('/ledger/link-suggestions', authorize(...READ_ROLES), ledger.linkSuggestions);
router.post('/ledger/link-suggestions/:id', authorize(...EDIT_ROLES), ledger.decideLink);

module.exports = router;
