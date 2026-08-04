import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// مركز التقارير — the mobile half of the reporting engine.
///
/// Same contract as the web (`/api/reports/*`): the backend DESCRIBES a report
/// as blocks and RENDERS the same blocks to PDF. This screen draws the blocks on
/// the phone and prints the server's PDF — so a report opened on a phone is the
/// identical document to one opened on a desktop, down to the letterhead.
///
/// Adding a block kind on the server means adding one case to `_Block` here.

const _icons = <String, IconData>{
  'truck': Icons.local_shipping_outlined,
  'user': Icons.badge_outlined,
  'building': Icons.apartment_outlined,
  'store': Icons.storefront_outlined,
  'badge': Icons.account_circle_outlined,
  'layers': Icons.layers_outlined,
};

String _val(dynamic v) => (v == null || v.toString().isEmpty) ? '—' : v.toString();

Color? _hex(String? s) {
  if (s == null || !s.startsWith('#') || s.length != 7) return null;
  return Color(int.parse('FF${s.substring(1)}', radix: 16));
}

String _iso(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class ReportsScreen extends StatefulWidget {
  /// Optional deep link: open straight onto one entity's report.
  final String? subject;
  final String? entityId;
  final String? entityName;
  const ReportsScreen({super.key, this.subject, this.entityId, this.entityName});
  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  List<Map<String, dynamic>> _subjects = [];
  String _subject = '';
  List<Map<String, dynamic>> _options = [];
  bool _optionsLoading = false;
  String _q = '';
  String? _selectedId;
  String? _selectedName;

  late DateTime _from;
  late DateTime _to;

  Map<String, dynamic>? _doc;
  bool _building = false;
  bool _pdfBusy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _to = DateTime.now();
    _from = DateTime(_to.year - 1, _to.month, _to.day);
    _subject = widget.subject ?? '';
    _selectedId = widget.entityId;
    _selectedName = widget.entityName;
    _loadSubjects();
  }

  Future<void> _loadSubjects() async {
    try {
      final d = await Api.instance.get('/api/reports/subjects');
      if (!mounted) return;
      final subs = List<Map<String, dynamic>>.from(d['subjects'] ?? []);
      setState(() {
        _subjects = subs;
        if (_subject.isEmpty && subs.isNotEmpty) _subject = subs.first['key'].toString();
      });
      if (_selectedId != null) {
        _build(_selectedId!);
      } else {
        _loadOptions();
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _loadOptions() async {
    if (_subject.isEmpty) return;
    setState(() => _optionsLoading = true);
    try {
      final qs = _q.trim().isEmpty ? '' : '?q=${Uri.encodeComponent(_q.trim())}';
      final d = await Api.instance.get('/api/reports/$_subject/options$qs');
      if (!mounted) return;
      setState(() {
        _options = List<Map<String, dynamic>>.from(d['items'] ?? []);
        _optionsLoading = false;
      });
    } catch (_) {
      if (mounted) setState(() { _options = []; _optionsLoading = false; });
    }
  }

  Future<void> _build(String id) async {
    setState(() { _building = true; _error = null; _doc = null; _selectedId = id; });
    try {
      final d = await Api.instance.get(
        '/api/reports/$_subject/${Uri.encodeComponent(id)}'
        '?from=${_iso(_from)}&to=${_iso(_to)}&lang=${Lang.instance.ar ? 'ar' : 'en'}',
      );
      if (!mounted) return;
      setState(() { _doc = Map<String, dynamic>.from(d); _building = false; });
    } catch (e) {
      if (mounted) {
        setState(() {
          _building = false;
          _error = e is ApiException ? e.message : e.toString();
        });
      }
    }
  }

  Future<void> _printPdf() async {
    if (_selectedId == null) return;
    setState(() => _pdfBusy = true);
    try {
      // The PDF is rendered SERVER-side on the company letterhead — we only ever
      // hand the bytes to the print sheet, never re-lay it out here.
      final bytes = await Api.instance.getBytes(
        '/api/reports/$_subject/${Uri.encodeComponent(_selectedId!)}'
        '?from=${_iso(_from)}&to=${_iso(_to)}&lang=${Lang.instance.ar ? 'ar' : 'en'}&format=pdf',
      );
      await Printing.layoutPdf(onLayout: (_) async => bytes, name: '$_subject-report');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e is ApiException ? e.message : tr('تعذّر توليد التقرير', 'Could not generate the report')),
        ));
      }
    }
    if (mounted) setState(() => _pdfBusy = false);
  }

  Future<void> _pickRange() async {
    final r = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 1)),
      initialDateRange: DateTimeRange(start: _from, end: _to),
    );
    if (r != null) {
      setState(() { _from = r.start; _to = r.end; });
      if (_selectedId != null) _build(_selectedId!);
    }
  }

  void _openPicker() {
    _loadOptions();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(
        builder: (c, setSheet) => Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
          child: SizedBox(
            height: MediaQuery.of(c).size.height * 0.75,
            child: Column(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: TextField(
                  autofocus: false,
                  decoration: InputDecoration(
                    hintText: tr('ابحث…', 'Search…'),
                    prefixIcon: const Icon(Icons.search),
                  ),
                  onChanged: (v) {
                    _q = v;
                    _loadOptions().then((_) => setSheet(() {}));
                  },
                ),
              ),
              if (_optionsLoading) const LinearProgressIndicator(minHeight: 2),
              Expanded(
                child: _options.isEmpty
                    ? Center(child: Text(tr('لا توجد عناصر', 'Nothing to report on'),
                        style: const TextStyle(color: T.inkFaint, fontSize: 13)))
                    : ListView.builder(
                        itemCount: _options.length,
                        itemBuilder: (c, i) {
                          final o = _options[i];
                          return ListTile(
                            dense: true,
                            title: Text(o['name'].toString(),
                                style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700,
                                    color: o['inactive'] == true ? T.inkFaint : T.ink)),
                            subtitle: (o['detail'] ?? '').toString().isEmpty
                                ? null
                                : Text(o['detail'].toString(), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                            onTap: () {
                              Navigator.pop(c);
                              setState(() => _selectedName = o['name'].toString());
                              _build(o['id'].toString());
                            },
                          );
                        },
                      ),
              ),
            ]),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('مركز التقارير', 'Reports')),
      floatingActionButton: _doc == null
          ? null
          : FloatingActionButton.extended(
              backgroundColor: T.orange,
              foregroundColor: Colors.white,
              onPressed: _pdfBusy ? null : _printPdf,
              icon: _pdfBusy
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.picture_as_pdf_outlined),
              label: Text(tr('PDF', 'PDF')),
            ),
      body: _subjects.isEmpty
          ? (_error != null
              ? ErrorRetry(message: _error!, onRetry: _loadSubjects)
              : ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer()]))
          : ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 90), children: [
              // 1 — what kind of report
              SizedBox(
                height: 40,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: _subjects.map((s) {
                    final k = s['key'].toString();
                    final active = _subject == k;
                    return Padding(
                      padding: const EdgeInsetsDirectional.only(end: 6),
                      child: ChoiceChip(
                        avatar: Icon(_icons[s['icon']] ?? Icons.description_outlined,
                            size: 16, color: active ? Colors.white : T.navy),
                        label: Text(tr(s['ar'] ?? '', s['en'] ?? '')),
                        selected: active,
                        onSelected: (_) {
                          setState(() {
                            _subject = k; _selectedId = null; _selectedName = null;
                            _doc = null; _q = ''; _error = null;
                          });
                          _loadOptions();
                        },
                      ),
                    );
                  }).toList(),
                ),
              ),
              const SizedBox(height: 12),

              // 2 — who, and over what period
              AppCard(
                child: Column(children: [
                  Pressable(
                    onTap: _openPicker,
                    child: Row(children: [
                      const Icon(Icons.search, size: 18, color: T.inkSoft),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          _selectedName ?? tr('اختر العنصر…', 'Pick an entity…'),
                          style: TextStyle(fontSize: 13.5,
                              fontWeight: _selectedName == null ? FontWeight.w500 : FontWeight.w800,
                              color: _selectedName == null ? T.inkFaint : T.ink),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const Icon(Icons.chevron_right_rounded, color: T.inkFaint),
                    ]),
                  ),
                  const Divider(height: 18),
                  Pressable(
                    onTap: _pickRange,
                    child: Row(children: [
                      const Icon(Icons.date_range_outlined, size: 18, color: T.inkSoft),
                      const SizedBox(width: 10),
                      Expanded(child: Text('${_iso(_from)}  →  ${_iso(_to)}',
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700))),
                      const Icon(Icons.chevron_right_rounded, color: T.inkFaint),
                    ]),
                  ),
                ]),
              ),
              const SizedBox(height: 14),

              // 3 — the report
              if (_building) ...[
                const SizedBox(height: 30),
                const Center(child: CircularProgressIndicator(color: T.orange)),
                const SizedBox(height: 14),
                Center(child: Text(tr('جارٍ تجميع بيانات التقرير…', 'Collecting the report data…'),
                    style: const TextStyle(fontSize: 13, color: T.inkSoft))),
                const SizedBox(height: 6),
                Center(
                  child: Text(
                    tr('تقارير المركبات والسائقين تقرأ من نظام التتبّع مباشرة وقد تستغرق بضع ثوانٍ.',
                        'Vehicle and driver reports read the tracking system live and can take a few seconds.'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 11, color: T.inkFaint),
                  ),
                ),
              ] else if (_error != null)
                ErrorRetry(message: _error!, onRetry: () { if (_selectedId != null) _build(_selectedId!); })
              else if (_doc != null) ...[
                Center(
                  child: Column(children: [
                    Text(_doc!['title'].toString(),
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
                    if ((_doc!['subtitle'] ?? '').toString().isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 3),
                        child: Text(_doc!['subtitle'].toString(),
                            textDirection: TextDirection.ltr,
                            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.orange)),
                      ),
                    Container(width: 70, height: 3, margin: const EdgeInsets.only(top: 8),
                        decoration: BoxDecoration(color: T.orange, borderRadius: BorderRadius.circular(2))),
                  ]),
                ),
                const SizedBox(height: 14),
                ...List<Map<String, dynamic>>.from(_doc!['blocks'] ?? [])
                    .map((b) => _Block(block: b)),
              ] else
                Padding(
                  padding: const EdgeInsets.only(top: 40),
                  child: EmptyState(
                    icon: Icons.assessment_outlined,
                    title: tr('اختر عنصرًا لإصدار تقريره', 'Pick something to generate its report'),
                  ),
                ),
            ]),
    );
  }
}

