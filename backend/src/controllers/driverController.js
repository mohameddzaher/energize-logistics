const Driver = require('../models/Driver');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

exports.createDriver = async (req, res) => {
  try {
    const { name, phone, idNumber, branch, notes } = req.body;
    const driver = await Driver.create({ name, phone, idNumber, branch, notes, createdBy: req.user._id });
    const populated = await Driver.findById(driver._id).populate('branch', 'name');

    await logAudit({ user: req.user._id, action: 'create_driver', entity: 'Driver', entityId: driver._id, changes: { after: { name } }, ipAddress: req.ip });
    try { emitToAll('driver:created', { driver: populated }); } catch (e) {}

    res.status(201).json({ driver: populated });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to create driver' });
  }
};

exports.getDrivers = async (req, res) => {
  try {
    const { search, branch, active } = req.query;
    const filter = {};
    if (active === 'true') filter.isActive = true;
    if (branch) filter.branch = branch;

    let drivers = await Driver.find(filter).populate('branch', 'name').sort({ name: 1 });

    if (search) {
      const s = search.toLowerCase();
      drivers = drivers.filter((d) => d.name.toLowerCase().includes(s));
    }

    res.json({ drivers });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load drivers' });
  }
};

exports.updateDriver = async (req, res) => {
  try {
    const { name, phone, idNumber, branch, notes, isActive } = req.body;
    const driver = await Driver.findByIdAndUpdate(req.params.id, { name, phone, idNumber, branch, notes, isActive }, { new: true, runValidators: true }).populate('branch', 'name');
    if (!driver) return res.status(404).json({ message: 'Driver not found' });

    await logAudit({ user: req.user._id, action: 'update_driver', entity: 'Driver', entityId: driver._id, changes: { after: { name } }, ipAddress: req.ip });
    try { emitToAll('driver:updated', { driver }); } catch (e) {}

    res.json({ driver });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update driver' });
  }
};

exports.deleteDriver = async (req, res) => {
  try {
    const driver = await Driver.findByIdAndDelete(req.params.id);
    if (!driver) return res.status(404).json({ message: 'Driver not found' });

    await logAudit({ user: req.user._id, action: 'delete_driver', entity: 'Driver', entityId: driver._id, changes: { before: { name: driver.name } }, ipAddress: req.ip });
    try { emitToAll('driver:deleted', { driverId: driver._id }); } catch (e) {}

    res.json({ message: 'Driver deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete driver' });
  }
};
