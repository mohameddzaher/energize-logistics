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
import 'shipment_order_create.dart';
import 'shipment_order_detail.dart';
import 'shipment_orders_common.dart';

/// طلبات الشحنات — نظيرُ قائمة الويب: مُصفَّحةٌ في الخادم (خمسةٌ وعشرون صفًّا)،
/// والبحثُ وفلاترُ الحالة والمصدر والعميل والتاريخ والملاحظة وفلاترُ الأعمدة كلُّها
/// تجري هناك — فما يُرى هو ما في القاعدة لا ما وصل من مئةٍ أولى.
class ShipmentOrdersScreen extends StatefulWidget {
  /// الفلترُ يُورَث ممّا ضُغط في اللوحة (`?status=…&from=…` في الويب):
  /// «١٤ متأخّرة» تُفتَح على المتأخّرة أنفسِها لا على الجدول كلِّه.
  final List<String> initialStatuses;
  final String initialFrom;
  // من اللوحة (٢٠٢٦/١٠/٢٧): المدى بيوم الاستلام، وفلترُ عمود (مندوب، عميل، مورّد…).
  final String initialTo;
  final bool byPickup;
  final Map<String, Set<String>> initialCols;
  const ShipmentOrdersScreen({super.key, this.initialStatuses = const [], this.initialFrom = '', this.initialTo = '',
    this.byPickup = false, this.initialCols = const {}});
  @override
  State<ShipmentOrdersScreen> createState() => _ShipmentOrdersScreenState();
}

/// أعمدةُ فلتر إكسل كما في الويب: (المفتاح، عربي، إنجليزي).
const _colFields = [
  ('customerName', 'العميل', 'Customer'),
  ('fromCity', 'من', 'From'),
  ('toCity', 'إلى', 'To'),
  ('driverName', 'السائق', 'Driver'),
  ('truckType', 'الشاحنة', 'Truck'),
  // وبقيّةُ الأعمدة كالويب (٢٠٢٦/١٠/٢٧).
  ('reference', 'رقم البوليصة', 'Waybill'),
  ('status', 'الحالة', 'Status'),
  ('pickupDay', 'يوم الاستلام', 'Pickup day'),
  ('buyPrice', 'سعر الشراء', 'Buy price'),
  ('sellPrice', 'سعر البيع', 'Sell price'),
  ('supplierName', 'المورّد', 'Supplier'),
  ('branch', 'الفرع', 'Branch'),
  ('notes', 'ملاحظة البوليصة', 'Waybill note'),
];

const _pageSize = 25;

