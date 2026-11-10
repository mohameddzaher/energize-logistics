import 'dart:async';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/export_sheet.dart';
import '../ui/file_upload.dart';
import '../ui/clearance_quick_view.dart';
import 'hr_finance.dart' show FinanceResidencyScreen;
import '../ui/search_field.dart';

/// Finance management: each section's money in one place, from the same payload the web pages show (/api/finance), so no number differs between phone and web. Listens to `finance:changed`: any financial movement in any section triggers a re-read.

const financeDepts = <(String, String, String, IconData)>[
  ('operations', 'ماليات التشغيل', 'Operations finance', Icons.assignment_outlined),
  ('fleet', 'ماليات إدارة الأسطول', 'Fleet finance', Icons.local_shipping_outlined),
  ('customs', 'ماليات التخليص الجمركي', 'Customs finance', Icons.directions_boat_outlined),
  ('light', 'ماليات النقل الخفيف', 'Light transport finance', Icons.two_wheeler),
  ('marketing', 'ماليات التسويق والتطوير', 'Marketing & BD finance', Icons.campaign_outlined),
  ('hr', 'ماليات الموارد البشرية', 'HR finance', Icons.badge_outlined),
  ('it', 'ماليات تقنية المعلومات', 'IT finance', Icons.computer_outlined),
  ('collections', 'ماليات التحصيل', 'Collections finance', Icons.request_quote_outlined),
  ('vehicles', 'ماليات المركبات', 'Vehicles finance', Icons.directions_car_outlined),
];

String _pad(int n) => n.toString().padLeft(2, '0');

/// Preset periods, in device time, which is Riyadh time for the users.
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

String fmtFin(dynamic v, String format) {
  if (v == null || v == '') return '—';
  if (format == 'money' || format == 'number') {
    final n = num.tryParse('$v');
    if (n == null) return '$v';
    final fixed = format == 'money' ? (n * 100).round() / 100 : n;
    final parts = fixed.toString().split('.');
    final intPart = parts[0].replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');
    final dec = parts.length > 1 && parts[1] != '0' ? '.${parts[1].padRight(2, '0').substring(0, 2)}' : '';
    return '$intPart$dec';
  }
  if (format == 'pct') {
    final n = num.tryParse('$v') ?? 0;
    return '${(n * 10).round() / 10}%';
  }
  if (format == 'date') {
    final s = '$v';
    return s.length >= 10 ? s.substring(0, 10) : s;
  }
  return '$v';
}

