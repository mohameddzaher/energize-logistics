import 'package:flutter/material.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../ui/theme.dart';

/// نظرة الصفحة الرئيسية المخصّصة حسب الدور — كل دور يرى مؤشرات قسمه الحية
/// مسحوبة من نفس نقطة نهاية اللوحة التي يستخدمها القسم.

class HomeKpi {
  final String ar, en, path; // path يدعم التداخل: 'kpis.open'
  final IconData icon;
  final Color color;
  final bool money;
  const HomeKpi(this.ar, this.en, this.path, this.icon, this.color, {this.money = false});
}

class HomeInsight {
  final String arTitle, enTitle, endpoint, liveEvent;
  final List<HomeKpi> kpis;
  const HomeInsight(this.arTitle, this.enTitle, this.endpoint, this.liveEvent, this.kpis);
}

// ── نظرات جاهزة لكل مجال ─────────────────────────────────────────────────────
const _finance = HomeInsight('نظرة مالية', 'Finance snapshot', '/api/analytics/dashboard', 'invoice:updated', [
  HomeKpi('المستحق', 'Outstanding', 'totalOutstanding', Icons.account_balance_wallet_outlined, T.danger, money: true),
  HomeKpi('تحصيل الشهر', 'Collected', 'monthlyCollected', Icons.trending_up_rounded, T.success, money: true),
  HomeKpi('فواتير متأخرة', 'Overdue', 'overdueCount', Icons.warning_amber_outlined, T.orange),
  HomeKpi('نسبة التحصيل %', 'Collection %', 'collectionRate', Icons.percent_rounded, T.violet),
]);

// ما لنا وما علينا — أوّلُ ما يُسأل عنه في التحصيل.
// ── ولا «ما علينا» لمن يُحصِّل ────────────────────────────────────────────
// القسمُ يُحصِّل، وما ندفعه للموردين شأنُ الإدارة والمالية. فنظرتُهم على وجهٍ
// واحد — وللإدارة نظرتُها الكاملة في لوحة القسم.
const _collections = HomeInsight('نظرة التحصيل', 'Collections snapshot', '/api/collections-dept/dashboard', 'collections:party', [
  HomeKpi('المستحق لنا', 'Receivable', 'customers.outstanding', Icons.call_received_rounded, T.danger, money: true),
  HomeKpi('المحصَّل', 'Collected', 'customers.settled', Icons.task_alt_rounded, T.success, money: true),
  HomeKpi('كشوف لم تُحصَّل', 'Uncollected', 'customers.openReports', Icons.pending_actions_outlined, T.info),
  HomeKpi('إجمالي المبيعات', 'Total billed', 'customers.total', Icons.receipt_long_outlined, T.navy, money: true),
]);

const _fleet = HomeInsight('نظرة الأسطول', 'Fleet snapshot', '/api/fleet/dashboard', 'fleet:updated', [
  HomeKpi('حمولات اليوم', 'Today', 'shipmentsToday', Icons.today_outlined, T.navy),
  HomeKpi('متابعات اليوم', 'Follow-ups', 'followupsToday', Icons.phone_in_talk_outlined, T.orange),
  HomeKpi('سائقون يعملون', 'Working drivers', 'drivers.working', Icons.badge_outlined, T.success),
  HomeKpi('حمولات الأسبوع', 'This week', 'shipmentsWeek', Icons.date_range_outlined, T.info),
]);

const _workshop = HomeInsight('نظرة الورشة', 'Workshop snapshot', '/api/workshop/dashboard', 'maintenance:updated', [
  HomeKpi('طلبات مفتوحة', 'Open', 'kpis.open', Icons.pending_actions_outlined, T.warn),
  HomeKpi('قيد التنفيذ', 'In progress', 'kpis.inProgress', Icons.engineering_outlined, T.info),
  HomeKpi('مكتملة', 'Completed', 'kpis.completed', Icons.check_circle_outline, T.success),
  HomeKpi('مشتريات معلقة', 'Pending buys', 'kpis.pendingPurchases', Icons.shopping_bag_outlined, T.orange),
]);

