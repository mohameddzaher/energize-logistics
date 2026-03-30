const CollectionTask = require('../models/CollectionTask');
const TaskSuggestion = require('../models/TaskSuggestion');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

// ─── CREATE TASKS (BATCH) ────────────────────────────────────
exports.createTasks = async (req, res) => {
  try {
    const { tasks } = req.body; // Array of { assignedTo, customer, contactMethod, dueDate }

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ message: 'Tasks array is required' });
    }

    const created = [];
    for (const task of tasks) {
      const newTask = await CollectionTask.create({
        createdBy: req.user._id,
        assignedTo: task.assignedTo,
        customer: task.customer,
        contactMethod: task.contactMethod,
        dueDate: task.dueDate || null,
      });
      created.push(newTask);
    }

    // Populate all created tasks
    const populated = await CollectionTask.find({ _id: { $in: created.map((t) => t._id) } })
      .populate('createdBy', 'firstName lastName')
      .populate('assignedTo', 'firstName lastName')
      .populate('customer', 'companyName customerNumber currentOutstanding');

    await logAudit({
      user: req.user._id,
      action: 'create_tasks',
      entity: 'CollectionTask',
      entityId: created[0]._id,
      changes: { after: { count: created.length, tasks: created.map((t) => t._id) } },
      ipAddress: req.ip,
    });

    try { emitToAll('task:created', { tasks: populated }); } catch (e) {}

    res.status(201).json({ tasks: populated, count: populated.length });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to create tasks' });
  }
};

// ─── GET TASKS (WITH FILTERS) ────────────────────────────────
exports.getTasks = async (req, res) => {
  try {
    const {
      status, assignedTo, customer, contactMethod,
      dateFrom, dateTo, search,
      page = 1, limit = 50,
    } = req.query;

    const filter = {};

    if (status) filter.status = status;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (customer) filter.customer = customer;
    if (contactMethod) filter.contactMethod = contactMethod;

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(new Date(dateTo).setHours(23, 59, 59, 999));
    }

    // For employees, only show their own tasks
    if (req.user.role === 'employee') {
      filter.assignedTo = req.user._id;
    }

    const skip = (Number(page) - 1) * Number(limit);

    let query = CollectionTask.find(filter)
      .populate('createdBy', 'firstName lastName')
      .populate('assignedTo', 'firstName lastName')
      .populate('customer', 'companyName customerNumber currentOutstanding')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    const [tasks, total] = await Promise.all([
      query,
      CollectionTask.countDocuments(filter),
    ]);

    // If search term, filter populated results
    let filtered = tasks;
    if (search) {
      const s = search.toLowerCase();
      filtered = tasks.filter((t) => {
        const cName = t.customer?.companyName?.toLowerCase() || '';
        const cNum = t.customer?.customerNumber?.toLowerCase() || '';
        const aName = `${t.assignedTo?.firstName || ''} ${t.assignedTo?.lastName || ''}`.toLowerCase();
        return cName.includes(s) || cNum.includes(s) || aName.includes(s);
      });
    }

    res.json({
      tasks: filtered,
      total: search ? filtered.length : total,
      page: Number(page),
      pages: Math.ceil((search ? filtered.length : total) / Number(limit)),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load tasks' });
  }
};

// ─── GET MY TASKS (COLLECTOR) ────────────────────────────────
exports.getMyTasks = async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const filter = { assignedTo: req.user._id };

    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);

    const [tasks, total] = await Promise.all([
      CollectionTask.find(filter)
        .populate('createdBy', 'firstName lastName')
        .populate('customer', 'companyName customerNumber currentOutstanding')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      CollectionTask.countDocuments(filter),
    ]);

    res.json({
      tasks,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load tasks' });
  }
};

