import 'package:flutter/material.dart';
import '../services/lang.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'dash_specs.dart' show salesDashSpec;
import 'section_dash.dart';

/// Month in the server format YYYY-MM, `thisPeriod()` on the web.
String salesThisPeriod() {
  final n = DateTime.now();
  return '${n.year}-${n.month.toString().padLeft(2, '0')}';
}

/// Month picker, counterpart of MonthPicker on the web: the current month and earlier ones.
class SalesMonthPicker extends StatelessWidget {
  final String value;
  final ValueChanged<String> onChanged;
  const SalesMonthPicker({super.key, required this.value, required this.onChanged});

  static List<String> _months() {
    final n = DateTime.now();
    return [
      for (var i = 0; i < 36; i++)
        () {
          final d = DateTime(n.year, n.month - i, 1);
          return '${d.year}-${d.month.toString().padLeft(2, '0')}';
        }(),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final months = _months();
    if (!months.contains(value)) months.insert(0, value);
    return AppCard(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Row(children: [
        const Icon(Icons.calendar_month_outlined, color: T.orange, size: 20),
        const SizedBox(width: 8),
        Text(tr('الفترة', 'Period'), style: const TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(width: 12),
        Expanded(
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              value: value, isExpanded: true,
              items: [for (final m in months) DropdownMenuItem(value: m, child: Text(m))],
              onChanged: (v) { if (v != null) onChanged(v); },
            ),
          ),
        ),
      ]),
    );
  }
}

/// Sales dashboard for a chosen month: `/api/sales/dashboard?period=YYYY-MM`, as on the web. The same dashboard (salesDashSpec) is rebuilt for each month.
class SalesDashboardScreen extends StatefulWidget {
  const SalesDashboardScreen({super.key});
  @override
  State<SalesDashboardScreen> createState() => _SalesDashboardScreenState();
}

class _SalesDashboardScreenState extends State<SalesDashboardScreen> {
  String _period = salesThisPeriod();

  @override
  Widget build(BuildContext context) {
    final s = salesDashSpec;
    return SectionDashScreen(
      key: ValueKey(_period),
      spec: DashSpec(
        arTitle: s.arTitle, enTitle: s.enTitle,
        endpoint: '${s.endpoint}?period=$_period',
        liveEvent: s.liveEvent,
        stats: s.stats, breakdowns: s.breakdowns, lists: s.lists,
        afterStats: s.afterStats, filters: s.filters, onDrill: s.onDrill, afterStatsDrill: s.afterStatsDrill,
        header: (data) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          SalesMonthPicker(value: _period, onChanged: (p) => setState(() => _period = p)),
          if (s.header != null) ...[const SizedBox(height: 10), s.header!(data)],
        ]),
      ),
    );
  }
}
