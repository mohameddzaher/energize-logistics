/**
 * Top management section (/api/top-management): the whole company's leave and staff requests, and its live activity.
 * Open to the accounts flagged `isTopManagement` and to super admins; top management decides its stage here, after HR; its approval is final.
 */
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const { isTopRole } = require('../config/constants');

const allow = (u) => u?.isTopManagement === true || isTopRole(u?.role);
router.use(authenticate);
router.use(require('./leaveDesk')({ stage: 'executive', allow, denyMessage: 'هذا القسم للإدارة العليا', requests: true }));

// GET /activity — the company's latest actions as readable lines, the audit log's own wording.
router.get('/activity', (req, res, next) => (allow(req.user) ? next() : res.status(403).json({ message: 'هذا القسم للإدارة العليا' })), (req, res) => {
  req.query = { ...req.query, limit: String(Math.min(Number(req.query.limit) || 100, 200)) };
  return require('../controllers/auditController').getAuditLogs(req, res);
});

module.exports = router;
