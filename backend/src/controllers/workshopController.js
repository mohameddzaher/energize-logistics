const MaintenanceRequest = require('../models/MaintenanceRequest');
const WorkshopPurchaseRequest = require('../models/WorkshopPurchaseRequest');
const WorkshopTask = require('../models/WorkshopTask');
const InventoryItem = require('../models/InventoryItem');
const InventoryIssue = require('../models/InventoryIssue');
// The workshop is the shop floor for the Location Solutions fleet — the tires,
// flatbeds and trailers it fits and removes are the SAME registry the ls2
// section tracks. Reading those models here (never writing them: mount/move
// stays in ls2AssetsController, which owns the event trail) is what lets the
// store screen answer "where is this piece right now" in one place.
const Ls2TireAsset = require('../models/Ls2TireAsset');
const Ls2Flatbed = require('../models/Ls2Flatbed');
const Ls2Trailer = require('../models/Ls2Trailer');
const Ls2Vehicle = require('../models/Ls2Vehicle');
const { vehiclePlateKey } = require('../utils/plateKey');
const Technician = require('../models/Technician');
const MaintenanceType = require('../models/MaintenanceType');
const User = require('../models/User');
const socket = require('../websocket/socketManager');
const cache = require('../utils/ttlCache');
// Wrap emit so every workshop mutation also drops the cached dashboard (`ws:`).
const emitToAll = (event, payload) => { try { socket.emitToAll(event, payload); } catch (e) {} cache.clear('ws:'); };
const WS_DASH_TTL = 30 * 1000;
const logAudit = require('../utils/auditLogger');

// Item names are user text and go into a RegExp when matching an existing line.
const escapeRx = (str) => String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ═══════════════════════════════════════════════════════════
// MAINTENANCE REQUESTS
// ═══════════════════════════════════════════════════════════