// ─── UPDATE TASK STATUS (COLLECTOR) ──────────────────────────
exports.updateTaskStatus = async (req, res) => {
  try {
    const { status, collectedAmount, actionNotes, nextFollowUpDate, contactMethod, dueDate, assignedTo, customer } = req.body;
    const task = await CollectionTask.findById(req.params.id);

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Employees can only update their own tasks
    const isManager = ['super_admin', 'admin'].includes(req.user.role);
    if (!isManager && task.assignedTo.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You can only update your own tasks' });
    }

    const before = { status: task.status, collectedAmount: task.collectedAmount, contactMethod: task.contactMethod };

    if (status) task.status = status;
    if (collectedAmount !== undefined) task.collectedAmount = collectedAmount;
    if (actionNotes !== undefined) task.actionNotes = actionNotes;
    if (nextFollowUpDate !== undefined) task.nextFollowUpDate = nextFollowUpDate || null;

    // Manager-only edit fields
    if (isManager) {
      if (contactMethod) task.contactMethod = contactMethod;
      if (dueDate !== undefined) task.dueDate = dueDate || null;
      if (assignedTo) task.assignedTo = assignedTo;
      if (customer) task.customer = customer;
    }

    if (status === 'done' || status === 'cancelled') {
      task.completedAt = new Date();
    }

    await task.save();

    await logAudit({
      user: req.user._id,
      action: 'update_task',
      entity: 'CollectionTask',
      entityId: task._id,
      changes: { before, after: { status: task.status, collectedAmount: task.collectedAmount, contactMethod: task.contactMethod } },
      ipAddress: req.ip,
    });

    const populated = await CollectionTask.findById(task._id)
      .populate('createdBy', 'firstName lastName')
      .populate('assignedTo', 'firstName lastName')
      .populate('customer', 'companyName customerNumber currentOutstanding');

    try { emitToAll('task:updated', { task: populated }); } catch (e) {}

    res.json({ task: populated });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update task' });
  }
};

// ─── DELETE TASK ─────────────────────────────────────────────
exports.deleteTask = async (req, res) => {
  try {
    const task = await CollectionTask.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    await CollectionTask.findByIdAndDelete(req.params.id);

    await logAudit({
      user: req.user._id,
      action: 'delete_task',
      entity: 'CollectionTask',
      entityId: task._id,
      changes: { before: { status: task.status, customer: task.customer } },
      ipAddress: req.ip,
    });

    try { emitToAll('task:deleted', { taskId: task._id }); } catch (e) {}

    res.json({ message: 'Task deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete task' });
  }
};