const _crm = HomeInsight('نظرة العلاقات', 'CRM snapshot', '/api/crm/dashboard', 'crm:company', [
  HomeKpi('صفقات مفتوحة', 'Open deals', 'openDealsCount', Icons.work_outline, T.orange),
  HomeKpi('قيمة المسار', 'Pipeline', 'pipelineValue', Icons.timeline_outlined, T.violet, money: true),
  HomeKpi('مهام متأخرة', 'Overdue tasks', 'overdueTasks', Icons.warning_amber_outlined, T.danger),
  HomeKpi('الشركات', 'Companies', 'companiesTotal', Icons.business_outlined, T.navy),
]);

const _sales = HomeInsight('نظرة المبيعات', 'Sales snapshot', '/api/sales/dashboard', 'sales:updated', [
  HomeKpi('قيمة المكسوب', 'Won', 'wonValue', Icons.emoji_events_outlined, T.success, money: true),
  HomeKpi('قيمة المفتوح', 'Open', 'openValue', Icons.work_outline, T.info, money: true),
  HomeKpi('نسبة التحقيق %', 'Attainment %', 'attainment', Icons.flag_outlined, T.orange),
  HomeKpi('نسبة الكسب %', 'Win rate %', 'winRate', Icons.percent_rounded, T.violet),
]);

const _b2c = HomeInsight('نظرة B2C', 'B2C snapshot', '/api/b2c/dashboard', 'b2c:*', [
  HomeKpi('طلبات الشهر', 'Orders', 'kpis.totalOrders', Icons.shopping_basket_outlined, T.navy),
  HomeKpi('مناديب نشطون', 'Active reps', 'kpis.repsActive', Icons.groups_outlined, T.info),
  HomeKpi('متوسط الأداء %', 'Avg perf %', 'kpis.avgPerformance', Icons.percent_rounded, T.violet),
  HomeKpi('فوق الهدف', 'Above target', 'kpis.aboveTargetReps', Icons.trending_up_rounded, T.success),
]);

const _it = HomeInsight('نظرة تقنية المعلومات', 'IT snapshot', '/api/it/dashboard', 'it:updated', [
  HomeKpi('تذاكر مفتوحة', 'Open tickets', 'totals.openTickets', Icons.confirmation_number_outlined, T.warn),
  HomeKpi('قيد المعالجة', 'In progress', 'totals.inProgress', Icons.engineering_outlined, T.info),
  HomeKpi('أجهزة مُسلَّمة', 'Assets out', 'totals.assetsAssigned', Icons.devices_other_outlined, T.navy),
  HomeKpi('وحدات بالمخزون', 'Stock', 'totals.stockCount', Icons.inventory_outlined, T.cyan),
]);

const _procurement = HomeInsight('نظرة المشتريات', 'Procurement snapshot', '/api/procurement/dashboard', 'procurement:pr', [
  HomeKpi('طلبات للموافقة', 'Pending PRs', 'prPending', Icons.pending_actions_outlined, T.warn),
  HomeKpi('أوامر مفتوحة', 'Open POs', 'openPOs', Icons.shopping_cart_outlined, T.info),
  HomeKpi('فواتير غير مدفوعة', 'Unpaid', 'unpaidBills', Icons.receipt_long_outlined, T.danger, money: true),
  HomeKpi('إنفاق الشهر', 'Spend', 'spendThisMonth', Icons.payments_outlined, T.violet, money: true),
]);

const _marketing = HomeInsight('نظرة التسويق', 'Marketing snapshot', '/api/marketing/dashboard', 'marketing:updated', [
  HomeKpi('الحملات', 'Campaigns', 'totals.campaigns', Icons.campaign_outlined, T.navy),
  HomeKpi('عملاء محتملون', 'Leads', 'totals.leads', Icons.person_add_alt_outlined, T.success),
  HomeKpi('الإنفاق', 'Spend', 'totals.spend', Icons.payments_outlined, T.danger, money: true),
  HomeKpi('النقرات', 'Clicks', 'totals.clicks', Icons.ads_click_outlined, T.orange),
]);

