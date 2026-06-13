const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const Customer = require('../models/Customer');
const logAudit = require('../utils/auditLogger');
const { emitToAll, emitToCustomer } = require('../websocket/socketManager');

exports.logPayment = async (req, res) => {
  try {
    const { invoice: invoiceId, amount, paymentDate, paymentMethod, reference, notes } = req.body;

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    if (invoice.isFrozen) {
      return res.status(400).json({ message: 'Cannot log payment on frozen invoice' });
    }

    if (amount > invoice.balance) {
      return res.status(400).json({ message: `Payment amount exceeds invoice balance of ${invoice.balance}` });
    }

    const payment = await Payment.create({
      invoice: invoiceId,
      customer: invoice.customer,
      amount,
      paymentDate: paymentDate || new Date(),
      paymentMethod,
      receivedBy: req.user._id,
      reference,
      notes,
    });

    // Update invoice
    invoice.paidAmount += amount;
    invoice.balance = invoice.amount - invoice.paidAmount;
    if (invoice.balance <= 0) {
      invoice.status = 'paid';
      invoice.balance = 0;
    } else {
      invoice.status = 'partial';
    }
    await invoice.save();

    // Update customer outstanding
    const customer = await Customer.findById(invoice.customer);
    if (customer) {
      customer.currentOutstanding = Math.max(0, customer.currentOutstanding - amount);
      customer.lastPaymentDate = new Date(paymentDate || Date.now());
      customer.lastPaymentAmount = amount;
      await customer.save();
    }

    await logAudit({
      user: req.user._id,
      action: 'log_payment',
      entity: 'Payment',
      entityId: payment._id,
      changes: {
        after: { invoiceId, amount, invoiceBalance: invoice.balance, invoiceStatus: invoice.status },
      },
      ipAddress: req.ip,
    });

    const populated = await Payment.findById(payment._id)
      .populate('invoice', 'invoiceNumber amount balance status')
      .populate('customer', 'companyName')
      .populate('receivedBy', 'firstName lastName');

    try {
      emitToAll('payment:logged', { payment: populated, invoice });
      emitToCustomer(invoice.customer.toString(), 'payment:received', { payment: populated });
    } catch (e) {}

    res.status(201).json({ payment: populated, invoice });
  } catch (error) {
    res.status(500).json({ message: 'Failed to log payment' });
  }
};

