import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/export_sheet.dart';
import 'finance.dart' show fmtFin, finTableCard, finSheet;
import 'insight_kit.dart';

/// Data & Decision Support: one analysis per company section, the phone counterpart of /system/data-support.
/// The payload comes from /api/data-support (backend dataSupportController), which reads each section's own
/// analytics, so the phone shows the same numbers as the web and as the section's own screens.

/// Analyses in sidebar order: server key, Arabic, English, web path, icon.
const dataSupportSections = <(String, String, String, String, IconData)>[
  ('operations', 'تحليل العمليات والشحنات', 'Operations & Shipments Analysis', '/system/data-support/operations', Icons.inventory_2_outlined),
  ('heavy', 'تحليل النقل الثقيل', 'Heavy Transport Analysis', '/system/data-support/heavy-transport', Icons.local_shipping_outlined),
  ('light', 'تحليل النقل الخفيف', 'Light Transport Analysis', '/system/data-support/light-transport', Icons.two_wheeler),
  ('sales', 'تحليل المبيعات والعلاقات', 'Sales & CRM Analysis', '/system/data-support/sales', Icons.track_changes_outlined),
  ('vendors', 'تحليل الموردين', 'Vendors Analysis', '/system/data-support/vendors', Icons.handshake_outlined),
  ('customs', 'تحليل التخليص الجمركي', 'Customs Analysis', '/system/data-support/customs', Icons.directions_boat_outlined),
  ('collections', 'تحليل التحصيل', 'Collections Analysis', '/system/data-support/collections', Icons.request_quote_outlined),
  ('hr', 'تحليل الموارد البشرية', 'HR Analysis', '/system/data-support/hr', Icons.badge_outlined),
  ('finance', 'التحليل المالي', 'Finance Analysis', '/system/data-support/finance', Icons.account_balance_outlined),
];

String _pad(int n) => n.toString().padLeft(2, '0');

/// Preset periods in device time (Riyadh for the users), the same presets as the web period bar.
(String, String) _range(String key) {
  final now = DateTime.now();
  final today = '${now.year}-${_pad(now.month)}-${_pad(now.day)}';
  switch (key) {
    case 'lastMonth':
      final first = DateTime(now.year, now.month - 1, 1);
      final last = DateTime(now.year, now.month, 0);
      return ('${first.year}-${_pad(first.month)}-01', '${last.year}-${_pad(last.month)}-${_pad(last.day)}');
    case 'quarter':
      final first = DateTime(now.year, now.month - 2, 1);
      return ('${first.year}-${_pad(first.month)}-01', today);
    case 'year':
      return ('${now.year}-01-01', today);
    default:
      return ('${now.year}-${_pad(now.month)}-01', today);
  }
}

const _presets = <(String, String, String)>[
  ('month', 'هذا الشهر', 'This month'),
  ('lastMonth', 'الشهر السابق', 'Last month'),
  ('quarter', 'آخر 3 شهور', 'Last 3 months'),
  ('year', 'هذه السنة', 'This year'),
];

Color _tone(String? tone, num value) {
  if (value < 0) return T.danger;
  switch (tone) {
    case 'good': return T.success;
    case 'bad': return T.danger;
    case 'warn': return T.warn;
    default: return T.ink;
  }
}

String _cardValue(Map<String, dynamic> c) {
  final v = fmtFin(c['value'], '${c['format']}');
  return c['format'] == 'money' && c['value'] != null ? '$v ${tr('ر.س', 'SAR')}' : v;
}

class _PeriodChips extends StatelessWidget {
  const _PeriodChips({required this.value, required this.onChanged});
  final String value;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) => SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
        child: Row(children: _presets.map((p) {
          final on = value == p.$1;
          return Padding(
            padding: const EdgeInsetsDirectional.only(end: 6),
            child: ChoiceChip(
              label: Text(tr(p.$2, p.$3), style: TextStyle(fontWeight: FontWeight.w700, color: on ? Colors.white : T.inkSoft)),
              selected: on,
              selectedColor: T.orange,
              onSelected: (_) => onChanged(p.$1),
            ),
          );
        }).toList()),
      );
}

