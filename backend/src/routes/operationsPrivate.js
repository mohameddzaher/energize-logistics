/**
 * /api/operations-private — «التشغيل — خاصّ».
 *
 * كشوفُ التشغيل نفسُها بسعر بيعنا الحقيقيّ. قراءةٌ للإدارة، وكتابةٌ على عمودٍ
 * واحدٍ لا غير — راجع رأسَ المتحكّم.
 *
 * ── ومَن يراها ──────────────────────────────────────────────────────────────
 * الهامشُ يُقرأ في هذه الصفحة على كلّ حمولة، فهي أضيقُ من سير عمل التشغيل:
 * الإدارةُ ومن يملك المالَ أصلًا (المدير الماليّ والمحاسبة)، ومديرُ العمليّات.
 * وموظّفُ العمليّات يرى الكشوفَ في صفحتها — لا يرى ما نربحه على كلّ واحدة.
 */
const express = require('express');

const router = express.Router();
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const ctrl = require('../controllers/operationsPrivateController');

const ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'operations_manager', 'cfo', 'accounting_manager', 'accountant',
];

router.use(authenticate);
router.use(authorize(...ROLES));

router.get('/', ctrl.list);
router.get('/stats', ctrl.stats);
// كلُّ ما طابق الفلتر بأسعارنا — ملفُّ إكسل (أو `format=json`). يسبق `/:id`.
router.get('/export', ctrl.exportRows);
router.put('/:id', ctrl.updatePrice);

module.exports = router;
