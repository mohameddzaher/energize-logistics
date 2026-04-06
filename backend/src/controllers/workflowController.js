const OperationsWorkflow = require('../models/OperationsWorkflow');
const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const XLSX = require('xlsx');

// Field-level permission groups
const FIELD_GROUPS = {
  application: [
    'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch',
    'carOwner', 'carNumber', 'ownerType', 'executionStatus',
    'applicationStatus', 'paymentMethod', 'username', 'taxIndicator',
    'purchaseValue', 'sellingValue',
    'loadingTime', 'driverRentalType', 'reference', 'userPhone',
    'driverName', 'driverPhone', 'carName', 'plateNumber',
    'truckType', 'truckSize', 'loadType', 'quantity',
    'goodsValue', 'representativeName', 'country',
    'ownerName', 'ownerPhone', 'region', 'product', 'invoiceRef',
    'driverCost', 'loadNumber', 'volume',
  ],
  operations: [
    'operationsReview',
  ],
  manual_moderator: [
    'paymentDate', 'payingBranch', 'finalReportDestination',
    'documentNumber', 'sendingDate', 'deliveryDate', 'accountingReview',
  ],
  collections: [
    'invoiceNumber', 'netInvoice', 'tax', 'totalInvoice',
    'invoiceDate', 'invoiceNotes', 'collectionDate',
  ],
};

// Which roles can edit which field groups
const ROLE_FIELD_ACCESS = {
  super_admin: [...FIELD_GROUPS.application, ...FIELD_GROUPS.operations, ...FIELD_GROUPS.manual_moderator, ...FIELD_GROUPS.collections],
  moderator: [...FIELD_GROUPS.application, ...FIELD_GROUPS.manual_moderator],
  operations_manager: FIELD_GROUPS.operations,
  admin: FIELD_GROUPS.collections,
  employee: FIELD_GROUPS.collections,
};

// Filter update body to only include fields the role can edit
const filterFieldsByRole = (body, role) => {
  const allowedFields = ROLE_FIELD_ACCESS[role] || [];
  const filtered = {};
  for (const key of Object.keys(body)) {
    if (allowedFields.includes(key)) {
      filtered[key] = body[key];
    }
  }
  return filtered;
};

// Lock expiry time: 5 minutes
const LOCK_EXPIRY_MS = 5 * 60 * 1000;

const isLocked = (workflow, userId) => {
  if (!workflow.lockedBy) return false;
  // Lock expired
  if (workflow.lockedAt && Date.now() - new Date(workflow.lockedAt).getTime() > LOCK_EXPIRY_MS) {
    return false;
  }
  // Locked by someone else
  return workflow.lockedBy.toString() !== userId.toString();
};

