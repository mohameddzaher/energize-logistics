import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// تحليل تشغيل الموردين — native: the category split, top vendors, wasted
/// capacity and rep performance for the last three recorded months.
class ContractsAnalysisScreen extends StatefulWidget {
  const ContractsAnalysisScreen({super.key});
  @override
  State<ContractsAnalysisScreen> createState() => _ContractsAnalysisScreenState();
}

const _cats = {
  'signed': ('موقّعون', 'Signed', T.success),
  'credit': ('غير موقّعين — أجل', 'Unsigned credit', T.warn),
  'cash': ('غير موقّعين — كاش', 'Unsigned cash', Color(0xFFEA580C)),
  'external': ('أفراد خارجية', 'External', T.danger),
};

class _ContractsAnalysisScreenState extends State<ContractsAnalysisScreen> {
  Map<String, dynamic>? _a;
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('contracts:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('contracts:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      // Default window = the last 3 recorded months (a rolling quarter).
      final dash = await Api.instance.get('/api/contracts/dashboard');
      final months = List<Map<String, dynamic>>.from(dash['utilisationMonths'] ?? []);
      String fmt(Map<String, dynamic> m) => '${m['year']}-${m['month'].toString().padLeft(2, '0')}';
      final from = months.length >= 3 ? fmt(months[months.length - 3]) : (months.isNotEmpty ? fmt(months.first) : '2026-01');
      final to = months.isNotEmpty ? fmt(months.last) : '2026-12';
      final a = await Api.instance.get('/api/contracts/analysis?from=$from&to=$to');
      if (!mounted) return;
      setState(() { _a = Map<String, dynamic>.from(a); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final totals = _a?['totals'] as Map<String, dynamic>?;
    final byCat = (totals?['byCategory'] as Map<String, dynamic>?) ?? {};
    final total = (totals?['orders'] ?? 0).toDouble();
    final top = List<Map<String, dynamic>>.from(_a?['topVendors'] ?? []);
    final wasted = List<Map<String, dynamic>>.from(_a?['wastedCapacity'] ?? []);
    final reps = List<Map<String, dynamic>>.from(_a?['reps'] ?? []);

    return AppScaffold(
      title: Text(tr('تحليل التشغيل', 'Utilisation Analysis')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 92), SizedBox(height: 10), Shimmer(height: 160), SizedBox(height: 10), Shimmer(height: 240),
            ])
          : _error != null || totals == null
              ? ErrorRetry(message: _error ?? '—', onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(14),
                    children: [
                      FadeSlideIn(
                        child: AppCard(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(tr('إجمالي طلبات الفترة (آخر ٣ أشهر مسجلة)', 'Total orders — last 3 recorded months'),
                                style: const TextStyle(fontSize: 12.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
                            const SizedBox(height: 4),
                            Text((totals['orders'] ?? 0).round().toString(),
                                style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800, color: T.navy)),
                            const SizedBox(height: 12),
                            // Stacked share bar
                            ClipRRect(
                              borderRadius: BorderRadius.circular(12),
                              child: SizedBox(
                                height: 16,
                                child: Row(
                                  children: _cats.entries.map((e) {
                                    final share = total > 0 ? ((byCat[e.key] ?? 0) / total) : 0.0;
                                    return Expanded(flex: (share * 1000).round().clamp(1, 1000), child: Container(color: e.value.$3));
                                  }).toList(),
                                ),
                              ),
                            ),
                            const SizedBox(height: 10),
                            Wrap(spacing: 8, runSpacing: 6, children: _cats.entries.map((e) {
                              final n = (byCat[e.key] ?? 0).toDouble();
                              final pct = total > 0 ? (n / total * 100).toStringAsFixed(1) : '0';
                              return Chip2('${tr(e.value.$1, e.value.$2)} · $pct%', e.value.$3);
                            }).toList()),
                          ]),
                        ),
                      ),
                      const SizedBox(height: 12),
                      // Top vendors
                      FadeSlideIn(
                        delayMs: 100,
                        child: AppCard(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(tr('أعلى الموردين تشغيلًا', 'Top vendors'), style: const TextStyle(fontWeight: FontWeight.w800)),
                            const SizedBox(height: 10),
                            ...top.take(10).toList().asMap().entries.map((e) {
                              final v = e.value;
                              final cat = _cats[v['category']] ?? _cats['signed']!;
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: Row(children: [
                                  Container(
                                    width: 22, height: 22,
                                    decoration: BoxDecoration(color: T.navy.withValues(alpha: 0.07), borderRadius: BorderRadius.circular(7)),
                                    child: Center(child: Text('${e.key + 1}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: T.navy))),
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(child: Text(v['vendorName'] ?? '', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis)),
                                  Chip2(tr(cat.$1, cat.$2), cat.$3),
                                  const SizedBox(width: 6),
                                  Text((v['totalOrders'] ?? 0).round().toString(), style: const TextStyle(fontWeight: FontWeight.w800)),
                                ]),
                              );
                            }),
                          ]),
                        ),
                      ),
                      const SizedBox(height: 12),
                      // Wasted capacity
                      FadeSlideIn(
                        delayMs: 160,
                        child: AppCard(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              const Icon(Icons.trending_down, size: 18, color: T.danger),
                              const SizedBox(width: 6),
                              Expanded(child: Text(tr('طاقة مهدرة — موقّعون باستغلال أقل من ٥٪', 'Wasted capacity (<5% used)'), style: const TextStyle(fontWeight: FontWeight.w800))),
                            ]),
                            const SizedBox(height: 10),
                            if (wasted.isEmpty)
                              Text(tr('لا توجد حالات في هذه الفترة', 'None in this window'), style: const TextStyle(color: T.inkSoft, fontSize: 13)),
                            ...wasted.take(8).map((w) => Padding(
                                  padding: const EdgeInsets.only(bottom: 8),
                                  child: Row(children: [
                                    Expanded(
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Text(w['vendorName'] ?? '', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis),
                                        Text(tr('${w['fleetSize']} سيارة → ${(w['totalOrders'] ?? 0).round()} طلب', '${w['fleetSize']} veh → ${(w['totalOrders'] ?? 0).round()} orders'),
                                            style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                      ]),
                                    ),
                                    Chip2('${((w['utilisation'] ?? 0) * 100).toStringAsFixed(1)}%', T.danger),
                                  ]),
                                )),
                          ]),
                        ),
                      ),
                      const SizedBox(height: 12),
                      // Reps
                      FadeSlideIn(
                        delayMs: 220,
                        child: AppCard(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(tr('أداء مناديب التشغيل', 'Ops rep performance'), style: const TextStyle(fontWeight: FontWeight.w800)),
                            const SizedBox(height: 10),
                            if (reps.isEmpty)
                              Text(tr('لا توجد بيانات مناديب لهذه الفترة', 'No rep data'), style: const TextStyle(color: T.inkSoft, fontSize: 13)),
                            ...reps.take(10).map((r) {
                              final maxOrders = (reps.first['orders'] ?? 1).toDouble();
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: Row(children: [
                                  SizedBox(width: 84, child: Text(r['rep'] ?? '', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis)),
                                  Expanded(
                                    child: ClipRRect(
                                      borderRadius: BorderRadius.circular(10),
                                      child: LinearProgressIndicator(
                                        value: ((r['orders'] ?? 0).toDouble() / maxOrders).clamp(0.02, 1),
                                        minHeight: 12,
                                        backgroundColor: const Color(0xFFF1F5F9),
                                        valueColor: const AlwaysStoppedAnimation(T.cyan),
                                      ),
                                    ),
                                  ),
                                  SizedBox(width: 44, child: Text((r['orders'] ?? 0).round().toString(), textAlign: TextAlign.end, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800))),
                                ]),
                              );
                            }),
                          ]),
                        ),
                      ),
                    ],
                  ),
                ),
    );
  }
}
