import 'package:flutter/material.dart';
import '../services/lang.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../resource/configs.dart' show lightTransportCfg;
import '../resource/resource.dart' show ResourceScreen;
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
    // البطاقاتُ الثماني كما على الويب — كان الهدفُ وعددُ المفتوحة غائبَين هنا.
    DashStat('مبيعات محقّقة', 'Won value', 'wonValue', Icons.emoji_events_outlined, T.success, money: true),
    DashStat('الهدف', 'Target', 'teamTarget', Icons.track_changes_outlined, T.info, money: true),
    DashStat('نسبة التحقيق %', 'Attainment %', 'attainment', Icons.flag_outlined, T.orange),
    DashStat('نسبة الفوز %', 'Win rate %', 'winRate', Icons.percent_rounded, T.violet),
    DashStat('صفقات مفتوحة', 'Open deals', 'openCount', Icons.work_outline, T.navy),
    DashStat('قيمة المفتوحة', 'Open value', 'openValue', Icons.timeline_outlined, T.info, money: true),
    DashStat('متوسط الصفقة', 'Avg deal', 'avgDealSize', Icons.payments_outlined, T.navy, money: true),
    DashStat('صفقات رابحة', 'Won deals', 'wonCount', Icons.check_circle_outline, T.success),
  ],
  breakdowns: const [
    DashBreakdown('مسار البيع حسب المرحلة', 'Pipeline by stage', 'byStage', idKey: 'stage', labels: _dealStageLabels),
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

/// لوحةُ طلبات الشحنات — أوّلُ صفحةِ القسم، كما في الويب.
///
/// نداءٌ واحدٌ (`/api/shipment-orders/dashboard`) يحمل حسابَ التحليلات نفسَه،
/// فلا يختلف رقمٌ بين الهاتف والمتصفّح.
final shipmentOrdersDashSpec = DashSpec(
  arTitle: 'لوحة الشحنات', enTitle: 'Shipments Dashboard',
  endpoint: '/api/shipment-orders/dashboard', liveEvent: 'shipmentOrders:updated',
  stats: const [
    DashStat('شحنات اليوم', 'Today', 'flat.todayOrders', Icons.today_outlined, T.orange),
    DashStat('شحنات الشهر', 'This month', 'flat.monthOrders', Icons.calendar_month_outlined, T.navy),
    DashStat('ملغاة هذا الشهر', 'Cancelled', 'flat.monthCancelled', Icons.cancel_outlined, T.warn),
    DashStat('ربح الشهر', 'Month margin', 'flat.monthMargin', Icons.trending_up_outlined, T.success, money: true),
    DashStat('بيع الشهر', 'Month sell', 'flat.monthSell', Icons.sell_outlined, T.info, money: true),
    DashStat('شراء الشهر', 'Month buy', 'flat.monthBuy', Icons.shopping_cart_outlined, T.violet, money: true),
    DashStat('متوسط ربح الشحنة', 'Avg margin', 'flat.avgMargin', Icons.calculate_outlined, T.cyan, money: true),
    DashStat('عملاء عملوا هذا الشهر', 'Customers', 'flat.customers', Icons.people_outline, T.navy),
    DashStat('موردون في السجل', 'Suppliers', 'flat.suppliers', Icons.business_outlined, T.navy),
    DashStat('شاحنات في السجل', 'Trucks', 'flat.vehicles', Icons.local_shipping_outlined, T.cyan),
    DashStat('سوّاق في السجل', 'Drivers', 'flat.drivers', Icons.badge_outlined, T.violet),
    // ما يحتاج تصرُّفًا — لا ما هو قائم.
    DashStat('شحنات بخسارة', 'Loss-making', 'flat.losing', Icons.trending_down_outlined, T.danger),
    DashStat('بلا سعر', 'No price', 'flat.missingPrice', Icons.money_off_outlined, T.warn),
    DashStat('شاحنات مجهولة المالك', 'Owner unknown', 'flat.ownerUnknown', Icons.help_outline, T.warn),
  ],
  breakdowns: const [
    DashBreakdown('أين تقف شحنات الشهر', 'Where this month stands', 'month.byStatus'),
  ],
  lists: [
    DashList('أكبر العملاء', 'Top customers', 'month.byCustomer', (r) => _s(r, 'name'),
        subtitle: (r) => '${_n(r['orders'])} ${tr('شحنة', 'loads')} · ${_n(r['margin'])} ${tr('ر.س ربح', 'SAR margin')}'),
    DashList('أكبر الموردين', 'Top suppliers', 'month.bySupplier', (r) => _s(r, 'name'),
        subtitle: (r) => '${_n(r['orders'])} ${tr('شحنة', 'loads')}'),
    DashList('أكثر المسارات', 'Top routes', 'month.byRoute', (r) => _s(r, 'name'),
        subtitle: (r) => '${_n(r['orders'])} ${tr('شحنة', 'loads')}'),
    DashList('آخر الشحنات', 'Latest', 'recent',
        (r) => '${_s(r, 'reference').isEmpty ? _n(r['waybillNumber']) : _s(r, 'reference')} · ${_s(r, 'customerName')}',
        subtitle: (r) => '${_s(r, 'fromCity')} ← ${_s(r, 'toCity')} · ${_s(r, 'vehiclePlate')}'),
  ],
);

/// لوحةُ قسم الأفراد — الصورةُ الكاملة كما في الويب.
/// كانت تقريرَ طلباتٍ ومناديب: أعدادُ الأوردرات وتحقيقُ الهدف وحدَهما. وهي
/// زاويةٌ من القسم لا القسمُ كلُّه — فلا يُقرأ فيها كم موظّفًا في فرعٍ، ولا كم
/// مركبةً واقفة، ولا مَن على كفالة أيّ سجلّ، ولا مَن بلا سكن. وذلك التقريرُ
/// انتقل إلى «تحليل الأوردرات» وبقي كما هو.
/// ── وكلُّ رقمٍ في «المناديب حسب المشروع» يفتح أصحابَه ──────────────────────
/// كالموقع: يُختار النوعُ (كفالة · فري لانسر · بلا نوع عقد · الكلّ) فيُفتَح سجلُّ
/// الموظّفين بالفلتر نفسِه الذي عدّت به اللوحة — المناديبُ في الخدمة، والمشروعُ
/// مطويًّا («هنقرستيشن» = «هنجرستيشن») ونوعُ العقد مطويًّا في الخادم.
/// واليوزراتُ لا تُفتَح من هنا: صفحتُها على الجوّال بلا فلترِ مشروع بعد.
void _openRepsOfProject(BuildContext context, Map<String, dynamic> r) {
  final project = _s(r, 'project');
  void open(String kind, String ar, String en) {
    Navigator.pop(context);
    final q = [
      'staffKind=rep', 'inService=1', 'project=${Uri.encodeQueryComponent(project)}',
      if (kind.isNotEmpty) 'contractKind=$kind',
    ].join('&');
    Navigator.push(context, MaterialPageRoute(builder: (_) => ResourceScreen(
        config: lightTransportCfg(canAdd: false, listQuery: q, arTitle: '$project — $ar', enTitle: '$project — $en'))));
  }
  final noContract = ((r['noContract'] as num?) ?? 0) > 0;
  showModalBottomSheet(
    context: context,
    builder: (_) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(title: Text(project, style: const TextStyle(fontWeight: FontWeight.w800))),
        ListTile(leading: const Icon(Icons.verified_user_outlined, color: T.info),
            title: Text('${tr('على الكفالة', 'Sponsored')} — ${_n(r['sponsored'])}'),
            onTap: () => open('sponsored', 'على الكفالة', 'Sponsored')),
        ListTile(leading: const Icon(Icons.work_outline, color: T.violet),
            title: Text('${tr('فري لانسر', 'Freelance')} — ${_n(r['freelance'])}'),
            onTap: () => open('freelance', 'فري لانسر', 'Freelance')),
        if (noContract)
          ListTile(leading: const Icon(Icons.help_outline, color: T.warn),
              title: Text('${tr('بلا نوع عقد — اضغط لتحديده', 'No contract type — tap to set it')} — ${_n(r['noContract'])}'),
              onTap: () => open('none', 'بلا نوع عقد', 'No contract type')),
        ListTile(leading: const Icon(Icons.groups_2_outlined, color: T.navy),
            title: Text(tr('كل المناديب', 'All reps')),
            onTap: () => open('', 'المناديب', 'Reps')),
      ]),
    ),
  );
}

