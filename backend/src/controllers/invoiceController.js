const Invoice = require('../models/Invoice');
const Customer = require('../models/Customer');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

exports.getInvoices = async (req, res) => {
  try {
    const { customer, status, overdue, dateFrom, dateTo, page = 1, limit = 50, search } = req.query;
    const filter = {};

    if (req.user.role === 'client') {
      const cust = await Customer.findOne({ _id: req.user.linkedCustomer });
      filter.customer = cust?._id;
    }

    if (customer) filter.customer = customer;
    if (status) {
      const statuses = status.split(',').map(s => s.trim());
      filter.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
    }
    if (search) {
      filter.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } },
      ];
    }
    if (overdue === 'true') {
      filter.dueDate = { $lt: new Date() };
      filter.status = { $nin: ['paid', 'frozen'] };
    }
    if (dateFrom || dateTo) {
      filter.invoiceDate = {};
      if (dateFrom) filter.invoiceDate.$gte = new Date(dateFrom);
      if (dateTo) filter.invoiceDate.$lte = new Date(dateTo);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [invoices, total] = await Promise.all([
      Invoice.find(filter)
        .populate('customer', 'companyName creditTerm office salesManager customerNumber grade')
        .populate('createdBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Invoice.countDocuments(filter),
    ]);

    // Add computed fields
    const enriched = invoices.map((inv) => {
      const doc = inv.toObject();
      const now = new Date();
      const dueDate = new Date(doc.dueDate);
      const diffMs = dueDate - now;
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      doc.remainingDays = diffDays;
      doc.overdueDays = diffDays < 0 ? Math.abs(diffDays) : 0;
      doc.isOverdue = diffDays < 0 && doc.status !== 'paid';
      return doc;
    });

    res.json({ invoices: enriched, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load invoices' });
  }
};

exports.getInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('customer', 'companyName creditTerm contactPerson email phone office salesManager customerNumber grade')
      .populate('createdBy', 'firstName lastName')
      .populate('frozenBy', 'firstName lastName');

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const doc = invoice.toObject();
    const now = new Date();
    const diffMs = new Date(doc.dueDate) - now;
    doc.remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    doc.overdueDays = doc.remainingDays < 0 ? Math.abs(doc.remainingDays) : 0;
    doc.isOverdue = doc.remainingDays < 0 && doc.status !== 'paid';

    res.json({ invoice: doc });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load invoice details' });
  }
};

exports.createInvoice = async (req, res) => {
  try {
    const { invoiceNumber, customer: customerId, amount, invoiceDate, notes } = req.body;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    if (customer.isStopped) {
      return res.status(400).json({ message: 'Cannot create invoice for stopped customer' });
    }

    const invDate = new Date(invoiceDate);
    const dueDate = new Date(invDate);
    dueDate.setDate(dueDate.getDate() + customer.creditTerm);

    const invoice = await Invoice.create({
      invoiceNumber,
      customer: customerId,
      amount,
      balance: amount,
      invoiceDate: invDate,
      dueDate,
      creditTerm: customer.creditTerm,
      notes,
      createdBy: req.user._id,
    });

    // Update customer outstanding
    customer.currentOutstanding += amount;
    await customer.save();

    await logAudit({
      user: req.user._id,
      action: 'create_invoice',
      entity: 'Invoice',
      entityId: invoice._id,
      changes: { after: { invoiceNumber, amount, customerId, creditTerm: customer.creditTerm } },
      ipAddress: req.ip,
    });

    const populated = await Invoice.findById(invoice._id)
      .populate('customer', 'companyName creditTerm');

    try { emitToAll('invoice:created', { invoice: populated }); } catch (e) {}

    res.status(201).json({ invoice: populated });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Invoice number already exists' });
    }
    res.status(500).json({ message: 'Failed to create invoice' });
  }
};

exports.updateInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    if (invoice.isFrozen && req.user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Invoice is frozen' });
    }

    const before = invoice.toObject();
    const { notes, amount } = req.body;

    if (notes !== undefined) invoice.notes = notes;
    if (amount !== undefined && req.user.role !== 'employee') {
      const diff = amount - invoice.amount;
      invoice.amount = amount;
      invoice.balance = amount - invoice.paidAmount;
      const customer = await Customer.findById(invoice.customer);
      if (customer) {
        customer.currentOutstanding += diff;
        await customer.save();
      }
    }

    await invoice.save();

    await logAudit({
      user: req.user._id,
      action: 'update_invoice',
      entity: 'Invoice',
      entityId: invoice._id,
      changes: { before, after: invoice.toObject() },
      ipAddress: req.ip,
    });

    try { emitToAll('invoice:updated', { invoice }); } catch (e) {}

    res.json({ invoice });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update invoice' });
  }
};

exports.overrideStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const before = { status: invoice.status };
    invoice.status = status;
    await invoice.save();

    await logAudit({
      user: req.user._id,
      action: 'override_invoice_status',
      entity: 'Invoice',
      entityId: invoice._id,
      changes: { before, after: { status } },
      ipAddress: req.ip,
    });

    try { emitToAll('status:changed', { invoiceId: invoice._id, status }); } catch (e) {}

    res.json({ invoice });
  } catch (error) {
    res.status(500).json({ message: 'Failed to override invoice status' });
  }
};