// GET /api/workflows
exports.getWorkflows = async (req, res) => {
  try {
    const { stage, search, page = 1, limit = 50, dateFrom, dateTo, pendingOnly } = req.query;
    const filter = {};

    if (pendingOnly === 'true') {
      filter.$and = [
        { $or: [{ paymentDate: null }, { paymentDate: '' }, { paymentDate: { $exists: false } }] },
        { $or: [{ invoiceNumber: null }, { invoiceNumber: '' }, { invoiceNumber: { $exists: false } }] },
      ];
    }

    if (stage) filter.stage = stage;
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom + 'T00:00:00.000Z');
      if (dateTo) filter.createdAt.$lte = new Date(dateTo + 'T23:59:59.999Z');
    }
    if (search) {
      filter.$or = [
        { reportNumber: { $regex: search, $options: 'i' } },
        { carOwner: { $regex: search, $options: 'i' } },
        { carNumber: { $regex: search, $options: 'i' } },
        { branch: { $regex: search, $options: 'i' } },
        { invoiceNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [workflows, total] = await Promise.all([
      OperationsWorkflow.find(filter)
        .populate('createdBy', 'firstName lastName')
        .populate('lastModifiedBy', 'firstName lastName')
        .populate('lockedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      OperationsWorkflow.countDocuments(filter),
    ]);

    res.json({ workflows, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    console.error('Get workflows error:', error);
    res.status(500).json({ message: 'Failed to load workflows' });
  }
};

// GET /api/workflows/:id
exports.getWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id)
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName')
      .populate('lockedBy', 'firstName lastName');

    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    res.json(workflow);
  } catch (error) {
    console.error('Get workflow error:', error);
    res.status(500).json({ message: 'Failed to load workflow details' });
  }
};

// POST /api/workflows
exports.createWorkflow = async (req, res) => {
  try {
    const filteredBody = filterFieldsByRole(req.body, req.user.role);
    filteredBody.createdBy = req.user._id;
    filteredBody.lastModifiedBy = req.user._id;
    filteredBody.stage = 'draft';

    const workflow = await OperationsWorkflow.create(filteredBody);

    // Create invoice and update customer outstanding if username matches a customer
    const sellingVal = Number(filteredBody.sellingValue) || 0;
    if (filteredBody.username && sellingVal > 0) {
      const customer = await Customer.findOne({
        companyName: { $regex: `^${filteredBody.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
        isActive: true,
      });
      if (customer) {
        const invoiceNumber = filteredBody.reportNumber || `WF-${workflow._id.toString().slice(-8)}`;
        const invoiceDate = filteredBody.reportDate ? new Date(filteredBody.reportDate) : new Date();
        const dueDate = new Date(invoiceDate);
        dueDate.setDate(dueDate.getDate() + (customer.creditTerm || 30));

        const existingInvoice = await Invoice.findOne({ invoiceNumber });
        if (!existingInvoice) {
          const invoice = await Invoice.create({
            invoiceNumber,
            customer: customer._id,
            amount: sellingVal,
            paidAmount: 0,
            balance: sellingVal,
            invoiceDate,
            dueDate,
            creditTerm: customer.creditTerm || 30,
            status: 'pending',
            notes: `Auto-created from operations workflow - ${filteredBody.fromLocation || ''} → ${filteredBody.toLocation || ''}`,
            createdBy: req.user._id,
          });
          try { emitToAll('invoice:created', { invoice }); } catch (e) { console.error('WebSocket emit error:', e); }
        }

        customer.currentOutstanding = (Number(customer.currentOutstanding) || 0) + sellingVal;
        await customer.save();
        try { emitToAll('customer:updated', { customer }); } catch (e) { console.error('WebSocket emit error:', e); }
      }
    }

    const populated = await OperationsWorkflow.findById(workflow._id)
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName');

    await logAudit({
      user: req.user._id,
      action: 'create_workflow',
      entity: 'OperationsWorkflow',
      entityId: workflow._id,
      changes: { after: filteredBody },
      ipAddress: req.ip,
    });

    try { emitToAll('workflow:created', populated); } catch (e) { console.error('WebSocket emit error:', e); }

    res.status(201).json(populated);
  } catch (error) {
    console.error('Create workflow error:', error);
    res.status(500).json({ message: 'Failed to create workflow' });
  }
};

// PUT /api/workflows/:id
exports.updateWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Check lock
    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({
        message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}`,
      });
    }

    const filteredBody = filterFieldsByRole(req.body, req.user.role);
    filteredBody.lastModifiedBy = req.user._id;

    const before = workflow.toObject();
    Object.assign(workflow, filteredBody);
    await workflow.save();

    const populated = await OperationsWorkflow.findById(workflow._id)
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName')
      .populate('lockedBy', 'firstName lastName');

    await logAudit({
      user: req.user._id,
      action: 'update_workflow',
      entity: 'OperationsWorkflow',
      entityId: workflow._id,
      changes: { before, after: filteredBody },
      ipAddress: req.ip,
    });

    try { emitToAll('workflow:updated', populated); } catch (e) { console.error('WebSocket emit error:', e); }

    res.json(populated);
  } catch (error) {
    console.error('Update workflow error:', error);
    res.status(500).json({ message: 'Failed to update workflow' });
  }
};

// PUT /api/workflows/:id/stage
exports.updateStage = async (req, res) => {
  try {
    const { stage } = req.body;
    const validTransitions = {
      draft: ['submitted_to_ops'],
      submitted_to_ops: ['ops_completed', 'draft'],
      ops_completed: ['submitted_to_collections', 'submitted_to_ops'],
      submitted_to_collections: ['completed', 'ops_completed'],
      completed: [],
    };

    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Check lock
    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({
        message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}`,
      });
    }

    const allowed = validTransitions[workflow.stage] || [];
    // Super admin can force any transition
    if (req.user.role !== 'super_admin' && !allowed.includes(stage)) {
      return res.status(400).json({
        message: `Cannot transition from "${workflow.stage}" to "${stage}"`,
      });
    }

    // Role-based stage transition authorization
    const stageRoleMap = {
      submitted_to_ops: ['moderator', 'super_admin'],
      ops_completed: ['operations_manager', 'super_admin'],
      submitted_to_collections: ['operations_manager', 'super_admin'],
      completed: ['admin', 'employee', 'super_admin'],
      draft: ['moderator', 'operations_manager', 'super_admin'], // rollback
    };

    const allowedRoles = stageRoleMap[stage] || [];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to perform this stage transition' });
    }

    const before = { stage: workflow.stage };
    workflow.stage = stage;
    workflow.lastModifiedBy = req.user._id;
    await workflow.save();

    // Release lock only after stage transition saved successfully
    workflow.lockedBy = null;
    workflow.lockedByName = '';
    workflow.lockedAt = null;
    await workflow.save();

    const populated = await OperationsWorkflow.findById(workflow._id)
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName')
      .populate('lockedBy', 'firstName lastName');

    await logAudit({
      user: req.user._id,
      action: 'workflow_stage_change',
      entity: 'OperationsWorkflow',
      entityId: workflow._id,
      changes: { before, after: { stage } },
      ipAddress: req.ip,
    });

    try { emitToAll('workflow:stageChanged', populated); } catch (e) { console.error('WebSocket emit error:', e); }

    res.json(populated);
  } catch (error) {
    console.error('Update stage error:', error);
    res.status(500).json({ message: 'Failed to update workflow stage' });
  }
};

// POST /api/workflows/:id/lock
exports.lockWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({
        message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}`,
      });
    }

    workflow.lockedBy = req.user._id;
    workflow.lockedByName = `${req.user.firstName} ${req.user.lastName}`;
    workflow.lockedAt = new Date();
    await workflow.save();

    try {
      emitToAll('workflow:locked', {
        _id: workflow._id,
        lockedBy: { _id: req.user._id, firstName: req.user.firstName, lastName: req.user.lastName },
        lockedByName: workflow.lockedByName,
        lockedAt: workflow.lockedAt,
      });
    } catch (e) { console.error('WebSocket emit error:', e); }

    res.json({ message: 'Row locked successfully' });
  } catch (error) {
    console.error('Lock workflow error:', error);
    res.status(500).json({ message: 'Failed to lock workflow' });
  }
};

