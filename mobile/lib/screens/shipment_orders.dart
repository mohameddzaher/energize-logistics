import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/search_field.dart';
import '../ui/contact.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'shipment_order_card.dart';
import '../ui/list_pager.dart';
import 'shipment_order_create.dart';
import 'shipment_order_detail.dart';
import 'shipment_orders_common.dart';

/// Shipment orders list, mirrors the web list. Paginated on the server (25 rows); search and all filters run there, so the list reflects the database, not just a first batch of 100.
class ShipmentOrdersScreen extends StatefulWidget {
  /// The initial filter is inherited from what was tapped on the dashboard (like ?status=...&from=... on web): a late-count card opens on the late shipments themselves, not the whole table.
  final List<String> initialStatuses;
  final String initialFrom;
  // From the dashboard: the range is by pickup day, plus a column filter (rep, customer, supplier...).
  final String initialTo;
  final bool byPickup;
  final Map<String, Set<String>> initialCols;
  /// Only shipments linked to a clearance transaction; opened from the dashboard card and stays in the same section.
  final bool customsLinked;
  const ShipmentOrdersScreen({super.key, this.initialStatuses = const [], this.initialFrom = '', this.initialTo = '',
    this.byPickup = false, this.initialCols = const {}, this.customsLinked = false});
  @override
  State<ShipmentOrdersScreen> createState() => _ShipmentOrdersScreenState();
}

/// Excel-style filter columns as on web: (key, Arabic label, English label).
const _colFields = [
  ('customerName', 'العميل', 'Customer'),
  ('fromCity', 'من', 'From'),
  ('toCity', 'إلى', 'To'),
  ('driverName', 'السائق', 'Driver'),
  ('truckType', 'الشاحنة', 'Truck'),
  // The remaining columns are as on web.
  ('reference', 'رقم أمر النقل', 'Transport order'),
  ('status', 'الحالة', 'Status'),
  ('pickupDay', 'يوم الاستلام', 'Pickup day'),
  ('buyPrice', 'سعر الشراء', 'Buy price'),
  ('sellPrice', 'سعر البيع', 'Sell price'),
  ('supplierName', 'المورّد', 'Supplier'),
  ('branch', 'الفرع', 'Branch'),
  ('plate', 'اللوحة', 'Plate'),
  ('cargoType', 'نوع الحمولة', 'Cargo'),
  ('paymentSubtype', 'نوع الدفع', 'Payment'),
  ('salesRepName', 'السيلز', 'Sales rep'),
  ('agentName', 'المندوب', 'Agent'),
  ('notes', 'ملاحظة أمر النقل', 'Transport order note'),
];

class _ShipmentOrdersScreenState extends State<ShipmentOrdersScreen> {
  // '' = pickup date; 'activity' = created or moved in the period.
  String _dateBy = '';
  String _riyadhDay(int back) => DateTime.now().toUtc().add(const Duration(hours: 3)).subtract(Duration(days: back)).toIso8601String().substring(0, 10);
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic>? _stats;
  int _total = 0;
  int _page = 1;
  int _pageSize = 50;
  bool _loading = true;
  String? _error;
  int _seq = 0; // A stale response does not overwrite a newer one

  final _searchCtrl = TextEditingController();
  String _q = '';
  Timer? _debounce;
  final Set<String> _statuses = {};
  String _note = '';
  String _customer = '';
  String _from = '';
  String _to = '';
  final Map<String, Set<String>> _colFilters = {};
  // Price sides this reader may see, and whether it creates shipments directly (sales and the vendors team go through requests).
  bool _pvSell = true, _pvBuy = true, _directCreate = true;
  bool _customsOnly = false;
  bool _excludeCancelled = false;

  // Selected waybills become one file from the server.
  final Map<String, Map<String, dynamic>> _picked = {};
  bool _bulkBusy = false;

  List<SoStatus> _vocab = soBaseStatuses;
  late final void Function() _onLive = _load;

