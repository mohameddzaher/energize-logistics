const MaintenanceRequest = require('../models/MaintenanceRequest');
const WorkshopPurchaseRequest = require('../models/WorkshopPurchaseRequest');
const WorkshopTask = require('../models/WorkshopTask');
const User = require('../models/User');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');

// ═══════════════════════════════════════════════════════════
// MAINTENANCE REQUESTS
// ═══════════════════════════════════════════════════════════

const getMaintenanceRequests = async (req, res) => {
  try {
    const { status, vehicleNumber, dateFrom, dateTo, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (vehicleNumber) filter.vehicleNumber = new RegExp(vehicleNumber, 'i');
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(dateTo);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [requests, total, openCount, inProgressCount, completedTodayCount, avgDurationResult] = await Promise.all([
      MaintenanceRequest.find(filter)
        .populate('createdBy', 'firstName lastName')
        .populate('completedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      MaintenanceRequest.countDocuments(filter),
      MaintenanceRequest.countDocuments({ status: 'open' }),
      MaintenanceRequest.countDocuments({ status: 'in_progress' }),
      MaintenanceRequest.countDocuments({ status: 'completed', endTime: { $gte: todayStart } }),
      MaintenanceRequest.aggregate([
        { $match: { status: 'completed', duration: { $exists: true, $ne: null } } },
        { $group: { _id: null, avgDuration: { $avg: '$duration' } } },
      ]),
    ]);

    res.json({
      requests,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      stats: {
        open: openCount,
        inProgress: inProgressCount,
        completedToday: completedTodayCount,
        avgDuration: avgDurationResult[0]?.avgDuration
          ? Math.round(avgDurationResult[0].avgDuration)
          : 0,
      },
    });
  } catch (error) {
    console.error('Error fetching maintenance requests:', error);
    res.status(500).json({ message: 'Failed to fetch maintenance requests' });
  }
};

const getMaintenanceRequest = async (req, res) => {
  try {
    const request = await MaintenanceRequest.findById(req.params.id)
      .populate('createdBy', 'firstName lastName')
      .populate('completedBy', 'firstName lastName')
      .populate('partsNeeded.purchaseRequestId')
      .populate('branch', 'name');

    if (!request) {
      return res.status(404).json({ message: 'Maintenance request not found' });
    }

    res.json(request);
  } catch (error) {
    console.error('Error fetching maintenance request:', error);
    res.status(500).json({ message: 'Failed to fetch maintenance request' });
  }
};

const createMaintenanceRequest = async (req, res) => {
  try {
    const fullUser = await User.findById(req.user._id).select('branch');
    const branch = fullUser?.branch || req.user.branch;

    const data = {
      ...req.body,
      startTime: new Date(),
      status: 'open',
      createdBy: req.user._id,
      branch,
    };

    const request = await MaintenanceRequest.create(data);
    const populated = await MaintenanceRequest.findById(request._id)
      .populate('createdBy', 'firstName lastName');

    emitToAll('maintenance:created', populated);

    await logAudit({
      user: req.user,
      action: 'create',
      entity: 'MaintenanceRequest',
      entityId: request._id,
      changes: { vehicleNumber: data.vehicleNumber },
      ipAddress: req.ip,
    });

    res.status(201).json(populated);
  } catch (error) {
    console.error('Error creating maintenance request:', error);
    res.status(500).json({ message: 'Failed to create maintenance request' });
  }
};

const updateMaintenanceRequest = async (req, res) => {
  try {
    const request = await MaintenanceRequest.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    )
      .populate('createdBy', 'firstName lastName')
      .populate('completedBy', 'firstName lastName');

    if (!request) {
      return res.status(404).json({ message: 'Maintenance request not found' });
    }

    emitToAll('maintenance:updated', request);

    await logAudit({
      user: req.user,
      action: 'update',
      entity: 'MaintenanceRequest',
      entityId: request._id,
      changes: req.body,
      ipAddress: req.ip,
    });

    res.json(request);
  } catch (error) {
    console.error('Error updating maintenance request:', error);
    res.status(500).json({ message: 'Failed to update maintenance request' });
  }
};

const completeMaintenanceRequest = async (req, res) => {
  try {
    const request = await MaintenanceRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ message: 'Maintenance request not found' });
    }

    if (request.status === 'completed') {
      return res.status(400).json({ message: 'Maintenance request already completed' });
    }

    const endTime = new Date();
    const duration = Math.round((endTime - request.startTime) / 60000); // minutes

    request.status = 'completed';
    request.endTime = endTime;
    request.duration = duration;
    request.completedBy = req.user._id;
    if (req.body.workDescription) request.workDescription = req.body.workDescription;
    if (req.body.technicianName) request.technicianName = req.body.technicianName;
    if (req.body.notes) request.notes = req.body.notes;

    await request.save();

    const populated = await MaintenanceRequest.findById(request._id)
      .populate('createdBy', 'firstName lastName')
      .populate('completedBy', 'firstName lastName');

    emitToAll('maintenance:completed', populated);

    await logAudit({
      user: req.user,
      action: 'complete',
      entity: 'MaintenanceRequest',
      entityId: request._id,
      changes: { status: 'completed', duration },
      ipAddress: req.ip,
    });

    res.json(populated);
  } catch (error) {
    console.error('Error completing maintenance request:', error);
    res.status(500).json({ message: 'Failed to complete maintenance request' });
  }
};