exports.freezeInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    invoice.isFrozen = !invoice.isFrozen;
    invoice.frozenBy = invoice.isFrozen ? req.user._id : null;
    invoice.frozenAt = invoice.isFrozen ? new Date() : null;
    if (invoice.isFrozen) invoice.status = 'frozen';
    else invoice.status = invoice.balance > 0 ? (invoice.paidAmount > 0 ? 'partial' : 'pending') : 'paid';

    await invoice.save();

    await logAudit({
      user: req.user._id,
      action: invoice.isFrozen ? 'freeze_invoice' : 'unfreeze_invoice',
      entity: 'Invoice',
      entityId: invoice._id,
      ipAddress: req.ip,
    });

    try { emitToAll('invoice:updated', { invoice }); } catch (e) {}

    res.json({ invoice });
  } catch (error) {
    res.status(500).json({ message: 'Failed to toggle invoice freeze' });
  }
};

exports.refundInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    if (invoice.status === 'refunded') return res.status(400).json({ message: 'Invoice already refunded' });

    const before = invoice.toObject();

    // Reset financial impact on customer
    const customer = await Customer.findById(invoice.customer);
    if (customer) {
      customer.currentOutstanding = Math.max(0, customer.currentOutstanding - invoice.balance);
      await customer.save();
    }

    // Mark invoice as refunded (keep original invoiceNumber)
    invoice.status = 'refunded';
    invoice.paidAmount = invoice.amount;
    invoice.balance = 0;
    invoice.refundedAt = new Date();
    invoice.refundedBy = req.user._id;
    await invoice.save();

    await logAudit({
      user: req.user._id,
      action: 'refund_invoice',
      entity: 'Invoice',
      entityId: invoice._id,
      changes: { before, after: invoice.toObject() },
      ipAddress: req.ip,
    });

    try { emitToAll('invoice:refunded', { invoice }); } catch (e) {}

    res.json({ invoice });
  } catch (error) {
    res.status(500).json({ message: 'Failed to refund invoice' });
  }
};

exports.markFullyPaid = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    if (invoice.status === 'paid') return res.status(400).json({ message: 'Invoice already paid' });
    if (invoice.status === 'refunded') return res.status(400).json({ message: 'Cannot mark refunded invoice as paid' });

    const Payment = require('../models/Payment');
    const remainingBalance = invoice.balance;

    // Create a payment record for the remaining balance
    const payment = await Payment.create({
      invoice: invoice._id,
      customer: invoice.customer,
      amount: remainingBalance,
      paymentDate: new Date(),
      paymentMethod: 'other',
      receivedBy: req.user._id,
      notes: 'Marked as fully paid',
    });

    const before = invoice.toObject();
    invoice.paidAmount = invoice.amount;
    invoice.balance = 0;
    invoice.status = 'paid';
    await invoice.save();

    // Update customer outstanding
    const customer = await Customer.findById(invoice.customer);
    if (customer) {
      customer.currentOutstanding = Math.max(0, customer.currentOutstanding - remainingBalance);
      customer.lastPaymentDate = new Date();
      customer.lastPaymentAmount = remainingBalance;
      await customer.save();
    }

    await logAudit({
      user: req.user._id,
      action: 'mark_fully_paid',
      entity: 'Invoice',
      entityId: invoice._id,
      changes: { before, after: invoice.toObject() },
      ipAddress: req.ip,
    });

    try { emitToAll('payment:logged', { payment, invoice }); } catch (e) {}

    res.json({ invoice, payment });
  } catch (error) {
    res.status(500).json({ message: 'Failed to mark invoice as fully paid' });
  }
};

exports.deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id).populate('customer', 'companyName currentOutstanding');
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    // Reverse financial impact on customer
    if (invoice.customer && invoice.balance > 0) {
      const Customer = require('../models/Customer');
      await Customer.findByIdAndUpdate(invoice.customer._id, {
        $inc: { currentOutstanding: -invoice.balance },
      });
    }

    // Delete related payments and disputes
    const Payment = require('../models/Payment');
    const Dispute = require('../models/Dispute');
    const CollectionActivity = require('../models/CollectionActivity');
    await Payment.deleteMany({ invoice: invoice._id });
    await Dispute.deleteMany({ invoice: invoice._id });
    await CollectionActivity.deleteMany({ invoice: invoice._id });

    await Invoice.findByIdAndDelete(invoice._id);

    await logAudit({
      user: req.user._id,
      action: 'delete_invoice',
      entity: 'Invoice',
      entityId: invoice._id,
      changes: { before: { invoiceNumber: invoice.invoiceNumber, amount: invoice.amount, balance: invoice.balance } },
      ipAddress: req.ip,
    });

    try { emitToAll('invoice:deleted', { invoiceId: invoice._id }); } catch (e) {}

    res.json({ message: 'Invoice and related data deleted' });
  } catch (error) {
    console.error('Delete invoice error:', error);
    res.status(500).json({ message: 'Failed to delete invoice' });
  }
};