Color _tone(String? tone, num value) {
  if (value < 0) return T.danger;
  switch (tone) {
    case 'good': return T.success;
    case 'bad': return T.danger;
    case 'warn': return T.warn;
    default: return T.ink;
  }
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

// ═══════════════════════════════════════════════════════════════════════════
class FinanceOverviewScreen extends StatefulWidget {
  const FinanceOverviewScreen({super.key});
  @override
  State<FinanceOverviewScreen> createState() => _FinanceOverviewScreenState();
}

class _FinanceOverviewScreenState extends State<FinanceOverviewScreen> {
  String _preset = 'month';
  Map<String, dynamic>? _d;
  String? _error;
  bool _loading = true;
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('finance:changed', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('finance:changed', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    final r = _range(_preset);
    try {
      final d = await Api.instance.get('/api/finance/overview?from=${r.$1}&to=${r.$2}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = d; _error = null; _loading = false; });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final deps = List<Map<String, dynamic>>.from(_d?['departments'] ?? []);
    return AppScaffold(
      title: Text(tr('الإدارة المالية', 'Finance Management')),
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
                        children: financeDepts.map((dep) {
                          final row = deps.firstWhere((x) => x['key'] == dep.$1, orElse: () => <String, dynamic>{});
                          final cards = List<Map<String, dynamic>>.from(row['cards'] ?? []);
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: InkWell(
                              borderRadius: BorderRadius.circular(16),
                              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => FinanceDeptScreen(dept: dep.$1, arTitle: dep.$2, enTitle: dep.$3))),
                              child: AppCard(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    Icon(dep.$4, size: 19, color: T.orange),
                                    const SizedBox(width: 8),
                                    Expanded(child: Text(tr(dep.$2, dep.$3), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5))),
                                    const Icon(Icons.chevron_left_rounded, color: T.inkFaint),
                                  ]),
                                  const SizedBox(height: 8),
                                  ...cards.map((c) => Padding(
                                        padding: const EdgeInsets.only(top: 3),
                                        child: Row(children: [
                                          Expanded(child: Text(tr('${c['ar']}', '${c['en']}'), style: const TextStyle(fontSize: 12, color: T.inkSoft))),
                                          Text(fmtFin(c['value'], '${c['format']}'),
                                              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: _tone(c['tone'] as String?, (c['value'] as num?) ?? 0))),
                                        ]),
                                      )),
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

// ═══════════════════════════════════════════════════════════════════════════
class FinanceDeptScreen extends StatefulWidget {
  const FinanceDeptScreen({super.key, required this.dept, required this.arTitle, required this.enTitle});
  final String dept;
  final String arTitle;
  final String enTitle;
  @override
  State<FinanceDeptScreen> createState() => _FinanceDeptScreenState();
}

class _FinanceDeptScreenState extends State<FinanceDeptScreen> {
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
    // The event names its sections; a section it does not concern does not re-read.
    _onLive = (p) {
      final depts = p is Map ? p['depts'] : null;
      if (depts is List && !depts.contains(widget.dept)) return;
      _load();
    };
    Live.instance.onData('finance:changed', _onLive);
  }

  @override
  void dispose() {
    Live.instance.offData('finance:changed', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    final r = _range(_preset);
    try {
      final d = await Api.instance.get('/api/finance/departments/${widget.dept}?from=${r.$1}&to=${r.$2}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = d; _error = null; _loading = false; });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  String get _fileName {
    final p = _d?['period'] is Map ? _d!['period'] as Map : const {};
    return 'finance-${widget.dept}-${p['from'] ?? ''}-${p['to'] ?? ''}';
  }

  /// Full export as on the web: a summary sheet, then a sheet per table.
  void _exportAll() {
    final d = _d;
    if (d == null) return;
    final cards = List<Map<String, dynamic>>.from(d['cards'] ?? []);
    final tables = List<Map<String, dynamic>>.from(d['tables'] ?? []);
    exportExcel(context, fileName: _fileName, sheets: [
      (
        tr('الملخص', 'Summary'),
        [
          ExportCol('البند', 'Item', (r) => r['label']),
          ExportCol('القيمة', 'Value', (r) => r['value']),
        ],
        [
          for (final c in cards)
            {
              'label': tr('${c['ar']}', '${c['en']}'),
              'value': c['format'] == 'pct' ? '${(((c['value'] as num?) ?? 0) * 10).round() / 10}%' : c['value'],
            },
        ],
      ),
      for (final t in tables) _finSheet(t),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final cards = List<Map<String, dynamic>>.from(_d?['cards'] ?? []);
    final tables = List<Map<String, dynamic>>.from(_d?['tables'] ?? []);
    final notes = List<Map<String, dynamic>>.from(_d?['notes'] ?? []);
    return AppScaffold(
      title: Text(tr(widget.arTitle, widget.enTitle)),
      actions: [
        if (_d != null)
          IconButton(
            tooltip: tr('تصدير Excel — الصفحة كاملة (${tables.length + 1} شيت)', 'Export Excel — whole page (${tables.length + 1} sheets)'),
            icon: const Icon(Icons.file_download_outlined),
            onPressed: _exportAll,
          ),
      ],
      body: Column(children: [
        _PeriodChips(value: _preset, onChanged: (v) { setState(() { _preset = v; _loading = true; }); _load(); }),
        Expanded(
          child: _loading && _d == null
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 80), SizedBox(height: 10), Shimmer(height: 160)])
              : _error != null && _d == null
                  ? ErrorRetry(message: _error!, onRetry: _load)
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(14, 8, 14, 24),
                        children: [
                          // Entry for residencies and work permits, above the HR finance, as on the web.
                          if (widget.dept == 'hr') ...[
                            const _HrDocsBanner(),
                            const SizedBox(height: 12),
                          ],
                          // Customs: disbursement requests, then billing requests, then customer invoices, in the order of the web page (finance/customs/page.tsx).
                          if (widget.dept == 'customs') ...[
                            const _CustomsPaymentRequests(),
                            const SizedBox(height: 12),
                            const _CustomsInvoiceRequests(),
                            const SizedBox(height: 12),
                            const _CustomsCustomerInvoices(),
                            const SizedBox(height: 12),
                          ],
                          Wrap(spacing: 8, runSpacing: 8, children: cards.map((c) {
                            final w = (MediaQuery.of(context).size.width - 28 - 8) / 2;
                            return SizedBox(
                              width: w,
                              child: AppCard(
                                padding: const EdgeInsets.all(11),
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text(tr('${c['ar']}', '${c['en']}'), maxLines: 2, style: const TextStyle(fontSize: 11, color: T.inkSoft, fontWeight: FontWeight.w600)),
                                  const SizedBox(height: 4),
                                  Text(fmtFin(c['value'], '${c['format']}'),
                                      style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: _tone(c['tone'] as String?, (c['value'] as num?) ?? 0))),
                                ]),
                              ),
                            );
                          }).toList()),
                          if (notes.isNotEmpty) ...[
                            const SizedBox(height: 10),
                            Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(color: T.info.withValues(alpha: 0.07), borderRadius: BorderRadius.circular(12)),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: notes.map((n) => Padding(
                                    padding: const EdgeInsets.only(bottom: 3),
                                    child: Text('• ${tr('${n['ar']}', '${n['en']}')}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                  )).toList()),
                            ),
                          ],
                          const SizedBox(height: 12),
                          ...tables.map((t) => Padding(
                                padding: const EdgeInsets.only(bottom: 10),
                                child: _FinTableCard(
                                  key: ValueKey('${widget.dept}-${t['key']}'),
                                  table: t,
                                  fileName: _fileName,
                                  // A customs transaction row opens its dialog here, like onOpenRow on the web.
                                  onOpenRow: widget.dept == 'customs'
                                      ? (r) { if ('${r['_customsId'] ?? ''}'.isNotEmpty) showClearanceQuickView(context, '${r['_customsId']}'); }
                                      : null,
                                ),
                              )),
                        ],
                      ),
                    ),
        ),
      ]),
    );
  }
}

/// Export sheet for a financial table: columns with their headings, the date as text, and percentage with one decimal place.
(String, List<ExportCol>, List<Map<String, dynamic>>) _finSheet(Map<String, dynamic> t, [List<Map<String, dynamic>>? rows]) {
  final cols = List<Map<String, dynamic>>.from(t['columns'] ?? []);
  final name = tr('${t['ar']}', '${t['en']}');
  return (
    name.length > 28 ? name.substring(0, 28) : name,
    [
      for (final c in cols)
        ExportCol('${c['ar']}', '${c['en']}', (r) {
          final v = r[c['key']];
          switch (c['format']) {
            case 'date': return fmtFin(v, 'date');
            case 'pct': return v == null ? '' : ((num.tryParse('$v') ?? 0) * 10).round() / 10;
            case 'money':
            case 'number': return v is num ? v : (num.tryParse('${v ?? ''}') ?? v ?? '');
            default: return v ?? '';
          }
        }),
    ],
    rows ?? List<Map<String, dynamic>>.from(t['rows'] ?? []),
  );
}

String _foldFin(dynamic v) => '${v ?? ''}'
    .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll(RegExp('[ةه]'), 'ه').replaceAll(RegExp('[ىي]'), 'ي').toLowerCase();

/// Phone table, counterpart of FinanceTable: search, sort by column, totals of money and count columns for what is displayed, rows shown 100 at a time ("show more") with no cap, and export of the table alone: what is displayed after search, or all.
class _FinTableCard extends StatefulWidget {
  const _FinTableCard({super.key, required this.table, required this.fileName, this.onOpenRow});
  final Map<String, dynamic> table;
  final String fileName;
  final void Function(Map<String, dynamic>)? onOpenRow;
  @override
  State<_FinTableCard> createState() => _FinTableCardState();
}

class _FinTableCardState extends State<_FinTableCard> {
  static const _page = 100;
  String _q = '';
  // The table collapses and its field is destroyed; text kept in a controller survives with the word.
  final _searchCtl = TextEditingController();
  int _limit = _page;
  String? _sortKey;
  int _dir = 1;

  @override
  void dispose() {
    _searchCtl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.table;
    final cols = List<Map<String, dynamic>>.from(t['columns'] ?? []);
    final all = List<Map<String, dynamic>>.from(t['rows'] ?? []);
    final n = _foldFin(_q.trim());
    var shown = n.isEmpty ? all : all.where((r) => cols.any((c) => _foldFin(r[c['key']]).contains(n))).toList();
    if (_sortKey != null) {
      final col = cols.firstWhere((c) => c['key'] == _sortKey, orElse: () => const {});
      final numeric = ['money', 'number', 'pct'].contains(col['format']);
      shown = [...shown]..sort((a, b) {
          final x = a[_sortKey]; final y = b[_sortKey];
          if (numeric) return ((num.tryParse('$x') ?? 0).compareTo(num.tryParse('$y') ?? 0)) * _dir;
          return '${x ?? ''}'.compareTo('${y ?? ''}') * _dir;
        });
    }
    final totalCols = cols.where((c) => c['format'] == 'money' || c['format'] == 'number').toList();
    num sumOf(String k) => shown.fold<num>(0, (a, r) => a + (num.tryParse('${r[k] ?? ''}') ?? 0));
    final tableName = tr('${t['ar']}', '${t['en']}');
    final fname = '${widget.fileName}-${t['key']}';

    return AppCard(
      padding: EdgeInsets.zero,
      child: ExpansionTile(
        shape: const Border(),
        title: Text(tableName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
        subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(
            [
              '${shown.length}${shown.length != all.length ? ' / ${all.length}' : ''} ${tr('صف', 'rows')}',
              if (totalCols.isNotEmpty) '${tr('${totalCols.first['ar']}', '${totalCols.first['en']}')}: ${fmtFin(sumOf('${totalCols.first['key']}'), '${totalCols.first['format']}')}',
            ].join(' · '),
            style: const TextStyle(fontSize: 11.5, color: T.inkSoft),
          ),
          if (Lang.instance.ar && '${t['noteAr'] ?? ''}'.isNotEmpty)
            Text('${t['noteAr']}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          if (t['capped'] == true)
            Text(tr('تُعرض أحدث 2000 حركة — ضيّق الفترة لرؤية الباقي.', 'Showing the latest 2,000 — narrow the period.'),
                style: const TextStyle(fontSize: 11, color: T.warn)),
        ]),
        childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        children: [
          Row(children: [
            Expanded(
              child: SearchField(
                controller: _searchCtl, dense: true,
                onChanged: (v) => setState(() { _q = v; _limit = _page; }),
                hint: tr('بحث…', 'Search…'),
              ),
            ),
            PopupMenuButton<String>(
              tooltip: tr('فرز', 'Sort'),
              icon: Icon(Icons.sort, color: _sortKey != null ? T.orange : T.inkSoft),
              onSelected: (k) => setState(() {
                if (k == '') { _sortKey = null; return; }
                if (_sortKey == k) { _dir = -_dir; } else {
                  _sortKey = k;
                  final c = cols.firstWhere((c) => c['key'] == k);
                  _dir = ['money', 'number', 'pct'].contains(c['format']) ? -1 : 1;
                }
              }),
              itemBuilder: (_) => [
                if (_sortKey != null) PopupMenuItem(value: '', child: Text(tr('بلا فرز', 'No sort'))),
                for (final c in cols)
                  PopupMenuItem(value: '${c['key']}', child: Text('${tr('${c['ar']}', '${c['en']}')}${_sortKey == c['key'] ? (_dir > 0 ? ' ↑' : ' ↓') : ''}')),
              ],
            ),
            PopupMenuButton<String>(
              tooltip: tr('تصدير Excel', 'Export Excel'),
              icon: const Icon(Icons.file_download_outlined, color: T.navy),
              onSelected: (k) => exportExcel(context, fileName: fname, sheets: [_finSheet(t, k == 'all' ? all : shown)]),
              itemBuilder: (_) => [
                PopupMenuItem(value: 'shown', child: Text(tr('المعروض (${shown.length})', 'Shown (${shown.length})'))),
                if (shown.length != all.length) PopupMenuItem(value: 'all', child: Text(tr('الكل (${all.length})', 'All (${all.length})'))),
              ],
            ),
          ]),
          if (shown.isEmpty)
            Padding(padding: const EdgeInsets.only(top: 10), child: Text(tr('لا بيانات في هذه الفترة', 'No data in this period'), style: const TextStyle(color: T.inkFaint))),
          ...shown.take(_limit).map((r) {
            final opens = r['_open'] == true && widget.onOpenRow != null;
            return InkWell(
              onTap: opens ? () => widget.onOpenRow!(r) : null,
              child: Container(
                margin: const EdgeInsets.only(top: 8),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10),
                    border: opens ? Border.all(color: T.orange.withValues(alpha: 0.3)) : null),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(fmtFin(r[cols.first['key']], '${cols.first['format']}'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13))),
                    if (opens) const Icon(Icons.open_in_new, size: 14, color: T.orange),
                  ]),
                  ...cols.skip(1).map((c) => Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Row(children: [
                          Expanded(child: Text(tr('${c['ar']}', '${c['en']}'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
                          Flexible(
                            child: Text(fmtFin(r[c['key']], '${c['format']}'), textAlign: TextAlign.end,
                                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700,
                                    color: (num.tryParse('${r[c['key']]}') ?? 0) < 0 && c['format'] != 'text' ? T.danger : T.ink)),
                          ),
                        ]),
                      )),
                ]),
              ),
            );
          }),
          if (shown.length > _limit)
            TextButton(
              onPressed: () => setState(() => _limit += _page * 3),
              child: Text(tr('عرض المزيد (${shown.length - _limit} متبقي)', 'Show more (${shown.length - _limit} left)')),
            ),
          // Footer total for money and count columns, for what is displayed after search.
          if (shown.isNotEmpty && totalCols.isNotEmpty)
            Container(
              margin: const EdgeInsets.only(top: 8),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: T.navy.withValues(alpha: 0.07), borderRadius: BorderRadius.circular(10)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(tr('الإجمالي', 'Total'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13)),
                for (final c in totalCols)
                  Row(children: [
                    Expanded(child: Text(tr('${c['ar']}', '${c['en']}'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
                    Text(fmtFin(sumOf('${c['key']}'), '${c['format']}'),
                        style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w900, color: sumOf('${c['key']}') < 0 ? T.danger : T.ink)),
                  ]),
              ]),
            ),
        ],
      ),
    );
  }
}

