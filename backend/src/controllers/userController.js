const User = require('../models/User');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const { invalidateUserCache } = require('../middleware/auth');

// Keep the Employee↔User link consistent and exclusive: point the chosen
// employee at this user, and detach the employee from any other user that was
// previously linked to it. Passing employeeId=null just detaches this user.
const syncEmployeeLink = async (employeeId, userId) => {
  try {
    const Employee = require('../models/Employee');
    // Detach any employee currently pointing at this user.
    await Employee.updateMany({ user: userId }, { $unset: { user: 1 } });
    // Detach any user currently linked to the target employee, then attach.
    if (employeeId) {
      await User.updateMany({ linkedEmployee: employeeId, _id: { $ne: userId } }, { $unset: { linkedEmployee: 1 } });
      await Employee.findByIdAndUpdate(employeeId, { user: userId });
      try { emitToAll('hr:employee', { id: String(employeeId) }); } catch (e) {}
    }
  } catch (e) {
    console.error('syncEmployeeLink error:', e.message);
  }
};

exports.getUsers = async (req, res) => {
  try {
    const { role, isActive, search, branch, accountType } = req.query;
    const filter = {};

    if (role) filter.role = role;
    if (accountType) {
      // Accounts created before accountType existed have no field at all — they
      // are staff by definition, so "employee" must include the absent case.
      filter.accountType = accountType === 'employee' ? { $in: ['employee', null] } : accountType;
    }
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
      .populate('linkedEmployee', 'firstName lastName employeeNumber iqamaNumber jobTitle')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ users });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load users' });
  }
};

// Suggest the default direct-manager user for a role (org chart). Used by the
// Add-User form to pre-fill the manager picker without forcing it.
exports.suggestManager = async (req, res) => {
  try {
    const { role } = req.query;
    if (!role) return res.json({ manager: null });
    const { resolveDefaultManager } = require('../utils/orgChart');
    const id = await resolveDefaultManager(role);
    if (!id) return res.json({ manager: null });
    const manager = await User.findById(id).select('firstName lastName role email').lean();
    res.json({ manager });
  } catch (error) {
    res.status(500).json({ message: 'Failed to suggest manager' });
  }
};

// A user can be one of OUR PEOPLE or an outside partner. When the creator picks
// customer/vendor, the account is forced onto the external `client` role and
// stamped with the register row it represents — that pairing is what the portal
// reads, and letting the two drift apart would produce a login that can see
// nothing (or, worse, an outsider on a staff role).
const { REGISTER_BY_KEY } = require('../config/partnerRegisters');
const { nameKey } = require('../utils/nameKey');

async function resolvePartnerInput(partner, accountType) {
  if (!['customer', 'vendor'].includes(accountType)) return null;
  if (!partner || !partner.source || !partner.refId) {
    const err = new Error('اختر العميل أو المورد المرتبط بهذا الحساب');
    err.status = 400;
    throw err;
  }
  const reg = REGISTER_BY_KEY[partner.source];
  if (!reg) {
    const err = new Error('سجل غير معروف');
    err.status = 400;
    throw err;
  }
  if (reg.kind !== accountType) {
    const err = new Error(`السجل المختار خاص بـ${reg.kind === 'vendor' ? 'الموردين' : 'العملاء'}`);
    err.status = 400;
    throw err;
  }
  const { resolvePartner } = require('./partnerController');
  const resolved = await resolvePartner(partner.source, String(partner.refId));
  if (!resolved) {
    const err = new Error('لم يتم العثور على هذا العميل/المورد');
    err.status = 400;
    throw err;
  }
  return {
    source: partner.source,
    refId: String(partner.refId),
    name: resolved.name,
    nameKey: nameKey(resolved.name),
    kind: reg.kind,
  };
}