// ─── TASK STATS (MANAGER DASHBOARD) ─────────────────────────
exports.getTaskStats = async (req, res) => {
  try {
    const { dateFrom, dateTo, assignedTo, customer, contactMethod } = req.query;
    const filter = {};

    if (assignedTo) filter.assignedTo = assignedTo;
    if (customer) filter.customer = customer;
    if (contactMethod) filter.contactMethod = contactMethod;

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(new Date(dateTo).setHours(23, 59, 59, 999));
    }

    const [total, done, postponed, cancelled, pending] = await Promise.all([
      CollectionTask.countDocuments(filter),
      CollectionTask.countDocuments({ ...filter, status: 'done' }),
      CollectionTask.countDocuments({ ...filter, status: 'postponed' }),
      CollectionTask.countDocuments({ ...filter, status: 'cancelled' }),
      CollectionTask.countDocuments({ ...filter, status: 'pending' }),
    ]);

    // Avg completion time for done tasks
    const completedTasks = await CollectionTask.find({ ...filter, status: 'done', completedAt: { $exists: true } })
      .select('createdAt completedAt');

    let avgCompletionHours = 0;
    if (completedTasks.length > 0) {
      const totalHours = completedTasks.reduce((sum, t) => {
        return sum + (new Date(t.completedAt).getTime() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60);
      }, 0);
      avgCompletionHours = Math.round(totalHours / completedTasks.length);
    }

    // Tasks by collector
    const byCollector = await CollectionTask.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$assignedTo',
          total: { $sum: 1 },
          done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
          postponed: { $sum: { $cond: [{ $eq: ['$status', 'postponed'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          totalCollected: { $sum: '$collectedAmount' },
        },
      },
    ]);

    // Populate collector names
    const collectorIds = byCollector.map((c) => c._id);
    const collectors = await User.find({ _id: { $in: collectorIds } }).select('firstName lastName');
    const collectorMap = {};
    collectors.forEach((c) => { collectorMap[c._id.toString()] = `${c.firstName} ${c.lastName}`; });

    const byCollectorPopulated = byCollector.map((c) => ({
      ...c,
      collectorName: collectorMap[c._id?.toString()] || 'Unknown',
    }));

    // Tasks by customer
    const byCustomer = await CollectionTask.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$customer',
          total: { $sum: 1 },
          done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
        },
      },
      { $sort: { total: -1 } },
      { $limit: 20 },
    ]);

    const customerIds = byCustomer.map((c) => c._id);
    const customers = await Customer.find({ _id: { $in: customerIds } }).select('companyName');
    const customerMap = {};
    customers.forEach((c) => { customerMap[c._id.toString()] = c.companyName; });

    const byCustomerPopulated = byCustomer.map((c) => ({
      ...c,
      customerName: customerMap[c._id?.toString()] || 'Unknown',
    }));

    // Total collected via tasks
    const totalCollected = await CollectionTask.aggregate([
      { $match: { ...filter, status: 'done' } },
      { $group: { _id: null, total: { $sum: '$collectedAmount' } } },
    ]);

    res.json({
      total,
      done,
      postponed,
      cancelled,
      pending,
      completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
      avgCompletionHours,
      totalCollected: totalCollected[0]?.total || 0,
      byCollector: byCollectorPopulated,
      byCustomer: byCustomerPopulated,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load task stats' });
  }
};

// ─── COLLECTOR TASK STATS (PROFILE) ──────────────────────────
exports.getCollectorTaskStats = async (req, res) => {
  try {
    const { collectorId } = req.params;
    const { dateFrom, dateTo } = req.query;
    const filter = { assignedTo: collectorId };

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(new Date(dateTo).setHours(23, 59, 59, 999));
    }

    const [total, done, postponed, cancelled, pending] = await Promise.all([
      CollectionTask.countDocuments(filter),
      CollectionTask.countDocuments({ ...filter, status: 'done' }),
      CollectionTask.countDocuments({ ...filter, status: 'postponed' }),
      CollectionTask.countDocuments({ ...filter, status: 'cancelled' }),
      CollectionTask.countDocuments({ ...filter, status: 'pending' }),
    ]);

    const totalCollectedAgg = await CollectionTask.aggregate([
      { $match: { ...filter, status: 'done' } },
      { $group: { _id: null, total: { $sum: '$collectedAmount' } } },
    ]);

    const recentTasks = await CollectionTask.find(filter)
      .populate('customer', 'companyName customerNumber')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      total,
      done,
      postponed,
      cancelled,
      pending,
      completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
      totalCollected: totalCollectedAgg[0]?.total || 0,
      recentTasks,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load collector task stats' });
  }
};