/// Entry for residencies and work permits above the HR finance; its numbers are live (`hr-finance:changed`).
class _HrDocsBanner extends StatefulWidget {
  const _HrDocsBanner();
  @override
  State<_HrDocsBanner> createState() => _HrDocsBannerState();
}

class _HrDocsBannerState extends State<_HrDocsBanner> {
  Map<String, dynamic>? _s;
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('hr-finance:changed', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('hr-finance:changed', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/finance/hr-docs/summary');
      if (!mounted || mine != _seq) return;
      setState(() => _s = Map<String, dynamic>.from(d as Map));
    } catch (_) {/* The card stays without numbers. */}
  }

  @override
  Widget build(BuildContext context) {
    final s = _s;
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const FinanceResidencyScreen())),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: T.orange.withValues(alpha: 0.4))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Container(
              width: 38, height: 38,
              decoration: BoxDecoration(color: T.orange.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(10)),
              child: const Icon(Icons.badge_outlined, color: T.orange, size: 20),
            ),
            const SizedBox(width: 10),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('الإقامات ورخص العمل', 'Iqamas & work permits'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              Text(tr('رسوم التجديد المنتهية وما بقي عليه 20 يومًا فأقل — وطلبات الموارد البشرية إلى المالية',
                      'Renewal fees expired or due within 20 days — and HR requests to Finance'),
                  style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
            ])),
            const Icon(Icons.chevron_left_rounded, color: T.inkFaint),
          ]),
          if (s != null) ...[
            const SizedBox(height: 8),
            Wrap(spacing: 6, runSpacing: 6, children: [
              Chip2('${tr('غير مدفوع', 'Unpaid')} ${s['unpaid'] ?? 0}', T.ink),
              Chip2('${tr('منها منتهية', 'Of which expired')} ${s['unpaidExpired'] ?? 0}', T.danger),
              Chip2('${tr('طلبات قيد الانتظار', 'Pending requests')} ${s['pendingRequests'] ?? 0}', T.orange),
            ]),
          ],
        ]),
      ),
    );
  }
}

