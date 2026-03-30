const Vendor = require('../models/Vendor');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

exports.createVendor = async (req, res) => {
  try {
    const { name, contactPerson, phone, email, address, category, notes } = req.body;
    const vendor = await Vendor.create({ name, contactPerson, phone, email, address, category, notes, createdBy: req.user._id });

    await logAudit({ user: req.user._id, action: 'create_vendor', entity: 'Vendor', entityId: vendor._id, changes: { after: { name } }, ipAddress: req.ip });
    try { emitToAll('vendor:created', { vendor }); } catch (e) {}

    res.status(201).json({ vendor });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to create vendor' });
  }
};

exports.getVendors = async (req, res) => {
  try {
    const { search, active } = req.query;
    const filter = {};
    if (active === 'true') filter.isActive = true;

    let vendors = await Vendor.find(filter).sort({ name: 1 });

    if (search) {
      const s = search.toLowerCase();
      vendors = vendors.filter((v) => v.name.toLowerCase().includes(s) || (v.contactPerson && v.contactPerson.toLowerCase().includes(s)));
    }

    res.json({ vendors });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load vendors' });
  }
};

exports.getVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });
    res.json({ vendor });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load vendor' });
  }
};

exports.updateVendor = async (req, res) => {
  try {
    const { name, contactPerson, phone, email, address, category, notes, isActive } = req.body;
    const vendor = await Vendor.findByIdAndUpdate(req.params.id, { name, contactPerson, phone, email, address, category, notes, isActive }, { new: true, runValidators: true });
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    await logAudit({ user: req.user._id, action: 'update_vendor', entity: 'Vendor', entityId: vendor._id, changes: { after: { name } }, ipAddress: req.ip });
    try { emitToAll('vendor:updated', { vendor }); } catch (e) {}

    res.json({ vendor });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update vendor' });
  }
};

exports.deleteVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findByIdAndDelete(req.params.id);
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    await logAudit({ user: req.user._id, action: 'delete_vendor', entity: 'Vendor', entityId: vendor._id, changes: { before: { name: vendor.name } }, ipAddress: req.ip });
    try { emitToAll('vendor:deleted', { vendorId: vendor._id }); } catch (e) {}

    res.json({ message: 'Vendor deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete vendor' });
  }
};
