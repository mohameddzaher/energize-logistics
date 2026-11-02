/**
 * GET /api/nav-badges: counts shown next to page names in the sidebar.
 * { '/system/finance/customs': n } is what awaits finance in customs clearance: pending payment and invoicing requests. It drops as requests are answered and disappears at zero.
 * Each page is added here with a condition on who sees it; the UI refetches on its section's events.
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
