import 'package:flutter/material.dart';
import '../services/lang.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'dash_specs.dart' show marketingDashSpec;
import 'section_dash.dart';

String _iso(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// Marketing date range, `DateRange` in lib/marketing.ts.
typedef MarketingRange = ({DateTime from, DateTime to});

/// From the first of the month to today, like `thisMonthToDate()` on the web (the default).
MarketingRange marketingThisMonth() {
  final n = DateTime.now();
  return (from: DateTime(n.year, n.month, 1), to: DateTime(n.year, n.month, n.day));
}

MarketingRange _lastN(int days) {
  final n = DateTime.now();
  final to = DateTime(n.year, n.month, n.day);
  return (from: to.subtract(Duration(days: days - 1)), to: to);
}

String marketingRangeQs(MarketingRange r) => 'from=${_iso(r.from)}&to=${_iso(r.to)}';

/// From/to with quick periods, counterpart of RangePicker on the web; used by the marketing dashboard and the periodic report so both pages read the same way.
class MarketingRangePicker extends StatelessWidget {
  final MarketingRange value;
  final ValueChanged<MarketingRange> onChanged;
  final bool dark;
  const MarketingRangePicker({super.key, required this.value, required this.onChanged, this.dark = false});

  @override
  Widget build(BuildContext context) {
    final presets = <(String, String, MarketingRange)>[
      ('7 أيام', '7 days', _lastN(7)),
      ('30 يوم', '30 days', _lastN(30)),
      ('هذا الشهر', 'This month', marketingThisMonth()),
      ('90 يوم', '90 days', _lastN(90)),
    ];
    bool same(MarketingRange a, MarketingRange b) => _iso(a.from) == _iso(b.from) && _iso(a.to) == _iso(b.to);
    return SizedBox(
      height: 40,
      child: ListView(scrollDirection: Axis.horizontal, children: [
        ActionChip(
          avatar: const Icon(Icons.date_range_outlined, size: 16),
          label: Text('${_iso(value.from)} → ${_iso(value.to)}'),
          onPressed: () async {
            final r = await showDateRangePicker(
              context: context, firstDate: DateTime(2018), lastDate: DateTime.now().add(const Duration(days: 365)),
              initialDateRange: DateTimeRange(start: value.from, end: value.to),
            );
            if (r != null) onChanged((from: r.start, to: r.end));
          },
        ),
        for (final p in presets)
          Padding(
            padding: const EdgeInsetsDirectional.only(start: 6),
            child: ChoiceChip(
              label: Text(tr(p.$1, p.$2)),
              selected: same(p.$3, value),
              selectedColor: T.orange,
              onSelected: (_) => onChanged(p.$3),
            ),
          ),
      ]),
    );
  }
}

/// Marketing dashboard with a date range: `/api/marketing/dashboard?from&to`, as on the web.
class MarketingDashboardScreen extends StatefulWidget {
  const MarketingDashboardScreen({super.key});
  @override
  State<MarketingDashboardScreen> createState() => _MarketingDashboardScreenState();
}

class _MarketingDashboardScreenState extends State<MarketingDashboardScreen> {
  MarketingRange _range = marketingThisMonth();

  @override
  Widget build(BuildContext context) {
    final s = marketingDashSpec;
    return SectionDashScreen(
      key: ValueKey(marketingRangeQs(_range)),
      spec: DashSpec(
        arTitle: s.arTitle, enTitle: s.enTitle,
        endpoint: '${s.endpoint}?${marketingRangeQs(_range)}',
        liveEvent: s.liveEvent,
        stats: s.stats, breakdowns: s.breakdowns, lists: s.lists,
        afterStats: s.afterStats, filters: s.filters, onDrill: s.onDrill, afterStatsDrill: s.afterStatsDrill,
        header: (data) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          AppCard(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            child: MarketingRangePicker(value: _range, onChanged: (r) => setState(() => _range = r)),
          ),
          if (s.header != null) ...[const SizedBox(height: 10), s.header!(data)],
        ]),
      ),
    );
  }
}