const getMaintenanceRequests = async (req, res) => {
  try {
    const { status, vehicleNumber, search, dateFrom, dateTo, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (vehicleNumber) filter.vehicleNumber = new RegExp(vehicleNumber, 'i');
    if (search) {
      const regex = new RegExp(search, 'i');
      filter.$or = [
        { vehicleNumber: regex },
        { technicianName: regex },
        { driverName: regex },
        { vehicleType: regex },
      ];
    }
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
        .limit(parseInt(limit))
        .lean(),
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
      .populate('branch', 'name')
      .lean();

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
    // Validate required fields - only vehicleNumber is truly required
    if (!req.body.vehicleNumber || !req.body.vehicleNumber.trim()) {
      return res.status(400).json({ message: 'Vehicle number is required' });
    }

    const data = {
      vehicleNumber: req.body.vehicleNumber.trim(),
      vehicleType: req.body.vehicleType || '',
      driverName: req.body.driverName || '',
      technicianName: req.body.technicianName || '',
      notes: req.body.notes || '',
      startTime: new Date(),
      status: 'open',
      createdBy: req.user._id,
    };
    if (req.user.branch) data.branch = req.user.branch;

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
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ message: messages.join('. ') });
    }
    res.status(500).json({ message: 'Failed to create maintenance request. Please try again.' });
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
    const { status, maintenanceRequest, search, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (maintenanceRequest) filter.maintenanceRequest = maintenanceRequest;
    if (search) {
      const regex = new RegExp(search, 'i');
      filter.$or = [
        { itemName: regex },
        { vehicleNumber: regex },
        { supplier: regex },
        { invoiceNumber: regex },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [requests, total] = await Promise.all([
      WorkshopPurchaseRequest.find(filter)
        .populate('requestedBy', 'firstName lastName')
        .populate('receivedBy', 'firstName lastName')
        .populate('fulfilledBy', 'firstName lastName')
        .populate('maintenanceRequest', 'vehicleNumber status')
        // The stock line this delivery landed in, so the list can link straight
        // to it instead of leaving people to guess whether it ever arrived.
        .populate('inventoryItem', 'code name quantity unit')
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

// Whitelisted rather than spread — otherwise a caller can set its own status,
// requestedBy or inventoryItem and walk straight past the receive flow.
const PURCHASE_EDITABLE = [
  'itemName', 'quantity', 'description', 'vehicleNumber',
  'maintenanceRequest', 'partIndex', 'supplier', 'cost', 'invoiceNumber',
];

const createPurchaseRequest = async (req, res) => {
  try {
    const data = {};
    PURCHASE_EDITABLE.forEach((f) => { if (req.body[f] !== undefined && req.body[f] !== '') data[f] = req.body[f]; });
    data.status = 'pending';
    data.requestedBy = req.user._id;
    if (req.user.branch) data.branch = req.user.branch;

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

    // Goods have ARRIVED, so the store gains them. This used to subtract, which
    // is the wrong end of the flow: a purchase adds to stock when it is received
    // and only leaves stock when it is issued to a job (see fulfil below). With
    // the old direction nothing in the section ever increased stock at all, so
    // the store could only ever go to zero.
    const { inventoryItemId } = req.body || {};
    const qty = Math.max(1, Number(request.quantity) || 1);
    let invItem = inventoryItemId ? await InventoryItem.findById(inventoryItemId) : null;

    // No existing line to add to — a first-time purchase is exactly how a part
    // enters the catalogue, so create it rather than losing the receipt.
    if (!invItem && !inventoryItemId && request.itemName) {
      // Only ACTIVE lines: a deleted one is invisible on every screen, so adding
      // stock to it would silently swallow the delivery.
      invItem = await InventoryItem.findOne({ name: new RegExp(`^${escapeRx(request.itemName)}$`, 'i'), isActive: true });
      if (!invItem) {
        invItem = await InventoryItem.create({
          code: `WS-${Date.now().toString(36).toUpperCase()}`,
          name: request.itemName,
          category: '',
          quantity: 0,
          unit: 'piece',
          costPrice: request.cost && qty ? Number(request.cost) / qty : 0,
          supplier: request.supplier || '',
          notes: 'أُنشئ تلقائياً عند استلام طلب شراء',
          createdBy: req.user._id,
          approvalStatus: 'approved',
        });
      }
    }

    if (invItem) {
      invItem.quantity = (Number(invItem.quantity) || 0) + qty;
      if (request.supplier && !invItem.supplier) invItem.supplier = request.supplier;
      await invItem.save();
      request.inventoryItem = invItem._id;
      await request.save();
      emitToAll('inventory:updated', invItem);
    }

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
      changes: { status: 'received', inventoryItemId },
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

    // Issued to the job — this is where stock actually leaves the shelf.
    if (request.inventoryItem) {
      const invItem = await InventoryItem.findById(request.inventoryItem);
      if (invItem) {
        const qty = Math.max(1, Number(request.quantity) || 1);
        invItem.quantity = Math.max(0, (Number(invItem.quantity) || 0) - qty);
        await invItem.save();
        emitToAll('inventory:updated', invItem);
      }
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

// Deleting a purchase has to undo whatever it did to stock, or the shelf count
// drifts from reality the moment someone removes a mistaken entry:
//   pending    nothing happened yet          → just remove the record
//   received   the goods were added to stock → take them back out
//   fulfilled  added then issued (net zero)  → stock is already correct
// The last case is the one worth being careful about: subtracting there would
// remove the same units twice.
const deletePurchaseRequest = async (req, res) => {
  try {
    const request = await WorkshopPurchaseRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Purchase request not found' });

    let stockAdjusted = null;
    if (request.status === 'received' && request.inventoryItem) {
      const invItem = await InventoryItem.findById(request.inventoryItem);
      if (invItem) {
        const qty = Math.max(1, Number(request.quantity) || 1);
        invItem.quantity = Math.max(0, (Number(invItem.quantity) || 0) - qty);
        await invItem.save();
        emitToAll('inventory:updated', invItem);
        stockAdjusted = { item: invItem.name, removed: qty, remaining: invItem.quantity };
      }
    }

    await request.deleteOne();
    emitToAll('purchase:deleted', { _id: req.params.id });

    await logAudit({
      user: req.user,
      action: 'delete',
      entity: 'WorkshopPurchaseRequest',
      entityId: req.params.id,
      changes: { itemName: request.itemName, quantity: request.quantity, status: request.status, stockAdjusted },
      ipAddress: req.ip,
    });

    res.json({ message: 'Purchase request deleted', stockAdjusted });
  } catch (error) {
    console.error('Error deleting purchase request:', error);
    res.status(500).json({ message: 'Failed to delete purchase request' });
  }
};

// ═══════════════════════════════════════════════════════════
// WORKSHOP TASKS
// ═══════════════════════════════════════════════════════════

const getWorkshopTasks = async (req, res) => {
  try {
    const { status, priority, search, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (search) {
      const regex = new RegExp(search, 'i');
      filter.$or = [
        { title: regex },
        { description: regex },
        { technicianName: regex },
        { vehicleNumber: regex },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [tasks, total] = await Promise.all([
      WorkshopTask.find(filter)
        .populate('assignedTo', 'firstName lastName role')
        .populate('createdBy', 'firstName lastName')
        .populate('maintenanceType', 'name estimatedDuration')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
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
        .populate('assignedTo', 'firstName lastName role')
        .populate('createdBy', 'firstName lastName')
        .populate('maintenanceType', 'name estimatedDuration')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
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

// Whitelisted rather than spread from req.body — the section's own convention,
// and the only thing stopping a caller from setting createdBy or branch itself.
const WORKSHOP_TASK_EDITABLE = [
  'title', 'description', 'assignedTo', 'technicianName', 'maintenanceType',
  'serviceTypeKey', 'serviceTypeName', 'vehicleNumber', 'priority', 'dueDate',
  'status', 'notes',
];

const createWorkshopTask = async (req, res) => {
  try {
    const data = {};
    WORKSHOP_TASK_EDITABLE.forEach((f) => { if (req.body[f] !== undefined && req.body[f] !== '') data[f] = req.body[f]; });
    data.createdBy = req.user._id;
    if (req.user.branch) data.branch = req.user.branch;

    const task = await WorkshopTask.create(data);
    const populated = await WorkshopTask.findById(task._id)
      .populate('assignedTo', 'firstName lastName role')
      .populate('createdBy', 'firstName lastName')
      .populate('maintenanceType', 'name estimatedDuration');

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
    const hit = cache.get('ws:dashboard');
    if (hit) return res.json(hit);

    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7);
    const lastWeekStart = new Date(); lastWeekStart.setDate(lastWeekStart.getDate() - 14);

    const [
      maintenanceByStatus,
      avgDurationResult,
      requestsPerDayAgg,
      durationTrendAgg,
      recentMaintenance,
      recentPurchases,
      pendingPurchases,
      totalMaintenanceCount,
      pendingPurchaseCount,
      employeeStatsRaw,
      technicianStats,
      topVehicles,
      thisWeek,
      lastWeek,
      lowStockCount,
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
      // Pending purchase count
      WorkshopPurchaseRequest.countDocuments({ status: 'pending' }),
      // Employee performance stats (system users who created requests)
      MaintenanceRequest.aggregate([
        { $match: { status: 'completed' } },
        { $group: {
          _id: '$createdBy',
          totalRequests: { $sum: 1 },
          avgDuration: { $avg: '$duration' },
          completedCount: { $sum: 1 },
        }},
        { $sort: { totalRequests: -1 } },
        { $limit: 20 },
      ]),
      // Technician performance stats
      MaintenanceRequest.aggregate([
        { $match: { status: 'completed', technicianName: { $exists: true, $ne: '' } } },
        { $group: {
          _id: '$technicianName',
          totalRequests: { $sum: 1 },
          avgDuration: { $avg: '$duration' },
          minDuration: { $min: '$duration' },
          maxDuration: { $max: '$duration' },
        }},
        { $sort: { totalRequests: -1 } },
        { $limit: 20 },
      ]),
      // Top vehicles requiring maintenance
      MaintenanceRequest.aggregate([
        { $group: {
          _id: '$vehicleNumber',
          visits: { $sum: 1 },
          totalDuration: { $sum: '$duration' },
          lastVisit: { $max: '$createdAt' },
        }},
        { $sort: { visits: -1 } },
        { $limit: 10 },
      ]),
      // This week count
      MaintenanceRequest.countDocuments({ createdAt: { $gte: weekStart } }),
      // Last week count
      MaintenanceRequest.countDocuments({ createdAt: { $gte: lastWeekStart, $lt: weekStart } }),
      // Inventory low stock alert
      InventoryItem.countDocuments({
        isActive: true,
        $expr: { $lte: ['$quantity', '$minQuantity'] },
      }),
    ]);

    // Employee stats needs User lookup (done after Promise.all to avoid N+1)
    const employeeStats = employeeStatsRaw;
    const empUserIds = employeeStats.map(s => s._id).filter(Boolean);
    const empUsers = await User.find({ _id: { $in: empUserIds } }).select('firstName lastName').lean();
    const empUserMap = Object.fromEntries(empUsers.map(u => [u._id.toString(), u]));
    for (const stat of employeeStats) {
      const u = stat._id ? empUserMap[stat._id.toString()] : null;
      stat.employeeName = u ? `${u.firstName} ${u.lastName}` : 'Unknown';
    }

    // Build status counts map
    const statusMap = {};
    maintenanceByStatus.forEach(({ _id, count }) => { statusMap[_id] = count; });

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

    const weekChange = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : 0;

    const payload = {
      kpis,
      requestsPerDay,
      durationTrend,
      statusDistribution,
      recentActivity,
      pendingPurchasesList,
      employeeStats,
      technicianStats,
      topVehicles,
      weekComparison: { thisWeek, lastWeek, change: weekChange },
      lowStockCount,
    };
    cache.set('ws:dashboard', payload, WS_DASH_TTL);
    res.json(payload);
  } catch (error) {
    console.error('Error fetching workshop dashboard:', error);
    res.status(500).json({ message: 'Failed to fetch workshop dashboard' });
  }
};

// ═══════════════════════════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════════════════════════

const getInventory = async (req, res) => {
  try {
    const { search, category, approvalStatus, page = 1, limit = 20 } = req.query;
    const filter = { isActive: true };

    // Managers see all, others see only approved
    const isManager = ['super_admin', 'workshop_manager'].includes(req.user.role);
    if (approvalStatus) {
      filter.approvalStatus = approvalStatus;
    } else if (!isManager) {
      filter.approvalStatus = 'approved';
    }

    if (search) {
      const regex = new RegExp(search, 'i');
      filter.$or = [{ name: regex }, { code: regex }];
    }
    if (category) filter.category = category;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [items, total] = await Promise.all([
      InventoryItem.find(filter)
        .populate('createdBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      InventoryItem.countDocuments(filter),
    ]);

    // Add lowStock flag
    const enriched = items.map(item => ({
      ...item,
      lowStock: item.quantity <= item.minQuantity,
    }));

    res.json({
      items: enriched,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    console.error('Error fetching inventory:', error);
    res.status(500).json({ message: 'Failed to fetch inventory' });
  }
};

const createInventoryItem = async (req, res) => {
  try {
    const isManager = ['super_admin', 'workshop_manager'].includes(req.user.role);
    const data = {
      ...req.body,
      createdBy: req.user._id,
      approvalStatus: isManager ? 'approved' : 'pending',
    };
    if (isManager) {
      data.approvedBy = req.user._id;
      data.approvedAt = new Date();
    }
    if (req.user.branch) data.branch = req.user.branch;

    const item = await InventoryItem.create(data);
    const populated = await InventoryItem.findById(item._id)
      .populate('createdBy', 'firstName lastName');

    emitToAll('inventory:created', populated);

    await logAudit({
      user: req.user,
      action: 'create',
      entity: 'InventoryItem',
      entityId: item._id,
      changes: { code: data.code, name: data.name },
      ipAddress: req.ip,
    });

    res.status(201).json(populated);
  } catch (error) {
    console.error('Error creating inventory item:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'An item with this code already exists' });
    }
    res.status(500).json({ message: 'Failed to create inventory item' });
  }
};

const updateInventoryItem = async (req, res) => {
  try {
    const item = await InventoryItem.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    ).populate('createdBy', 'firstName lastName');

    if (!item) {
      return res.status(404).json({ message: 'Inventory item not found' });
    }

    emitToAll('inventory:updated', item);

    await logAudit({
      user: req.user,
      action: 'update',
      entity: 'InventoryItem',
      entityId: item._id,
      changes: req.body,
      ipAddress: req.ip,
    });

    res.json(item);
  } catch (error) {
    console.error('Error updating inventory item:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'An item with this code already exists' });
    }
    res.status(500).json({ message: 'Failed to update inventory item' });
  }
};

const deleteInventoryItem = async (req, res) => {
  try {
    const item = await InventoryItem.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: false } },
      { new: true }
    );

    if (!item) {
      return res.status(404).json({ message: 'Inventory item not found' });
    }

    emitToAll('inventory:deleted', { _id: req.params.id });

    await logAudit({
      user: req.user,
      action: 'delete',
      entity: 'InventoryItem',
      entityId: req.params.id,
      changes: { code: item.code, name: item.name },
      ipAddress: req.ip,
    });

    res.json({ message: 'Inventory item deleted' });
  } catch (error) {
    console.error('Error deleting inventory item:', error);
    res.status(500).json({ message: 'Failed to delete inventory item' });
  }
};

const searchInventory = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);

    const regex = new RegExp(q, 'i');
    const items = await InventoryItem.find({
      isActive: true,
      approvalStatus: 'approved',
      $or: [{ name: regex }, { code: regex }],
    })
      .select('name code quantity _id')
      .limit(20)
      .lean();

    res.json(items);
  } catch (error) {
    console.error('Error searching inventory:', error);
    res.status(500).json({ message: 'Failed to search inventory' });
  }
};

// ═══════════════════════════════════════════════════════════
// TECHNICIANS
// ═══════════════════════════════════════════════════════════

const getTechnicians = async (req, res) => {
  try {
    const technicians = await Technician.find({ isActive: true })
      .sort({ name: 1 })
      .lean();
    res.json(technicians);
  } catch (error) {
    console.error('Error fetching technicians:', error);
    res.status(500).json({ message: 'Failed to fetch technicians' });
  }
};

const createTechnician = async (req, res) => {
  try {
    if (!req.body.name || !req.body.name.trim()) {
      return res.status(400).json({ message: 'Technician name is required' });
    }
    const tech = await Technician.create({
      name: req.body.name.trim(),
      phone: req.body.phone || '',
      specialization: req.body.specialization || '',
      notes: req.body.notes || '',
      branch: req.user.branch,
      createdBy: req.user._id,
    });
    emitToAll('technician:created', tech);
    res.status(201).json(tech);
  } catch (error) {
    console.error('Error creating technician:', error);
    res.status(500).json({ message: 'Failed to create technician' });
  }
};

const updateTechnician = async (req, res) => {
  try {
    const tech = await Technician.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );
    if (!tech) return res.status(404).json({ message: 'Technician not found' });
    emitToAll('technician:updated', tech);
    res.json(tech);
  } catch (error) {
    console.error('Error updating technician:', error);
    res.status(500).json({ message: 'Failed to update technician' });
  }
};

const deleteTechnician = async (req, res) => {
  try {
    const tech = await Technician.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: false } },
      { new: true }
    );
    if (!tech) return res.status(404).json({ message: 'Technician not found' });
    emitToAll('technician:deleted', { _id: req.params.id });
    res.json({ message: 'Technician deleted' });
  } catch (error) {
    console.error('Error deleting technician:', error);
    res.status(500).json({ message: 'Failed to delete technician' });
  }
};

// ═══════════════════════════════════════════════════════════
// INVENTORY APPROVAL
// ═══════════════════════════════════════════════════════════

const approveInventoryItem = async (req, res) => {
  try {
    const { status, note } = req.body; // status = 'approved' or 'rejected'
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Status must be approved or rejected' });
    }

    const item = await InventoryItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Inventory item not found' });

    item.approvalStatus = status;
    item.approvedBy = req.user._id;
    item.approvedAt = new Date();
    if (note) item.approvalNote = note;
    await item.save();

    const populated = await InventoryItem.findById(item._id)
      .populate('createdBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName')
      .lean();

    emitToAll('inventory:updated', populated);

    await logAudit({
      user: req.user,
      action: `inventory_${status}`,
      entity: 'InventoryItem',
      entityId: item._id,
      changes: { approvalStatus: status, note },
      ipAddress: req.ip,
    });

    res.json(populated);
  } catch (error) {
    console.error('Error approving inventory item:', error);
    res.status(500).json({ message: 'Failed to update inventory approval' });
  }
};

// ═══════════════════════════════════════════════════════════
// MAINTENANCE TYPES
// ═══════════════════════════════════════════════════════════

const getMaintenanceTypes = async (req, res) => {
  try {
    const types = await MaintenanceType.find({ isActive: true }).sort({ name: 1 }).lean();
    res.json(types);
  } catch (error) {
    console.error('Error fetching maintenance types:', error);
    res.status(500).json({ message: 'Failed to fetch maintenance types' });
  }
};

const createMaintenanceType = async (req, res) => {
  try {
    if (!req.body.name || !req.body.name.trim()) {
      return res.status(400).json({ message: 'Maintenance type name is required' });
    }
    const type = await MaintenanceType.create({
      name: req.body.name.trim(),
      description: req.body.description || '',
      estimatedDuration: req.body.estimatedDuration || undefined,
      createdBy: req.user._id,
    });
    emitToAll('maintenanceType:created', type);
    res.status(201).json(type);
  } catch (error) {
    console.error('Error creating maintenance type:', error);
    res.status(500).json({ message: 'Failed to create maintenance type' });
  }
};

const updateMaintenanceType = async (req, res) => {
  try {
    const type = await MaintenanceType.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );
    if (!type) return res.status(404).json({ message: 'Maintenance type not found' });
    emitToAll('maintenanceType:updated', type);
    res.json(type);
  } catch (error) {
    console.error('Error updating maintenance type:', error);
    res.status(500).json({ message: 'Failed to update maintenance type' });
  }
};

const deleteMaintenanceType = async (req, res) => {
  try {
    const type = await MaintenanceType.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: false } },
      { new: true }
    );
    if (!type) return res.status(404).json({ message: 'Maintenance type not found' });
    emitToAll('maintenanceType:deleted', { _id: req.params.id });
    res.json({ message: 'Maintenance type deleted' });
  } catch (error) {
    console.error('Error deleting maintenance type:', error);
    res.status(500).json({ message: 'Failed to delete maintenance type' });
  }
};

