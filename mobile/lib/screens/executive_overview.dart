import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// النظرة التنفيذية — تجمع كل الأقسام في شاشة واحدة: تسحب لوحات الأقسام
/// بالتوازي (كل قسم مستقل، فشل واحد لا يوقف الباقي) وتعرض مجموعات KPI.
/// مطابقة لصفحة executive على الويب.

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

String _num(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '');
  if (n == null) return '—';
  return n.truncateToDouble() == n ? n.toInt().toString() : n.toStringAsFixed(1);
}

// وصف مؤشر: (عربي, إنجليزي, مسار داخل بيانات المصدر, هل قيمة مالية).
typedef Kpi = (String, String, String, bool);

class _Cluster {
  final String ar, en, source, basePath; // basePath: مسار فرعي داخل استجابة المصدر
  final IconData icon;
  final Color color;
  final List<Kpi> kpis;
  const _Cluster(this.ar, this.en, this.icon, this.color, this.source, this.basePath, this.kpis);
}

const _clusters = <_Cluster>[
  _Cluster('المالية', 'Finance', Icons.account_balance_wallet_outlined, T.success, 'finance', '', [
    ('المستحقات', 'Outstanding', 'totalOutstanding', true),
    ('المحصّل (الشهر)', 'Collected (MTD)', 'monthlyCollected', true),
    ('نسبة التحصيل %', 'Collection rate', 'collectionRate', false),
    ('مدة التحصيل', 'DSO', 'dso', false),
    ('فواتير متأخرة', 'Overdue invoices', 'overdueCount', false),
    ('عملاء نشطين', 'Active customers', 'customerCount', false),
  ]),
  _Cluster('العمليات', 'Operations', Icons.local_shipping_outlined, T.orange, 'overview', 'operations', [
    ('إجمالي الشحنات', 'Total shipments', 'total', false),
    ('هذا الشهر', 'This month', 'thisMonth', false),
    ('الشهر الماضي', 'Last month', 'lastMonth', false),
  ]),
  _Cluster('لوكيشن سوليوشن', 'Location Solutions', Icons.gps_fixed, T.info, 'ls2', '', [
    ('الأسطول متصل', 'Fleet online', 'fleet.online', false),
    ('تتحرك', 'Moving', 'fleet.statusCounts.moving', false),
    ('تنبيهات حرِجة', 'Critical alerts', 'alerts.bySeverity.critical', false),
    ('صيانة قريبة', 'Service due', 'maintenance.dueCount', false),
    ('صيانة متأخرة', 'Service overdue', 'maintenance.overdueCount', false),
    ('كاوتش ساخن', 'Hot tires', 'temperature.hotTires', false),
  ]),
  _Cluster('الموارد البشرية', 'Human Resources', Icons.people_outline, T.cyan, 'hr', 'summary', [
    ('الموظفون', 'Employees', 'totalEmployees', false),
    ('نشط', 'Active', 'activeEmployees', false),
    ('إجازات معلّقة', 'Pending leaves', 'pendingLeaves', false),
    ('طلبات مفتوحة', 'Open requests', 'openRequests', false),
    ('وثائق تنتهي (60ي)', 'Expiring docs', 'expiringDocsCount', false),
    ('وثائق منتهية', 'Expired docs', 'expiredDocsCount', false),
  ]),
  _Cluster('المركبات والتفاويض', 'Vehicles', Icons.directions_car_outlined, T.warn, 'vehicles', 'totals', [
    ('إجمالي المركبات', 'Total vehicles', 'vehicles', false),
    ('مفوّضة', 'Authorized', 'authorized', false),
    ('تفاويض نشطة', 'Active auths', 'activeAuthorizations', false),
    ('تفاويض تنتهي (30ي)', 'Expiring auths', 'expiringAuthorizations', false),
    ('حوادث مفتوحة', 'Open accidents', 'openAccidents', false),
    ('تكلفة الحوادث', 'Accident cost', 'estimatedAccidentCost', true),
  ]),
  _Cluster('إدارة العملاء', 'CRM', Icons.business_outlined, T.violet, 'crm', '', [
    ('الشركات', 'Companies', 'companiesTotal', false),
    ('جهات الاتصال', 'Contacts', 'contactsTotal', false),
    ('صفقات مفتوحة', 'Open deals', 'openDealsCount', false),
    ('قيمة الصفقات', 'Pipeline value', 'pipelineValue', true),
    ('نسبة الفوز %', 'Win rate', 'winRate', false),
    ('مهام متأخرة', 'Overdue tasks', 'overdueTasks', false),
  ]),
  _Cluster('المبيعات', 'Sales', Icons.trending_up_outlined, T.success, 'sales', '', [
    ('مكتسبة (الشهر)', 'Won (MTD)', 'wonValue', true),
    ('الهدف', 'Target', 'teamTarget', true),
    ('التحقيق %', 'Attainment', 'attainment', false),
    ('قيد التفاوض', 'Open pipeline', 'openValue', true),
    ('متوسط الصفقة', 'Avg deal', 'avgDealSize', true),
  ]),
  _Cluster('المشتريات', 'Procurement', Icons.shopping_cart_outlined, T.danger, 'procurement', '', [
    ('طلبات شراء معلّقة', 'PRs pending', 'prPending', false),
    ('أوامر مفتوحة', 'Open POs', 'openPOs', false),
    ('قيمة الأوامر', 'Open PO value', 'openPOValue', true),
    ('فواتير غير مدفوعة', 'Unpaid bills', 'unpaidBills', true),
    ('فواتير متأخرة', 'Overdue bills', 'overdueBillsCount', false),
    ('الإنفاق (الشهر)', 'Spend (MTD)', 'spendThisMonth', true),
  ]),
  _Cluster('الورشة', 'Workshop', Icons.build_outlined, T.inkSoft, 'overview', 'workshop', [
    ('صيانة مفتوحة', 'Open maintenance', 'openMaintenance', false),
    ('مشتريات معلّقة', 'Pending purchases', 'pendingPurchases', false),
    ('أصناف المخزون', 'Inventory items', 'inventoryItems', false),
    ('مخزون منخفض', 'Low stock', 'lowStockItems', false),
    ('نفد المخزون', 'Out of stock', 'outOfStockItems', false),
  ]),
  _Cluster('B2C', 'B2C', Icons.storefront_outlined, T.violet, 'overview', 'b2c', [
    ('الطلبات (الشهر)', 'Orders (MTD)', 'monthOrders', false),
    ('المناديب', 'Reps', 'reps', false),
    ('المشاريع', 'Projects', 'projects', false),
    ('أيام العمل', 'Working days', 'monthWorkingDays', false),
  ]),
];

