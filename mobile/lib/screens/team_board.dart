import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// تقييم الأداء — the mobile twin of the web TeamBoard: the signed-in
/// manager's team for the current period with each member's score and band.
class TeamBoardScreen extends StatefulWidget {
  const TeamBoardScreen({super.key});
  @override
  State<TeamBoardScreen> createState() => _TeamBoardScreenState();
}

class _TeamBoardScreenState extends State<TeamBoardScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/performance/team');
      if (!mounted) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Color _scoreColor(num? score) {
    if (score == null) return T.inkFaint;
    if (score >= 90) return T.success;
    if (score >= 75) return T.cyan;
    if (score >= 60) return T.warn;
    return T.danger;
  }

  @override
  Widget build(BuildContext context) {
    final members = List<Map<String, dynamic>>.from(_d?['members'] ?? []);
    final summary = _d?['summary'] as Map<String, dynamic>?;
    return Scaffold(
      appBar: AppBar(title: Text(tr('تقييم الأداء', 'Performance'))),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 80), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer(),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: members.isEmpty
                      ? ListView(children: [
                          const SizedBox(height: 60),
                          EmptyState(
                            icon: Icons.leaderboard_outlined,
                            title: tr('لا يوجد فريق مرتبط بك في هذه الفترة', 'No team for this period'),
                            subtitle: tr('يعتمد الفريق على «المدير المباشر» في ملفات الموظفين.', 'Team comes from employees\' direct manager.'),
                          ),
                        ])
                      : ListView(
                          padding: const EdgeInsets.all(14),
                          children: [
                            if (_d?['periodLabel'] != null)
                              FadeSlideIn(
                                child: AppCard(
                                  child: Row(children: [
                                    const Icon(Icons.calendar_month_outlined, size: 18, color: T.navy),
                                    const SizedBox(width: 8),
                                    Text('${tr('الفترة', 'Period')}: ${_d!['periodLabel']}', style: const TextStyle(fontWeight: FontWeight.w800)),
                                    const Spacer(),
                                    if (summary?['avgScore'] != null)
                                      Chip2('${tr('المتوسط', 'Avg')}: ${(summary!['avgScore'] as num).toStringAsFixed(1)}', T.navy),
                                  ]),
                                ),
                              ),
                            const SizedBox(height: 10),
                            ...members.asMap().entries.map((e) {
                              final m = e.value;
                              final emp = m['employee'] as Map<String, dynamic>? ?? m;
                              final name = (emp['arabicName'] ?? '').toString().isNotEmpty
                                  ? emp['arabicName']
                                  : '${emp['firstName'] ?? ''} ${emp['lastName'] ?? ''}'.trim();
                              final eval0 = m['evaluation'] as Map<String, dynamic>?;
                              final score = (eval0?['finalScore'] ?? eval0?['score'] ?? m['score']) as num?;
                              final band = (eval0?['band'] ?? m['band'] ?? '').toString();
                              final color = _scoreColor(score);
                              return FadeSlideIn(
                                delayMs: (e.key * 25).clamp(0, 250),
                                child: Padding(
                                  padding: const EdgeInsets.only(bottom: 8),
                                  child: AppCard(
                                    child: Row(children: [
                                      CircleAvatar(
                                        radius: 20,
                                        backgroundColor: color.withValues(alpha: 0.12),
                                        child: Text(name.toString().isNotEmpty ? name.toString().characters.first : '؟',
                                            style: TextStyle(color: color, fontWeight: FontWeight.w800)),
                                      ),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                          Text(name.toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                                          Text((emp['jobTitle'] ?? emp['department'] ?? '').toString(),
                                              style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                                        ]),
                                      ),
                                      Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                        Text(score != null ? score.toStringAsFixed(0) : '—',
                                            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: color)),
                                        if (band.isNotEmpty) Chip2(band, color),
                                        if (eval0 == null)
                                          Chip2(tr('لم يُقيَّم', 'Not evaluated'), T.inkFaint),
                                      ]),
                                    ]),
                                  ),
                                ),
                              );
                            }),
                            const SizedBox(height: 6),
                            Text(
                              tr('التقييم التفصيلي (بنود المؤشرات والاعتماد) متاح على الويب — قادم للتطبيق.', 'Detailed evaluation forms are on the web — coming to the app.'),
                              style: const TextStyle(fontSize: 11.5, color: T.inkFaint),
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                ),
    );
  }
}
