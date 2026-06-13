const Dispute = require('../models/Dispute');
const Invoice = require('../models/Invoice');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

exports.createDispute = async (req, res) => {
  try {
    const { invoice: invoiceId, reason } = req.body;

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const dispute = await Dispute.create({
      invoice: invoiceId,
      customer: invoice.customer,
      raisedBy: req.user._id,
      reason,
    });

    invoice.status = 'disputed';
    await invoice.save();

    await logAudit({
      user: req.user._id,
      action: 'open_dispute',
      entity: 'Dispute',
      entityId: dispute._id,
      changes: { after: { invoiceId, reason } },
      ipAddress: req.ip,
    });

    const populated = await Dispute.findById(dispute._id)
      .populate('invoice', 'invoiceNumber amount')
      .populate('customer', 'companyName')
      .populate('raisedBy', 'firstName lastName');

    try { emitToAll('dispute:opened', { dispute: populated }); } catch (e) {}

    res.status(201).json({ dispute: populated });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create dispute' });
  }
};

exports.updateDispute = async (req, res) => {
  try {
    const { status, resolution, assignedTo } = req.body;
    const dispute = await Dispute.findById(req.params.id);

    if (!dispute) {
      return res.status(404).json({ message: 'Dispute not found' });
    }

    const before = { status: dispute.status };

    if (status) dispute.status = status;
    if (resolution) dispute.resolution = resolution;
    if (assignedTo) dispute.assignedTo = assignedTo;
    if (status === 'resolved') {
      dispute.resolvedAt = new Date();
      // Revert invoice status
      const invoice = await Invoice.findById(dispute.invoice);
      if (invoice && invoice.status === 'disputed') {
        invoice.status = invoice.balance > 0 ? (invoice.paidAmount > 0 ? 'partial' : 'pending') : 'paid';
        await invoice.save();
      }
    }

    await dispute.save();

    await logAudit({
      user: req.user._id,
      action: 'update_dispute',
      entity: 'Dispute',
      entityId: dispute._id,
      changes: { before, after: { status: dispute.status } },
      ipAddress: req.ip,
    });

    const populated = await Dispute.findById(dispute._id)
      .populate('invoice', 'invoiceNumber amount')
      .populate('customer', 'companyName')
      .populate('raisedBy', 'firstName lastName')
      .populate('assignedTo', 'firstName lastName');

    try { emitToAll('dispute:updated', { dispute: populated }); } catch (e) {}

    res.json({ dispute: populated });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update dispute' });
  }
};

exports.getDisputes = async (req, res) => {
  try {
    const { status, customer, dateFrom, dateTo, search, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (status === 'unresolved') {
      filter.status = { $in: ['open', 'under_review'] };
    } else if (status) {
      filter.status = status;
    }
    if (customer) filter.customer = customer;

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(new Date(dateTo).setHours(23, 59, 59, 999));
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [disputes, total] = await Promise.all([
      Dispute.find(filter)
        .populate('invoice', 'invoiceNumber amount balance')
        .populate('customer', 'companyName')
        .populate('raisedBy', 'firstName lastName')
        .populate('assignedTo', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Dispute.countDocuments(filter),
    ]);

    // Client-side search filter on populated fields
    let filtered = disputes;
    if (search) {
      const s = search.toLowerCase();
      filtered = disputes.filter((d) => {
        const invNum = d.invoice?.invoiceNumber?.toLowerCase() || '';
        const custName = d.customer?.companyName?.toLowerCase() || '';
        const reason = d.reason?.toLowerCase() || '';
        const raisedBy = `${d.raisedBy?.firstName || ''} ${d.raisedBy?.lastName || ''}`.toLowerCase();
        return invNum.includes(s) || custName.includes(s) || reason.includes(s) || raisedBy.includes(s);
      });
    }

    res.json({ disputes: filtered, total: search ? filtered.length : total, page: Number(page), pages: Math.ceil((search ? filtered.length : total) / Number(limit)) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load disputes' });
  }
};