// ─── GENERATE SUGGESTIONS ────────────────────────────────────
exports.generateSuggestions = async (req, res) => {
  try {
    // Clear old non-dismissed suggestions
    await TaskSuggestion.deleteMany({ dismissed: false, convertedToTask: { $exists: false } });

    const suggestions = [];
    const now = new Date();

    // Get all active customers with assigned collectors
    const customers = await Customer.find({ isActive: true, assignedCollector: { $exists: true } })
      .populate('assignedCollector', 'firstName lastName')
      .lean();

    for (const customer of customers) {
      if (!customer.assignedCollector) continue;

      // Get overdue invoices
      const overdueInvoices = await Invoice.find({
        customer: customer._id,
        status: { $in: ['pending', 'partial', 'overdue'] },
        dueDate: { $lt: now },
      }).lean();

      const totalOverdueDays = overdueInvoices.length > 0
        ? Math.max(...overdueInvoices.map((inv) => Math.floor((now - new Date(inv.dueDate)) / (1000 * 60 * 60 * 24))))
        : 0;

      // Get last task for this customer
      const lastTask = await CollectionTask.findOne({ customer: customer._id })
        .sort({ createdAt: -1 })
        .lean();

      const daysSinceLastTask = lastTask
        ? Math.floor((now - new Date(lastTask.createdAt)) / (1000 * 60 * 60 * 24))
        : 999;

      let reason = null;

      // Rule 1: Overdue > 60 days
      if (totalOverdueDays > 60) {
        reason = `Critical overdue: ${totalOverdueDays} days past due`;
      }
      // Rule 2: Overdue > 30 days
      else if (totalOverdueDays > 30) {
        reason = `Overdue: ${totalOverdueDays} days past due`;
      }
      // Rule 3: High risk
      else if (customer.riskLevel === 'high') {
        reason = 'High risk client requires follow-up';
      }
      // Rule 4: No task in 14 days
      else if (daysSinceLastTask > 14 && customer.currentOutstanding > 0) {
        reason = `No follow-up in ${daysSinceLastTask} days`;
      }
      // Rule 5: Large outstanding
      else if (customer.currentOutstanding > 100000) {
        reason = `Large outstanding: ${customer.currentOutstanding.toLocaleString()} SAR`;
      }
      // Rule 6: Bad client status
      else if (['late_payment', 'under_review'].includes(customer.clientStatus)) {
        reason = `Client status: ${customer.clientStatus.replace('_', ' ')}`;
      }

      if (reason) {
        suggestions.push({
          customer: customer._id,
          suggestedTo: customer.assignedCollector._id,
          reason,
          riskLevel: customer.riskLevel,
          overdueDays: totalOverdueDays,
          outstanding: customer.currentOutstanding,
        });
      }
    }

    if (suggestions.length > 0) {
      await TaskSuggestion.insertMany(suggestions);
    }

    const populated = await TaskSuggestion.find({ dismissed: false, convertedToTask: { $exists: false } })
      .populate('customer', 'companyName customerNumber currentOutstanding riskLevel clientStatus')
      .populate('suggestedTo', 'firstName lastName')
      .sort({ outstanding: -1 });

    try { emitToAll('suggestion:generated', { count: populated.length }); } catch (e) {}

    res.json({ suggestions: populated, count: populated.length });
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate suggestions' });
  }
};

// ─── GET SUGGESTIONS ─────────────────────────────────────────
exports.getSuggestions = async (req, res) => {
  try {
    const suggestions = await TaskSuggestion.find({ dismissed: false, convertedToTask: { $exists: false } })
      .populate('customer', 'companyName customerNumber currentOutstanding riskLevel clientStatus grade')
      .populate('suggestedTo', 'firstName lastName')
      .sort({ outstanding: -1 });

    res.json({ suggestions });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load suggestions' });
  }
};

// ─── APPROVE SUGGESTION → CREATE TASK ────────────────────────
exports.approveSuggestion = async (req, res) => {
  try {
    const suggestion = await TaskSuggestion.findById(req.params.id);
    if (!suggestion) {
      return res.status(404).json({ message: 'Suggestion not found' });
    }

    const { contactMethod = 'call', dueDate } = req.body;

    const task = await CollectionTask.create({
      createdBy: req.user._id,
      assignedTo: suggestion.suggestedTo,
      customer: suggestion.customer,
      contactMethod,
      dueDate: dueDate || null,
    });

    suggestion.convertedToTask = task._id;
    await suggestion.save();

    const populated = await CollectionTask.findById(task._id)
      .populate('createdBy', 'firstName lastName')
      .populate('assignedTo', 'firstName lastName')
      .populate('customer', 'companyName customerNumber currentOutstanding');

    try { emitToAll('task:created', { tasks: [populated] }); } catch (e) {}
    try { emitToAll('suggestion:approved', { suggestionId: suggestion._id, task: populated }); } catch (e) {}

    res.status(201).json({ task: populated });
  } catch (error) {
    res.status(500).json({ message: 'Failed to approve suggestion' });
  }
};

