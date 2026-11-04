const svc = require('../services/sellingPriceRequests');
const { canApproveSelling } = require('../config/sellingPriceRequests');

// The list shows selling prices, so it is for approvers only, like the decision.
const approverOnly = (req, res) => {
  if (canApproveSelling(req.user)) return false;
  res.status(403).json({ code: 'NOT_APPROVER', message: 'طلبات تعديل سعر البيع لمدير المبيعات والإدارة العليا ومدير النظام فقط.' });
  return true;
};

exports.list = async (req, res) => {
  if (approverOnly(req, res)) return;
  try {
    res.json(await svc.list(req.query));
  } catch (e) {
    res.status(500).json({ message: 'Failed to load selling-price requests' });
  }
};

exports.count = async (req, res) => {
  if (!canApproveSelling(req.user)) return res.json({ pending: 0, canApprove: false });
  try {
    res.json({ pending: await svc.pendingCount(), canApprove: true });
  } catch (e) {
    res.status(500).json({ message: 'Failed to count selling-price requests' });
  }
};

const decideWith = (approve) => async (req, res) => {
  try {
    const r = await svc.decide(req.params.id, req.user, { approve, reason: (req.body && req.body.reason) || '', ip: req.ip });
    res.status(r.status).json(r.body);
  } catch (e) {
    console.error('[selling-req] decide:', e);
    res.status(500).json({ message: 'Failed to decide the selling-price request' });
  }
};
exports.approve = decideWith(true);
exports.reject = decideWith(false);
