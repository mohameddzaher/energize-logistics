/**
 * GET /api/nav-badges — أرقامٌ بجانب أسماء الصفحات في الشريط الجانبيّ (٢٠٢٦/١٠/٢٢).
 * { '/system/finance/customs': n } — ما ينتظر الإدارةَ الماليّة في التخليص: طلباتُ
 * صرفٍ وطلباتُ فوترةٍ معلّقة. يقلّ كلّما أُجيب طلب، ويختفي حين لا يبقى شيء.
 * كلُّ صفحةٍ تُضاف هنا بشرط من يراها؛ والواجهةُ تعيد السحبَ مع أحداث أقسامها.
 */
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const cache = require('../utils/ttlCache');

const CUSTOMS_FINANCE = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'cfo', 'accounting_manager', 'accountant'];

router.use(authenticate);
router.get('/', async (req, res) => {
  try {
    const out = {};
    if (CUSTOMS_FINANCE.includes(req.user.role)) {
      const c = await cache.wrap('customs:navbadge', 15000, () => require('../controllers/customsClearanceController').financePendingCount());
      if (c.total) out['/system/finance/customs'] = c.total;
    }
    res.json(out);
  } catch (e) {
    res.json({});
  }
});

module.exports = router;
