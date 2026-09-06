import 'package:flutter/material.dart';
import '../services/lang.dart';
import '../ui/theme.dart';
import 'section_dash.dart';

/// مواصفات لوحات الأقسام — كل قسم يعرّف بطاقاته وتوزيعاته وقوائمه فوق
/// SectionDashScreen العامة. الأسماء تطابق استجابة كل /dashboard في الخادم.

String _s(Map<String, dynamic> r, String k) => (r[k] ?? '').toString();

String _n(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(n.truncateToDouble() == n ? 0 : 1);
}

const _fleetStatusLabels = {
  'requesting': ('قيد الطلب', 'Requesting', T.inkFaint),
  'loading': ('جاري التحميل', 'Loading', T.warn),
  'uploaded': ('تم التحميل', 'Uploaded', Color(0xFFCA8A04)),
  'on_way': ('في الطريق', 'On way', T.info),
  'arrived': ('وصلت', 'Arrived', Color(0xFF4F46E5)),
  'bond_sent': ('أُرسل السند', 'Bond sent', T.cyan),
  'bond_received': ('استُلم السند', 'Bond received', T.success),
  'late': ('متأخرة', 'Late', Color(0xFFEA580C)),
  'invoiced': ('تمت الفوترة', 'Invoiced', T.violet),
  'cancelled': ('ملغاة', 'Cancelled', T.danger),
};

const _prLabels = {
  'draft': ('مسودة', 'Draft', T.inkFaint),
  'pending_approval': ('بانتظار الموافقة', 'Pending', T.warn),
  'approved': ('معتمد', 'Approved', T.success),
  'rejected': ('مرفوض', 'Rejected', T.danger),
  'ordered': ('تم الطلب', 'Ordered', T.violet),
};

const _poLabels = {
  'draft': ('مسودة', 'Draft', T.inkFaint),
  'sent': ('مُرسل', 'Sent', T.info),
  'partially_received': ('مستلم جزئيًا', 'Partial', T.warn),
  'received': ('مستلم', 'Received', T.success),
  'billed': ('مفوتر', 'Billed', T.violet),
  'cancelled': ('ملغي', 'Cancelled', T.danger),
};

const _billLabels = {
  'unpaid': ('غير مدفوع', 'Unpaid', T.danger),
  'partial': ('مدفوع جزئيًا', 'Partial', T.warn),
  'paid': ('مدفوع', 'Paid', T.success),
};

const _dealStageLabels = {
  'new': ('جديدة', 'New', T.info),
  'contacted': ('تم التواصل', 'Contacted', T.cyan),
  'qualified': ('مؤهلة', 'Qualified', T.violet),
  'proposal': ('عرض سعر', 'Proposal', T.warn),
  'negotiation': ('تفاوض', 'Negotiation', T.orange),
  'won': ('مكسوبة', 'Won', T.success),
  'lost': ('خاسرة', 'Lost', T.danger),
};

final salesDashSpec = DashSpec(
  arTitle: 'لوحة المبيعات', enTitle: 'Sales Dashboard',
  endpoint: '/api/sales/dashboard', liveEvent: 'sales:updated',
  stats: const [
    DashStat('قيمة المكسوب', 'Won value', 'wonValue', Icons.emoji_events_outlined, T.success, money: true),
    DashStat('صفقات مكسوبة', 'Won deals', 'wonCount', Icons.check_circle_outline, T.success),
    DashStat('قيمة المفتوح', 'Open value', 'openValue', Icons.work_outline, T.info, money: true),
    DashStat('نسبة التحقيق %', 'Attainment %', 'attainment', Icons.flag_outlined, T.orange),
    DashStat('نسبة الكسب %', 'Win rate %', 'winRate', Icons.percent_rounded, T.violet),
    DashStat('متوسط الصفقة', 'Avg deal', 'avgDealSize', Icons.payments_outlined, T.navy, money: true),
  ],
  breakdowns: const [
    DashBreakdown('حسب المرحلة', 'By stage', 'byStage', idKey: 'stage', labels: _dealStageLabels),
  ],
  lists: [
    DashList('أفضل المناديب', 'Top reps', 'topReps', (r) => _s(r, 'rep'),
        subtitle: (r) => '${_n(r['count'])} ${tr('صفقة', 'deals')} · ${_n(r['value'])} ${tr('ر.س', 'SAR')}'),
  ],
);

