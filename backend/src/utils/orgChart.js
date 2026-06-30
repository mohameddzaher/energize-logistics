// Org-chart helpers. Resolves a sensible DEFAULT manager for a role by walking
// up ROLE_HIERARCHY until it finds an active user with the target manager role.
// Always a suggestion — callers may override or clear it.
const { ROLE_HIERARCHY } = require('../config/constants');

// The chain of manager-roles above a given role (nearest first), e.g.
// 'crm_specialist' → ['crm_manager', 'admin', 'super_admin'].
const managerRoleChain = (role) => {
  const chain = [];
  let current = ROLE_HIERARCHY[role];
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = ROLE_HIERARCHY[current];
  }
  return chain;
};

// Find the best default manager USER id for a role: the first active user whose
// role is the nearest available manager-role up the chain. Returns null if none.
const resolveDefaultManager = async (role, excludeUserId = null) => {
  const User = require('../models/User');
  for (const mgrRole of managerRoleChain(role)) {
    const filter = { role: mgrRole, isActive: true };
    if (excludeUserId) filter._id = { $ne: excludeUserId };
    // Prefer the designated default manager (isDefaultManager) at each level,
    // then fall back to the oldest active user with that role.
    const mgr = await User.findOne(filter).sort({ isDefaultManager: -1, createdAt: 1 }).select('_id').lean();
    if (mgr) return mgr._id;
  }
  return null;
};

module.exports = { managerRoleChain, resolveDefaultManager, ROLE_HIERARCHY };
