import { SECTION_ROLES } from '@/lib/roles';
/**
 * Who sees branch custody and who picks the branch to view.
 * The lists were hand-written in three places (menu link, dashboard link, branch selector condition). The accountant was added on the server but missed in all three, so endpoints opened but the screen did not. One list is fixed once; three get forgotten.
 */


/** Who opens the daily custody page (mirror of walletReadRoles on the server). */
export const WALLET_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'operations_manager', 'operations_staff', 'moderator',
  'cfo', 'accounting_manager', 'accountant',
  'collections_manager', 'collections_staff', 'collections_trainee',
];

/** Who opens its dashboard, the all-branches view (mirror of overviewRoles). */
export const WALLET_DASHBOARD_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'operations_manager', 'moderator',
  'cfo', 'accounting_manager', 'accountant',
  'collections_manager', 'collections_staff', 'collections_trainee',
];

/** Collections department sees the wallet read-only. Mirror of config/walletViewOnly on the server, which is the guard that rejects any write; here only the buttons are hidden (no collect, expense, purchases or close). */
export const WALLET_VIEW_ONLY_ROLES = (() => {
  // The whole collections team (manager, staff, trainee) from the role structure (lib/roles, generated from the server).
  const c = SECTION_ROLES.find((x) => x.section === 'Collections');
  return c ? [c.manager.key, ...c.staff.map((r) => r.key), c.trainee.key] : ['collections_manager', 'collections_staff', 'collections_trainee'];
})();

/**
 * Who is locked to their branch: operations staff only, whose custody is their branch's custody. Everyone else picks the branch.
 * Written as the negative on purpose: a positive list is forgotten when a role is added and leaves its holder on a no-branch page, while a negative list covers new roles from day one.
 */
export const BRANCH_LOCKED_ROLES = ['operations_staff'];

export const canPickWalletBranch = (role?: string | null) =>
  !!role && !BRANCH_LOCKED_ROLES.includes(role);

/**
 * First day of the ledger, mirror of config/walletStart.js on the server.
 * The server enforces it by rejecting reads and writes before this day. This copy only keeps the date picker from offering dates that would be rejected.
 * It is not fetched from the server because the picker needs it before the first call, and fetching would flash the past open then closed.
 */
export const WALLET_START_DATE = '2026-09-01';
