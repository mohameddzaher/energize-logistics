import 'package:flutter/material.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../screens/tasks_board.dart';
import '../screens/my_leaves.dart';
import '../screens/my_requests.dart';
import '../screens/approvals.dart';
import '../screens/fleet_board.dart';
import '../screens/fleet_shipments.dart';
import '../screens/fleet_analytics.dart';
import '../screens/fleet_settings.dart';
import '../screens/fleet_vehicle_logs.dart';
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
import '../screens/remote_attendance.dart';
import '../screens/hr_inbox.dart';
import '../screens/ls2_alerts.dart';
import '../screens/shipment_orders.dart';
import '../screens/it_custody.dart';
import '../screens/it_emails.dart';
import '../screens/procurement.dart';
import '../screens/section_dash.dart';
import '../screens/dash_specs.dart';
import '../screens/remote_suite.dart';
import '../screens/ls2_dashboard.dart';
import '../screens/b2c_daily.dart';
import '../screens/ops_platform.dart';
import '../screens/ls2_fleet_assets.dart';
import '../screens/admin_suite.dart';
import '../screens/workshop_inventory.dart';
import '../screens/accounting_suite.dart';
import '../screens/sales_suite.dart';
import '../screens/it_recurring.dart';
import '../screens/executive_overview.dart';
import '../screens/marketing_report.dart';
import '../screens/ls2_drivers.dart';
import '../screens/marketing_activities.dart';
import '../screens/ops_workflows.dart';
import '../screens/b2c_wallet.dart';
import '../screens/my_profile.dart';
import '../screens/customs_guide.dart';
import '../screens/cash_wallet.dart';
import '../screens/wallet_dashboard.dart';
import '../screens/accounting_reports.dart';
import '../screens/performance_overview.dart';
import '../screens/reference_data.dart';
import '../screens/vehicle_documents.dart';
import '../screens/vehicle_registry.dart';
import '../screens/vehicle_registry_dash.dart';
import '../screens/crm_calendar.dart';
import '../screens/ls2_temperature.dart';
import '../screens/ls2_settings.dart';
import '../screens/ls2_store.dart';
import '../screens/settings_screen.dart';
import '../screens/performance_evaluations.dart';
import '../screens/scorecards.dart';
import '../screens/reports.dart';
import '../screens/business_review.dart';
import '../screens/portal.dart';

