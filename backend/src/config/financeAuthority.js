/**
 * financeAuthority: finance staff (accountant, accounts manager, finance manager) hold the admin's powers in their ledgers: wallet, operations page and private operations, heavy transport store and light transport (edit, delete or move entries, reopen or write into a closed day, delete a sheet, force its stage).
 * This covers those pages only, so `hasSuperAdminPowers` (read system-wide) is not widened; a narrower check is used here.
 */
const FINANCE_FULL_ROLES = ['cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'];

const isFinanceFull = (role) => FINANCE_FULL_ROLES.includes(role);

/** System admin (or anyone granted full powers), or a finance person. */
const hasFinancePowers = async (role) => {
  if (!role) return false;
  if (require('./constants').isTopRole(role) || isFinanceFull(role)) return true;
  const { hasSuperAdminPowers } = require('../utils/permissions');
  return hasSuperAdminPowers(role);
};

module.exports = { FINANCE_FULL_ROLES, isFinanceFull, hasFinancePowers };
