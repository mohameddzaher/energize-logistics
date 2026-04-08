const MaintenanceRequest = require('../models/MaintenanceRequest');
const WorkshopPurchaseRequest = require('../models/WorkshopPurchaseRequest');
const WorkshopTask = require('../models/WorkshopTask');
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
    const [requests, total] = await Promise.all([
      MaintenanceRequest.find(filter)
        .populate('createdBy', 'firstName lastName')
        .populate('completedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      MaintenanceRequest.countDocuments(filter),
    ]);

    res.json({
      requests,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
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
    const data = {
      ...req.body,
      startTime: new Date(),
      status: 'open',
      createdBy: req.user._id,
      branch: req.user.branch,
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
        .limit(parseInt(limit)),
      WorkshopPurchaseRequest.countDocuments(filter),
    ]);

    res.json({
      requests,
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
    const data = {
      ...req.body,
      status: 'pending',
      requestedBy: req.user._id,
      branch: req.user.branch,
    };

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
    const data = {
      ...req.body,
      createdBy: req.user._id,
      branch: req.user.branch,
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
    const [
      maintenanceByStatus,
      purchaseByStatus,
      tasksByStatus,
      avgDurationResult,
      recentMaintenance,
      recentPurchases,
    ] = await Promise.all([
      // Maintenance counts by status
      MaintenanceRequest.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      // Purchase counts by status
      WorkshopPurchaseRequest.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      // Task counts by status
      WorkshopTask.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      // Average maintenance duration (completed only)
      MaintenanceRequest.aggregate([
        { $match: { status: 'completed', duration: { $exists: true, $ne: null } } },
        { $group: { _id: null, avgDuration: { $avg: '$duration' } } },
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
    ]);

    // Count active (non-completed) unique vehicles
    const activeVehicles = await MaintenanceRequest.distinct('vehicleNumber', {
      status: { $in: ['open', 'in_progress'] },
    });

    // Transform aggregation results to objects
    const toStatusMap = (arr) => arr.reduce((acc, { _id, count }) => {
      acc[_id] = count;
      return acc;
    }, {});

    res.json({
      maintenance: toStatusMap(maintenanceByStatus),
      purchases: toStatusMap(purchaseByStatus),
      tasks: toStatusMap(tasksByStatus),
      avgMaintenanceDuration: avgDurationResult[0]?.avgDuration
        ? Math.round(avgDurationResult[0].avgDuration)
        : 0,
      activeVehicleCount: activeVehicles.length,
      pendingPurchaseCount: purchaseByStatus.find(s => s._id === 'pending')?.count || 0,
      recentActivity: {
        maintenance: recentMaintenance,
        purchases: recentPurchases,
      },
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
