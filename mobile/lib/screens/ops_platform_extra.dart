import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'ops_common.dart';

/// Operations platform, what the generic table does not cover: the shipments page with its filters and counts, shipment details with status update and history, and customer and driver profiles with their shipment history. Counterpart of /system/ops/shipments, /ops/users/[id] and /ops/drivers/[id].

const _opsAdminRoles = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'operations_manager', 'operations_team_leader'];

/// Who may write to the platform, same as isOpsAdmin in lib/ops.ts.
bool isOpsAdmin(AuthProvider a) => _opsAdminRoles.contains(a.role) || a.canEditSection('Operations Platform');

String opsDriverName(Map s) {
  final d = s['driver'];
  if (d is! Map) return '—';
  final n = opsLoc(d['admin'] is Map ? d['admin']['name'] : null);
  final m = n.isNotEmpty ? n : opsLoc(d['name']);
  return m.isEmpty ? '—' : m;
}

String opsDriverPhone(Map s) {
  final d = s['driver'];
  if (d is! Map) return '';
  return '${(d['admin'] is Map ? d['admin']['phone'] : null) ?? d['phone'] ?? ''}';
}

String opsCarOwnerName(Map s) {
  final o = s['car'] is Map ? s['car']['owner'] : null;
  if (o is! Map) return '—';
  final n = '${o['owner_name'] ?? ''}';
  if (n.isNotEmpty) return n;
  final m = opsLoc(o['owner'] is Map ? o['owner']['name'] : null);
  return m.isEmpty ? '—' : m;
}

String _relName(dynamic v) => v is Map ? opsLoc(v['name']) : '';

/// Who performed the step and its note, same as timelineMeta (admin may be null, details may be an object).
(String, String) _timelineMeta(Map ev) {
  final details = ev['details'];
  var who = opsLoc(ev['admin'] is Map ? ev['admin']['name'] : null);
  if (who.isEmpty) who = opsLoc(ev['admin']);
  if (who.isEmpty && details is Map) who = opsLoc(details['admin']);
  var note = '';
  if (details is String) {
    note = details.trim();
  } else if (details is Map) {
    final cand = details['reason'] ?? details['note'] ?? details['message'] ?? details['text'] ?? details['description'] ?? details['comment'];
    if (cand is String || cand is num) {
      note = '$cand'.trim();
    } else if (cand is Map) {
      note = opsLoc(cand);
    }
  }
  return (who, note);
}

/// Shipment search fields: general search is fuzzy, while the two unique numbers are matched literally.
const _searchFields = [
  ('', 'الكل', 'Anything'),
  ('graduation', 'رقم أمر النقل', 'Graduation statement #'),
  ('reference', 'رقم المرجع', 'Reference #'),
  ('driver_name', 'اسم السائق', 'Driver name'),
  ('driver_phone', 'هاتف السائق', 'Driver phone'),
  ('car_number', 'رقم السيارة', 'Car number'),
  ('car_name', 'اسم السيارة', 'Car name'),
  ('user_name', 'اسم العميل', 'Customer name'),
  ('user_phone', 'هاتف العميل', 'Customer phone'),
  ('truck_type_name', 'نوع الشاحنة', 'Truck type'),
  ('load_type_name', 'نوع الحمولة', 'Load type'),
];

List<(String, String)> _searchParams(String q, String field) {
  if (q.isEmpty) return const [];
  if (field == 'graduation' || field == 'reference' || field.isEmpty) return [('search', q)];
  return [(field, q)];
}

List<Map<String, dynamic>> _exact(List<Map<String, dynamic>> list, String q, String field) {
  if (q.isEmpty) return list;
  if (field == 'graduation') return list.where((s) => '${s['graduation_statement_num']}' == q).toList();
  if (field == 'reference') return list.where((s) => '${s['reference_num']}' == q).toList();
  return list;
}

Future<List<Map<String, dynamic>>> _loadBranches() async {
  try {
    final d = await Api.instance.get('/api/ops/branches?limit=100&lang=${Lang.instance.ar ? 'ar' : 'en'}');
    return List<Map<String, dynamic>>.from((d['items'] ?? const []) as List);
  } catch (_) {
    return const [];
  }
}

// Shipments
class OpsShipmentsScreen extends StatefulWidget {
  final String? initialStatus;
  const OpsShipmentsScreen({super.key, this.initialStatus});
  @override
  State<OpsShipmentsScreen> createState() => _OpsShipmentsScreenState();
}

class _OpsShipmentsScreenState extends State<OpsShipmentsScreen> {
  List<Map<String, dynamic>> _items = [];
  Map<String, dynamic>? _meta;
  bool _loaded = false;
  bool _loading = true;
  bool _stale = false;
  int _page = 1;
  String _q = '';
  // Search while typing with a short debounce; the controller is owned by the screen so the text is not lost if the field leaves the screen.
  final _searchCtl = TextEditingController();
  Timer? _debounce;
  String _field = '';
  late final Set<String> _statuses = {if (widget.initialStatus != null) widget.initialStatus!};
  DateTime? _from;
  DateTime? _to;
  String _branch = '';
  List<Map<String, dynamic>> _branches = [];
  Map<String, num> _counts = {};
  String _countsState = 'loading'; // loading | ok | error
  int _seq = 0;
  int _cseq = 0;
  late final void Function() _onChanged;
  late final void Function(dynamic) _onStats;

  @override
  void initState() {
    super.initState();
    _loadBranches().then((b) { if (mounted) setState(() => _branches = b); });
    _load();
    _loadCounts();
    _onChanged = () { _load(); _loadCounts(); };
    _onStats = (stats) {
      if (_branch.isNotEmpty || _from != null || _to != null || !mounted) return;
      final map = <String, num>{};
      for (final s in (stats is Map ? (stats['statusesShipmentsChart'] as List?) : null) ?? const []) {
        if (s is Map) map['${s['status']}'] = num.tryParse('${s['count']}') ?? 0;
      }
      if (map.isNotEmpty) setState(() { _counts = {..._counts, ...map}; _countsState = 'ok'; });
    };
    Live.instance.on('ops:shipments:changed', _onChanged);
    Live.instance.onData('ops:stats', _onStats);
  }

