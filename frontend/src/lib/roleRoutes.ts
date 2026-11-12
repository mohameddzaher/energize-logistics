import { rightsRoleOf } from '@/lib/roles';
// First page each role opens after login, unless a landing page is set for it on the permissions screen (that takes precedence; see `landingFor`). Each role here lands on a page in its own section.
// The dashboard (/system/dashboard) used to be the fallback for super admin, employee and every unlisted role, but it belonged to a removed customers-and-finance section, so it was deleted.
export const ROLE_HOME_ROUTES: Record<string, string> = {
  super_admin: '/system/executive',
  admin: '/system/executive',
  moderator: '/system/operations',
  employee: '/system/operations',
  operations_manager: '/system/operations',
  operations_staff: '/system/operations',
  client: '/system/portal',
  // The Media Go account sees one screen, which is its home (backend/src/config/scopedRoles).
  mediago_account: '/system/b2c/mediago-complaints',
  shipment_orders_manager: '/system/shipment-orders',
  shipment_orders_staff: '/system/shipment-orders',
  shipment_orders_followup: '/system/shipment-orders',
  ops_platform_manager: '/system/ops',
  ops_platform_staff: '/system/ops',
  collections_manager: '/system/collections-dept/dashboard',
  collections_staff: '/system/collections-dept/dashboard',
  vendors_manager: '/system/vendors-mgmt',
  vendors_team_leader: '/system/vendors-mgmt',
  vendors_staff: '/system/vendors-mgmt/requests',
  fleet_manager: '/system/fleet/board',
  fleet_supervisor: '/system/fleet/board',
  location_manager: '/system/ls2/live',
  location_staff: '/system/ls2/live',
  vehicles_manager: '/system/vehicles/registry/overview',
  vehicles_staff: '/system/vehicles/registry/overview',
  b2c_manager: '/system/b2c/dashboard',
  b2c_deputy: '/system/b2c/dashboard',
  b2c_project_lead: '/system/b2c/dashboard',
  b2c_rep_supervisor: '/system/b2c/daily-entry',
  // The check supervisor lands on his work: the start-of-duty check screen.
  b2c_inspection_supervisor: '/system/b2c/duty/start',
  remote_employee: '/system/remote/attendance',
  remote_manager: '/system/remote/dashboard',
  hr_manager: '/system/hr/master',
  hr_specialist: '/system/hr/master',
  crm_manager: '/system/crm/dashboard',
  crm_specialist: '/system/crm/dashboard',
  cfo: '/system/finance',
  accounting_manager: '/system/finance',
  accountant: '/system/finance',
  sales_manager: '/system/sales/dashboard',
  sales_rep: '/system/sales/dashboard',
  procurement_manager: '/system/procurement/dashboard',
  procurement_staff: '/system/procurement/dashboard',
  customs_manager: '/system/customs',
  customs_officer: '/system/customs',
  marketing_manager: '/system/marketing',
  marketing_specialist: '/system/marketing',
  bd_manager: '/system/bd',
  bd_specialist: '/system/bd',
  administration_manager: '/system/administration',
  administration_staff: '/system/administration',
  contracts_manager: '/system/contracts',
  contracts_staff: '/system/contracts',
  it_manager: '/system/it',
  it_specialist: '/system/it',
  // The data team lands on its own section home (analysis per section + its data-entry screens).
  data_manager: '/system/data-support',
  data_analyst: '/system/data-support',
  data_entry: '/system/data-support',
};

// A team leader lands where its manager does unless listed itself.
export const homeRouteForRole = (role?: string | null) =>
  (role && (ROLE_HOME_ROUTES[role] || ROLE_HOME_ROUTES[rightsRoleOf(role)])) || '/system/hr/me';

/** The first section granted to this user. The map above is keyed by role name, so a role created on the permissions screen is not in it and fell back to the profile page; someone who created a role and granted operations edit would see the person land on personal data and conclude the grant was not saved. */
const SECTION_HOME: [string, string][] = [
  ['Operations', ROLE_HOME_ROUTES.operations_manager],
  ['Collections', ROLE_HOME_ROUTES.collections_manager],
  ['Operations Platform', ROLE_HOME_ROUTES.ops_platform_manager],
  ['Shipment Orders', ROLE_HOME_ROUTES.shipment_orders_manager],
  ['Vendors Management', ROLE_HOME_ROUTES.vendors_manager],
  ['Fleet Management', ROLE_HOME_ROUTES.fleet_manager],
  ['Customs', ROLE_HOME_ROUTES.customs_manager],
  ['Vehicles', ROLE_HOME_ROUTES.vehicles_manager],
  ['Location Solutions', ROLE_HOME_ROUTES.location_manager],
  ['Contracts', ROLE_HOME_ROUTES.contracts_manager],
  ['Administration', ROLE_HOME_ROUTES.administration_manager],
  ['B2C', ROLE_HOME_ROUTES.b2c_manager],
  ['CRM', ROLE_HOME_ROUTES.crm_manager],
  ['Sales', ROLE_HOME_ROUTES.sales_manager],
  ['Marketing', ROLE_HOME_ROUTES.marketing_manager],
  ['Business Development', ROLE_HOME_ROUTES.bd_manager],
  ['Procurement', ROLE_HOME_ROUTES.procurement_manager],
  ['Accounting', ROLE_HOME_ROUTES.accounting_manager],
  ['HR', ROLE_HOME_ROUTES.hr_manager],
  ['Remote', ROLE_HOME_ROUTES.remote_manager],
  ['Software & IT', ROLE_HOME_ROUTES.it_manager],
  ['Data & Decision Support', ROLE_HOME_ROUTES.data_manager],
].filter(([, href]) => !!href) as [string, string][];

const firstGrantedHome = (perms?: Record<string, string> | null): string | null => {
  if (!perms) return null;
  for (const [section, href] of SECTION_HOME) {
    const a = perms[section];
    if (a === 'edit' || a === 'view') return href;
  }
  return null;
};

/** First page the user opens: the login page configured for his role on the permissions screen, else the default written here. It used to be saved but not read at login, so everyone landed on the old page as if the setting was not saved. */
export const landingFor = (
  u?: { role?: string | null; homePage?: string | null; permissions?: Record<string, string> | null } | null,
) => {
  // The page configured for this user comes first; it is an explicit decision.
  if (u?.homePage && u.homePage.startsWith('/system')) return u.homePage;
  // Then the written home of his role, then the first section granted to him, then his profile page.
  const known = u?.role ? ROLE_HOME_ROUTES[u.role] : null;
  return known || firstGrantedHome(u?.permissions) || '/system/hr/me';
};