exports.createUser = async (req, res) => {
  try {
    const { email, password, firstName, lastName, linkedCustomer, assignedCustomers, collectionTarget, branch, assignedProjects, assignedBranches, manager, remoteAccess, linkedEmployee } = req.body;
    const accountType = ['customer', 'vendor'].includes(req.body.accountType) ? req.body.accountType : 'employee';
    // Partner accounts always carry the external `client` role, whatever the
    // form sent — the role list is the staff list.
    const role = accountType === 'employee' ? req.body.role : 'client';

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    let partner = null;
    try {
      partner = await resolvePartnerInput(req.body.partner, accountType);
    } catch (e) {
      return res.status(e.status || 400).json({ message: e.message });
    }
    if (partner) {
      const clash = await User.findOne({ 'partner.source': partner.source, 'partner.refId': partner.refId }).lean();
      if (clash) return res.status(400).json({ message: `يوجد حساب بالفعل لهذا السجل: ${clash.email}` });
    }

    // Org chart: if no manager was chosen, auto-suggest one by walking up the
    // role hierarchy. Top roles (super_admin / client) resolve to none. Never
    // forced — the creator can pass manager:'' to explicitly leave it empty by
    // sending a falsy non-undefined value is not possible here, so empty string
    // is treated as "let the system decide". Pass a real id to override.
    let resolvedManager = manager || undefined;
    if (!resolvedManager) {
      const { resolveDefaultManager } = require('../utils/orgChart');
      resolvedManager = (await resolveDefaultManager(role)) || undefined;
    }

    const user = await User.create({
      email,
      password,
      firstName,
      lastName,
      role,
      accountType,
      partner: partner || undefined,
      // The finance register IS the legacy `linkedCustomer` pointer — keep it in
      // sync so the pre-existing portal endpoints keep resolving.
      linkedCustomer: partner && partner.source === 'customer' ? partner.refId : linkedCustomer,
      assignedCustomers,
      collectionTarget,
      branch: branch || undefined,
      assignedProjects: Array.isArray(assignedProjects) ? assignedProjects : [],
      assignedBranches: Array.isArray(assignedBranches) ? assignedBranches : [],
      manager: resolvedManager,
      remoteAccess: role === 'remote_employee' && Array.isArray(remoteAccess) ? remoteAccess : [],
      linkedEmployee: linkedEmployee || undefined,
    });

    // Keep the Employee↔User link two-way (one employee = one login account).
    if (linkedEmployee) {
      await syncEmployeeLink(linkedEmployee, user._id);
    }

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
    const { firstName, lastName, role, assignedCustomers, linkedCustomer, collectionTarget, isActive, branch, assignedProjects, assignedBranches, manager, remoteAccess, linkedEmployee } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const before = { firstName: user.firstName, lastName: user.lastName, role: user.role, email: user.email };

    // Account type / partner link. Switching an account between staff and partner
    // rewrites BOTH sides at once so the pair can never drift apart.
    if (req.body.accountType !== undefined) {
      const nextType = ['customer', 'vendor'].includes(req.body.accountType) ? req.body.accountType : 'employee';
      if (nextType === 'employee') {
        user.accountType = 'employee';
        user.partner = undefined;
      } else {
        let partner;
        try {
          partner = await resolvePartnerInput(
            req.body.partner || { source: user.partner?.source, refId: user.partner?.refId },
            nextType
          );
        } catch (e) {
          return res.status(e.status || 400).json({ message: e.message });
        }
        const clash = await User.findOne({
          'partner.source': partner.source, 'partner.refId': partner.refId, _id: { $ne: user._id },
        }).lean();
        if (clash) return res.status(400).json({ message: `يوجد حساب بالفعل لهذا السجل: ${clash.email}` });
        user.accountType = nextType;
        user.partner = partner;
        user.role = 'client';
        if (partner.source === 'customer') user.linkedCustomer = partner.refId;
      }
    }

    // Email is the login identifier, so changing it has to be exact: normalise
    // it the same way the schema does, and refuse a duplicate rather than let
    // the unique index throw a 500. Like `password` below, this used to be sent
    // by the form and silently ignored.
    if (req.body.email !== undefined) {
      const email = String(req.body.email).trim().toLowerCase();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ message: 'بريد إلكتروني غير صالح | A valid email is required' });
      }
      if (email !== user.email) {
        const taken = await User.findOne({ email, _id: { $ne: user._id } }).select('_id').lean();
        if (taken) {
          return res.status(400).json({ message: 'هذا البريد مستخدم بالفعل | This email is already registered' });
        }
        user.email = email;
      }
    }

    // The edit form offers a password field and SENDS it. This used to be
    // ignored silently: the request returned 200, the modal closed, and the
    // password was unchanged — so the admin handed out a password that never
    // worked. Honour it here, with the same minimum the schema enforces.
    if (req.body.password) {
      if (String(req.body.password).length < 8) {
        return res.status(400).json({ message: 'كلمة المرور 8 أحرف على الأقل | Password must be at least 8 characters' });
      }
      user.password = req.body.password; // hashed by the pre-save hook
      // A password change must end every live session on the old one.
      user.refreshTokens = [];
      user.refreshToken = undefined;
    }

    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    // A partner login stays on the external `client` role no matter what the
    // form sends; only staff accounts take a role from the picker.
    if (role && user.accountType === 'employee') user.role = role;
    if (linkedEmployee !== undefined) {
      user.linkedEmployee = linkedEmployee || null;
      await syncEmployeeLink(linkedEmployee || null, user._id);
    }
    if (linkedCustomer !== undefined) user.linkedCustomer = linkedCustomer;
    if (collectionTarget !== undefined) user.collectionTarget = collectionTarget;
    if (isActive !== undefined) user.isActive = isActive;
    if (branch !== undefined) user.branch = branch || null;
    if (assignedProjects !== undefined) user.assignedProjects = Array.isArray(assignedProjects) ? assignedProjects : [];
    if (assignedBranches !== undefined) user.assignedBranches = Array.isArray(assignedBranches) ? assignedBranches : [];
    if (manager !== undefined) user.manager = manager || null;
    if (remoteAccess !== undefined) {
      user.remoteAccess = (role === 'remote_employee' || user.role === 'remote_employee') && Array.isArray(remoteAccess) ? remoteAccess : [];
    }

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
      changes: {
        before,
        after: { firstName: user.firstName, lastName: user.lastName, role: user.role, email: user.email },
        passwordChanged: !!req.body.password || undefined,
      },
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
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ message: 'كلمة المرور 8 أحرف على الأقل | Password must be at least 8 characters' });
    }
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.password = newPassword; // hashed by the pre-save hook
    // Resetting someone's password must sign them out everywhere — otherwise a
    // session opened with the OLD password keeps working after the reset.
    user.refreshTokens = [];
    user.refreshToken = undefined;
    await user.save();
    invalidateUserCache(user._id);

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