final crmDashSpec = DashSpec(
  arTitle: 'لوحة علاقات العملاء', enTitle: 'CRM Dashboard',
  endpoint: '/api/crm/dashboard', liveEvent: 'crm:company',
  stats: const [
    DashStat('الشركات', 'Companies', 'companiesTotal', Icons.business_outlined, T.navy),
    DashStat('جهات الاتصال', 'Contacts', 'contactsTotal', Icons.contacts_outlined, T.info),
    DashStat('صفقات مفتوحة', 'Open deals', 'openDealsCount', Icons.work_outline, T.orange),
    DashStat('قيمة المسار', 'Pipeline', 'pipelineValue', Icons.timeline_outlined, T.violet, money: true),
    DashStat('نسبة الكسب %', 'Win rate %', 'winRate', Icons.percent_rounded, T.success),
    DashStat('مهام متأخرة', 'Overdue tasks', 'overdueTasks', Icons.warning_amber_outlined, T.danger),
  ],
  breakdowns: const [
    DashBreakdown('الشركات حسب الحالة', 'Companies by status', 'companiesByStatus'),
    DashBreakdown('الصفقات حسب المرحلة', 'Deals by stage', 'dealsByStage', labels: _dealStageLabels),
  ],
  lists: [
    DashList('أحدث الصفقات', 'Recent deals', 'recentDeals', (r) => _s(r, 'title').isEmpty ? _s(r, 'name') : _s(r, 'title'),
        subtitle: (r) => '${_n(r['value'] ?? r['amount'])} ${tr('ر.س', 'SAR')}'),
  ],
);

final marketingDashSpec = DashSpec(
  arTitle: 'لوحة التسويق', enTitle: 'Marketing Dashboard',
  endpoint: '/api/marketing/dashboard', liveEvent: 'marketing:updated',
  stats: const [
    DashStat('الحملات', 'Campaigns', 'totals.campaigns', Icons.campaign_outlined, T.navy),
    DashStat('الأنشطة', 'Activities', 'totals.activities', Icons.bolt_outlined, T.info),
    DashStat('العملاء المحتملون', 'Leads', 'totals.leads', Icons.person_add_alt_outlined, T.success),
    DashStat('الإنفاق', 'Spend', 'totals.spend', Icons.payments_outlined, T.danger, money: true),
    DashStat('الظهور', 'Impressions', 'totals.impressions', Icons.visibility_outlined, T.violet),
    DashStat('النقرات', 'Clicks', 'totals.clicks', Icons.ads_click_outlined, T.orange),
  ],
  breakdowns: const [
    DashBreakdown('حسب النوع', 'By type', 'byType', idKey: 'type'),
  ],
  lists: [
    DashList('حسب المنصة', 'By platform', 'byPlatform', (r) => _s(r, 'platform'),
        subtitle: (r) => '${_n(r['leads'])} ${tr('عميل محتمل', 'leads')} · ${_n(r['spend'])} ${tr('ر.س', 'SAR')}'),
    DashList('أفضل الحملات', 'Top campaigns', 'topCampaigns', (r) => _s(r, 'nameAr').isEmpty ? _s(r, 'name') : _s(r, 'nameAr'),
        subtitle: (r) => '${_s(r, 'platform')} · ${_n(r['leads'])} ${tr('عميل محتمل', 'leads')}'),
  ],
);

final bdDashSpec = DashSpec(
  arTitle: 'لوحة تطوير الأعمال', enTitle: 'BD Dashboard',
  endpoint: '/api/business-development/dashboard', liveEvent: 'bd:updated',
  stats: const [
    DashStat('الفرص', 'Opportunities', 'totals.opportunities', Icons.lightbulb_outline, T.navy),
    DashStat('فرص مفتوحة', 'Open', 'totals.openOpportunities', Icons.work_outline, T.info),
    DashStat('قيمة المسار', 'Pipeline', 'totals.pipelineValue', Icons.timeline_outlined, T.violet, money: true),
    DashStat('مكسوبة', 'Won', 'totals.won', Icons.emoji_events_outlined, T.success),
    DashStat('خاسرة', 'Lost', 'totals.lost', Icons.cancel_outlined, T.danger),
    DashStat('مناقصات قريبة', 'Tenders due', 'totals.tendersDueSoon', Icons.gavel_outlined, T.orange),
  ],
  breakdowns: const [
    DashBreakdown('قمع الفرص', 'Funnel', 'funnel', idKey: 'stage'),
  ],
  lists: [
    DashList('أكبر الفرص', 'Top opportunities', 'topOpportunities', (r) => _s(r, 'title').isEmpty ? _s(r, 'name') : _s(r, 'title'),
        subtitle: (r) => '${_n(r['value'] ?? r['estimatedValue'])} ${tr('ر.س', 'SAR')}'),
  ],
);