// ─── DISMISS SUGGESTION ──────────────────────────────────────
exports.dismissSuggestion = async (req, res) => {
  try {
    const suggestion = await TaskSuggestion.findById(req.params.id);
    if (!suggestion) {
      return res.status(404).json({ message: 'Suggestion not found' });
    }

    suggestion.dismissed = true;
    suggestion.dismissedBy = req.user._id;
    suggestion.dismissedAt = new Date();
    await suggestion.save();

    try { emitToAll('suggestion:dismissed', { suggestionId: suggestion._id }); } catch (e) {}

    res.json({ message: 'Suggestion dismissed' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to dismiss suggestion' });
  }
};

// ─── GET FOLLOW-UP TASKS ────────────────────────────────────
exports.getFollowUpTasks = async (req, res) => {
  try {
    const filter = {
      nextFollowUpDate: { $exists: true, $ne: null },
      status: { $in: ['done', 'postponed'] },
    };

    // Employees see only their own
    if (req.user.role === 'employee') {
      filter.assignedTo = req.user._id;
    }

    const tasks = await CollectionTask.find(filter)
      .populate('createdBy', 'firstName lastName')
      .populate('assignedTo', 'firstName lastName')
      .populate('customer', 'companyName customerNumber currentOutstanding')
      .sort({ nextFollowUpDate: 1 })
      .limit(50);

    res.json({ tasks });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load follow-up tasks' });
  }
};

// ─── LOW VISIT CUSTOMERS (DASHBOARD WIDGET) ─────────────────
exports.getLowVisitCustomers = async (req, res) => {
  try {
    const customers = await Customer.find({ isActive: true })
      .populate('assignedCollector', 'firstName lastName')
      .lean();

    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const results = [];

    for (const customer of customers) {
      const taskCount = await CollectionTask.countDocuments({ customer: customer._id });
      const recentTaskCount = await CollectionTask.countDocuments({
        customer: customer._id,
        createdAt: { $gte: fourteenDaysAgo },
      });

      const lastTask = await CollectionTask.findOne({ customer: customer._id })
        .sort({ createdAt: -1 })
        .select('createdAt')
        .lean();

      // Include if: no tasks ever, OR no recent tasks, OR high overdue + low activity
      const hasOverdue = customer.currentOutstanding > 0;
      const noTasks = taskCount === 0;
      const noRecentTasks = recentTaskCount === 0 && hasOverdue;

      if (noTasks || noRecentTasks) {
        results.push({
          _id: customer._id,
          companyName: customer.companyName,
          customerNumber: customer.customerNumber,
          currentOutstanding: customer.currentOutstanding,
          riskLevel: customer.riskLevel,
          assignedCollector: customer.assignedCollector,
          totalTasks: taskCount,
          lastTaskDate: lastTask?.createdAt || null,
          daysSinceLastTask: lastTask
            ? Math.floor((now.getTime() - new Date(lastTask.createdAt).getTime()) / (1000 * 60 * 60 * 24))
            : null,
        });
      }
    }

    // Sort: no tasks first, then by outstanding desc
    results.sort((a, b) => {
      if (a.totalTasks === 0 && b.totalTasks > 0) return -1;
      if (a.totalTasks > 0 && b.totalTasks === 0) return 1;
      return b.currentOutstanding - a.currentOutstanding;
    });

    res.json({ customers: results, count: results.length });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load low visit customers' });
  }
};
