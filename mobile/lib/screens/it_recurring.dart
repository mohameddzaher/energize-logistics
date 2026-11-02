import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'it_common.dart';
import 'it_tickets.dart';
import '../ui/search_field.dart';

/// Recurring issues: groups similar tickets (by fingerprint) with a repeat count, to expose chronic faults. Same as /api/it/tickets/recurring on the web: category filter on the server, search on the screen, a group opens its tickets, export shown or all.
class ItRecurringScreen extends StatefulWidget {
  /// The dashboard opens the screen with a specific group open.
  final String? initialSig;
  const ItRecurringScreen({super.key, this.initialSig});
  @override
  State<ItRecurringScreen> createState() => _ItRecurringScreenState();
}

List<ExportCol> _cols() => [
      ExportCol('المشكلة', 'Problem', (g) => g['sampleTitle'] ?? ''),
      ExportCol('التصنيف', 'Category', (g) => categoryLabel(g['category'])),
      ExportCol('عدد التكرار', 'Occurrences', (g) => g['count'] ?? 0),
      ExportCol('أول ظهور', 'First seen', (g) => '${g['firstReportedAt'] ?? ''}'.split('T').first),
      ExportCol('آخر ظهور', 'Last seen', (g) => '${g['lastReportedAt'] ?? ''}'.split('T').first),
      ExportCol('متوسط زمن الحل', 'Avg resolution', (g) => fmtDuration(g['avgResolutionMinutes'])),
      ExportCol('الأقسام المتأثرة', 'Affected departments', (g) => ((g['affectedDepartments'] as List?) ?? []).join(', ')),
    ];

class _ItRecurringScreenState extends State<ItRecurringScreen> {
  List<Map<String, dynamic>> _groups = [];
  Map<String, Map<String, dynamic>> _ticketById = {};
  bool _loading = true;
  String? _error;
  String _q = '';
  String _category = '';
  late String? _expanded = widget.initialSig;
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () => _load();
    Live.instance.on('it:updated', _onLive);
    _load();
  }

  @override
  void dispose() {
    Live.instance.off('it:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final my = ++_seq;
    try {
      final d = await Api.instance.get('/api/it/tickets/recurring${_category.isEmpty ? '' : '?category=$_category'}');
      if (!mounted || my != _seq) return;
      setState(() {
        _groups = List<Map<String, dynamic>>.from(d['groups'] ?? []);
        _ticketById = {for (final t in List<Map<String, dynamic>>.from(d['tickets'] ?? [])) '${t['_id']}': t};
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && my == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  List<Map<String, dynamic>> get _filtered {
    final s = _q.trim().toLowerCase();
    if (s.isEmpty) return _groups;
    return _groups.where((g) => '${g['sampleTitle'] ?? ''}'.toLowerCase().contains(s) || categoryLabel(g['category']).toLowerCase().contains(s)).toList();
  }

  Future<void> _export() async {
    final filtered = _category.isNotEmpty || _q.trim().isNotEmpty;
    final scope = await pickExportScope(context, filtered: filtered);
    if (scope == null || !mounted) return;
    var rows = _filtered;
    if (scope == 'all' && filtered) {
      try {
        final d = await Api.instance.get('/api/it/tickets/recurring');
        rows = List<Map<String, dynamic>>.from(d['groups'] ?? []);
      } catch (_) {}
    }
    if (!mounted) return;
    await exportExcel(context, fileName: 'it-recurring', sheets: [('Recurring', _cols(), rows)]);
  }

  @override
  Widget build(BuildContext context) {
    final rows = _filtered;
    final totalRepeats = rows.fold<num>(0, (s, g) => s + ((g['count'] as num?) ?? 0));
    return AppScaffold(
      title: Text(tr('المشكلات المتكررة', 'Recurring Problems')),
      actions: [IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export)],
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
          child: Row(children: [
            Expanded(flex: 3, child: SearchField(
              dense: true,
              onChanged: (v) => setState(() => _q = v),
              hint: tr('بحث في المشكلات...', 'Search problems...'),
            )),
            const SizedBox(width: 8),
            Expanded(flex: 2, child: ItFilterDropdown(label: tr('التصنيف', 'Category'), value: _category, options: ticketCategories,
                allAr: 'كل التصنيفات', allEn: 'All categories', onChanged: (v) { setState(() => _category = v); _load(); })),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Align(
            alignment: AlignmentDirectional.centerStart,
            child: Text(tr('${rows.length} مشكلة متكررة · ${totalRepeats.toInt()} بلاغ', '${rows.length} recurring problems · ${totalRepeats.toInt()} tickets'),
                style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.inkSoft)),
          ),
        ),
        Expanded(
          child: _loading
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 80), SizedBox(height: 10), Shimmer(height: 80)])
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.check_circle_outline, title: _q.trim().isNotEmpty ? tr('لا نتائج', 'No matches') : tr('لا توجد مشكلات متكررة — وضع جيد.', 'No recurring problems — all good.'))])
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              padding: const EdgeInsets.all(14),
                              itemCount: rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 10),
                              itemBuilder: (c, i) => _group(rows[i]),
                            ),
                    ),
        ),
      ]),
    );
  }

  Widget _group(Map<String, dynamic> g) {
    final count = (g['count'] as num?) ?? 0;
    final color = count >= 5 ? T.danger : T.warn;
    final open = _expanded == g['signature'];
    final deps = ((g['affectedDepartments'] as List?) ?? []).map((x) => '$x').toList();
    return AppCard(
      topAccent: color,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Pressable(
          onTap: () => setState(() => _expanded = open ? null : '${g['signature']}'),
          child: Row(children: [
            Container(
              width: 46, height: 46,
              decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
              alignment: Alignment.center,
              child: Text('${count.toInt()}×', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: color)),
            ),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${g['sampleTitle'] ?? g['signature'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5), maxLines: 2, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 5),
              Wrap(spacing: 6, runSpacing: 6, children: [
                Chip2(categoryLabel(g['category']), T.navy),
                Chip2('${tr('أول', 'First')}: ${itDate(g['firstReportedAt'])}', T.inkFaint),
                Chip2('${tr('آخر', 'Last')}: ${itDate(g['lastReportedAt'])}', T.inkFaint),
                Chip2('${tr('متوسط الحل', 'Avg')}: ${fmtDuration(g['avgResolutionMinutes'])}', T.success),
              ]),
              if (deps.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(deps.join('، '), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
              ],
            ])),
            Icon(open ? Icons.expand_less : Icons.expand_more, color: T.inkFaint),
          ]),
        ),
        if (open) ...[
          const Divider(height: 18),
          Text(tr('البلاغات المرتبطة', 'Individual tickets'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.inkSoft)),
          const SizedBox(height: 6),
          for (final id in ((g['ticketIds'] as List?) ?? []).map((x) => '$x'))
            if (_ticketById[id] != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Pressable(
                  onTap: () async {
                    await Navigator.push(context, MaterialPageRoute(builder: (_) => ItTicketDetailScreen(id: id)));
                    _load();
                  },
                  child: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), border: Border.all(color: T.line)),
                    child: Row(children: [
                      Expanded(child: Text('${_ticketById[id]!['ticketNumber'] ?? ''}  ${_ticketById[id]!['title'] ?? ''}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
                      Chip2(ticketStatusLabel(_ticketById[id]!['status']), ticketStatusColor(_ticketById[id]!['status'])),
                      const SizedBox(width: 6),
                      Text(itDate(_ticketById[id]!['reportedAt']), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                    ]),
                  ),
                ),
              ),
        ],
      ]),
    );
  }
}