final fleetDashSpec = DashSpec(
  arTitle: 'لوحة الأسطول', enTitle: 'Fleet Dashboard',
  endpoint: '/api/fleet/dashboard', liveEvent: 'fleet:updated',
  stats: const [
    DashStat('حمولات اليوم', 'Today', 'shipmentsToday', Icons.today_outlined, T.navy),
    DashStat('حمولات الأسبوع', 'This week', 'shipmentsWeek', Icons.date_range_outlined, T.info),
    DashStat('متابعات اليوم', 'Follow-ups', 'followupsToday', Icons.phone_in_talk_outlined, T.orange),
    DashStat('السائقون العاملون', 'Working drivers', 'drivers.working', Icons.badge_outlined, T.success),
    DashStat('إجمالي السائقين', 'Drivers', 'drivers.total', Icons.groups_outlined, T.violet),
    DashStat('إجمالي المركبات', 'Vehicles', 'vehicles.total', Icons.local_shipping_outlined, T.cyan),
  ],
  breakdowns: const [
    DashBreakdown('الحمولات حسب الحالة', 'By status', 'byStatus', labels: _fleetStatusLabels),
  ],
  lists: [
    DashList('تحتاج متابعة الآن', 'Need follow-up', 'needFollowUp',
        (r) => '${tr('بوليصة', 'WB')} ${_s(r, 'waybillNumber')} · ${_s(r, 'customerName')}',
        subtitle: (r) => '${_s(r, 'driverName')} · ${_s(r, 'fromCity')} ← ${_s(r, 'toCity')}'),
    DashList('حسب المشرف', 'By supervisor', 'bySupervisor', (r) => _s(r, 'name'),
        subtitle: (r) => '${_n(r['count'])} ${tr('حمولة', 'shipments')}'),
  ],
);

final b2cDashSpec = DashSpec(
  arTitle: 'لوحة B2C', enTitle: 'B2C Dashboard',
  endpoint: '/api/b2c/dashboard', liveEvent: 'b2c:*',
  stats: const [
    DashStat('إجمالي الطلبات', 'Total orders', 'kpis.totalOrders', Icons.shopping_basket_outlined, T.navy),
    DashStat('مناديب نشطون', 'Active reps', 'kpis.repsActive', Icons.groups_outlined, T.info),
    DashStat('متوسط يومي', 'Avg daily', 'kpis.avgDailyRate', Icons.speed_outlined, T.violet),
    DashStat('متوسط الأداء %', 'Avg performance %', 'kpis.avgPerformance', Icons.percent_rounded, T.orange),
    DashStat('فوق الهدف', 'Above target', 'kpis.aboveTargetReps', Icons.trending_up_rounded, T.success),
    DashStat('تحت الهدف', 'Below target', 'kpis.belowTargetReps', Icons.trending_down_rounded, T.danger),
  ],
  lists: [
    DashList('حسب المشروع', 'By project', 'byProject', (r) => _s(r, 'name'),
        subtitle: (r) => '${_n(r['totalOrders'])} ${tr('طلب', 'orders')} · ${_n(r['repsActive'])} ${tr('مندوب', 'reps')}'),
    DashList('أفضل المناديب', 'Top reps', 'topReps',
        (r) => _s(r, 'arabicName').isEmpty ? _s(r, 'englishName') : _s(r, 'arabicName'),
        subtitle: (r) => '${_n(r['totalOrders'])} ${tr('طلب', 'orders')} · ${_n(r['performancePercent'])}%'),
  ],
);