  @override
  void dispose() {
    Live.instance.off('ops:shipments:changed', _onChanged);
    Live.instance.offData('ops:stats', _onStats);
    _debounce?.cancel();
    _searchCtl.dispose();
    super.dispose();
  }

  List<(String, String)> _filterParams() => [
        ..._searchParams(_q, _field),
        for (final s in _statuses) ('status', s),
        if (_from != null) ('date_from', opsYmd(_from!)),
        if (_to != null) ('date_to', opsYmd(_to!)),
        if (_branch.isNotEmpty) ('branches', _branch),
      ];

  String _listUrl(int page, int limit) =>
      '/api/ops/shipments?${opsQs([('page', '$page'), ('limit', '$limit'), ('lang', Lang.instance.ar ? 'ar' : 'en'), ..._filterParams()])}&sort%5Bupdated_at%5D=desc';

  Future<void> _load() async {
    final mine = ++_seq;
    if (mounted) setState(() => _loading = true);
    try {
      final d = await Api.instance.get(_listUrl(_page, 25));
      if (!mounted || mine != _seq) return;
      setState(() {
        _items = _exact(List<Map<String, dynamic>>.from((d['items'] ?? const []) as List), _q, _field);
        _meta = d['meta'] is Map ? Map<String, dynamic>.from(d['meta']) : null;
        _stale = false;
      });
    } catch (_) {
      // A platform failure does not empty what is displayed.
      if (mounted && mine == _seq) setState(() => _stale = true);
    }
    if (mounted && mine == _seq) setState(() { _loading = false; _loaded = true; });
  }

  Future<void> _loadCounts({bool retried = false}) async {
    final mine = ++_cseq;
    try {
      final qs = [('lang', Lang.instance.ar ? 'ar' : 'en'), if (_branch.isNotEmpty) ('branches', _branch), if (_from != null) ('date_from', opsYmd(_from!)), if (_to != null) ('date_to', opsYmd(_to!))];
      final dash = await Api.instance.get('/api/ops/dashboard?${opsQs(qs)}');
      if (!mounted || mine != _cseq) return;
      final filtered = _branch.isNotEmpty || _from != null || _to != null;
      final home = dash['home'] is Map ? dash['home']['stats'] : null;
      final chart = dash['stats'] is Map ? dash['stats']['statusesShipmentsChart'] : null;
      final src = (filtered ? chart : ((home is List && home.isNotEmpty) ? home : chart)) as List? ?? const [];
      final map = <String, num>{};
      for (final s in src) {
        if (s is Map) map['${s['status']}'] = num.tryParse('${s['count']}') ?? 0;
      }
      setState(() {
        if (map.isNotEmpty) _counts = map;
        _countsState = dash['upstreamUnavailable'] == true || map.isEmpty ? 'error' : 'ok';
      });
      // The server replied with its last known numbers while fetching fresh ones; ask once more.
      if (dash['stale'] == true && !retried) {
        Future.delayed(const Duration(milliseconds: 2500), () { if (mounted) _loadCounts(retried: true); });
      }
    } catch (_) {
      if (mounted && mine == _cseq) setState(() => _countsState = 'error');
    }
  }

  void _refilter() { _page = 1; _load(); }
  void _refilterAll() { _page = 1; _load(); _loadCounts(); }

  num get _allCount => _counts['all'] ?? _counts.values.fold<num>(0, (a, b) => a + b);

  /// Exporting all results is refetched in pages of 100 (up to 30 pages), as on the web.
  Future<List<Map<String, dynamic>>> _fetchAllFiltered() async {
    final out = <Map<String, dynamic>>[];
    for (var p = 1; p <= 30; p++) {
      final d = await Api.instance.get(_listUrl(p, 100));
      final items = List<Map<String, dynamic>>.from((d['items'] ?? const []) as List);
      out.addAll(items);
      final tp = d['meta'] is Map ? ((d['meta']['totalPages'] ?? 1) as num).toInt() : 1;
      if (items.isEmpty || p >= tp) break;
    }
    return _exact(out, _q, _field);
  }

  List<ExportCol> get _exportCols => [
        ExportCol('أمر النقل', 'Statement #', (r) => r['graduation_statement_num'] ?? ''),
        ExportCol('رقم المرجع', 'Reference #', (r) => r['reference_num'] ?? ''),
        ExportCol('الحالة', 'Status', (r) => opsStatusLabel(r['status'])),
        ExportCol('من', 'From', (r) => r['address_from'] ?? ''),
        ExportCol('إلى', 'To', (r) => r['address_to'] ?? ''),
        ExportCol('السائق', 'Driver', (r) => opsDriverName(r)),
        ExportCol('هاتف السائق', 'Driver phone', (r) => opsDriverPhone(r).isEmpty ? '—' : opsDriverPhone(r)),
        ExportCol('رقم السيارة', 'Car #', (r) => r['car'] is Map ? (r['car']['car_number'] ?? '') : ''),
        ExportCol('مالك السيارة', 'Car owner', (r) => opsCarOwnerName(r)),
        ExportCol('العميل', 'Customer', (r) => _relName(r['user']).isEmpty ? '—' : _relName(r['user'])),
        ExportCol('الفرع', 'Branch', (r) => _relName(r['branch']).isEmpty ? '—' : _relName(r['branch'])),
        ExportCol('البيع', 'Selling', (r) => r['selling_price'] is num ? r['selling_price'] : (num.tryParse('${r['selling_price'] ?? ''}') ?? '—')),
        ExportCol('الدفع', 'Pay', (r) => opsPayMethodLabel(r['payment_method'])),
        ExportCol('الإنشاء', 'Created', (r) => opsDateTime(r['created_at'])),
      ];

  Future<void> _export() => opsExportMenu(context, [
        (tr('الصفحة المعروضة', 'Current page'), () async => exportExcel(context, fileName: 'ops-shipments', sheets: [(tr('الشحنات', 'Shipments'), _exportCols, _items)])),
        (tr('كلّ ما طابق الفلتر (${_meta?['totalItems'] ?? _items.length})', 'Everything matching (${_meta?['totalItems'] ?? _items.length})'), () async {
          final messenger = ScaffoldMessenger.of(context);
          messenger.showSnackBar(SnackBar(content: Text(tr('جارٍ جلب الصفوف…', 'Fetching rows…'))));
          try {
            final rows = await _fetchAllFiltered();
            if (mounted) exportExcel(context, fileName: 'ops-shipments', sheets: [(tr('الشحنات', 'Shipments'), _exportCols, rows)]);
          } catch (e) {
            messenger.showSnackBar(SnackBar(content: Text(opsErr(e))));
          }
        }),
      ]);

