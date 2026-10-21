const express = require('express');
const router = express.Router();

// معرّفٌ مشوَّهٌ في الرابط = لا سجلّ، لا عطلٌ في الخادم — راجع utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam({ status: 400 }));
const ctrl = require('../controllers/collectionsDeptController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

router.use(authenticate);

// مَن يقرأ القسم. `sectionGate` مركَّبٌ فوق هذه البادئة في server.js، فمن مُنح
// «Collections» من صفحة الصلاحيّات يمرّ من هنا أيضًا (rbac يقرأ req.sectionAccess).
const READ_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'collections_manager', 'collections_staff',
  'operations_manager', 'cfo', 'accounting_manager', 'accountant',
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
  'collections_manager', 'collections_staff', 'cfo', 'accounting_manager',
];

router.get('/dashboard', authorize(...READ_ROLES), ctrl.dashboard);
router.get('/dashboard/filters', authorize(...READ_ROLES), ctrl.dashboardFilterOptions);

// ── المديونيّة: الشجرةُ وصفوفُها وحالةُ الخلاف ────────────────────────────
// لوحةٌ ثانيةٌ مبنيّةٌ على دفتر الفواتير لا على كشوف التشغيل — راجع رأسَ
// controllers/collectionsReceivablesController لسبب الفصل.
const recv = require('../controllers/collectionsReceivablesController');
router.get('/receivables/overview', authorize(...READ_ROLES), recv.overview);
router.get('/receivables/rows', authorize(...READ_ROLES), recv.rows);
// قيمُ عمودٍ لقمع جدول المديونيّة، وصفحةُ «القضايا» — من الصفوف نفسِها.
router.get('/receivables/column-options', authorize(...READ_ROLES), recv.columnOptions);
router.get('/receivables/cases', authorize(...READ_ROLES), recv.cases);
router.put('/parties/:id/issue', authorize(...EDIT_ROLES), recv.setIssue);
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
// ── ومتابعاتُ الكشف نفسِه ────────────────────────────────────────────────────
// غيرُ متابعات الطرف أعلاه: سجلٌّ على الكشف يكتبه التشغيلُ والتخليصُ والتحصيل
// معًا (راجع controllers/workflowFollowUpController). ومَن يقرأ الفاتورةَ يكتب
// عليها متابعة، فالكتابةُ بقائمة القراءة؛ والحذفُ لصاحبها أو للإدارة.
router.param('reportId', objectIdParam({ status: 400 }));
router.param('rfuId', objectIdParam({ status: 400 }));
const reportFollowUps = require('../controllers/workflowFollowUpController').collections;
router.get('/reports/:reportId/follow-ups', authorize(...READ_ROLES), reportFollowUps.list);
router.post('/reports/:reportId/follow-ups', authorize(...READ_ROLES), reportFollowUps.create);
router.delete('/reports/:reportId/follow-ups/:rfuId', authorize(...READ_ROLES), reportFollowUps.remove);

// ── الفواتير ──────────────────────────────────────────────────────────────
// من هاتين الصفحتين يعمل القسم: الكاشُ بالكشف، والضريبيُّ بالفاتورة.
router.get('/invoices/filters', authorize(...READ_ROLES), ctrl.invoiceFilterOptions);
// قيمُ عمودٍ واحدٍ لفلاتر الأعمدة — تُحسب في القاعدة لا من الصفحة المعروضة.
router.get('/invoices/:kind/column-options', authorize(...READ_ROLES), ctrl.invoiceColumnOptions);
// كشفُ حسابٍ PDF لما على الشاشة — قبل `/invoices/tax/:invoiceNumber`، وإلّا
// قُرئت «statement» رقمَ فاتورة.
router.get('/invoices/:kind/statement', authorize(...READ_ROLES), ctrl.invoiceStatement);
router.get('/invoices/cash', authorize(...READ_ROLES), ctrl.cashInvoices);
router.get('/invoices/tax', authorize(...READ_ROLES), ctrl.taxInvoices);
// الرقمُ قد يحمل شرطاتٍ ومسافات — يُلتقط كما هو.
router.get('/invoices/tax/:invoiceNumber', authorize(...READ_ROLES), ctrl.taxInvoiceDetail);
router.post('/invoices/collect', authorize(...EDIT_ROLES), ctrl.recordCollection);
// تصحيحُ قيمة فاتورةٍ ضريبيّة (ويجوز بالسالب) — وتُقفَل على ما كُتب.
//
// ── وبابُه أضيقُ من القسم، ولا يفتحه منح ─────────────────────────────────
// تغييرُ مبلغِ دَينٍ قرارٌ ماليّ لا عملُ تحصيلٍ يوميّ (صاحبُ الشركة،
// ٢٠٢٦/١٠/٢١): لمديري النظام ومدير القسم والمدير الماليّ ومدير الحسابات وحدَهم.
// و`strict` لأنّ `authorize` العاديّة تمرّ لكلّ مَن مُنح القسمَ «تعديلًا» —
// فقائمةٌ أضيقُ بغيرها لا تمنع أحدًا (راجع رأسَ EDIT_ROLES أعلاه).
router.put('/invoices/tax/:invoiceNumber/amount', authorize.strict(...ctrl.AMOUNT_EDIT_ROLES), ctrl.updateTaxInvoiceAmount);
// «لم تُحصَّل»: رجوعٌ عن تحصيلٍ سُجِّل خطأً — والسببُ اختياريّ.
router.post('/invoices/uncollect', authorize(...EDIT_ROLES), ctrl.undoCollection);
// ودفعاتُ التحصيل الجزئيّ: تُعدَّل أو تُرفَع وحدَها — بابُها بابُ «لم تُحصَّل».
router.put('/invoices/payments', authorize(...EDIT_ROLES), ctrl.updatePayment);
router.post('/invoices/payments/remove', authorize(...EDIT_ROLES), ctrl.removePayment);
// التسليمُ خطوةٌ قبل التحصيل: منها تُعَدُّ المدّةُ المتّفق عليها.
router.post('/invoices/deliver', authorize(...EDIT_ROLES), ctrl.recordDelivery);
// وتفصيلُ التحصيل: من أين وصل المال — قائمةٌ تُدار من إعدادات القسم.
router.put('/invoices/detail', authorize(...EDIT_ROLES), ctrl.setCollectionDetail);
// وصفُّ الكاش يُحفَظ كما يحفظه التطبيق أيَّ صفّ: PUT على معرّفه.
router.put('/invoices/cash/:id', authorize(...EDIT_ROLES), ctrl.updateCashInvoice);

// ── مرفقاتُ الفواتير ──────────────────────────────────────────────────────
// قارئُ الفواتير يرى الملفّاتِ وينزّلها، وكاتبُها يرفع. والحذفُ لمن رفع الملفَّ
// أو لمدير القسم — يحرسه المتحكِّم لا قائمةُ الأدوار (راجع رأسه).
// «counts» قبل `/:key`، وإلّا قُرئت رقمَ فاتورة.
const att = require('../controllers/collectionsAttachmentsController');
router.get('/attachments/:kind/counts', authorize(...READ_ROLES), att.counts);
router.get('/attachments/:kind/:key', authorize(...READ_ROLES), att.list(EDIT_ROLES));
router.post('/attachments/:kind/:key', authorize(...EDIT_ROLES), att.upload);
router.delete('/attachments/:kind/:key/:fileId', authorize(...EDIT_ROLES), att.remove);

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