/// Customs disbursement requests, counterpart of CustomsPaymentRequests: five lists, server-side search, the transferred log, pages of fifty, and proof of payment with one or more files.
String _fmtAmt(dynamic v) {
  if (v == null) return '—';
  final n = v is num ? v : num.tryParse('$v') ?? 0;
  final fixed = (n * 100).round() / 100;
  final parts = fixed.toString().split('.');
  final i = parts[0].replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
  return parts.length > 1 && parts[1] != '0' ? '$i.${parts[1]}' : i;
}

String _dmy(dynamic d) {
  final s = '${d ?? ''}';
  if (s.isEmpty) return '—';
  final x = DateTime.tryParse(s);
  if (x == null) return s;
  final l = x.toLocal();
  return '${l.day.toString().padLeft(2, '0')}/${l.month.toString().padLeft(2, '0')}/${l.year}';
}

void _openUrl(String u) =>
    launchUrl(Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u'), mode: LaunchMode.externalApplication);

const _payBadge = <String, (String, String, Color)>{
  'pending': ('بانتظار الدفع', 'Awaiting', T.warn),
  'paid': ('مدفوعة', 'Paid', T.success),
  'returned': ('مُعادة', 'Returned', T.info),
  'rejected': ('مرفوضة', 'Rejected', T.danger),
};

class _CustomsPaymentRequests extends StatefulWidget {
  const _CustomsPaymentRequests();
  @override
  State<_CustomsPaymentRequests> createState() => _CustomsPaymentRequestsState();
}

class _CustomsPaymentRequestsState extends State<_CustomsPaymentRequests> {
  List<Map<String, dynamic>> _rows = const [];
  Map<String, dynamic> _counts = const {};
  bool _loading = true;
  String _tab = 'pending';
  String _search = '';
  final _searchCtl = TextEditingController();
  bool _legacy = false;
  int _page = 1;
  int _pages = 1;
  int _total = 0;
  int _seq = 0;
  Timer? _debounce;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    // A colleague's decision or a new request from customs appears here instantly.
    _onLive = () => _load();
    Live.instance.on('customs:updated', _onLive);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    Live.instance.off('customs:updated', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final qs = [
        'status=$_tab', 'page=$_page', 'limit=50',
        if (_search.isNotEmpty) 'search=${Uri.encodeComponent(_search)}',
        if (_legacy) 'legacy=1',
      ].join('&');
      final d = await Api.instance.get('/api/customs-clearance/payment-requests?$qs');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['requests'] ?? const []);
        _counts = Map<String, dynamic>.from(d['counts'] ?? const {});
        _total = ((d['total'] as num?) ?? 0).toInt();
        _pages = ((d['pages'] as num?) ?? 1).toInt();
        _loading = false;
      });
    } catch (_) {
      if (mounted && mine == _seq) setState(() => _loading = false);
    }
  }

  void _pickTab(String k) { setState(() { _tab = k; _page = 1; _loading = true; }); _load(); }

  Future<void> _decide(Map<String, dynamic> r, String decision) async {
    final noteCtrl = TextEditingController();
    final files = <PickedFile>[];
    final go = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setSheet) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(
              decision == 'paid' ? tr('تأكيد الدفع', 'Confirm payment')
                  : decision == 'returned' ? tr('إرجاع الطلب', 'Return the request')
                      : tr('رفض الطلب', 'Reject the request'),
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 4),
            Text('${r['refNumber'] ?? ''} · ${r['label'] ?? r['key'] ?? ''} · ${_fmtAmt(r['amount'])}',
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            const SizedBox(height: 12),
            TextField(
              controller: noteCtrl,
              maxLines: 2,
              decoration: InputDecoration(
                labelText: tr('ملاحظة (اختياري)', 'Note (optional)'),
                hintText: decision == 'returned' ? tr('ما الذي يُصحَّح؟ «السعر مرتفع»…', 'What should be corrected?') : tr('سببٌ إن كان له سبب…', 'A reason, if there is one…'),
              ),
            ),
            if (decision == 'paid') ...[
              const SizedBox(height: 10),
              Text(tr('إثبات الدفع (اختياري · ملف أو أكثر)', 'Payment proof (optional · one or more)'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final f in files) Chip(label: Text(f.fileName, style: const TextStyle(fontSize: 12)), onDeleted: () => setSheet(() => files.remove(f))),
                ActionChip(
                  avatar: const Icon(Icons.attach_file, size: 16),
                  label: Text(tr('إرفاق ملفات', 'Attach files')),
                  onPressed: () async {
                    final got = await pickFilesAsDataUrls();
                    // 20 MB per file as on the web; larger ones are reported and not sent.
                    final ok = got.where((f) => f.sizeBytes <= 20 * 1024 * 1024).toList();
                    if (ok.length < got.length && c.mounted) {
                      ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(tr('ملفٌّ أكبر من 20 ميجابايت لم يُرفق', 'A file over 20MB was skipped'))));
                    }
                    setSheet(() => files.addAll(ok));
                  },
                ),
              ]),
            ],
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                style: FilledButton.styleFrom(backgroundColor: decision == 'paid' ? T.success : decision == 'returned' ? T.info : T.danger),
                onPressed: () => Navigator.pop(c, true),
                child: Text(tr('تأكيد', 'Confirm')),
              ),
            ),
          ]),
        ),
      )),
    );
    if (go != true) return;
    try {
      await Api.instance.patch(
        '/api/customs-clearance/${r['clearanceId']}/payment-stages/${r['entryId']}/decision',
        {
          'decision': decision,
          'note': noteCtrl.text.trim(),
          'files': [for (final f in files) {'dataUrl': f.dataUrl, 'fileName': f.fileName}],
        },
      );
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم تسجيل القرار', 'Decision recorded'))));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final legacyN = ((_counts['legacy'] as num?) ?? 0).toInt();
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(tr('طلبات صرف التخليص', 'Customs payment requests'),
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
          Chip2('${_counts['pending'] ?? 0}', T.warn),
        ]),
        const SizedBox(height: 2),
        Text(tr('ما طلب قسمُ التخليص دفعَه — اضغط رقم المعاملة لتفاصيلها', 'What customs asked to be paid — tap a transaction for details'),
            style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        const SizedBox(height: 10),
        Row(children: [
          for (final x in [
            (tr('بانتظار الدفع', 'Awaiting'), '${_counts['pending'] ?? 0}', T.warn, 'pending'),
            (tr('مبالغ منتظِرة', 'Awaiting SAR'), _fmtAmt(_counts['amountPending'] ?? 0), T.warn, 'pending'),
            (tr('مدفوعة', 'Paid'), '${_counts['paid'] ?? 0}', T.success, 'paid'),
            (tr('مبالغ مدفوعة', 'Paid SAR'), _fmtAmt(_counts['amountPaid'] ?? 0), T.success, 'paid'),
          ])
            Expanded(
              child: InkWell(
                onTap: () => _pickTab(x.$4),
                child: Container(
                  margin: const EdgeInsets.symmetric(horizontal: 2),
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 8),
                  decoration: BoxDecoration(color: x.$3.withValues(alpha: 0.07), borderRadius: BorderRadius.circular(10)),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(x.$1, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 9.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
                        child: Text(x.$2, style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: x.$3))),
                  ]),
                ),
              ),
            ),
        ]),
        const SizedBox(height: 8),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(children: [
            for (final t in const [('pending', 'بانتظار الدفع', 'Awaiting'), ('paid', 'مدفوعة', 'Paid'), ('returned', 'مُعادة', 'Returned'), ('rejected', 'مرفوضة', 'Rejected'), ('all', 'الكل', 'All')])
              Padding(
                padding: const EdgeInsetsDirectional.only(end: 6),
                child: FilterChip(
                  selected: _tab == t.$1,
                  showCheckmark: false,
                  onSelected: (_) => _pickTab(t.$1),
                  label: Text('${tr(t.$2, t.$3)}${t.$1 != 'all' && _counts[t.$1] != null ? ' ${_counts[t.$1]}' : ''}'),
                  labelStyle: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: _tab == t.$1 ? Colors.white : T.inkSoft),
                  selectedColor: T.navy,
                  side: BorderSide.none,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                ),
              ),
          ]),
        ),
        const SizedBox(height: 6),
        SearchField(
          controller: _searchCtl, dense: true,
          onChanged: (v) {
            _debounce?.cancel();
            _debounce = Timer(const Duration(milliseconds: 300), () { if (!mounted) return; setState(() { _search = v.trim(); _page = 1; }); _load(); });
          },
          hint: tr('رقم معاملة، عميل، بند…', 'Transaction, customer, item…'),
        ),
        // "Done" marks carried over from the master sheet; they are not Finance decisions.
        if (legacyN > 0)
          CheckboxListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _legacy,
            onChanged: (v) { setState(() { _legacy = v == true; _page = 1; _loading = true; }); _load(); },
            title: Text(tr('السجلّ المنقول ($legacyN)', 'Imported history ($legacyN)'), style: const TextStyle(fontSize: 12)),
          ),
        if (_loading && _rows.isEmpty)
          const Padding(padding: EdgeInsets.all(14), child: Center(child: CircularProgressIndicator(strokeWidth: 2)))
        else if (_rows.isEmpty)
          Padding(padding: const EdgeInsets.all(14), child: Center(child: Text(
              _tab == 'pending' ? tr('لا طلبات بانتظار الدفع.', 'Nothing awaiting payment.') : tr('لا طلبات في هذه القائمة.', 'Nothing here.'),
              style: const TextStyle(fontSize: 12, color: T.inkFaint))))
        else
          ..._rows.map(_row),
        if (_pages > 1)
          Row(children: [
            Text(tr('$_total طلب', '$_total requests'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
            const Spacer(),
            IconButton(
              icon: Icon(Lang.instance.ar ? Icons.chevron_right : Icons.chevron_left),
              onPressed: _page <= 1 ? null : () { setState(() => _page--); _load(); },
            ),
            Text('$_page / $_pages', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
            IconButton(
              icon: Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right),
              onPressed: _page >= _pages ? null : () { setState(() => _page++); _load(); },
            ),
          ]),
      ]),
    );
  }

  Widget _row(Map<String, dynamic> r) {
    final st = '${r['payStatus'] ?? 'pending'}';
    final badge = _payBadge[st] ?? _payBadge['pending']!;
    final proofs = List<Map<String, dynamic>>.from((r['proofFiles'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
    return Opacity(
      opacity: _loading ? 0.6 : 1,
      child: Container(
        margin: const EdgeInsets.only(top: 8),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: T.inkFaint.withValues(alpha: 0.05), borderRadius: BorderRadius.circular(12)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text('${r['customerName'] ?? '—'}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800))),
            // The transaction number opens its details here; the customs screen is not opened for Finance.
            InkWell(
              onTap: () => showClearanceQuickView(context, '${r['clearanceId']}'),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                child: Text('${r['refNumber'] ?? '—'}',
                    style: const TextStyle(fontSize: 12, color: T.orange, fontWeight: FontWeight.w800, decoration: TextDecoration.underline)),
              ),
            ),
          ]),
          const SizedBox(height: 2),
          Row(children: [
            Expanded(child: Text('${r['label'] ?? r['key'] ?? ''} · ${_dmy(r['date'])}', style: const TextStyle(fontSize: 11.5))),
            Text(_fmtAmt(r['amount']), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w900)),
          ]),
          if ('${r['note'] ?? ''}'.isNotEmpty) Text('${r['note']}', style: const TextStyle(fontSize: 11, color: T.inkSoft)),
          Text('${tr('طلبها', 'By')} ${r['addedByName'] ?? '—'}${r['addedAt'] != null ? ' · ${_dmy(r['addedAt'])}' : ''}',
              style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
          const SizedBox(height: 4),
          Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Chip2(tr(badge.$1, badge.$2), badge.$3),
            if ('${r['fileUrl'] ?? ''}'.isNotEmpty)
              ActionChip(
                visualDensity: VisualDensity.compact,
                avatar: const Icon(Icons.attach_file, size: 14),
                label: Text('${r['fileName'] ?? tr('المرفق', 'file')}', style: const TextStyle(fontSize: 11)),
                onPressed: () => _openUrl('${r['fileUrl']}'),
              )
            else
              Text(tr('بلا مرفق', 'no file'), style: const TextStyle(fontSize: 11, color: T.warn)),
            for (final f in proofs)
              ActionChip(
                visualDensity: VisualDensity.compact,
                avatar: const Icon(Icons.receipt_long, size: 14, color: T.success),
                label: Text('${f['fileName'] ?? tr('إثبات', 'proof')}', style: const TextStyle(fontSize: 11, color: T.success)),
                onPressed: () => _openUrl('${f['fileUrl']}'),
              ),
          ]),
          if ('${r['decisionNote'] ?? ''}'.isNotEmpty)
            Text('${r['decisionNote']}', style: const TextStyle(fontSize: 11, color: T.inkSoft)),
          if ('${r['decidedByName'] ?? ''}'.isNotEmpty && r['legacy'] != true)
            Text('${r['decidedByName']}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
          if (r['legacy'] == true)
            Padding(padding: const EdgeInsets.only(top: 4), child: Text(tr('سجلّ منقول', 'imported'), style: const TextStyle(fontSize: 11, color: T.inkFaint)))
          else
            Row(children: [
              const Spacer(),
              if (st != 'paid')
                FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: T.success, visualDensity: VisualDensity.compact, minimumSize: const Size(0, 38)),
                  onPressed: () => _decide(r, 'paid'),
                  icon: const Icon(Icons.check, size: 16),
                  label: Text(tr('تم الدفع', 'Paid'), style: const TextStyle(fontSize: 12)),
                ),
              if (st != 'returned')
                IconButton(tooltip: tr('إرجاع الطلب', 'Return'), icon: const Icon(Icons.undo, size: 18, color: T.info), onPressed: () => _decide(r, 'returned')),
              if (st != 'rejected')
                IconButton(tooltip: tr('رفض الطلب', 'Reject'), icon: const Icon(Icons.block, size: 18, color: T.danger), onPressed: () => _decide(r, 'rejected')),
            ]),
        ]),
      ),
    );
  }
}