// ═══════════════════════════════════════════════════════════
// WORKSHOP USERS (filtered by role)
// ═══════════════════════════════════════════════════════════

const getWorkshopUsers = async (req, res) => {
  try {
    const users = await User.find({
      role: { $in: ['workshop_manager', 'workshop_employee', 'purchasing'] },
      isActive: true,
    })
      .select('firstName lastName email role')
      .sort({ firstName: 1 })
      .lean();
    res.json(users);
  } catch (error) {
    console.error('Error fetching workshop users:', error);
    res.status(500).json({ message: 'Failed to fetch workshop users' });
  }
};


// ═══════════════════════════════════════════════════════════
// ISSUES (الصرف) — parts leaving the shelf onto a vehicle
// ═══════════════════════════════════════════════════════════

// Take N units of a part off the shelf and record where they went. This is what
// makes the installed-vs-stock question answerable for consumables: the line
// keeps the on-shelf count, the issue rows keep the "gone onto vehicle X" side.
const issueInventoryItem = async (req, res) => {
  try {
    const { quantity, vehicleNumber, notes, date } = req.body || {};
    const qty = Math.max(1, Number(quantity) || 1);

    const item = await InventoryItem.findById(req.params.id);
    if (!item || item.isActive === false) {
      return res.status(404).json({ message: 'Inventory item not found' });
    }
    // Refusing beats clamping: issuing 5 of 3 means the register is already
    // wrong, and papering over it here would hide that.
    if ((Number(item.quantity) || 0) < qty) {
      return res.status(400).json({ message: `Only ${item.quantity} in stock` });
    }

    item.quantity = (Number(item.quantity) || 0) - qty;
    await item.save();

    const issue = await InventoryIssue.create({
      item: item._id,
      itemName: item.name,
      itemCode: item.code,
      quantity: qty,
      vehicleNumber: String(vehicleNumber || '').trim(),
      notes: String(notes || '').trim(),
      date: date || new Date().toISOString().slice(0, 10),
      issuedBy: req.user._id,
    });

    emitToAll('inventory:updated', item);

    await logAudit({
      user: req.user,
      action: 'issue',
      entity: 'InventoryItem',
      entityId: item._id,
      changes: { name: item.name, quantity: qty, vehicleNumber: issue.vehicleNumber, remaining: item.quantity },
      ipAddress: req.ip,
    });

    res.status(201).json({ issue, item });
  } catch (error) {
    console.error('Error issuing inventory item:', error);
    res.status(500).json({ message: 'Failed to issue inventory item' });
  }
};