  Future<void> _pickDate(bool from) async {
    final d = await showDatePicker(context: context, initialDate: (from ? _from : _to) ?? DateTime.now(), firstDate: DateTime(2018), lastDate: DateTime(DateTime.now().year + 2));
    if (d == null) return;
    setState(() { if (from) { _from = d; } else { _to = d; } });
    _refilterAll();
  }

  @override
  Widget build(BuildContext context) {
    final totalPages = ((_meta?['totalPages'] ?? 1) as num).toInt();
    final hasCounts = _counts.isNotEmpty;
    final selectedTotal = _statuses.isEmpty ? _allCount : _statuses.fold<num>(0, (a, s) => a + (_counts[s] ?? 0));
    return AppScaffold(
      title: Text(tr('الشحنات', 'Shipments')),
      actions: [
        IconButton(tooltip: tr('تصدير Excel', 'Export'), icon: const Icon(Icons.file_download_outlined), onPressed: _export),
        IconButton(tooltip: tr('تحديث', 'Refresh'), icon: const Icon(Icons.refresh), onPressed: () { _load(); _loadCounts(); }),
      ],
      body: !_loaded
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : RefreshIndicator(
              onRefresh: () async { await Future.wait([_load(), _loadCounts()]); },
              child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, padding: const EdgeInsets.fromLTRB(14, 10, 14, 24), children: [
                Text('${opsMoney(_meta?['totalItems'] ?? _items.length)} ${tr('الإجمالي', 'Total')} · ${tr('مباشر', 'Live')}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                if (_stale) _banner(tr('تعذّر تحديث البيانات — معروض آخر نسخة محفوظة، وجاري إعادة المحاولة…', 'Could not refresh — showing last known data, retrying…')),
                if (_countsState == 'error')
                  _banner(hasCounts ? tr('تعذّر تحديث الأعداد من منصّة التشغيل — المعروض آخرُ أرقامٍ وصلت.', 'Could not refresh counts — showing the last numbers.')
                      : tr('تعذّر جلب أعداد الحالات من منصّة التشغيل.', 'Could not fetch status counts.'),
                      action: TextButton(onPressed: _loadCounts, child: Text(tr('إعادة المحاولة', 'Retry')))),
                const SizedBox(height: 6),
                // Status cards: multi-select. The bar height grows with the font size instead of a fixed height that overflows.
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    _statusCard('', tr('الكل', 'All'), hasCounts ? opsMoney(_allCount) : (_countsState == 'loading' ? '…' : '—'), T.ink, _statuses.isEmpty, () { setState(_statuses.clear); _refilter(); }),
                    for (final e in opsAppStatuses.entries)
                      _statusCard(e.key, tr(e.value.$1, e.value.$2), hasCounts ? opsMoney(_counts[e.key] ?? 0) : (_countsState == 'loading' ? '…' : '—'), e.value.$3, _statuses.contains(e.key), () {
                        setState(() { if (!_statuses.remove(e.key)) _statuses.add(e.key); });
                        _refilter();
                      }),
                  ])),
                ),
                if (_statuses.isNotEmpty)
                  Row(children: [
                    Text('${tr('محدد', 'Selected')}: ${_statuses.length} · ${tr('إجمالي', 'total')} ${opsMoney(selectedTotal)}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                    TextButton(onPressed: () { setState(_statuses.clear); _refilter(); }, child: Text(tr('مسح', 'clear'))),
                  ]),
                const SizedBox(height: 6),
                // Search and filters
                Row(children: [
                  SizedBox(
                    width: 130,
                    child: DropdownButtonFormField<String>(
                      initialValue: _field,
                      isExpanded: true,
                      decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 10)),
                      items: [for (final f in _searchFields) DropdownMenuItem(value: f.$1, child: Text(tr(f.$2, f.$3), style: const TextStyle(fontSize: 12), overflow: TextOverflow.ellipsis))],
                      onChanged: (v) { setState(() => _field = v ?? ''); if (_q.isNotEmpty) _refilter(); },
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: SearchField(
                      controller: _searchCtl, dense: true,
                      hint: '${tr('ابحث', 'Search')}: ${tr(_searchFields.firstWhere((f) => f.$1 == _field).$2, _searchFields.firstWhere((f) => f.$1 == _field).$3)}…',
                      onChanged: (v) {
                        _debounce?.cancel();
                        _debounce = Timer(const Duration(milliseconds: 350), () { if (mounted && v.trim() != _q) { _q = v.trim(); _refilter(); } });
                      },
                    ),
                  ),
                ]),
                const SizedBox(height: 6),
                Row(children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _branch,
                      isExpanded: true,
                      decoration: InputDecoration(labelText: tr('الفرع', 'Branch'), isDense: true),
                      items: [
                        DropdownMenuItem(value: '', child: Text(tr('كل الفروع', 'All branches'))),
                        for (final b in _branches) DropdownMenuItem(value: '${b['id']}', child: Text(opsLoc(b['name']), overflow: TextOverflow.ellipsis)),
                      ],
                      onChanged: (v) { setState(() => _branch = v ?? ''); _refilterAll(); },
                    ),
                  ),
                  const SizedBox(width: 6),
                  OutlinedButton(onPressed: () => _pickDate(true), child: Text(_from == null ? tr('من', 'From') : opsDate(opsYmd(_from!)), style: const TextStyle(fontSize: 12))),
                  const SizedBox(width: 4),
                  OutlinedButton(onPressed: () => _pickDate(false), child: Text(_to == null ? tr('إلى', 'To') : opsDate(opsYmd(_to!)), style: const TextStyle(fontSize: 12))),
                  if (_from != null || _to != null || _branch.isNotEmpty)
                    IconButton(tooltip: tr('مسح', 'Clear'), onPressed: () { setState(() { _from = null; _to = null; _branch = ''; }); _refilterAll(); }, icon: const Icon(Icons.close, size: 18)),
                ]),
                if (_loading) const Padding(padding: EdgeInsets.only(top: 6), child: LinearProgressIndicator(minHeight: 2)),
                const SizedBox(height: 8),
                if (_items.isEmpty) EmptyState(icon: Icons.local_shipping_outlined, title: _q.isNotEmpty ? tr('لا نتائج مطابقة للبحث', 'No matches') : tr('لا توجد سجلات', 'No records')),
                for (final r in _items) Padding(padding: const EdgeInsets.only(bottom: 8), child: OpsShipmentCard(row: r, onChanged: _load)),
                if (totalPages > 1)
                  Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                    IconButton(onPressed: _page > 1 ? () { _page--; _load(); } : null, icon: Icon(Lang.instance.ar ? Icons.chevron_right : Icons.chevron_left)),
                    Text('$_page / $totalPages', style: const TextStyle(fontWeight: FontWeight.w800)),
                    IconButton(onPressed: _page < totalPages ? () { _page++; _load(); } : null, icon: Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right)),
                  ]),
              ]),
            ),
    );
  }

  Widget _banner(String text, {Widget? action}) => Container(
        margin: const EdgeInsets.only(top: 6),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(color: T.warn.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10), border: Border.all(color: T.warn.withValues(alpha: 0.3))),
        child: Row(children: [Expanded(child: Text(text, style: const TextStyle(fontSize: 11.5, color: T.warn))), if (action != null) action]),
      );

  Widget _statusCard(String key, String label, String n, Color color, bool on, VoidCallback onTap) => Padding(
        padding: const EdgeInsetsDirectional.only(end: 6),
        child: Pressable(
          onTap: onTap,
          child: Container(
            width: 100,
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(
              color: on ? (key.isEmpty ? T.ink : color.withValues(alpha: 0.12)) : Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: on ? (key.isEmpty ? T.ink : color) : T.line, width: on ? 1.5 : 1),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(n, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: on && key.isEmpty ? Colors.white : T.ink)),
              Row(children: [
                if (key.isNotEmpty) Container(width: 6, height: 6, margin: const EdgeInsetsDirectional.only(end: 4), decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
                Flexible(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 10.5, color: on && key.isEmpty ? Colors.white : T.inkSoft))),
              ]),
            ]),
          ),
        ),
      );
}

