const Branch = require('../models/Branch');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

exports.createBranch = async (req, res) => {
  try {
    const { name, code, city } = req.body;
    const branch = await Branch.create({ name, code, city, createdBy: req.user._id });

    await logAudit({ user: req.user._id, action: 'create_branch', entity: 'Branch', entityId: branch._id, changes: { after: { name, code, city } }, ipAddress: req.ip });
    try { emitToAll('branch:created', { branch }); } catch (e) {}

    res.status(201).json({ branch });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: 'Branch name or code already exists' });
    res.status(500).json({ message: error.message || 'Failed to create branch' });
  }
};

exports.getBranches = async (req, res) => {
  try {
    const filter = {};
    if (req.query.active === 'true') filter.isActive = true;
    const branches = await Branch.find(filter).sort({ name: 1 });
    res.json({ branches });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load branches' });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    const { name, code, city, isActive } = req.body;
    const branch = await Branch.findByIdAndUpdate(req.params.id, { name, code, city, isActive }, { new: true, runValidators: true });
    if (!branch) return res.status(404).json({ message: 'Branch not found' });

    await logAudit({ user: req.user._id, action: 'update_branch', entity: 'Branch', entityId: branch._id, changes: { after: { name, code, city, isActive } }, ipAddress: req.ip });
    try { emitToAll('branch:updated', { branch }); } catch (e) {}

    res.json({ branch });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: 'Branch name or code already exists' });
    res.status(500).json({ message: 'Failed to update branch' });
  }
};

exports.deleteBranch = async (req, res) => {
  try {
    const branch = await Branch.findByIdAndDelete(req.params.id);
    if (!branch) return res.status(404).json({ message: 'Branch not found' });

    await logAudit({ user: req.user._id, action: 'delete_branch', entity: 'Branch', entityId: branch._id, changes: { before: { name: branch.name } }, ipAddress: req.ip });
    try { emitToAll('branch:deleted', { branchId: branch._id }); } catch (e) {}

    res.json({ message: 'Branch deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete branch' });
  }
};