const listInventoryIssues = async (req, res) => {
  try {
    const { item, vehicleNumber, search, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (item) filter.item = item;
    if (vehicleNumber) filter.vehicleNumber = new RegExp(String(vehicleNumber).trim(), 'i');
    if (search) {
      const rx = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ itemName: rx }, { itemCode: rx }, { vehicleNumber: rx }, { notes: rx }];
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [issues, total] = await Promise.all([
      InventoryIssue.find(filter)
        .populate('issuedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      InventoryIssue.countDocuments(filter),
    ]);
    res.json({ issues, total });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load issues' });
  }
};

// Undo a mistaken issue: the units go back on the shelf and the row disappears.
// Manager-only, because it moves stock.
const deleteInventoryIssue = async (req, res) => {
  try {
    const issue = await InventoryIssue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue record not found' });

    const item = await InventoryItem.findById(issue.item);
    if (item) {
      item.quantity = (Number(item.quantity) || 0) + issue.quantity;
      await item.save();
      emitToAll('inventory:updated', item);
    }
    await issue.deleteOne();

    await logAudit({
      user: req.user,
      action: 'unissue',
      entity: 'InventoryItem',
      entityId: issue.item,
      changes: { name: issue.itemName, quantity: issue.quantity, vehicleNumber: issue.vehicleNumber },
      ipAddress: req.ip,
    });

    res.json({ message: 'Issue reversed', item });
  } catch (error) {
    res.status(500).json({ message: 'Failed to reverse the issue' });
  }
};

// ═══════════════════════════════════════════════════════════
// STORE (المستودع) — everything the workshop holds, and where it is
// ═══════════════════════════════════════════════════════════

// One screen answering: what do we have, how many, and for each piece — is it
// fitted to a vehicle (which one, which position) or sitting on the shelf.
//
// Two very different things live side by side here on purpose:
//   · serial-tracked fleet assets (tires, flatbeds, trailers) — each is ONE
//     physical object with a location, so "3 tires" means three serials;
//   · consumable spare parts (InventoryItem) — counted in units, not tracked
//     individually, so "3 filters" is one line with quantity 3.
// Reporting them as one number would be meaningless, so the summary keeps them
// apart and the UI shows them on separate tabs.
const getWorkshopStore = async (req, res) => {
  try {
    const [tires, flatbeds, trailers, parts, vehicles] = await Promise.all([
      Ls2TireAsset.find({}).sort({ status: 1, plateKey: 1, positionNumber: 1 }).lean(),
      Ls2Flatbed.find({}).sort({ numbering: 1 }).lean(),
      Ls2Trailer.find({}).sort({ trailerNumber: 1 }).lean(),
      InventoryItem.find({ isActive: { $ne: false } }).sort({ category: 1, name: 1 }).lean(),
      Ls2Vehicle.find({}).select('name plate profile.brand').lean(),
    ]);

    // Fitted assets store a plate string; the readable vehicle name lives on the
    // live mirror, so join them here rather than making the client do it.
    // Ls2Vehicle does NOT store plateKey — it is derived from the plate/name on
    // read, which is why this goes through the shared helper.
    const vehicleByKey = new Map();
    vehicles.forEach((v) => {
      const k = vehiclePlateKey(v);
      if (k) vehicleByKey.set(k, v);
    });
    const vehicleName = (key) => {
      const v = vehicleByKey.get(key);
      return v ? (v.name || v.plate || '') : '';
    };

    const count = (rows, key) => rows.reduce((m, r) => {
      const k = r[key] || 'unknown';
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {});

    const tireStatus = count(tires, 'status');
    const trailerStatus = count(trailers, 'status');

    // A part is "low" when it has a floor set and has fallen to or below it —
    // a floor of 0 means nobody set one, so it never triggers.
    const lowParts = parts.filter((p) => (p.minQuantity || 0) > 0 && (p.quantity || 0) <= p.minQuantity);
    const outOfStock = parts.filter((p) => (p.quantity || 0) <= 0);

    res.json({
      summary: {
        tires: {
          total: tires.length,
          mounted: tireStatus.mounted || 0,
          spare: tireStatus.spare || 0,
          inRepair: tireStatus.in_repair || 0,
          retired: tireStatus.retired || 0,
          withSensor: tires.filter((t) => t.sensor === 'yes').length,
        },
        flatbeds: {
          total: flatbeds.length,
          hitched: flatbeds.filter((f) => f.currentTrailerNumber).length,
        },
        trailers: {
          total: trailers.length,
          fitted: trailers.filter((t) => t.currentPlateKey).length,
          spare: trailerStatus.spare || 0,
          retired: trailerStatus.retired || 0,
        },
        parts: {
          lines: parts.length,
          units: parts.reduce((s, p) => s + (p.quantity || 0), 0),
          low: lowParts.length,
          outOfStock: outOfStock.length,
          value: parts.reduce((s, p) => s + (p.quantity || 0) * (p.costPrice || 0), 0),
        },
      },
      tires: tires.map((t) => ({
        ...t,
        // `fitted` is the one field the screen actually sorts and filters on:
        // it is the difference between "on the road" and "on the shelf".
        fitted: t.status === 'mounted' && !!t.plateKey,
        vehicleName: t.plateKey ? vehicleName(t.plateKey) : '',
      })),
      flatbeds: flatbeds.map((f) => ({ ...f, vehicleName: vehicleName(f.plateKey) })),
      trailers: trailers.map((t) => ({
        ...t,
        fitted: !!t.currentPlateKey,
        vehicleName: t.currentPlateKey ? vehicleName(t.currentPlateKey) : '',
      })),
      parts: parts.map((p) => ({
        ...p,
        isLow: (p.minQuantity || 0) > 0 && (p.quantity || 0) <= p.minQuantity,
        totalValue: (p.quantity || 0) * (p.costPrice || 0),
      })),
    });
  } catch (error) {
    console.error('[workshop] store failed:', error);
    res.status(500).json({ message: 'Failed to load the workshop store' });
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
  deletePurchaseRequest,
  // Tasks
  getWorkshopTasks,
  getMyWorkshopTasks,
  createWorkshopTask,
  updateWorkshopTaskStatus,
  deleteWorkshopTask,
  // Dashboard
  getWorkshopDashboard,
  // Inventory
  getWorkshopStore,
  getInventory,
  issueInventoryItem,
  listInventoryIssues,
  deleteInventoryIssue,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  searchInventory,
  // Technicians
  getTechnicians,
  createTechnician,
  updateTechnician,
  deleteTechnician,
  approveInventoryItem,
  // Maintenance Types
  getMaintenanceTypes,
  createMaintenanceType,
  updateMaintenanceType,
  deleteMaintenanceType,
  // Workshop Users
  getWorkshopUsers,
};