// POST /api/workflows/:id/unlock
exports.unlockWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Only the locker or super_admin can unlock
    if (
      workflow.lockedBy &&
      workflow.lockedBy.toString() !== req.user._id.toString() &&
      req.user.role !== 'super_admin'
    ) {
      return res.status(403).json({ message: 'Only the locking user or super admin can unlock' });
    }

    workflow.lockedBy = null;
    workflow.lockedByName = '';
    workflow.lockedAt = null;
    await workflow.save();

    try { emitToAll('workflow:unlocked', { _id: workflow._id }); } catch (e) { console.error('WebSocket emit error:', e); }

    res.json({ message: 'Row unlocked successfully' });
  } catch (error) {
    console.error('Unlock workflow error:', error);
    res.status(500).json({ message: 'Failed to unlock workflow' });
  }
};

// DELETE /api/workflows/:id
exports.deleteWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({
        message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}`,
      });
    }

    await OperationsWorkflow.findByIdAndDelete(req.params.id);

    await logAudit({
      user: req.user._id,
      action: 'delete_workflow',
      entity: 'OperationsWorkflow',
      entityId: req.params.id,
      changes: { before: workflow.toObject() },
      ipAddress: req.ip,
    });

    try { emitToAll('workflow:deleted', { _id: req.params.id }); } catch (e) { console.error('WebSocket emit error:', e); }

    res.json({ message: 'Workflow deleted successfully' });
  } catch (error) {
    console.error('Delete workflow error:', error);
    res.status(500).json({ message: 'Failed to delete workflow' });
  }
};

// POST /api/workflows/bulk-delete
exports.bulkDelete = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids must be a non-empty array' });
    }

    // Check for locked workflows
    const workflows = await OperationsWorkflow.find({ _id: { $in: ids } });
    const lockedIds = workflows.filter((w) => isLocked(w, req.user._id)).map((w) => w._id.toString());
    if (lockedIds.length > 0) {
      return res.status(423).json({ message: `${lockedIds.length} workflow(s) are locked and cannot be deleted` });
    }

    await OperationsWorkflow.deleteMany({ _id: { $in: ids } });

    await logAudit({
      user: req.user._id,
      action: 'bulk_delete_workflows',
      entity: 'OperationsWorkflow',
      entityId: null,
      changes: { before: { count: ids.length, ids } },
      ipAddress: req.ip,
    });

    ids.forEach((id) => {
      try { emitToAll('workflow:deleted', { _id: id }); } catch (e) { console.error('WebSocket emit error:', e); }
    });

    res.json({ message: `${ids.length} workflow(s) deleted successfully`, deleted: ids.length });
  } catch (error) {
    console.error('Bulk delete workflows error:', error);
    res.status(500).json({ message: 'Failed to bulk delete workflows' });
  }
};

// GET /api/workflows/export
exports.exportWorkflows = async (req, res) => {
  try {
    const { stage, dateFrom, dateTo } = req.query;
    const filter = {};
    if (stage) filter.stage = stage;
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom + 'T00:00:00.000Z');
      if (dateTo) filter.createdAt.$lte = new Date(dateTo + 'T23:59:59.999Z');
    }

    // Use lean() + select only needed fields for speed — no populate needed
    const workflows = await OperationsWorkflow.find(filter)
      .select('-lockedBy -lockedByName -lockedAt -lastModifiedBy -__v')
      .sort({ createdAt: -1 })
      .lean();

    const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US') : '';
    const stageLabels = { draft: 'مسودة', submitted_to_ops: 'مرسل للتشغيل', ops_completed: 'تم التشغيل', submitted_to_collections: 'مرسل للتحصيل', completed: 'مكتمل' };

    // Build AOA (array of arrays) directly — much faster than JSON objects
    const headers = [
      'رقم الكشف', 'تاريخ الكشف', 'من', 'الي', 'الفرع', 'مالك السياره', 'رقم السياره',
      'نوع المالك', 'حاله التنفيذ', 'حاله الابلكيشن', 'طريقه الدفع', 'اسم المستخدم',
      'هاتف المستخدم', 'ض / غ ض', 'قيمه الشراء', 'قيمه البيع', 'وقت التحميل',
      'نوع تأجير السائق', 'رقم المرجع', 'اسم السائق', 'هاتف السائق', 'اسم السيارة',
      'رقم اللوحة', 'نوع الشاحنة', 'حجم الشاحنة', 'نوع الحمولة', 'الكمية',
      'قيمة البضائع', 'اسم المندوب', 'اسم الدولة', 'مراجعه التشغيل',
      'تاريخ السداد', 'الفرع المسدد', 'وجهه الكشف النهائي', 'رقم السند',
      'تاريخ الارسال', 'تاريخ التسليم', 'مراجعه الحسابات',
      'رقم الفاتوره', 'صافي الفاتوره', 'ضريبه', 'اجمالى الفاتوره',
      'تاريخ الفاتوره', 'ملاحظات الفاتوره', 'تاريخ التحصيل',
      'المرحلة', 'تاريخ الإنشاء',
    ];

    const rows = workflows.map((w) => [
      w.reportNumber || '', formatDate(w.reportDate), w.fromLocation || '', w.toLocation || '',
      w.branch || '', w.carOwner || '', w.carNumber || '', w.ownerType || '',
      w.executionStatus || '', w.applicationStatus || '', w.paymentMethod || '',
      w.username || '', w.userPhone || '', w.taxIndicator || '',
      w.purchaseValue || 0, w.sellingValue || 0, w.loadingTime || '',
      w.driverRentalType || '', w.reference || '', w.driverName || '', w.driverPhone || '',
      w.carName || '', w.plateNumber || '', w.truckType || '', w.truckSize || '',
      w.loadType || '', w.quantity || '', w.goodsValue || 0,
      w.representativeName || '', w.country || '', w.operationsReview || '',
      formatDate(w.paymentDate), w.payingBranch || '', w.finalReportDestination || '',
      w.documentNumber || '', formatDate(w.sendingDate), formatDate(w.deliveryDate),
      w.accountingReview || '', w.invoiceNumber || '', w.netInvoice || 0,
      w.tax || 0, w.totalInvoice || 0, formatDate(w.invoiceDate),
      w.invoiceNotes || '', formatDate(w.collectionDate),
      stageLabels[w.stage] || w.stage, new Date(w.createdAt).toLocaleDateString('en-US'),
    ]);

    const aoa = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 4, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'العمليات');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=operations-${new Date().toISOString().split('T')[0]}.xlsx`);
    res.send(buf);
  } catch (error) {
    console.error('Export workflows error:', error);
    res.status(500).json({ message: 'Failed to export workflows' });
  }
};

