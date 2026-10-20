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

  /// مناديبُ رقمٍ بعينه — بالقاعدة نفسِها التي يُفلتر بها جدولُ الموقع:
  /// «بلا مشرف» / «بلا مشروع» فلترٌ لا مسحُ فلتر، والكروتُ تعدّ مَن على رأس العمل.
  void _open(String title, bool Function(Map<String, dynamic> r) test, {bool onlyWorking = true}) {
    final rows = List<Map<String, dynamic>>.from((_d?['rows'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)))
        .where((r) => (!onlyWorking || r['ended'] != true) && test(r))
        .toList();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.75,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
              child: Text('$title — ${rows.length}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14.5)),
            ),
            const Divider(height: 1),
            Expanded(
              child: rows.isEmpty
                  ? Center(child: Text(tr('لا مناديب', 'No reps'), style: const TextStyle(color: T.inkFaint)))
                  : ListView.separated(
                      itemCount: rows.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (_, i) {
                        final r = rows[i];
                        final sup = (r['supervisorName'] ?? '').toString();
                        final proj = (r['projectAr'] ?? '').toString();
                        return ListTile(
                          dense: true,
                          title: Text((r['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                          subtitle: Text(
                            '${proj.isEmpty ? tr('بلا مشروع', 'No project') : proj} · ${sup.isEmpty ? tr('بلا مشرف', 'No supervisor') : sup} · ${r['kind'] ?? ''}',
                            style: const TextStyle(fontSize: 11.5),
                          ),
                          trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                            Text('${r['total'] ?? 0}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
                            Text('${r['evaluation'] ?? ''} · ${_pct(r['pct'])}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                          ]),
                        );
                      },
                    ),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _tap(Widget child, VoidCallback onTap) => InkWell(onTap: onTap, borderRadius: BorderRadius.circular(20), child: child);

  @override
  Widget build(BuildContext context) {
    final d = _d;
    if (d == null || d['cards'] == null) return const SizedBox.shrink();
    final c = Map<String, dynamic>.from(d['cards']);
    final reps = Map<String, dynamic>.from(c['reps'] ?? {});
    final summary = List<Map<String, dynamic>>.from(d['summary'] ?? []);
    final tot = Map<String, dynamic>.from(d['summaryTotal'] ?? {});
    String s(dynamic v) => (v ?? '').toString();
    // صفُّ الملخّص يطابق مندوبَه: «—» عند الخادم = بلا مشرف، والمشروعُ الفارغ = بلا مشروع.
    bool inGroup(Map<String, dynamic> r, Map<String, dynamic> g) =>
        s(r['supervisorName']) == (s(g['supervisor']) == '—' ? '' : s(g['supervisor'])) && s(r['projectAr']) == s(g['project']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(tr('تقرير تحقيق المناديب', 'Reps achievement report'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14.5)),
        const SizedBox(height: 2),
        Text(tr('اضغط أيَّ رقمٍ لعرض مناديبه', 'Tap any number to see its reps'), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
        const SizedBox(height: 6),
        Wrap(spacing: 6, runSpacing: 6, children: [
          _tap(Chip2('${tr('إجمالي المناديب', 'Reps')} ${reps['total'] ?? 0}', T.navy), () => _open(tr('إجمالي المناديب', 'Reps'), (_) => true)),
          for (final k in const ['كفالة', 'فري لانسر', 'يوزرات'])
            _tap(Chip2('$k ${reps[k] ?? 0}', T.inkSoft), () => _open(k, (r) => r['kind'] == k)),
          _tap(Chip2('${tr('أوردرات اليوم', 'Today')} ${c['dayTotal'] ?? 0}', T.orange),
              () => _open(tr('أُدخلت أوردراتهم اليوم', 'Entered today'), (r) => r['orders'] != null, onlyWorking: false)),
          _tap(Chip2('${tr('لم تُدخَل', 'Not entered')} ${(d['rows'] as List? ?? const []).where((r) => r['ended'] != true && r['orders'] == null).length}', T.danger),
              () => _open(tr('لم تُدخَل أوردراتهم', 'Not entered'), (r) => r['orders'] == null)),
          _tap(Chip2('${tr('إجمالي الشهر', 'Month')} ${c['periodTotal'] ?? 0}', T.success),
              () => _open(tr('لهم أوردرات في الفترة', 'With orders in the period'), (r) => ((r['total'] as num?) ?? 0) > 0, onlyWorking: false)),
          _tap(Chip2('${tr('في إجازة', 'On leave')} ${c['onLeave'] ?? 0}', T.info),
              () => _open(tr('في إجازة', 'On leave'), (r) => r['status'] == 'إجازة', onlyWorking: false)),
        ]),
        const SizedBox(height: 8),
        Text(tr('ملخّص التحقيق حسب المشرف والمشروع', 'By supervisor & project'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
        for (final g in summary)
          InkWell(
            onTap: () => _open('${s(g['supervisor']) == '—' ? tr('بلا مشرف', 'No supervisor') : s(g['supervisor'])} · ${s(g['project']).isEmpty ? tr('بلا مشروع', 'No project') : s(g['project'])}', (r) => inGroup(r, g)),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 5),
              child: Row(children: [
                Expanded(child: Text('${s(g['supervisor']) == '—' ? tr('بلا مشرف', 'No supervisor') : s(g['supervisor'])} · ${s(g['project']).isEmpty ? tr('بلا مشروع', 'No project') : s(g['project'])}', style: const TextStyle(fontSize: 12))),
                Text('${g['reps']}  ', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                for (final e in const [['achieved', 'حقق'], ['near', 'قريب'], ['far', 'بعيد']]) ...[
                  _tap(
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 2),
                      child: Text('${g[e[0]]}', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800,
                          color: e[0] == 'achieved' ? T.success : e[0] == 'near' ? T.warn : T.danger)),
                    ),
                    () => _open('${e[1]} · ${s(g['supervisor']) == '—' ? tr('بلا مشرف', 'No supervisor') : s(g['supervisor'])}', (r) => inGroup(r, g) && r['evaluation'] == e[1]),
                  ),
                  if (e[0] != 'far') const Text('/'),
                ],
                SizedBox(width: 44, child: Text(_pct(g['rate']), textAlign: TextAlign.end, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12))),
              ]),
            ),
          ),
        const Divider(),
        Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Text('${tr('الإجمالي', 'Total')}:', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
          _tap(Chip2('${tr('حقّق', 'Achieved')} ${tot['achieved'] ?? 0}', T.success), () => _open(tr('حقّق', 'Achieved'), (r) => r['evaluation'] == 'حقق')),
          _tap(Chip2('${tr('قريب', 'Near')} ${tot['near'] ?? 0}', T.warn), () => _open(tr('قريب', 'Near'), (r) => r['evaluation'] == 'قريب')),
          _tap(Chip2('${tr('بعيد', 'Far')} ${tot['far'] ?? 0}', T.danger), () => _open(tr('بعيد', 'Far'), (r) => r['evaluation'] == 'بعيد')),
          Text('${tr('نسبة التحقيق', 'Rate')} ${_pct(tot['rate'])}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
        ]),
      ])),
    );
  }
}
