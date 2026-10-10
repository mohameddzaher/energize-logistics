import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'performance_evaluations.dart';

/// تقييم الأداء — the mobile twin of the web TeamBoard: the signed-in
/// manager's team for the current period with each member's score and band.
class TeamBoardScreen extends StatefulWidget {
  /// قسمُ النظام الذي تخصّه هذه الشاشة.
  ///
  /// الخادمُ يقرأ هذا فيردّ موظّفي الأقسام التي تملكها هذه الصفحة بحسب ملفّاتهم
  /// في الموارد البشريّة (راجع config/performanceDepartments في الخادم) — وهي
  /// القائمةُ نفسُها التي يعرضها الويب، والبطاقاتُ هنا تحت أقسامها مثلَه.
  final String? section;
  const TeamBoardScreen({super.key, this.section});
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
      final sec = widget.section;
      final d = await Api.instance.get(
        '/api/performance/team${sec == null || sec.isEmpty ? '' : '?section=${Uri.encodeQueryComponent(sec)}'}');
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

  // بطاقةُ موظّف. الحقولُ كما يردّها الخادم: `name` و`percentage` و`band`.
  Widget _memberCard(Map<String, dynamic> m, int i, Map<String, Map<String, dynamic>> bands) {
    final name = (m['name'] ?? '').toString();
    final eval0 = m['evaluation'] as Map<String, dynamic>?;
    final submitted = eval0?['status'] == 'submitted';
    final num? score = submitted && eval0?['percentage'] is num ? eval0!['percentage'] as num : null;
    final b = bands[(eval0?['band'] ?? '').toString()];
    final band = !submitted || b == null ? '' : ((Lang.instance.ar ? b['ar'] : b['en']) ?? '').toString();
    final color = _scoreColor(score);
    final empId = (m['_id'] ?? '').toString();
    final job = (m['jobTitle'] ?? '').toString();
    return FadeSlideIn(
      delayMs: (i * 25).clamp(0, 250),
      child: Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Pressable(
          onTap: empId.isEmpty
              ? null
              : () async {
                  await Navigator.push(context, MaterialPageRoute(
                    builder: (_) => EvaluateEmployeeScreen(
                      employeeId: empId,
                      name: name,
                      periodKey: (_d?['periodKey'] ?? '').toString(),
                    ),
                  ));
                  _load(); // حدّث الدرجة بعد الرجوع من التقييم
                },
          child: AppCard(
            child: Row(children: [
              CircleAvatar(
                radius: 20,
                backgroundColor: color.withValues(alpha: 0.12),
                child: Text(name.isNotEmpty ? name.characters.first : '؟',
                    style: TextStyle(color: color, fontWeight: FontWeight.w800)),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                  Text(job.isNotEmpty ? job : (m['department'] ?? '').toString(),
                      style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                ]),
              ),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Text(score != null ? '${score.toStringAsFixed(0)}%' : '—',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: color)),
                if (band.isNotEmpty) Chip2(band, color),
                if (eval0 == null)
                  Chip2(tr('لم يُقيَّم', 'Not evaluated'), T.inkFaint)
                else if (!submitted)
                  Chip2(tr('مسودة', 'Draft'), T.warn),
              ]),
              const SizedBox(width: 4),
              Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, color: T.inkFaint),
            ]),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final members = List<Map<String, dynamic>>.from(_d?['members'] ?? []);
    final summary = _d?['summary'] as Map<String, dynamic>?;
    // ── البطاقاتُ تحت أقسامها، بترتيب الخادم ──────────────────────────────
    // القسمُ ما كُتب في ملفّ الموظّف. والعنوانُ يظهر متى تعدّدت الأقسام.
    final groups = List<Map<String, dynamic>>.from(_d?['groups'] ?? []);
    final order = groups.map((g) => (g['key'] ?? '').toString()).toList();
    String keyOf(Map<String, dynamic> m) => (m['departmentKey'] ?? m['department'] ?? '').toString();
    int rank(String k) { final i = order.indexOf(k); return i < 0 ? order.length : i; }
    final sorted = [...members]..sort((a, b) => rank(keyOf(a)).compareTo(rank(keyOf(b))));
    final multi = sorted.map(keyOf).toSet().length > 1;
    // مفتاحُ الشريحة → اسمُها المعروض.
    final bands = <String, Map<String, dynamic>>{
      for (final b in List<Map<String, dynamic>>.from((_d?['settings'] as Map?)?['bands'] ?? []))
        (b['key'] ?? '').toString(): b,
    };
    final rows = <Widget>[];
    String? last;
    for (var i = 0; i < sorted.length; i++) {
      final m = sorted[i];
      final k = keyOf(m);
      if (multi && k != last) {
        last = k;
        final g = groups.firstWhere((x) => (x['key'] ?? '').toString() == k, orElse: () => <String, dynamic>{});
        final label = (Lang.instance.ar ? g['label'] : g['labelEn']) ?? m['department'] ?? '';
        final count = sorted.where((x) => keyOf(x) == k).length;
        rows.add(Padding(
          padding: const EdgeInsets.fromLTRB(4, 10, 4, 6),
          child: Row(children: [
            Expanded(child: Text(label.toString().isEmpty ? tr('بدون قسم', 'No department') : label.toString(),
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: T.navy))),
            Text('$count', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkFaint)),
          ]),
        ));
      }
      rows.add(_memberCard(m, i, bands));
    }
    return AppScaffold(
      title: Text(tr('تقييم الأداء', 'Performance')),
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
                            title: tr('لا يوجد موظفون لعرضهم', 'No employees to show'),
                            subtitle: tr('تُعرَض هنا أسماء الموظفين المسجَّلين في هذا القسم في ملفات الموارد البشرية ممّن يحقّ لك تقييمهم.',
                                'This page lists the employees whose HR file places them in this department and whom you may evaluate.'),
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
                                    if (summary?['avgPercentage'] != null)
                                      Chip2('${tr('المتوسط', 'Avg')}: ${(summary!['avgPercentage'] as num).toStringAsFixed(1)}%', T.navy),
                                  ]),
                                ),
                              ),
                            const SizedBox(height: 10),
                            ...rows,
                            const SizedBox(height: 6),
                            Text(
                              tr('اضغط على أي عضو لفتح نموذج التقييم التفصيلي (بنود المؤشرات والاعتماد).', 'Tap a member to open the detailed evaluation form.'),
                              style: const TextStyle(fontSize: 11.5, color: T.inkFaint),
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                ),
    );
  }
}
