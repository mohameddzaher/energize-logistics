import '../screens/mediago_ads.dart';
import '../screens/jp.dart';
import 'package:flutter/material.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../screens/tasks_board.dart';
import '../screens/my_leaves.dart';
import '../screens/my_requests.dart';
import '../screens/approvals.dart';
import '../screens/fleet_board.dart';
import '../screens/fleet_arrivals.dart';
import '../screens/fleet_shipments.dart';
import '../screens/fleet_analytics.dart';
import '../screens/fleet_settings.dart';
import '../screens/fleet_vehicle_logs.dart';
import '../screens/fleet_health.dart';
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
import '../screens/hr_leave_register.dart';
import '../screens/customer_requests.dart';
import '../screens/staff_requests.dart';
import '../screens/hr_forms.dart';
import '../screens/party_links.dart';
import '../screens/ls2_alerts.dart';
import '../screens/ls2_fleet_requests.dart';
import '../screens/shipment_orders.dart';
import '../screens/it_custody.dart';
import '../screens/it_custody_log.dart';
import '../screens/it_emails.dart';
import '../screens/procurement.dart';
import '../screens/section_dash.dart';
import '../screens/collections_receivables.dart' show CollectionsCasesScreen;
import '../screens/dash_specs.dart';
import '../screens/remote_suite.dart';
import '../screens/ls2_dashboard.dart';
import '../screens/b2c_amazon_attendance.dart';
import '../screens/mediago_complaints.dart';
import '../screens/b2c_daily.dart';
import '../screens/b2c_duty.dart';
import '../screens/b2c_duty_register.dart';
import '../screens/b2c_vehicles.dart';
import '../screens/ops_platform.dart';
import '../screens/ls2_fleet_assets.dart';
import '../screens/admin_suite.dart';
import '../screens/finance.dart';
import '../screens/hr_finance.dart';
import '../screens/sales_suite.dart';
import '../screens/it_recurring.dart';
import '../screens/executive_overview.dart';
import '../screens/marketing_report.dart';
import '../screens/ls2_drivers.dart';
import '../screens/marketing_activities.dart';
import '../screens/ops_workflows.dart';
import '../screens/ops_private.dart';
import '../screens/custody_ledger.dart';
import '../screens/hr_archive.dart';
import '../screens/light_transport_housing.dart';
import '../screens/my_profile.dart';
import '../screens/customs_dashboard.dart';
import '../screens/customs_guide.dart';
import '../screens/cash_wallet.dart';
import '../screens/wallet_dashboard.dart';
import '../screens/performance_overview.dart';
import '../screens/reference_data.dart';
import '../screens/vehicle_documents.dart';
import '../screens/vehicle_registry.dart';
import '../screens/vehicle_registry_dash.dart';
import '../screens/crm_calendar.dart';
import '../screens/ls2_temperature.dart';
import '../screens/ls2_settings.dart';
import '../screens/ls2_store.dart';
import '../screens/ls2_suppliers.dart';
import '../screens/settings_screen.dart';
import '../screens/performance_evaluations.dart';
import '../screens/scorecards.dart';
import '../screens/assistant.dart';
import '../screens/reports.dart';
import '../screens/business_review.dart';
import '../screens/portal.dart';
import '../screens/api_docs.dart';
import '../screens/ls2_live.dart';
import '../screens/ls2_tires.dart';
import '../screens/ls2_reports.dart';
import '../screens/crm_tasks.dart';
import '../screens/sales_dashboard.dart';
import '../screens/marketing_dashboard.dart';
import '../screens/admin_audit.dart';
import '../screens/admin_complaints.dart';
import '../screens/shipment_orders_dashboard.dart';
import '../screens/shipment_orders_chat.dart';
import '../screens/shipment_orders_analytics.dart';
import '../screens/shipment_orders_fleet.dart';
import '../screens/shipment_orders_settings.dart';
import '../screens/shipment_branch_access.dart';
import '../screens/customs_list.dart';
import '../screens/customs_analytics.dart';
import '../screens/customs_settings.dart';
import '../screens/vehicle_registry_overview.dart';
import '../screens/vehicle_claims.dart';
import '../screens/vehicle_corporate.dart';
import '../screens/vehicle_records.dart';
import '../screens/vehicle_driver_cards.dart';
import '../screens/hr_master.dart';
import '../screens/hr_ops.dart';
import '../screens/collections_invoices.dart';
import '../screens/collections_aging.dart';
import '../screens/collections_ledger.dart';
import '../screens/collections_dashboard.dart';
import '../screens/collections_plan.dart';
import '../screens/collections_team.dart';
import '../screens/collections_settings.dart';
import '../screens/credit_alerts.dart';
import '../screens/ops_payment_types.dart';
import '../screens/it_dashboard.dart';
import '../screens/it_tickets.dart';
import '../screens/it_stock.dart';
import '../screens/light_transport_list.dart';
import '../screens/b2c_operating_orders.dart';
import '../screens/b2c_dashboard.dart';
import '../screens/b2c_orders_analysis.dart';
import '../screens/performance_settings.dart';
import '../screens/vehicles_suite.dart';
import '../screens/fleet_driver_expenses.dart';

import '../screens/fleet_assign.dart';

// Super admin and admin see the whole system.
const _top = ['super_admin', 'admin'];

/// NATIVE-ONLY navigation: a section appears here the day its screens are
/// real Flutter screens talking to the API — nothing embedded, nothing
/// redirected. Gating mirrors the web sidebar (permissions matrix + roles).
class AppPage {
  final String arTitle;
  final String enTitle;
  final IconData icon;
  final WidgetBuilder builder;
  /// The page's own path on the web, its key in the permissions matrix.
  /// Page permissions are set once from one screen keyed by page path, so a page closed to a user must not appear on the phone either; otherwise the setting is half-applied, which is worse than none since it reads as complete.
  /// A screen with no path (no web counterpart) is shown as before; the section guards it.
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

/// Light transport custody, vehicles and staff adding: for the sector manager, deputy, system admin and finance, by role alone and not by section grant, like the server guard (authorize.strict in routes/lightTransport) and the website menu entries.
const _ltOwners = ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'cfo', 'accounting_manager', 'accountant'];
const _b2cSupervisors = ['b2c_rep_supervisor', 'b2c_inspection_supervisor'];

/// Heavy transport custody: for the Location Solutions manager, system admin and finance, by role alone, like the server guard (authorize.strict in routes/htCustody).
const _htOwners = ['super_admin', 'admin', 'location_manager', 'cfo', 'accounting_manager', 'accountant'];

/// Section order on the screen, the same as the website (SECTION_ORDER in layout.tsx).
/// The work chain as it runs: operations, then orders and platform, then collections, then fleet and tracking, then what supports all of it.
const _sectionOrder = <String>[
  'Operations',
  'Shipment Orders',
  'Operations Platform',
  'Collections',
  'Fleet Management',
  'Location Solutions',
  'HR',
  'Vehicles',
  'Customs',
  'B2C',
  'Software & IT',
];

