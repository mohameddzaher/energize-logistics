import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// تقييم الأداء (للإدارة العليا) — نظرة كل الأقسام: التغطية، متوسط النسبة،
/// التوزيع حسب النطاق، وأداء كل قسم. مطابقة لصفحة الويب
/// /system/performance/overview.
class PerformanceOverviewScreen extends StatefulWidget {
  const PerformanceOverviewScreen({super.key});
  @override
  State<PerformanceOverviewScreen> createState() => _PerformanceOverviewScreenState();
}

class _PerformanceOverviewScreenState extends State<PerformanceOverviewScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;
  String _q = '';

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/performance/overview');
      if (!mounted) return;
      setState(() { _data = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();
  String _pct(dynamic v) => v == null ? '—' : '${(v is num ? v : num.tryParse(v.toString()) ?? 0)}%';

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final totals = Map<String, dynamic>.from(d?['totals'] ?? {});
    final byBand = List<Map<String, dynamic>>.from(totals['byBand'] ?? []);
    final departments = List<Map<String, dynamic>>.from(d?['departments'] ?? []);
    final q = _fold(_q.trim());
    final deps = q.isEmpty ? departments : departments.where((x) => _fold((x['department'] ?? '').toString()).contains(q)).toList();

    return AppScaffold(
      title: Text(tr('نظرة كل الأقسام', 'All Departments')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 140)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    if ((d?['periodLabel'] ?? '').toString().isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Text('${tr('الفترة', 'Period')}: ${d?['periodLabel']}', style: const TextStyle(fontSize: 12.5, color: T.inkFaint, fontWeight: FontWeight.w600)),
                      ),
                    GridView.count(
                      crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                      childAspectRatio: 1.7, mainAxisSpacing: 8, crossAxisSpacing: 8,
                      children: [
                        _tile(tr('إجمالي الموظفين', 'Headcount'), '${totals['headcount'] ?? 0}', T.navy, Icons.groups_outlined),
                        _tile(tr('تم تقييمهم', 'Evaluated'), '${totals['evaluated'] ?? 0}', T.success, Icons.fact_check_outlined),
                        _tile(tr('نسبة التغطية', 'Coverage'), _pct(totals['coverage']), T.info, Icons.donut_large_outlined),
                        _tile(tr('متوسط النسبة', 'Avg %'), _pct(totals['avgPercentage']), T.orange, Icons.percent_rounded),
                        _tile(tr('مسودّات', 'Drafts'), '${totals['drafts'] ?? 0}', T.warn, Icons.edit_note_outlined),
                        _tile(tr('رواتب المكافآت', 'Bonus salaries'), '${totals['totalBonusSalaries'] ?? 0}', T.violet, Icons.card_giftcard_outlined),
                      ],
                    ),
                    if (byBand.isNotEmpty) ...[
                      const SizedBox(height: 14),
                      AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('التوزيع حسب النطاق', 'By band'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 10),
                          Wrap(spacing: 8, runSpacing: 8, children: byBand.map((b) {
                            final color = _bandColor((b['color'] ?? '').toString());
                            final name = (Lang.instance.ar ? b['ar'] : b['en'])?.toString() ?? (b['key'] ?? '').toString();
                            return Chip2('$name: ${b['count'] ?? 0}', color);
                          }).toList()),
                        ]),
                      ),
                    ],
                    const SizedBox(height: 14),
                    TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث بالقسم…', 'Search department…'), prefixIcon: const Icon(Icons.search)),
                    ),
                    const SizedBox(height: 10),
                    Text(tr('الأقسام', 'Departments'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 8),
                    if (deps.isEmpty)
                      EmptyState(icon: Icons.workspaces_outline, title: tr('لا توجد أقسام', 'No departments'))
                    else
                      ...deps.map((dep) {
                        final cov = (dep['coverage'] is num) ? (dep['coverage'] as num) : 0;
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: AppCard(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [
                                Expanded(child: Text((dep['department'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                if (dep['avgPercentage'] != null) Chip2(_pct(dep['avgPercentage']), T.orange),
                              ]),
                              const SizedBox(height: 8),
                              Row(children: [
                                Expanded(child: Stack(children: [
                                  Container(height: 8, decoration: BoxDecoration(color: T.navy.withValues(alpha: 0.06), borderRadius: BorderRadius.circular(6))),
                                  FractionallySizedBox(widthFactor: (cov / 100).clamp(0.0, 1.0).toDouble(), child: Container(height: 8, decoration: BoxDecoration(color: T.success.withValues(alpha: 0.85), borderRadius: BorderRadius.circular(6)))),
                                ])),
                                const SizedBox(width: 8),
                                Text('${dep['evaluated'] ?? 0}/${dep['headcount'] ?? 0}', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.inkFaint)),
                              ]),
                            ]),
                          ),
                        );
                      }),
                    const SizedBox(height: 24),
                  ]),
                ),
    );
  }

  Color _bandColor(String c) {
    switch (c.toLowerCase()) {
      case 'green': case 'success': return T.success;
      case 'blue': return T.info;
      case 'amber': case 'orange': case 'yellow': return T.warn;
      case 'red': return T.danger;
      case 'purple': case 'violet': return T.violet;
      default: return T.navy;
    }
  }

  Widget _tile(String label, String value, Color color, IconData icon) => AppCard(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(padding: const EdgeInsets.all(6), decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)), child: Icon(icon, size: 16, color: color)),
          const SizedBox(height: 8),
          FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart, child: Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: color, height: 1))),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
        ]),
      );
}