/// NATIVE-ONLY navigation: a section appears here the day its screens are
/// real Flutter screens talking to the API — nothing embedded, nothing
/// redirected. Gating mirrors the web sidebar (permissions matrix + roles).
class AppPage {
  final String arTitle;
  final String enTitle;
  final IconData icon;
  final WidgetBuilder builder;
  /// مسارُ الصفحة نفسِها في الويب — مفتاحُها في مصفوفة الصلاحيّات.
  ///
  /// صلاحيّاتُ الصفحات تُضبط مرّةً واحدةً من شاشةٍ واحدة، ومفتاحُها هناك مسارُ
  /// الصفحة. فمن أُغلقت عنه صفحةٌ يجب ألّا يجدها في الهاتف — وإلّا كان الضبطُ
  /// نصفَ ضبط، وهو أسوأُ من لا شيء لأنّه يُقرأ تامًّا.
  ///
  /// وشاشةٌ بلا مسارٍ (لا نظيرَ لها في الويب) تُعرَض كما كانت: القسمُ يحرسها.
  final String? path;
  const AppPage(this.arTitle, this.enTitle, this.icon, this.builder, {this.path});

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
      key: 'Operations', arTitle: 'العمليات', enTitle: 'Operations', icon: Icons.workspaces_outline,
      roles: const [..._admins, 'employee', 'operations_manager', 'operations_staff', 'moderator'],
      pages: [
        AppPage('التشغيل', 'Operations', Icons.workspaces_outline, (c) => const OpsWorkflowsScreen(), path: '/system/operations'),
        AppPage('الموردون', 'Vendors', Icons.store_outlined, (c) => ResourceScreen(config: vendorsCfg), path: '/system/vendors'),
        AppPage('العهدة اليومية', 'Cash Wallet', Icons.account_balance_wallet_outlined, (c) => const CashWalletScreen(), path: '/system/wallet'),
        AppPage('لوحة المحفظة', 'Wallet Dashboard', Icons.pie_chart_outline, (c) => const WalletDashboardScreen(), path: '/system/wallet-dashboard'),
      ],
    ),
    // ── قسمُ التحصيل ────────────────────────────────────────────────────
    // أربعُ صفحاتٍ لا أكثر، ومعها الثابتتان في كلّ قسم. وصفحةُ التشغيل من
    // داخل قسمهم: الكشفُ ورقةُ عملهم اليوميّة، وبحثُها في قسمٍ لا يملكونه
    // عملٌ يومي زائد.
    AppSection(
      key: 'Collections', arTitle: 'التحصيل', enTitle: 'Collections', icon: Icons.request_quote_outlined,
      roles: const [..._admins, 'collections_manager', 'collections_staff', 'operations_manager', 'finance_manager', 'accountant'],
      pages: [
        AppPage('لوحة التحصيل', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: collectionsDashSpec), path: '/system/collections-dept/dashboard'),
        // الفواتيرُ قبل السجلّات: منها يعمل القسم.
        AppPage('الفواتير الضريبية', 'Tax Invoices', Icons.receipt_long_outlined, (c) => ResourceScreen(config: collectionsTaxInvoicesCfg), path: '/system/collections-dept/invoices/tax'),
        AppPage('فواتير الكاش', 'Cash Invoices', Icons.payments_outlined, (c) => ResourceScreen(config: collectionsCashInvoicesCfg), path: '/system/collections-dept/invoices/cash'),
        // سجلُّ الأعمار قبل السجلّات: هو ما يُفتح في الطريق قبل الزيارة.
        AppPage('أعمار الديون', 'Aging', Icons.layers_outlined, (c) => ResourceScreen(config: collectionsAgingCfg), path: '/system/collections-dept/aging'),
        AppPage('دفتر الفواتير', 'Invoice Ledger', Icons.menu_book_outlined, (c) => ResourceScreen(config: collectionsLedgerCfg), path: '/system/collections-dept/ledger'),
        AppPage('العملاء', 'Customers', Icons.people_outline, (c) => ResourceScreen(config: collectionsCustomersCfg), path: '/system/collections-dept/customers'),
        AppPage('الموردون', 'Suppliers', Icons.local_shipping_outlined, (c) => ResourceScreen(config: collectionsSuppliersCfg), path: '/system/collections-dept/suppliers'),
        AppPage('سير عمل التشغيل', 'Operations Workflow', Icons.workspaces_outline, (c) => const OpsWorkflowsScreen(), path: '/system/operations'),
        AppPage('القوائم المرجعية', 'Reference Data', Icons.tune_rounded, (c) => const ReferenceDataScreen(), path: '/system/collections-dept/settings'),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'collections'), path: '/system/collections-dept/my-tasks'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'collections', complaints: true), path: '/system/collections-dept/complaints'),
      ],
    ),
    // اجتماعات مراجعة الأعمال — the managers/board forum. Broad `roles` because
    // ordinary employees open it too, for work delegated to them; the screen
    // itself shows only the tabs their tier qualifies for.
    AppSection(
      key: 'Business Review', arTitle: 'مراجعة الأعمال', enTitle: 'Business Review', icon: Icons.event_note_outlined,
      // No static role list on purpose: the section is `managed`, and the
      // permission matrix grants it to EVERY staff role (see the backend's
      // `defaultAllRoles`). A hand-written list here would go stale the moment a
      // role is added — which is exactly how 14 roles got locked out on the web.
      roles: const [],
      pages: [
        AppPage('مراجعة الأعمال', 'Business Review', Icons.event_note_outlined, (c) => const BusinessReviewScreen()),
      ],
    ),
    AppSection(
      key: 'Administration', arTitle: 'الشؤون الإدارية', enTitle: 'Administration', icon: Icons.dashboard_customize_outlined,
      roles: const [..._admins, 'administration_staff', 'bd_manager'],
      pages: [
        AppPage('لوحة المهام', 'Task Board', Icons.view_kanban_outlined, (c) => const TasksBoardScreen(), path: '/system/administration'),
      ],
    ),
    AppSection(
      key: 'Fleet Management', arTitle: 'إدارة الأسطول', enTitle: 'Fleet Management', icon: Icons.local_shipping_outlined,
      roles: const [..._admins, 'operations_manager', 'operations_staff', 'moderator', 'fleet_manager', 'fleet_supervisor'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: fleetDashSpec), path: '/system/fleet/dashboard'),
        AppPage('التحليلات', 'Analytics', Icons.insights_outlined, (c) => const FleetAnalyticsScreen(), path: '/system/fleet/dashboard'),
        AppPage('اللوحة الرئيسية', 'Board', Icons.grid_view_rounded, (c) => const FleetBoardScreen(), path: '/system/fleet/board'),
        AppPage('الشحنات والمتابعة', 'Shipments', Icons.inventory_2_outlined, (c) => const FleetShipmentsScreen(), path: '/system/fleet/board'),
        AppPage('السائقون', 'Drivers', Icons.badge_outlined, (c) => ResourceScreen(config: fleetDriversCfg), path: '/system/fleet/drivers'),
        AppPage('تقييم السائقين', 'Driver KPIs', Icons.speed_outlined, (c) => const FleetDriverKpisScreen(), path: '/system/fleet/driver-kpis'),
        AppPage('السيارات', 'Vehicles', Icons.local_shipping_outlined, (c) => ResourceScreen(config: fleetVehiclesCfg), path: '/system/fleet/vehicles'),
        AppPage('سجلّات السيارات', 'Vehicle Logs', Icons.assignment_outlined, (c) => const FleetVehicleLogsScreen(), path: '/system/fleet/vehicle-logs'),
        AppPage('العملاء', 'Customers', Icons.people_outline, (c) => ResourceScreen(config: fleetCustomersCfg), path: '/system/fleet/customers'),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'fleet'), path: '/system/fleet/my-tasks'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'fleet', complaints: true), path: '/system/fleet/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(), path: '/system/fleet/kpis'),
        AppPage('الإعدادات', 'Settings', Icons.settings_outlined, (c) => const FleetSettingsScreen(), path: '/system/fleet/settings'),
      ],
    ),
    AppSection(
      key: 'Contracts', arTitle: 'إدارة العقود', enTitle: 'Contracts', icon: Icons.history_edu_outlined,
      roles: const [..._admins, 'contracts_manager', 'operations_manager'],
      pages: [
        AppPage('لوحة القسم', 'Dashboard', Icons.space_dashboard_outlined, (c) => const ContractsDashboardScreen(), path: '/system/contracts'),
        AppPage('سجل موردي 3PL', '3PL Vendors', Icons.business_outlined, (c) => ResourceScreen(config: contractsVendorsCfg), path: '/system/contracts/vendors'),
        AppPage('العملاء', 'Customers', Icons.handshake_outlined, (c) => ResourceScreen(config: contractsCustomersCfg), path: '/system/contracts/customers'),
        AppPage('تحليل التشغيل', 'Utilisation', Icons.insights_outlined, (c) => const ContractsAnalysisScreen(), path: '/system/contracts/analysis'),
        AppPage('تنشيط الموردين', 'Prospects', Icons.phone_in_talk_outlined, (c) => const ContractsProspectsScreen(), path: '/system/contracts/prospects'),
        AppPage('عقود الأقسام', 'Dept Contracts', Icons.folder_copy_outlined, (c) => ResourceScreen(config: contractsAgreementsCfg), path: '/system/contracts/agreements'),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'contracts'), path: '/system/contracts/my-tasks'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'contracts', complaints: true), path: '/system/contracts/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(), path: '/system/contracts/kpis'),
      ],
    ),
    AppSection(
      key: 'CRM', arTitle: 'إدارة العلاقات', enTitle: 'CRM', icon: Icons.handshake_outlined,
      roles: const [..._admins, 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_staff'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: crmDashSpec), path: '/system/crm/dashboard'),
        AppPage('الشركات', 'Companies', Icons.apartment_outlined, (c) => ResourceScreen(config: crmCompaniesCfg), path: '/system/crm/companies'),
        AppPage('جهات الاتصال', 'Contacts', Icons.contact_phone_outlined, (c) => ResourceScreen(config: crmContactsCfg), path: '/system/crm/contacts'),
        AppPage('الصفقات', 'Deals', Icons.attach_money_outlined, (c) => ResourceScreen(config: crmDealsCfg), path: '/system/crm/deals'),
        AppPage('مهام العلاقات', 'CRM Tasks', Icons.task_alt_outlined, (c) => ResourceScreen(config: crmTasksCfg), path: '/system/crm/tasks'),
        AppPage('الأنشطة', 'Activities', Icons.history_outlined, (c) => ResourceScreen(config: crmActivitiesCfg), path: '/system/crm/activities'),
        AppPage('التقويم', 'Calendar', Icons.calendar_month_outlined, (c) => const CrmCalendarScreen(), path: '/system/crm/calendar'),
        AppPage('الموردون (3PL)', 'Vendors', Icons.local_shipping_outlined, (c) => ResourceScreen(config: crmVendorsCfg), path: '/system/crm/vendors'),
        AppPage('مؤشرات العملاء', 'Customer KPIs', Icons.leaderboard_outlined, (c) => const CrmKpisScreen(kind: 'customers'), path: '/system/crm/customer-kpis'),
        AppPage('مؤشرات الموردين', 'Vendor KPIs', Icons.insights_outlined, (c) => const CrmKpisScreen(kind: 'vendors'), path: '/system/crm/vendor-kpis'),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'crm'), path: '/system/crm/my-tasks'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'crm', complaints: true), path: '/system/crm/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(), path: '/system/crm/kpis'),
      ],
    ),
    AppSection(
      key: 'Business Development', arTitle: 'تطوير الأعمال', enTitle: 'Business Development', icon: Icons.rocket_launch_outlined,
      roles: const [..._admins, 'bd_manager', 'bd_specialist', 'sales_manager', 'crm_manager', 'operations_manager'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: bdDashSpec)),
        AppPage('الفرص الاستراتيجية', 'Opportunities', Icons.explore_outlined, (c) => ResourceScreen(config: bdOpportunitiesCfg), path: '/system/bd/opportunities'),
        AppPage('الشراكات', 'Partners', Icons.handshake_outlined, (c) => ResourceScreen(config: bdPartnersCfg), path: '/system/bd/partners'),
        AppPage('المناقصات', 'Tenders', Icons.gavel_outlined, (c) => ResourceScreen(config: bdTendersCfg), path: '/system/bd/tenders'),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'bd'), path: '/system/bd/my-tasks'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'bd', complaints: true), path: '/system/bd/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(), path: '/system/bd/kpis'),
      ],
    ),
    AppSection(
      key: 'Marketing', arTitle: 'التسويق', enTitle: 'Marketing', icon: Icons.campaign_outlined,
      roles: const [..._admins, 'marketing_manager', 'marketing_specialist', 'bd_manager'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: marketingDashSpec)),
        AppPage('الحملات', 'Campaigns', Icons.flag_outlined, (c) => ResourceScreen(config: marketingCampaignsCfg), path: '/system/marketing/campaigns'),
        AppPage('الأنشطة', 'Activities', Icons.bolt_outlined, (c) => const MarketingActivitiesScreen(), path: '/system/marketing/activities'),
        AppPage('التقرير الدوري', 'Reports', Icons.assessment_outlined, (c) => const MarketingReportScreen(), path: '/system/marketing/reports'),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'marketing'), path: '/system/marketing/my-tasks'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'marketing', complaints: true), path: '/system/marketing/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(), path: '/system/marketing/kpis'),
      ],
    ),
    AppSection(
      key: 'Workshop', arTitle: 'الورشة', enTitle: 'Workshop', icon: Icons.handyman_outlined,
      roles: const [..._admins, 'workshop_manager', 'workshop_employee', 'procurement_staff'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: workshopDashSpec), path: '/system/workshop/dashboard'),
        AppPage('مستودع الورشة', 'Store', Icons.inventory_outlined, (c) => const WorkshopInventoryScreen(), path: '/system/workshop/store'),
        AppPage('طلبات الصيانة', 'Maintenance', Icons.build_circle_outlined, (c) => ResourceScreen(config: workshopMaintenanceCfg), path: '/system/workshop'),
        AppPage('المشتريات', 'Purchases', Icons.shopping_cart_outlined, (c) => ResourceScreen(config: workshopPurchasesCfg), path: '/system/workshop/purchases'),
        AppPage('أوامر شغل المركبات', 'Work Orders', Icons.assignment_outlined, (c) => ResourceScreen(config: workshopTasksCfg), path: '/system/workshop/tasks'),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'workshop'), path: '/system/workshop/my-tasks'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'workshop', complaints: true), path: '/system/workshop/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(), path: '/system/workshop/kpis'),
      ],
    ),
    AppSection(
      key: 'HR', arTitle: 'الموارد البشرية', enTitle: 'Human Resources', icon: Icons.groups_outlined,
      roles: const [..._admins, 'hr_manager', 'hr_specialist'],
      pages: [
        AppPage('لوحة الموارد البشرية', 'HR Dashboard', Icons.space_dashboard_outlined, (c) => const HrDashboardScreen(), path: '/system/hr/master'),
        AppPage('الموظفون', 'Employees', Icons.people_alt_outlined, (c) => const HrEmployeesScreen(), path: '/system/hr/employees'),
        AppPage('طلبات الإجازات', 'Leave Requests', Icons.event_available_outlined, (c) => const HrLeavesScreen(), path: '/system/hr/leaves'),
        AppPage('طلبات الموظفين', 'Employee Requests', Icons.mark_email_unread_outlined, (c) => const HrRequestsScreen(), path: '/system/hr/requests'),
        AppPage('التراخيص والاشتراكات', 'Licenses', Icons.workspace_premium_outlined, (c) => ResourceScreen(config: hrLicensesCfg), path: '/system/hr/licenses'),
        AppPage('عقود الموظفين', 'Contracts', Icons.description_outlined, (c) => ResourceScreen(config: hrContractsCfg), path: '/system/hr/contracts'),
        AppPage('المخزون', 'Stock', Icons.inventory_2_outlined, (c) => ResourceScreen(config: hrStockCfg), path: '/system/hr/stock'),
        AppPage('أنواع الإجازات', 'Leave Types', Icons.event_note_outlined, (c) => ResourceScreen(config: hrLeaveTypesCfg), path: '/system/hr/leave-types'),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'hr'), path: '/system/hr/my-tasks'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'hr', complaints: true), path: '/system/hr/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(), path: '/system/hr/kpis'),
      ],
    ),
    AppSection(
      key: 'Location Solutions', arTitle: 'لوكيشن سوليوشن', enTitle: 'Location Solutions', icon: Icons.gps_fixed_outlined,
      roles: const [..._admins, 'operations_manager', 'operations_staff', 'workshop_manager', 'moderator'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => const Ls2DashboardScreen()),
        AppPage('المركبات والصيانة', 'Fleet & Maintenance', Icons.local_shipping_outlined, (c) => const Ls2VehiclesScreen(), path: '/system/ls2/maintenance'),
        AppPage('الإصلاحات', 'Repairs', Icons.home_repair_service_outlined, (c) => ResourceScreen(config: ls2RepairsCfg), path: '/system/ls2/store'),
        AppPage('أصول الأسطول', 'Fleet Assets', Icons.tire_repair_outlined, (c) => const Ls2FleetAssetsScreen(), path: '/system/ls2/fleet-assets'),
        AppPage('مخزن النقل الثقيل', 'Store', Icons.inventory_2_outlined, (c) => const Ls2StoreScreen(), path: '/system/ls2/store'),
        AppPage('السائقون (تتبع)', 'Drivers', Icons.badge_outlined, (c) => const Ls2DriversScreen(), path: '/system/ls2/drivers'),
        AppPage('تقييم السواقين', 'Driver Performance', Icons.speed_outlined, (c) => const Ls2DriverPerformanceScreen(), path: '/system/ls2/driver-performance'),
        AppPage('الحرارة', 'Temperature', Icons.thermostat_outlined, (c) => const Ls2TemperatureScreen(), path: '/system/ls2/temperature'),
        AppPage('التنبيهات', 'Alerts', Icons.notifications_active_outlined, (c) => const Ls2AlertsScreen(), path: '/system/ls2/alerts'),
        AppPage('الإعدادات', 'Settings', Icons.settings_outlined, (c) => const Ls2SettingsScreen(), path: '/system/ls2/settings'),
      ],
    ),
    AppSection(
      key: 'Sales', arTitle: 'المبيعات', enTitle: 'Sales', icon: Icons.trending_up_outlined,
      roles: const [..._admins, 'sales_manager', 'sales_rep', 'operations_manager', 'operations_staff'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: salesDashSpec), path: '/system/sales/dashboard'),
        AppPage('الأداء', 'Performance', Icons.leaderboard_outlined, (c) => const SalesPerformanceScreen(), path: '/system/sales/performance'),
        AppPage('خط الأنابيب', 'Pipeline', Icons.view_kanban_outlined, (c) => const SalesPipelineScreen(), path: '/system/sales/pipeline'),
        AppPage('الأهداف', 'Targets', Icons.track_changes_outlined, (c) => ResourceScreen(config: salesTargetsCfg), path: '/system/sales/targets'),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'sales'), path: '/system/sales/my-tasks'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'sales', complaints: true), path: '/system/sales/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(), path: '/system/sales/kpis'),
      ],
    ),
    AppSection(
      key: 'Accounting', arTitle: 'الحسابات', enTitle: 'Accounting', icon: Icons.account_balance_outlined,
      roles: const [..._admins, 'finance_manager', 'accountant'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: accountingDashSpec), path: '/system/accounting/dashboard'),
        AppPage('شجرة الحسابات', 'Accounts', Icons.account_tree_outlined, (c) => const AccountsScreen(), path: '/system/accounting/accounts'),
        AppPage('دفتر اليومية', 'Journal', Icons.menu_book_outlined, (c) => const JournalScreen(), path: '/system/accounting/journal'),
        AppPage('المدينون', 'Receivables', Icons.call_received_outlined, (c) => const AgingReportScreen(endpoint: '/api/accounting/receivables', arTitle: 'المدينون', enTitle: 'Receivables', partyKey: 'customer', docKey: 'invoice', partyIsCompany: true), path: '/system/accounting/receivables'),
        AppPage('الدائنون', 'Payables', Icons.call_made_outlined, (c) => const AgingReportScreen(endpoint: '/api/accounting/payables', arTitle: 'الدائنون', enTitle: 'Payables', partyKey: 'vendor', docKey: 'bill'), path: '/system/accounting/payables'),
        AppPage('ميزان المراجعة', 'Trial Balance', Icons.balance_outlined, (c) => const TrialBalanceScreen(), path: '/system/accounting/trial-balance'),
        AppPage('قائمة الدخل', 'Profit & Loss', Icons.trending_up_outlined, (c) => const ProfitLossScreen(), path: '/system/accounting/profit-loss'),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'accounting'), path: '/system/accounting/my-tasks'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'accounting', complaints: true), path: '/system/accounting/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(), path: '/system/accounting/kpis'),
      ],
    ),
    AppSection(
      key: 'Procurement', arTitle: 'المشتريات', enTitle: 'Procurement', icon: Icons.shopping_bag_outlined,
      roles: const [..._admins, 'procurement_manager'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: procurementDashSpec), path: '/system/procurement/dashboard'),
        AppPage('طلبات الشراء', 'Requests', Icons.request_quote_outlined, (c) => const ProcRequestsScreen(), path: '/system/procurement/requests'),
        AppPage('أوامر الشراء', 'Orders', Icons.shopping_cart_outlined, (c) => const ProcOrdersScreen(), path: '/system/procurement/orders'),
        AppPage('فواتير الموردين', 'Bills', Icons.receipt_long_outlined, (c) => const ProcBillsScreen(), path: '/system/procurement/bills'),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'procurement'), path: '/system/procurement/my-tasks'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'procurement', complaints: true), path: '/system/procurement/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(), path: '/system/procurement/kpis'),
      ],
    ),
    AppSection(
      key: 'Vehicles', arTitle: 'المركبات والتفويضات', enTitle: 'Vehicles & Authorizations', icon: Icons.directions_car_outlined,
      roles: const [..._admins, 'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'],
      pages: [
        AppPage('تحليلات المركبات', 'Registry Analytics', Icons.insights_outlined, (c) => const VehicleRegistryDashboardScreen(), path: '/system/vehicles/registry/dashboard'),
        AppPage('سجل المركبات', 'Vehicle Registry', Icons.directions_car_outlined, (c) => const VehicleRegistryListScreen(), path: '/system/vehicles/registry'),
        // ── صفحةٌ لكل عائلةِ مستند، كما في الموقع ─────────────────────────
        // بياناتُها كلُّها كانت مخزَّنة ولا تجد عمودًا يعرضها: تفلتر على بطاقة
        // التشغيل فتحصل على المركبات الصحيحة بلا رقمِ بطاقةٍ واحد. وجمعُها في
        // شاشةٍ واحدة يجاوز الأربعين حقلًا فلا يُقرأ على هاتف.
        AppPage('تأمين المركبات', 'Vehicle Insurance', Icons.shield_outlined, (c) => VehicleDocumentsScreen(family: vehicleInsuranceFamily), path: '/system/vehicles/registry/insurance/vehicles'),
        AppPage('بطاقات التشغيل', 'Operating Cards', Icons.credit_card_outlined, (c) => VehicleDocumentsScreen(family: vehicleOperatingCardFamily), path: '/system/vehicles/registry/operating-cards'),
        AppPage('التفاويض', 'Authorisations', Icons.assignment_ind_outlined, (c) => VehicleDocumentsScreen(family: vehicleAuthorizationFamily), path: '/system/vehicles/registry/authorizations'),
        AppPage('بترو اب — شرائح الوقود', 'Petro App Cards', Icons.local_gas_station_outlined, (c) => VehicleDocumentsScreen(family: vehicleFuelCardFamily), path: '/system/vehicles/registry/fuel-cards'),
        AppPage('أجهزة التتبّع GPS', 'GPS Devices', Icons.satellite_alt_outlined, (c) => VehicleDocumentsScreen(family: vehicleGpsFamily), path: '/system/vehicles/registry/gps'),
        AppPage('رخص السير', 'Vehicle Licences', Icons.description_outlined, (c) => VehicleDocumentsScreen(family: vehicleLicenceFamily), path: '/system/vehicles/registry/licenses'),
        AppPage('الفحص الدوري', 'Periodic Inspection', Icons.fact_check_outlined, (c) => VehicleDocumentsScreen(family: vehicleInspectionFamily), path: '/system/vehicles/registry/inspection'),
        AppPage('الانتهاءات والتجديد', 'Expiries & Renewals', Icons.event_available_outlined, (c) => const VehicleRegistryAlertsScreen(), path: '/system/vehicles/registry/expiring'),
        AppPage('إعدادات التنبيهات', 'Alert Settings', Icons.settings_outlined, (c) => const VehicleRegistrySettingsScreen()),
      ],
    ),
    AppSection(
      key: 'Customs', arTitle: 'التخليص الجمركي', enTitle: 'Customs', icon: Icons.directions_boat_outlined,
      roles: const [..._admins, 'operations_manager', 'customs_manager', 'customs_officer'],
      pages: [
        AppPage('التحليلات', 'Analytics', Icons.insights_outlined, (c) => SectionDashScreen(spec: customsDashSpec), path: '/system/customs/analytics'),
        AppPage('الدليل', 'Guide', Icons.menu_book_outlined, (c) => const CustomsGuideScreen(), path: '/system/customs'),
        AppPage('التخليص الجمركي', 'Clearances', Icons.directions_boat_outlined, (c) => ResourceScreen(config: customsCfg), path: '/system/customs'),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'customs'), path: '/system/customs/my-tasks'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'customs', complaints: true), path: '/system/customs/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(), path: '/system/customs/kpis'),
      ],
    ),
    AppSection(
      key: 'Software & IT', arTitle: 'البرمجيات وتقنية المعلومات', enTitle: 'Software & IT', icon: Icons.computer_outlined,
      roles: const [..._admins],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: itDashSpec)),
        AppPage('التذاكر والمشكلات', 'Tickets', Icons.confirmation_number_outlined, (c) => ResourceScreen(config: itTicketsCfg), path: '/system/it/tickets'),
        AppPage('المشاكل المتكررة', 'Recurring', Icons.repeat_rounded, (c) => const ItRecurringScreen(), path: '/system/it/recurring'),
        AppPage('عهد الأجهزة', 'Custody', Icons.devices_other_outlined, (c) => const ItCustodyScreen(), path: '/system/it/custody'),
        AppPage('الأنظمة والخدمات', 'Systems', Icons.dns_outlined, (c) => ResourceScreen(config: itSystemsCfg), path: '/system/it/systems'),
        AppPage('بريد الشركة', 'Company Email', Icons.mail_outline, (c) => const ItEmailsScreen(), path: '/system/it/emails'),
        AppPage('مستودع الأجهزة', 'IT Stock', Icons.inventory_outlined, (c) => ResourceScreen(config: itStockCfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'it'), path: '/system/it/my-tasks'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'it', complaints: true), path: '/system/it/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(), path: '/system/it/kpis'),
      ],
    ),
    AppSection(
      key: 'Operations Platform', arTitle: 'منصة العمليات', enTitle: 'Operations Platform', icon: Icons.hub_outlined,
      roles: const [..._admins, 'moderator', 'employee', 'operations_manager', 'operations_staff', 'workshop_manager', 'workshop_employee', 'procurement_staff', 'hr_manager', 'hr_specialist'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => const OpsDashboardScreen()),
        for (final cfg in opsResources)
          AppPage(cfg.ar, cfg.en, cfg.icon, (c) => OpsResourceScreen(cfg: cfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'ops'), path: '/system/ops/my-tasks'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'ops', complaints: true), path: '/system/ops/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(), path: '/system/ops/kpis'),
      ],
    ),
    AppSection(
      key: 'Shipment Orders', arTitle: 'طلبات الشحنات', enTitle: 'Shipment Orders', icon: Icons.assignment_outlined,
      roles: const [..._admins, 'operations_manager', 'operations_staff', 'moderator'],
      pages: [
        AppPage('الشحنات', 'Orders', Icons.assignment_outlined, (c) => const ShipmentOrdersScreen(), path: '/system/shipment-orders'),
        AppPage('العملاء', 'Customers', Icons.people_outline, (c) => ResourceScreen(config: shipmentOrdersCustomersCfg), path: '/system/shipment-orders/customers'),
        AppPage('الموردون', 'Suppliers', Icons.business_outlined, (c) => ResourceScreen(config: shipmentOrdersSuppliersCfg), path: '/system/shipment-orders/fleet'),
        AppPage('الشاحنات', 'Vehicles', Icons.local_shipping_outlined, (c) => ResourceScreen(config: shipmentOrdersVehiclesCfg), path: '/system/shipment-orders/fleet'),
        AppPage('إعدادات النموذج', 'Form Settings', Icons.tune_outlined, (c) => ResourceScreen(config: shipmentOrdersFieldsCfg), path: '/system/shipment-orders/settings'),
      ],
    ),
    AppSection(
      key: 'Remote', arTitle: 'العمل عن بُعد', enTitle: 'Remote', icon: Icons.laptop_mac_outlined,
      roles: const [..._admins, 'remote_manager', 'remote_employee'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => const RemoteDashboardScreen(), path: '/system/remote/dashboard'),
        AppPage('الحضور والانصراف', 'Attendance', Icons.fingerprint_outlined, (c) => const RemoteAttendanceScreen(), path: '/system/remote/attendance'),
        AppPage('الإجازات', 'Leaves', Icons.beach_access_outlined, (c) => const RemoteLeavesScreen(), path: '/system/remote/leave'),
        AppPage('المهام', 'Tasks', Icons.task_alt_outlined, (c) => const RemoteTasksScreen(), path: '/system/remote/tasks'),
        AppPage('التقرير اليومي', 'Daily Report', Icons.description_outlined, (c) => const RemoteReportScreen(), path: '/system/remote/report'),
        AppPage('المحادثات', 'Chat', Icons.chat_outlined, (c) => const RemoteChatEntryScreen(), path: '/system/remote/chat'),
        AppPage('الإعلانات', 'Announcements', Icons.campaign_outlined, (c) => const RemoteAnnouncementsScreen(), path: '/system/remote/announcements'),
      ],
    ),
    AppSection(
      key: 'B2C', arTitle: 'B2C', enTitle: 'B2C', icon: Icons.storefront_outlined,
      // الباك يخدم داتا B2C لـ super_admin/admin + رؤوس B2C فقط؛ فمنستعرضهاش لـ IT
      // (كانوا بيشوفوا القسم ببيانات صفر) — نطابق النطاق تمامًا.
      roles: const ['super_admin', 'admin', 'b2c_manager', 'b2c_project_lead'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: b2cDashSpec), path: '/system/b2c/dashboard'),
        AppPage('المشاريع', 'Projects', Icons.folder_special_outlined, (c) => ResourceScreen(config: b2cProjectsCfg), path: '/system/b2c/projects'),
        AppPage('الإدخال اليومي', 'Daily Entry', Icons.edit_calendar_outlined, (c) => const B2cDailyEntryScreen(), path: '/system/b2c/daily-entry'),
        AppPage('عهد المشاريع', 'Custody', Icons.account_balance_wallet_outlined, (c) => const B2cWalletScreen()),
        AppPage('مناديب المبيعات', 'Reps', Icons.sports_motorsports_outlined, (c) => ResourceScreen(config: b2cRepsCfg), path: '/system/b2c/reps'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(), path: '/system/b2c/kpis'),
      ],
    ),
    AppSection(
      key: 'Performance', arTitle: 'تقييم الأداء', enTitle: 'Performance', icon: Icons.military_tech_outlined,
      roles: const ['super_admin'], managed: false,
      pages: [
        AppPage('نظرة كل الأقسام', 'All Departments', Icons.insights_outlined, (c) => const PerformanceOverviewScreen(), path: '/system/performance/overview'),
        AppPage('التقييمات', 'Evaluations', Icons.rate_review_outlined, (c) => const EvaluationsScreen()),
        AppPage('طلبات التعديل', 'Edit Requests', Icons.inbox_outlined, (c) => const PerformanceEditRequestsScreen()),
      ],
    ),
    AppSection(
      key: 'Executive', arTitle: 'النظرة التنفيذية', enTitle: 'Executive', icon: Icons.insights_outlined,
      roles: const ['super_admin', 'admin'], managed: false,
      pages: [
        AppPage('النظرة التنفيذية', 'Overview', Icons.insights_outlined, (c) => const ExecutiveOverviewScreen()),
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
        AppPage('سجل التدقيق', 'Audit Log', Icons.fact_check_outlined, (c) => ResourceScreen(config: auditCfg)),
        AppPage('البيانات المرجعية', 'Reference Data', Icons.list_alt_outlined, (c) => const ReferenceDataScreen()),
      ],
    ),
    // بوابة العميل/المورد — outside partners. `client` is the external role, and
    // it appears in NO other section, so a partner's drawer is just this.
    AppSection(
      key: 'Portal', arTitle: 'بوابتي', enTitle: 'My Portal', icon: Icons.storefront_outlined,
      roles: const ['client'], managed: false,
      pages: [
        AppPage('بوابتي', 'My Portal', Icons.storefront_outlined, (c) => const PortalScreen()),
      ],
    ),
  ];

  // A partner sees ONLY their portal — never a staff section, whatever the
  // permission matrix happens to say about their role.
  if (role == 'client') return all.where((s) => s.key == 'Portal').toList();
  // ── والصفحاتُ تُصفّى داخل القسم ───────────────────────────────────────────
  // القسمُ يُفتَح، ثمّ تُحذَف منه الصفحاتُ التي أُغلقت لهذا الدور — والقسمُ الذي
  // لم تبقَ فيه صفحةٌ يسقط كلُّه، فبطاقةٌ تُفتَح على فراغٍ أسوأُ من غيابها.
  return all.where(allowed).map((s) {
    final pages = s.pages.where((p) => auth.canAccessPage(p.path)).toList();
    if (pages.length == s.pages.length) return s;
    return AppSection(
      key: s.key, arTitle: s.arTitle, enTitle: s.enTitle, icon: s.icon,
      roles: s.roles, managed: s.managed, pages: pages,
    );
  }).where((s) => s.pages.isNotEmpty).toList();
}

