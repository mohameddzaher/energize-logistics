import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// المشاكل المتكررة — تجميع التذاكر المتشابهة (بالبصمة) بعدد التكرار، لكشف
/// الأعطال المزمنة. نفس /api/it/tickets/recurring على الويب.
class ItRecurringScreen extends StatefulWidget {
  const ItRecurringScreen({super.key});
  @override
  State<ItRecurringScreen> createState() => _ItRecurringScreenState();
}

class _ItRecurringScreenState extends State<ItRecurringScreen> {
  List<Map<String, dynamic>> _groups = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/it/tickets/recurring');
      if (!mounted) return;
      setState(() { _groups = List<Map<String, dynamic>>.from(d['groups'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _d(dynamic v) {
    final x = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
    return x == null ? '—' : '${x.day}/${x.month}/${x.year}';
  }

  Color _sevColor(num c) => c >= 5 ? T.danger : c >= 3 ? T.warn : T.info;

  @override
  Widget build(BuildContext context) {
    final sorted = [..._groups]..sort((a, b) => ((b['count'] ?? 0) as num).compareTo((a['count'] ?? 0) as num));
    return AppScaffold(
      title: Text(tr('المشاكل المتكررة', 'Recurring Problems')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 80), SizedBox(height: 10), Shimmer(height: 80)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: sorted.isEmpty
                      ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.check_circle_outline, title: tr('لا توجد مشاكل متكررة', 'No recurring problems'))])
                      : ListView.separated(
                          padding: const EdgeInsets.all(14),
                          itemCount: sorted.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 10),
                          itemBuilder: (c, i) {
                            final g = sorted[i];
                            final count = (g['count'] ?? 0) as num;
                            final color = _sevColor(count);
                            return FadeSlideIn(
                              delayMs: (i * 20).clamp(0, 200),
                              child: AppCard(
                                topAccent: color,
                                child: Row(children: [
                                  Container(
                                    width: 46, height: 46,
                                    decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
                                    alignment: Alignment.center,
                                    child: Text('×${count.toInt()}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: color)),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Text((g['sampleTitle'] ?? g['signature'] ?? '—').toString(),
                                          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5), maxLines: 2, overflow: TextOverflow.ellipsis),
                                      const SizedBox(height: 5),
                                      Wrap(spacing: 6, runSpacing: 6, children: [
                                        if ((g['category'] ?? '').toString().isNotEmpty) Chip2(g['category'].toString(), T.navy),
                                        Chip2('${tr('آخر', 'Last')}: ${_d(g['lastReportedAt'])}', T.inkFaint),
                                      ]),
                                    ]),
                                  ),
                                ]),
                              ),
                            );
                          },
                        ),
                ),
    );
  }
}