  /// View mode: cards (mobile default) or list. Saved on the account (shipmentOrders.view) so it persists across visits and devices; web writes table/grid/cards, and here table means list and anything else means cards.
  static const _prefKey = 'shipmentOrders.view';
  String _view = 'cards';
  final _listKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    _view = context.read<AuthProvider>().pref(_prefKey) == 'table' ? 'list' : 'cards';
    _statuses.addAll(widget.initialStatuses);
    _from = widget.initialFrom;
    _to = widget.initialTo;
    widget.initialCols.forEach((k, v) => _colFilters[k] = {...v});
    _customsOnly = widget.customsLinked;
    _load();
    loadSoStatuses().then((v) { if (mounted) setState(() => _vocab = v); });
    Api.instance.get('/api/shipment-orders/money-editors').then((d) {
      if (mounted && d is Map && d['directCreate'] == false) setState(() => _directCreate = false);
    }).catchError((_) {});
    Live.instance.on('shipmentOrders:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('shipmentOrders:updated', _onLive);
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  /// Filter query parameters, shared by the table, the export and the column value lists.
  List<String> _params({String? skipCol, bool withSearch = true}) {
    final p = <String>[];
    void add(String k, String v) => p.add('$k=${Uri.encodeQueryComponent(v)}');
    _colFilters.forEach((k, set) {
      if (k == skipCol) return;
      // Each value is a repeated parameter so a name containing a comma stays one name. Uses col_ not col. because the server strips dotted keys (express-mongo-sanitize).
      for (final v in set) { add('col_$k', v); }
    });
    if (withSearch && _q.trim().isNotEmpty) add('q', _q.trim());
    if (_statuses.isNotEmpty) add('status', _statuses.join(','));
    if (_customer.isNotEmpty) add('customer', _customer);
    if (_from.isNotEmpty) add('from', _from);
    if (_to.isNotEmpty) add('to', _to);
    if (_dateBy.isNotEmpty && (_from.isNotEmpty || _to.isNotEmpty)) { add('dateBy', _dateBy); } else if (widget.byPickup && (_from.isNotEmpty || _to.isNotEmpty)) { add('dateBy', 'pickup'); }
    if (_customsOnly) add('customs', 'linked');
    if (_excludeCancelled) add('excludeCancelled', '1');
    return p;
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final p = ['page=$_page', 'limit=$_pageSize', ..._params(), if (_note.isNotEmpty) 'note=$_note'];
      final d = await Api.instance.get('/api/shipment-orders/orders?${p.join('&')}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['orders'] ?? []);
        _total = (d['total'] as num?)?.toInt() ?? 0;
        _stats = d['stats'] is Map ? Map<String, dynamic>.from(d['stats']) : null;
        final pv = d['priceView'];
        if (pv is Map) { _pvSell = pv['sell'] != false; _pvBuy = pv['buy'] != false; }
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  /// [reveal]: after tapping a stats card, the list is fetched and scrolled into view right below it.
  Future<void> _refilter(VoidCallback change, {bool reveal = false}) async {
    setState(() { change(); _page = 1; });
    await _load();
    if (!reveal || !mounted) return;
    final c = _listKey.currentContext;
    if (c != null && c.mounted) {
      Scrollable.ensureVisible(c, duration: const Duration(milliseconds: 350), curve: Curves.easeOutCubic);
    }
  }

  /// Optimistic: switches immediately and saves in the background; on failure it stays for this session with a small notice.
  Future<void> _setView(String v) async {
    if (v == _view) return;
    setState(() => _view = v);
    final value = v == 'list' ? 'table' : 'cards';
    final auth = context.read<AuthProvider>();
    final messenger = ScaffoldMessenger.of(context);
    try {
      await Api.instance.patch('/api/auth/me/prefs', {'key': _prefKey, 'value': value});
      auth.setPref(_prefKey, value);
    } catch (_) {
      messenger.showSnackBar(SnackBar(content: Text(tr('تعذّر حفظ طريقة العرض — ستبقى لهذه الجلسة فقط', 'Could not save the view — kept for this session only'))));
    }
  }

  /// Note saved: the new status history is merged into its row so the card updates at once (the live event then reloads the list for everyone).
  void _applyNote(Map<String, dynamic> updated) {
    final id = '${updated['_id'] ?? ''}';
    if (id.isEmpty || updated['statusLog'] == null) { _load(); return; }
    setState(() {
      _rows = [
        for (final r in _rows)
          '${r['_id']}' == id ? {...r, 'statusLog': updated['statusLog']} : r,
      ];
    });
  }

  void _togglePick(Map<String, dynamic> r) {
    final id = '${r['_id']}';
    setState(() => _picked.containsKey(id) ? _picked.remove(id) : _picked[id] = r);
  }

  Future<void> _editOrder(Map<String, dynamic> r) async {
    final saved = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => ShipmentOrderCreateScreen(order: r)));
    if (saved == true) _load();
  }

  int _byStatus(String k) => ((_stats?['byStatus'] as Map?)?[k] as num?)?.toInt() ?? 0;

  // The file carries what the table carries (web export columns)
  List<ExportCol> get _exportCols => [
        ExportCol('المرجع', 'Reference', (r) => soRef(r)),
        ExportCol('العميل', 'Customer', (r) => r['customerName']),
        ExportCol('المورّد', 'Supplier', (r) => r['supplierName']),
        ExportCol('من', 'From', (r) => r['fromCity']),
        ExportCol('إلى', 'To', (r) => r['toCity']),
        ExportCol('الشاحنة', 'Truck', (r) => r['truckType']),
        ExportCol('اللوحة', 'Plate', (r) => r['vehiclePlate']),
        ExportCol('السائق', 'Driver', (r) => r['driverName']),
        ExportCol('جوال السائق', 'Driver phone', (r) => r['driverPhone']),
        ExportCol('جنسية السائق', 'Driver nationality', (r) => r['driverNationality']),
        ExportCol('رقم إقامة السائق', 'Driver iqama', (r) => r['driverIqama']),
        ExportCol('الفرع', 'Branch', (r) => r['branch']),
        ExportCol('الاستلام', 'Pickup', (r) => soFmtDate(r['pickupTime'])),
        if (_pvSell) ExportCol('البيع', 'Sell', (r) => r['sellPrice']),
        if (_pvBuy) ExportCol('الشراء', 'Buy', (r) => r['buyPrice']),
        if (_pvSell && _pvBuy) ExportCol('الهامش', 'Margin', (r) => (num.tryParse('${r['sellPrice'] ?? 0}') ?? 0) - (num.tryParse('${r['buyPrice'] ?? 0}') ?? 0)),
        ExportCol('الحالة', 'Status', (r) => soStatusOf(_vocab, r['status']).$3),
        ExportCol('الوسيط', 'Agent', (r) => r['agentName']),
        ExportCol('ملاحظة', 'Note', (r) => r['notes']),
      ];

  bool get _hasFilters => _q.trim().isNotEmpty || _statuses.isNotEmpty || _customer.isNotEmpty || _from.isNotEmpty || _to.isNotEmpty;

  /// Visible page, all matches, or everything; each scope is fetched from the server with its own limit.
  Future<void> _export(String scope) async {
    List<Map<String, dynamic>> rows = _rows;
    if (scope != 'page') {
      try {
        final p = ['page=1', 'limit=100000', if (scope == 'matching') ..._params(), if (scope == 'matching' && _note.isNotEmpty) 'note=$_note'];
        final d = await Api.instance.get('/api/shipment-orders/orders?${p.join('&')}');
        rows = List<Map<String, dynamic>>.from(d['orders'] ?? []);
      } catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
        return;
      }
    }
    if (!mounted) return;
    if (rows.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('لا صفوف للتصدير', 'Nothing to export'))));
      return;
    }
    await exportExcel(context, fileName: 'shipment-orders', sheets: [('Orders', _exportCols, rows)]);
  }

  Future<void> _pickDate(bool from) async {
    final cur = DateTime.tryParse(from ? _from : _to) ?? DateTime.now();
    final d = await showDatePicker(context: context, initialDate: cur, firstDate: DateTime(2020), lastDate: DateTime(2100));
    if (d == null) return;
    final s = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    _refilter(() => from ? _from = s : _to = s);
  }

  /// Excel-style column filter. Values are requested from the server with counts under the other filters, not just the page values.
  Future<void> _columnFilter() async {
    final field = await showModalBottomSheet<String>(context: context, builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      Padding(padding: const EdgeInsets.all(14), child: Text(tr('فلترة بعمود', 'Filter by column'), style: const TextStyle(fontWeight: FontWeight.w800))),
      for (final f in _colFields.where((f) => (f.$1 != 'sellPrice' || _pvSell) && (f.$1 != 'buyPrice' || _pvBuy)))
        ListTile(
          title: Text(tr(f.$2, f.$3)),
          trailing: (_colFilters[f.$1]?.isNotEmpty ?? false) ? Chip2('${_colFilters[f.$1]!.length}', T.orange) : const Icon(Icons.chevron_left),
          onTap: () => Navigator.pop(c, f.$1),
        ),
    ])));
    if (field == null || !mounted) return;
    final sel = await showModalBottomSheet<Set<String>>(
      context: context,
      isScrollControlled: true,
      builder: (c) => _ColumnValuesSheet(
        title: tr(_colFields.firstWhere((f) => f.$1 == field).$2, _colFields.firstWhere((f) => f.$1 == field).$3),
        initial: _colFilters[field] ?? {},
        labelOf: field == 'status' ? (v) { final st = soStatusOf(_vocab, v); return tr(st.$2, st.$3); } : null,
        fetch: (search) async {
          final p = ['field=$field', ..._params(skipCol: field, withSearch: false), if (search.trim().isNotEmpty) 'search=${Uri.encodeQueryComponent(search.trim())}'];
          final d = await Api.instance.get('/api/shipment-orders/orders/filter-options?${p.join('&')}');
          return List<Map<String, dynamic>>.from(d['values'] ?? []);
        },
      ),
    );
    if (sel == null) return;
    _refilter(() { if (sel.isEmpty) { _colFilters.remove(field); } else { _colFilters[field] = sel; } });
  }

  Widget _statusCard(String label, int n, Color color, bool on, VoidCallback onTap, {VoidCallback? onLongPress}) => Padding(
        padding: const EdgeInsetsDirectional.only(end: 6),
        child: InkWell(
          onTap: onTap,
          onLongPress: onLongPress,
          borderRadius: BorderRadius.circular(20),
          child: Container(
            height: 34,
            padding: const EdgeInsets.symmetric(horizontal: 11),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: on ? color : Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: on ? color : T.line),
            ),
            child: Text.rich(TextSpan(children: [
              TextSpan(text: label, style: TextStyle(color: on ? Colors.white : color)),
              TextSpan(text: '  $n', style: TextStyle(color: on ? Colors.white : T.ink, fontWeight: FontWeight.w800)),
            ]), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          ),
        ),
      );

  Widget _seg(List<(String, String, int?)> opts, String value, void Function(String) on) => Container(
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(color: T.line.withValues(alpha: 0.4), borderRadius: BorderRadius.circular(10)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          for (final o in opts)
            InkWell(
              onTap: () => on(o.$1),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(color: value == o.$1 ? Colors.white : null, borderRadius: BorderRadius.circular(8)),
                child: Text('${o.$2}${o.$3 != null ? ' ${o.$3}' : ''}',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: value == o.$1 ? T.ink : T.inkFaint)),
              ),
            ),
        ]),
      );

  Future<void> _openDetail(Map<String, dynamic> r) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => ShipmentOrderDetailScreen(order: r, vocab: _vocab)));
    _load();
  }

  void _goPage(int p) { setState(() => _page = p); _load(); }

  @override
  Widget build(BuildContext context) {
    final editor = canEditOrders(context);
    final pages = (_total / _pageSize).ceil();
    return AppScaffold(
      title: Text(tr('طلبات الشحنات', 'Shipment Orders')),
      actions: [
        if (_picked.isNotEmpty)
          TextButton.icon(
            onPressed: _bulkBusy ? null : () async {
              setState(() => _bulkBusy = true);
              await soPrintWaybills(context, _picked.values.toList());
              if (mounted) setState(() { _bulkBusy = false; _picked.clear(); });
            },
            icon: _bulkBusy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.picture_as_pdf_outlined, color: Colors.white),
            label: Text('${_picked.length}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
          ),
        PopupMenuButton<String>(
          tooltip: tr('تصدير Excel', 'Export to Excel'),
          icon: const Icon(Icons.file_download_outlined),
          onSelected: _export,
          itemBuilder: (_) => [
            PopupMenuItem(value: 'page', child: Text(tr('الصفحة الظاهرة', 'Current page'))),
            PopupMenuItem(value: 'matching', child: Text('${_hasFilters ? tr('كل المطابق', 'All matching') : tr('الكل', 'All')} ($_total)')),
            if (_hasFilters) PopupMenuItem(value: 'all', child: Text(tr('الكل', 'All'))),
          ],
        ),
      ],
      floatingActionButton: editor && _directCreate
          ? FloatingActionButton.extended(
              onPressed: () async {
                final created = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const ShipmentOrderCreateScreen()));
                if (created == true) _load();
              },
              icon: const Icon(Icons.add),
              label: Text(tr('إنشاء شحنة', 'Create shipment')),
            )
          : null,
      // Search box and view toggle are pinned above, outside the loading/error switch, so they are not rebuilt empty (ui/search_field.dart).
      body: Column(children: [
        Padding(
          padding: const EdgeInsetsDirectional.only(start: 14, top: 6),
          child: Align(
            alignment: AlignmentDirectional.centerStart,
            child: Wrap(spacing: 6, children: [
              FilterChip(
                selected: _excludeCancelled,
                onSelected: (_) => _refilter(() => _excludeCancelled = !_excludeCancelled),
                label: Text(tr('باستثناء الملغاة', 'Excluding cancelled'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
              ),
              if (_anyFilter) ActionChip(
                avatar: const Icon(Icons.filter_alt_off_outlined, size: 16, color: T.danger),
                label: Text(tr('مسح كل الفلاتر', 'Clear all filters'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.danger)),
                onPressed: _clearAll,
              ),
            ]),
          ),
        ),
        if (_customsOnly)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: Align(alignment: AlignmentDirectional.centerStart, child: InputChip(
              label: Text(tr('المربوطة بالتخليص', 'Linked to customs'), style: const TextStyle(fontWeight: FontWeight.w700)),
              onDeleted: () => _refilter(() => _customsOnly = false),
            )),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: Row(children: [
            Expanded(child: SearchField(
              controller: _searchCtrl,
              onChanged: (v) {
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 350), () => _refilter(() => _q = v));
              },
              hint: tr('بحث برقم البوليصة، العميل، السائق، الإقامة، الجوال، اللوحة، الهيكل…', 'waybill, customer, driver, iqama, phone, plate, chassis…'),
            )),
            const SizedBox(width: 6),
            _filtersButton(),
            const SizedBox(width: 6),
            _viewSwitch(),
          ]),
        ),
        Expanded(child: _loading
            ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
            : _error != null && _rows.isEmpty
                ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, padding: const EdgeInsets.fromLTRB(12, 4, 12, 90), children: [
                      // Status bar: tapping shows only that status, long-press adds it to the selection
                      SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
                        for (final s in _vocab)
                          _statusCard(tr(s.$2, s.$3), _byStatus(s.$1), s.$4, _statuses.contains(s.$1),
                              () => _refilter(() {
                                final only = _statuses.length == 1 && _statuses.contains(s.$1);
                                _statuses.clear();
                                if (!only) _statuses.add(s.$1);
                              }, reveal: true),
                              onLongPress: () => _refilter(() => _statuses.contains(s.$1) ? _statuses.remove(s.$1) : _statuses.add(s.$1))),
                      ])),
                      // Anchor for 'show list': the screen scrolls here after a stats card is tapped.
                      SizedBox(key: _listKey, height: 4),
                      if (_total > 0)
                        ListPager(page: _page, pages: pages, pageSize: _pageSize, total: _total, onPage: _goPage,
                            onPageSize: (n) { setState(() { _pageSize = n; _page = 1; }); _load(); }),
                      if (_rows.isNotEmpty)
                        Row(children: [
                          Checkbox(
                            visualDensity: VisualDensity.compact,
                            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            value: _rows.every((o) => _picked.containsKey('${o['_id']}')),
                            onChanged: (v) => setState(() {
                              if (v == true) { for (final o in _rows) { _picked['${o['_id']}'] = o; } } else { _picked.clear(); }
                            }),
                          ),
                          Flexible(child: Text('${tr('تحديد الصفحة', 'Select page')} · ${tr('$_total شحنة', '$_total shipments')}', style: const TextStyle(fontSize: 12.5), overflow: TextOverflow.ellipsis)),
                          const Spacer(),
                          if (_picked.isNotEmpty)
                            Text(tr('محدد ${_picked.length}', '${_picked.length} selected'), style: const TextStyle(fontSize: 12, color: T.orange, fontWeight: FontWeight.w700)),
                        ]),
                      if (_rows.isEmpty)
                        Padding(padding: const EdgeInsets.only(top: 40), child: EmptyState(icon: Icons.assignment_outlined, title: tr('لا توجد شحنات مطابقة', 'No matching shipments')))
                      else if (_view == 'cards')
                        _bigCards(editor)
                      else
                        for (final r in _rows) Padding(padding: const EdgeInsets.only(bottom: 8), child: _card(r, editor)),
                      if (pages > 1) ListPager(compact: true, page: _page, pages: pages, pageSize: _pageSize, total: _total, onPage: _goPage),
                    ]),
                  )),
      ]),
    );
  }

  /// List / cards toggle: two large buttons beside the search.
  Widget _viewSwitch() {
    Widget b(String v, IconData icon, String tip) {
      final on = _view == v;
      return Tooltip(
        message: tip,
        child: InkWell(
          onTap: () => _setView(v),
          borderRadius: BorderRadius.circular(10),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            width: 40,
            height: 44,
            decoration: BoxDecoration(color: on ? T.navy : Colors.transparent, borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, size: 22, color: on ? Colors.white : T.inkFaint),
          ),
        ),
      );
    }
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(color: T.line.withValues(alpha: 0.4), borderRadius: BorderRadius.circular(12)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        b('cards', Icons.view_agenda_outlined, tr('بطاقات', 'Cards')),
        b('list', Icons.view_list_rounded, tr('قائمة', 'List')),
      ]),
    );
  }

  /// Large cards: one column on phones, two or three on tablets (grid).
  Widget _bigCards(bool editor) => LayoutBuilder(builder: (context, c) {
        final cols = c.maxWidth >= 1000 ? 3 : c.maxWidth >= 680 ? 2 : 1;
        const gap = 10.0;
        final w = ((c.maxWidth - gap * (cols - 1)) / cols).floorToDouble();
        return Wrap(spacing: gap, runSpacing: gap, children: [
          for (final r in _rows)
            SizedBox(
              width: w,
              child: ShipmentOrderBigCard(
                key: ValueKey('${r['_id']}'),
                order: r,
                vocab: _vocab,
                editor: editor,
                selected: _picked.containsKey('${r['_id']}'),
                onToggleSelect: () => _togglePick(r),
                onOpen: () => _openDetail(r),
                onChanged: _load,
                onNoteSaved: _applyNote,
                onEdit: () => _editOrder(r),
              ),
            ),
        ]);
      });

  /// Count of active filters in the panel (note, source, customer, both dates, columns).
  bool get _anyFilter => _q.isNotEmpty || _statuses.isNotEmpty || _customsOnly || _excludeCancelled || _dateBy.isNotEmpty || _sheetFilterCount > 0;

  /// Every filter on the screen at once: search, statuses, period, sheet filters, customs and cancelled.
  void _clearAll() {
    _debounce?.cancel();
    _searchCtrl.clear();
    _refilter(() {
      _q = ''; _statuses.clear(); _note = ''; _customer = ''; _from = ''; _to = ''; _dateBy = '';
      _colFilters.clear(); _customsOnly = false; _excludeCancelled = false;
    });
  }

  int get _sheetFilterCount =>
      (_note.isNotEmpty ? 1 : 0) + (_customer.isNotEmpty ? 1 : 0) +
      (_from.isNotEmpty ? 1 : 0) + (_to.isNotEmpty ? 1 : 0) + _colFilters.length;

  /// Filters button: orange with a counter whenever a filter is active.
  Widget _filtersButton() {
    final n = _sheetFilterCount;
    return Tooltip(
      message: tr('فلاتر', 'Filters'),
      child: InkWell(
        onTap: _openFilters,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          height: 50,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            color: n > 0 ? T.orange : T.card,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: n > 0 ? T.orange : T.line),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.tune_rounded, size: 21, color: n > 0 ? Colors.white : T.inkSoft),
            if (n > 0) ...[
              const SizedBox(width: 4),
              Text('$n', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13)),
            ],
          ]),
        ),
      ),
    );
  }

  /// Filter panel; it used to stack above the list and push the first shipment off screen.
  Future<void> _openFilters() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetCtx) => StatefulBuilder(builder: (sheetCtx, setSheet) {
        void apply(VoidCallback change) { _refilter(change); setSheet(() {}); }
        Widget title(String t) => Padding(padding: const EdgeInsets.only(top: 14, bottom: 6),
            child: Text(t, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: T.inkSoft)));
        return SafeArea(child: Padding(
          padding: EdgeInsets.fromLTRB(16, 14, 16, MediaQuery.of(sheetCtx).viewInsets.bottom + 14),
          child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(child: Text(tr('فلاتر', 'Filters'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
              if (_sheetFilterCount > 0)
                TextButton(
                  onPressed: () { _clearAll(); setSheet(() {}); },
                  child: Text(tr('مسح الكل', 'Clear all')),
                ),
            ]),
            title(tr('الفترة', 'Period')),
            Wrap(spacing: 6, children: [
              for (final p in [(tr('اليوم', 'Today'), 0, 0), (tr('أمس', 'Yesterday'), 1, 1), (tr('آخر 7 أيام', '7 days'), 6, 0)])
                OutlinedButton(onPressed: () => apply(() { _dateBy = 'activity'; _from = _riyadhDay(p.$2); _to = _riyadhDay(p.$3); }), child: Text(p.$1)),
              if (_dateBy.isNotEmpty) TextButton(onPressed: () => apply(() { _dateBy = ''; _from = ''; _to = ''; }), child: Text(tr('إلغاء الفترة', 'Clear period'))),
            ]),
            title(tr('الملاحظة', 'Note')),
            SingleChildScrollView(scrollDirection: Axis.horizontal, child: _seg(
                [('', tr('الكل', 'All'), null), ('yes', tr('لها ملاحظة', 'With note'), null), ('no', tr('بلا ملاحظة', 'No note'), null)],
                _note, (v) => apply(() => _note = v))),
            title(tr('التاريخ', 'Date')),
            Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
              ActionChip(avatar: const Icon(Icons.event, size: 16), label: Text(_from.isEmpty ? tr('من تاريخ', 'From') : _from),
                  onPressed: () async { await _pickDate(true); setSheet(() {}); }),
              ActionChip(avatar: const Icon(Icons.event, size: 16), label: Text(_to.isEmpty ? tr('إلى تاريخ', 'To') : _to),
                  onPressed: () async { await _pickDate(false); setSheet(() {}); }),
              if (_from.isNotEmpty || _to.isNotEmpty)
                IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => apply(() { _from = ''; _to = ''; })),
            ]),
            title(tr('الأعمدة', 'Columns')),
            Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
              ActionChip(
                avatar: const Icon(Icons.filter_alt_outlined, size: 16),
                label: Text('${tr('فلتر الأعمدة', 'Column filters')}${_colFilters.isEmpty ? '' : ' (${_colFilters.length})'}'),
                onPressed: () async { await _columnFilter(); setSheet(() {}); },
              ),
              if (_colFilters.isNotEmpty)
                TextButton(onPressed: () => apply(_colFilters.clear), child: Text(tr('مسح فلاتر الأعمدة', 'Clear column filters'))),
            ]),
            const SizedBox(height: 16),
            SizedBox(height: 48, child: FilledButton(
              onPressed: () => Navigator.pop(sheetCtx),
              child: Text(tr('عرض $_total شحنة', 'Show $_total shipments')),
            )),
          ])),
        ));
      }),
    );
  }

  Widget _card(Map<String, dynamic> r, bool editor) {
    final st = soStatusOf(_vocab, r['status']);
    final id = '${r['_id']}';
    final logN = (r['statusLog'] as List?)?.length ?? 0;
    return Pressable(
      onTap: () => _openDetail(r),
      onLongPress: () => _togglePick(r),
      child: AppCard(
        topAccent: st.$4,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            SizedBox(width: 26, height: 26, child: Checkbox(
              value: _picked.containsKey(id),
              onChanged: (_) => setState(() => _picked.containsKey(id) ? _picked.remove(id) : _picked[id] = r),
            )),
            const SizedBox(width: 6),
            Text(soRef(r), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, fontFamily: 'monospace')),
            const Spacer(),
            InkWell(
              onTap: editor ? () async { if (await soFollowUp(context, r, _vocab)) _load(); } : null,
              child: Chip2('${tr(st.$2, st.$3)}${logN > 0 ? ' · $logN' : ''}', st.$4, icon: editor ? Icons.sync : null),
            ),
          ]),
          const SizedBox(height: 4),
          Text('${r['customerName'] ?? '—'}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
          Text('${tr('من', 'From')} ${r['fromCity'] ?? '—'}  ·  ${tr('إلى', 'To')} ${r['toCity'] ?? '—'}  ·  ${tr('الفرع', 'Branch')} ${r['branch'] ?? '—'}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
          const SizedBox(height: 4),
          Wrap(spacing: 6, runSpacing: 4, children: [
            if ('${r['truckType'] ?? ''}'.isNotEmpty) Chip2('${r['truckType']}', T.navy, icon: Icons.local_shipping_outlined),
            if ('${r['vehiclePlate'] ?? ''}'.isNotEmpty) Chip2('${r['vehiclePlate']}', T.inkSoft),
            if ('${r['pickupTime'] ?? ''}'.isNotEmpty) Chip2(soFmtDT(r['pickupTime']), T.inkFaint, icon: Icons.schedule),
            if (soPriceLine(r).isNotEmpty) Chip2(soPriceLine(r), T.success),
            if ('${r['supplierName'] ?? ''}'.isNotEmpty)
              Chip2('${r['ownerKind'] == 'freelancer' ? tr('فريلانسر', 'Freelancer') : r['ownerKind'] == 'ours' ? tr('أسطولنا', 'Our fleet') : tr('شركة', 'Company')}: ${r['supplierName']}', T.navy),
          ]),
          if ('${r['notes'] ?? ''}'.trim().isNotEmpty)
            Padding(padding: const EdgeInsets.only(top: 4), child: Text('${tr('ملاحظة أمر النقل', 'Transport order note')}: ${r['notes']}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: T.inkSoft))),
          // Opens all notes: read, add, edit and delete.
          SoLatestFollowUpLine(order: r, onTap: () async {
            final u = await soQuickNote(context, r);
            if (u != null) _applyNote(u);
          }),
          Row(children: [
            Expanded(child: Text('${r['driverName'] ?? ''}', style: const TextStyle(fontSize: 12.5))),
            ContactButtons(phone: '${r['driverPhone'] ?? ''}', size: 18, compact: true),
            IconButton(
              visualDensity: VisualDensity.compact,
              tooltip: tr('تحميل أمر النقل PDF', 'Download transport order PDF'),
              icon: const Icon(Icons.picture_as_pdf_outlined, size: 19, color: T.orange),
              onPressed: () => soPrintWaybills(context, [r]),
            ),
            if (editor)
              IconButton(
                visualDensity: VisualDensity.compact,
                tooltip: tr('ملاحظات المتابعة', 'Follow-up notes'),
                icon: const Icon(Icons.edit_note, size: 21, color: T.violet),
                onPressed: () async {
                  final u = await soQuickNote(context, r);
                  if (u != null) _applyNote(u);
                },
              ),
            if (editor)
              IconButton(
                visualDensity: VisualDensity.compact,
                tooltip: tr('تعديل', 'Edit'),
                icon: const Icon(Icons.edit_outlined, size: 19, color: T.info),
                onPressed: () => _editOrder(r),
              ),
          ]),
        ]),
      ),
    );
  }
}

