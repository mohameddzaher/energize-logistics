import 'package:flutter/material.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../screens/tasks_board.dart';
import '../screens/my_leaves.dart';
import '../screens/my_requests.dart';
import '../screens/approvals.dart';
import '../screens/fleet_board.dart';
import '../screens/contracts_vendors.dart';
import '../screens/web_screen.dart';

/// The app's map of the WHOLE system — every section the web sidebar has,
/// gated exactly like the web (permissions matrix + role lists). Pages with
/// a native screen open it; every other page opens INSIDE the app through
/// the embedded browser, so nothing lives outside the application.
class AppPage {
  final String arTitle;
  final String enTitle;
  final IconData icon;
  final WidgetBuilder? native;
  final String? webPath;
  const AppPage(this.arTitle, this.enTitle, this.icon, {this.native, this.webPath});

  String get title => tr(arTitle, enTitle);

  WidgetBuilder get builder =>
      native ?? (c) => WebScreen(title: title, path: webPath ?? '/system');
}

class AppSection {
  final String key;
  final String arTitle;
  final String enTitle;
  final IconData icon;
  final List<String> roles;
  final bool managed;
  final List<AppPage> pages;
  const AppSection({
    required this.key, required this.arTitle, required this.enTitle, required this.icon,
    required this.roles, this.managed = true, required this.pages,
  });

  String get title => tr(arTitle, enTitle);
}

const _admins = ['super_admin', 'admin', 'it_manager', 'it_specialist'];