/// Shipment row: tap to open its full details.
class OpsShipmentCard extends StatelessWidget {
  final Map<String, dynamic> row;
  final VoidCallback? onChanged;
  const OpsShipmentCard({super.key, required this.row, this.onChanged});

  @override
  Widget build(BuildContext context) {
    final r = row;
    final st = opsAppStatuses['${r['status'] ?? ''}'];
    return Pressable(
      onTap: () async {
        final changed = await showOpsShipmentDetail(context, r);
        if (changed == true) onChanged?.call();
      },
      child: AppCard(
        topAccent: st?.$3,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text('${r['graduation_statement_num'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
            if (st != null) Chip2(tr(st.$1, st.$2), st.$3),
          ]),
          const SizedBox(height: 3),
          Text('${r['address_from'] ?? '—'} ← ${r['address_to'] ?? '—'}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
          const SizedBox(height: 3),
          Text([
            opsDriverName(r),
            if (r['car'] is Map && '${r['car']['car_number'] ?? ''}'.isNotEmpty) r['car']['car_number'],
            if (_relName(r['user']).isNotEmpty) _relName(r['user']),
            if (_relName(r['branch']).isNotEmpty) _relName(r['branch']),
          ].join(' · '), maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
          const SizedBox(height: 4),
          Wrap(spacing: 6, runSpacing: 4, children: [
            if (r['selling_price'] != null) Chip2('${opsMoney(r['selling_price'])} ${tr('ر.س', 'SAR')}', T.violet),
            if ('${r['payment_method'] ?? ''}'.isNotEmpty) Chip2(opsPayMethodLabel(r['payment_method']), T.info),
            Chip2(opsDateTime(r['created_at']), T.inkFaint, icon: Icons.schedule),
          ]),
        ]),
      ),
    );
  }
}

/// Full shipment details, with status update for platform writers and the status history.
Future<bool?> showOpsShipmentDetail(BuildContext context, Map<String, dynamic> row) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (c) => _ShipmentDetail(row: row),
  );
}

class _ShipmentDetail extends StatefulWidget {
  final Map<String, dynamic> row;
  const _ShipmentDetail({required this.row});
  @override
  State<_ShipmentDetail> createState() => _ShipmentDetailState();
}

class _ShipmentDetailState extends State<_ShipmentDetail> {
  late Map<String, dynamic> d = Map<String, dynamic>.from(widget.row);
  List<Map>? _timeline;
  late String _newStatus = '${d['status'] ?? ''}';
  bool _saving = false;
  bool _changed = false;

  @override
  void initState() {
    super.initState();
    _loadTimeline();
  }

  Future<void> _loadTimeline() async {
    try {
      final qs = [
        if (d['created_by'] != null) ('created_by', '${d['created_by']}'),
        if (d['creator_type'] != null) ('creator_type', '${d['creator_type']}'),
        if (d['created_at'] != null) ('created_at', '${d['created_at']}'),
      ];
      final t = await Api.instance.get('/api/ops/shipments/timeline/${d['id']}${qs.isEmpty ? '' : '?${opsQs(qs)}'}');
      final list = t is List ? t : (t is Map ? (t['items'] ?? t['timeline'] ?? const []) : const []);
      if (mounted) setState(() => _timeline = List<Map>.from((list as List).whereType<Map>()));
    } catch (_) {
      if (mounted) setState(() => _timeline = const []);
    }
  }