class _ShipmentOrdersScreenState extends State<ShipmentOrdersScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic>? _stats;
  int _total = 0;
  int _page = 1;
  bool _loading = true;
  String? _error;
  int _seq = 0; // لا يكتب ردٌّ قديمٌ فوق أحدث

  final _searchCtrl = TextEditingController();
  String _q = '';
  Timer? _debounce;
  final Set<String> _statuses = {};
  String _source = '';
  String _note = '';
  String _customer = '';
  String _from = '';
  String _to = '';
  final Map<String, Set<String>> _colFilters = {};
  List<Map<String, dynamic>> _customers = [];

  // البوالصُ المعلَّمة → ملفٌّ واحدٌ من الخادم.
  final Map<String, Map<String, dynamic>> _picked = {};
  bool _bulkBusy = false;

  List<SoStatus> _vocab = soBaseStatuses;
  late final void Function() _onLive = _load;

  /// ── وضعُ العرض: «بطاقات» (الافتراضيّ على الجوّال) أو «قائمة» ─────────────
  /// يُحفَظ في الحساب (`shipmentOrders.view`) فيبقى في كلّ زيارةٍ وجهاز؛ والويبُ
  /// يكتب table/grid/cards — «table» هنا قائمة، وما سواها بطاقات.
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
    _load();
    loadSoStatuses().then((v) { if (mounted) setState(() => _vocab = v); });
    Api.instance.get('/api/shipment-orders/customers').then((d) {
      if (mounted) setState(() => _customers = List<Map<String, dynamic>>.from(d['customers'] ?? []));
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

  /// معاملاتُ الفلاتر — للجدول وللتصدير ولقوائم الأعمدة معًا.
  List<String> _params({String? skipCol, bool withSearch = true}) {
    final p = <String>[];
    void add(String k, String v) => p.add('$k=${Uri.encodeQueryComponent(v)}');
    _colFilters.forEach((k, set) {
      if (k == skipCol) return;
      // كلُّ قيمةٍ معاملٌ مكرَّر: اسمٌ فيه فاصلةٌ لا يصير اسمين.
      // ‏`col_` لا `col.`: الخادمُ يحذف المفاتيحَ ذاتَ النقطة (express-mongo-sanitize).
      for (final v in set) { add('col_$k', v); }
    });
    if (withSearch && _q.trim().isNotEmpty) add('q', _q.trim());
    if (_statuses.isNotEmpty) add('status', _statuses.join(','));
    if (_source.isNotEmpty) add('source', _source);
    if (_customer.isNotEmpty) add('customer', _customer);
    if (_from.isNotEmpty) add('from', _from);
    if (_to.isNotEmpty) add('to', _to);
    if (widget.byPickup && (_from.isNotEmpty || _to.isNotEmpty)) add('dateBy', 'pickup');
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
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  /// [reveal]: بعد الضغط على بطاقة إحصاء تُجلَب القائمةُ تحتها مباشرةً إلى العين.
  Future<void> _refilter(VoidCallback change, {bool reveal = false}) async {
    setState(() { change(); _page = 1; });
    await _load();
    if (!reveal || !mounted) return;
    final c = _listKey.currentContext;
    if (c != null && c.mounted) {
      Scrollable.ensureVisible(c, duration: const Duration(milliseconds: 350), curve: Curves.easeOutCubic);
    }
  }

  /// تفاؤليّ: يتبدّل فورًا ويُحفَظ في الخلفية؛ فإن فشل بقي لهذه الجلسة مع تنبيهٍ صغير.
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

  /// ملاحظةٌ حُفظت: سجلُّ الحالات الجديد يُدمَج في صفّه فتتحدّث البطاقةُ فورًا
  /// (والحدثُ الحيُّ يعيد تحميل القائمة بعدها عند الجميع).
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

  // ── الملفُّ يحمل ما يحمله الجدول (أعمدةُ تصدير الويب) ──────────────────────
  List<ExportCol> get _exportCols => [
        ExportCol('المرجع', 'Reference', (r) => soRef(r)),
        ExportCol('المصدر', 'Source', (r) => r['source'] == 'platform' ? 'platform' : 'ours'),
        ExportCol('العميل', 'Customer', (r) => r['customerName']),
        ExportCol('المورّد', 'Supplier', (r) => r['supplierName']),
        ExportCol('من', 'From', (r) => r['fromCity']),
        ExportCol('إلى', 'To', (r) => r['toCity']),
        ExportCol('الشاحنة', 'Truck', (r) => r['truckType']),
        ExportCol('اللوحة', 'Plate', (r) => r['vehiclePlate']),
        ExportCol('السائق', 'Driver', (r) => r['driverName']),
        ExportCol('جوال السائق', 'Driver phone', (r) => r['driverPhone']),
        ExportCol('الفرع', 'Branch', (r) => r['branch']),
        ExportCol('الاستلام', 'Pickup', (r) => soFmtDate(r['pickupTime'])),
        ExportCol('البيع', 'Sell', (r) => r['sellPrice']),
        ExportCol('الشراء', 'Buy', (r) => r['buyPrice']),
        ExportCol('الهامش', 'Margin', (r) => (num.tryParse('${r['sellPrice'] ?? 0}') ?? 0) - (num.tryParse('${r['buyPrice'] ?? 0}') ?? 0)),
        ExportCol('الحالة', 'Status', (r) => soStatusOf(_vocab, r['status']).$3),
        ExportCol('الوسيط', 'Agent', (r) => r['agentName']),
        ExportCol('ملاحظة', 'Note', (r) => r['notes']),
      ];

  bool get _hasFilters => _q.trim().isNotEmpty || _statuses.isNotEmpty || _source.isNotEmpty || _customer.isNotEmpty || _from.isNotEmpty || _to.isNotEmpty;

  /// الصفحةُ الظاهرة، أو المطابِق كلُّه، أو الكلّ — كلُّ نطاقٍ يُجلَب من الخادم بحدّه.
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

  /// ── فلترُ العمود على طريقة إكسل ───────────────────────────────────────────
  /// القيمُ تُطلَب من الخادم بعدّادها تحت بقيّة الفلاتر (لا قيمُ الصفحة وحدَها).
  Future<void> _columnFilter() async {
    final field = await showModalBottomSheet<String>(context: context, builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      Padding(padding: const EdgeInsets.all(14), child: Text(tr('فلترة بعمود', 'Filter by column'), style: const TextStyle(fontWeight: FontWeight.w800))),
      for (final f in _colFields)
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

  static const _inFlight = ['loading', 'uploaded', 'on_way'];
  static const _done = ['arrived', 'bond_sent', 'bond_received', 'invoiced'];
  bool _isSet(List<String> keys) => keys.length == _statuses.length && keys.every(_statuses.contains);

  Future<void> _openDetail(Map<String, dynamic> r) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => ShipmentOrderDetailScreen(order: r, vocab: _vocab)));
    _load();
  }

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
      floatingActionButton: editor
          ? FloatingActionButton.extended(
              onPressed: () async {
                final created = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const ShipmentOrderCreateScreen()));
                if (created == true) _load();
              },
              icon: const Icon(Icons.add),
              label: Text(tr('إنشاء شحنة', 'Create shipment')),
            )
          : null,
      // خانةُ البحث ومبدِّلُ العرض مثبَّتان فوق — خارج تبديل التحميل/الخطأ، فلا
      // تُعاد رسمُهما فارغتين (ui/search_field.dart).
      body: Column(children: [
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
                      // ── بطاقاتُ الإحصاء: الضغطُ يعرض تلك الشحناتِ وحدَها تحتها، والضغطُ ثانيةً يمسح ──
                      Row(children: [
                        Expanded(child: _kpiTile(tr('كل الشحنات', 'All'), _total, T.navy, _statuses.isEmpty,
                            () => _refilter(_statuses.clear, reveal: true))),
                        const SizedBox(width: 6),
                        Expanded(child: _kpiTile(tr('قيد التنفيذ', 'In flight'), _inFlight.fold(0, (a, k) => a + _byStatus(k)), T.info, _isSet(_inFlight),
                            () => _refilter(() { final on = _isSet(_inFlight); _statuses.clear(); if (!on) _statuses.addAll(_inFlight); }, reveal: true))),
                        const SizedBox(width: 6),
                        Expanded(child: _kpiTile(tr('وصلت / مكتملة', 'Done'), _done.fold(0, (a, k) => a + _byStatus(k)), T.success, _isSet(_done),
                            () => _refilter(() { final on = _isSet(_done); _statuses.clear(); if (!on) _statuses.addAll(_done); }, reveal: true))),
                      ]),
                      const SizedBox(height: 6),
                      // ── شريطُ الحالات: الضغطُ يعرضها وحدَها، والمطوَّلُ يضيفها إلى المنتقى ──
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
                      // مرسى «اعرض القائمة»: إليه تُمرَّر الشاشةُ بعد الضغط على بطاقة إحصاء.
                      SizedBox(key: _listKey, height: 4),
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
                      if (pages > 1)
                        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                          IconButton(onPressed: _page > 1 ? () { setState(() => _page--); _load(); } : null, icon: const Icon(Icons.chevron_right)),
                          Text('$_page / $pages'),
                          IconButton(onPressed: _page < pages ? () { setState(() => _page++); _load(); } : null, icon: const Icon(Icons.chevron_left)),
                        ]),
                    ]),
                  )),
      ]),
    );
  }

  /// «قائمة / بطاقات» — زرّان كبيران بجانب البحث.
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

  /// بطاقاتٌ كبيرة: عمودٌ واحد على الجوّال، واثنان أو ثلاثة على اللوح (شبكة).
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

  Widget _kpiTile(String label, int n, Color color, bool on, VoidCallback onTap) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
          decoration: BoxDecoration(
            color: on ? color : T.card,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: on ? color : T.line),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
                child: Text('$n', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: on ? Colors.white : T.ink, height: 1.15))),
            Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 10.5, color: on ? Colors.white : color, fontWeight: FontWeight.w700)),
          ]),
        ),
      );

  /// كم فلترًا فاعلًا في اللوحة (الملاحظة، المصدر، العميل، التاريخان، الأعمدة).
  int get _sheetFilterCount =>
      (_note.isNotEmpty ? 1 : 0) + (_source.isNotEmpty ? 1 : 0) + (_customer.isNotEmpty ? 1 : 0) +
      (_from.isNotEmpty ? 1 : 0) + (_to.isNotEmpty ? 1 : 0) + _colFilters.length;

  /// زرُّ «فلاتر» — برتقاليٌّ بعدّاده متى كان فيها فلترٌ فاعل.
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

  /// لوحةُ الفلاتر: كانت تتكدّس فوق القائمة وتدفع أوّلَ شحنةٍ تحت الشاشة.
  Future<void> _openFilters() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetCtx) => StatefulBuilder(builder: (sheetCtx, setSheet) {
        void apply(VoidCallback change) { _refilter(change); setSheet(() {}); }
        final src = _stats?['bySource'] as Map?;
        Widget title(String t) => Padding(padding: const EdgeInsets.only(top: 14, bottom: 6),
            child: Text(t, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: T.inkSoft)));
        return SafeArea(child: Padding(
          padding: EdgeInsets.fromLTRB(16, 14, 16, MediaQuery.of(sheetCtx).viewInsets.bottom + 14),
          child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(child: Text(tr('فلاتر', 'Filters'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
              if (_sheetFilterCount > 0)
                TextButton(
                  onPressed: () => apply(() { _note = ''; _source = ''; _customer = ''; _from = ''; _to = ''; _colFilters.clear(); }),
                  child: Text(tr('مسح الكل', 'Clear all')),
                ),
            ]),
            title(tr('الملاحظة', 'Note')),
            SingleChildScrollView(scrollDirection: Axis.horizontal, child: _seg(
                [('', tr('الكل', 'All'), null), ('yes', tr('لها ملاحظة', 'With note'), null), ('no', tr('بلا ملاحظة', 'No note'), null)],
                _note, (v) => apply(() => _note = v))),
            title(tr('المصدر', 'Source')),
            SingleChildScrollView(scrollDirection: Axis.horizontal, child: _seg([
              ('', tr('الكل', 'All'), (src?['total'] as num?)?.toInt()),
              ('system', tr('الخاص بنا', 'Ours'), (src?['system'] as num?)?.toInt()),
              ('platform', tr('المنصّة', 'Platform'), (src?['platform'] as num?)?.toInt()),
            ], _source, (v) => apply(() => _source = v))),
            title(tr('العميل', 'Customer')),
            DropdownButtonFormField<String>(
              initialValue: _customers.any((c) => c['_id'] == _customer) ? _customer : '',
              isExpanded: true,
              items: [
                DropdownMenuItem(value: '', child: Text(tr('كل العملاء', 'All customers'))),
                for (final c in _customers)
                  DropdownMenuItem(value: '${c['_id']}', child: Text('${c['name'] ?? ''}', overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) => apply(() => _customer = v ?? ''),
            ),
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
            if (r['source'] == 'platform') ...[
              const SizedBox(width: 5),
              Text(tr('منصّة', 'platform'), style: const TextStyle(fontSize: 10, color: T.inkFaint)),
            ],
            const Spacer(),
            InkWell(
              onTap: editor ? () async { if (await soFollowUp(context, r, _vocab)) _load(); } : null,
              child: Chip2('${tr(st.$2, st.$3)}${logN > 0 ? ' · $logN' : ''}', st.$4, icon: editor ? Icons.sync : null),
            ),
          ]),
          const SizedBox(height: 4),
          Text('${r['customerName'] ?? '—'}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
          Text('${tr('من', 'From')} ${r['fromCity'] ?? '—'}  ·  ${tr('إلى', 'To')} ${r['toCity'] ?? '—'}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
          const SizedBox(height: 4),
          Wrap(spacing: 6, runSpacing: 4, children: [
            if ('${r['truckType'] ?? ''}'.isNotEmpty) Chip2('${r['truckType']}', T.navy, icon: Icons.local_shipping_outlined),
            if ('${r['vehiclePlate'] ?? ''}'.isNotEmpty) Chip2('${r['vehiclePlate']}', T.inkSoft),
            if ('${r['pickupTime'] ?? ''}'.isNotEmpty) Chip2(soFmtDT(r['pickupTime']), T.inkFaint, icon: Icons.schedule),
            Chip2('${soMoney(r['sellPrice'])} / ${soMoney(r['buyPrice'])}', T.success),
          ]),
          if ('${r['notes'] ?? ''}'.trim().isNotEmpty)
            Padding(padding: const EdgeInsets.only(top: 4), child: Text('${tr('ملاحظة البوليصة', 'Waybill note')}: ${r['notes']}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: T.inkSoft))),
          // تُفتح منها كلُّ الملاحظات — للقراءة والإضافة والتعديل والحذف.
          SoLatestFollowUpLine(order: r, onTap: () async {
            final u = await soQuickNote(context, r);
            if (u != null) _applyNote(u);
          }),
          Row(children: [
            Expanded(child: Text('${r['driverName'] ?? ''}', style: const TextStyle(fontSize: 12.5))),
            ContactButtons(phone: '${r['driverPhone'] ?? ''}', size: 18, compact: true),
            IconButton(
              visualDensity: VisualDensity.compact,
              tooltip: tr('تحميل البوليصة PDF', 'Download waybill PDF'),
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

/// قائمةُ قيم العمود بعدّادها — بحثٌ يُرسَل إلى الخادم، واختيارٌ متعدّد.
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