List<AppSection> sectionsFor(AuthProvider auth) {
  final role = auth.role;
  bool allowed(AppSection s) {
    if (role == 'super_admin') return true;
    if (s.roles.contains(role)) return true;
    if (s.managed && auth.canAccessSection(s.key)) return true;
    return false;
  }

  final all = <AppSection>[
    const AppSection(
      key: 'Executive', arTitle: 'اللوحة التنفيذية', enTitle: 'Executive', icon: Icons.workspace_premium_outlined,
      roles: ['super_admin'], managed: false,
      pages: [
        AppPage('نظرة شاملة على كل الأقسام', 'All-sections overview', Icons.workspace_premium_outlined, webPath: '/system/executive'),
      ],
    ),
    const AppSection(
      key: 'Customers & Finance', arTitle: 'العملاء والمالية', enTitle: 'Customers & Finance', icon: Icons.payments_outlined,
      roles: [..._admins, 'employee', 'operations_manager', 'moderator'],
      pages: [
        AppPage('اللوحة الرئيسية', 'Dashboard', Icons.space_dashboard_outlined, webPath: '/system/dashboard'),
        AppPage('العملاء', 'Customers', Icons.people_outline, webPath: '/system/customers'),
        AppPage('الفواتير', 'Invoices', Icons.receipt_long_outlined, webPath: '/system/invoices'),
        AppPage('المدفوعات', 'Payments', Icons.credit_card_outlined, webPath: '/system/payments'),
        AppPage('التحصيل', 'Collections', Icons.account_balance_wallet_outlined, webPath: '/system/collections'),
      ],
    ),
    AppSection(
      key: 'Administration', arTitle: 'الشؤون الإدارية', enTitle: 'Administration', icon: Icons.dashboard_customize_outlined,
      roles: const [..._admins, 'administrator', 'bd_manager'],
      pages: [
        AppPage('لوحة المهام', 'Task Board', Icons.view_kanban_outlined, native: (c) => const TasksBoardScreen()),
      ],
    ),
    AppSection(
      key: 'Fleet Management', arTitle: 'إدارة الأسطول', enTitle: 'Fleet Management', icon: Icons.local_shipping_outlined,
      roles: const [..._admins, 'operations_manager', 'operations', 'moderator', 'fleet_manager', 'fleet_supervisor'],
      pages: [
        AppPage('اللوحة الرئيسية', 'Board', Icons.grid_view_rounded, native: (c) => const FleetBoardScreen()),
        const AppPage('الشحنات', 'Shipments', Icons.inventory_2_outlined, webPath: '/system/fleet/shipments'),
        const AppPage('السائقون', 'Drivers', Icons.badge_outlined, webPath: '/system/fleet/drivers'),
        const AppPage('العملاء', 'Customers', Icons.people_outline, webPath: '/system/fleet/customers'),
      ],
    ),
    AppSection(
      key: 'Contracts', arTitle: 'إدارة العقود', enTitle: 'Contracts', icon: Icons.history_edu_outlined,
      roles: const [..._admins, 'contracts_manager', 'operations_manager'],
      pages: [
        const AppPage('لوحة القسم', 'Dashboard', Icons.space_dashboard_outlined, webPath: '/system/contracts'),
        AppPage('سجل موردي 3PL', '3PL Vendors', Icons.business_outlined, native: (c) => const ContractsVendorsScreen()),
        const AppPage('تحليل التشغيل', 'Utilisation Analysis', Icons.insights_outlined, webPath: '/system/contracts/analysis'),
        const AppPage('تنشيط الموردين', 'Prospects', Icons.phone_in_talk_outlined, webPath: '/system/contracts/prospects'),
        const AppPage('عقود الأقسام', 'Dept Contracts', Icons.folder_copy_outlined, webPath: '/system/contracts/agreements'),
      ],
    ),
    const AppSection(
      key: 'HR', arTitle: 'الموارد البشرية', enTitle: 'Human Resources', icon: Icons.groups_outlined,
      roles: [..._admins, 'hr_manager', 'hr_specialist'],
      pages: [
        AppPage('لوحة الموارد البشرية', 'HR Dashboard', Icons.space_dashboard_outlined, webPath: '/system/hr/dashboard'),
        AppPage('الموظفون', 'Employees', Icons.people_alt_outlined, webPath: '/system/hr/employees'),
        AppPage('طلبات الإجازات', 'Leave Requests', Icons.event_available_outlined, webPath: '/system/hr/leaves'),
        AppPage('طلبات الموظفين', 'Employee Requests', Icons.mark_email_unread_outlined, webPath: '/system/hr/requests'),
        AppPage('العهد', 'Custody', Icons.devices_other_outlined, webPath: '/system/hr/custody'),
        AppPage('التراخيص والاشتراكات', 'Licenses', Icons.workspace_premium_outlined, webPath: '/system/hr/licenses'),
      ],
    ),
    const AppSection(
      key: 'Location Solutions', arTitle: 'لوكيشن سوليوشن', enTitle: 'Location Solutions', icon: Icons.gps_fixed_outlined,
      roles: [..._admins, 'operations_manager', 'operations', 'workshop_manager', 'moderator'],
      pages: [
        AppPage('لوحة القسم', 'Dashboard', Icons.space_dashboard_outlined, webPath: '/system/ls2'),
        AppPage('المتابعة الحية', 'Live Tracking', Icons.satellite_alt_outlined, webPath: '/system/ls2/live'),
        AppPage('الصيانة الدورية', 'Maintenance', Icons.build_circle_outlined, webPath: '/system/ls2/maintenance'),
        AppPage('أصول الأسطول', 'Fleet Assets', Icons.tire_repair_outlined, webPath: '/system/ls2/fleet-assets'),
        AppPage('الإصلاحات', 'Repairs', Icons.home_repair_service_outlined, webPath: '/system/ls2/repairs'),
      ],
    ),
    const AppSection(
      key: 'Workshop', arTitle: 'الورشة', enTitle: 'Workshop', icon: Icons.handyman_outlined,
      roles: [..._admins, 'workshop_manager', 'workshop_employee', 'purchasing'],
      pages: [
        AppPage('لوحة الورشة', 'Dashboard', Icons.space_dashboard_outlined, webPath: '/system/workshop/dashboard'),
        AppPage('المشتريات', 'Purchases', Icons.shopping_cart_outlined, webPath: '/system/workshop/purchases'),
        AppPage('المستودع', 'Store', Icons.warehouse_outlined, webPath: '/system/workshop/store'),
      ],
    ),
    const AppSection(
      key: 'CRM', arTitle: 'إدارة العلاقات', enTitle: 'CRM', icon: Icons.handshake_outlined,
      roles: [..._admins, 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations'],
      pages: [
        AppPage('لوحة العلاقات', 'Dashboard', Icons.space_dashboard_outlined, webPath: '/system/crm/dashboard'),
        AppPage('الشركات', 'Companies', Icons.apartment_outlined, webPath: '/system/crm/companies'),
        AppPage('الصفقات', 'Deals', Icons.attach_money_outlined, webPath: '/system/crm/deals'),
        AppPage('الموردون', 'Vendors', Icons.local_shipping_outlined, webPath: '/system/crm/vendors'),
      ],
    ),
    const AppSection(
      key: 'Sales', arTitle: 'المبيعات', enTitle: 'Sales', icon: Icons.trending_up_outlined,
      roles: [..._admins, 'sales_manager', 'sales_rep', 'operations_manager', 'operations'],
      pages: [AppPage('لوحة المبيعات', 'Sales Dashboard', Icons.space_dashboard_outlined, webPath: '/system/sales/dashboard')],
    ),
    const AppSection(
      key: 'Accounting', arTitle: 'الحسابات', enTitle: 'Accounting', icon: Icons.account_balance_outlined,
      roles: [..._admins, 'finance_manager', 'accountant'],
      pages: [
        AppPage('لوحة الحسابات', 'Dashboard', Icons.space_dashboard_outlined, webPath: '/system/accounting/dashboard'),
        AppPage('المقبوضات', 'Receivables', Icons.call_received_outlined, webPath: '/system/accounting/receivables'),
        AppPage('المدفوعات', 'Payables', Icons.call_made_outlined, webPath: '/system/accounting/payables'),
      ],
    ),
    const AppSection(
      key: 'Marketing', arTitle: 'التسويق', enTitle: 'Marketing', icon: Icons.campaign_outlined,
      roles: [..._admins, 'marketing_manager', 'marketing_specialist', 'bd_manager'],
      pages: [
        AppPage('لوحة التسويق', 'Dashboard', Icons.space_dashboard_outlined, webPath: '/system/marketing'),
        AppPage('الحملات', 'Campaigns', Icons.flag_outlined, webPath: '/system/marketing/campaigns'),
        AppPage('سجل الأنشطة', 'Activity Log', Icons.history_outlined, webPath: '/system/marketing/activities'),
      ],
    ),
    const AppSection(
      key: 'Business Development', arTitle: 'تطوير الأعمال', enTitle: 'Business Development', icon: Icons.rocket_launch_outlined,
      roles: [..._admins, 'bd_manager', 'bd_specialist', 'sales_manager', 'crm_manager', 'operations_manager'],
      pages: [
        AppPage('لوحة القسم', 'Dashboard', Icons.space_dashboard_outlined, webPath: '/system/bd'),
        AppPage('الفرص الاستراتيجية', 'Opportunities', Icons.explore_outlined, webPath: '/system/bd/opportunities'),
        AppPage('الشراكات', 'Partners', Icons.handshake_outlined, webPath: '/system/bd/partners'),
        AppPage('المناقصات', 'Tenders', Icons.gavel_outlined, webPath: '/system/bd/tenders'),
      ],
    ),
    const AppSection(
      key: 'Customs', arTitle: 'التخليص الجمركي', enTitle: 'Customs', icon: Icons.directions_boat_outlined,
      roles: [..._admins, 'operations_manager', 'customs_manager', 'customs_officer'],
      pages: [AppPage('الشحنات الجمركية', 'Customs Shipments', Icons.directions_boat_outlined, webPath: '/system/customs')],
    ),
    const AppSection(
      key: 'Shipment Orders', arTitle: 'طلبات الشحنات', enTitle: 'Shipment Orders', icon: Icons.assignment_outlined,
      roles: [..._admins, 'operations_manager', 'operations', 'moderator'],
      pages: [AppPage('طلبات الشحنات', 'Shipment Orders', Icons.assignment_outlined, webPath: '/system/shipment-orders')],
    ),
    const AppSection(
      key: 'Operations Platform', arTitle: 'منصة الأوبريشن', enTitle: 'Operations Platform', icon: Icons.hub_outlined,
      roles: [..._admins, 'operations_manager', 'operations', 'moderator', 'employee'],
      pages: [AppPage('لوحة الأوبريشن', 'Ops Dashboard', Icons.hub_outlined, webPath: '/system/ops')],
    ),
    const AppSection(
      key: 'B2C', arTitle: 'B2C', enTitle: 'B2C', icon: Icons.storefront_outlined,
      roles: [..._admins, 'b2c_head', 'b2c_project_manager'],
      pages: [AppPage('لوحة B2C', 'B2C Dashboard', Icons.storefront_outlined, webPath: '/system/b2c/dashboard')],
    ),
    const AppSection(
      key: 'Vehicles', arTitle: 'المركبات', enTitle: 'Vehicles', icon: Icons.directions_car_outlined,
      roles: [..._admins, 'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'],
      pages: [AppPage('المركبات والتفاويض', 'Vehicles & Authorizations', Icons.directions_car_outlined, webPath: '/system/vehicles')],
    ),
  ];

  return all.where(allowed).toList();
}

/// Self-service — every signed-in employee, no gating.
List<AppPage> selfServicePages(bool hasTeam) => [
      const AppPage('ملفي', 'My Profile', Icons.person_outline, webPath: '/system/hr/me'),
      AppPage('إجازاتي', 'My Leaves', Icons.beach_access_outlined, native: (c) => const MyLeavesScreen()),
      AppPage('طلباتي', 'My Requests', Icons.description_outlined, native: (c) => const MyRequestsScreen()),
      if (hasTeam) AppPage('موافقات فريقي', 'Team Approvals', Icons.fact_check_outlined, native: (c) => const ApprovalsScreen()),
    ];