/// Section home: the headline figures of each analysis; a card opens its analysis.
class DataSupportHomeScreen extends StatefulWidget {
  const DataSupportHomeScreen({super.key});
  @override
  State<DataSupportHomeScreen> createState() => _DataSupportHomeScreenState();
}

class _DataSupportHomeScreenState extends State<DataSupportHomeScreen> {
  String _preset = 'month';
  Map<String, dynamic>? _d;
  String? _error;
  bool _loading = true;
  int _seq = 0;
  late final void Function(dynamic) _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = (_) => _load();
    Live.instance.onData('executive:changed', _onLive);
  }

  @override
  void dispose() {
    Live.instance.offData('executive:changed', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    final r = _range(_preset);
    try {
      final d = await Api.instance.get('/api/data-support/overview?from=${r.$1}&to=${r.$2}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = d; _error = null; _loading = false; });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final secs = List<Map<String, dynamic>>.from(_d?['sections'] ?? []);
    return AppScaffold(
      title: Text(tr('إدارة البيانات ودعم القرار', 'Data & Decision Support')),
      body: Column(children: [
        _PeriodChips(value: _preset, onChanged: (v) { setState(() { _preset = v; _loading = true; }); _load(); }),
        Expanded(
          child: _loading && _d == null
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 110), SizedBox(height: 10), Shimmer(height: 110)])
              : _error != null && _d == null
                  ? ErrorRetry(message: _error!, onRetry: _load)
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(14, 8, 14, 24),
                        children: dataSupportSections.map((s) {
                          final row = secs.firstWhere((x) => x['key'] == s.$1, orElse: () => <String, dynamic>{});
                          final cards = List<Map<String, dynamic>>.from(row['cards'] ?? []);
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: InkWell(
                              borderRadius: BorderRadius.circular(16),
                              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => DataSupportScreen(section: s.$1, arTitle: s.$2, enTitle: s.$3))),
                              child: AppCard(
                                padding: const EdgeInsets.all(12),
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    Icon(s.$5, size: 18, color: T.orange),
                                    const SizedBox(width: 6),
                                    Expanded(child: Text(tr(s.$2, s.$3), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14.5))),
                                    Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, color: T.inkFaint),
                                  ]),
                                  if (row['ok'] == false)
                                    Padding(padding: const EdgeInsets.only(top: 6), child: Text(tr('تعذّر تحميل هذا القسم', 'Could not load'), style: const TextStyle(color: T.danger, fontSize: 12))),
                                  const SizedBox(height: 6),
                                  for (final c in cards)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 3),
                                      child: Row(children: [
                                        Expanded(child: Text(tr('${c['ar']}', '${c['en']}'), style: const TextStyle(fontSize: 12, color: T.inkSoft))),
                                        Text(fmtFin(c['value'], '${c['format']}'),
                                            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5, color: _tone(c['tone'] as String?, (c['value'] as num?) ?? 0))),
                                      ]),
                                    ),
                                ]),
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                    ),
        ),
      ]),
    );
  }
}

/// One section analysis: period and branch filters, KPI cards with the change against the previous span, trend
/// columns per series, the ranking tables (search, sort, totals, export) and the data sources.
class DataSupportScreen extends StatefulWidget {
  const DataSupportScreen({super.key, required this.section, required this.arTitle, required this.enTitle});
  final String section;
  final String arTitle;
  final String enTitle;
  @override
  State<DataSupportScreen> createState() => _DataSupportScreenState();
}