final procurementDashSpec = DashSpec(
  arTitle: 'لوحة المشتريات', enTitle: 'Procurement Dashboard',
  endpoint: '/api/procurement/dashboard', liveEvent: 'procurement:pr',
  stats: const [
    DashStat('طلبات بانتظار الموافقة', 'Pending PRs', 'prPending', Icons.pending_actions_outlined, T.warn),
    DashStat('أوامر مفتوحة', 'Open POs', 'openPOs', Icons.shopping_cart_outlined, T.info),
    DashStat('قيمة الأوامر المفتوحة', 'Open PO value', 'openPOValue', Icons.payments_outlined, T.navy, money: true),
    DashStat('فواتير غير مدفوعة', 'Unpaid bills', 'unpaidBills', Icons.receipt_long_outlined, T.danger, money: true),
    DashStat('متأخرة السداد', 'Overdue', 'overdueBills', Icons.warning_amber_outlined, T.orange, money: true),
    DashStat('إنفاق الشهر', 'Spend (month)', 'spendThisMonth', Icons.calendar_month_outlined, T.violet, money: true),
  ],
  breakdowns: const [
    DashBreakdown('الطلبات حسب الحالة', 'PRs by status', 'prByStatus', idKey: 'status', labels: _prLabels),
    DashBreakdown('الأوامر حسب الحالة', 'POs by status', 'poByStatus', idKey: 'status', labels: _poLabels),
    DashBreakdown('الفواتير حسب الحالة', 'Bills by status', 'billByStatus', idKey: 'status', labels: _billLabels),
  ],
  lists: [
    DashList('أكبر الموردين', 'Top vendors', 'topVendors', (r) => _s(r, 'name'),
        subtitle: (r) => '${_n(r['total'])} ${tr('ر.س', 'SAR')} · ${_n(r['count'])} ${tr('فاتورة', 'bills')}'),
  ],
);

final itDashSpec = DashSpec(
  arTitle: 'لوحة تقنية المعلومات', enTitle: 'IT Dashboard',
  endpoint: '/api/it/dashboard', liveEvent: 'it:updated',
  stats: const [
    DashStat('تذاكر مفتوحة', 'Open tickets', 'totals.openTickets', Icons.confirmation_number_outlined, T.warn),
    DashStat('قيد المعالجة', 'In progress', 'totals.inProgress', Icons.engineering_outlined, T.info),
    DashStat('تم حلها', 'Resolved', 'totals.resolvedThisPeriod', Icons.check_circle_outline, T.success),
    DashStat('متوسط الحل (د)', 'Avg minutes', 'totals.avgResolutionMinutes', Icons.timer_outlined, T.violet),
    DashStat('أجهزة مُسلَّمة', 'Assigned assets', 'totals.assetsAssigned', Icons.devices_other_outlined, T.navy),
    DashStat('وحدات بالمستودع', 'Stock units', 'totals.stockCount', Icons.inventory_outlined, T.cyan),
  ],
  breakdowns: const [
    DashBreakdown('التذاكر حسب الحالة', 'By status', 'totals.ticketsByStatus', idKey: 'key'),
    DashBreakdown('حسب الأولوية', 'By priority', 'totals.ticketsByPriority', idKey: 'key'),
    DashBreakdown('المستودع حسب النوع', 'Stock by type', 'totals.stockByType', idKey: 'key'),
  ],
  lists: [
    DashList('تجديدات قريبة', 'Renewals due', 'totals.renewalsDueSoon',
        (r) => _s(r, 'nameAr').isEmpty ? _s(r, 'name') : _s(r, 'nameAr'),
        subtitle: (r) => '${_s(r, 'renewalDate').split('T').first} · ${_n(r['cost'])} ${tr('ر.س', 'SAR')}'),
  ],
);

