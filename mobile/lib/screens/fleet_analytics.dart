import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'fleet_customer_profile.dart';

/// تحليلات إدارة الأسطول — نفس تحليلات صفحة الويب /system/fleet/dashboard:
/// الدخل، الأهداف، ترتيب السيارات/السواقين/العملاء/المشرفين، اتجاه الشهور.
/// بدون رسوم بيانية (الموبايل يعتمد بطاقات + أشرطة نسبية + جداول).
class FleetAnalyticsScreen extends StatefulWidget {
  const FleetAnalyticsScreen({super.key});
  @override
  State<FleetAnalyticsScreen> createState() => _FleetAnalyticsScreenState();
}

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  final neg = n < 0;
  final s = n.abs().round().toString();
  final b = StringBuffer();
  for (int i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write(',');
    b.write(s[i]);
  }
  return '${neg ? '-' : ''}$b';
}

class _FleetAnalyticsScreenState extends State<FleetAnalyticsScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;
  String _q = '';
  String _preset = 'thisMonth'; // thisMonth | lastMonth | all
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('fleet:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('fleet:updated', _onLive);
    super.dispose();
  }

  String _monthParam() {
    final now = DateTime.now();
    if (_preset == 'thisMonth') return '${now.year}-${now.month.toString().padLeft(2, '0')}';
    if (_preset == 'lastMonth') {
      final m = DateTime(now.year, now.month - 1, 1);
      return '${m.year}-${m.month.toString().padLeft(2, '0')}';
    }
    return '';
  }

  Future<void> _load() async {
    try {
      final mp = _monthParam();
      final qs = mp.isEmpty ? '' : '?month=$mp';
      final d = await Api.instance.get('/api/fleet/analytics$qs');
      if (!mounted) return;
      setState(() { _data = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s
      .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('تحليلات الأسطول', 'Fleet Analytics')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 44), SizedBox(height: 10), Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 160), SizedBox(height: 10), Shimmer(height: 200),
            ])
          : _error != null || _data == null
              ? ErrorRetry(message: _error ?? '—', onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(onRefresh: _load, child: _body()),
    );
  }

  Widget _body() {
    final d = _data!;
    final totals = Map<String, dynamic>.from(d['totals'] ?? {});
    final byCustomerType = Map<String, dynamic>.from(d['byCustomerType'] ?? {});
    final byTrailerType = Map<String, dynamic>.from(d['byTrailerType'] ?? {});
    final vehicles = List<Map<String, dynamic>>.from(d['vehicles'] ?? []);
    final topDrivers = List<Map<String, dynamic>>.from(d['topDrivers'] ?? []);
    final supervisors = List<Map<String, dynamic>>.from(d['supervisors'] ?? []);
    final heavy = List<Map<String, dynamic>>.from(d['topHeavyCustomers'] ?? []);
    final branch = List<Map<String, dynamic>>.from(d['topBranchCustomers'] ?? []);
    final trend = List<Map<String, dynamic>>.from(d['monthlyTrend'] ?? []);
    final q = _fold(_q.trim());

    List<Map<String, dynamic>> filterByName(List<Map<String, dynamic>> rows, List<String> keys) {
      if (q.isEmpty) return rows;
      return rows.where((r) => keys.any((k) => _fold((r[k] ?? '').toString()).contains(q))).toList();
    }

    final heavyInc = ((byCustomerType['heavy'] ?? const {})['income']);
    final branchInc = ((byCustomerType['branch'] ?? const {})['income']);
    final heavyCnt = ((byCustomerType['heavy'] ?? const {})['count']);
    final branchCnt = ((byCustomerType['branch'] ?? const {})['count']);

    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        // فلتر الفترة
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(children: [
            _presetChip('thisMonth', tr('هذا الشهر', 'This month')),
            _presetChip('lastMonth', tr('الشهر الماضي', 'Last month')),
            _presetChip('all', tr('الكل', 'All time')),
          ]),
        ),
        const SizedBox(height: 10),
        TextField(
          onChanged: (v) => setState(() => _q = v),
          decoration: InputDecoration(
            hintText: tr('ابحث في السيارات/السواقين/العملاء/المشرفين…', 'Search vehicles, drivers, customers…'),
            prefixIcon: const Icon(Icons.search),
          ),
        ),
        const SizedBox(height: 12),
        // بطاقات المؤشرات
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          childAspectRatio: 1.7,
          mainAxisSpacing: 8,
          crossAxisSpacing: 8,
          children: [
            _tile(tr('إجمالي إيجار السيارات', 'Total vehicle rent'), _money(totals['totalIncome']), T.success, Icons.payments_outlined),
            _tile(tr('حصة قسم الفروع', 'Branch dept share'), _money(totals['branchShare']), T.warn, Icons.call_split_rounded),
            _tile(tr('عدد الرحلات', 'Trips'), '${totals['tripCount'] ?? 0}', T.navy, Icons.route_outlined),
            _tile(tr('متوسط الرحلة', 'Avg / trip'), _money(totals['avgTripIncome']), T.info, Icons.trending_up_rounded),
            _tile(tr('سيارات حققت الهدف', 'On target'), '${totals['vehiclesAchieved'] ?? 0}', T.success, Icons.check_circle_outline),
            _tile(tr('تحت الهدف', 'Below target'), '${totals['vehiclesBelow'] ?? 0}', T.danger, Icons.trending_down_rounded),
            _tile(tr('عدد السيارات', 'Vehicles'), '${totals['vehicleCount'] ?? 0}', T.cyan, Icons.local_shipping_outlined),
            _tile(tr('عدد العملاء', 'Customers'), '${totals['customerCount'] ?? 0}', T.violet, Icons.people_outline),
          ],
        ),
        const SizedBox(height: 14),
        // دخل عملاء النقل الثقيل مقابل الفروع
        _section(tr('الدخل حسب نوع العميل', 'Income by customer type')),
        AppCard(
          child: Column(children: [
            _splitRow(tr('عملاء النقل الثقيل', 'Heavy transport'), heavyInc, heavyCnt, T.violet),
            const Divider(height: 18),
            _splitRow(tr('عملاء الفروع', 'Branch customers'), branchInc, branchCnt, T.info),
          ]),
        ),
        const SizedBox(height: 14),
        // اتجاه الشهور (12 شهر) — أشرطة نسبية
        if (trend.isNotEmpty) ...[
          _section(tr('اتجاه الدخل — ١٢ شهر', 'Income trend — 12 months')),
          AppCard(child: _trendBars(trend)),
          const SizedBox(height: 14),
        ],
        // السيارات مقابل الهدف
        _section(tr('السيارات مقابل الهدف', 'Vehicles vs target')),
        ...filterByName(vehicles, ['plate', 'supervisorName']).take(60).map(_vehicleRow),
        const SizedBox(height: 14),
        // أفضل السواقين
        if (topDrivers.isNotEmpty) ...[
          _section(tr('أفضل السواقين', 'Top drivers')),
          ...filterByName(topDrivers, ['name']).take(20).map((r) => _rankRow(
              (r['name'] ?? '—').toString(), '${r['trips'] ?? 0} ${tr('رحلة', 'trips')}', _money(r['income']), T.orange)),
          const SizedBox(height: 14),
        ],
        // المشرفون
        if (supervisors.isNotEmpty) ...[
          _section(tr('أداء المشرفين', 'Supervisors')),
          ...filterByName(supervisors, ['name']).map((r) => _rankRow(
              (r['name'] ?? '—').toString(), '${r['trips'] ?? 0} ${tr('حمولة', 'shipments')}', _money(r['income']), T.violet)),
          const SizedBox(height: 14),
        ],
        // نوع القاطرة (سطحة/ستارة/…)
        if (byTrailerType.isNotEmpty) ...[
          _section(tr('الرحلات حسب نوع القاطرة', 'Trips by trailer type')),
          AppCard(child: Wrap(spacing: 8, runSpacing: 8, children: byTrailerType.entries
              .map((e) => Chip2('${e.key}: ${e.value}', T.navy, icon: Icons.category_outlined)).toList())),
          const SizedBox(height: 14),
        ],
        // أفضل عملاء النقل الثقيل
        if (heavy.isNotEmpty) ...[
          _section(tr('أفضل عملاء النقل الثقيل', 'Top heavy customers')),
          ...filterByName(heavy, ['name']).map(_customerRow),
          const SizedBox(height: 14),
        ],
        // أفضل عملاء الفروع
        if (branch.isNotEmpty) ...[
          _section(tr('أفضل عملاء الفروع', 'Top branch customers')),
          ...filterByName(branch, ['name']).map(_customerRow),
        ],
        const SizedBox(height: 24),
      ],
    );
  }

  Widget _presetChip(String key, String label) {
    final sel = _preset == key;
    return Padding(
      padding: const EdgeInsets.only(left: 6),
      child: FilterChip(
        selected: sel,
        onSelected: (_) { setState(() { _preset = key; _loading = true; }); _load(); },
        label: Text(label),
        labelStyle: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: sel ? Colors.white : T.navy),
        selectedColor: T.navy,
        backgroundColor: T.navy.withValues(alpha: 0.08),
        checkmarkColor: Colors.white,
        side: BorderSide.none,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      ),
    );
  }

  Widget _section(String t) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(t, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
      );

  Widget _tile(String label, String value, Color color, IconData icon) => AppCard(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, size: 16, color: color),
          ),
          const SizedBox(height: 8),
          FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
              child: Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: color, height: 1))),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
        ]),
      );

  Widget _splitRow(String label, dynamic income, dynamic count, Color color) => Row(children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 8),
        Expanded(child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
        Text('${count ?? 0} ${tr('رحلة', 'trips')}', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
        const SizedBox(width: 10),
        Text(_money(income), style: TextStyle(fontWeight: FontWeight.w800, color: color)),
      ]);

  Widget _trendBars(List<Map<String, dynamic>> trend) {
    final maxInc = trend.fold<double>(1, (m, r) => (r['income'] is num && (r['income'] as num) > m) ? (r['income'] as num).toDouble() : m);
    return Column(children: trend.map((r) {
      final inc = (r['income'] is num) ? (r['income'] as num).toDouble() : 0.0;
      final frac = (inc / maxInc).clamp(0.0, 1.0);
      final month = (r['month'] ?? '').toString();
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [
          SizedBox(width: 52, child: Text(month.length >= 7 ? month.substring(2) : month, style: const TextStyle(fontSize: 11, color: T.inkFaint))),
          Expanded(
            child: Stack(children: [
              Container(height: 16, decoration: BoxDecoration(color: T.navy.withValues(alpha: 0.06), borderRadius: BorderRadius.circular(6))),
              FractionallySizedBox(
                widthFactor: frac == 0 ? 0.01 : frac,
                child: Container(height: 16, decoration: BoxDecoration(color: T.success.withValues(alpha: 0.85), borderRadius: BorderRadius.circular(6))),
              ),
            ]),
          ),
          const SizedBox(width: 8),
          SizedBox(width: 62, child: Text(_money(inc), textAlign: TextAlign.end, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700))),
        ]),
      );
    }).toList());
  }

  Widget _vehicleRow(Map<String, dynamic> v) {
    final pct = v['achievedPct'];
    final achieved = v['achieved'];
    final Color c = achieved == true ? T.success : (achieved == false ? T.danger : T.inkFaint);
    final double frac = (pct is num) ? (pct / 100).clamp(0.0, 1.0).toDouble() : 0.0;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text((v['plate'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(width: 8),
            if ((v['supervisorName'] ?? '').toString().isNotEmpty)
              Expanded(child: Text(v['supervisorName'].toString(), style: const TextStyle(fontSize: 11.5, color: T.inkFaint), overflow: TextOverflow.ellipsis)),
            const Spacer(),
            Text(_money(v['income']), style: TextStyle(fontWeight: FontWeight.w800, color: c)),
          ]),
          const SizedBox(height: 6),
          Row(children: [
            Expanded(child: Stack(children: [
              Container(height: 8, decoration: BoxDecoration(color: T.navy.withValues(alpha: 0.06), borderRadius: BorderRadius.circular(6))),
              FractionallySizedBox(widthFactor: frac == 0 ? 0.01 : frac, child: Container(height: 8, decoration: BoxDecoration(color: c.withValues(alpha: 0.85), borderRadius: BorderRadius.circular(6)))),
            ])),
            const SizedBox(width: 8),
            Text(pct == null ? '—' : '$pct%', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: c)),
          ]),
          const SizedBox(height: 4),
          Text('${v['trips'] ?? 0} ${tr('رحلة', 'trips')} · ${tr('الهدف', 'target')} ${_money(v['target'])}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        ]),
      ),
    );
  }

  Widget _rankRow(String name, String sub, String value, Color color) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: AppCard(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
              Text(sub, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            ])),
            Text(value, style: TextStyle(fontWeight: FontWeight.w800, color: color)),
          ]),
        ),
      );

  Widget _customerRow(Map<String, dynamic> r) {
    final rating = (r['rating'] is num) ? (r['rating'] as num).toInt() : 0;
    final id = (r['_id'] ?? '').toString();
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Pressable(
        onTap: id.isEmpty ? null : () => Navigator.push(context, MaterialPageRoute(builder: (c) => FleetCustomerProfileScreen(customerId: id))),
        child: AppCard(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text((r['name'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
              Row(children: [
                Text('${r['trips'] ?? 0} ${tr('رحلة', 'trips')}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                if (rating > 0) ...[
                  const SizedBox(width: 6),
                  ...List.generate(rating, (_) => const Icon(Icons.star_rounded, size: 12, color: Color(0xFFF59E0B))),
                ],
              ]),
            ])),
            Text(_money(r['income']), style: const TextStyle(fontWeight: FontWeight.w800, color: T.success)),
            if (id.isNotEmpty) Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, color: T.inkFaint, size: 18),
          ]),
        ),
      ),
    );
  }
}