/// Billing requests, counterpart of CustomsInvoiceRequests: four states and all, invoice items open under each, and the decision applies only to those awaiting (a reason is required for return and reject).
const _invStatus = <String, (String, String, Color)>{
  'pending': ('بانتظار الفوترة', 'Awaiting invoicing', T.warn),
  'invoiced': ('تمّت الفوترة', 'Invoiced', T.success),
  'returned': ('أُعيد للتصحيح', 'Returned', T.info),
  'rejected': ('مرفوض', 'Rejected', T.danger),
};

class _CustomsInvoiceRequests extends StatefulWidget {
  const _CustomsInvoiceRequests();
  @override
  State<_CustomsInvoiceRequests> createState() => _CustomsInvoiceRequestsState();
}

class _CustomsInvoiceRequestsState extends State<_CustomsInvoiceRequests> {
  List<Map<String, dynamic>>? _rows;
  Map<String, dynamic> _counts = const {};
  String _tab = 'pending';
  String? _open;
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('customs:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('customs:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/customs-clearance/invoice-requests?status=$_tab');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['requests'] ?? const []);
        _counts = Map<String, dynamic>.from(d['counts'] ?? const {});
      });
    } catch (_) {
      if (mounted && mine == _seq) setState(() => _rows = const []);
    }
  }

  Future<void> _decide(Map<String, dynamic> r, String decision) async {
    final noteCtrl = TextEditingController();
    final noCtrl = TextEditingController();
    PickedFile? inv;
    final go = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setSheet) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${decision == 'invoiced' ? tr('تمّت الفوترة', 'Mark invoiced')
                : decision == 'returned' ? tr('إعادة للتصحيح', 'Return for correction') : tr('رفض طلب الفوترة', 'Reject request')} · ${r['refNumber'] ?? ''}',
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 10),
            if (decision == 'invoiced') ...[
              TextField(controller: noCtrl, decoration: InputDecoration(labelText: tr('رقم الفاتورة في نظامكم (اختياري — وإلّا يُعطى رقمٌ متسلسل)', 'Invoice number in your system (optional)'))),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () async {
                  final f = await pickFileAsDataUrl();
                  if (f == null) return;
                  if (f.sizeBytes > 20 * 1024 * 1024) {
                    if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(tr('الملفّ أكبر من 20 ميجا', 'File over 20MB'))));
                    return;
                  }
                  setSheet(() => inv = f);
                },
                icon: const Icon(Icons.attach_file, size: 18),
                label: Text(inv == null ? tr('الفاتورة النهائية (اختياري)', 'Final invoice (optional)') : inv!.fileName),
              ),
            ],
            TextField(controller: noteCtrl, maxLines: 2,
                decoration: InputDecoration(labelText: decision == 'invoiced' ? tr('ملاحظة (اختياري)', 'Note (optional)') : tr('السبب *', 'Reason *'))),
            const SizedBox(height: 12),
            SizedBox(width: double.infinity, child: FilledButton(
              style: FilledButton.styleFrom(backgroundColor: decision == 'rejected' ? T.danger : decision == 'returned' ? T.navy : T.success),
              onPressed: () {
                if (decision != 'invoiced' && noteCtrl.text.trim().isEmpty) {
                  ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(tr('اكتب السبب', 'Write the reason'))));
                  return;
                }
                Navigator.pop(c, true);
              },
              child: Text(tr('تأكيد', 'Confirm')),
            )),
          ]),
        ),
      )),
    );
    if (go != true) return;
    try {
      await Api.instance.patch('/api/customs-clearance/${r['clearanceId']}/invoice-request/decision', {
        'decision': decision,
        'note': noteCtrl.text.trim(),
        if (decision == 'invoiced') 'invoiceNumber': noCtrl.text.trim(),
        if (decision == 'invoiced') 'file': inv == null ? null : {'dataUrl': inv!.dataUrl, 'fileName': inv!.fileName},
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(decision == 'invoiced' ? tr('سُجّلت الفوترة', 'Marked invoiced') : tr('سُجّل القرار', 'Decision saved'))));
      }
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    final pending = ((_counts['pending'] as num?) ?? 0).toInt();
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.receipt_outlined, size: 18, color: T.orange),
          const SizedBox(width: 6),
          Expanded(child: Text(tr('طلبات الفوترة', 'Invoice requests'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
          if (pending > 0) Chip2('$pending', T.danger),
        ]),
        Text(tr('يطلبها التخليصُ عند الإقفال — فوتِرها في نظامك ثمّ «تمّت الفوترة» هنا.', 'Customs requests them on closing — invoice in your system, then mark it here.'),
            style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        const SizedBox(height: 8),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(children: [
            for (final k in const ['pending', 'invoiced', 'returned', 'rejected', 'all'])
              Padding(
                padding: const EdgeInsetsDirectional.only(end: 6),
                child: FilterChip(
                  selected: _tab == k,
                  showCheckmark: false,
                  onSelected: (_) { setState(() { _tab = k; _rows = null; }); _load(); },
                  label: Text(k == 'all' ? tr('الكلّ', 'All')
                      : '${tr(_invStatus[k]!.$1, _invStatus[k]!.$2)}${((_counts[k] as num?) ?? 0) > 0 ? ' (${_counts[k]})' : ''}'),
                  labelStyle: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: _tab == k ? Colors.white : T.inkSoft),
                  selectedColor: T.navy,
                  side: BorderSide.none,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                ),
              ),
          ]),
        ),
        if (rows == null)
          const Padding(padding: EdgeInsets.all(14), child: Center(child: CircularProgressIndicator(strokeWidth: 2)))
        else if (rows.isEmpty)
          Padding(padding: const EdgeInsets.all(14), child: Center(child: Text(
              _tab == 'pending' ? tr('لا طلبات فوترة تنتظر', 'Nothing awaiting invoicing') : tr('لا شيء هنا', 'Nothing here'),
              style: const TextStyle(fontSize: 12, color: T.inkFaint))))
        else
          ...rows.map((r) {
            final st = _invStatus['${r['status']}'] ?? _invStatus['pending']!;
            final lines = List<Map<String, dynamic>>.from((r['lines'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
            final open = _open == '${r['clearanceId']}';
            return Container(
              margin: const EdgeInsets.only(top: 8),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: T.inkFaint.withValues(alpha: 0.05), borderRadius: BorderRadius.circular(12)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text('${r['customerName'] ?? '—'}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800))),
                  InkWell(
                    onTap: () => showClearanceQuickView(context, '${r['clearanceId']}'),
                    child: Text('${r['refNumber'] ?? '—'}', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: T.orange, decoration: TextDecoration.underline)),
                  ),
                ]),
                if ('${r['blNumber'] ?? ''}'.isNotEmpty || r['isCompleted'] == true)
                  Text('${r['blNumber'] ?? ''}${r['isCompleted'] == true ? ' · ${tr('مغلقة', 'Closed')}' : ''}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                const SizedBox(height: 2),
                InkWell(
                  onTap: () => setState(() => _open = open ? null : '${r['clearanceId']}'),
                  child: Row(children: [
                    Text(_fmtAmt(r['total']), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: T.navy, decoration: TextDecoration.underline)),
                    const SizedBox(width: 6),
                    Expanded(child: Text('${tr('شامل الضريبة', 'incl. VAT')} ${_fmtAmt(r['vat'])} · ${lines.length} ${tr('بند', 'lines')}',
                        style: const TextStyle(fontSize: 11, color: T.inkSoft))),
                    Icon(open ? Icons.expand_less : Icons.expand_more, size: 18, color: T.inkFaint),
                  ]),
                ),
                if (open)
                  Container(
                    margin: const EdgeInsets.only(top: 6),
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8)),
                    // The prices billed to the customer as typed in the request; payment stages are not part of it.
                    child: Column(children: [
                      Row(children: [
                        Expanded(child: Text(tr('البند', 'Line'), style: const TextStyle(fontSize: 10.5, color: T.inkFaint, fontWeight: FontWeight.w700))),
                        SizedBox(width: 62, child: Text(tr('السعر', 'Price'), textAlign: TextAlign.end, style: const TextStyle(fontSize: 10.5, color: T.inkFaint, fontWeight: FontWeight.w700))),
                        SizedBox(width: 62, child: Text(tr('الضريبة 15%', 'VAT 15%'), textAlign: TextAlign.end, style: const TextStyle(fontSize: 10.5, color: T.inkFaint, fontWeight: FontWeight.w700))),
                        SizedBox(width: 68, child: Text(tr('الإجمالي', 'Total'), textAlign: TextAlign.end, style: const TextStyle(fontSize: 10.5, color: T.inkFaint, fontWeight: FontWeight.w700))),
                      ]),
                      for (final l in lines)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 3),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Expanded(child: Row(children: [
                                Flexible(child: Text('${l['label'] ?? ''}', style: const TextStyle(fontSize: 11.5))),
                                if ('${l['fileUrl'] ?? ''}'.isNotEmpty)
                                  InkWell(onTap: () => _openUrl('${l['fileUrl']}'), child: const Padding(padding: EdgeInsets.symmetric(horizontal: 3), child: Icon(Icons.attach_file, size: 14, color: T.info))),
                              ])),
                              SizedBox(width: 62, child: Text(_fmtAmt(l['amount']), textAlign: TextAlign.end, style: const TextStyle(fontSize: 11.5))),
                              SizedBox(width: 62, child: Text(_fmtAmt(l['vat']), textAlign: TextAlign.end, style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
                              SizedBox(width: 68, child: Text(_fmtAmt(l['total']), textAlign: TextAlign.end, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800))),
                            ]),
                            if ('${l['note'] ?? ''}'.isNotEmpty) Text('${l['note']}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                          ]),
                        ),
                      const Divider(height: 10),
                      Row(children: [
                        Expanded(child: Text(tr('إجمالي الفاتورة', 'Invoice total'), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w900))),
                        SizedBox(width: 62, child: Text(_fmtAmt(r['net'] ?? (((r['total'] as num?) ?? 0) - ((r['vat'] as num?) ?? 0))), textAlign: TextAlign.end, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w900))),
                        SizedBox(width: 62, child: Text(_fmtAmt(r['vat']), textAlign: TextAlign.end, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w900))),
                        SizedBox(width: 68, child: Text(_fmtAmt(r['total']), textAlign: TextAlign.end, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w900))),
                      ]),
                      if ('${r['note'] ?? ''}'.isNotEmpty)
                        Align(alignment: AlignmentDirectional.centerStart, child: Padding(padding: const EdgeInsets.only(top: 4),
                            child: Text('${tr('ملاحظة الطلب:', 'Request note:')} ${r['note']}', style: const TextStyle(fontSize: 11, color: T.inkSoft)))),
                    ]),
                  ),
                Text('${tr('طلبها', 'By')} ${r['requestedByName'] ?? '—'} · ${_dmy(r['requestedAt'])}${'${r['note'] ?? ''}'.isNotEmpty ? ' · «${r['note']}»' : ''}',
                    style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                const SizedBox(height: 4),
                Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                  Chip2(tr(st.$1, st.$2), st.$3),
                  if ('${r['invoiceNumber'] ?? ''}'.isNotEmpty) Text('${r['invoiceNumber']}', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                  if ('${r['fileUrl'] ?? ''}'.isNotEmpty)
                    ActionChip(
                      visualDensity: VisualDensity.compact,
                      avatar: const Icon(Icons.task_outlined, size: 14),
                      label: Text(tr('الفاتورة النهائية', 'Final invoice'), style: const TextStyle(fontSize: 11)),
                      onPressed: () => _openUrl('${r['fileUrl']}'),
                    ),
                ]),
                if ('${r['decisionNote'] ?? ''}'.isNotEmpty) Text('«${r['decisionNote']}»', style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                if ('${r['decidedByName'] ?? ''}'.isNotEmpty) Text('${r['decidedByName']} · ${_dmy(r['decidedAt'])}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                if (r['status'] == 'pending') ...[
                  const SizedBox(height: 8),
                  Row(children: [
                    Expanded(child: FilledButton(style: FilledButton.styleFrom(backgroundColor: T.success), onPressed: () => _decide(r, 'invoiced'), child: Text(tr('تمّت الفوترة', 'Invoiced'), style: const TextStyle(fontSize: 12)))),
                    const SizedBox(width: 6),
                    OutlinedButton(onPressed: () => _decide(r, 'returned'), child: Text(tr('إعادة', 'Return'), style: const TextStyle(fontSize: 12))),
                    const SizedBox(width: 6),
                    OutlinedButton(onPressed: () => _decide(r, 'rejected'), child: Text(tr('رفض', 'Reject'), style: const TextStyle(fontSize: 12, color: T.danger))),
                  ]),
                ],
              ]),
            );
          }),
      ]),
    );
  }
}