const deleteMaintenanceRequest = async (req, res) => {
  try {
    const request = await MaintenanceRequest.findByIdAndDelete(req.params.id);
    if (!request) {
      return res.status(404).json({ message: 'Maintenance request not found' });
    }

    emitToAll('maintenance:deleted', { _id: req.params.id });

    await logAudit({
      user: req.user,
      action: 'delete',
      entity: 'MaintenanceRequest',
      entityId: req.params.id,
      changes: { vehicleNumber: request.vehicleNumber },
      ipAddress: req.ip,
    });

    res.json({ message: 'Maintenance request deleted' });
  } catch (error) {
    console.error('Error deleting maintenance request:', error);
    res.status(500).json({ message: 'Failed to delete maintenance request' });
  }
};

// ═══════════════════════════════════════════════════════════
// PURCHASE REQUESTS
// ═══════════════════════════════════════════════════════════

const getPurchaseRequests = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [requests, total] = await Promise.all([
      WorkshopPurchaseRequest.find(filter)
        .populate('requestedBy', 'firstName lastName')
        .populate('receivedBy', 'firstName lastName')
        .populate('fulfilledBy', 'firstName lastName')
        .populate('maintenanceRequest', 'vehicleNumber status')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      WorkshopPurchaseRequest.countDocuments(filter),
    ]);

    // Transform to include flat fields the frontend expects
    const purchases = requests.map(r => ({
      ...r,
      vehicleNumber: r.vehicleNumber || r.maintenanceRequest?.vehicleNumber || '-',
      requestedByName: r.requestedBy
        ? `${r.requestedBy.firstName || ''} ${r.requestedBy.lastName || ''}`.trim()
        : '',
      date: r.createdAt,
      maintenanceId: r.maintenanceRequest?._id || r.maintenanceRequest || null,
    }));

    res.json({
      purchases,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    console.error('Error fetching purchase requests:', error);
    res.status(500).json({ message: 'Failed to fetch purchase requests' });
  }
};

const createPurchaseRequest = async (req, res) => {
  try {
    const fullUser = await User.findById(req.user._id).select('branch');
    const branch = fullUser?.branch || req.user.branch;

    const data = {
      ...req.body,
      status: 'pending',
      requestedBy: req.user._id,
      branch,
    };

    // If linked to maintenance, auto-fill vehicleNumber if not provided
    if (data.maintenanceRequest && !data.vehicleNumber) {
      const mr = await MaintenanceRequest.findById(data.maintenanceRequest).select('vehicleNumber');
      if (mr) data.vehicleNumber = mr.vehicleNumber;
    }

    const request = await WorkshopPurchaseRequest.create(data);

    // If linked to a maintenance request part, update the part reference
    if (data.maintenanceRequest && data.partIndex !== undefined) {
      await MaintenanceRequest.findByIdAndUpdate(
        data.maintenanceRequest,
        {
          $set: {
            [`partsNeeded.${data.partIndex}.sentToPurchasing`]: true,
            [`partsNeeded.${data.partIndex}.purchaseRequestId`]: request._id,
          },
        }
      );
    }

    const populated = await WorkshopPurchaseRequest.findById(request._id)
      .populate('requestedBy', 'firstName lastName')
      .populate('maintenanceRequest', 'vehicleNumber status');

    emitToAll('purchase:created', populated);

    await logAudit({
      user: req.user,
      action: 'create',
      entity: 'WorkshopPurchaseRequest',
      entityId: request._id,
      changes: { itemName: data.itemName, quantity: data.quantity },
      ipAddress: req.ip,
    });

    res.status(201).json(populated);
  } catch (error) {
    console.error('Error creating purchase request:', error);
    res.status(500).json({ message: 'Failed to create purchase request' });
  }
};

