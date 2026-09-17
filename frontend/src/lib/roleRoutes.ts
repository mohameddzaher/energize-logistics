// أوّلُ صفحةٍ يفتحها كلُّ دور بعد الدخول — ما لم تُضبط له صفحةُ دخولٍ من شاشة
// الصلاحيّات (تلك تسبق هذه، راجع `landingFor`). كلُّ دورٍ هنا صفحتُه في قسمه.
//
// كانت «لوحة التحكم» (/system/dashboard) صفحةَ السوبر أدمن والموظّف والاحتياطَ
// لكلّ دورٍ غير مذكور — وهي لوحةُ قسم «العملاء والمالية» الذي زال، فحُذفت.
// الإدارةُ العليا تدخل «النظرة التنفيذية»، ومن لا قسمَ معروفًا له يدخل ملفَّه.
export const ROLE_HOME_ROUTES: Record<string, string> = {
  super_admin: '/system/executive',
  admin: '/system/executive',
  moderator: '/system/operations',
  employee: '/system/operations',
  operations_manager: '/system/operations',
  operations_staff: '/system/operations',
  client: '/system/portal',
  shipment_orders_manager: '/system/shipment-orders',
  shipment_orders_staff: '/system/shipment-orders',
  ops_platform_manager: '/system/ops',
  ops_platform_staff: '/system/ops',
  collections_manager: '/system/collections-dept/dashboard',
  collections_staff: '/system/collections-dept/dashboard',
  fleet_manager: '/system/fleet/board',
  fleet_supervisor: '/system/fleet/board',
  location_manager: '/system/ls2/live',
  location_staff: '/system/ls2/live',
  vehicles_manager: '/system/vehicles/registry/overview',
  vehicles_staff: '/system/vehicles/registry/overview',
  b2c_manager: '/system/b2c/dashboard',
  b2c_project_lead: '/system/b2c/dashboard',
  b2c_rep_supervisor: '/system/b2c/duty/start',
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
};

export const homeRouteForRole = (role?: string | null) =>
  (role && ROLE_HOME_ROUTES[role]) || '/system/hr/me';

/**
 * أوّلُ صفحةٍ يفتحها المستخدم: صفحةُ الدخول المضبوطة لدوره من شاشة الصلاحيّات،
 * وإلّا الافتراضيُّ المكتوب هنا. كانت تُحفَظ ولا تُقرأ عند الدخول، فيدخل الجميعُ
 * على الصفحة القديمة وكأنّ الإعدادَ لم يُحفَظ.
 */
export const landingFor = (u?: { role?: string | null; homePage?: string | null } | null) =>
  (u?.homePage && u.homePage.startsWith('/system') ? u.homePage : homeRouteForRole(u?.role));
