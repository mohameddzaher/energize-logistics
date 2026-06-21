const CustomsClearance = require('../models/CustomsClearance');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

// Whitelist of fields a client may set on create/update.
const EDITABLE = [
  'branch', 'stage', 'cancelled', 'assignedTo', 'customerName', 'customer',
  'shippingAgent', 'shippingAgentEmail', 'blNumber', 'invoiceNumber', 'invoiceDate',
  'port', 'invoiceType', 'containerCount', 'totalWeight', 'invoiceValue', 'currency',
  'exporterCompany', 'countryOfOrigin', 'hsCode', 'saberNumber', 'documents',
  'agentPapers', 'notes',
];

function pick(body) {
  const out = {};
  for (const k of EDITABLE) if (body[k] !== undefined) out[k] = body[k];
  if (out.customer === '' || out.customer === null) delete out.customer;
  return out;
}

exports.getClearances = async (req, res) => {
  try {
    const { search, branch, stage, active } = req.query;
    const filter = {};
    if (branch) filter.branch = branch;
    if (stage) filter.stage = stage;
    if (active === 'true') filter.cancelled = { $ne: true };

    let list = await CustomsClearance.find(filter).sort({ createdAt: -1 });

    if (search) {
      const s = search.toLowerCase();
      list = list.filter((c) =>
        [c.refNumber, c.blNumber, c.customerName, c.shippingAgent, c.invoiceNumber, c.port]
          .some((v) => v && String(v).toLowerCase().includes(s))
      );
    }

    res.json({ clearances: list });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load clearances' });
  }
};

exports.getClearance = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id).populate('customer', 'name');
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    res.json({ clearance });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load clearance' });
  }
};

exports.createClearance = async (req, res) => {
  try {
    const data = pick(req.body);
    data.createdBy = req.user._id;
    const clearance = await CustomsClearance.create(data);

    await logAudit({ user: req.user._id, action: 'create_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { refNumber: clearance.refNumber } }, ipAddress: req.ip });
    try { emitToAll('customs:created', { clearance }); } catch (e) {}

    res.status(201).json({ clearance });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to create clearance' });
  }
};

exports.updateClearance = async (req, res) => {
  try {
    const data = pick(req.body);
    data.lastModifiedBy = req.user._id;
    const clearance = await CustomsClearance.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    await logAudit({ user: req.user._id, action: 'update_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { refNumber: clearance.refNumber, stage: clearance.stage } }, ipAddress: req.ip });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}

    res.json({ clearance });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to update clearance' });
  }
};

exports.deleteClearance = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findByIdAndDelete(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    await logAudit({ user: req.user._id, action: 'delete_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id, changes: { before: { refNumber: clearance.refNumber } }, ipAddress: req.ip });
    try { emitToAll('customs:deleted', { clearanceId: clearance._id }); } catch (e) {}

    res.json({ message: 'Clearance deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete clearance' });
  }
};
