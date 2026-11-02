import 'dart:async';
import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/list_pager.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'cash_wallet.dart';
import 'ops_common.dart';

/// Web path of the board; also its key in the page permissions.
const opsBoardPath = '/system/operations/loads';

/// Loads & shipments board (counterpart of /system/operations/loads): workflow rows without billing, collection, customs and selling columns, which the server never sends (config/opsBoard).
class OpsLoadsBoardScreen extends StatefulWidget {
  const OpsLoadsBoardScreen({super.key});
  @override
  State<OpsLoadsBoardScreen> createState() => _OpsLoadsBoardScreenState();
}

/// Same columns and order as the web; the index is what the saved choice stores.
const _cols = [
  ('reportNumber', 'رقم أمر النقل', 'Transport order'),
  ('reportDate', 'تاريخ الأمر', 'Order date'),
  ('applicationStatus', 'حالة الشحنة', 'Shipment status'),
  ('origin', 'المصدر', 'Source'),
  ('username', 'العميل', 'Customer'),
  ('userPhone', 'جوال العميل', 'Customer phone'),
  ('fromLocation', 'من', 'From'),
  ('toLocation', 'إلى', 'To'),
  ('branch', 'الفرع', 'Branch'),
  ('loadingTime', 'وقت التحميل', 'Loading time'),
  ('driverName', 'السائق', 'Driver'),
  ('driverPhone', 'جوال السائق', 'Driver phone'),
  ('carOwner', 'مالك السيارة', 'Car owner'),
  ('carNumber', 'رقم السيارة', 'Car number'),
  ('plateNumber', 'اللوحة', 'Plate'),
  ('carName', 'السيارة', 'Car'),
  ('truckType', 'نوع الشاحنة', 'Truck type'),
  ('loadType', 'نوع الحمولة', 'Load type'),
  ('quantity', 'الكمية', 'Quantity'),
  ('driverRentalType', 'نوع تأجير السائق', 'Driver rental type'),
  ('paymentType', 'نوع الدفع', 'Payment type'),
  ('purchaseValue', 'قيمة الشراء', 'Purchase value'),
  ('representativeName', 'المندوب', 'Representative'),
  ('reference', 'المرجع', 'Reference'),
  ('operationsReview', 'مراجعة التشغيل', 'Operations review'),
  ('paymentDate', 'تاريخ السداد', 'Payment date'),
  ('payingBranch', 'الفرع المسدِّد', 'Paying branch'),
  ('finalReportDestination', 'وجهة أمر النقل النهائية', 'Final destination'),
  ('documentNumber', 'رقم المستند', 'Document no.'),
  ('sendingDate', 'تاريخ الإرسال', 'Sending date'),
  ('branchDeliveryDate', 'تاريخ التسليم للفرع', 'Branch delivery date'),
];

class _OpsLoadsBoardScreenState extends State<OpsLoadsBoardScreen> {
  static const _viewKey = 'opsBoard.view';
  // Hidden columns as one base-36 digit per index: the account preference holds 80 characters at most.
  static const _colsKey = 'opsBoard.hidden';