final accountingDashSpec = DashSpec(
  arTitle: 'لوحة الحسابات', enTitle: 'Accounting Dashboard',
  endpoint: '/api/accounting/dashboard', liveEvent: 'accounting:updated',
  stats: const [
    DashStat('الإيرادات', 'Revenue', 'totals.revenue', Icons.trending_up_rounded, T.success, money: true),
    DashStat('المصروفات', 'Expenses', 'totals.expenses', Icons.trending_down_rounded, T.danger, money: true),
    DashStat('صافي الدخل', 'Net income', 'totals.netIncome', Icons.account_balance_outlined, T.navy, money: true),
    DashStat('ذمم مدينة', 'Receivable', 'accountsReceivable', Icons.call_received_rounded, T.info, money: true),
    DashStat('ذمم دائنة', 'Payable', 'accountsPayable', Icons.call_made_rounded, T.orange, money: true),
    DashStat('النقد والبنك', 'Cash & bank', 'cashBank', Icons.savings_outlined, T.violet, money: true),
  ],
  lists: [
    DashList('أكبر المصروفات', 'Top expenses', 'topExpenses',
        (r) => _s(r, 'nameAr').isEmpty ? _s(r, 'nameEn') : _s(r, 'nameAr'),
        subtitle: (r) => '${_n(r['amount'])} ${tr('ر.س', 'SAR')}'),
    DashList('أحدث القيود', 'Recent entries', 'recentEntries',
        (r) => '${_s(r, 'entryNumber')} · ${_s(r, 'memo')}',
        subtitle: (r) => '${_n(r['totalDebit'])} ${tr('ر.س', 'SAR')} · ${_s(r, 'status')}'),
  ],
);

final customsDashSpec = DashSpec(
  arTitle: 'تحليلات التخليص', enTitle: 'Customs Analytics',
  endpoint: '/api/customs-clearance/analytics', liveEvent: 'customs:updated',
  stats: const [
    DashStat('التخليصات', 'Clearances', 'totals.clearances', Icons.directions_boat_outlined, T.navy),
    DashStat('الحاويات', 'Containers', 'totals.containers', Icons.view_in_ar_outlined, T.info),
    DashStat('العملاء', 'Customers', 'totals.customers', Icons.business_outlined, T.violet),
    DashStat('الإيرادات', 'Revenue', 'totals.totalRevenue', Icons.payments_outlined, T.success, money: true),
    DashStat('صافي الربح', 'Net profit', 'totals.netProfit', Icons.trending_up_rounded, T.orange, money: true),
    DashStat('متوسط شهري', 'Avg / month', 'totals.avgPerMonth', Icons.calendar_month_outlined, T.cyan),
  ],
  lists: [
    DashList('حسب العميل', 'By customer', 'byCustomer', (r) => _s(r, 'key'),
        subtitle: (r) => '${_n(r['count'])} ${tr('تخليص', 'clearances')} · ${_n(r['revenue'])} ${tr('ر.س', 'SAR')}'),
    DashList('حسب المخلّص', 'By agent', 'byAgent', (r) => _s(r, 'key'),
        subtitle: (r) => '${_n(r['count'])} ${tr('تخليص', 'clearances')}'),
  ],
);

// ── لوحةُ التحصيل ───────────────────────────────────────────────────────────
// ما لنا وما علينا. الأرقامُ كلُّها مشتقّةٌ من كشوف التشغيل، فلا يقول التطبيقُ
// رقمًا ويقول الموقعُ غيرَه.
final collectionsDashSpec = DashSpec(
  arTitle: 'لوحة التحصيل', enTitle: 'Collections Dashboard',
  endpoint: '/api/collections-dept/dashboard', liveEvent: 'collections:party',
  stats: const [
    DashStat('المستحق لنا', 'Receivable', 'customers.outstanding', Icons.call_received_rounded, T.danger, money: true),
    DashStat('المستحق علينا', 'Payable', 'suppliers.outstanding', Icons.call_made_rounded, T.orange, money: true),
    DashStat('المحصَّل', 'Collected', 'customers.settled', Icons.task_alt_rounded, T.success, money: true),
    DashStat('إجمالي المبيعات', 'Total billed', 'customers.total', Icons.receipt_long_outlined, T.navy, money: true),
    DashStat('كشوف لم تُحصَّل', 'Uncollected', 'customers.openReports', Icons.pending_actions_outlined, T.warn),
    DashStat('كشوف لم تُسدَّد', 'Unpaid', 'suppliers.openReports', Icons.schedule_outlined, T.info),
  ],
  lists: [
    DashList('أكبر المتأخّرين — عملاء', 'Largest due — customers', 'customers.top', (r) => _s(r, 'name'),
        subtitle: (r) => '${_n(r['outstanding'])} ${tr('ر.س', 'SAR')} · ${_n(r['reports'])} ${tr('كشف', 'reports')}'),
    DashList('أكبر المستحقّ — موردون', 'Largest owed — suppliers', 'suppliers.top', (r) => _s(r, 'name'),
        subtitle: (r) => '${_n(r['outstanding'])} ${tr('ر.س', 'SAR')} · ${_n(r['reports'])} ${tr('كشف', 'reports')}'),
  ],
);