  Future<void> _apply() async {
    if (_newStatus.isEmpty || _newStatus == d['status']) return;
    setState(() => _saving = true);
    try {
      await Api.instance.patch('/api/ops/shipments/status', {'status': _newStatus, 'ids': [d['id']]});
      if (!mounted) return;
      setState(() { d['status'] = _newStatus; _changed = true; });
      _loadTimeline();
    } catch (e) {
      if (mounted) opsSnack(context, opsErr(e), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _section(String title, List<(String, String)> rows) => Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(title, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.orange)),
          const SizedBox(height: 6),
          for (final r in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 5),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                SizedBox(width: 120, child: Text(r.$1, style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
                Expanded(child: Text(r.$2.isEmpty ? '—' : r.$2, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
              ]),
            ),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final admin = isOpsAdmin(context.read<AuthProvider>());
    final car = d['car'] is Map ? d['car'] as Map : const {};
    final owner = car['owner'] is Map ? car['owner'] as Map : const {};
    final drv = d['driver'] is Map ? d['driver'] as Map : const {};
    final user = d['user'] is Map ? d['user'] as Map : const {};
    final delegate = d['delegate'] is Map ? d['delegate'] as Map : const {};
    final creator = (_timeline ?? const []).where((e) => e['status'] == 'requesting').map((e) => opsLoc(e['admin'] is Map ? e['admin']['name'] : null)).firstOrNull ?? '';
    String m(dynamic v) => v == null || '$v'.isEmpty ? '' : opsMoney(v);
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) { if (!didPop) Navigator.pop(context, _changed); },
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.9,
        maxChildSize: 0.95,
        builder: (c, scroll) => ListView(controller: scroll, padding: const EdgeInsets.fromLTRB(16, 14, 16, 30), children: [
          Text('${tr('شحنة · أمر نقل', 'Shipment · Statement')} ${d['graduation_statement_num'] ?? ''}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          if (admin) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(12), border: Border.all(color: T.line)),
              child: Row(children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: opsAppStatuses.containsKey(_newStatus) ? _newStatus : null,
                    isExpanded: true,
                    decoration: InputDecoration(labelText: tr('تحديث الحالة', 'Update Status'), isDense: true),
                    items: [for (final e in opsAppStatuses.entries) DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))],
                    onChanged: (v) => setState(() => _newStatus = v ?? ''),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: _saving || _newStatus == d['status'] ? null : _apply,
                  child: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(tr('حفظ', 'Save')),
                ),
              ]),
            ),
          ],
          _section(tr('بيانات الشحنة', 'Shipment'), [
            (tr('رقم أمر النقل', 'Statement #'), '${d['graduation_statement_num'] ?? ''}'),
            (tr('رقم المرجع', 'Reference #'), '${d['reference_num'] ?? ''}'),
            (tr('الحالة', 'Status'), opsStatusLabel(d['status'])),
            (tr('نوع المُنشئ', 'Creator type'), '${d['creator_type'] ?? ''}'),
            (tr('أنشأها', 'Created by'), creator.isNotEmpty ? creator : (_timeline == null ? '…' : '')),
            (tr('الكمية', 'Qty'), '${d['qty'] ?? ''}'),
            (tr('قيمة البضائع', 'Goods value'), m(d['goods_value_price'])),
          ]),
          _section(tr('المسار والتوقيت', 'Route & timing'), [
            (tr('من', 'From'), '${d['address_from'] ?? ''}'),
            (tr('إلى', 'To'), '${d['address_to'] ?? ''}'),
            (tr('الفرع', 'Branch'), _relName(d['branch'])),
            (tr('وقت التحميل', 'Pick time'), d['pick_time'] == null ? '' : opsDateTime(d['pick_time'])),
            (tr('وقت البدء', 'Start time'), d['starting_time'] == null ? '' : opsDateTime(d['starting_time'])),
            (tr('وقت الوصول', 'Access time'), d['access_time'] == null ? '' : opsDateTime(d['access_time'])),
          ]),
          _section(tr('الأسعار', 'Pricing'), [
            (tr('سعر البيع', 'Selling'), m(d['selling_price'])),
            (tr('سعر الشراء', 'Purchase'), m(d['purchase_price'])),
            (tr('الدفعة المقدمة', 'Advance'), m(d['advance'])),
            (tr('طريقة الدفع', 'Payment'), '${d['payment_method'] ?? ''}'),
            (tr('أجرة السائق', 'Driver rental'), '${m(d['driver_rental_price'])}${d['driver_rental_type'] != null ? ' (${d['driver_rental_type']})' : ''}'),
          ]),
          _section(tr('السائق', 'Driver'), [
            (tr('الاسم', 'Name'), opsDriverName(d)),
            (tr('الهاتف', 'Phone'), opsDriverPhone(d)),
            (tr('الجنسية', 'Nationality'), '${drv['nationality'] ?? ''}'),
            (tr('رقم الإقامة', 'Residence #'), '${drv['residence_number'] ?? ''}'),
            (tr('رقم بطاقة السائق', 'Driver card #'), '${drv['driver_card_number'] ?? ''}'),
          ]),
          if (opsDriverPhone(d).isNotEmpty)
            Align(alignment: AlignmentDirectional.centerStart, child: TextButton.icon(onPressed: () => launchUrl(Uri.parse('tel:${opsDriverPhone(d)}')), icon: const Icon(Icons.call, size: 16), label: Text(opsDriverPhone(d)))),
          _section(tr('المركبة', 'Vehicle'), [
            (tr('اسم المركبة', 'Car name'), opsLoc(car['name'])),
            (tr('رقم السيارة', 'Car number'), '${car['car_number'] ?? ''}'),
            (tr('رقم اللوحة', 'Plate'), '${car['plate_number'] ?? ''}'),
            (tr('موديل', 'Model year'), '${car['car_model_year'] ?? ''}'),
            (tr('نوع الشاحنة', 'Truck type'), _relName(d['truck_type'])),
            (tr('حجم الشاحنة', 'Truck size'), _relName(d['truck_size'])),
            (tr('نوع الحمولة', 'Load type'), _relName(d['load_type'])),
          ]),
          _section(tr('مالك المركبة', 'Car owner'), [
            (tr('الاسم', 'Name'), opsCarOwnerName(d)),
            (tr('الهاتف', 'Phone'), '${owner['owner_phone'] ?? ''}'),
            (tr('المدير', 'Manager'), '${owner['manager_name'] ?? ''}'),
            (tr('شروط الدفع', 'Payment terms'), '${owner['payment_terms'] ?? ''}'),
          ]),
          _section(tr('العميل والمندوب', 'Customer & delegate'), [
            (tr('العميل', 'Customer'), opsLoc(user['name'])),
            (tr('هاتف العميل', 'Customer phone'), '${user['phone'] ?? ''}'),
            (tr('نوع العميل', 'Customer type'), '${user['user_type'] ?? ''}'),
            (tr('المندوب', 'Delegate'), opsLoc(delegate['name'])),
            (tr('هاتف المندوب', 'Delegate phone'), '${delegate['phone'] ?? ''}'),
          ]),
          if ('${d['notes'] ?? ''}'.isNotEmpty) _section(tr('ملاحظات', 'Notes'), [('', '${d['notes']}')]),
          _section(tr('التواريخ', 'Timestamps'), [
            (tr('الإنشاء', 'Created'), opsDateTime(d['created_at'])),
            (tr('آخر تحديث', 'Updated'), opsDateTime(d['updated_at'])),
          ]),
          const SizedBox(height: 14),
          Row(children: [
            const Icon(Icons.schedule, size: 16, color: T.orange),
            const SizedBox(width: 6),
            Text(tr('سجل الحالة', 'Status Timeline'), style: const TextStyle(fontWeight: FontWeight.w800)),
          ]),
          const SizedBox(height: 8),
          if (_timeline == null)
            Text(tr('جاري التحميل…', 'Loading…'), style: const TextStyle(color: T.inkFaint))
          else if (_timeline!.isEmpty)
            const Text('—', style: TextStyle(color: T.inkFaint))
          else
            for (final ev in _timeline!)
              Builder(builder: (_) {
                final st = opsAppStatuses['${ev['status'] ?? ''}'];
                final when = ev['created_at'] ?? ev['date'] ?? ev['time'];
                final done = when != null && '$when'.isNotEmpty;
                final (who, note) = _timelineMeta(ev);
                return Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Column(children: [
                      Container(width: 12, height: 12, decoration: BoxDecoration(color: done ? (st?.$3 ?? T.inkFaint) : T.line, shape: BoxShape.circle)),
                      Container(width: 2, height: 36, color: T.line),
                    ]),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(st != null ? tr(st.$1, st.$2) : '${ev['label'] ?? ev['status'] ?? ''}',
                            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: done ? T.ink : T.inkFaint)),
                        Text(done ? [opsDateTime(when), if (note.isNotEmpty) note, if (who.isNotEmpty) who].join(' · ') : tr('لم تتم بعد', 'not yet'),
                            style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                      ]),
                    ),
                  ]),
                );
              }),
        ]),
      ),
    );
  }
}