/// Column value list with counts: server-side search and multi-select.
class _ColumnValuesSheet extends StatefulWidget {
  final String title;
  final Set<String> initial;
  final Future<List<Map<String, dynamic>>> Function(String search) fetch;
  final String Function(String)? labelOf;
  const _ColumnValuesSheet({required this.title, required this.initial, required this.fetch, this.labelOf});
  @override
  State<_ColumnValuesSheet> createState() => _ColumnValuesSheetState();
}

class _ColumnValuesSheetState extends State<_ColumnValuesSheet> {
  late final Set<String> _sel = {...widget.initial};
  List<Map<String, dynamic>> _values = [];
  bool _loading = true;
  int _seq = 0;
  Timer? _t;

  @override
  void initState() { super.initState(); _run(''); }
  @override
  void dispose() { _t?.cancel(); super.dispose(); }

  Future<void> _run(String s) async {
    final mine = ++_seq;
    setState(() => _loading = true);
    try {
      final v = await widget.fetch(s);
      if (mounted && mine == _seq) setState(() { _values = v; _loading = false; });
    } catch (_) {
      if (mounted && mine == _seq) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(child: Padding(
      padding: EdgeInsets.fromLTRB(14, 14, 14, MediaQuery.of(context).viewInsets.bottom + 14),
      child: SizedBox(height: MediaQuery.of(context).size.height * 0.7, child: Column(children: [
        Text(widget.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 8),
        SearchField(
          hint: tr('بحث…', 'Search…'),
          onChanged: (v) { _t?.cancel(); _t = Timer(const Duration(milliseconds: 350), () => _run(v)); },
        ),
        if (_loading) const LinearProgressIndicator(minHeight: 2),
        Expanded(child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
          if (!_loading && _values.isEmpty)
            Padding(padding: const EdgeInsets.all(18), child: Text(tr('لا نتائج', 'No matches'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
          for (final v in _values)
            CheckboxListTile(
              dense: true,
              value: _sel.contains('${v['value']}'),
              onChanged: (on) => setState(() => on == true ? _sel.add('${v['value']}') : _sel.remove('${v['value']}')),
              title: Text(v['value'] == '__blank__' ? tr('(فارغ)', '(blank)')
                  : widget.labelOf != null ? widget.labelOf!('${v['value'] ?? ''}') : '${v['value'] ?? ''}'),
              secondary: Text('${v['count'] ?? ''}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
            ),
        ])),
        Row(children: [
          TextButton(onPressed: () => Navigator.pop(context, <String>{}), child: Text(tr('مسح', 'Clear'))),
          const Spacer(),
          FilledButton(onPressed: () => Navigator.pop(context, _sel), child: Text(tr('تطبيق', 'Apply'))),
        ]),
      ])),
    ));
  }
}