const _bd = HomeInsight('نظرة تطوير الأعمال', 'BD snapshot', '/api/business-development/dashboard', 'bd:updated', [
  HomeKpi('الفرص', 'Opportunities', 'totals.opportunities', Icons.lightbulb_outline, T.navy),
  HomeKpi('فرص مفتوحة', 'Open', 'totals.openOpportunities', Icons.work_outline, T.info),
  HomeKpi('قيمة المسار', 'Pipeline', 'totals.pipelineValue', Icons.timeline_outlined, T.violet, money: true),
  HomeKpi('مناقصات قريبة', 'Tenders due', 'totals.tendersDueSoon', Icons.gavel_outlined, T.orange),
]);

const _customs = HomeInsight('نظرة التخليص', 'Customs snapshot', '/api/customs-clearance/analytics', 'customs:updated', [
  HomeKpi('التخليصات', 'Clearances', 'totals.clearances', Icons.directions_boat_outlined, T.navy),
  HomeKpi('الحاويات', 'Containers', 'totals.containers', Icons.view_in_ar_outlined, T.info),
  HomeKpi('الإيرادات', 'Revenue', 'totals.totalRevenue', Icons.payments_outlined, T.success, money: true),
  HomeKpi('صافي الربح', 'Net profit', 'totals.netProfit', Icons.trending_up_rounded, T.orange, money: true),
]);

const _executive = HomeInsight('النظرة التنفيذية', 'Executive snapshot', '/api/analytics/super-overview', '', [
  HomeKpi('تشغيلات الشهر', 'Ops (month)', 'operations.thisMonth', Icons.workspaces_outline, T.navy),
  HomeKpi('طلبات B2C', 'B2C orders', 'b2c.monthOrders', Icons.storefront_outlined, T.violet),
  HomeKpi('تحصيلات اليوم', 'Today collect', 'wallet.todayCollections', Icons.payments_outlined, T.success, money: true),
  HomeKpi('صيانة مفتوحة', 'Open maint.', 'workshop.openMaintenance', Icons.engineering_outlined, T.orange),
]);

// دور → أفضل نظرة. تُرتَّب حسب أولوية الدور، ثم نرجع لصلاحية القسم.
const _roleInsight = <String, HomeInsight>{
  'super_admin': _executive,
  'finance_manager': _finance,
  'accountant': _finance,
  'operations_manager': _fleet,
  'operations_staff': _fleet,
  'fleet_manager': _fleet,
  'fleet_supervisor': _fleet,
  'workshop_manager': _workshop,
  'workshop_employee': _workshop,
  'procurement_staff': _workshop,
  'crm_manager': _crm,
  'crm_team_lead': _crm,
  'crm_specialist': _crm,
  'crm_agent': _crm,
  'sales_manager': _sales,
  'sales_rep': _sales,
  'b2c_manager': _b2c,
  'b2c_project_lead': _b2c,
  'it_manager': _it,
  'it_specialist': _it,
  'procurement_manager': _procurement,
  'marketing_manager': _marketing,
  'marketing_specialist': _marketing,
  'bd_manager': _bd,
  'bd_specialist': _bd,
  'customs_manager': _customs,
  'customs_officer': _customs,
  'collections_manager': _collections,
  'collections_staff': _collections,
};

// صلاحية القسم (للأدوار المُدارة) → نظرة القسم.
const _sectionInsight = <String, HomeInsight>{
  'Collections': _collections,
  'Fleet Management': _fleet,
  'Workshop': _workshop,
  'CRM': _crm,
  'Sales': _sales,
  'B2C': _b2c,
  'Software & IT': _it,
  'Procurement': _procurement,
  'Marketing': _marketing,
  'Business Development': _bd,
  'Customs': _customs,
};

/// أفضل نظرة للمستخدم، أو null (فيرجع للخدمة الذاتية فقط).
HomeInsight? homeInsightFor(AuthProvider auth) {
  final byRole = _roleInsight[auth.role];
  if (byRole != null) return byRole;
  // admin يرى المالية افتراضيًا.
  if (auth.role == 'admin') return _finance;
  for (final e in _sectionInsight.entries) {
    if (auth.canAccessSection(e.key)) return e.value;
  }
  return null;
}

String insightTitle(HomeInsight i) => tr(i.arTitle, i.enTitle);