/// One report block, drawn to match what the PDF prints.
class _Block extends StatelessWidget {
  final Map<String, dynamic> block;
  const _Block({required this.block});

  @override
  Widget build(BuildContext context) {
    final kind = block['kind']?.toString();
    switch (kind) {
      case 'section':
        return Container(
          width: double.infinity,
          margin: const EdgeInsets.only(top: 16, bottom: 8),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          decoration: BoxDecoration(color: T.navy, borderRadius: BorderRadius.circular(10)),
          child: Text(block['text'].toString(),
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13.5)),
        );

      case 'kv': {
        final items = List.from(block['items'] ?? []);
        if (items.isEmpty) return const SizedBox.shrink();
        return AppCard(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          child: Column(
            children: items.map<Widget>((raw) {
              final pair = List.from(raw as List);
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 7),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SizedBox(width: 130,
                      child: Text(pair[0].toString(),
                          style: const TextStyle(fontSize: 11.5, color: T.inkSoft, fontWeight: FontWeight.w700))),
                  Expanded(child: Text(_val(pair.length > 1 ? pair[1] : null),
                      style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
                ]),
              );
            }).toList(),
          ),
        );
      }

      case 'stats': {
        final items = List<Map<String, dynamic>>.from(block['items'] ?? []);
        if (items.isEmpty) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Wrap(
            spacing: 8, runSpacing: 8,
            children: items.map((s) {
              return Container(
                width: (MediaQuery.of(context).size.width - 28 - 16) / 3,
                padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 6),
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFC),
                  border: Border.all(color: T.line),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(children: [
                  Text(s['label'].toString(), textAlign: TextAlign.center, maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 9.5, color: T.inkSoft)),
                  const SizedBox(height: 4),
                  Text(_val(s['value']), textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 14, fontWeight: FontWeight.w900,
                          color: s['accent'] == true ? T.orange : T.ink)),
                ]),
              );
            }).toList(),
          ),
        );
      }

      case 'table': {
        final rows = List.from(block['rows'] ?? []);
        if (rows.isEmpty) {
          final empty = block['emptyText']?.toString();
          return empty == null ? const SizedBox.shrink() : _Block(block: {'kind': 'note', 'text': empty});
        }
        final head = List.from(block['head'] ?? []);
        // A wide table on a phone is a horizontal scroll, not a squeeze.
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              headingRowColor: WidgetStateProperty.all(T.navy),
              headingRowHeight: 38,
              dataRowMinHeight: 34,
              dataRowMaxHeight: 46,
              columnSpacing: 18,
              horizontalMargin: 10,
              columns: head.map<DataColumn>((h) => DataColumn(
                label: Text(h.toString(),
                    style: const TextStyle(color: Color(0xFFCBD5E1), fontSize: 11, fontWeight: FontWeight.w800)),
              )).toList(),
              rows: rows.take(120).map<DataRow>((raw) {
                final cells = List.from(raw as List);
                return DataRow(cells: List.generate(head.length, (i) {
                  final c = i < cells.length ? cells[i] : null;
                  final isMap = c is Map;
                  final text = _val(isMap ? c['t'] : c);
                  final color = isMap ? _hex(c['color']?.toString()) : null;
                  return DataCell(Text(text,
                      style: TextStyle(fontSize: 11.5, color: color ?? T.ink,
                          fontWeight: color != null ? FontWeight.w800 : FontWeight.w500)));
                }));
              }).toList(),
            ),
          ),
        );
      }

      case 'bars': {
        final items = List<Map<String, dynamic>>.from(block['items'] ?? []);
        if (items.isEmpty) return const SizedBox.shrink();
        final max = items.fold<double>(1, (m, i) {
          final v = ((i['max'] ?? i['value']) as num?)?.toDouble() ?? 0;
          return v > m ? v : m;
        });
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Column(
            children: items.map((i) {
              final v = ((i['value'] as num?)?.toDouble() ?? 0) / max;
              return Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(children: [
                  SizedBox(width: 84,
                      child: Text(i['label'].toString(), overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700))),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: v.clamp(0.01, 1.0), minHeight: 8,
                        backgroundColor: const Color(0xFFEEF2F7),
                        valueColor: AlwaysStoppedAnimation(_hex(i['color']?.toString()) ?? T.orange),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(width: 66,
                      child: Text(_val(i['text'] ?? i['value']), textAlign: TextAlign.end,
                          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900))),
                ]),
              );
            }).toList(),
          ),
        );
      }

      case 'timeline': {
        final items = List<Map<String, dynamic>>.from(block['items'] ?? []);
        if (items.isEmpty) return const SizedBox.shrink();
        final cap = (block['label'] ?? '').toString();
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
            if (cap.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(cap, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w900, color: T.inkSoft)),
              ),
            ...items.map((i) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 5),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Container(width: 8, height: 8, margin: const EdgeInsets.only(top: 5),
                    decoration: BoxDecoration(
                        color: _hex(i['color']?.toString()) ?? T.orange, shape: BoxShape.circle)),
                const SizedBox(width: 9),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(i['title'].toString(), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
                    if ((i['sub'] ?? '').toString().isNotEmpty)
                      Text(i['sub'].toString(), style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                  ]),
                ),
                Text((i['at'] ?? '').toString(), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
              ]),
            )),
          ]),
        );
      }

      // The tinted lead panel at the head of a formal document.
      case 'callout': {
        final lines = List<dynamic>.from(block['lines'] ?? []);
        final title = (block['title'] ?? '').toString();
        if (lines.isEmpty && title.isEmpty) return const SizedBox.shrink();
        return Container(
          width: double.infinity,
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: const Color(0xFFFFF7F0),
            border: Border.all(color: T.orange.withValues(alpha: 0.35)),
            borderRadius: BorderRadius.circular(9),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (title.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(title, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w900, color: T.orange)),
              ),
            ...lines.map((l) {
              final pair = List<dynamic>.from(l as List);
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(child: Text(pair[0].toString(), style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
                  const SizedBox(width: 12),
                  Flexible(
                    child: Text(_val(pair.length > 1 ? pair[1] : null), textAlign: TextAlign.end,
                        style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                  ),
                ]),
              );
            }),
          ]),
        );
      }

      // Ruled lines to sign on — drawn on screen as well as in the PDF, so the
      // preview stays the same document rather than an approximation of it.
      case 'signatures': {
        final items = List<Map<String, dynamic>>.from(block['items'] ?? []);
        if (items.isEmpty) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.only(top: 26, bottom: 6),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: items.map((i) => Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6),
              child: Column(children: [
                Container(height: 34, decoration: const BoxDecoration(
                    border: Border(top: BorderSide(color: T.inkFaint)))),
                const SizedBox(height: 5),
                Text((i['name'] ?? '').toString(), textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w900)),
                Text((i['title'] ?? '').toString(), textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 10, color: T.inkSoft)),
              ]),
            ),
          )).toList()),
        );
      }

      case 'note': {
        const bg = {'info': Color(0xFFF1F5F9), 'warn': Color(0xFFFEF3C7), 'danger': Color(0xFFFEE2E2), 'ok': Color(0xFFDCFCE7)};
        const fg = {'info': T.inkSoft, 'warn': Color(0xFF92400E), 'danger': Color(0xFF991B1B), 'ok': Color(0xFF166534)};
        final tone = (block['tone'] ?? 'info').toString();
        return Container(
          width: double.infinity,
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
          decoration: BoxDecoration(color: bg[tone] ?? bg['info'], borderRadius: BorderRadius.circular(8)),
          child: Text(block['text'].toString(),
              style: TextStyle(fontSize: 11.5, color: fg[tone] ?? T.inkSoft, height: 1.5)),
        );
      }

      case 'spacer':
        return SizedBox(height: ((block['h'] as num?) ?? 10).toDouble());

      default:
        return const SizedBox.shrink();
    }
  }
}
