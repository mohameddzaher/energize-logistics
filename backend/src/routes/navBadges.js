/**
 * GET /api/nav-badges: counts shown next to page names in the sidebar.
 * { '/system/finance/customs': n } is what awaits finance in customs clearance: pending payment and invoicing requests. HR and top management get what waits on them: leaves at their stage and open staff requests. Each drops as it is answered and disappears at zero.
 * Each page is added here with a condition on who sees it; the UI refetches on its section's events.
 */
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const cache = require('../utils/ttlCache');

const CUSTOMS_FINANCE = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'];

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
    const fin = chain.FINANCE_ROLES.includes(role) || isTopRole(role);
    // Small collections, counted live and uncached so a decision clears its badge at once.
    const OPEN_REQ = { status: { $in: ['open', 'in_progress'] } };
    // Same filter as the approvals inbox, so the badge and the list agree (archived staff wait on nobody).
    const { withoutArchivedRef } = require('../utils/archivedHidden');
    const OPEN_AT = (t) => ({ ...OPEN_REQ, stage: 'department', targetSection: t });
    const [mine, atHr, openReq, atTop, atFin, topReq, finReq] = await Promise.all([
      // Leave approvals: what waits on this reader's own stations (team as manager, HR, top management).
      withoutArchivedRef(chain.inboxFilter(req.user)).then((f) => LeaveRequest.countDocuments(f)).catch(() => 0),
      // HR follows every request from filing to the end, so its page counts all open ones, not only those at its stage.
      hr ? withoutArchivedRef({ status: { $in: chain.OPEN_STATUSES } }).then((f) => LeaveRequest.countDocuments(f)) : 0,
      // Employee requests sent to HR (older ones without a route were all to HR).
      hr ? HRRequest.countDocuments({ ...OPEN_REQ, $or: [{ targetSection: 'HR', stage: 'department' }, { targetSection: { $exists: false }, stage: { $exists: false } }] }) : 0,
      top ? LeaveRequest.countDocuments({ status: 'pending_executive' }) : 0,
      fin ? LeaveRequest.countDocuments({ status: 'pending_finance' }) : 0,
      top ? HRRequest.countDocuments(OPEN_AT('Top Management')) : 0,
      fin ? HRRequest.countDocuments(OPEN_AT('Accounting')) : 0,
    ]);
    if (mine) out['/system/hr/leave-approvals'] = mine;
    if (atHr) out['/system/hr/leaves'] = atHr;
    if (openReq && hr) out['/system/hr/requests'] = openReq;
    if (atTop) out['/system/top-management'] = atTop;
    if (topReq) out['/system/top-management/requests'] = topReq;
    if (atFin) out['/system/finance/leaves'] = atFin;
    if (finReq) out['/system/finance/staff-requests'] = finReq;
    // Employee requests waiting on this reader: as direct manager, as the department they were sent to, or top management.
    try {
      const routing = require('../utils/requestRouting');
      const base = await routing.visibleFilter(req.user, { hrGranted: hr });
      const rows = await HRRequest.find({ ...base, stage: { $in: ['manager', 'department'] }, status: { $in: routing.OPEN } }).select('stage manager targetSection requester participants status').lean();
      let n = 0;
      for (const r of rows) if (await routing.canAct(req.user, r, { hrGranted: hr })) n += 1;
      if (n) out['/system/hr/incoming-requests'] = n;
    } catch (e) { /* a badge never fails the call */ }
    // Selling-price change requests waiting on an approver.
    const spr = require('../config/sellingPriceRequests');
    if (spr.canApproveSelling(req.user)) {
      const n = await require('../models/SellingPriceChangeRequest').countDocuments({ status: 'pending' }).catch(() => 0);
      if (n) out[spr.PAGE] = n;
    }
    // Sales requests waiting for the vendors team (open ones), and rejected requests back with the sales member who asked.
    const SR = require('../controllers/shipmentRequestsController');
    const ShipmentRequest = require('../models/ShipmentRequest');
    if (SR.WORKERS.includes(role) || SR.FLEET_PLACERS.includes(role)) {
      const n = await ShipmentRequest.countDocuments({ status: { $in: ['pending', 'in_progress'] }, ...SR.APPROVED }).catch(() => 0);
      if (n) { out['/system/vendors-mgmt/requests'] = n; out['/system/shipment-orders/requests'] = n; out['/system/fleet/requests'] = n; }
    }
    // Sales requests waiting for the sales manager (or a delegated member).
    if (SR.ASKERS.includes(role) && await SR.canApprove(req.user).catch(() => false)) {
      const n = await ShipmentRequest.countDocuments({ approvalStatus: 'pending' }).catch(() => 0);
      if (n) { out['/system/sales/shipment-request'] = (out['/system/sales/shipment-request'] || 0) + n; }
    }
    // Anyone who asks (sales or the section team) sees their rejected requests waiting for an amendment.
    if (SR.ASKERS.includes(role)) {
      const n = await ShipmentRequest.countDocuments({ $and: [{ $or: [{ status: 'rejected' }, { approvalStatus: 'returned' }] }, { $or: [{ createdBy: req.user._id }, { salesRep: req.user._id }] }] }).catch(() => 0);
      if (n) { out['/system/sales/shipment-request'] = n; out['/system/shipment-orders/request'] = n; }
    }
    res.json(out);
  } catch (e) {
    res.json({});
  }
});

module.exports = router;