/// طلبات تعديل التقييم — قيد الانتظار + الأخيرة. مطابقة لـ
/// /system/performance/requests.
class PerformanceEditRequestsScreen extends StatefulWidget {
  const PerformanceEditRequestsScreen({super.key});
  @override
  State<PerformanceEditRequestsScreen> createState() => _PerformanceEditRequestsScreenState();
}

class _PerformanceEditRequestsScreenState extends State<PerformanceEditRequestsScreen> {
  List<Map<String, dynamic>> _pending = [], _recent = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('performance:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('performance:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/performance/edit-requests');
      if (!mounted) return;
      setState(() {
        _pending = List<Map<String, dynamic>>.from(d['pending'] ?? []);
        _recent = List<Map<String, dynamic>>.from(d['recent'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _who(Map<String, dynamic> r) {
    final e = r['employee'];
    if (e is Map) return (e['arabicName'] ?? e['englishName'] ?? e['name'] ?? '—').toString();
    return (r['employeeName'] ?? '—').toString();
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('طلبات تعديل التقييم', 'Edit Requests')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(height: 70)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    Text('${tr('قيد الانتظار', 'Pending')} (${_pending.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 8),
                    if (_pending.isEmpty)
                      EmptyState(icon: Icons.inbox_outlined, title: tr('لا توجد طلبات معلّقة', 'No pending requests'))
                    else
                      ..._pending.map((r) => _row(r, T.warn)),
                    if (_recent.isNotEmpty) ...[
                      const SizedBox(height: 14),
                      Text('${tr('الأخيرة', 'Recent')} (${_recent.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                      const SizedBox(height: 8),
                      ..._recent.map((r) => _row(r, T.inkFaint)),
                    ],
                    const SizedBox(height: 24),
                  ]),
                ),
    );
  }

  Widget _row(Map<String, dynamic> r, Color accent) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: AppCard(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(_who(r), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5))),
              if ((r['status'] ?? '').toString().isNotEmpty) Chip2(r['status'].toString(), accent),
            ]),
            if ((r['editRequestReason'] ?? r['requestReason'] ?? '').toString().isNotEmpty) ...[
              const SizedBox(height: 4),
              Text((r['editRequestReason'] ?? r['requestReason']).toString(), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            ],
            if ((r['department'] ?? '').toString().isNotEmpty)
              Padding(padding: const EdgeInsets.only(top: 4), child: Text(r['department'].toString(), style: const TextStyle(fontSize: 11, color: T.inkFaint))),
          ]),
        ),
      );
}
