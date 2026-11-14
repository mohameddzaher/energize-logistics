import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Evaluation period, as on the web (lib/performance.ts): monthly by default; quarter or year chosen from the bar.
class PerfPeriod {
  final String type; // month | quarter | year
  final int year, month, quarter;
  const PerfPeriod(this.type, this.year, {this.month = 1, this.quarter = 1});
  factory PerfPeriod.now() { final n = DateTime.now(); return PerfPeriod('month', n.year, month: n.month, quarter: (n.month - 1) ~/ 3 + 1); }

  String get key => type == 'month' ? '$year-M${month.toString().padLeft(2, '0')}' : type == 'quarter' ? '$year-Q$quarter' : '$year';
  String get label {
    const q = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع'];
    if (type == 'month') return tr('شهر $month/$year', '$month/$year');
    if (type == 'quarter') return tr('الربع ${q[quarter]} $year', 'Q$quarter $year');
    return tr('سنة $year', 'Year $year');
  }

  PerfPeriod step(int dir) {
    if (type == 'month') { var m = month + dir, y = year; if (m > 12) { m = 1; y++; } else if (m < 1) { m = 12; y--; } return PerfPeriod(type, y, month: m, quarter: (m - 1) ~/ 3 + 1); }
    if (type == 'quarter') { var q = quarter + dir, y = year; if (q > 4) { q = 1; y++; } else if (q < 1) { q = 4; y--; } return PerfPeriod(type, y, month: (q - 1) * 3 + 1, quarter: q); }
    return PerfPeriod(type, year + dir, month: month, quarter: quarter);
  }

  PerfPeriod withType(String t) => PerfPeriod(t, year, month: month, quarter: quarter);
}

/// Period type + arrows, the mobile counterpart of the web PeriodPicker.
class PerfPeriodBar extends StatelessWidget {
  final PerfPeriod period;
  final ValueChanged<PerfPeriod> onChanged;
  final String? subtitle;
  const PerfPeriodBar({super.key, required this.period, required this.onChanged, this.subtitle});

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
      child: Column(children: [
        SegmentedButton<String>(
          segments: [
            ButtonSegment(value: 'month', label: Text(tr('شهري', 'Monthly'))),
            ButtonSegment(value: 'quarter', label: Text(tr('ربع سنوي', 'Quarterly'))),
            ButtonSegment(value: 'year', label: Text(tr('سنوي', 'Yearly'))),
          ],
          selected: {period.type},
          onSelectionChanged: (s) => onChanged(period.withType(s.first)),
        ),
        Row(children: [
          IconButton(onPressed: () => onChanged(period.step(-1)), icon: const Icon(Icons.chevron_left), tooltip: tr('السابق', 'Previous')),
          Expanded(child: Column(children: [
            Text(period.label, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
            if (subtitle != null) Text(subtitle!, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          ])),
          IconButton(onPressed: () => onChanged(period.step(1)), icon: const Icon(Icons.chevron_right), tooltip: tr('التالي', 'Next')),
        ]),
      ]),
    );
  }
}

const _bands = {
  'not_eligible': ('غير مستحِق', 'Not eligible', T.danger),
  'good': ('جيد', 'Good', T.warn),
  'very_good': ('جيد جدًّا', 'Very good', T.info),
  'excellent': ('ممتاز', 'Excellent', T.success),
};

/// The general manager's detailed review (web PerformanceReport): every evaluation inside the period, filterable by
/// department and status, each opening on its criteria, weights, scores and notes. GET /api/performance/report.
class PerfReportList extends StatefulWidget {
  final PerfPeriod period;
  const PerfReportList({super.key, required this.period});
  @override
  State<PerfReportList> createState() => _PerfReportListState();
}

class _PerfReportListState extends State<PerfReportList> {
  Map<String, dynamic>? _d;
  String _dept = '', _status = '', _q = '';
  int _seq = 0;
  void _onLive() => _load();

  @override
  void initState() { super.initState(); _load(); Live.instance.on('performance:updated', _onLive); }
  @override
  void dispose() { Live.instance.off('performance:updated', _onLive); super.dispose(); }
  @override
  void didUpdateWidget(covariant PerfReportList old) { super.didUpdateWidget(old); if (old.period.key != widget.period.key) _load(); }

  Future<void> _load() async {
    final my = ++_seq;
    try {
      final qs = 'period=${widget.period.key}${_dept.isEmpty ? '' : '&department=${Uri.encodeQueryComponent(_dept)}'}${_status.isEmpty ? '' : '&status=$_status'}';
      final d = await Api.instance.get('/api/performance/report?$qs');
      if (mounted && my == _seq) setState(() => _d = Map<String, dynamic>.from(d));
    } catch (_) {/* keep last */}
  }