class _DataSupportScreenState extends State<DataSupportScreen> {
  String _preset = 'month';
  String _branch = '';
  Map<String, dynamic>? _d;
  String? _error;
  bool _loading = true;
  int _seq = 0;
  late final void Function(dynamic) _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = (_) => _load();
    Live.instance.onData('executive:changed', _onLive);
  }

  @override
  void dispose() {
    Live.instance.offData('executive:changed', _onLive);
    super.dispose();
  }

  Future<void> _load({bool fresh = false}) async {
    final mine = ++_seq;
    final r = _range(_preset);
    final qs = 'from=${r.$1}&to=${r.$2}'
        '${_branch.isNotEmpty ? '&branch=${Uri.encodeQueryComponent(_branch)}' : ''}'
        '${fresh ? '&fresh=1' : ''}';
    try {
      final d = await Api.instance.get('/api/data-support/sections/${widget.section}?$qs');
      if (!mounted || mine != _seq) return;
      setState(() { _d = d; _error = null; _loading = false; });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  String get _fileName {
    final p = _d?['period'] is Map ? _d!['period'] as Map : const {};
    return 'analysis-${widget.section}-${p['from'] ?? ''}-${p['to'] ?? ''}${_branch.isNotEmpty ? '-$_branch' : ''}';
  }

  /// Whole-page export as on the web: a summary sheet, one sheet per chart's data, one per table.
  void _exportAll() {
    final d = _d;
    if (d == null) return;
    final cards = List<Map<String, dynamic>>.from(d['cards'] ?? []);
    final charts = List<Map<String, dynamic>>.from(d['charts'] ?? []);
    final tables = List<Map<String, dynamic>>.from(d['tables'] ?? []);
    String cut(String s) => s.length > 28 ? s.substring(0, 28) : s;
    exportExcel(context, fileName: _fileName, sheets: [
      (
        tr('الملخص', 'Summary'),
        [
          ExportCol('المؤشّر', 'Indicator', (r) => r['label']),
          ExportCol('القيمة', 'Value', (r) => r['value']),
          ExportCol('الفترة السابقة', 'Previous', (r) => r['prev']),
          ExportCol('الوحدة', 'Unit', (r) => r['unit']),
        ],
        [
          for (final c in cards)
            {
              'label': tr('${c['ar']}', '${c['en']}'),
              'value': c['value'],
              'prev': c['prev'] ?? '',
              'unit': c['format'] == 'money' ? tr('ر.س', 'SAR') : c['format'] == 'pct' ? '%' : '',
            },
        ],
      ),
      for (final ch in charts.where((c) => (c['rows'] as List?)?.isNotEmpty == true))
        (
          cut(tr('${ch['ar']}', '${ch['en']}')),
          [
            ExportCol('البند', 'Label', (r) => r['${ch['x'] ?? 'label'}']),
            for (final s in List<Map<String, dynamic>>.from(ch['series'] ?? []))
              ExportCol('${s['ar']}', '${s['en']}', (r) => r['${s['key']}']),
          ],
          List<Map<String, dynamic>>.from(ch['rows'] ?? []),
        ),
      for (final t in tables) finSheet(t),
    ]);
  }

  Future<void> _pickBranch(List<Map<String, dynamic>> options) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          ListTile(title: Text(tr('كل الفروع', 'All branches'), style: const TextStyle(fontWeight: FontWeight.w800)), selected: _branch.isEmpty, onTap: () => Navigator.pop(context, '')),
          for (final o in options)
            ListTile(title: Text('${o['label']}'), selected: _branch == '${o['value']}', onTap: () => Navigator.pop(context, '${o['value']}')),
        ]),
      ),
    );
    if (picked == null || picked == _branch) return;
    setState(() { _branch = picked; _loading = true; });
    _load();
  }

  Widget _chart(Map<String, dynamic> ch) {
    final rows = List<Map<String, dynamic>>.from(ch['rows'] ?? []);
    final series = List<Map<String, dynamic>>.from(ch['series'] ?? []);
    final x = '${ch['x'] ?? 'label'}';
    final labels = rows.map((r) => '${r[x] ?? ''}').toList();
    const colors = [T.orange, T.info, T.inkSoft, T.success];
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: SectionCard(
        title: tr('${ch['ar']}', '${ch['en']}'),
        child: rows.isEmpty
            ? Padding(padding: const EdgeInsets.all(10), child: Text(tr('لا بيانات في هذه الفترة', 'No data in this period'), style: const TextStyle(color: T.inkFaint, fontSize: 12)))
            : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                for (var i = 0; i < series.length; i++) ...[
                  if (series.length > 1)
                    Padding(
                      padding: const EdgeInsets.only(top: 4, bottom: 2),
                      child: Text(tr('${series[i]['ar']}', '${series[i]['en']}'), style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: colors[i % colors.length])),
                    ),
                  ColumnChart(labels: labels, a: rows.map((r) => inum(r['${series[i]['key']}'])).toList(), colorA: colors[i % colors.length], height: 90),
                ],
              ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final cards = List<Map<String, dynamic>>.from(d?['cards'] ?? []);
    final charts = List<Map<String, dynamic>>.from(d?['charts'] ?? []);
    final tables = List<Map<String, dynamic>>.from(d?['tables'] ?? []);
    final notes = List<Map<String, dynamic>>.from(d?['notes'] ?? []);
    final sources = List<Map<String, dynamic>>.from(d?['sources'] ?? []);
    final branchOptions = List<Map<String, dynamic>>.from(d?['branchOptions'] ?? []);
    final hasBranch = d?['hasBranch'] == true;
    final branchLabel = _branch.isEmpty
        ? tr('كل الفروع', 'All branches')
        : '${branchOptions.firstWhere((o) => '${o['value']}' == _branch, orElse: () => {'label': _branch})['label']}';
    return AppScaffold(
      title: Text(tr(widget.arTitle, widget.enTitle)),
      actions: [
        if (d != null)
          IconButton(
            tooltip: tr('تصدير Excel — الصفحة كاملة', 'Export Excel — whole page'),
            icon: const Icon(Icons.file_download_outlined),
            onPressed: _exportAll,
          ),
        IconButton(tooltip: tr('تحديث', 'Refresh'), icon: const Icon(Icons.refresh), onPressed: () => _load(fresh: true)),
      ],
      body: Column(children: [
        _PeriodChips(value: _preset, onChanged: (v) { setState(() { _preset = v; _loading = true; }); _load(); }),
        if (hasBranch)
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 4, 14, 0),
            child: Align(
              alignment: AlignmentDirectional.centerStart,
              child: ActionChip(
                avatar: const Icon(Icons.store_mall_directory_outlined, size: 18),
                label: Text('${tr('الفرع', 'Branch')}: $branchLabel', style: const TextStyle(fontWeight: FontWeight.w700)),
                onPressed: () => _pickBranch(branchOptions),
              ),
            ),
          ),
        Expanded(
          child: _loading && d == null
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 80), SizedBox(height: 10), Shimmer(height: 160)])
              : _error != null && d == null
                  ? ErrorRetry(message: _error!, onRetry: _load)
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(14, 8, 14, 24),
                        children: [
                          if (_loading) const LinearProgressIndicator(minHeight: 2),
                          TileWrap([
                            for (final c in cards)
                              KpiTile(
                                tr('${c['ar']}', '${c['en']}'),
                                _cardValue(c),
                                color: _tone(c['tone'] as String?, (c['value'] as num?) ?? 0),
                                foot: c['prev'] == null ? null : deltaText(c['value'], c['prev'], lowerIsBetter: c['lowerIsBetter'] == true),
                              ),
                          ], columns: 2),
                          if (notes.isNotEmpty) ...[
                            const SizedBox(height: 6),
                            Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(color: T.info.withValues(alpha: 0.07), borderRadius: BorderRadius.circular(12)),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: notes.map((n) => Padding(
                                    padding: const EdgeInsets.only(bottom: 3),
                                    child: Text('• ${tr('${n['ar']}', '${n['en']}')}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                  )).toList()),
                            ),
                          ],
                          const SizedBox(height: 10),
                          ...charts.map(_chart),
                          ...tables.map((t) => Padding(
                                padding: const EdgeInsets.only(bottom: 10),
                                child: finTableCard(key: ValueKey('${widget.section}-${t['key']}'), table: t, fileName: _fileName),
                              )),
                          if (sources.isNotEmpty)
                            Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(color: T.line.withValues(alpha: 0.25), borderRadius: BorderRadius.circular(12)),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(tr('مصادر الأرقام', 'Data sources'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12, color: T.inkSoft)),
                                for (final s in sources)
                                  Text('${tr('${s['ar']}', '${s['en']}')} — ${s['endpoint']}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                              ]),
                            ),
                        ],
                      ),
                    ),
        ),
      ]),
    );
  }
}