exports.getPayments = async (req, res) => {
  try {
    const { customer, invoice, dateFrom, dateTo, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (req.user.role === 'client') {
      filter.customer = req.user.linkedCustomer;
    }

    if (customer) filter.customer = customer;
    if (invoice) filter.invoice = invoice;
    if (dateFrom || dateTo) {
      filter.paymentDate = {};
      if (dateFrom) filter.paymentDate.$gte = new Date(dateFrom);
      if (dateTo) filter.paymentDate.$lte = new Date(dateTo);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .populate('invoice', 'invoiceNumber amount balance status')
        .populate('customer', 'companyName')
        .populate('receivedBy', 'firstName lastName')
        .sort({ paymentDate: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Payment.countDocuments(filter),
    ]);

    res.json({ payments, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load payments' });
  }
};

exports.getCustomerPayments = async (req, res) => {
  try {
    const payments = await Payment.find({ customer: req.params.id })
      .populate('invoice', 'invoiceNumber amount balance status')
      .populate('receivedBy', 'firstName lastName')
      .sort({ paymentDate: -1 })
      .lean();

    res.json({ payments });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load customer payments' });
  }
};

exports.logBulkPayment = async (req, res) => {
  try {
    const { customer: customerId, allocations, paymentDate, paymentMethod, notes } = req.body;

    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const payments = [];
    let totalPaid = 0;

    for (const alloc of allocations) {
      const invoice = await Invoice.findById(alloc.invoice);
      if (!invoice) return res.status(400).json({ message: `Invoice ${alloc.invoice} not found` });
      if (invoice.customer.toString() !== customerId) return res.status(400).json({ message: 'Invoice does not belong to this customer' });
      if (invoice.isFrozen) return res.status(400).json({ message: `Invoice ${invoice.invoiceNumber} is frozen` });
      if (alloc.amount > invoice.balance) return res.status(400).json({ message: `Amount ${alloc.amount} exceeds balance ${invoice.balance} for invoice ${invoice.invoiceNumber}` });

      const payment = await Payment.create({
        invoice: alloc.invoice,
        customer: customerId,
        amount: alloc.amount,
        paymentDate: paymentDate || new Date(),
        paymentMethod,
        receivedBy: req.user._id,
        notes,
      });

      invoice.paidAmount += alloc.amount;
      invoice.balance = invoice.amount - invoice.paidAmount;
      if (invoice.balance <= 0) {
        invoice.status = 'paid';
        invoice.balance = 0;
      } else {
        invoice.status = 'partial';
      }
      await invoice.save();

      totalPaid += alloc.amount;
      payments.push(payment);
    }

    // Update customer
    customer.currentOutstanding = Math.max(0, customer.currentOutstanding - totalPaid);
    customer.lastPaymentDate = new Date(paymentDate || Date.now());
    customer.lastPaymentAmount = totalPaid;
    await customer.save();

    await logAudit({
      user: req.user._id,
      action: 'bulk_payment',
      entity: 'Payment',
      entityId: payments[0]?._id,
      changes: { after: { customerId, totalPaid, invoiceCount: allocations.length } },
      ipAddress: req.ip,
    });

    try {
      emitToAll('payment:logged', { payments, customer });
      emitToCustomer(customerId, 'payment:received', { payments });
    } catch (e) {}

    res.status(201).json({ payments, totalPaid });
  } catch (error) {
    console.error('Bulk payment error:', error);
    res.status(500).json({ message: 'Failed to process bulk payment' });
  }
};

exports.autoAllocateFIFO = async (req, res) => {
  try {
    const { customer: customerId, totalAmount, paymentDate, paymentMethod, notes } = req.body;

    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    // Get open invoices sorted by dueDate (oldest first)
    const openInvoices = await Invoice.find({
      customer: customerId,
      status: { $in: ['pending', 'partial', 'overdue'] },
      isFrozen: false,
    }).sort({ dueDate: 1 });

    if (openInvoices.length === 0) return res.status(400).json({ message: 'No open invoices for this customer' });

    let remaining = totalAmount;
    const allocations = [];
    const payments = [];

    for (const invoice of openInvoices) {
      if (remaining <= 0) break;

      const allocAmount = Math.min(remaining, invoice.balance);
      allocations.push({ invoice: invoice._id, invoiceNumber: invoice.invoiceNumber, amount: allocAmount, balance: invoice.balance });

      const payment = await Payment.create({
        invoice: invoice._id,
        customer: customerId,
        amount: allocAmount,
        paymentDate: paymentDate || new Date(),
        paymentMethod,
        receivedBy: req.user._id,
        notes: notes || 'FIFO auto-allocation',
      });

      invoice.paidAmount += allocAmount;
      invoice.balance = invoice.amount - invoice.paidAmount;
      if (invoice.balance <= 0) {
        invoice.status = 'paid';
        invoice.balance = 0;
      } else {
        invoice.status = 'partial';
      }
      await invoice.save();

      payments.push(payment);
      remaining -= allocAmount;
    }

    const totalPaid = totalAmount - remaining;

    // Update customer
    customer.currentOutstanding = Math.max(0, customer.currentOutstanding - totalPaid);
    customer.lastPaymentDate = new Date(paymentDate || Date.now());
    customer.lastPaymentAmount = totalPaid;
    await customer.save();

    await logAudit({
      user: req.user._id,
      action: 'fifo_payment',
      entity: 'Payment',
      entityId: payments[0]?._id,
      changes: { after: { customerId, totalAmount, totalPaid, allocations: allocations.length } },
      ipAddress: req.ip,
    });

    try {
      emitToAll('payment:logged', { payments, customer });
      emitToCustomer(customerId, 'payment:received', { payments });
    } catch (e) {}

    res.status(201).json({ payments, allocations, totalPaid, remaining });
  } catch (error) {
    console.error('FIFO allocation error:', error);
    res.status(500).json({ message: 'Failed to process FIFO payment allocation' });
  }
};

exports.deletePayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('invoice', 'invoiceNumber amount paidAmount balance status')
      .populate('customer', 'companyName currentOutstanding');
    if (!payment) return res.status(404).json({ message: 'Payment not found' });

    // Reverse financial impact on invoice
    if (payment.invoice) {
      const Invoice = require('../models/Invoice');
      const invoice = await Invoice.findById(payment.invoice._id);
      if (invoice) {
        invoice.paidAmount = Math.max(0, invoice.paidAmount - payment.amount);
        invoice.balance = invoice.amount - invoice.paidAmount;
        invoice.status = invoice.balance <= 0 ? 'paid' : invoice.balance < invoice.amount ? 'partial' : 'pending';
        await invoice.save();
      }
    }

    // Reverse financial impact on customer
    if (payment.customer) {
      const Customer = require('../models/Customer');
      await Customer.findByIdAndUpdate(payment.customer._id, {
        $inc: { currentOutstanding: payment.amount },
      });
    }

    await Payment.findByIdAndDelete(payment._id);

    await logAudit({
      user: req.user._id,
      action: 'delete_payment',
      entity: 'Payment',
      entityId: payment._id,
      changes: { before: { amount: payment.amount, invoice: payment.invoice?.invoiceNumber } },
      ipAddress: req.ip,
    });

    try { emitToAll('payment:deleted', { paymentId: payment._id }); } catch (e) {}

    res.json({ message: 'Payment deleted and financials reversed' });
  } catch (error) {
    console.error('Delete payment error:', error);
    res.status(500).json({ message: 'Failed to delete payment' });
  }
};