const vehiclesDashSpec = DashSpec(
  arTitle: 'لوحة المركبات', enTitle: 'Vehicles Dashboard',
  endpoint: '/api/vehicles/dashboard', liveEvent: 'vehicle:updated',
  stats: [
    DashStat('المركبات', 'Vehicles', 'totals.vehicles', Icons.local_shipping_outlined, T.navy),
    DashStat('مفوَّضة', 'Authorized', 'totals.authorized', Icons.verified_outlined, T.success),
    DashStat('متاحة', 'Available', 'totals.available', Icons.event_available_outlined, T.info),
    DashStat('تفويضات نشطة', 'Active auths', 'totals.activeAuthorizations', Icons.assignment_ind_outlined, T.violet),
    DashStat('حوادث مفتوحة', 'Open accidents', 'totals.openAccidents', Icons.car_crash_outlined, T.danger),
    DashStat('تفويضات تنتهي قريبًا', 'Expiring', 'totals.expiringAuthorizations', Icons.timelapse_outlined, T.orange),
  ],
  breakdowns: [
    DashBreakdown('حسب الحالة', 'By status', 'byStatus'),
    DashBreakdown('حسب النوع', 'By type', 'byType'),
  ],
);

const mainFinanceDashSpec = DashSpec(
  arTitle: 'اللوحة المالية', enTitle: 'Financial Dashboard',
  endpoint: '/api/analytics/dashboard', liveEvent: 'invoice:updated',
  stats: [
    DashStat('إجمالي المستحق', 'Outstanding', 'totalOutstanding', Icons.account_balance_wallet_outlined, T.danger, money: true),
    DashStat('تحصيل الشهر', 'Collected (month)', 'monthlyCollected', Icons.trending_up_rounded, T.success, money: true),
    DashStat('تحصيل السنة', 'Collected (year)', 'yearlyCollected', Icons.savings_outlined, T.navy, money: true),
    DashStat('نسبة التحصيل %', 'Collection %', 'collectionRate', Icons.percent_rounded, T.violet),
    DashStat('متوسط أيام التحصيل', 'DSO', 'dso', Icons.schedule_outlined, T.orange),
    DashStat('فواتير متأخرة', 'Overdue', 'overdueCount', Icons.warning_amber_outlined, T.danger),
  ],
);

const executiveDashSpec = DashSpec(
  arTitle: 'النظرة التنفيذية', enTitle: 'Executive Overview',
  endpoint: '/api/analytics/super-overview', liveEvent: '',
  stats: [
    DashStat('تشغيلات الشهر', 'Ops (month)', 'operations.thisMonth', Icons.workspaces_outline, T.navy),
    DashStat('طلبات B2C', 'B2C orders', 'b2c.monthOrders', Icons.storefront_outlined, T.violet),
    DashStat('عدد تحصيلات اليوم', "Collections today", 'wallet.todayCollections', Icons.payments_outlined, T.success),
    DashStat('صافي المحفظة', 'Wallet net', 'wallet.monthNet', Icons.account_balance_outlined, T.info, money: true),
    DashStat('السائقون النشطون', 'Active drivers', 'roster.drivers', Icons.badge_outlined, T.cyan),
    DashStat('الفروع', 'Branches', 'roster.branches', Icons.store_outlined, T.navy),
    DashStat('مهام مستحقة اليوم', 'Tasks due today', 'tasks.dueToday', Icons.today_outlined, T.orange),
    DashStat('شكاوى مفتوحة', 'Open complaints', 'service.complaintsOpen', Icons.report_outlined, T.danger),
    DashStat('نزاعات مفتوحة', 'Open disputes', 'service.disputesOpen', Icons.gavel_outlined, T.danger),
  ],
  lists: [
    DashList('أنشط السائقين', 'Top drivers', 'roster.topDrivers', _topDriverTitle, subtitle: _topDriverSub),
  ],
);

String _topDriverTitle(Map<String, dynamic> r) => (r['name'] ?? r['_id'] ?? r['driver'] ?? '—').toString();
String _topDriverSub(Map<String, dynamic> r) => '${r['trips'] ?? 0} ${tr('رحلة', 'trips')}';
