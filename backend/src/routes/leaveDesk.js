/**
 * A leave desk: one stage's view of every leave in the company (it decides its own stage, reads the rest to follow each request) and, where given, the staff requests to HR.
 * Finance, top management and the chairman each mount one, so the three screens cannot drift apart.
 */
const express = require('express');
const chain = require('../utils/leaveChain');

const SIG_FIELDS = ['employeeSignature', ...Object.values(chain.DECISION_FIELD).map((f) => `${f}.signature`)];

function leaveDesk({ stage, allow, denyMessage, requests = false }) {
  const router = express.Router();
  router.use((req, res, next) => (allow(req.user) ? next() : res.status(403).json({ message: denyMessage })));

  const awaiting = chain.PENDING_OF[stage];
  // The desk's own stage first, then the rest in chain order.
  const order = Object.fromEntries([awaiting, ...chain.STAGES.map((s) => chain.PENDING_OF[s]).filter((s) => s !== awaiting), 'info_requested'].map((s, i) => [s, i]));

  // GET /leaves?tab=awaiting|in_chain|approved|rejected|all
  router.get('/leaves', async (req, res) => {
    try {
      const LeaveRequest = require('../models/LeaveRequest');
      const tab = String(req.query.tab || 'awaiting');
      const filter = tab === 'awaiting' ? { status: awaiting }
        : tab === 'in_chain' ? { status: { $in: chain.OPEN_STATUSES.filter((s) => s !== awaiting) } }
          : tab === 'approved' ? { status: 'approved' }
            : tab === 'rejected' ? { status: 'rejected' } : {};
      const rows = await LeaveRequest.find(filter)
        .populate('employee', 'firstName lastName arabicName employeeNumber department jobTitle')
        .populate('leaveType', 'nameAr nameEn color affectsBalance')
        .populate('manager', 'firstName lastName')
        .populate(Object.values(chain.DECISION_FIELD).map((f) => `${f}.by`).join(' '), 'firstName lastName')
        .select(SIG_FIELDS.map((f) => `-${f}`).join(' '))
        .sort({ createdAt: -1 }).limit(tab === 'all' || tab === 'approved' ? 500 : 1000).lean();
      rows.sort((a, b) => (order[a.status] ?? 99) - (order[b.status] ?? 99));
      const counts = Object.fromEntries((await LeaveRequest.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])).map((r) => [r._id, r.n]));
      res.json({ leaves: rows, counts, stage, awaiting });
    } catch (e) {
      console.error(`leave desk ${stage}:`, e);
      res.status(500).json({ message: 'تعذّر تحميل طلبات الإجازات' });
    }
  });

  if (requests) {
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
        console.error(`leave desk ${stage} requests:`, e);
        res.status(500).json({ message: 'تعذّر تحميل طلبات الموظفين' });
      }
    });
  }
  return router;
}

module.exports = leaveDesk;
