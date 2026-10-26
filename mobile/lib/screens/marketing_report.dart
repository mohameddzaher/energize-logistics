import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/export_sheet.dart';
import 'marketing_dashboard.dart' show MarketingRange, MarketingRangePicker, marketingThisMonth, marketingRangeQs;
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/stat_grid.dart';
import '../ui/widgets.dart';

/// التقرير الدوري للتسويق — تجميع الأنشطة يوميًا/أسبوعيًا/شهريًا مع الملخص.
/// /api/marketing/report?period=daily|weekly|monthly
class MarketingReportScreen extends StatefulWidget {
  const MarketingReportScreen({super.key});
  @override
  State<MarketingReportScreen> createState() => _MarketingReportScreenState();
}

String _n(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

class _MarketingReportScreenState extends State<MarketingReportScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _summary = {};
  bool _loading = true;
  String? _error;
  String _period = 'weekly';
  // المدى كالويب: من أوّل الشهر حتى اليوم افتراضًا.
  MarketingRange _range = marketingThisMonth();
  int _seq = 0;

  // حيٌّ على `marketing:updated` — نشاطٌ يُضاف يظهر في التقرير في اللحظة.
  @override
  void initState() { super.initState(); _load(); Live.instance.on('marketing:updated', _load); }

  @override
  void dispose() { Live.instance.off('marketing:updated', _load); super.dispose(); }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/marketing/report?period=$_period&${marketingRangeQs(_range)}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['rows'] ?? []);
        _summary = d['summary'] is Map ? Map<String, dynamic>.from(d['summary']) : {};
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Widget _metric(String ar, String en, dynamic v, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(tr(ar, en), style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
          const SizedBox(height: 2),
          FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
              child: Text(_n(v), style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: color))),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('التقرير الدوري', 'Periodic Report')),
      actions: [
        ExportButton(
          fileName: 'marketing-report-$_period',
          sheetName: tr('التقرير', 'Report'),
          rows: () => _rows,
          columns: [
            ExportCol('الفترة', 'Period', (r) => r['label'] ?? ''),
            ExportCol('الأنشطة', 'Activities', (r) => r['activities'] ?? 0),
            ExportCol('مرات الظهور', 'Impressions', (r) => r['impressions'] ?? 0),
            ExportCol('الوصول', 'Reach', (r) => r['reach'] ?? 0),
            ExportCol('النقرات', 'Clicks', (r) => r['clicks'] ?? 0),
            ExportCol('التفاعلات', 'Engagements', (r) => r['engagements'] ?? 0),
            ExportCol('العملاء المحتملون', 'Leads', (r) => r['leads'] ?? 0),
            ExportCol('التحويلات', 'Conversions', (r) => r['conversions'] ?? 0),
            ExportCol('الإنفاق', 'Spend', (r) => r['spend'] ?? 0),
          ],
        ),
      ],
      appBarBottom: PreferredSize(
        preferredSize: const Size.fromHeight(48),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
          child: Row(children: [
            for (final p in [('daily', 'يومي', 'Daily'), ('weekly', 'أسبوعي', 'Weekly'), ('monthly', 'شهري', 'Monthly')])
              Padding(
                padding: const EdgeInsetsDirectional.only(end: 6),
                // حبّةٌ مرسومة يدويًّا: ثيمُ ChoiceChip يفرض خلفيةً بيضاء على غير
                // المحدَّدة فيختفي نصُّها الأبيض على شريط العنوان الداكن.
                child: Pressable(
                  onTap: () { setState(() { _period = p.$1; _loading = true; }); _load(); },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    decoration: BoxDecoration(
                      color: _period == p.$1 ? T.orange : Colors.white.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(tr(p.$2, p.$3), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _period == p.$1 ? Colors.white : Colors.white70)),
                  ),
                ),
              ),
          ]),
        ),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 90)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    AppCard(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      child: MarketingRangePicker(value: _range, onChanged: (r) { setState(() { _range = r; _loading = true; }); _load(); }),
                    ),
                    const SizedBox(height: 10),
                    AppCard(
                      topAccent: T.violet,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(tr('الإجمالي', 'Summary'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                        const SizedBox(height: 10),
                        StatGrid(
                          spacing: 8, minTileWidth: 90, minColumns: 3, maxColumns: 9,
                          children: [
                            _metric('أنشطة', 'Activities', _summary['activities'], T.navy),
                            _metric('ظهور', 'Impressions', _summary['impressions'], T.info),
                            _metric('نقرات', 'Clicks', _summary['clicks'], T.violet),
                            _metric('وصول', 'Reach', _summary['reach'], T.cyan),
                            _metric('تفاعل', 'Engagements', _summary['engagements'], T.warn),
                            _metric('عملاء', 'Leads', _summary['leads'], T.success),
                            _metric('تحويلات', 'Conversions', _summary['conversions'], T.navy),
                            _metric('إنفاق', 'Spend', _summary['spend'], T.orange),
                            _metric('فترات', 'Periods', _summary['buckets'], T.inkSoft),
                          ],
                        ),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    if (_rows.isEmpty) EmptyState(icon: Icons.bar_chart_outlined, title: tr('لا توجد بيانات', 'No data')),
                    ..._rows.reversed.map((r) => Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: AppCard(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [
                                Expanded(child: Text((r['label'] ?? r['bucket'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13))),
                                Chip2('${r['activities'] ?? 0} ${tr('نشاط', 'act')}', T.navy),
                              ]),
                              const SizedBox(height: 6),
                              Wrap(spacing: 6, runSpacing: 6, children: [
                                if ((r['impressions'] ?? 0) != 0) Chip2('${tr('ظهور', 'Impr')}: ${_n(r['impressions'])}', T.info),
                                if ((r['clicks'] ?? 0) != 0) Chip2('${tr('نقرات', 'Clicks')}: ${_n(r['clicks'])}', T.violet),
                                if ((r['leads'] ?? 0) != 0) Chip2('${tr('عملاء', 'Leads')}: ${_n(r['leads'])}', T.success),
                                if ((r['reach'] ?? 0) != 0) Chip2('${tr('وصول', 'Reach')}: ${_n(r['reach'])}', T.cyan),
                              ]),
                            ]),
                          ),
                        )),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }
}