final b2cDashSpec = DashSpec(
  arTitle: 'لوحة قسم الأفراد', enTitle: 'B2C Board',
  endpoint: '/api/light-transport/overview', liveEvent: 'lt:*',
  lists: [
    // لكلّ مشروع: كفالة · فري لانسر · يوزرات — كجدول الموقع.
    DashList('المناديب حسب المشروع', 'Reps by project', 'reps.projects', (r) => '${_s(r, 'project')} — ${_n(r['total'])}',
        subtitle: (r) => '${tr('كفالة', 'Sponsored')} ${_n(r['sponsored'])} · ${tr('فري لانسر', 'Freelance')} ${_n(r['freelance'])} · ${tr('يوزرات', 'Users')} ${_n(r['users'])}'
            '${((r['noContract'] as num?) ?? 0) > 0 ? ' · ${tr('بلا نوع عقد', 'no contract')} ${_n(r['noContract'])}' : ''}',
        onTap: _openRepsOfProject),
  ],
  stats: const [
    DashStat('الموظفون', 'Employees', 'employees.total', Icons.groups_outlined, T.navy),
    DashStat('مناديب', 'Reps', 'employees.reps', Icons.two_wheeler_outlined, T.info),
    DashStat('إداريون', 'Admin', 'employees.admins', Icons.badge_outlined, T.violet),
    DashStat('على رأس العمل', 'Working', 'employees.working', Icons.check_circle_outline, T.success),
    // على رأس العمل + في إجازة + موقوف = الموظفون — كالموقع.
    DashStat('في إجازة', 'On leave', 'employees.onLeave', Icons.beach_access_outlined, T.info),
    DashStat('موقوف', 'Suspended', 'employees.suspended', Icons.pause_circle_outline, T.warn),
    // إجماليُّ المناديب = كفالة + فري لانسر + يوزرات مؤجَّرة — كالموقع.
    DashStat('إجمالي المناديب', 'Total reps', 'reps.total', Icons.groups_2_outlined, T.navy),
    DashStat('على الكفالة', 'Sponsored', 'reps.sponsored', Icons.verified_user_outlined, T.info),
    DashStat('فري لانسر', 'Freelance', 'reps.freelance', Icons.work_outline, T.violet),
    DashStat('يوزرات', 'Rented users', 'reps.users', Icons.key_outlined, T.orange),
    DashStat('مركبات', 'Vehicles', 'vehicles.total', Icons.directions_car_outlined, T.navy),
    DashStat('عليها راكب', 'With a rider', 'vehicles.withRider', Icons.person_pin_circle_outlined, T.success),
    // ما ينقص ويحتاج عملًا — لا ما هو قائم.
    DashStat('مركبات واقفة', 'Idle vehicles', 'vehicles.idle', Icons.local_parking_outlined, T.warn),
    DashStat('يعملون بلا مركبة', 'Working without a vehicle', 'gaps.workingWithoutVehicle', Icons.no_transfer_outlined, T.warn),
    DashStat('تفويض باسم غير الراكب', 'Authorised to someone else', 'gaps.authorizationMismatch', Icons.assignment_late_outlined, T.danger),
    DashStat('بلا سكن', 'Unhoused', 'gaps.unhoused', Icons.home_outlined, T.warn),
    DashStat('أوامر تشغيل سارية', 'Active orders', 'orders.active', Icons.assignment_ind_outlined, T.navy),
    DashStat('بلا ملفّ في الموارد البشرية', 'No HR file', 'gaps.noHrFile', Icons.person_off_outlined, T.violet),
  ],
);

