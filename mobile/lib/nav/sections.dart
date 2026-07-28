import 'package:flutter/material.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../screens/tasks_board.dart';
import '../screens/my_leaves.dart';
import '../screens/my_requests.dart';
import '../screens/approvals.dart';
import '../screens/fleet_board.dart';
import '../screens/fleet_shipments.dart';
import '../resource/resource.dart';
import '../resource/configs.dart';
import '../screens/contracts_dashboard.dart';
import '../screens/contracts_analysis.dart';
import '../screens/contracts_prospects.dart';
import '../screens/hr_dashboard.dart';
import '../screens/hr_employees.dart';
import '../screens/ls2_vehicles.dart';
import '../screens/section_work.dart';
import '../screens/team_board.dart';
import '../screens/finance_suite.dart';
import '../screens/remote_attendance.dart';
import '../screens/hr_inbox.dart';
import '../screens/ls2_alerts.dart';
import '../screens/shipment_orders.dart';
import '../screens/it_custody.dart';
import '../screens/procurement.dart';
import '../screens/section_dash.dart';
import '../screens/dash_specs.dart';
import '../screens/remote_suite.dart';
import '../screens/ls2_dashboard.dart';
import '../screens/b2c_daily.dart';
import '../screens/ops_platform.dart';
import '../screens/ls2_fleet_assets.dart';
import '../screens/admin_suite.dart';

/// NATIVE-ONLY navigation: a section appears here the day its screens are
/// real Flutter screens talking to the API — nothing embedded, nothing
/// redirected. Gating mirrors the web sidebar (permissions matrix + roles).
class AppPage {
  final String arTitle;
  final String enTitle;
  final IconData icon;
  final WidgetBuilder builder;
  const AppPage(this.arTitle, this.enTitle, this.icon, this.builder);