List<AppSection> sectionsFor(AuthProvider auth) {
  final role = auth.role;
  // Writing collections invoices: the server's own roles, or a section grant of edit.
  collectionsCanEdit = const [..._admins, 'collections_manager', 'collections_staff', 'cfo', 'accounting_manager'].contains(role)
      || auth.canEditSection('Collections');
  // Amount editing is narrower: by role alone, a section grant does not open it (see configs).
  collectionsCanEditAmount = collectionsAmountEditRoles.contains(role);
  // Customers register: one screen in operations, shipment orders and sales.
  // Who edits and who removes follows the web rule (canEditCustomers / canRemoveCustomers) and the /api/customer-registry guard: the rep reads but does not write.
  final customersCfg = customersRegisterCfg(
    canEdit: customerEditRoles.contains(role) || auth.canEditSection('Shipment Orders'),
    canDelete: customerRemoveRoles.contains(role) || auth.canEditSection('Shipment Orders'),
  );
  // The target is set by the manager, or a role outside the section team granted edit (canSetTargets on the server).
  const salesTeam = ['super_admin', 'admin', 'sales_manager', 'sales_rep', 'operations_manager', 'operations_staff'];
  final canSetTargets = const ['super_admin', 'admin', 'sales_manager'].contains(role)
      || (auth.canEditSection('Sales') && !salesTeam.contains(role));
  bool allowed(AppSection s) {
    if (_top.contains(role)) return true;
    if (s.roles.contains(role)) return true;
    if (s.managed && auth.canAccessSection(s.key)) return true;
    // A page explicitly marked opens its section even if the menu does not know it; see isPageGranted.
    if (s.pages.any((p) => auth.isPageGranted(p.path))) return true;
    return false;
  }

  final all = <AppSection>[
    AppSection(
      key: 'Operations', arTitle: 'العمليات', enTitle: 'Operations', icon: Icons.workspaces_outline,
      roles: const [..._admins, 'employee', 'operations_manager', 'operations_staff', 'moderator'],
      pages: [
        AppPage('التشغيل', 'Operations', Icons.workspaces_outline, (c) => const OpsWorkflowsScreen(), path: '/system/operations'),
        // Operations sheets at our selling price: a management page, with permission from the web (path is its key in the matrix, and the server guards it on top).
        AppPage('التشغيل — خاصّ', 'Operations — private', Icons.lock_outline, (c) => const OpsPrivateScreen(), path: '/system/operations/private'),
        // Customers: on the web this was under operations and was missing here; the same register with no copies.
        AppPage('العملاء', 'Customers', Icons.people_outline, (c) => ResourceScreen(config: customersCfg), path: '/system/operations/customers'),
        AppPage('العهدة اليومية', 'Cash Wallet', Icons.account_balance_wallet_outlined, (c) => const CashWalletScreen(), path: '/system/wallet'),
        AppPage('لوحة المحفظة', 'Wallet Dashboard', Icons.pie_chart_outline, (c) => const WalletDashboardScreen(), path: '/system/wallet-dashboard'),
        // General complaints: on the web also for the operations manager, who does not see the administration section.
        if (role == 'operations_manager') AppPage('الشكاوى العامة', 'All Complaints', Icons.forum_outlined, (c) => const AdminComplaintsScreen(), path: '/system/complaints'),
        // Credit alerts: on the web under Home with the same operations roles.
        if (const ['super_admin', 'it_manager', 'it_specialist', 'admin', 'operations_manager', 'employee', 'moderator'].contains(role))
          AppPage('تنبيهات الائتمان', 'Credit Alerts', Icons.shield_outlined, (c) => const CreditAlertsScreen(), path: '/system/credit-alerts'),
        // Unifying payment type per customer: with the web roles (layout.tsx); the write is checked in the screen.
        if (const ['super_admin', 'it_manager', 'it_specialist', 'admin', 'employee', 'operations_manager', 'operations_staff', 'moderator', 'cfo', 'accounting_manager', 'accountant', 'collections_manager', 'collections_staff'].contains(role))
          AppPage('أنواع الدفع', 'Payment Types', Icons.payments_outlined, (c) => const OpsPaymentTypesScreen(), path: '/system/operations/payment-types'),
        AppPage('التواصل مع العملاء', 'Customer Communication', Icons.forum_outlined, (c) => const CustomerRequestsScreen(), path: '/system/operations/customer-requests'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'operations', complaints: true), path: '/system/operations/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'Operations'), path: '/system/operations/kpis'),
        if (jpMember(role, 'operations')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'operations'), path: '/system/operations/jp'),
        if (jpManager(role, 'operations')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'operations'), path: '/system/operations/jp-dashboard'),
        if (jpManager(role, 'operations') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/operations/management-jp'),
      ],
    ),
    // Collections section.
    // Four pages only, plus the two fixed in every section. The operations page sits inside their section: the sheet is their daily working paper, and searching it from a section they do not own is extra daily work.
    AppSection(
      key: 'Collections', arTitle: 'التحصيل', enTitle: 'Collections', icon: Icons.request_quote_outlined,
      roles: const [..._admins, 'collections_manager', 'collections_staff', 'operations_manager', 'cfo', 'accounting_manager', 'accountant'],
      pages: [
        AppPage('لوحة التحصيل', 'Dashboard', Icons.dashboard_outlined, (c) => const CollectionsDashboardScreen(), path: '/system/collections-dept/dashboard'),
        // Invoices before registers: the section works from them.
        AppPage('الفواتير الضريبية', 'Tax Invoices', Icons.receipt_long_outlined, (c) => const CollectionsInvoicesScreen(kind: 'tax'), path: '/system/collections-dept/invoices/tax'),
        AppPage('فواتير الكاش', 'Cash Invoices', Icons.payments_outlined, (c) => const CollectionsInvoicesScreen(kind: 'cash'), path: '/system/collections-dept/invoices/cash'),
        // Aging register before registers: it is what gets opened on the road before a visit.
        AppPage('أعمار الديون', 'Aging', Icons.layers_outlined, (c) => const CollectionsAgingScreen(), path: '/system/collections-dept/aging'),
        AppPage('دفتر الفواتير', 'Invoice Ledger', Icons.menu_book_outlined, (c) => const CollectionsLedgerScreen(), path: '/system/collections-dept/ledger'),
        AppPage('الخطة اليومية', 'Daily Plan', Icons.event_available_outlined, (c) => const CollectionsPlanScreen(), path: '/system/collections-dept/plan'),
        AppPage('الفريق', 'The Team', Icons.manage_accounts_outlined, (c) => const CollectionsTeamScreen(), path: '/system/collections-dept/team'),
        AppPage('القضايا', 'Cases', Icons.gavel_rounded, (c) => const CollectionsCasesScreen(), path: '/system/collections-dept/cases'),
        AppPage('العملاء', 'Customers', Icons.people_outline, (c) => ResourceScreen(config: collectionsCustomersCfg), path: '/system/collections-dept/customers'),
        AppPage('الموردون', 'Suppliers', Icons.local_shipping_outlined, (c) => ResourceScreen(config: collectionsSuppliersCfg), path: '/system/collections-dept/suppliers'),
        AppPage('ربط الحسابات', 'Account links', Icons.link, (c) => const PartyLinksScreen(), path: '/system/collections-dept/links'),
        AppPage('سير عمل التشغيل', 'Operations Workflow', Icons.workspaces_outline, (c) => const OpsWorkflowsScreen(), path: '/system/operations'),
        // The wallet is view-only for collections; see config/walletViewOnly on the server.
        if (const ['super_admin', 'admin', 'collections_manager', 'collections_staff', 'collections_trainee'].contains(role)) ...[
          AppPage('محفظة الفروع (عرض)', 'Branch wallets (view)', Icons.account_balance_wallet_outlined, (c) => const CashWalletScreen(), path: '/system/wallet'),
          AppPage('لوحة المحفظة (عرض)', 'Wallet dashboard (view)', Icons.pie_chart_outline, (c) => const WalletDashboardScreen(), path: '/system/wallet-dashboard'),
        ],
        if (const ['super_admin', 'admin', 'it_manager', 'collections_manager'].contains(role))
          AppPage('إعدادات القسم', 'Section Settings', Icons.tune_rounded, (c) => const CollectionsSettingsScreen(), path: '/system/collections-dept/settings'),
        if (jpMember(role, 'collections')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'collections'), path: '/system/collections-dept/jp'),
        if (jpManager(role, 'collections')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'collections'), path: '/system/collections-dept/jp-dashboard'),
        if (jpManager(role, 'collections') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/collections-dept/management-jp'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'collections', complaints: true), path: '/system/collections-dept/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'Collections'), path: '/system/collections-dept/kpis'),
      ],
    ),
    // Business review meetings: the managers/board forum. Broad `roles` because ordinary employees open it too, for work delegated to them; the screen itself shows only the tabs their tier qualifies for.
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
      roles: const [..._admins, 'administration_staff', 'bd_manager', 'administration_manager'],
      pages: [
        AppPage('لوحة المهام', 'Task Board', Icons.view_kanban_outlined, (c) => const TasksBoardScreen(), path: '/system/administration'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'administration', complaints: true), path: '/system/administration/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'Administration'), path: '/system/administration/kpis'),
        if (jpMember(role, 'administration')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'administration'), path: '/system/administration/jp'),
        if (jpManager(role, 'administration')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'administration'), path: '/system/administration/jp-dashboard'),
        if (jpManager(role, 'administration') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/administration/management-jp'),
      ],
    ),
    AppSection(
      key: 'Fleet Management', arTitle: 'إدارة الأسطول', enTitle: 'Fleet Management', icon: Icons.local_shipping_outlined,
      roles: const [..._admins, 'operations_manager', 'operations_staff', 'moderator', 'fleet_manager', 'fleet_supervisor'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: fleetDashSpec), path: '/system/fleet/dashboard'),
        AppPage('التحليلات', 'Analytics', Icons.insights_outlined, (c) => const FleetAnalyticsScreen(), path: '/system/fleet/dashboard'),
        AppPage('اللوحة الرئيسية', 'Board', Icons.grid_view_rounded, (c) => const FleetBoardScreen(), path: '/system/fleet/board'),
        // Expected arrivals: tappable cards, as on the web.
        AppPage('المتوقع للوصول', 'Expected arrivals', Icons.schedule_outlined, (c) => const FleetArrivalsScreen(), path: '/system/fleet/arrivals'),
        AppPage('الشحنات والمتابعة', 'Shipments', Icons.inventory_2_outlined, (c) => const FleetShipmentsScreen(), path: '/system/fleet'),
        AppPage('السائقون', 'Drivers', Icons.badge_outlined, (c) => ResourceScreen(config: fleetDriversCfg), path: '/system/fleet/drivers'),
        AppPage('تقييم السائقين', 'Driver KPIs', Icons.speed_outlined, (c) => const FleetDriverKpisScreen(), path: '/system/fleet/driver-kpis'),
        AppPage('السيارات', 'Vehicles', Icons.local_shipping_outlined, (c) => ResourceScreen(config: fleetVehiclesCfg), path: '/system/fleet/vehicles'),
        // Vehicle status after Cars: the two screens are about the same truck, one says what it is and the other how it is now.
        AppPage('حالة المركبات', 'Vehicle Health', Icons.monitor_heart_outlined, (c) => const FleetHealthScreen(), path: '/system/fleet/health'),
        AppPage('سجلّات السيارات', 'Vehicle Logs', Icons.assignment_outlined, (c) => const FleetVehicleLogsScreen(), path: '/system/fleet/vehicle-logs'),
        AppPage('مصاريف السوّاق', 'Driver Expenses', Icons.account_balance_wallet_outlined, (c) => const FleetDriverExpensesScreen(), path: '/system/fleet/driver-expenses'),
        // Supervisor distribution: for the section manager and anyone granted edit (canAdminFleet on the web).
        if (const ['super_admin', 'admin', 'it_manager', 'operations_manager', 'fleet_manager'].contains(role) || auth.canEditSection('Fleet Management'))
          AppPage('توزيع المشرفين', 'Assign Supervisors', Icons.manage_accounts_outlined, (c) => const FleetAssignScreen(), path: '/system/fleet/assign'),
        AppPage('العملاء', 'Customers', Icons.people_outline, (c) => ResourceScreen(config: fleetCustomersCfg), path: '/system/fleet/customers'),
        if (const ['super_admin', 'admin', 'it_manager', 'operations_manager', 'fleet_manager'].contains(role) || auth.canEditSection('Fleet Management'))
          AppPage('العملاء المؤرشفون', 'Archived Customers', Icons.archive_outlined, (c) => ResourceScreen(config: fleetCustomersArchivedCfg), path: '/system/fleet/customers'),
        if (jpMember(role, 'fleet')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'fleet'), path: '/system/fleet/jp'),
        if (jpManager(role, 'fleet')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'fleet'), path: '/system/fleet/jp-dashboard'),
        if (jpManager(role, 'fleet') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/fleet/management-jp'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'fleet', complaints: true), path: '/system/fleet/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'Fleet Management'), path: '/system/fleet/kpis'),
        AppPage('الإعدادات', 'Settings', Icons.settings_outlined, (c) => const FleetSettingsScreen(), path: '/system/fleet/settings'),
      ],
    ),
    AppSection(
      key: 'Contracts', arTitle: 'إدارة العقود', enTitle: 'Contracts', icon: Icons.history_edu_outlined,
      roles: const [..._admins, 'contracts_manager', 'operations_manager', 'contracts_staff'],
      pages: [
        AppPage('لوحة القسم', 'Dashboard', Icons.space_dashboard_outlined, (c) => const ContractsDashboardScreen(), path: '/system/contracts'),
        AppPage('سجل موردي 3PL', '3PL Vendors', Icons.business_outlined, (c) => ResourceScreen(config: contractsVendorsCfg), path: '/system/contracts/vendors'),
        AppPage('العملاء', 'Customers', Icons.handshake_outlined, (c) => ResourceScreen(config: contractsCustomersCfg), path: '/system/contracts/customers'),
        AppPage('تحليل التشغيل', 'Utilisation', Icons.insights_outlined, (c) => const ContractsAnalysisScreen(), path: '/system/contracts/analysis'),
        AppPage('تنشيط الموردين', 'Prospects', Icons.phone_in_talk_outlined, (c) => const ContractsProspectsScreen(), path: '/system/contracts/prospects'),
        AppPage('عقود الأقسام', 'Dept Contracts', Icons.folder_copy_outlined, (c) => ResourceScreen(config: contractsAgreementsCfg), path: '/system/contracts/agreements'),
        if (jpMember(role, 'contracts')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'contracts'), path: '/system/contracts/jp'),
        if (jpManager(role, 'contracts')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'contracts'), path: '/system/contracts/jp-dashboard'),
        if (jpManager(role, 'contracts') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/contracts/management-jp'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'contracts', complaints: true), path: '/system/contracts/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'Contracts'), path: '/system/contracts/kpis'),
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
        AppPage('مهام العلاقات', 'CRM Tasks', Icons.task_alt_outlined, (c) => const CrmTasksScreen(), path: '/system/crm/tasks'),
        AppPage('الأنشطة', 'Activities', Icons.history_outlined, (c) => ResourceScreen(config: crmActivitiesCfg), path: '/system/crm/activities'),
        AppPage('التقويم', 'Calendar', Icons.calendar_month_outlined, (c) => const CrmCalendarScreen(), path: '/system/crm/calendar'),
        AppPage('الموردون (3PL)', 'Vendors', Icons.local_shipping_outlined, (c) => ResourceScreen(config: crmVendorsCfg), path: '/system/crm/vendors'),
        AppPage('مؤشرات العملاء', 'Customer KPIs', Icons.leaderboard_outlined, (c) => const CrmKpisScreen(kind: 'customers'), path: '/system/crm/customer-kpis'),
        AppPage('مؤشرات الموردين', 'Vendor KPIs', Icons.insights_outlined, (c) => const CrmKpisScreen(kind: 'vendors'), path: '/system/crm/vendor-kpis'),
        if (jpMember(role, 'crm')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'crm'), path: '/system/crm/jp'),
        if (jpManager(role, 'crm')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'crm'), path: '/system/crm/jp-dashboard'),
        if (jpManager(role, 'crm') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/crm/management-jp'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'crm', complaints: true), path: '/system/crm/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'CRM'), path: '/system/crm/kpis'),
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
        if (jpMember(role, 'bd')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'bd'), path: '/system/bd/jp'),
        if (jpManager(role, 'bd')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'bd'), path: '/system/bd/jp-dashboard'),
        if (jpManager(role, 'bd') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/bd/management-jp'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'bd', complaints: true), path: '/system/bd/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'Business Development'), path: '/system/bd/kpis'),
      ],
    ),
    AppSection(
      key: 'Marketing', arTitle: 'التسويق', enTitle: 'Marketing', icon: Icons.campaign_outlined,
      roles: const [..._admins, 'marketing_manager', 'marketing_specialist', 'bd_manager'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => const MarketingDashboardScreen(), path: '/system/marketing'),
        AppPage('الحملات', 'Campaigns', Icons.flag_outlined, (c) => ResourceScreen(config: marketingCampaignsCfg), path: '/system/marketing/campaigns'),
        AppPage('الأنشطة', 'Activities', Icons.bolt_outlined, (c) => const MarketingActivitiesScreen(), path: '/system/marketing/activities'),
        AppPage('التقرير الدوري', 'Reports', Icons.assessment_outlined, (c) => const MarketingReportScreen(), path: '/system/marketing/reports'),
        if (jpMember(role, 'marketing')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'marketing'), path: '/system/marketing/jp'),
        if (jpManager(role, 'marketing')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'marketing'), path: '/system/marketing/jp-dashboard'),
        if (jpManager(role, 'marketing') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/marketing/management-jp'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'marketing', complaints: true), path: '/system/marketing/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'Marketing'), path: '/system/marketing/kpis'),
      ],
    ),
    AppSection(
      key: 'HR', arTitle: 'الموارد البشرية', enTitle: 'Human Resources', icon: Icons.groups_outlined,
      roles: const [..._admins, 'hr_manager', 'hr_specialist'],
      pages: [
        AppPage('لوحة الموارد البشرية', 'HR Dashboard', Icons.space_dashboard_outlined, (c) => const HrDashboardScreen(), path: '/system/hr/master'),
        AppPage('الموظفون', 'Employees', Icons.people_alt_outlined, (c) => const HrEmployeesScreen(), path: '/system/hr/employees'),
        // Archive: staff whose service ended and who left the system, and ended freelancers. Same as the website.
        AppPage('الأرشيف', 'Archive', Icons.archive_outlined, (c) => const HrArchiveScreen(), path: '/system/hr/archive'),
        AppPage('طلبات الإجازات', 'Leave Requests', Icons.event_available_outlined, (c) => const HrLeavesScreen(), path: '/system/hr/leaves'),
        AppPage('الإجازات', 'Leaves', Icons.event_note_outlined, (c) => const HrLeaveRegisterScreen(), path: '/system/hr/leave-register'),
        AppPage('طلبات الموظفين', 'Employee Requests', Icons.mark_email_unread_outlined, (c) => const HrRequestsScreen(), path: '/system/hr/requests'),
        // Section requests: the receiving side. See screens/staff_requests.dart.
        AppPage('طلبات الأقسام', 'Section Requests', Icons.move_to_inbox_outlined, (c) => const StaffRequestsScreen(side: 'hr'), path: '/system/hr/staff-requests'),
        // Library of official forms and letters.
        AppPage('النماذج والخطابات', 'Forms & Letters', Icons.description_outlined, (c) => const HrFormsScreen(), path: '/system/hr/forms'),
        AppPage('متابعة المالية', 'Finance Follow-up', Icons.account_balance_outlined, (c) => const HrFinanceFollowScreen(), path: '/system/hr/finance-follow'),
        AppPage('التراخيص والاشتراكات', 'Licenses', Icons.workspace_premium_outlined, (c) => ResourceScreen(config: hrLicensesCfg), path: '/system/hr/licenses'),
        AppPage('عقود الموظفين', 'Contracts', Icons.description_outlined, (c) => const HrContractsScreen(), path: '/system/hr/contracts'),
        AppPage('المخزون', 'Stock', Icons.inventory_2_outlined, (c) => ResourceScreen(config: hrStockCfg), path: '/system/hr/stock'),
        AppPage('أنواع الإجازات', 'Leave Types', Icons.event_note_outlined, (c) => ResourceScreen(config: hrLeaveTypesCfg), path: '/system/hr/leave-types'),
        if (jpMember(role, 'hr')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'hr'), path: '/system/hr/jp'),
        if (jpManager(role, 'hr')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'hr'), path: '/system/hr/jp-dashboard'),
        if (jpManager(role, 'hr') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/hr/management-jp'),
        // HR master, its groups, custody and settings, with the web guard (HR roles plus section grant).
        if (const ['super_admin', 'it_manager', 'it_specialist', 'admin', 'hr_manager', 'hr_specialist'].contains(role) || auth.canEditSection('HR')) ...[
          AppPage('ماستر الموارد البشرية', 'HR Master', Icons.grid_on_outlined, (c) => const HrMasterGridScreen(), path: '/system/hr/master/grid'),
          AppPage('انتهاءات المستندات', 'Document Expiries', Icons.event_busy_outlined, (c) => const HrExpiringScreen(), path: '/system/hr/master/expiring'),
          AppPage('الإقامات', 'Iqamas', Icons.badge_outlined, (c) => const HrMasterGroupScreen(group: 'iqama'), path: '/system/hr/master/iqama'),
          AppPage('الجوازات', 'Passports', Icons.badge_outlined, (c) => const HrMasterGroupScreen(group: 'passport'), path: '/system/hr/master/passport'),
          AppPage('التأمين الطبي', 'Medical Insurance', Icons.health_and_safety_outlined, (c) => const HrMasterGroupScreen(group: 'medicalInsurance'), path: '/system/hr/master/medicalInsurance'),
          AppPage('الشهادات الصحية', 'Health Certificates', Icons.medical_services_outlined, (c) => const HrMasterGroupScreen(group: 'healthCertificate'), path: '/system/hr/master/healthCertificate'),
          AppPage('بطاقات السائقين', 'Driver Cards', Icons.credit_card_outlined, (c) => const HrMasterGroupScreen(group: 'driverCard'), path: '/system/hr/master/driverCard'),
          AppPage('رخص القيادة', 'Driving Licences', Icons.drive_eta_outlined, (c) => const HrMasterGroupScreen(group: 'drivingLicense'), path: '/system/hr/master/drivingLicense'),
          AppPage('السجل والتأمينات الاجتماعية', 'Register & Social Insurance', Icons.shield_outlined, (c) => const HrMasterGroupScreen(group: 'socialInsurance'), path: '/system/hr/master/socialInsurance'),
          AppPage('البيانات البنكية', 'Banking', Icons.account_balance_outlined, (c) => const HrMasterGroupScreen(group: 'banking'), path: '/system/hr/master/banking'),
          AppPage('العهد', 'Custody', Icons.devices_other_outlined, (c) => const HrCustodyScreen(), path: '/system/hr/custody'),
          AppPage('إعدادات القسم', 'HR Settings', Icons.settings_outlined, (c) => const HrSettingsScreen(), path: '/system/hr/settings'),
        ],
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'hr', complaints: true), path: '/system/hr/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'HR'), path: '/system/hr/kpis'),
      ],
    ),
    AppSection(
      key: 'Location Solutions', arTitle: 'لوكيشن سوليوشن', enTitle: 'Location Solutions', icon: Icons.gps_fixed_outlined,
      roles: const [..._admins, 'operations_manager', 'operations_staff', 'moderator', 'location_manager', 'location_staff'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => const Ls2DashboardScreen()),
        AppPage('المركبات والصيانة', 'Fleet & Maintenance', Icons.local_shipping_outlined, (c) => const Ls2VehiclesScreen(), path: '/system/ls2/maintenance'),
        AppPage('الإصلاحات', 'Repairs', Icons.home_repair_service_outlined, (c) => ResourceScreen(config: ls2RepairsCfg), path: '/system/ls2/repairs'),
        AppPage('أصول الأسطول', 'Fleet Assets', Icons.tire_repair_outlined, (c) => const Ls2FleetAssetsScreen(), path: '/system/ls2/fleet-assets'),
        AppPage('مخزن النقل الثقيل', 'Store', Icons.inventory_2_outlined, (c) => const Ls2StoreScreen(), path: '/system/ls2/store'),
        if (_htOwners.contains(role)) AppPage('عهدة النقل الثقيل', 'Heavy Transport Custody', Icons.account_balance_wallet_outlined, (c) => const HtCustodyScreen(), path: '/system/ls2/custody'),
        // Who spare parts are bought from: heavy store only.
        AppPage('الموردون', 'Suppliers', Icons.storefront_outlined, (c) => const Ls2SuppliersScreen(), path: '/system/ls2/suppliers'),
        AppPage('الأسطول المباشر', 'Live Fleet', Icons.satellite_alt_outlined, (c) => const Ls2LiveScreen(), path: '/system/ls2/live'),
        AppPage('الكاوتش', 'Tires', Icons.tire_repair_outlined, (c) => const Ls2TiresScreen(), path: '/system/ls2/tires'),
        AppPage('التقارير', 'Reports', Icons.summarize_outlined, (c) => const Ls2ReportsScreen(), path: '/system/ls2/reports'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'ls2', complaints: true), path: '/system/ls2/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'Location Solutions'), path: '/system/ls2/kpis'),
        AppPage('السائقون (تتبع)', 'Drivers', Icons.badge_outlined, (c) => const Ls2DriversScreen(), path: '/system/ls2/drivers'),
        AppPage('تقييم السواقين', 'Driver Performance', Icons.speed_outlined, (c) => const Ls2DriverPerformanceScreen(), path: '/system/ls2/driver-performance'),
        AppPage('الحرارة', 'Temperature', Icons.thermostat_outlined, (c) => const Ls2TemperatureScreen(), path: '/system/ls2/temperature'),
        AppPage('التنبيهات', 'Alerts', Icons.notifications_active_outlined, (c) => const Ls2AlertsScreen(), path: '/system/ls2/alerts'),
        // A loading request on a truck with overdue maintenance, decided here by name.
        AppPage('طلبات الأسطول', 'Fleet Requests', Icons.verified_user_outlined, (c) => const Ls2FleetRequestsScreen(), path: '/system/ls2/fleet-requests'),
        AppPage('الإعدادات', 'Settings', Icons.settings_outlined, (c) => const Ls2SettingsScreen(), path: '/system/ls2/settings'),
        if (jpMember(role, 'ls2')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'ls2'), path: '/system/ls2/jp'),
        if (jpManager(role, 'ls2')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'ls2'), path: '/system/ls2/jp-dashboard'),
        if (jpManager(role, 'ls2') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/ls2/management-jp'),
      ],
    ),
    AppSection(
      key: 'Sales', arTitle: 'المبيعات', enTitle: 'Sales', icon: Icons.trending_up_outlined,
      roles: const [..._admins, 'sales_manager', 'sales_rep', 'operations_manager', 'operations_staff'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => const SalesDashboardScreen(), path: '/system/sales/dashboard'),
        // Customers: the same register as operations and shipment orders, a third entry point and not a third copy.
        AppPage('العملاء', 'Customers', Icons.people_outline, (c) => ResourceScreen(config: customersCfg), path: '/system/sales/customers'),
        AppPage('مسار البيع', 'Pipeline', Icons.view_kanban_outlined, (c) => const SalesPipelineScreen(), path: '/system/sales/pipeline'),
        AppPage('الأهداف', 'Targets', Icons.track_changes_outlined, (c) => ResourceScreen(config: salesTargetsCfg(canEdit: canSetTargets)), path: '/system/sales/targets'),
        AppPage('الأداء', 'Performance', Icons.leaderboard_outlined, (c) => const SalesPerformanceScreen(), path: '/system/sales/performance'),
        if (jpMember(role, 'sales')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'sales'), path: '/system/sales/jp'),
        if (jpManager(role, 'sales')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'sales'), path: '/system/sales/jp-dashboard'),
        if (jpManager(role, 'sales') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/sales/management-jp'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'sales', complaints: true), path: '/system/sales/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'Sales'), path: '/system/sales/kpis'),
      ],
    ),
    AppSection(
      // Finance management replaced the accounting pages. The Accounting key stays so saved permissions are not migrated; only the name and pages changed.
      key: 'Accounting', arTitle: 'الإدارة المالية', enTitle: 'Finance Management', icon: Icons.account_balance_outlined,
      roles: const [..._admins, 'cfo', 'accounting_manager', 'accountant'],
      pages: [
        AppPage('لوحة الإدارة المالية', 'Finance Overview', Icons.dashboard_outlined, (c) => const FinanceOverviewScreen(), path: '/system/finance'),
        AppPage('ماليات التشغيل', 'Operations Finance', Icons.assignment_outlined, (c) => const FinanceDeptScreen(dept: 'operations', arTitle: 'ماليات التشغيل', enTitle: 'Operations Finance'), path: '/system/finance/operations'),
        AppPage('ماليات إدارة الأسطول', 'Fleet Finance', Icons.local_shipping_outlined, (c) => const FinanceDeptScreen(dept: 'fleet', arTitle: 'ماليات إدارة الأسطول', enTitle: 'Fleet Finance'), path: '/system/finance/fleet'),
        AppPage('ماليات التخليص الجمركي', 'Customs Finance', Icons.directions_boat_outlined, (c) => const FinanceDeptScreen(dept: 'customs', arTitle: 'ماليات التخليص الجمركي', enTitle: 'Customs Finance'), path: '/system/finance/customs'),
        AppPage('ماليات النقل الخفيف', 'Light Transport Finance', Icons.two_wheeler, (c) => const FinanceDeptScreen(dept: 'light', arTitle: 'ماليات النقل الخفيف', enTitle: 'Light Transport Finance'), path: '/system/finance/light-transport'),
        AppPage('ماليات التسويق والتطوير', 'Marketing & BD Finance', Icons.campaign_outlined, (c) => const FinanceDeptScreen(dept: 'marketing', arTitle: 'ماليات التسويق والتطوير', enTitle: 'Marketing & BD Finance'), path: '/system/finance/marketing'),
        AppPage('ماليات الموارد البشرية', 'HR Finance', Icons.badge_outlined, (c) => const FinanceDeptScreen(dept: 'hr', arTitle: 'ماليات الموارد البشرية', enTitle: 'HR Finance'), path: '/system/finance/hr'),
        AppPage('الإقامات ورخص العمل', 'Iqamas & Work Permits', Icons.badge_outlined, (c) => const FinanceResidencyScreen(), path: '/system/finance/hr/residency'),
        AppPage('ماليات تقنية المعلومات', 'IT Finance', Icons.computer_outlined, (c) => const FinanceDeptScreen(dept: 'it', arTitle: 'ماليات تقنية المعلومات', enTitle: 'IT Finance'), path: '/system/finance/it'),
        AppPage('ماليات التحصيل', 'Collections Finance', Icons.request_quote_outlined, (c) => const FinanceDeptScreen(dept: 'collections', arTitle: 'ماليات التحصيل', enTitle: 'Collections Finance'), path: '/system/finance/collections'),
        AppPage('ماليات المركبات', 'Vehicles Finance', Icons.directions_car_outlined, (c) => const FinanceDeptScreen(dept: 'vehicles', arTitle: 'ماليات المركبات', enTitle: 'Vehicles Finance'), path: '/system/finance/vehicles'),
        if (jpMember(role, 'accounting')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'accounting'), path: '/system/accounting/jp'),
        if (jpManager(role, 'accounting')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'accounting'), path: '/system/accounting/jp-dashboard'),
        if (jpManager(role, 'accounting') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/accounting/management-jp'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'accounting', complaints: true), path: '/system/accounting/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'Accounting'), path: '/system/accounting/kpis'),
      ],
    ),
    AppSection(
      key: 'Procurement', arTitle: 'المشتريات', enTitle: 'Procurement', icon: Icons.shopping_bag_outlined,
      roles: const [..._admins, 'procurement_manager', 'procurement_staff'],
      pages: [
        // Procurement vendors register: was listed under operations although not part of its work.
        AppPage('الموردون', 'Vendors', Icons.store_outlined, (c) => ResourceScreen(config: vendorsCfg), path: '/system/vendors'),
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => SectionDashScreen(spec: procurementDashSpec), path: '/system/procurement/dashboard'),
        AppPage('طلبات الشراء', 'Requests', Icons.request_quote_outlined, (c) => const ProcRequestsScreen(), path: '/system/procurement/requests'),
        AppPage('أوامر الشراء', 'Orders', Icons.shopping_cart_outlined, (c) => const ProcOrdersScreen(), path: '/system/procurement/orders'),
        AppPage('فواتير الموردين', 'Bills', Icons.receipt_long_outlined, (c) => const ProcBillsScreen(), path: '/system/procurement/bills'),
        if (jpMember(role, 'procurement')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'procurement'), path: '/system/procurement/jp'),
        if (jpManager(role, 'procurement')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'procurement'), path: '/system/procurement/jp-dashboard'),
        if (jpManager(role, 'procurement') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/procurement/management-jp'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'procurement', complaints: true), path: '/system/procurement/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'Procurement'), path: '/system/procurement/kpis'),
      ],
    ),
    AppSection(
      key: 'Vehicles', arTitle: 'المركبات والتفويضات', enTitle: 'Vehicles & Authorizations', icon: Icons.directions_car_outlined,
      // The section manager and staff (config/roles.js): they were not listed here, so they did not see their own section.
      roles: const [..._admins, 'vehicles_manager', 'vehicles_staff', 'hr_manager', 'hr_specialist', 'cfo', 'accounting_manager', 'accountant'],
      pages: [
        // Vehicles, authorizations and accidents: the screens exist (vehicles_suite) but were not in the menu.
        // The vehicles manager holds both custody ledgers without the two sections they live in.
        if (role == 'vehicles_manager') AppPage('عهدة النقل الثقيل', 'Heavy Transport Custody', Icons.account_balance_wallet_outlined, (c) => const HtCustodyScreen(), path: '/system/ls2/custody'),
        if (role == 'vehicles_manager') AppPage('عهدة النقل الخفيف', 'Light Transport Custody', Icons.account_balance_wallet_outlined, (c) => const LtCustodyScreen(), path: '/system/b2c/light-transport/custody'),
        AppPage('لوحة المركبات', 'Vehicles Dashboard', Icons.dashboard_outlined, (c) => const SectionDashScreen(spec: vehiclesDashSpec), path: '/system/vehicles/dashboard'),
        AppPage('المركبات والتفويضات', 'Vehicles', Icons.directions_car_filled_outlined, (c) => const VehiclesListScreen(), path: '/system/vehicles'),
        AppPage('الحوادث', 'Accidents', Icons.car_crash_outlined, (c) => const AccidentsListScreen(), path: '/system/vehicles/accidents'),
        AppPage('تحليلات المركبات', 'Registry Analytics', Icons.insights_outlined, (c) => const VehicleRegistryDashboardScreen(), path: '/system/vehicles/registry/dashboard'),
        AppPage('سجل المركبات', 'Vehicle Registry', Icons.directions_car_outlined, (c) => const VehicleRegistryListScreen(), path: '/system/vehicles/registry'),
        // One page per document family, as on the website.
        // Their data was all stored but had no column to show it: filtering on the operating card gives the right vehicles without any card number. One combined screen would exceed forty fields, unreadable on a phone.
        AppPage('تأمين المركبات', 'Vehicle Insurance', Icons.shield_outlined, (c) => VehicleDocumentsScreen(family: vehicleInsuranceFamily), path: '/system/vehicles/registry/insurance/vehicles'),
        AppPage('بطاقات التشغيل', 'Operating Cards', Icons.credit_card_outlined, (c) => VehicleDocumentsScreen(family: vehicleOperatingCardFamily), path: '/system/vehicles/registry/operating-cards'),
        AppPage('التفاويض', 'Authorisations', Icons.assignment_ind_outlined, (c) => VehicleDocumentsScreen(family: vehicleAuthorizationFamily), path: '/system/vehicles/registry/authorizations'),
        AppPage('بترو اب — شرائح الوقود', 'Petro App Cards', Icons.local_gas_station_outlined, (c) => VehicleDocumentsScreen(family: vehicleFuelCardFamily), path: '/system/vehicles/registry/fuel-cards'),
        AppPage('أجهزة التتبّع GPS', 'GPS Devices', Icons.satellite_alt_outlined, (c) => VehicleDocumentsScreen(family: vehicleGpsFamily), path: '/system/vehicles/registry/gps'),
        AppPage('رخص السير', 'Vehicle Licences', Icons.description_outlined, (c) => VehicleDocumentsScreen(family: vehicleLicenceFamily), path: '/system/vehicles/registry/licenses'),
        AppPage('الفحص الدوري', 'Periodic Inspection', Icons.fact_check_outlined, (c) => VehicleDocumentsScreen(family: vehicleInspectionFamily), path: '/system/vehicles/registry/inspection'),
        if (const ['super_admin', 'it_manager', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_staff', 'hr_manager', 'hr_specialist', 'cfo', 'accounting_manager', 'accountant'].contains(role)) ...[
          AppPage('نظرة شاملة', 'Overview', Icons.grid_view_outlined, (c) => const VehicleRegistryOverviewScreen(), path: '/system/vehicles/registry/overview'),
          AppPage('الحوادث والمطالبات', 'Accidents & Claims', Icons.car_crash_outlined, (c) => const VehicleClaimsScreen(), path: '/system/vehicles/registry/claims'),
          AppPage('وثائق تأمين الشركة', 'Company Policies', Icons.verified_user_outlined, (c) => const VehicleCorporatePoliciesScreen(), path: '/system/vehicles/registry/corporate'),
          AppPage('سجلّات القسم', 'Registers', Icons.inventory_2_outlined, (c) => const VehicleRecordsScreen(), path: '/system/vehicles/registry/records'),
        ],
        if (const ['super_admin', 'it_manager', 'admin', 'vehicles_manager', 'vehicles_staff', 'hr_manager', 'hr_specialist'].contains(role))
          AppPage('بطاقات السائقين', 'Driver Cards', Icons.badge_outlined, (c) => const VehicleDriverCardsScreen(), path: '/system/vehicles/driver-cards'),
        AppPage('الانتهاءات والتجديد', 'Expiries & Renewals', Icons.event_available_outlined, (c) => const VehicleRegistryAlertsScreen(), path: '/system/vehicles/registry/expiring'),
        if (const ['super_admin', 'admin', 'it_manager', 'vehicles_manager'].contains(role))
          AppPage('إعدادات القسم', 'Section Settings', Icons.settings_outlined, (c) => const VehicleRegistrySettingsScreen(), path: '/system/vehicles/settings'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'vehicles', complaints: true), path: '/system/vehicles/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'Vehicles'), path: '/system/vehicles/kpis'),
        if (jpMember(role, 'vehicles')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'vehicles'), path: '/system/vehicles/jp'),
        if (jpManager(role, 'vehicles')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'vehicles'), path: '/system/vehicles/jp-dashboard'),
        if (jpManager(role, 'vehicles') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/vehicles/management-jp'),
      ],
    ),
    AppSection(
      key: 'Customs', arTitle: 'التخليص الجمركي', enTitle: 'Customs', icon: Icons.directions_boat_outlined,
      roles: const [..._admins, 'operations_manager', 'customs_manager', 'customs_officer'],
      pages: [
        // Section dashboard for the whole team with no financial figures; analytics (profit) is for management only, and the server returns 403 to anyone except the system admin and section manager.
        AppPage('لوحة القسم', 'Section Dashboard', Icons.space_dashboard_outlined, (c) => const CustomsDashboardScreen(), path: '/system/customs/dashboard'),
        if (_top.contains(role) || role == 'customs_manager') AppPage('تحليلات قسم التخليص', 'Customs Analytics', Icons.insights_outlined, (c) => const CustomsAnalyticsScreen(), path: '/system/customs/analytics'),
        AppPage('الدليل', 'Guide', Icons.menu_book_outlined, (c) => const CustomsGuideScreen(), path: '/system/customs/guide'),
        AppPage('التخليص الجمركي', 'Clearances', Icons.directions_boat_outlined, (c) => const CustomsListScreen(), path: '/system/customs'),
        if (const ['super_admin', 'admin', 'it_manager', 'customs_manager'].contains(role))
          AppPage('إعدادات القسم', 'Section Settings', Icons.tune_outlined, (c) => const CustomsSettingsScreen(), path: '/system/customs/settings'),
        AppPage('العملاء', 'Customers', Icons.people_outline, (c) => ResourceScreen(config: customsCustomersCfg), path: '/system/customs/customers'),
        AppPage('وكلاء الشحن', 'Shipping Agents', Icons.anchor_outlined, (c) => ResourceScreen(config: customsAgentsCfg), path: '/system/customs/agents'),
        AppPage('الناقلون', 'Carriers', Icons.local_shipping_outlined, (c) => ResourceScreen(config: customsCarriersCfg), path: '/system/customs/carriers'),
        AppPage('العقود', 'Contracts', Icons.assignment_outlined, (c) => ResourceScreen(config: customsContractsCfg), path: '/system/customs/contracts'),
        if (jpMember(role, 'customs')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'customs'), path: '/system/customs/jp'),
        if (jpManager(role, 'customs')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'customs'), path: '/system/customs/jp-dashboard'),
        if (jpManager(role, 'customs') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/customs/management-jp'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'customs', complaints: true), path: '/system/customs/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'Customs'), path: '/system/customs/kpis'),
      ],
    ),
    AppSection(
      key: 'Software & IT', arTitle: 'البرمجيات وتقنية المعلومات', enTitle: 'Software & IT', icon: Icons.computer_outlined,
      roles: const [..._admins],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => const ItDashboardScreen(), path: '/system/it'),
        AppPage('التذاكر والمشكلات', 'Tickets', Icons.confirmation_number_outlined, (c) => const ItTicketsScreen(), path: '/system/it/tickets'),
        AppPage('المشاكل المتكررة', 'Recurring', Icons.repeat_rounded, (c) => const ItRecurringScreen(), path: '/system/it/recurring'),
        AppPage('عهد الأجهزة', 'Custody', Icons.devices_other_outlined, (c) => const ItCustodyScreen(), path: '/system/it/custody'),
        AppPage('سجل حركة العهد', 'Custody Log', Icons.history, (c) => const ItCustodyLogScreen(), path: '/system/it/custody-log'),
        AppPage('الأنظمة والخدمات', 'Systems', Icons.dns_outlined, (c) => ResourceScreen(config: itSystemsCfg), path: '/system/it/systems'),
        AppPage('بريد الشركة', 'Company Email', Icons.mail_outline, (c) => const ItEmailsScreen(), path: '/system/it/emails'),
        AppPage('مستودع الأجهزة', 'IT Stock', Icons.inventory_outlined, (c) => const ItStockScreen(), path: '/system/it/stock'),
        if (jpMember(role, 'it')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'it'), path: '/system/it/jp'),
        if (jpManager(role, 'it')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'it'), path: '/system/it/jp-dashboard'),
        if (jpManager(role, 'it') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/it/management-jp'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'it', complaints: true), path: '/system/it/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'Software & IT'), path: '/system/it/kpis'),
      ],
    ),
    AppSection(
      key: 'Operations Platform', arTitle: 'منصة العمليات', enTitle: 'Operations Platform', icon: Icons.hub_outlined,
      roles: const [..._admins, 'moderator', 'employee', 'operations_manager', 'operations_staff', 'procurement_staff', 'hr_manager', 'hr_specialist', 'ops_platform_manager', 'ops_platform_staff'],
      pages: [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => const OpsDashboardScreen()),
        for (final cfg in opsResources)
          AppPage(cfg.ar, cfg.en, cfg.icon, (c) => OpsResourceScreen(cfg: cfg)),
        if (jpMember(role, 'ops')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'ops'), path: '/system/ops/jp'),
        if (jpManager(role, 'ops')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'ops'), path: '/system/ops/jp-dashboard'),
        if (jpManager(role, 'ops') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/ops/management-jp'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'ops', complaints: true), path: '/system/ops/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'Operations Platform'), path: '/system/ops/kpis'),
      ],
    ),
    AppSection(
      key: 'Shipment Orders', arTitle: 'طلبات الشحنات', enTitle: 'Shipment Orders', icon: Icons.assignment_outlined,
      roles: const [..._admins, 'operations_manager', 'operations_staff', 'moderator', 'shipment_orders_manager', 'shipment_orders_staff', 'shipment_orders_followup'],
      pages: [
        // Section dashboard first, as on the web: how it is doing today, before the table.
        AppPage('لوحة الشحنات', 'Dashboard', Icons.dashboard_outlined, (c) => const ShipmentOrdersDashboardScreen(), path: '/system/shipment-orders/dashboard'),
        AppPage('الشحنات', 'Orders', Icons.assignment_outlined, (c) => const ShipmentOrdersScreen(), path: '/system/shipment-orders'),
        AppPage('مساعد الإنشاء', 'Create Assistant', Icons.smart_toy_outlined, (c) => const ShipmentOrdersChatScreen(), path: '/system/shipment-orders/chat'),
        AppPage('التحليلات', 'Analytics', Icons.bar_chart, (c) => const ShipmentOrdersAnalyticsScreen(), path: '/system/shipment-orders/analytics'),
        AppPage('الموردون والمركبات', 'Suppliers & Vehicles', Icons.local_shipping_outlined, (c) => const ShipmentOrdersFleetScreen(), path: '/system/shipment-orders/fleet'),
        AppPage('العملاء', 'Customers', Icons.people_outline, (c) => ResourceScreen(config: customersCfg), path: '/system/shipment-orders/customers'),
        AppPage('الموردون', 'Suppliers', Icons.business_outlined, (c) => ResourceScreen(config: shipmentOrdersSuppliersCfg), path: '/system/shipment-orders/fleet'),
        AppPage('الشاحنات', 'Vehicles', Icons.local_shipping_outlined, (c) => ResourceScreen(config: shipmentOrdersVehiclesCfg), path: '/system/shipment-orders/fleet'),
        // Driver: a third register in the same page on the web (a tab), a screen here.
        AppPage('السوّاق', 'Drivers', Icons.badge_outlined, (c) => ResourceScreen(config: shipmentOrdersDriversCfg), path: '/system/shipment-orders/fleet'),
        if (const ['super_admin', 'admin', 'operations_manager'].contains(role))
          AppPage('الصلاحيات', 'Permissions', Icons.verified_user_outlined, (c) => const ShipmentBranchAccessScreen(), path: '/system/shipment-orders/permissions'),
        if (const ['super_admin', 'admin', 'it_manager', 'operations_manager', 'shipment_orders_manager'].contains(role) || auth.canEditSection('Shipment Orders'))
          AppPage('إعدادات القسم', 'Section Settings', Icons.tune_outlined, (c) => const ShipmentOrdersSettingsScreen(), path: '/system/shipment-orders/settings'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'shipment-orders', complaints: true), path: '/system/shipment-orders/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'Shipment Orders'), path: '/system/shipment-orders/kpis'),
        if (jpMember(role, 'shipment-orders')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'shipment-orders'), path: '/system/shipment-orders/jp'),
        if (jpManager(role, 'shipment-orders')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'shipment-orders'), path: '/system/shipment-orders/jp-dashboard'),
        if (jpManager(role, 'shipment-orders') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/shipment-orders/management-jp'),
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
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'remote', complaints: true), path: '/system/remote/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'Remote'), path: '/system/remote/kpis'),
        if (jpMember(role, 'remote')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'remote'), path: '/system/remote/jp'),
        if (jpManager(role, 'remote')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'remote'), path: '/system/remote/jp-dashboard'),
        if (jpManager(role, 'remote') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/remote/management-jp'),
      ],
    ),
    AppSection(
      key: 'B2C', arTitle: 'B2C', enTitle: 'B2C', icon: Icons.storefront_outlined,
      // The backend serves B2C data to super_admin/admin plus B2C heads only, so it is not shown to IT (they saw the section with zero data); the scope is matched exactly.
      // The two supervisors (operations and duty check) enter the section for their three pages only: order entries in their projects, and the duty check and its log, as on the website.
      roles: const ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead', 'b2c_rep_supervisor', 'b2c_inspection_supervisor'],
      pages: _b2cSupervisors.contains(role) ? [
        AppPage('مدخلات الأوردرات', 'Orders Entry', Icons.edit_calendar_outlined, (c) => const B2cDailyEntryScreen(), path: '/system/b2c/daily-entry'),
        AppPage('متابعة مناديب أمازون', 'Amazon Reps Attendance', Icons.how_to_reg_outlined, (c) => const B2cAmazonAttendanceScreen(), path: '/system/b2c/amazon-attendance'),
        // Media Go complaints: screen-fault reports on the tankers, seen and answered by the Media Go account.
        AppPage('شكاوى Media Go', 'Media Go Complaints', Icons.connected_tv_outlined, (c) => const MediaGoComplaintsScreen(), path: '/system/b2c/mediago-complaints'),
        AppPage('المحتوى الإعلاني', 'Ad Content', Icons.movie_outlined, (c) => const MediaGoAdsScreen(), path: '/system/b2c/mediago-ads'),
        AppPage('تفقّد بداية الدوام', 'Duty Start Check', Icons.photo_camera_outlined, (c) => const B2cDutyScreen(), path: '/system/b2c/duty/start'),
        AppPage('سجل التفقّد', 'Duty Register', Icons.fact_check_outlined, (c) => const B2cDutyRegisterScreen(), path: '/system/b2c/duty'),
      ] : [
        AppPage('اللوحة', 'Dashboard', Icons.dashboard_outlined, (c) => const B2cDashboardScreen(), path: '/system/b2c/dashboard'),
        AppPage('المشاريع', 'Projects', Icons.folder_special_outlined, (c) => ResourceScreen(config: b2cProjectsCfg), path: '/system/b2c/projects'),
        AppPage('مدخلات الأوردرات', 'Orders Entry', Icons.edit_calendar_outlined, (c) => const B2cDailyEntryScreen(), path: '/system/b2c/daily-entry'),
        AppPage('متابعة مناديب أمازون', 'Amazon Reps Attendance', Icons.how_to_reg_outlined, (c) => const B2cAmazonAttendanceScreen(), path: '/system/b2c/amazon-attendance'),
        // Media Go complaints: screen-fault reports on the tankers, seen and answered by the Media Go account.
        AppPage('شكاوى Media Go', 'Media Go Complaints', Icons.connected_tv_outlined, (c) => const MediaGoComplaintsScreen(), path: '/system/b2c/mediago-complaints'),
        AppPage('المحتوى الإعلاني', 'Ad Content', Icons.movie_outlined, (c) => const MediaGoAdsScreen(), path: '/system/b2c/mediago-ads'),
        // Start-of-shift duty check: the first thing opened in the morning, so it is placed before the rest.
        // The supervisor opens it standing at the station, not at a desk, so the phone is its natural place.
        AppPage('تفقّد بداية الدوام', 'Duty Start Check', Icons.photo_camera_outlined, (c) => const B2cDutyScreen(), path: '/system/b2c/duty/start'),
        // The log after it: the supervisor screen performs the check, and this one is read.
        AppPage('سجل التفقّد', 'Duty Register', Icons.fact_check_outlined, (c) => const B2cDutyRegisterScreen(), path: '/system/b2c/duty'),
        // Department store: the same screen with a different scope; the store mechanism is shared but its items and balances are separate from the heavy transport store.
        AppPage('المخزن', 'Store', Icons.inventory_2_outlined,
            (c) => const Ls2StoreScreen(
                  base: '/api/light-transport/store',
                  titleAr: 'مخزن النقل الخفيف',
                  titleEn: 'Light Transport Store',
                  // Department vehicles and projects, not heavy transport trucks.
                  vehiclesKind: 'light',
                ),
            path: '/system/b2c/light-transport/store'),
        // Department custody: cash, purchases card and workshop; replaced project custody.
        if (_ltOwners.contains(role)) AppPage('عهدة النقل الخفيف', 'Light Transport Custody', Icons.account_balance_wallet_outlined, (c) => const LtCustodyScreen(), path: '/system/b2c/light-transport/custody'),
        // Department project vehicles: a window on the vehicles register itself, the actual driver and the authorization.
        if (_ltOwners.contains(role)) AppPage('مركبات النقل الخفيف', 'Light Transport Vehicles', Icons.local_shipping_outlined, (c) => const B2cVehiclesScreen(), path: '/system/b2c/vehicles'),
        // The department reports to HR what it saw in the field: the sending side.
        AppPage('طلبات الموارد البشرية', 'HR Requests', Icons.send_outlined, (c) => const StaffRequestsScreen(side: 'section', section: 'B2C'), path: '/system/b2c/hr-requests'),
        // The whole section register, not only report reps.
        // Sales reps used to read B2CRep, those with order reports, so supervisors, mechanics and cleaners were missing (eleven of 161). That page became order analysis on the web.
        AppPage('موظفون النقل الخفيف', 'Light-transport Employees', Icons.two_wheeler_outlined, (c) => const LightTransportListScreen(), path: '/system/b2c/light-transport'),
        // User rentals: counted in total reps on the section dashboard. Same as the website.
        if (const ['super_admin', 'admin', 'it_manager', 'it_specialist', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead', 'cfo', 'accounting_manager', 'accountant'].contains(role)) AppPage('تأجير اليوزرات', 'User Rentals', Icons.key_outlined, (c) => ResourceScreen(config: ltUserRentalsCfg(canWrite: true, canDelete: const ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy'].contains(role))), path: '/system/b2c/user-rentals'),
        AppPage('أوامر التشغيل', 'Operating Orders', Icons.assignment_ind_outlined, (c) => const LtOperatingOrdersScreen(), path: '/system/b2c/orders'),
        AppPage('تحليل الأوردرات', 'Orders Analysis', Icons.insights_outlined, (c) => const B2cOrdersAnalysisScreen(), path: '/system/b2c/orders-analysis'),
        // Housing and dropdown lists, as in section settings on the web.
        AppPage('إعدادات القسم', 'B2C settings', Icons.home_work_outlined, (c) => const LightTransportHousingScreen(), path: '/system/b2c/settings'),
        // Delivery app accounts: a tab in section settings on the web; unlinked ones are reviewed.
        AppPage('حسابات التطبيق', 'App accounts', Icons.sports_motorsports_outlined, (c) => ResourceScreen(config: b2cRepsCfg(canEdit: _ltOwners.contains(role))), path: '/system/b2c/settings'),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'b2c', complaints: true), path: '/system/b2c/complaints'),
        AppPage('تقييم الأداء', 'KPIs', Icons.leaderboard_outlined, (c) => const TeamBoardScreen(section: 'B2C'), path: '/system/b2c/kpis'),
        if (jpMember(role, 'b2c')) AppPage('خطّة العمل (JP)', 'JP', Icons.event_available_outlined, (c) => const JpScreen(section: 'b2c'), path: '/system/b2c/jp'),
        if (jpManager(role, 'b2c')) AppPage('لوحة JP', 'JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(section: 'b2c'), path: '/system/b2c/jp-dashboard'),
        if (jpManager(role, 'b2c') && !_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.workspace_premium_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/b2c/management-jp'),
      ],
    ),
    AppSection(
      key: 'Performance', arTitle: 'تقييم الأداء', enTitle: 'Performance', icon: Icons.military_tech_outlined,
      roles: const ['super_admin', 'admin'], managed: false,
      pages: [
        AppPage('نظرة كل الأقسام', 'All Departments', Icons.insights_outlined, (c) => const PerformanceOverviewScreen(), path: '/system/performance/overview'),
        AppPage('التقييمات', 'Evaluations', Icons.rate_review_outlined, (c) => const EvaluationsScreen(), path: '/system/performance'),
        AppPage('طلبات التعديل', 'Edit Requests', Icons.inbox_outlined, (c) => const PerformanceEditRequestsScreen(), path: '/system/performance/requests'),
        AppPage('إعداد المؤشرات', 'Configure', Icons.tune_outlined, (c) => const PerformanceSettingsScreen(), path: '/system/performance/settings'),
      ],
    ),
    AppSection(
      key: 'Executive', arTitle: 'النظرة التنفيذية', enTitle: 'Executive', icon: Icons.insights_outlined,
      roles: const ['super_admin', 'admin'], managed: false,
      pages: [
        AppPage('النظرة التنفيذية', 'Overview', Icons.insights_outlined, (c) => const ExecutiveOverviewScreen()),
        // Top management plan to department managers; its dashboard is for the system admin only.
        if (_top.contains(role)) AppPage('خطّة الإدارة (Management JP)', 'Management JP', Icons.event_available_outlined, (c) => const JpScreen(scope: 'management'), path: '/system/management-jp'),
        if (_top.contains(role)) AppPage('لوحة خطّة الإدارة', 'Management JP Dashboard', Icons.insights_outlined, (c) => const JpDashScreen(scope: 'management'), path: '/system/management-jp/dashboard'),
      ],
    ),
    AppSection(
      key: 'AdminTools', arTitle: 'الإدارة', enTitle: 'Admin', icon: Icons.admin_panel_settings_outlined,
      // As on the web: the IT specialist sees users, permissions, the audit log and documentation.
      roles: const ['super_admin', 'admin', 'it_manager', 'it_specialist'], managed: false,
      pages: [
        AppPage('المستخدمون', 'Users', Icons.group_outlined, (c) => const AdminUsersScreen()),
        AppPage('الصلاحيات', 'Permissions', Icons.lock_person_outlined, (c) => const PermissionsScreen()),
        AppPage('الفروع', 'Branches', Icons.store_mall_directory_outlined, (c) => ResourceScreen(config: branchesCfg)),
        AppPage('سجل التدقيق', 'Audit Log', Icons.fact_check_outlined, (c) => const AdminAuditScreen(), path: '/system/audit'),
        AppPage('الشكاوى', 'Complaints', Icons.forum_outlined, (c) => const AdminComplaintsScreen(), path: '/system/complaints'),
        AppPage('البيانات المرجعية', 'Reference Data', Icons.list_alt_outlined, (c) => const ReferenceDataScreen()),
        // API documentation: the internal surface is guarded by the server with FULL_ACCESS_ROLES.
        if (const ['super_admin', 'admin', 'it_manager', 'it_specialist'].contains(role))
          AppPage('توثيق الـ API', 'API Docs', Icons.menu_book_outlined, (c) => const ApiDocsScreen(), path: '/system/api-docs'),
      ],
    ),
    // Customer/supplier portal: outside partners. `client` is the external role, and it appears in NO other section, so a partner's drawer is just this.
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
  // The Media Go account has no section: it enters its screen directly (main.dart) and has no drawer.
  if (role == mediagoRole) return const [];
  // Pages are filtered inside the section.
  // The section opens, then pages closed for this role are removed; a section left with no pages is dropped entirely, since a card opening on nothing is worse than none.
  final visible = all.where(allowed).map((s) {
    final pages = s.pages.where((p) => auth.canAccessPage(p.path)).toList();
    if (pages.length == s.pages.length) return s;
    return AppSection(
      key: s.key, arTitle: s.arTitle, enTitle: s.enTitle, icon: s.icon,
      roles: s.roles, managed: s.managed, pages: pages,
    );
  }).where((s) => s.pages.isNotEmpty).toList();

  // Order is stated, not left to code order.
  // Sections used to appear in the order written in this list, so screen order was a side effect of file order: adding a section in its natural place made it jump on screen unintentionally. This is the same order as the website; app and site are one thing.
  visible.sort((a, b) {
    final ia = _sectionOrder.indexOf(a.key);
    final ib = _sectionOrder.indexOf(b.key);
    if (ia == -1 && ib == -1) return 0;
    if (ia == -1) return 1;                 // Unlisted sections come after the listed ones.
    if (ib == -1) return -1;
    return ia.compareTo(ib);
  });
  return visible;
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
      // Assistant: answers questions about anything in the system. Its topics and permissions come from the reports center itself, so it knows nothing on its own and shows nobody what they cannot access.
      AppPage('المساعد', 'Assistant', Icons.auto_awesome_outlined, (c) => const AssistantScreen(), path: '/system/assistant'),
      AppPage('إجازاتي', 'My Leaves', Icons.beach_access_outlined, (c) => const MyLeavesScreen()),
      AppPage('طلباتي', 'My Requests', Icons.description_outlined, (c) => const MyRequestsScreen()),
      if (hasTeam) AppPage('موافقات فريقي', 'Team Approvals', Icons.fact_check_outlined, (c) => const ApprovalsScreen()),
      if (hasTeam) AppPage('تقييم فريقي', 'Evaluate Team', Icons.rate_review_outlined, (c) => const EvaluationsScreen()),
      AppPage('الإعدادات', 'Settings', Icons.settings_outlined, (c) => const SettingsScreen()),
    ];
