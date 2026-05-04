export const ROLE_HOME_ROUTES: Record<string, string> = {
  client: '/system/portal',
  workshop_manager: '/system/workshop/dashboard',
  workshop_employee: '/system/workshop',
  purchasing: '/system/workshop/purchases',
  b2c_head: '/system/b2c/dashboard',
  b2c_project_manager: '/system/b2c/dashboard',
};

export const homeRouteForRole = (role?: string | null) =>
  (role && ROLE_HOME_ROUTES[role]) || '/system/dashboard';