// Shipment history of a customer or driver, counterpart of OpsShipmentHistory
const _histSearch = [
  ('', 'الكل', 'Anything'), ('graduation', 'أمر النقل', 'Graduation #'), ('reference', 'رقم المرجع', 'Reference #'),
  ('driver_name', 'اسم السائق', 'Driver name'), ('driver_phone', 'هاتف السائق', 'Driver phone'),
  ('car_number', 'رقم السيارة', 'Car number'), ('user_name', 'اسم العميل', 'Customer name'),
];

class OpsShipmentHistory extends StatefulWidget {
  final String filterKey; // user_id | driver_id
  final String filterValue;
  const OpsShipmentHistory({super.key, required this.filterKey, required this.filterValue});
  @override
  State<OpsShipmentHistory> createState() => _OpsShipmentHistoryState();
}

class _OpsShipmentHistoryState extends State<OpsShipmentHistory> {
  Map<String, num> _counts = {};
  List<Map<String, dynamic>> _ships = [];
  Map? _meta;
  int _page = 1;
  String _status = '';
  String _q = '';
  final _searchCtl = TextEditingController();
  Timer? _debounce;
  String _field = '';
  int _seq = 0;
  late final void Function() _reload;
  late final void Function() _stats;

  String get _base => '${widget.filterKey}=${Uri.encodeQueryComponent(widget.filterValue)}';

  @override
  void initState() {
    super.initState();
    _loadStats();
    _loadShips();
    _reload = () { _loadShips(); _loadStats(); };
    _stats = () => _loadStats();
    Live.instance.on('ops:shipments:changed', _reload);
    Live.instance.on('ops:stats', _stats);
  }

