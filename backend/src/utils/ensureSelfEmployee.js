const Employee = require('../models/Employee');
const User = require('../models/User');

// Make sure a login account has an HR employee profile linked to it, creating a
// minimal one on demand if not. This lets ANY staff login (e.g. the super admin
// or a demo account) use the HR self-service features — request leave, raise
// requests, view their profile — without HR pre-registering them first. External
// clients are never auto-provisioned.
//
// Mutates the passed `user` object's `linkedEmployee` so the caller can keep
// using it within the same request, and returns the employee id (or null for
// clients / when no user). Idempotent and safe to call on every request.
async function ensureSelfEmployee(user) {
  if (!user) return null;
  const existing = user.linkedEmployee && (user.linkedEmployee._id || user.linkedEmployee);
  if (existing) return existing;
  if (user.role === 'client') return null;

  // Reuse a profile already pointing at this login — or one HR registered
  // under the same email. Without the email match, an HR record entered
  // before the login existed gets SHADOWED by a fresh minimal duplicate.
  let emp = await Employee.findOne({ user: user._id });
  if (!emp && user.email) {
    emp = await Employee.findOne({ email: new RegExp(`^${String(user.email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    if (emp && !emp.user) { emp.user = user._id; await emp.save(); }
  }
  if (!emp) {
    emp = await Employee.create({
      firstName: user.firstName || 'User',
      lastName: user.lastName || '',
      email: user.email,
      employmentStatus: 'active',
      hireDate: new Date().toISOString().slice(0, 10),
      user: user._id,
      directManager: (user.manager && (user.manager._id || user.manager)) || undefined,
      createdBy: user._id,
    });
  }
  await User.updateOne({ _id: user._id }, { linkedEmployee: emp._id });
  user.linkedEmployee = emp._id;
  return emp._id;
}

module.exports = ensureSelfEmployee;
