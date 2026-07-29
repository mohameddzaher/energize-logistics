const Customer = require("../models/Customer");
const Invoice = require("../models/Invoice");
const User = require("../models/User");
const logAudit = require("../utils/auditLogger");
const { emitToAll } = require("../websocket/socketManager");

exports.getCustomers = async (req, res) => {
  try {
    const {
      search,
      office,
      riskLevel,
      creditTerm,
      page = 1,
      limit = 50,
    } = req.query;
    const filter = { isActive: true };

    // Client sees only their linked customer
    if (req.user.role === "client") {
      filter._id = req.user.linkedCustomer;
    }

    if (search) {
      filter.$or = [
        { companyName: { $regex: search, $options: "i" } },
        { contactPerson: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { customerNumber: { $regex: search, $options: "i" } },
      ];
    }
    if (office) filter.office = office;
    if (riskLevel) filter.riskLevel = riskLevel;
    if (creditTerm) filter.creditTerm = Number(creditTerm);

    const skip = (Number(page) - 1) * Number(limit);
    const [customers, total] = await Promise.all([
      Customer.find(filter)
        .populate("assignedCollector", "firstName lastName email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Customer.countDocuments(filter),
    ]);

    // Attach each customer's outstanding balance (sum of unpaid invoice balances)
    // so list screens (web + mobile) can show "due" without an N+1 per-customer call.
    const ids = customers.map((c) => c._id);
    const dueRows = ids.length
      ? await Invoice.aggregate([
          { $match: { customer: { $in: ids } } },
          { $group: { _id: "$customer", outstanding: { $sum: "$balance" } } },
        ])
      : [];
    const dueByCustomer = new Map(dueRows.map((r) => [String(r._id), r.outstanding]));
    for (const c of customers) c.outstandingBalance = dueByCustomer.get(String(c._id)) || 0;

    res.json({
      customers,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to load customers" });
  }
};

exports.getCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).populate(
      "assignedCollector",
      "firstName lastName email",
    );

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // Get invoices summary
    const invoices = await Invoice.find({ customer: customer._id });
    const summary = {
      totalInvoices: invoices.length,
      totalAmount: invoices.reduce((sum, inv) => sum + inv.amount, 0),
      totalPaid: invoices.reduce((sum, inv) => sum + inv.paidAmount, 0),
      totalOutstanding: invoices.reduce((sum, inv) => sum + inv.balance, 0),
      overdueCount: invoices.filter(
        (inv) => inv.dueDate < new Date() && inv.status !== "paid",
      ).length,
    };

    res.json({ customer, summary });
  } catch (error) {
    res.status(500).json({ message: "Failed to load customer details" });
  }
};

exports.createCustomer = async (req, res) => {
  try {
    const { username, password, ...customerData } = req.body;

    // Remove empty strings for sparse unique fields
    if (!customerData.customerNumber) delete customerData.customerNumber;
    if (!customerData.office) delete customerData.office;
    if (!customerData.salesManager) delete customerData.salesManager;

    const customer = await Customer.create(customerData);

    // Auto-create a client user if credentials are provided
    if (username && password) {
      try {
        await User.create({
          email: username,
          password,
          role: "client",
          linkedCustomer: customer._id,
          firstName: customerData.contactPerson || customerData.companyName,
          lastName: "",
        });
      } catch (userErr) {
        console.error("Failed to create client user:", userErr.message);
        // Customer was created successfully, don't fail the whole request
      }
    }

    await logAudit({
      user: req.user._id,
      action: "create_customer",
      entity: "Customer",
      entityId: customer._id,
      changes: { after: customerData },
      ipAddress: req.ip,
    });

    try {
      emitToAll("customer:created", { customer });
    } catch (e) {}

    res.status(201).json({ customer });
  } catch (error) {
    console.error("Create customer error:", error);
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      const labels = {
        companyName: "Company name",
        customerNumber: "Customer number",
        email: "Email",
      };
      return res
        .status(400)
        .json({ message: `${labels[field] || field} already exists` });
    }
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ message: messages.join(", ") });
    }
    res
      .status(500)
      .json({ message: error.message || "Failed to create customer" });
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // Only super_admin can change customerNumber
    if (
      req.body.customerNumber &&
      req.body.customerNumber !== customer.customerNumber &&
      req.user.role !== "super_admin"
    ) {
      return res
        .status(403)
        .json({ message: "Only super_admin can change customer number" });
    }

    const before = customer.toObject();
    Object.assign(customer, req.body);
    await customer.save();

    await logAudit({
      user: req.user._id,
      action: "update_customer",
      entity: "Customer",
      entityId: customer._id,
      changes: { before, after: customer.toObject() },
      ipAddress: req.ip,
    });

    try {
      emitToAll("customer:updated", { customer });
    } catch (e) {}

    res.json({ customer });
  } catch (error) {
    console.error("Update customer error:", error);
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      const labels = {
        companyName: "Company name",
        customerNumber: "Customer number",
        email: "Email",
      };
      return res
        .status(400)
        .json({ message: `${labels[field] || field} already exists` });
    }
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ message: messages.join(", ") });
    }
    res
      .status(500)
      .json({ message: error.message || "Failed to update customer" });
  }
};