/// Self-service — every signed-in EMPLOYEE, no gating. Partner (client) logins
/// have no employee profile behind them, so callers pass `isPartner: true` and
/// get only the two pages that make sense for an outsider.
List<AppPage> selfServicePages(bool hasTeam, {bool isPartner = false}) => isPartner
    ? [
      AppPage('ملفي', 'My Profile', Icons.account_circle_outlined, (c) => const MyProfileScreen()),
      AppPage('الإشعارات', 'Notifications', Icons.notifications_outlined, (c) => const NotificationsScreen()),
      AppPage('الإعدادات', 'Settings', Icons.settings_outlined, (c) => const SettingsScreen()),
    ]
    : [
      AppPage('ملفي', 'My Profile', Icons.account_circle_outlined, (c) => const MyProfileScreen()),
      AppPage('الإشعارات', 'Notifications', Icons.notifications_outlined, (c) => const NotificationsScreen()),
      AppPage('مركز التقارير', 'Reports', Icons.assessment_outlined, (c) => const ReportsScreen()),
      AppPage('إجازاتي', 'My Leaves', Icons.beach_access_outlined, (c) => const MyLeavesScreen()),
      AppPage('طلباتي', 'My Requests', Icons.description_outlined, (c) => const MyRequestsScreen()),
      if (hasTeam) AppPage('موافقات فريقي', 'Team Approvals', Icons.fact_check_outlined, (c) => const ApprovalsScreen()),
      if (hasTeam) AppPage('تقييم فريقي', 'Evaluate Team', Icons.rate_review_outlined, (c) => const EvaluationsScreen()),
      AppPage('الإعدادات', 'Settings', Icons.settings_outlined, (c) => const SettingsScreen()),
    ];
