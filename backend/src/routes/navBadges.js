/**
 * GET /api/nav-badges: counts shown next to page names in the sidebar.
 * { '/system/finance/customs': n } is what awaits finance in customs clearance: pending payment and invoicing requests. HR and top management get what waits on them: leaves at their stage and open staff requests. Each drops as it is answered and disappears at zero.
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
    const LeaveRequest = require('../models/LeaveRequest');
    const HRRequest = require('../models/HRRequest');
    const chain = require('../utils/leaveChain');
    const { isTopRole } = require('../config/constants');
    const role = req.user.role;
    const hr = chain.HR_ROLES.includes(role) || isTopRole(role);
    const top = req.user.isTopManagement === true || isTopRole(role);
    // Small collections, counted live and uncached so a decision clears its badge at once.
    const OPEN_REQ = { status: { $in: ['open', 'in_progress'] } };
    const [mine, atHr, openReq, atTop] = await Promise.all([
      // Leave approvals: what waits on this reader's own stations (team as manager, HR, top management).
      LeaveRequest.countDocuments(chain.inboxFilter(req.user)).catch(() => 0),
      hr ? LeaveRequest.countDocuments({ status: 'pending_hr' }) : 0,
      hr || top ? HRRequest.countDocuments(OPEN_REQ) : 0,
      top ? LeaveRequest.countDocuments({ status: 'pending_executive' }) : 0,
    ]);
    if (mine) out['/system/hr/leave-approvals'] = mine;
    if (atHr) out['/system/hr/leaves'] = atHr;
    if (openReq && hr) out['/system/hr/requests'] = openReq;
    if (atTop) out['/system/top-management'] = atTop;
    if (openReq && top) out['/system/top-management/requests'] = openReq;
    res.json(out);
  } catch (e) {
    res.json({});
  }
});

module.exports = router;