/// Customs customer invoices, counterpart of CustomsCustomerInvoices: what the section issued for invoicing (up to 300); those whose transport invoice has not arrived are red and have their own filter button.
class _CustomsCustomerInvoices extends StatefulWidget {
  const _CustomsCustomerInvoices();
  @override
  State<_CustomsCustomerInvoices> createState() => _CustomsCustomerInvoicesState();
}

class _CustomsCustomerInvoicesState extends State<_CustomsCustomerInvoices> {
  List<Map<String, dynamic>> _rows = const [];
  Map<String, dynamic> _summary = const {};
  bool _loading = true;
  bool _onlyAwaiting = false;
  String _q = '';
  final _searchCtl = TextEditingController();
  int _limit = 40;
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('customs:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('customs:updated', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/customs-clearance/invoices?limit=300');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['invoices'] ?? const []);
        _summary = Map<String, dynamic>.from(d['summary'] ?? const {});
        _loading = false;
      });
    } catch (_) {
      if (mounted && mine == _seq) setState(() => _loading = false);
    }
  }

  String _state(Map<String, dynamic> r) => r['awaitingTransportInvoice'] == true
      ? tr('بانتظار فاتورة النقل', 'Awaiting transport invoice')
      : r['isCompleted'] == true ? tr('مغلقة', 'Closed') : tr('مفتوحة', 'Open');

  @override
  Widget build(BuildContext context) {
    final awaiting = ((_summary['awaitingTransportInvoice'] as num?) ?? 0).toInt();
    final base = _onlyAwaiting ? _rows.where((r) => r['awaitingTransportInvoice'] == true).toList() : _rows;
    final n = _foldFin(_q.trim());
    final shown = n.isEmpty ? base : base.where((r) => _foldFin([r['invoiceNumber'], r['blNumber'], r['refNumber'], r['customerName']].join(' ')).contains(n)).toList();
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.receipt_long_outlined, size: 18, color: T.orange),
          const SizedBox(width: 6),
          Expanded(child: Text(tr('فواتير عملاء التخليص', 'Customs customer invoices'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
        ]),
        Text(tr('${_summary['count'] ?? 0} فاتورة · الإجمالي ${_fmtAmt(_summary['grand'] ?? 0)} ر.س — اضغط الفاتورة لعرض معاملتها',
                '${_summary['count'] ?? 0} invoices · total ${_fmtAmt(_summary['grand'] ?? 0)} SAR — tap one to see its transaction'),
            style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
            child: SearchField(
              controller: _searchCtl, dense: true,
              onChanged: (v) => setState(() { _q = v; _limit = 40; }),
              hint: tr('فاتورة، بوليصة، معاملة، عميل', 'Invoice, BL, transaction, customer'),
            ),
          ),
          const SizedBox(width: 6),
          FilterChip(
            selected: _onlyAwaiting,
            showCheckmark: false,
            onSelected: (awaiting > 0 || _onlyAwaiting) ? (v) => setState(() { _onlyAwaiting = v; _limit = 40; }) : null,
            avatar: Icon(Icons.warning_amber_rounded, size: 15, color: _onlyAwaiting ? Colors.white : T.danger),
            label: Text('$awaiting'),
            labelStyle: TextStyle(fontWeight: FontWeight.w800, color: _onlyAwaiting ? Colors.white : T.danger),
            selectedColor: T.danger,
            tooltip: tr('بانتظار فاتورة النقل', 'Awaiting transport invoice'),
          ),
        ]),
        if (_loading)
          const Padding(padding: EdgeInsets.all(14), child: Center(child: CircularProgressIndicator(strokeWidth: 2)))
        else if (shown.isEmpty)
          Padding(padding: const EdgeInsets.all(14), child: Center(child: Text(tr('لا فواتير.', 'No invoices.'), style: const TextStyle(fontSize: 12, color: T.inkFaint))))
        else ...[
          ...shown.take(_limit).map((r) {
            final tot = Map<String, dynamic>.from(r['totals'] ?? const {});
            final red = r['awaitingTransportInvoice'] == true;
            return InkWell(
              onTap: () => showClearanceQuickView(context, '${r['_id']}'),
              child: Container(
                margin: const EdgeInsets.only(top: 8),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: red ? T.danger.withValues(alpha: 0.07) : T.inkFaint.withValues(alpha: 0.05), borderRadius: BorderRadius.circular(12)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text('${r['customerName'] ?? '—'}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800))),
                    Text('${r['invoiceNumber'] ?? ''}', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: T.orange)),
                  ]),
                  Text([
                    _dmy(r['invoiceAt']),
                    if ('${r['blNumber'] ?? ''}'.isNotEmpty) '${tr('بوليصة', 'BL')} ${r['blNumber']}',
                    if ('${r['refNumber'] ?? ''}'.isNotEmpty) '${tr('معاملة', 'Txn')} ${r['refNumber']}',
                  ].join(' · '), style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                  const SizedBox(height: 4),
                  Row(children: [
                    Expanded(child: Text('${tr('قبل الضريبة', 'Net')} ${_fmtAmt(tot['net'] ?? 0)} · ${tr('الضريبة', 'VAT')} ${_fmtAmt(tot['vat'] ?? 0)}',
                        style: const TextStyle(fontSize: 11, color: T.inkSoft))),
                    Text(_fmtAmt(tot['grand'] ?? 0), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: T.navy)),
                  ]),
                  const SizedBox(height: 4),
                  Chip2(_state(r), red ? T.danger : r['isCompleted'] == true ? T.success : T.info, icon: red ? Icons.error_outline : null),
                ]),
              ),
            );
          }),
          if (shown.length > _limit)
            TextButton(onPressed: () => setState(() => _limit += 100), child: Text(tr('عرض المزيد (${shown.length - _limit} متبقي)', 'Show more (${shown.length - _limit} left)'))),
        ],
      ]),
    );
  }
}
