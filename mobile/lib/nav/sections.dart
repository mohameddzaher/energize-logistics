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
        AppPage('اللوحة الرئيسية', 'Board', Icons.grid_view_rounded, (c) => const FleetBoardScreen()),
        AppPage('الشحنات والمتابعة', 'Shipments', Icons.inventory_2_outlined, (c) => const FleetShipmentsScreen()),
        AppPage('السائقون', 'Drivers', Icons.badge_outlined, (c) => ResourceScreen(config: fleetDriversCfg)),
        AppPage('السيارات', 'Vehicles', Icons.local_shipping_outlined, (c) => ResourceScreen(config: fleetVehiclesCfg)),
        AppPage('العملاء', 'Customers', Icons.people_outline, (c) => ResourceScreen(config: fleetCustomersCfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'fleet')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'fleet', complaints: true)),
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
      ],
    ),
    AppSection(
      key: 'CRM', arTitle: 'إدارة العلاقات', enTitle: 'CRM', icon: Icons.handshake_outlined,
      roles: const [..._admins, 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations'],
      pages: [
        AppPage('الشركات', 'Companies', Icons.apartment_outlined, (c) => ResourceScreen(config: crmCompaniesCfg)),
        AppPage('جهات الاتصال', 'Contacts', Icons.contact_phone_outlined, (c) => ResourceScreen(config: crmContactsCfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'crm')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'crm', complaints: true)),
      ],
    ),
    AppSection(
      key: 'Business Development', arTitle: 'تطوير الأعمال', enTitle: 'Business Development', icon: Icons.rocket_launch_outlined,
      roles: const [..._admins, 'bd_manager', 'bd_specialist', 'sales_manager', 'crm_manager', 'operations_manager'],
      pages: [
        AppPage('الفرص الاستراتيجية', 'Opportunities', Icons.explore_outlined, (c) => ResourceScreen(config: bdOpportunitiesCfg)),
        AppPage('الشراكات', 'Partners', Icons.handshake_outlined, (c) => ResourceScreen(config: bdPartnersCfg)),
        AppPage('المناقصات', 'Tenders', Icons.gavel_outlined, (c) => ResourceScreen(config: bdTendersCfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'bd')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'bd', complaints: true)),
      ],
    ),
    AppSection(
      key: 'Marketing', arTitle: 'التسويق', enTitle: 'Marketing', icon: Icons.campaign_outlined,
      roles: const [..._admins, 'marketing_manager', 'marketing_specialist', 'bd_manager'],
      pages: [
        AppPage('الحملات', 'Campaigns', Icons.flag_outlined, (c) => ResourceScreen(config: marketingCampaignsCfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'marketing')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'marketing', complaints: true)),
      ],
    ),
    AppSection(
      key: 'Workshop', arTitle: 'الورشة', enTitle: 'Workshop', icon: Icons.handyman_outlined,
      roles: const [..._admins, 'workshop_manager', 'workshop_employee', 'purchasing'],
      pages: [
        AppPage('المشتريات', 'Purchases', Icons.shopping_cart_outlined, (c) => ResourceScreen(config: workshopPurchasesCfg)),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'workshop')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'workshop', complaints: true)),
      ],
    ),
    AppSection(
      key: 'HR', arTitle: 'الموارد البشرية', enTitle: 'Human Resources', icon: Icons.groups_outlined,
      roles: const [..._admins, 'hr_manager', 'hr_specialist'],
      pages: [
        AppPage('لوحة الموارد البشرية', 'HR Dashboard', Icons.space_dashboard_outlined, (c) => const HrDashboardScreen()),
        AppPage('الموظفون', 'Employees', Icons.people_alt_outlined, (c) => const HrEmployeesScreen()),
        AppPage('مهامي', 'My Tasks', Icons.checklist_rounded, (c) => const SectionWorkScreen(section: 'hr')),
        AppPage('الشكاوى', 'Complaints', Icons.report_outlined, (c) => const SectionWorkScreen(section: 'hr', complaints: true)),
      ],
    ),
    AppSection(
      key: 'Location Solutions', arTitle: 'لوكيشن سوليوشن', enTitle: 'Location Solutions', icon: Icons.gps_fixed_outlined,
      roles: const [..._admins, 'operations_manager', 'operations', 'workshop_manager', 'moderator'],
      pages: [
        AppPage('المركبات والصيانة', 'Fleet & Maintenance', Icons.local_shipping_outlined, (c) => const Ls2VehiclesScreen()),
      ],
    ),
  ];

  return all.where(allowed).toList();
}

/// Self-service — every signed-in employee, no gating.
List<AppPage> selfServicePages(bool hasTeam) => [
      AppPage('إجازاتي', 'My Leaves', Icons.beach_access_outlined, (c) => const MyLeavesScreen()),
      AppPage('طلباتي', 'My Requests', Icons.description_outlined, (c) => const MyRequestsScreen()),
      if (hasTeam) AppPage('موافقات فريقي', 'Team Approvals', Icons.fact_check_outlined, (c) => const ApprovalsScreen()),
    ];
