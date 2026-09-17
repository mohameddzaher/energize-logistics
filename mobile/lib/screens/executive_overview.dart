import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// النظرة التنفيذية — الشركةُ كلُّها في شاشة، من النقطة نفسِها التي يقرؤها
/// الموقع (/api/analytics/executive): كلُّ قسمٍ من مصدره الحيّ، فلا يختلف رقمٌ
/// بين الهاتف والموقع. وكانت تنادي ثماني لوحات أوّلُها تقرأ جداولَ قسمٍ زال.
///
/// وتسمع `executive:changed` و`finance:changed` فتُعيد القراءة لحظةَ يتحرّك شيء.
class ExecutiveOverviewScreen extends StatefulWidget {
  const ExecutiveOverviewScreen({super.key});
  @override
  State<ExecutiveOverviewScreen> createState() => _ExecutiveOverviewScreenState();
}

const _sectionColor = <String, Color>{
  'emerald': T.success, 'orange': T.orange, 'indigo': T.navy, 'blue': T.info,
  'cyan': T.cyan, 'violet': T.violet, 'amber': T.warn, 'rose': T.danger, 'slate': T.inkSoft,
};
const _sectionIcon = <String, IconData>{
  'finance': Icons.account_balance_outlined, 'operations': Icons.workspaces_outline,
  'collections': Icons.request_quote_outlined, 'fleet': Icons.local_shipping_outlined,
  'ls2': Icons.speed_outlined, 'vehicles': Icons.directions_car_outlined, 'hr': Icons.badge_outlined,
  'customs': Icons.directions_boat_outlined, 'b2c': Icons.two_wheeler, 'commercial': Icons.trending_up_rounded,
};

class _ExecutiveOverviewScreenState extends State<ExecutiveOverviewScreen> {
  List<Map<String, dynamic>> _sections = [];
  bool _loading = true;
  String? _error;
  DateTime? _updatedAt;
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('executive:changed', _onLive);
    Live.instance.on('finance:changed', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('executive:changed', _onLive);
    Live.instance.off('finance:changed', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/analytics/executive');
      if (!mounted || mine != _seq) return;
      setState(() {
        _sections = List<Map<String, dynamic>>.from(d['sections'] ?? []);
        _loading = false;
        _error = null;
        _updatedAt = DateTime.now();
      });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fmt(Map<String, dynamic> k) {
    final v = k['value'];
    if (v == null) return '—';
    final n = (v as num);
    final format = '${k['format']}';
    String out;
    if (format == 'money') {
      final a = n.abs();
      out = a >= 1000000 ? '${(n / 1000000).toStringAsFixed(1)}M' : a >= 1000 ? '${(n / 1000).toStringAsFixed(0)}k' : n.round().toString();
    } else if (format == 'pct') {
      out = '${(n * 10).round() / 10}%';
    } else {
      out = n.round().toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');
    }
    return '$out${k['suffix'] ?? ''}';
  }

  Color _tone(Map<String, dynamic> k) {
    final n = (k['value'] as num?) ?? 0;
    if (n < 0) return T.danger;
    switch (k['tone']) {
      case 'good': return T.success;
      case 'bad': return T.danger;
      case 'warn': return T.warn;
      case 'auto': return T.success;
      default: return T.ink;
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('النظرة التنفيذية', 'Executive Overview')),
      body: _loading && _sections.isEmpty
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 120)])
          : _error != null && _sections.isEmpty
              ? ErrorRetry(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 24),
                    children: [
                      Row(children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                          decoration: BoxDecoration(color: T.success.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
                          child: Text(tr('● مباشر', '● Live'), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: T.success)),
                        ),
                        const Spacer(),
                        if (_updatedAt != null)
                          Text('${tr('آخر تحديث', 'Updated')} ${_updatedAt!.hour.toString().padLeft(2, '0')}:${_updatedAt!.minute.toString().padLeft(2, '0')}',
                              style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                      ]),
                      const SizedBox(height: 10),
                      ..._sections.map((s) {
                        final color = _sectionColor[s['color']] ?? T.navy;
                        final kpis = List<Map<String, dynamic>>.from(s['kpis'] ?? []);
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: AppCard(
                            topAccent: color,
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [
                                Icon(_sectionIcon[s['key']] ?? Icons.insights_outlined, size: 18, color: color),
                                const SizedBox(width: 8),
                                Expanded(child: Text(tr('${s['ar']}', '${s['en']}'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14.5))),
                              ]),
                              const SizedBox(height: 10),
                              LayoutBuilder(builder: (context, c) {
                                final w = (c.maxWidth - 8) / 2;
                                return Wrap(spacing: 8, runSpacing: 8, children: kpis.map((k) => Container(
                                      width: w,
                                      padding: const EdgeInsets.all(10),
                                      decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10)),
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Text(tr('${k['ar']}', '${k['en']}'), maxLines: 2, style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                                        const SizedBox(height: 3),
                                        Text(_fmt(k), style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: _tone(k))),
                                      ]),
                                    )).toList());
                              }),
                            ]),
                          ),
                        );
                      }),
                    ],
                  ),
                ),
    );
  }
}