  List<Map<String, dynamic>> _rows = [];
  Map<String, int> _byStatus = {};
  int _total = 0, _page = 1, _pageSize = 50, _seq = 0;
  bool _loading = true;
  String? _error;
  String _q = '', _status = '', _origin = '';
  bool _excludeCancelled = false;
  String _view = 'cards';
  Set<String> _hidden = {};
  String? _busyId, _pdfId;
  Timer? _debounce, _soon;
  late final void Function() _onLive = _reloadSoon;
  static const _events = ['workflow:created', 'workflow:updated', 'workflow:deleted', 'workflow:stageChanged',
    'workflow:bulkImported', 'shipmentOrders:updated', 'fleet:updated'];

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthProvider>();
    final v = auth.pref(_viewKey);
    _view = const ['table', 'grid', 'cards'].contains(v) ? v : 'cards';
    _hidden = {
      for (final ch in auth.pref(_colsKey).split(''))
        if (int.tryParse(ch, radix: 36) case final i? when i < _cols.length) _cols[i].$1,
    };
    for (final e in _events) { Live.instance.on(e, _onLive); }
    _load();
  }

  @override
  void dispose() {
    for (final e in _events) { Live.instance.off(e, _onLive); }
    _debounce?.cancel();
    _soon?.cancel();
    super.dispose();
  }

  void _reloadSoon() {
    _soon?.cancel();
    _soon = Timer(const Duration(milliseconds: 600), () { if (mounted) _load(); });
  }

  Future<void> _load() async {
    final mine = ++_seq;
    final p = <(String, String)>[
      if (_q.trim().isNotEmpty) ('search', _q.trim()),
      if (_status.isNotEmpty) ('cf_applicationStatus', _status),
      if (_origin.isNotEmpty) ('origin', _origin),
      if (_excludeCancelled) ('excludeCancelled', '1'),
      ('page', '$_page'),
      ('limit', '$_pageSize'),
    ];
    try {
      final d = await Api.instance.get('/api/ops-board?${opsQs(p)}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['rows'] ?? []);
        _total = (d['total'] as num?)?.toInt() ?? 0;
        _byStatus = {for (final e in ((d['byStatus'] as Map?) ?? {}).entries) '${e.key}': (e.value as num).toInt()};
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = opsErr(e); });
    }
  }

  void _refilter(VoidCallback change) { setState(() { change(); _page = 1; }); _load(); }

  Future<void> _savePref(String key, String value) async {
    final auth = context.read<AuthProvider>();
    final messenger = ScaffoldMessenger.of(context);
    try {
      await Api.instance.patch('/api/auth/me/prefs', {'key': key, 'value': value});
      auth.setPref(key, value);
    } catch (_) {
      messenger.showSnackBar(SnackBar(content: Text(tr('تعذّر الحفظ في حسابك — سيبقى لهذه الجلسة فقط', 'Could not save to your account — kept for this session only'))));
    }
  }

  void _setView(String v) {
    if (v == _view) return;
    setState(() => _view = v);
    _savePref(_viewKey, v);
  }

  Future<void> _chooseColumns() async {
    final picked = await showModalBottomSheet<Set<String>>(
      context: context,
      isScrollControlled: true,
      builder: (c) {
        final hidden = {..._hidden};
        return StatefulBuilder(builder: (c, set) => SafeArea(
          child: SizedBox(
            height: MediaQuery.of(c).size.height * .75,
            child: Column(children: [
              ListTile(
                title: Text(tr('الأعمدة الظاهرة', 'Visible columns'), style: const TextStyle(fontWeight: FontWeight.w800)),
                trailing: TextButton(onPressed: () => Navigator.pop(c, hidden), child: Text(tr('حفظ', 'Save'))),
              ),
              const Divider(height: 1),
              Expanded(child: ListView(children: [
                for (final col in _cols)
                  CheckboxListTile(
                    dense: true,
                    value: !hidden.contains(col.$1),
                    // The order number identifies the row and cannot be hidden.
                    onChanged: col.$1 == 'reportNumber' ? null : (on) => set(() => on == true ? hidden.remove(col.$1) : hidden.add(col.$1)),
                    title: Text(tr(col.$2, col.$3)),
                  ),
              ])),
            ]),
          ),
        ));
      },
    );
    if (picked == null || !mounted) return;
    setState(() => _hidden = picked);
    final code = [for (var i = 0; i < _cols.length; i++) if (picked.contains(_cols[i].$1)) i.toRadixString(36)].join();
    _savePref(_colsKey, code);
  }

  Future<void> _changeStatus(Map<String, dynamic> r, String next) async {
    final id = '${r['_id']}';
    if (next.isEmpty || next == r['applicationStatus']) return;
    setState(() => _busyId = id);
    try {
      final row = await Api.instance.patch('/api/ops-board/$id/status', {'status': next});
      if (!mounted) return;
      setState(() {
        _rows = [for (final x in _rows) '${x['_id']}' == id ? {...x, ...(row is Map ? Map<String, dynamic>.from(row) : {'applicationStatus': next})} : x];
      });
      _reloadSoon();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(opsErr(e))));
    }
    if (mounted) setState(() => _busyId = null);
  }

  Future<void> _waybill(Map<String, dynamic> r) async {
    final id = '${r['_id']}';
    setState(() => _pdfId = id);
    try {
      final bytes = await Api.instance.getBytes('/api/ops-board/$id/waybill.pdf?lang=${Lang.instance.ar ? 'ar' : 'en'}');
      await Printing.layoutPdf(onLayout: (_) async => bytes, name: 'أمر نقل-${r['reportNumber'] ?? id}');
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(opsErr(e))));
    }
    if (mounted) setState(() => _pdfId = null);
  }

  String _originLabel(dynamic o) => o == 'fleet' ? tr('إدارة الأسطول', 'Fleet') : o == 'orders' ? tr('طلبات الشحنات', 'Shipment orders') : tr('المنصّة', 'Platform');

  String _cell(Map<String, dynamic> r, String k) {
    final v = r[k];
    switch (k) {
      case 'reportDate': case 'paymentDate': case 'sendingDate': case 'branchDeliveryDate':
        return v == null || v == '' ? '' : opsDate(v);
      case 'purchaseValue': return opsMoney(v, dash: false);
      case 'paymentType': return opsPaymentKindLabel(opsPaymentKindOf(r));
      case 'origin': return _originLabel(v);
      case 'applicationStatus': return opsStatusLabel(v);
      case 'operationsReview': return v == true || v == 'true' || v == 'done' ? tr('تمّت', 'Done') : '';
      default: return v == null ? '' : '$v';
    }
  }

  Widget _statusChip(Map<String, dynamic> r) {
    final id = '${r['_id']}';
    final cur = '${r['applicationStatus'] ?? ''}';
    final st = opsAppStatuses[cur];
    final color = st?.$3 ?? T.inkFaint;
    return PopupMenuButton<String>(
      enabled: _busyId != id,
      tooltip: tr('تغيير الحالة', 'Change status'),
      onSelected: (v) => _changeStatus(r, v),
      itemBuilder: (_) => [
        for (final e in opsAppStatuses.entries)
          PopupMenuItem(value: e.key, child: Row(children: [
            Icon(Icons.circle, size: 10, color: e.value.$3),
            const SizedBox(width: 8),
            Text(tr(e.value.$1, e.value.$2), style: TextStyle(fontWeight: e.key == cur ? FontWeight.w800 : FontWeight.w500)),
          ])),
      ],
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (_busyId == id) const SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2))
          else Text(opsStatusLabel(cur).isEmpty ? '—' : opsStatusLabel(cur), style: TextStyle(color: color, fontWeight: FontWeight.w800, fontSize: 12)),
          Icon(Icons.arrow_drop_down, size: 16, color: color),
        ]),
      ),
    );
  }

  Widget _waybillBtn(Map<String, dynamic> r, {bool compact = false}) {
    final id = '${r['_id']}';
    final can = r['hasWaybill'] == true;
    final icon = _pdfId == id
        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
        : const Icon(Icons.picture_as_pdf_outlined, size: 18);
    final tip = can ? tr('أمر النقل', 'Transport order') : tr('سطر من المنصّة القديمة — لا أمر نقل له في النظام', 'Old platform row — no transport order here');
    if (compact) return IconButton(tooltip: tip, onPressed: can && _pdfId != id ? () => _waybill(r) : null, icon: icon, color: T.navy);
    return OutlinedButton.icon(onPressed: can && _pdfId != id ? () => _waybill(r) : null, icon: icon, label: Text(tr('أمر النقل', 'Order')));
  }

  Widget _card(Map<String, dynamic> r, {bool small = false}) {
    String s(String k) => _cell(r, k);
    final plate = s('plateNumber').isNotEmpty ? s('plateNumber') : s('carNumber');
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: EdgeInsets.all(small ? 10 : 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(s('reportNumber'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
              Text('${s('reportDate')} · ${s('origin')}', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            ])),
            _statusChip(r),
          ]),
          const SizedBox(height: 6),
          Text(s('username').isEmpty ? '—' : s('username'), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Row(children: [
            const Icon(Icons.place_outlined, size: 14, color: T.orange),
            const SizedBox(width: 4),
            Expanded(child: Text('${s('fromLocation').isEmpty ? '—' : s('fromLocation')} ← ${s('toLocation').isEmpty ? '—' : s('toLocation')}', style: const TextStyle(fontSize: 12.5))),
          ]),
          Row(children: [
            const Icon(Icons.person_outline, size: 14, color: T.inkFaint),
            const SizedBox(width: 4),
            Expanded(child: Text([s('driverName'), plate].where((e) => e.isNotEmpty).join(' · ').ifEmpty('—'), style: const TextStyle(fontSize: 12.5))),
          ]),
          if (!small) ...[
            // Card view also shows the columns the user chose, beyond the fixed summary above.
            for (final c in _cols)
              if (!_hidden.contains(c.$1) && !const {'reportNumber', 'reportDate', 'origin', 'applicationStatus', 'username', 'fromLocation', 'toLocation', 'driverName', 'plateNumber', 'carNumber'}.contains(c.$1) && s(c.$1).isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 3),
                  child: Text.rich(TextSpan(children: [
                    TextSpan(text: '${tr(c.$2, c.$3)}: ', style: const TextStyle(color: T.inkFaint, fontSize: 12)),
                    TextSpan(text: s(c.$1), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                  ])),
                ),
          ],
          const SizedBox(height: 4),
          Row(children: [
            Expanded(child: Text(s('branch'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
            _waybillBtn(r, compact: small),
          ]),
        ]),
      ),
    );
  }

  Widget _table() {
    final shown = _cols.where((c) => !_hidden.contains(c.$1)).toList();
    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          headingRowHeight: 40,
          dataRowMinHeight: 40,
          dataRowMaxHeight: 52,
          columnSpacing: 18,
          columns: [
            for (final c in shown) DataColumn(label: Text(tr(c.$2, c.$3), style: const TextStyle(fontWeight: FontWeight.w800))),
            DataColumn(label: Text(tr('أمر النقل', 'Order'), style: const TextStyle(fontWeight: FontWeight.w800))),
          ],
          rows: [
            for (final r in _rows)
              DataRow(cells: [
                for (final c in shown)
                  DataCell(c.$1 == 'applicationStatus' ? _statusChip(r) : Text(_cell(r, c.$1).ifEmpty('—'),
                      style: TextStyle(fontWeight: c.$1 == 'reportNumber' ? FontWeight.w800 : FontWeight.w500))),
                DataCell(_waybillBtn(r, compact: true)),
              ]),
          ],
        ),
      ),
    );
  }

  Widget _viewSwitch() => SegmentedButton<String>(
        showSelectedIcon: false,
        style: const ButtonStyle(visualDensity: VisualDensity.compact),
        segments: [
          ButtonSegment(value: 'table', icon: const Icon(Icons.table_rows_outlined, size: 18), tooltip: tr('جدول', 'Table')),
          ButtonSegment(value: 'grid', icon: const Icon(Icons.grid_view_outlined, size: 18), tooltip: tr('شبكة', 'Grid')),
          ButtonSegment(value: 'cards', icon: const Icon(Icons.view_agenda_outlined, size: 18), tooltip: tr('بطاقات', 'Cards')),
        ],
        selected: {_view},
        onSelectionChanged: (s) => _setView(s.first),
      );

  Widget _chip(String label, int n, bool on, VoidCallback tap, {Color? color}) => Padding(
        padding: const EdgeInsetsDirectional.only(end: 6),
        child: ChoiceChip(
          selected: on,
          onSelected: (_) => tap(),
          label: Text('$label ${n.toString()}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: on ? Colors.white : (color ?? T.ink))),
          selectedColor: color ?? T.navy,
          showCheckmark: false,
          visualDensity: VisualDensity.compact,
        ),
      );

  @override
  Widget build(BuildContext context) {
    final pages = (_total / _pageSize).ceil().clamp(1, 1 << 30);
    final all = _byStatus.values.fold<int>(0, (a, b) => a + b);
    return AppScaffold(
      title: Text(tr('متابعة الحمولات والشحنات', 'Loads & Shipments')),
      actions: [
        IconButton(
          tooltip: tr('المحفظة', 'Wallet'),
          icon: const Icon(Icons.account_balance_wallet_outlined),
          onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CashWalletScreen())),
        ),
        IconButton(tooltip: tr('الأعمدة', 'Columns'), icon: const Icon(Icons.view_column_outlined), onPressed: _chooseColumns),
      ],
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(12), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
          SearchField(
            hint: tr('رقم أمر النقل، العميل، السائق، اللوحة…', 'Order no., customer, driver, plate…'),
            onChanged: (v) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 350), () => _refilter(() => _q = v));
            },
          ),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: DropdownButtonFormField<String>(
              initialValue: _origin,
              isDense: true,
              decoration: InputDecoration(labelText: tr('المصدر', 'Source'), isDense: true),
              items: [
                DropdownMenuItem(value: '', child: Text(tr('كل المصادر', 'All sources'))),
                DropdownMenuItem(value: 'orders', child: Text(tr('طلبات الشحنات', 'Shipment orders'))),
                DropdownMenuItem(value: 'fleet', child: Text(tr('إدارة الأسطول', 'Fleet'))),
              ],
              onChanged: (v) => _refilter(() => _origin = v ?? ''),
            )),
            const SizedBox(width: 8),
            _viewSwitch(),
          ]),
          CheckboxListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _excludeCancelled,
            onChanged: (v) => _refilter(() => _excludeCancelled = v == true),
            title: Text(tr('بدون الملغاة', 'Hide cancelled')),
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              _chip(tr('الكل', 'All'), all, _status.isEmpty, () => _refilter(() => _status = '')),
              for (final e in opsAppStatuses.entries)
                _chip(tr(e.value.$1, e.value.$2), _byStatus[e.key] ?? 0, _status == e.key,
                    () => _refilter(() => _status = _status == e.key ? '' : e.key), color: e.value.$3),
            ]),
          ),
          const SizedBox(height: 10),
          if (_loading)
            ...const [Shimmer(height: 150), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()]
          else if (_error != null)
            ErrorRetry(message: _error!, onRetry: _load)
          else if (_rows.isEmpty)
            EmptyState(icon: Icons.local_shipping_outlined, title: tr('لا توجد حمولات مطابقة', 'No matching loads'))
          else if (_view == 'table')
            _table()
          else if (_view == 'grid')
            LayoutBuilder(builder: (c, box) {
              final w = (box.maxWidth - 8) / 2;
              return Wrap(spacing: 8, runSpacing: 8, children: [for (final r in _rows) SizedBox(width: w, child: _card(r, small: true))]);
            })
          else
            ...[for (final r in _rows) Padding(padding: const EdgeInsets.only(bottom: 10), child: _card(r))],
          const SizedBox(height: 8),
          ListPager(
            page: _page, pages: pages, pageSize: _pageSize, total: _total,
            onPage: (p) { setState(() => _page = p); _load(); },
            onPageSize: (n) => _refilter(() => _pageSize = n),
          ),
        ]),
      ),
    );
  }
}

extension on String {
  String ifEmpty(String other) => isEmpty ? other : this;
}

/// Whether the account can open the board: its page is open for the role (opened by default for the board roles, or ticked).
bool canOpenOpsBoard(AuthProvider auth) => auth.pageAccess[opsBoardPath] == true;