const _sources = {
  'finance': '/api/analytics/dashboard',
  'overview': '/api/analytics/super-overview',
  'ls2': '/api/ls2/dashboard',
  'hr': '/api/hr/dashboard',
  'vehicles': '/api/vehicles/dashboard',
  'crm': '/api/crm/dashboard',
  'sales': '/api/sales/dashboard',
  'procurement': '/api/procurement/dashboard',
};

class ExecutiveOverviewScreen extends StatefulWidget {
  const ExecutiveOverviewScreen({super.key});
  @override
  State<ExecutiveOverviewScreen> createState() => _ExecutiveOverviewScreenState();
}

class _ExecutiveOverviewScreenState extends State<ExecutiveOverviewScreen> {
  final Map<String, Map<String, dynamic>> _data = {};
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    // كل مصدر مستقل: فشل واحد لا يوقف الباقي (زي Promise.allSettled).
    await Future.wait(_sources.entries.map((e) async {
      try {
        final d = await Api.instance.get(e.value);
        if (d is Map) _data[e.key] = Map<String, dynamic>.from(d);
      } catch (_) { /* تجاهل هذا المصدر */ }
    }));
    if (!mounted) return;
    setState(() { _loading = false; _error = _data.isEmpty ? tr('تعذّر تحميل البيانات', 'Could not load data') : null; });
  }

  dynamic _dig(Map<String, dynamic>? m, String path) {
    dynamic cur = m;
    if (path.isEmpty) return cur;
    for (final p in path.split('.')) {
      if (cur is Map) { cur = cur[p]; } else { return null; }
    }
    return cur;
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('النظرة التنفيذية', 'Executive Overview')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 150), SizedBox(height: 12), Shimmer(height: 150), SizedBox(height: 12), Shimmer(height: 150)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(14),
                    children: [
                      for (final cl in _clusters)
                        if (_data[cl.source] != null) _clusterCard(cl),
                      const SizedBox(height: 20),
                    ],
                  ),
                ),
    );
  }

  Widget _clusterCard(_Cluster cl) {
    final base = _dig(_data[cl.source], cl.basePath);
    final baseMap = base is Map ? Map<String, dynamic>.from(base) : <String, dynamic>{};
    final kpis = cl.kpis.where((k) => _dig(baseMap, k.$3) != null).toList();
    if (kpis.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: FadeSlideIn(
        child: AppCard(
          topAccent: cl.color,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: cl.color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                child: Icon(cl.icon, size: 18, color: cl.color),
              ),
              const SizedBox(width: 10),
              Text(tr(cl.ar, cl.en), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            ]),
            const SizedBox(height: 12),
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 8,
              crossAxisSpacing: 8,
              childAspectRatio: 2.5,
              children: kpis.map((k) {
                final v = _dig(baseMap, k.$3);
                final text = k.$4 ? '${_money(v)} ${tr('ر.س', 'SAR')}' : (k.$3.contains('Rate') || k.$3 == 'attainment' ? '${_num(v)}%' : _num(v));
                return Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(color: cl.color.withValues(alpha: 0.05), borderRadius: BorderRadius.circular(10)),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
                    Text(tr(k.$1, k.$2), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
                  ]),
                );
              }).toList(),
            ),
          ]),
        ),
      ),
    );
  }
}