exports.updateCreditTerm = async (req, res) => {
  try {
    const { creditTerm } = req.body;
    const customer = await Customer.findById(req.params.id);

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const before = { creditTerm: customer.creditTerm };
    customer.creditTerm = creditTerm;
    await customer.save();

    await logAudit({
      user: req.user._id,
      action: "change_credit_term",
      entity: "Customer",
      entityId: customer._id,
      changes: { before, after: { creditTerm } },
      ipAddress: req.ip,
    });

    try {
      emitToAll("creditTerm:updated", { customerId: customer._id, creditTerm });
    } catch (e) {}

    res.json({ customer });
  } catch (error) {
    res.status(500).json({ message: "Failed to update credit term" });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer)
      return res.status(404).json({ message: "Customer not found" });

    // Collect summary of what will be deleted
    const Invoice = require("../models/Invoice");
    const Payment = require("../models/Payment");
    const Dispute = require("../models/Dispute");
    const CollectionActivity = require("../models/CollectionActivity");
    const Notification = require("../models/Notification");
    const AuditLog = require("../models/AuditLog");

    const invoiceIds = await Invoice.find({ customer: customer._id }).distinct(
      "_id",
    );

    const summary = {
      invoices: invoiceIds.length,
      payments: await Payment.countDocuments({ customer: customer._id }),
      disputes: await Dispute.countDocuments({ customer: customer._id }),
      activities: await CollectionActivity.countDocuments({
        customer: customer._id,
      }),
    };

    // Cascade delete all related records
    await Payment.deleteMany({ customer: customer._id });
    await Dispute.deleteMany({ customer: customer._id });
    await CollectionActivity.deleteMany({ customer: customer._id });
    await Invoice.deleteMany({ customer: customer._id });
    await Notification.deleteMany({
      relatedEntityId: customer._id,
      relatedEntity: "Customer",
    });

    // Remove customer from assigned collectors
    const User = require("../models/User");
    await User.updateMany(
      { assignedCustomers: customer._id },
      { $pull: { assignedCustomers: customer._id } },
    );
    // Clear linked customer for client users
    await User.updateMany(
      { linkedCustomer: customer._id },
      { $unset: { linkedCustomer: 1 } },
    );

    // Delete the customer
    await Customer.findByIdAndDelete(customer._id);

    await logAudit({
      user: req.user._id,
      action: "delete_customer",
      entity: "Customer",
      entityId: customer._id,
      changes: { before: { companyName: customer.companyName, ...summary } },
      ipAddress: req.ip,
    });

    try {
      emitToAll("customer:deleted", { customerId: customer._id, summary });
    } catch (e) {}

    res.json({ message: "Customer and all related data deleted", summary });
  } catch (error) {
    console.error("Delete customer error:", error);
    res.status(500).json({ message: "Failed to delete customer" });
  }
};

exports.stopCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    customer.isStopped = true;
    customer.stoppedAt = new Date();
    customer.stoppedBy = req.user._id;
    customer.clientStatus = "stopped_by_us";
    await customer.save();

    await logAudit({
      user: req.user._id,
      action: "stop_customer",
      entity: "Customer",
      entityId: customer._id,
      ipAddress: req.ip,
    });

    try {
      emitToAll("customer:stopped", { customer });
    } catch (e) {}

    res.json({ customer });
  } catch (error) {
    res.status(500).json({ message: "Failed to stop customer" });
  }
};

exports.unstopCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    customer.isStopped = false;
    customer.stoppedAt = null;
    customer.stoppedBy = null;
    await customer.save();

    await logAudit({
      user: req.user._id,
      action: "unstop_customer",
      entity: "Customer",
      entityId: customer._id,
      ipAddress: req.ip,
    });

    try {
      emitToAll("customer:updated", { customer });
    } catch (e) {}

    res.json({ customer });
  } catch (error) {
    res.status(500).json({ message: "Failed to unstop customer" });
  }
};