  @override
  void dispose() {
    Live.instance.off('ops:shipments:changed', _reload);
    Live.instance.off('ops:stats', _stats);
    _debounce?.cancel();
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _loadStats() async {
    try {
      final res = await Future.wait([
        Api.instance.get('/api/ops/shipments?$_base&limit=1'),
        for (final k in opsAppStatuses.keys) Api.instance.get('/api/ops/shipments?$_base&status=$k&limit=1'),
      ]);
      num total(dynamic d) => d is Map && d['meta'] is Map ? (d['meta']['totalItems'] ?? 0) as num : 0;
      final c = <String, num>{'all': total(res[0])};
      var i = 1;
      for (final k in opsAppStatuses.keys) { c[k] = total(res[i++]); }
      if (mounted) setState(() => _counts = c);
    } catch (_) {}
  }

  Future<void> _loadShips() async {
    final mine = ++_seq;
    try {
      final qs = [
        (widget.filterKey, widget.filterValue), ('page', '$_page'), ('limit', '15'), ('lang', Lang.instance.ar ? 'ar' : 'en'),
        if (_status.isNotEmpty) ('status', _status),
        ..._searchParams(_q, _field),
      ];
      final d = await Api.instance.get('/api/ops/shipments?${opsQs(qs)}&sort%5Bupdated_at%5D=desc');
      if (!mounted || mine != _seq) return;
      setState(() {
        _ships = _exact(List<Map<String, dynamic>>.from((d['items'] ?? const []) as List), _q, _field);
        _meta = d['meta'] is Map ? d['meta'] as Map : null;
      });
    } catch (_) {}
  }

  void _refilter() { _page = 1; _loadShips(); }

  @override
  Widget build(BuildContext context) {
    final totalPages = ((_meta?['totalPages'] ?? 1) as num).toInt();
    final active = opsAppStatuses.entries.where((e) => (_counts[e.key] ?? 0) > 0).toList();
    Widget card(String key, String label, num n, Color color) {
      final on = _status == key;
      return Padding(
        padding: const EdgeInsetsDirectional.only(end: 6),
        child: Pressable(
          onTap: () { setState(() => _status = key); _refilter(); },
          child: Container(
            width: 104,
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(
              color: on ? (key.isEmpty ? T.ink : color.withValues(alpha: 0.12)) : Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: on ? (key.isEmpty ? T.ink : color) : T.line),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(opsMoney(n), style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: on && key.isEmpty ? Colors.white : T.ink)),
              Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 10.5, color: on && key.isEmpty ? Colors.white : T.inkSoft)),
            ]),
          ),
        ),
      );
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          card('', tr('إجمالي الشحنات', 'Total shipments'), _counts['all'] ?? 0, T.ink),
          for (final e in active) card(e.key, tr(e.value.$1, e.value.$2), _counts[e.key] ?? 0, e.value.$3),
        ])),
      ),
      const SizedBox(height: 8),
      Row(children: [
        SizedBox(
          width: 120,
          child: DropdownButtonFormField<String>(
            initialValue: _field,
            isExpanded: true,
            decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 10)),
            items: [for (final f in _histSearch) DropdownMenuItem(value: f.$1, child: Text(tr(f.$2, f.$3), style: const TextStyle(fontSize: 12), overflow: TextOverflow.ellipsis))],
            onChanged: (v) { setState(() => _field = v ?? ''); if (_q.isNotEmpty) _refilter(); },
          ),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: SearchField(
            controller: _searchCtl, dense: true,
            hint: tr('بحث في الشحنات…', 'Search shipments…'),
            onChanged: (v) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 350), () { if (mounted && v.trim() != _q) { _q = v.trim(); _refilter(); } });
            },
          ),
        ),
      ]),
      const SizedBox(height: 8),
      if (_ships.isEmpty) Padding(padding: const EdgeInsets.all(20), child: Center(child: Text(_q.isNotEmpty ? tr('لا نتائج مطابقة للبحث', 'No matches') : tr('لا توجد سجلات', 'No records'), style: const TextStyle(color: T.inkFaint)))),
      for (final s in _ships) Padding(padding: const EdgeInsets.only(bottom: 8), child: OpsShipmentCard(row: s, onChanged: _loadShips)),
      if (totalPages > 1)
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          IconButton(onPressed: _page > 1 ? () { _page--; _loadShips(); } : null, icon: Icon(Lang.instance.ar ? Icons.chevron_right : Icons.chevron_left)),
          Text('$_page / $totalPages', style: const TextStyle(fontWeight: FontWeight.w800)),
          IconButton(onPressed: _page < totalPages ? () { _page++; _loadShips(); } : null, icon: Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right)),
        ]),
    ]);
  }
}

// Customer profile, /system/ops/users/[id]
class OpsCustomerProfileScreen extends StatefulWidget {
  final String id;
  const OpsCustomerProfileScreen({super.key, required this.id});
  @override
  State<OpsCustomerProfileScreen> createState() => _OpsCustomerProfileScreenState();
}

class _OpsCustomerProfileScreenState extends State<OpsCustomerProfileScreen> {
  Map<String, dynamic>? _c;
  bool _loaded = false;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('ops:users:changed', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('ops:users:changed', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/ops/users/${widget.id}?lang=${Lang.instance.ar ? 'ar' : 'en'}');
      if (mounted) setState(() => _c = Map<String, dynamic>.from(d));
    } catch (_) {}
    if (mounted) setState(() => _loaded = true);
  }