  String get title => tr(arTitle, enTitle);
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
    AppSection(
      key: 'Customers & Finance', arTitle: 'العملاء والمالية', enTitle: 'Customers & Finance', icon: Icons.payments_outlined,
      roles: const [..._admins, 'employee', 'operations_manager', 'moderator'],
      pages: [
        AppPage('العملاء', 'Customers', Icons.people_outline, (c) => const CustomersScreen()),
        AppPage('الفواتير', 'Invoices', Icons.receipt_long_outlined, (c) => const InvoicesScreen()),
        AppPage('المدفوعات', 'Payments', Icons.payments_outlined, (c) => const PaymentsScreen()),
      ],
    ),
    AppSection(
      key: 'Administration', arTitle: 'الشؤون الإدارية', enTitle: 'Administration', icon: Icons.dashboard_customize_outlined,
      roles: const [..._admins, 'administrator', 'bd_manager'],
      pages: [
        AppPage('لوحة المهام', 'Task Board', Icons.view_kanban_outlined, (c) => const TasksBoardScreen()),
      ],
    ),
    AppSection(
      key: 'Fleet Management', arTitle: 'إدارة الأسطول', enTitle: 'Fleet Management', icon: Icons.local_shipping_outlined,
      roles: const [..._admins, 'operations_manager', 'operations', 'moderator', 'fleet_manager', 'fleet_supervisor'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: fleetDashSpec)),
        AppPage('اللوحة الرئيسية', 'Board', Icons.grid_view_rounded, (c) => const FleetBoardScreen()),
        AppPage('الشحنات والمتابعة', 'Shipments', Icons.inventory_2_outlined, (c) => const FleetShipmentsScreen()),
        AppPage('السائقون', 'Drivers', Icons.badge_outlined, (c) => ResourceScreen(config: fleetDriversCfg)),
        AppPage('السيارات', 'Vehicles', Icons.local_shipping_outlined, (c) => ResourceScreen(config: fleetVehiclesCfg)),
        AppPage('العملاء', 'Customers', Icons.people_outline, (c) => ResourceScreen(config: fleetCustomersCfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'fleet')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'fleet', complaints: true)),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen()),
      ],
    ),
    AppSection(
      key: 'Contracts', arTitle: 'إدارة العقود', enTitle: 'Contracts', icon: Icons.history_edu_outlined,
      roles: const [..._admins, 'contracts_manager', 'operations_manager'],
      pages: [
        AppPage('لوحة القسم', 'Dashboard', Icons.space_dashboard_outlined, (c) => const ContractsDashboardScreen()),
        AppPage('سجل موردي 3PL', '3PL Vendors', Icons.business_outlined, (c) => ResourceScreen(config: contractsVendorsCfg)),
        AppPage('تحليل التشغيل', 'Utilisation', Icons.insights_outlined, (c) => const ContractsAnalysisScreen()),
        AppPage('تنشيط الموردين', 'Prospects', Icons.phone_in_talk_outlined, (c) => const ContractsProspectsScreen()),
        AppPage('عقود الأقسام', 'Dept Contracts', Icons.folder_copy_outlined, (c) => ResourceScreen(config: contractsAgreementsCfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'contracts')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'contracts', complaints: true)),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen()),
      ],
    ),
    AppSection(
      key: 'CRM', arTitle: 'إدارة العلاقات', enTitle: 'CRM', icon: Icons.handshake_outlined,
      roles: const [..._admins, 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: crmDashSpec)),
        AppPage('الشركات', 'Companies', Icons.apartment_outlined, (c) => ResourceScreen(config: crmCompaniesCfg)),
        AppPage('جهات الاتصال', 'Contacts', Icons.contact_phone_outlined, (c) => ResourceScreen(config: crmContactsCfg)),
        AppPage('الصفقات', 'Deals', Icons.attach_money_outlined, (c) => ResourceScreen(config: crmDealsCfg)),
        AppPage('مهام العلاقات', 'CRM Tasks', Icons.task_alt_outlined, (c) => ResourceScreen(config: crmTasksCfg)),
        AppPage('الأنشطة', 'Activities', Icons.history_outlined, (c) => ResourceScreen(config: crmActivitiesCfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'crm')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'crm', complaints: true)),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen()),
      ],
    ),
    AppSection(
      key: 'Business Development', arTitle: 'تطوير الأعمال', enTitle: 'Business Development', icon: Icons.rocket_launch_outlined,
      roles: const [..._admins, 'bd_manager', 'bd_specialist', 'sales_manager', 'crm_manager', 'operations_manager'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: bdDashSpec)),
        AppPage('الفرص الاستراتيجية', 'Opportunities', Icons.explore_outlined, (c) => ResourceScreen(config: bdOpportunitiesCfg)),
        AppPage('الشراكات', 'Partners', Icons.handshake_outlined, (c) => ResourceScreen(config: bdPartnersCfg)),
        AppPage('المناقصات', 'Tenders', Icons.gavel_outlined, (c) => ResourceScreen(config: bdTendersCfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'bd')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'bd', complaints: true)),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen()),
      ],
    ),
    AppSection(
      key: 'Marketing', arTitle: 'التسويق', enTitle: 'Marketing', icon: Icons.campaign_outlined,
      roles: const [..._admins, 'marketing_manager', 'marketing_specialist', 'bd_manager'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: marketingDashSpec)),
        AppPage('الحملات', 'Campaigns', Icons.flag_outlined, (c) => ResourceScreen(config: marketingCampaignsCfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'marketing')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'marketing', complaints: true)),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen()),
      ],
    ),
    AppSection(
      key: 'Workshop', arTitle: 'الورشة', enTitle: 'Workshop', icon: Icons.handyman_outlined,
      roles: const [..._admins, 'workshop_manager', 'workshop_employee', 'purchasing'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: workshopDashSpec)),
        AppPage('طلبات الصيانة', 'Maintenance', Icons.build_circle_outlined, (c) => ResourceScreen(config: workshopMaintenanceCfg)),
        AppPage('المشتريات', 'Purchases', Icons.shopping_cart_outlined, (c) => ResourceScreen(config: workshopPurchasesCfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'workshop')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'workshop', complaints: true)),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen()),
      ],
    ),
    AppSection(
      key: 'HR', arTitle: 'الموارد البشرية', enTitle: 'Human Resources', icon: Icons.groups_outlined,
      roles: const [..._admins, 'hr_manager', 'hr_specialist'],
      pages: [
        AppPage('لوحة الموارد البشرية', 'HR Dashboard', Icons.space_dashboard_outlined, (c) => const HrDashboardScreen()),
        AppPage('الموظفون', 'Employees', Icons.people_alt_outlined, (c) => const HrEmployeesScreen()),
        AppPage('طلبات الإجازات', 'Leave Requests', Icons.event_available_outlined, (c) => const HrLeavesScreen()),
        AppPage('طلبات الموظفين', 'Employee Requests', Icons.mark_email_unread_outlined, (c) => const HrRequestsScreen()),
        AppPage('التراخيص والاشتراكات', 'Licenses', Icons.workspace_premium_outlined, (c) => ResourceScreen(config: hrLicensesCfg)),
        AppPage('أنواع الإجازات', 'Leave Types', Icons.event_note_outlined, (c) => ResourceScreen(config: hrLeaveTypesCfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'hr')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'hr', complaints: true)),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen()),
      ],
    ),
    AppSection(
      key: 'Location Solutions', arTitle: 'لوكيشن سوليوشن', enTitle: 'Location Solutions', icon: Icons.gps_fixed_outlined,
      roles: const [..._admins, 'operations_manager', 'operations', 'workshop_manager', 'moderator'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => const Ls2DashboardScreen()),
        AppPage('المركبات والصيانة', 'Fleet & Maintenance', Icons.local_shipping_outlined, (c) => const Ls2VehiclesScreen()),
        AppPage('الإصلاحات', 'Repairs', Icons.home_repair_service_outlined, (c) => ResourceScreen(config: ls2RepairsCfg)),
        AppPage('أصول الأسطول', 'Fleet Assets', Icons.tire_repair_outlined, (c) => const Ls2FleetAssetsScreen()),
        AppPage('التنبيهات', 'Alerts', Icons.notifications_active_outlined, (c) => const Ls2AlertsScreen()),
      ],
    ),
    AppSection(
      key: 'Sales', arTitle: 'المبيعات', enTitle: 'Sales', icon: Icons.trending_up_outlined,
      roles: const [..._admins, 'sales_manager', 'sales_rep', 'operations_manager', 'operations'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: salesDashSpec)),
        AppPage('الأهداف', 'Targets', Icons.track_changes_outlined, (c) => ResourceScreen(config: salesTargetsCfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'sales')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'sales', complaints: true)),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen()),
      ],
    ),
    AppSection(
      key: 'Accounting', arTitle: 'الحسابات', enTitle: 'Accounting', icon: Icons.account_balance_outlined,
      roles: const [..._admins, 'finance_manager', 'accountant'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: accountingDashSpec)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'accounting')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'accounting', complaints: true)),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen()),
      ],
    ),
    AppSection(
      key: 'Procurement', arTitle: 'المشتريات', enTitle: 'Procurement', icon: Icons.shopping_bag_outlined,
      roles: const [..._admins, 'procurement_manager'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: procurementDashSpec)),
        AppPage('طلبات الشراء', 'Requests', Icons.request_quote_outlined, (c) => const ProcRequestsScreen()),
        AppPage('أوامر الشراء', 'Orders', Icons.shopping_cart_outlined, (c) => const ProcOrdersScreen()),
        AppPage('فواتير الموردين', 'Bills', Icons.receipt_long_outlined, (c) => const ProcBillsScreen()),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'procurement')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'procurement', complaints: true)),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen()),
      ],
    ),
    AppSection(
      key: 'Customs', arTitle: 'التخليص الجمركي', enTitle: 'Customs', icon: Icons.directions_boat_outlined,
      roles: const [..._admins, 'operations_manager', 'customs_manager', 'customs_officer'],
      pages: [
        AppPage('التحليلات', 'Analytics', Icons.insights_outlined, (c) => SectionDashScreen(spec: customsDashSpec)),
        AppPage('التخليص الجمركي', 'Clearances', Icons.directions_boat_outlined, (c) => ResourceScreen(config: customsCfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'customs')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'customs', complaints: true)),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen()),
      ],
    ),
    AppSection(
      key: 'Software & IT', arTitle: 'البرمجيات وتقنية المعلومات', enTitle: 'Software & IT', icon: Icons.computer_outlined,
      roles: const [..._admins],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: itDashSpec)),
        AppPage('التذاكر والمشكلات', 'Tickets', Icons.confirmation_number_outlined, (c) => ResourceScreen(config: itTicketsCfg)),
        AppPage('عهد الأجهزة', 'Custody', Icons.devices_other_outlined, (c) => const ItCustodyScreen()),
        AppPage('الأنظمة والخدمات', 'Systems', Icons.dns_outlined, (c) => ResourceScreen(config: itSystemsCfg)),
        AppPage('مستودع الأجهزة', 'IT Stock', Icons.inventory_outlined, (c) => ResourceScreen(config: itStockCfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'it')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'it', complaints: true)),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen()),
      ],
    ),
    AppSection(
      key: 'Operations Platform', arTitle: 'منصة العمليات', enTitle: 'Operations Platform', icon: Icons.hub_outlined,
      roles: const [..._admins, 'moderator', 'employee', 'operations_manager', 'operations', 'workshop_manager', 'workshop_employee', 'purchasing', 'hr_manager', 'hr_specialist'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => const OpsDashboardScreen()),
        for (final cfg in opsResources)
          AppPage(cfg.ar, cfg.en, cfg.icon, (c) => OpsResourceScreen(cfg: cfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'ops')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'ops', complaints: true)),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen()),
      ],
    ),
    AppSection(
      key: 'Shipment Orders', arTitle: 'طلبات الشحنات', enTitle: 'Shipment Orders', icon: Icons.assignment_outlined,
      roles: const [..._admins, 'operations_manager', 'operations', 'moderator'],
      pages: [
        AppPage('الشحنات', 'Orders', Icons.assignment_outlined, (c) => const ShipmentOrdersScreen()),
        AppPage('العملاء', 'Customers', Icons.people_outline, (c) => ResourceScreen(config: shipmentOrdersCustomersCfg)),
        AppPage('الموردون', 'Suppliers', Icons.business_outlined, (c) => ResourceScreen(config: shipmentOrdersSuppliersCfg)),
        AppPage('الشاحنات', 'Vehicles', Icons.local_shipping_outlined, (c) => ResourceScreen(config: shipmentOrdersVehiclesCfg)),
      ],
    ),
    AppSection(
      key: 'Remote', arTitle: 'العمل عن بُعد', enTitle: 'Remote', icon: Icons.laptop_mac_outlined,
      roles: const [..._admins, 'remote_manager', 'remote_employee'],
      pages: [
        AppPage('الحضور والانصراف', 'Attendance', Icons.fingerprint_outlined, (c) => const RemoteAttendanceScreen()),
        AppPage('الإجازات', 'Leaves', Icons.beach_access_outlined, (c) => const RemoteLeavesScreen()),
        AppPage('المهام', 'Tasks', Icons.task_alt_outlined, (c) => const RemoteTasksScreen()),
        AppPage('التقرير اليومي', 'Daily Report', Icons.description_outlined, (c) => const RemoteReportScreen()),
        AppPage('المحادثات', 'Chat', Icons.chat_outlined, (c) => const RemoteChatEntryScreen()),
        AppPage('الإعلانات', 'Announcements', Icons.campaign_outlined, (c) => const RemoteAnnouncementsScreen()),
      ],
    ),
    AppSection(
      key: 'B2C', arTitle: 'B2C', enTitle: 'B2C', icon: Icons.storefront_outlined,
      roles: const [..._admins, 'b2c_head', 'b2c_project_manager'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: b2cDashSpec)),
        AppPage('المشاريع', 'Projects', Icons.folder_special_outlined, (c) => ResourceScreen(config: b2cProjectsCfg)),
        AppPage('الإدخال اليومي', 'Daily Entry', Icons.edit_calendar_outlined, (c) => const B2cDailyEntryScreen()),
        AppPage('مناديب المبيعات', 'Reps', Icons.sports_motorsports_outlined, (c) => ResourceScreen(config: b2cRepsCfg)),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen()),
      ],
    ),
    AppSection(
      key: 'AdminTools', arTitle: 'الإدارة', enTitle: 'Admin', icon: Icons.admin_panel_settings_outlined,
      roles: const ['super_admin', 'admin', 'it_manager'], managed: false,
      pages: [
        AppPage('المستخدمون', 'Users', Icons.group_outlined, (c) => const AdminUsersScreen()),
        AppPage('الصلاحيات', 'Permissions', Icons.lock_person_outlined, (c) => const PermissionsScreen()),
        AppPage('الفروع', 'Branches', Icons.store_mall_directory_outlined, (c) => ResourceScreen(config: branchesCfg)),
        AppPage('فئات المصروفات', 'Expense Categories', Icons.category_outlined, (c) => ResourceScreen(config: expenseCategoriesCfg)),
      ],
    ),
  ];

  return all.where(allowed).toList();
}

/// Self-service — every signed-in employee, no gating.
List<AppPage> selfServicePages(bool hasTeam) => [
      AppPage('الإشعارات', 'Notifications', Icons.notifications_outlined, (c) => const NotificationsScreen()),
      AppPage('إجازاتي', 'My Leaves', Icons.beach_access_outlined, (c) => const MyLeavesScreen()),
      AppPage('طلباتي', 'My Requests', Icons.description_outlined, (c) => const MyRequestsScreen()),
      if (hasTeam) AppPage('موافقات فريقي', 'Team Approvals', Icons.fact_check_outlined, (c) => const ApprovalsScreen()),
    ];