  @override
  Widget build(BuildContext context) {
    final all = ((_d?['evaluations'] as List?) ?? const []).whereType<Map>().toList();
    final q = _q.trim();
    final rows = q.isEmpty ? all : all.where((r) => '${r['employeeName']} ${r['jobTitle']} ${r['evaluatorName']}'.contains(q)).toList();
    final depts = ((_d?['departments'] as List?) ?? const []).whereType<Map>().toList();
    final t = (_d?['totals'] as Map?) ?? const {};
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(tr('تفاصيل التقييمات', 'Evaluation details'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
      Text(tr('${t['count'] ?? 0} تقييم لـ ${t['people'] ?? 0} شخص · المتوسّط ${t['avgPercentage'] ?? '—'}% · البونص ${t['bonus'] ?? 0} راتب',
          '${t['count'] ?? 0} evaluations of ${t['people'] ?? 0} people · avg ${t['avgPercentage'] ?? '—'}% · bonus ${t['bonus'] ?? 0}'),
          style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
      const SizedBox(height: 8),
      Row(children: [
        Expanded(child: DropdownButtonFormField<String>(
          initialValue: _dept, isExpanded: true, decoration: InputDecoration(labelText: tr('القسم', 'Department'), isDense: true),
          items: [DropdownMenuItem(value: '', child: Text(tr('كلّ الأقسام', 'All'))), for (final d in depts) DropdownMenuItem(value: '${d['key']}', child: Text('${d['name']}', overflow: TextOverflow.ellipsis))],
          onChanged: (v) { setState(() => _dept = v ?? ''); _load(); },
        )),
        const SizedBox(width: 8),
        Expanded(child: DropdownButtonFormField<String>(
          initialValue: _status, isExpanded: true, decoration: InputDecoration(labelText: tr('الحالة', 'Status'), isDense: true),
          items: [
            DropdownMenuItem(value: '', child: Text(tr('الكلّ', 'Any'))),
            DropdownMenuItem(value: 'submitted', child: Text(tr('مكتمل', 'Submitted'))),
            DropdownMenuItem(value: 'draft', child: Text(tr('مسودة', 'Draft'))),
          ],
          onChanged: (v) { setState(() => _status = v ?? ''); _load(); },
        )),
      ]),
      const SizedBox(height: 8),
      TextField(decoration: InputDecoration(hintText: tr('بحث بالاسم أو الوظيفة أو المقيِّم…', 'Name, job or evaluator…'), prefixIcon: const Icon(Icons.search), isDense: true),
          onChanged: (v) => setState(() => _q = v)),
      const SizedBox(height: 8),
      if (rows.isEmpty)
        EmptyState(icon: Icons.fact_check_outlined, title: tr('لا تقييماتٍ في هذه الفترة بهذا الفلتر', 'No evaluations for this period and filter'))
      else
        for (final r in rows) _card(r),
    ]);
  }

  Widget _card(Map r) {
    final b = _bands['${r['band']}'];
    final submitted = r['status'] == 'submitted';
    final crit = ((r['criteria'] as List?) ?? const []).whereType<Map>().toList();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        padding: EdgeInsets.zero,
        child: ExpansionTile(
          shape: const Border(), collapsedShape: const Border(),
          title: Text('${r['employeeName'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
          subtitle: Text([r['department'], r['periodLabel'], r['evaluatorName']].where((e) => '${e ?? ''}'.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text(r['percentage'] == null ? '—' : '${r['percentage']}%', style: const TextStyle(fontWeight: FontWeight.w900)),
            Text(submitted ? (b == null ? tr('مكتمل', 'Submitted') : tr(b.$1, b.$2)) : tr('مسودة', 'Draft'),
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: submitted ? (b?.$3 ?? T.success) : T.inkFaint)),
          ]),
          childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
          children: [
            for (final c in crit)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${(Lang.instance.ar ? c['titleAr'] : c['title']) ?? c['titleAr'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                    if ('${c['note'] ?? ''}'.isNotEmpty) Text('${c['note']}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                  ])),
                  Text('${c['weight'] ?? '—'}%', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                  const SizedBox(width: 10),
                  Text('${c['score'] ?? '—'}/5', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
                ]),
              ),
            if ('${r['notes'] ?? ''}'.isNotEmpty)
              Align(alignment: AlignmentDirectional.centerStart, child: Text('${tr('ملاحظات المقيِّم', 'Evaluator notes')}: ${r['notes']}', style: const TextStyle(fontSize: 12))),
            Align(alignment: AlignmentDirectional.centerStart, child: Text(
                '${tr('الدرجة', 'Score')}: ${r['weightedScore'] ?? '—'}/5 · ${tr('البونص', 'Bonus')}: ${r['bonusMultiplier'] ?? '—'} · ${tr('التاريخ', 'Date')}: ${r['evaluationDate'] ?? '—'}',
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
          ],
        ),
      ),
    );
  }
}
