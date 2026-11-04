/**
 * Top management section (/api/top-management): the whole company's leave and staff requests, and its live activity.
 * Open to the accounts flagged `isTopManagement` and to super admins; the last leave stage is decided here, after the direct manager and HR.
 */
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const { isTopRole } = require('../config/constants');

const gate = (req, res, next) => (req.user?.isTopManagement === true || isTopRole(req.user?.role)
  ? next() : res.status(403).json({ message: 'هذا القسم للإدارة العليا' }));

router.use(authenticate, gate);

const STAGE_ORDER = { pending_executive: 0, pending_hr: 1, pending_manager: 2, info_requested: 3 };

// GET /leaves?tab=awaiting|in_chain|approved|rejected|all
router.get('/leaves', async (req, res) => {
  try {
    const LeaveRequest = require('../models/LeaveRequest');
    const tab = String(req.query.tab || 'awaiting');
    const filter = tab === 'awaiting' ? { status: 'pending_executive' }
      : tab === 'in_chain' ? { status: { $in: ['pending_manager', 'pending_hr', 'pending_finance', 'info_requested'] } }
        : tab === 'approved' ? { status: 'approved' }
          : tab === 'rejected' ? { status: 'rejected' } : {};
    const rows = await LeaveRequest.find(filter)
      .populate('employee', 'firstName lastName arabicName employeeNumber department jobTitle')
      .populate('leaveType', 'nameAr nameEn color affectsBalance')
      .populate('manager', 'firstName lastName')
      .populate('managerDecision.by hrDecision.by financeDecision.by executiveDecision.by', 'firstName lastName')
      .select('-employeeSignature -managerDecision.signature -hrDecision.signature -financeDecision.signature -executiveDecision.signature')
      .sort({ createdAt: -1 }).limit(tab === 'all' || tab === 'approved' ? 500 : 1000).lean();
    rows.sort((a, b) => (STAGE_ORDER[a.status] ?? 9) - (STAGE_ORDER[b.status] ?? 9));
    const counts = Object.fromEntries((await LeaveRequest.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])).map((r) => [r._id, r.n]));
    res.json({ leaves: rows, counts });
  } catch (e) {
    console.error('top-management leaves:', e);
    res.status(500).json({ message: 'تعذّر تحميل طلبات الإجازات' });
  }
});

// GET /requests?status= — every staff request to HR (documents, letters…), newest first.
router.get('/requests', async (req, res) => {
  try {
    const HRRequest = require('../models/HRRequest');
    const filter = {};
    const st = String(req.query.status || '');
    if (st === 'open') filter.status = { $in: ['open', 'in_progress', 'received'] };
    else if (st) filter.status = st;
    const rows = await HRRequest.find(filter)
      .populate('requester', 'firstName lastName email role')
      .populate('assignedTo', 'firstName lastName')
      .populate('thread.sender', 'firstName lastName')
      .select('-thread.attachments')
      .sort({ createdAt: -1 }).limit(1000).lean();
    const counts = Object.fromEntries((await HRRequest.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])).map((r) => [r._id, r.n]));
    res.json({ requests: rows, counts });
  } catch (e) {
    console.error('top-management requests:', e);
    res.status(500).json({ message: 'تعذّر تحميل طلبات الموظفين' });
  }
});

// GET /activity — the company's latest actions as readable lines, the audit log's own wording.
router.get('/activity', (req, res) => {
  req.query = { ...req.query, limit: String(Math.min(Number(req.query.limit) || 100, 200)) };
  return require('../controllers/auditController').getAuditLogs(req, res);
});

module.exports = router;