const receivePurchaseRequest = async (req, res) => {
  try {
    const request = await WorkshopPurchaseRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ message: 'Purchase request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ message: 'Purchase request is not in pending status' });
    }

    request.status = 'received';
    request.receivedAt = new Date();
    request.receivedBy = req.user._id;
    await request.save();

    const populated = await WorkshopPurchaseRequest.findById(request._id)
      .populate('requestedBy', 'firstName lastName')
      .populate('receivedBy', 'firstName lastName')
      .populate('maintenanceRequest', 'vehicleNumber status');

    emitToAll('purchase:received', populated);

    await logAudit({
      user: req.user,
      action: 'receive',
      entity: 'WorkshopPurchaseRequest',
      entityId: request._id,
      changes: { status: 'received' },
      ipAddress: req.ip,
    });

    res.json(populated);
  } catch (error) {
    console.error('Error receiving purchase request:', error);
    res.status(500).json({ message: 'Failed to receive purchase request' });
  }
};

const fulfillPurchaseRequest = async (req, res) => {
  try {
    const request = await WorkshopPurchaseRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ message: 'Purchase request not found' });
    }

    if (request.status !== 'received') {
      return res.status(400).json({ message: 'Purchase request must be received before fulfillment' });
    }

    request.status = 'fulfilled';
    request.fulfilledAt = new Date();
    request.fulfilledBy = req.user._id;
    if (req.body.cost !== undefined) request.cost = req.body.cost;
    if (req.body.supplier) request.supplier = req.body.supplier;
    if (req.body.invoiceNumber) request.invoiceNumber = req.body.invoiceNumber;
    if (req.body.fulfillmentNotes) request.fulfillmentNotes = req.body.fulfillmentNotes;
    await request.save();

    const populated = await WorkshopPurchaseRequest.findById(request._id)
      .populate('requestedBy', 'firstName lastName')
      .populate('receivedBy', 'firstName lastName')
      .populate('fulfilledBy', 'firstName lastName')
      .populate('maintenanceRequest', 'vehicleNumber status');

    emitToAll('purchase:fulfilled', populated);

    await logAudit({
      user: req.user,
      action: 'fulfill',
      entity: 'WorkshopPurchaseRequest',
      entityId: request._id,
      changes: { status: 'fulfilled', cost: req.body.cost, supplier: req.body.supplier },
      ipAddress: req.ip,
    });

    res.json(populated);
  } catch (error) {
    console.error('Error fulfilling purchase request:', error);
    res.status(500).json({ message: 'Failed to fulfill purchase request' });
  }
};

// ═══════════════════════════════════════════════════════════
// WORKSHOP TASKS
// ═══════════════════════════════════════════════════════════

