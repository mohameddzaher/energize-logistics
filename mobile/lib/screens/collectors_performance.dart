import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// أداء المحصّلين — ترتيب المحصّلين حسب الكفاءة: المستهدف مقابل المحصّل،
/// عدد الدفعات، والوفاء بالوعود — من /api/analytics/performance.
class CollectorsPerformanceScreen extends StatefulWidget {
  const CollectorsPerformanceScreen({super.key});
  @override
  State<CollectorsPerformanceScreen> createState() => _CollectorsPerformanceScreenState();
}

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

class _CollectorsPerformanceScreenState extends State<CollectorsPerformanceScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('payment:logged', _onLive);
    Live.instance.on('collection:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('payment:logged', _onLive);
    Live.instance.off('collection:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/analytics/performance');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['ranking'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  num _n(dynamic v) => v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('أداء المحصّلين', 'Collectors Performance')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _rows.isEmpty
                      ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.leaderboard_outlined, title: tr('لا توجد بيانات أداء', 'No performance data'))])
                      : ListView.separated(
                          padding: const EdgeInsets.all(14),
                          itemCount: _rows.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (c, i) {
                            final r = _rows[i];
                            final collector = r['collector'] is Map ? Map<String, dynamic>.from(r['collector']) : {};
                            final eff = _n(r['efficiency']).toDouble();
                            final target = _n(r['target']);
                            final collected = _n(r['totalCollected']);
                            final rankColor = i == 0 ? const Color(0xFFD4AF37) : i == 1 ? const Color(0xFF9CA3AF) : i == 2 ? const Color(0xFFCD7F32) : T.navy;
                            final effColor = eff >= 80 ? T.success : eff >= 50 ? T.warn : T.danger;
                            return FadeSlideIn(
                              delayMs: (i * 15).clamp(0, 150),
                              child: AppCard(
                                topAccent: effColor,
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    CircleAvatar(radius: 14, backgroundColor: rankColor.withValues(alpha: 0.15),
                                        child: Text('${i + 1}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: rankColor))),
                                    const SizedBox(width: 10),
                                    Expanded(child: Text((collector['name'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                    Chip2('${eff.round()}%', effColor),
                                  ]),
                                  const SizedBox(height: 8),
                                  ClipRRect(
                                    borderRadius: BorderRadius.circular(4),
                                    child: LinearProgressIndicator(
                                      value: (eff / 100).clamp(0, 1).toDouble(),
                                      minHeight: 8,
                                      backgroundColor: effColor.withValues(alpha: 0.1),
                                      color: effColor,
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  Wrap(spacing: 6, runSpacing: 6, children: [
                                    Chip2('${tr('محصّل', 'Collected')}: ${_money(collected)}', T.success),
                                    Chip2('${tr('مستهدف', 'Target')}: ${_money(target)}', T.info),
                                    Chip2('${tr('دفعات', 'Payments')}: ${_n(r['paymentCount']).toInt()}', T.navy),
                                    if (r['promiseFulfillment'] != null) Chip2('${tr('وفاء الوعود', 'Promises')}: ${_n(r['promiseFulfillment']).round()}%', T.violet),
                                  ]),
                                ]),
                              ),
                            );
                          },
                        ),
                ),
    );
  }
}
