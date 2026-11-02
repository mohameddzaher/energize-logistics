/** Finance people hold in its ledgers what the system admin holds; mirror of backend/src/config/financeAuthority.js. Asked only in wallet, operations, private operations, heavy-transport store and light transport; the server is the guard. */
export const FINANCE_FULL_ROLES = ['cfo', 'accounting_manager', 'accountant'];

type U = { role?: string | null; superAdminPowers?: boolean } | null | undefined;

export const hasFinancePowers = (u: U): boolean =>
  !!u && (['super_admin', 'admin'].includes(u.role || '') || !!u.superAdminPowers || FINANCE_FULL_ROLES.includes(u.role || ''));
