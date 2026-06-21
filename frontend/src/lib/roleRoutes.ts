// Where each role lands after login. Every defined role must be in this map —
// the `homeRouteForRole` fallback at the bottom should be a last-ditch safety
// net, not the primary path. Sending a role to a page it doesn't have data
// permissions for is how we end up with "failed to load" banners on first
// login.
//
// User type → landing page rationale:
//   super_admin / admin / moderator   → /system/dashboard      (executive overview, all financial KPIs)
//   employee                          → /system/dashboard      (collection-focused KPIs)
//   operations_manager / operations   → /system/operations     (workflow list — what they work on)
//   client                            → /system/portal         (customer portal)
//   workshop_manager                  → /system/workshop/dashboard
//   workshop_employee                 → /system/workshop
//   purchasing                        → /system/workshop/purchases
//   b2c_head / b2c_project_manager    → /system/b2c/dashboard
export const ROLE_HOME_ROUTES: Record<string, string> = {
  super_admin: '/system/dashboard',
  admin: '/system/dashboard',
  moderator: '/system/dashboard',
  employee: '/system/dashboard',
  operations_manager: '/system/operations',
  operations: '/system/operations',
  client: '/system/portal',
  workshop_manager: '/system/workshop/dashboard',
  workshop_employee: '/system/workshop',
  purchasing: '/system/workshop/purchases',
  b2c_head: '/system/b2c/dashboard',
  b2c_project_manager: '/system/b2c/dashboard',
  remote_employee: '/system/remote/attendance',
  remote_manager: '/system/remote/dashboard',
  hr_manager: '/system/hr/dashboard',
  hr_specialist: '/system/hr/dashboard',
  crm_manager: '/system/crm/dashboard',
  crm_specialist: '/system/crm/dashboard',
  finance_manager: '/system/accounting/dashboard',
  accountant: '/system/accounting/dashboard',
  sales_manager: '/system/sales/dashboard',
  sales_rep: '/system/sales/dashboard',
  procurement_manager: '/system/procurement/dashboard',
  customs_manager: '/system/customs',
  customs_officer: '/system/customs',
};

export const homeRouteForRole = (role?: string | null) =>
  (role && ROLE_HOME_ROUTES[role]) || '/system/dashboard';
