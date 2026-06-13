const User = require('../models/User');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const { invalidateUserCache } = require('../middleware/auth');

exports.getUsers = async (req, res) => {
  try {
    const { role, isActive, search, branch } = req.query;
    const filter = {};

    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (branch) filter.branch = branch;
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const users = await User.find(filter)
      .populate('linkedCustomer', 'companyName')
      .populate('assignedCustomers', 'companyName')
      .populate('branch', 'name')
      .populate('assignedProjects', 'name code')
      .populate('assignedBranches', 'name code city')
      .populate('manager', 'firstName lastName email role')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ users });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load users' });
  }
};

exports.createUser = async (req, res) => {
  try {
    const { email, password, firstName, lastName, role, linkedCustomer, assignedCustomers, collectionTarget, branch, assignedProjects, assignedBranches, manager } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const user = await User.create({
      email,
      password,
      firstName,
      lastName,
      role,
      linkedCustomer,
      assignedCustomers,
      collectionTarget,
      branch: branch || undefined,
      assignedProjects: Array.isArray(assignedProjects) ? assignedProjects : [],
      assignedBranches: Array.isArray(assignedBranches) ? assignedBranches : [],
      manager: manager || undefined,
    });

    // Sync assignedCollector on Customer documents
    if (assignedCustomers && assignedCustomers.length > 0) {
      const Customer = require('../models/Customer');
      await Customer.updateMany(
        { _id: { $in: assignedCustomers } },
        { assignedCollector: user._id }
      );
      try { emitToAll('customer:updated', {}); } catch (e) {}
    }

    await logAudit({
      user: req.user._id,
      action: 'create_user',
      entity: 'User',
      entityId: user._id,
      changes: { after: { email, firstName, lastName, role } },
      ipAddress: req.ip,
    });

    res.status(201).json({ user });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create user' });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { firstName, lastName, role, assignedCustomers, linkedCustomer, collectionTarget, isActive, branch, assignedProjects, assignedBranches, manager } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const before = { firstName: user.firstName, lastName: user.lastName, role: user.role };

    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (role) user.role = role;
    if (linkedCustomer !== undefined) user.linkedCustomer = linkedCustomer;
    if (collectionTarget !== undefined) user.collectionTarget = collectionTarget;
    if (isActive !== undefined) user.isActive = isActive;
    if (branch !== undefined) user.branch = branch || null;
    if (assignedProjects !== undefined) user.assignedProjects = Array.isArray(assignedProjects) ? assignedProjects : [];
    if (assignedBranches !== undefined) user.assignedBranches = Array.isArray(assignedBranches) ? assignedBranches : [];
    if (manager !== undefined) user.manager = manager || null;

    // Sync assignedCollector on Customer documents when assignedCustomers changes
    if (assignedCustomers !== undefined) {
      const Customer = require('../models/Customer');
      const oldIds = (user.assignedCustomers || []).map(id => id?.toString()).filter(Boolean);
      const newIds = (assignedCustomers || []).map(id => id?.toString()).filter(Boolean);

      // Remove assignedCollector from customers no longer assigned
      const removed = oldIds.filter(id => !newIds.includes(id));
      if (removed.length > 0) {
        await Customer.updateMany(
          { _id: { $in: removed }, assignedCollector: user._id },
          { $unset: { assignedCollector: 1 } }
        );
      }

      // Set assignedCollector on newly assigned customers
      if (newIds.length > 0) {
        await Customer.updateMany(
          { _id: { $in: newIds } },
          { assignedCollector: user._id }
        );
      }

      user.assignedCustomers = assignedCustomers;
      try { emitToAll('customer:updated', {}); } catch (e) {}
    }

    await user.save();
    // Role/active/lock changes must take effect now, not after the cache TTL.
    invalidateUserCache(user._id);

    await logAudit({
      user: req.user._id,
      action: 'update_user',
      entity: 'User',
      entityId: user._id,
      changes: { before, after: { firstName: user.firstName, lastName: user.lastName, role: user.role } },
      ipAddress: req.ip,
    });

    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update user' });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.role === 'super_admin') {
      return res.status(400).json({ message: 'Cannot delete super admin account' });
    }

    // Cannot delete yourself
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    // Unassign from customers
    const Customer = require('../models/Customer');
    await Customer.updateMany(
      { assignedCollector: user._id },
      { $unset: { assignedCollector: 1 } }
    );

    // Delete notifications for this user
    const Notification = require('../models/Notification');
    await Notification.deleteMany({ recipient: user._id });

    await User.findByIdAndDelete(user._id);
    invalidateUserCache(user._id);

    await logAudit({
      user: req.user._id,
      action: 'delete_user',
      entity: 'User',
      entityId: user._id,
      changes: { before: { email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName } },
      ipAddress: req.ip,
    });

    try { emitToAll('user:deleted', { userId: user._id }); } catch (e) {}

    res.json({ message: 'User deleted' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Failed to delete user' });
  }
};

exports.lockUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.isLocked = !user.isLocked;
    await user.save();
    invalidateUserCache(user._id);

    await logAudit({
      user: req.user._id,
      action: user.isLocked ? 'lock_user' : 'unlock_user',
      entity: 'User',
      entityId: user._id,
      ipAddress: req.ip,
    });

    res.json({ message: `User ${user.isLocked ? 'locked' : 'unlocked'}`, user });
  } catch (error) {
    res.status(500).json({ message: 'Failed to toggle user lock status' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.password = newPassword;
    await user.save();

    await logAudit({
      user: req.user._id,
      action: 'reset_password',
      entity: 'User',
      entityId: user._id,
      ipAddress: req.ip,
    });

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to reset password' });
  }
};