/// تقريرُ الطلبات — ما كان في اللوحة، في صفحته.
final b2cOrdersDashSpec = DashSpec(
  arTitle: 'تحليل الأوردرات', enTitle: 'Orders Analysis',
  endpoint: '/api/b2c/dashboard', liveEvent: 'b2c:*',
  // الإجماليُّ بمشاريعه فوق الأرقام — مثلُ الموقع. و«المتوسط اليومي» رُفع (٢٠٢٦/١٠/١٩).
  header: (d) => B2cProjectsTotal(data: d),
  stats: const [
    DashStat('مناديب نشطون', 'Active reps', 'kpis.repsActive', Icons.groups_outlined, T.info),
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

// للإدارة وحدَها (مدير النظام ومدير القسم) — الخادمُ يردّ غيرَهما بـ٤٠٣، والدرجُ
// لا يعرضها لهم. ولوحةُ الفريق التشغيليّة شاشةٌ أخرى: customs_dashboard.dart.
final customsDashSpec = DashSpec(
  arTitle: 'تحليلات قسم التخليص', enTitle: 'Customs Analytics',
  endpoint: '/api/customs-clearance/analytics', liveEvent: 'customs:updated',
  stats: const [
    DashStat('التخليصات', 'Clearances', 'totals.clearances', Icons.directions_boat_outlined, T.navy),
    DashStat('الحاويات', 'Containers', 'totals.containers', Icons.view_in_ar_outlined, T.info),
    DashStat('العملاء', 'Customers', 'totals.customers', Icons.business_outlined, T.violet),
    DashStat('الإيرادات', 'Revenue', 'totals.totalRevenue', Icons.payments_outlined, T.success, money: true),
    DashStat('صافي الربح', 'Net profit', 'totals.netProfit', Icons.trending_up_rounded, T.orange, money: true),
    DashStat('متوسط شهري', 'Avg / month', 'totals.avgPerMonth', Icons.calendar_month_outlined, T.cyan),
    DashStat('ربح الحاوية', 'Profit / container', 'insight.profitPerContainer', Icons.view_week_outlined, T.success, money: true),
    DashStat('قيمة ما لم يُفوتَر', 'Not-invoiced value', 'insight.notInvoicedValue', Icons.receipt_long_outlined, T.warn, money: true),
    DashStat('معاملات خاسرة', 'Losing transactions', 'insight.losing', Icons.trending_down_rounded, T.danger),
  ],
  lists: [
    DashList('حسب العميل', 'By customer', 'byCustomer', (r) => _s(r, 'key'),
        subtitle: (r) => '${_n(r['count'])} ${tr('تخليص', 'clearances')} · ${_n(r['revenue'])} ${tr('ر.س', 'SAR')}'),
    DashList('حسب المخلّص', 'By agent', 'byAgent', (r) => _s(r, 'key'),
        subtitle: (r) => '${_n(r['count'])} ${tr('تخليص', 'clearances')}'),
  ],
);

// ── لوحةُ التحصيل ───────────────────────────────────────────────────────────
// المديونيّةُ من دفتر الفواتير — النداءُ نفسُه الذي تُبنى منه شجرةُ الموقع.
// كانت تُقرأ من كشوف التشغيل فتقول ٤٧ مليونًا والموقعُ يقول ١٩٫٩٦: تاريخُ
// التحصيل لا يُكتب على الكشوف، فكان كلُّ ما سُلِّم يُعَدّ دَينًا.
final collectionsDashSpec = DashSpec(
  arTitle: 'لوحة التحصيل', enTitle: 'Collections Dashboard',
  endpoint: '/api/collections-dept/receivables/overview', liveEvent: 'collections:party',
  stats: const [
    DashStat('إجمالي المديونية', 'Receivable', 'tree.all.value', Icons.call_received_rounded, T.danger, money: true),
    DashStat('ضريبي', 'Tax', 'tree.byKind.tax.value', Icons.receipt_long_outlined, T.navy, money: true),
    DashStat('نقدي', 'Cash', 'tree.byKind.cash.value', Icons.payments_outlined, T.info, money: true),
    DashStat('في موعده', 'Within terms', 'tree.tax.within.value', Icons.task_alt_rounded, T.success, money: true),
    DashStat('متأخّر', 'Late', 'tree.tax.late.value', Icons.schedule_outlined, T.orange, money: true),
    DashStat('متأخّر فوق ٦٠ يومًا', 'Late 60+', 'tree.tax.bands.d60_plus.value', Icons.warning_amber_rounded, T.danger, money: true),
    DashStat('فواتير مفتوحة', 'Open invoices', 'tree.all.count', Icons.pending_actions_outlined, T.warn),
  ],
  lists: [
    DashList('أكبر المديونيات', 'Largest receivables', 'parties', (r) => _s(r, 'name'),
        subtitle: (r) => '${_n(r['value'])} ${tr('ر.س', 'SAR')} · ${_n(r['count'])} ${tr('فاتورة', 'invoices')} · ${tr('متأخّر', 'late')} ${_n(r['lateValue'])}'),
    DashList('بموظف التحصيل', 'By officer', 'officers', (r) => _s(r, 'officer'),
        subtitle: (r) => '${_n(r['value'])} ${tr('ر.س', 'SAR')} · ${tr('متأخّر', 'late')} ${_n(r['lateValue'])}'),
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


/// إجماليُّ الطلبات بمشاريعه — مطابقٌ لبطاقة الموقع (`ProjectsTotalCard`).
/// الرقمُ، وتحته «حتى تاريخ» آخرِ يومٍ فيه طلبات، وتحته بطاقةٌ لكلّ مشروع؛
/// الضغطُ يختار مشروعًا أو أكثر فيصير الإجماليُّ مجموعَ المختار.
class B2cProjectsTotal extends StatefulWidget {
  final Map<String, dynamic> data;
  const B2cProjectsTotal({super.key, required this.data});
  @override
  State<B2cProjectsTotal> createState() => _B2cProjectsTotalState();
}

class _B2cProjectsTotalState extends State<B2cProjectsTotal> {
  final Set<String> _sel = {};

  @override
  Widget build(BuildContext context) {
    final d = widget.data;
    final projects = [for (final p in (d['byProject'] as List? ?? const [])) Map<String, dynamic>.from(p as Map)];
    final all = ((d['kpis'] as Map?)?['totalOrders'] as num?) ?? 0;
    final shown = _sel.isEmpty
        ? all
        : projects.where((p) => _sel.contains('${p['projectId']}')).fold<num>(0, (n, p) => n + ((p['totalOrders'] as num?) ?? 0));
    final days = [for (final x in (d['byDay'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)]
        .where((x) => ((x['totalOrders'] as num?) ?? 0) > 0).map((x) => '${x['dateKey']}').toList()..sort();
    final last = days.isEmpty ? '—' : days.last.split('-').reversed.join('/');
    return AppCard(
      topAccent: T.orange,
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${tr('إجمالي الطلبات', 'Total orders')}${_sel.isEmpty ? '' : tr(' — ${_sel.length} مشروع مختار', ' — ${_sel.length} selected')}',
            style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.inkSoft)),
        const SizedBox(height: 4),
        Text(_n(shown), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: T.ink)),
        Text(tr('حتى تاريخ $last', 'Up to $last'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        const SizedBox(height: 10),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final p in projects)
            InkWell(
              borderRadius: BorderRadius.circular(10),
              onTap: () => setState(() {
                final id = '${p['projectId']}';
                _sel.contains(id) ? _sel.remove(id) : _sel.add(id);
              }),
              child: Container(
                width: 104,
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
                decoration: BoxDecoration(
                  color: _sel.contains('${p['projectId']}') ? T.orange.withValues(alpha: 0.08) : const Color(0xFFF8FAFC),
                  border: Border.all(color: _sel.contains('${p['projectId']}') ? T.orange : const Color(0xFFE2E8F0)),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${p['name'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: T.inkSoft)),
                  Text(_n(p['totalOrders']), style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: _sel.contains('${p['projectId']}') ? T.orange : T.ink)),
                ]),
              ),
            ),
        ]),
        if (_sel.isNotEmpty)
          TextButton(onPressed: () => setState(_sel.clear), child: Text(tr('كل المشاريع', 'All projects'))),
        ..._dailyBars(d),
      ]),
    );
  }

  /// طلباتُ آخر شهرٍ في المعروض يومًا بيوم — أعمدةٌ صغيرة كرسم الموقع. الضغطُ
  /// المطوَّل على عمودٍ يقول يومَه وعددَه. والأيامُ القادمة أصفارٌ فتبقى فارغة.
  List<Widget> _dailyBars(Map<String, dynamic> d) {
    final all = [for (final x in (d['byDay'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)];
    if (all.isEmpty) return const [];
    final months = all.map((x) => '${x['dateKey']}'.substring(0, 7)).toSet().toList()..sort();
    final month = months.last;
    final days = all.where((x) => '${x['dateKey']}'.startsWith(month)).toList()
      ..sort((a, b) => '${a['dateKey']}'.compareTo('${b['dateKey']}'));
    final max = days.fold<num>(0, (m, x) => ((x['totalOrders'] as num?) ?? 0) > m ? (x['totalOrders'] as num) : m);
    return [
      const SizedBox(height: 12),
      Text(tr('الطلبات يوميًا — ${month.split('-').reversed.join('/')}', 'Orders per day — ${month.split('-').reversed.join('/')}'),
          style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.inkSoft)),
      const SizedBox(height: 6),
      SizedBox(
        height: 70,
        child: Directionality(
          textDirection: TextDirection.ltr,
          child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            for (final x in days)
              Expanded(child: Tooltip(
                triggerMode: TooltipTriggerMode.tap,
                message: '${'${x['dateKey']}'.split('-').reversed.join('/')} · ${_n(x['totalOrders'])} ${tr('طلب', 'orders')}',
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 1),
                  child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                    Container(
                      height: max > 0 ? 56 * (((x['totalOrders'] as num?) ?? 0) / max) : 0,
                      decoration: const BoxDecoration(color: T.orange, borderRadius: BorderRadius.vertical(top: Radius.circular(3))),
                    ),
                    const SizedBox(height: 2),
                    Text('${int.parse('${x['dateKey']}'.substring(8, 10))}', style: const TextStyle(fontSize: 7, color: T.inkFaint)),
                  ]),
                ),
              )),
          ]),
        ),
      ),
    ];
  }
}