const getWorkshopTasks = async (req, res) => {
  try {
    const { status, priority, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (priority) filter.priority = priority;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [tasks, total] = await Promise.all([
      WorkshopTask.find(filter)
        .populate('assignedTo', 'firstName lastName')
        .populate('createdBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      WorkshopTask.countDocuments(filter),
    ]);

    res.json({
      tasks,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    console.error('Error fetching workshop tasks:', error);
    res.status(500).json({ message: 'Failed to fetch workshop tasks' });
  }
};

const getMyWorkshopTasks = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = { assignedTo: req.user._id };

    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [tasks, total] = await Promise.all([
      WorkshopTask.find(filter)
        .populate('assignedTo', 'firstName lastName')
        .populate('createdBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      WorkshopTask.countDocuments(filter),
    ]);

    res.json({
      tasks,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    console.error('Error fetching my workshop tasks:', error);
    res.status(500).json({ message: 'Failed to fetch your workshop tasks' });
  }
};

const createWorkshopTask = async (req, res) => {
  try {
    const fullUser = await User.findById(req.user._id).select('branch');
    const branch = fullUser?.branch || req.user.branch;

    const data = {
      ...req.body,
      createdBy: req.user._id,
      branch,
    };

    const task = await WorkshopTask.create(data);
    const populated = await WorkshopTask.findById(task._id)
      .populate('assignedTo', 'firstName lastName')
      .populate('createdBy', 'firstName lastName');

    emitToAll('workshopTask:created', populated);

    await logAudit({
      user: req.user,
      action: 'create',
      entity: 'WorkshopTask',
      entityId: task._id,
      changes: { title: data.title, assignedTo: data.assignedTo },
      ipAddress: req.ip,
    });

    res.status(201).json(populated);
  } catch (error) {
    console.error('Error creating workshop task:', error);
    res.status(500).json({ message: 'Failed to create workshop task' });
  }
};

const updateWorkshopTaskStatus = async (req, res) => {
  try {
    const { status, completionNotes } = req.body;
    const update = { status };

    if (status === 'completed') {
      update.completedAt = new Date();
      if (completionNotes) update.completionNotes = completionNotes;
    }

    const task = await WorkshopTask.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: true }
    )
      .populate('assignedTo', 'firstName lastName')
      .populate('createdBy', 'firstName lastName');

    if (!task) {
      return res.status(404).json({ message: 'Workshop task not found' });
    }

    emitToAll('workshopTask:updated', task);

    await logAudit({
      user: req.user,
      action: 'updateStatus',
      entity: 'WorkshopTask',
      entityId: task._id,
      changes: { status },
      ipAddress: req.ip,
    });

    res.json(task);
  } catch (error) {
    console.error('Error updating workshop task status:', error);
    res.status(500).json({ message: 'Failed to update workshop task status' });
  }
};

const deleteWorkshopTask = async (req, res) => {
  try {
    const task = await WorkshopTask.findByIdAndDelete(req.params.id);
    if (!task) {
      return res.status(404).json({ message: 'Workshop task not found' });
    }

    emitToAll('workshopTask:deleted', { _id: req.params.id });

    await logAudit({
      user: req.user,
      action: 'delete',
      entity: 'WorkshopTask',
      entityId: req.params.id,
      changes: { title: task.title },
      ipAddress: req.ip,
    });

    res.json({ message: 'Workshop task deleted' });
  } catch (error) {
    console.error('Error deleting workshop task:', error);
    res.status(500).json({ message: 'Failed to delete workshop task' });
  }
};

// ═══════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════

const getWorkshopDashboard = async (req, res) => {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const [
      maintenanceByStatus,
      avgDurationResult,
      requestsPerDayAgg,
      durationTrendAgg,
      recentMaintenance,
      recentPurchases,
      pendingPurchases,
      totalMaintenanceCount,
    ] = await Promise.all([
      // Maintenance counts by status
      MaintenanceRequest.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      // Average maintenance duration (completed only)
      MaintenanceRequest.aggregate([
        { $match: { status: 'completed', duration: { $exists: true, $ne: null } } },
        { $group: { _id: null, avgDuration: { $avg: '$duration' } } },
      ]),
      // Requests per day (last 7 days)
      MaintenanceRequest.aggregate([
        { $match: { createdAt: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // Duration trend (last 7 days, completed only)
      MaintenanceRequest.aggregate([
        {
          $match: {
            status: 'completed',
            duration: { $exists: true, $ne: null },
            endTime: { $gte: sevenDaysAgo },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$endTime' } },
            avgMinutes: { $avg: '$duration' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // Recent maintenance (last 10)
      MaintenanceRequest.find()
        .populate('createdBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      // Recent purchases (last 10)
      WorkshopPurchaseRequest.find()
        .populate('requestedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      // Pending purchases list
      WorkshopPurchaseRequest.find({ status: 'pending' })
        .sort({ createdAt: -1 })
        .lean(),
      // Total maintenance count
      MaintenanceRequest.countDocuments(),
    ]);

    // Build status counts map
    const statusMap = {};
    maintenanceByStatus.forEach(({ _id, count }) => { statusMap[_id] = count; });

    // Pending purchase count from status aggregation
    const pendingPurchaseCount = await WorkshopPurchaseRequest.countDocuments({ status: 'pending' });

    // KPIs
    const kpis = {
      totalRequests: totalMaintenanceCount,
      open: statusMap.open || 0,
      inProgress: statusMap.in_progress || 0,
      completed: statusMap.completed || 0,
      avgDuration: avgDurationResult[0]?.avgDuration
        ? Math.round(avgDurationResult[0].avgDuration)
        : 0,
      pendingPurchases: pendingPurchaseCount,
    };

    // Fill in missing days for requestsPerDay
    const requestsPerDayMap = {};
    requestsPerDayAgg.forEach(({ _id, count }) => { requestsPerDayMap[_id] = count; });
    const requestsPerDay = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      requestsPerDay.push({ date: key, count: requestsPerDayMap[key] || 0 });
    }

    // Fill in missing days for durationTrend
    const durationTrendMap = {};
    durationTrendAgg.forEach(({ _id, avgMinutes }) => { durationTrendMap[_id] = Math.round(avgMinutes); });
    const durationTrend = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      durationTrend.push({ date: key, avgMinutes: durationTrendMap[key] || 0 });
    }

    // Status distribution
    const statusDistribution = ['open', 'in_progress', 'completed'].map(status => ({
      status,
      count: statusMap[status] || 0,
    }));

    // Merge recent activity: maintenance + purchases, sorted by date
    const mergedActivity = [];
    recentMaintenance.forEach(m => {
      const userName = m.createdBy
        ? `${m.createdBy.firstName || ''} ${m.createdBy.lastName || ''}`.trim()
        : '';
      mergedActivity.push({
        _id: m._id.toString(),
        action: 'maintenance',
        description: `Maintenance ${m.status}: ${m.vehicleNumber}${m.workDescription ? ' - ' + m.workDescription : ''}`,
        createdAt: m.createdAt,
        user: userName,
      });
    });
    recentPurchases.forEach(p => {
      const userName = p.requestedBy
        ? `${p.requestedBy.firstName || ''} ${p.requestedBy.lastName || ''}`.trim()
        : '';
      mergedActivity.push({
        _id: p._id.toString(),
        action: 'purchase',
        description: `Purchase ${p.status}: ${p.itemName} (x${p.quantity})${p.vehicleNumber ? ' for ' + p.vehicleNumber : ''}`,
        createdAt: p.createdAt,
        user: userName,
      });
    });
    mergedActivity.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const recentActivity = mergedActivity.slice(0, 10);

    // Pending purchases list
    const pendingPurchasesList = pendingPurchases.map(p => ({
      _id: p._id.toString(),
      itemName: p.itemName,
      quantity: p.quantity,
      vehicleNumber: p.vehicleNumber || '',
      date: p.createdAt,
    }));

    res.json({
      kpis,
      requestsPerDay,
      durationTrend,
      statusDistribution,
      recentActivity,
      pendingPurchasesList,
    });
  } catch (error) {
    console.error('Error fetching workshop dashboard:', error);
    res.status(500).json({ message: 'Failed to fetch workshop dashboard' });
  }
};

module.exports = {
  // Maintenance
  getMaintenanceRequests,
  getMaintenanceRequest,
  createMaintenanceRequest,
  updateMaintenanceRequest,
  completeMaintenanceRequest,
  deleteMaintenanceRequest,
  // Purchase
  getPurchaseRequests,
  createPurchaseRequest,
  receivePurchaseRequest,
  fulfillPurchaseRequest,
  // Tasks
  getWorkshopTasks,
  getMyWorkshopTasks,
  createWorkshopTask,
  updateWorkshopTaskStatus,
  deleteWorkshopTask,
  // Dashboard
  getWorkshopDashboard,
};
