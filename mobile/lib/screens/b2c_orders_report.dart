import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// تقريرُ تحقيق المناديب — في لوحة B2C، نظيرُ OrdersReport في الموقع.
///
/// عددُ المناديب حسب الجهة، وأوردراتُ اليوم والشهر، وملخّصُ التحقيق حسب المشرف والمشروع —
/// من مدخلات الأوردرات (GET /api/b2c/entry?report=1)، ويتحدّث مع كلّ إدخال.
class B2cOrdersReportCard extends StatefulWidget {
  const B2cOrdersReportCard({super.key});
  @override
  State<B2cOrdersReportCard> createState() => _B2cOrdersReportCardState();
}

class _B2cOrdersReportCardState extends State<B2cOrdersReportCard> {
  Map<String, dynamic>? _d;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    for (final e in ['b2c:order:upserted', 'lt:updated', 'b2c:entry:scope']) { Live.instance.on(e, _onLive); }
  }

  @override
  void dispose() {
    for (final e in ['b2c:order:upserted', 'lt:updated', 'b2c:entry:scope']) { Live.instance.off(e, _onLive); }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = Map<String, dynamic>.from(await Api.instance.get('/api/b2c/entry?report=1') as Map);
      if (mounted) setState(() => _d = d);
    } catch (_) {}
  }

  String _pct(dynamic p) => p == null ? '—' : '${((p as num) * 100).round()}%';

  @override
  Widget build(BuildContext context) {
    final d = _d;
    if (d == null || d['cards'] == null) return const SizedBox.shrink();
    final c = Map<String, dynamic>.from(d['cards']);
    final reps = Map<String, dynamic>.from(c['reps'] ?? {});
    final summary = List<Map<String, dynamic>>.from(d['summary'] ?? []);
    final tot = Map<String, dynamic>.from(d['summaryTotal'] ?? {});
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(tr('تقرير تحقيق المناديب', 'Reps achievement report'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14.5)),
        const SizedBox(height: 6),
        Wrap(spacing: 6, runSpacing: 6, children: [
          Chip2('${tr('إجمالي المناديب', 'Reps')} ${reps['total'] ?? 0}', T.navy),
          Chip2('كفالة ${reps['كفالة'] ?? 0}', T.inkSoft),
          Chip2('فري لانسر ${reps['فري لانسر'] ?? 0}', T.inkSoft),
          Chip2('يوزرات ${reps['يوزرات'] ?? 0}', T.inkSoft),
          Chip2('${tr('أوردرات اليوم', 'Today')} ${c['dayTotal'] ?? 0}', T.orange),
          Chip2('${tr('إجمالي الشهر', 'Month')} ${c['periodTotal'] ?? 0}', T.success),
        ]),
        const SizedBox(height: 8),
        Text(tr('ملخّص التحقيق حسب المشرف والمشروع', 'By supervisor & project'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
        for (final s in summary)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(children: [
              Expanded(child: Text('${s['supervisor'] == '—' ? tr('بلا مشرف', 'No supervisor') : s['supervisor']} · ${s['project']}', style: const TextStyle(fontSize: 12))),
              Text('${s['reps']}  ', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
              Text('${s['achieved']}', style: const TextStyle(fontSize: 12, color: T.success, fontWeight: FontWeight.w800)),
              const Text(' / '),
              Text('${s['near']}', style: const TextStyle(fontSize: 12, color: T.warn, fontWeight: FontWeight.w800)),
              const Text(' / '),
              Text('${s['far']}', style: const TextStyle(fontSize: 12, color: T.danger, fontWeight: FontWeight.w800)),
              SizedBox(width: 44, child: Text(_pct(s['rate']), textAlign: TextAlign.end, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12))),
            ]),
          ),
        const Divider(),
        Text(tr('الإجمالي: حقّق ${tot['achieved']} · قريب ${tot['near']} · بعيد ${tot['far']} · نسبة التحقيق ${_pct(tot['rate'])}', 'Total'),
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
      ])),
    );
  }
}