  Future<void> _edit() async {
    final c = _c ?? const {};
    final ctrl = {
      'name': TextEditingController(text: opsLoc(c['name'])),
      'phone': TextEditingController(text: '${c['phone'] ?? ''}'),
      'email': TextEditingController(text: '${c['email'] ?? ''}'),
      'user_type': TextEditingController(text: '${c['user_type'] ?? ''}'),
      'address': TextEditingController(text: '${c['address'] ?? ''}'),
      'zip_code': TextEditingController(text: '${c['zip_code'] ?? ''}'),
    };
    var active = c['active'] == true;
    var verified = c['verified'] == true;
    String? err;
    bool saving = false;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sc) => StatefulBuilder(builder: (sc, set) {
        Widget f(String k, String ar, String en, {TextInputType? kb, String? hint}) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: TextField(controller: ctrl[k], keyboardType: kb, decoration: InputDecoration(labelText: tr(ar, en), hintText: hint, isDense: true)),
            );
        Future<void> save() async {
          if (ctrl['phone']!.text.trim().isEmpty) { set(() => err = tr('الهاتف مطلوب', 'Phone is required')); return; }
          set(() { saving = true; err = null; });
          try {
            final body = <String, dynamic>{
              'name': ctrl['name']!.text, 'phone': ctrl['phone']!.text, 'email': ctrl['email']!.text, 'user_type': ctrl['user_type']!.text,
              'address': ctrl['address']!.text, 'active': active ? 'true' : 'false', 'verified': verified ? 'true' : 'false',
            };
            final z = ctrl['zip_code']!.text.trim();
            if (z.isNotEmpty) body['zip_code'] = num.tryParse(z);
            await Api.instance.patch('/api/ops/users/${widget.id}', body);
            if (sc.mounted) Navigator.pop(sc);
            _load();
          } catch (e) {
            set(() { err = opsErr(e); saving = false; });
          }
        }
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 14, 16, MediaQuery.of(sc).viewInsets.bottom + 14),
            child: SingleChildScrollView(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
                Text(tr('تعديل العميل', 'Edit Customer'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
                if (err != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(err!, style: const TextStyle(color: T.danger))),
                const SizedBox(height: 10),
                f('name', 'الاسم', 'Name'),
                f('phone', 'الهاتف', 'Phone', kb: TextInputType.phone),
                f('email', 'البريد', 'Email', kb: TextInputType.emailAddress),
                f('user_type', 'النوع', 'Type', hint: 'individual / business'),
                f('address', 'العنوان', 'Address'),
                f('zip_code', 'الرمز البريدي', 'Zip', kb: TextInputType.number),
                SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(tr('مُفعّل', 'Active')), value: active, onChanged: (v) => set(() => active = v)),
                SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(tr('موثّق', 'Verified')), value: verified, onChanged: (v) => set(() => verified = v)),
                const SizedBox(height: 8),
                FilledButton(onPressed: saving ? null : save, child: saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(tr('حفظ', 'Save'))),
              ]),
            ),
          ),
        );
      }),
    );
    for (final t in ctrl.values) { t.dispose(); }
  }

  @override
  Widget build(BuildContext context) {
    final c = _c;
    final admin = isOpsAdmin(context.watch<AuthProvider>());
    final city = opsLoc(c?['city']);
    return AppScaffold(
      title: Text(tr('ملف العميل', 'Customer profile')),
      actions: [if (admin && c != null) IconButton(tooltip: tr('تعديل', 'Edit'), icon: const Icon(Icons.edit_outlined), onPressed: _edit)],
      body: !_loaded
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 110), SizedBox(height: 10), Shimmer()])
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(14), children: [
                AppCard(
                  topAccent: T.orange,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(opsLoc(c?['name']).isEmpty ? '—' : opsLoc(c?['name']), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 4),
                    Wrap(spacing: 6, runSpacing: 4, children: [
                      Chip2('${c?['user_type'] ?? '—'}', T.inkSoft),
                      if (c?['verified'] == true) Chip2(tr('✓ موثّق', '✓ Verified'), T.success),
                      c?['active'] == true ? Chip2(tr('✓ مُفعّل', '✓ Active'), T.success) : Chip2(tr('غير مُفعّل', 'Inactive'), T.inkFaint),
                    ]),
                    const SizedBox(height: 8),
                    if ('${c?['phone'] ?? ''}'.isNotEmpty)
                      TextButton.icon(onPressed: () => launchUrl(Uri.parse('tel:${c?['phone']}')), icon: const Icon(Icons.call, size: 16), label: Text('${c?['phone']}', textDirection: TextDirection.ltr)),
                    if ('${c?['email'] ?? ''}'.isNotEmpty)
                      TextButton.icon(onPressed: () => launchUrl(Uri.parse('mailto:${c?['email']}')), icon: const Icon(Icons.mail_outline, size: 16), label: Text('${c?['email']}')),
                    if (city.isNotEmpty || '${c?['address'] ?? ''}'.isNotEmpty)
                      Row(children: [const Icon(Icons.place_outlined, size: 16, color: T.inkFaint), const SizedBox(width: 4), Expanded(child: Text([city, '${c?['address'] ?? ''}'].where((x) => x.isNotEmpty).join(' · ')))]),
                    const SizedBox(height: 4),
                    Text('${tr('عميل منذ', 'Customer since')} ${opsDateTime(c?['created_at'])}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                  ]),
                ),
                const SizedBox(height: 12),
                OpsShipmentHistory(filterKey: 'user_id', filterValue: widget.id),
              ]),
            ),
    );
  }
}

// Driver profile, /system/ops/drivers/[id]
class OpsDriverProfileScreen extends StatefulWidget {
  final String id;
  const OpsDriverProfileScreen({super.key, required this.id});
  @override
  State<OpsDriverProfileScreen> createState() => _OpsDriverProfileScreenState();
}

class _OpsDriverProfileScreenState extends State<OpsDriverProfileScreen> {
  Map<String, dynamic>? _d;
  bool _loaded = false;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('ops:drivers:changed', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('ops:drivers:changed', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/ops/drivers/${widget.id}?lang=${Lang.instance.ar ? 'ar' : 'en'}');
      if (mounted) setState(() => _d = Map<String, dynamic>.from(d));
    } catch (_) {}
    if (mounted) setState(() => _loaded = true);
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final adminObj = d?['admin'] is Map ? d!['admin'] as Map : const {};
    final n1 = opsLoc(adminObj['name']);
    final name = n1.isNotEmpty ? n1 : (opsLoc(d?['name']).isEmpty ? '—' : opsLoc(d?['name']));
    final phone = '${adminObj['phone'] ?? ''}';
    final email = '${adminObj['email'] ?? ''}';
    final info = [
      (tr('الجنسية', 'Nationality'), d?['nationality']),
      (tr('رقم الإقامة', 'Residence #'), d?['residence_number']),
      (tr('رقم بطاقة السائق', 'Driver card #'), d?['driver_card_number']),
      (tr('انتهاء البطاقة', 'Card expiry'), d?['driver_card_expiry'] == null ? null : opsDateTime(d!['driver_card_expiry'])),
      (tr('الشركة', 'Company'), d?['company_name']),
      (tr('الكفيل', 'Sponsor'), d?['sponsor_name']),
    ];
    return AppScaffold(
      title: Text(tr('ملف السائق', 'Driver profile')),
      body: !_loaded
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 110), SizedBox(height: 10), Shimmer()])
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(14), children: [
                AppCard(
                  topAccent: T.orange,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                    Row(children: [const Icon(Icons.badge_outlined, size: 15, color: T.inkFaint), const SizedBox(width: 4), Text('${d?['driver_card_number'] ?? '—'}', style: const TextStyle(color: T.inkSoft))]),
                    if (phone.isNotEmpty)
                      TextButton.icon(onPressed: () => launchUrl(Uri.parse('tel:$phone')), icon: const Icon(Icons.call, size: 16), label: Text(phone, textDirection: TextDirection.ltr)),
                    if (email.isNotEmpty)
                      TextButton.icon(onPressed: () => launchUrl(Uri.parse('mailto:$email')), icon: const Icon(Icons.mail_outline, size: 16), label: Text(email)),
                    Text('${tr('مُسجّل منذ', 'Registered')} ${opsDateTime(d?['created_at'])}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                    const Divider(height: 18),
                    Wrap(spacing: 18, runSpacing: 10, children: [
                      for (final i in info)
                        SizedBox(
                          width: 140,
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(i.$1, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                            Text(i.$2 == null || '${i.$2}'.isEmpty ? '—' : '${i.$2}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                          ]),
                        ),
                    ]),
                  ]),
                ),
                const SizedBox(height: 12),
                OpsShipmentHistory(filterKey: 'driver_id', filterValue: widget.id),
              ]),
            ),
    );
  }
}