// POST /api/workflows/bulk-import
exports.bulkImport = async (req, res) => {
  try {
    const { rows } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: 'rows must be a non-empty array' });
    }

    // Moderator can import application + manual_moderator fields
    const allowedImportFields = [...FIELD_GROUPS.application, ...FIELD_GROUPS.manual_moderator];

    const workflowsToCreate = rows.map((row) => {
      const workflow = {};
      allowedImportFields.forEach((field) => {
        if (row[field] !== undefined && row[field] !== null && row[field] !== '') {
          workflow[field] = row[field];
        }
      });
      workflow.stage = 'draft';
      workflow.createdBy = req.user._id;
      workflow.lastModifiedBy = req.user._id;
      return workflow;
    });

    // Use save() instead of insertMany to trigger pre-save hooks (auto reportNumber)
    // and handle duplicates gracefully
    const createdWorkflows = [];
    const skipped = [];
    for (const wfData of workflowsToCreate) {
      try {
        // Check for duplicate reportNumber
        if (wfData.reportNumber) {
          const existing = await OperationsWorkflow.findOne({ reportNumber: wfData.reportNumber });
          if (existing) {
            skipped.push(wfData.reportNumber);
            continue;
          }
        }
        const wf = new OperationsWorkflow(wfData);
        await wf.save();
        createdWorkflows.push(wf);
      } catch (err) {
        if (err.code === 11000) {
          skipped.push(wfData.reportNumber || 'unknown');
          continue;
        }
        throw err;
      }
    }

    // Create invoices and update customer outstanding based on sellingValue
    // username (اسم المستخدم) maps to the customer companyName
    const updatedCustomers = [];
    const customerCache = {};

    for (let i = 0; i < workflowsToCreate.length; i++) {
      const row = workflowsToCreate[i];
      // Find the matching created workflow (createdWorkflows may be shorter due to skips)
      const createdWf = createdWorkflows.find(w => w.reportNumber === row.reportNumber);
      if (!createdWf) continue; // This row was skipped

      const sellingVal = Number(row.sellingValue) || 0;
      if (!row.username || sellingVal <= 0) continue;

      const name = row.username.trim();
      // Cache customer lookups
      if (!customerCache[name.toLowerCase()]) {
        customerCache[name.toLowerCase()] = await Customer.findOne({
          companyName: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
          isActive: true,
        });
      }
      const customer = customerCache[name.toLowerCase()];
      if (!customer) continue;

      // Create invoice using reportNumber as invoice number
      const invoiceNumber = row.reportNumber || `WF-${createdWf._id.toString().slice(-8)}`;
      const invoiceDate = row.reportDate ? new Date(row.reportDate) : new Date();
      const dueDate = new Date(invoiceDate);
      dueDate.setDate(dueDate.getDate() + (customer.creditTerm || 30));

      const existingInvoice = await Invoice.findOne({ invoiceNumber });
      if (!existingInvoice) {
        const invoice = await Invoice.create({
          invoiceNumber,
          customer: customer._id,
          amount: sellingVal,
          paidAmount: 0,
          balance: sellingVal,
          invoiceDate,
          dueDate,
          creditTerm: customer.creditTerm || 30,
          status: 'pending',
          notes: `Auto-created from operations import - ${row.fromLocation || ''} → ${row.toLocation || ''}`,
          createdBy: req.user._id,
        });
        try { emitToAll('invoice:created', { invoice }); } catch (e) { console.error('WebSocket emit error:', e); }
      }

      customer.currentOutstanding = (Number(customer.currentOutstanding) || 0) + sellingVal;
      await customer.save();
      updatedCustomers.push({ companyName: customer.companyName, added: sellingVal, newOutstanding: customer.currentOutstanding });
      try { emitToAll('customer:updated', { customer }); } catch (e) { console.error('WebSocket emit error:', e); }
    }

    // Populate user references
    const populated = await OperationsWorkflow.find({
      _id: { $in: createdWorkflows.map((w) => w._id) },
    })
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName');

    await logAudit({
      user: req.user._id,
      action: 'bulk_import_workflows',
      entity: 'OperationsWorkflow',
      entityId: null,
      changes: { after: { count: createdWorkflows.length, customerUpdates: updatedCustomers } },
      ipAddress: req.ip,
    });

    try {
      emitToAll('workflow:bulkImported', {
        count: createdWorkflows.length,
        workflows: populated,
      });
    } catch (e) { console.error('WebSocket emit error:', e); }

    res.status(201).json({
      imported: createdWorkflows.length,
      skipped: skipped.length,
      skippedReports: skipped,
      workflows: populated,
      customerUpdates: updatedCustomers,
    });
  } catch (error) {
    console.error('Bulk import workflows error:', error);
    res.status(500).json({ message: 'Failed to bulk import workflows' });
  }
};

// GET /api/workflows/pending-by-customer/:customerId
exports.getPendingByCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const workflows = await OperationsWorkflow.find({
      username: { $regex: `^${customer.companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      $and: [
        { $or: [{ paymentDate: null }, { paymentDate: '' }, { paymentDate: { $exists: false } }] },
        { $or: [{ invoiceNumber: null }, { invoiceNumber: '' }, { invoiceNumber: { $exists: false } }] },
      ],
    })
      .select('reportNumber reportDate fromLocation toLocation branch carOwner sellingValue stage createdAt')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ workflows, total: workflows.length });
  } catch (error) {
    console.error('Get pending invoices by customer error:', error);
    res.status(500).json({ message: 'Failed to load pending invoices' });
  }
};

// Return field permissions info for the frontend
exports.getFieldPermissions = async (req, res) => {
  res.json({
    groups: FIELD_GROUPS,
    roleAccess: ROLE_FIELD_ACCESS,
  });
};
