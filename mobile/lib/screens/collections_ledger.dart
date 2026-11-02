import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'collection_attachments.dart';
import 'collections_aging.dart' show bandLabel;
import 'collections_invoices.dart' show openTaxInvoice;

// Invoice ledger: every invoice and what happened to it. When it was invoiced, when it reached the customer, when it was collected, and where the days between were lost. Counterpart of /system/collections-dept/ledger. Filters (status, type, employee, bucket, collected?, period by any date) come from `/ledger/invoices/filters` and run on the server; the number of loaded rows is a choice, and export covers the loaded rows or all filter results.

String _s(Map r, String k) => '${r[k] ?? ''}';
num _num(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;
String _m(dynamic n) => _num(n).round().toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');
String _dt(dynamic v) {
  final d = DateTime.tryParse('${v ?? ''}');
  if (d == null) return '';
  final r = d.toUtc().add(const Duration(hours: 3));
  return '${r.day.toString().padLeft(2, '0')}/${r.month.toString().padLeft(2, '0')}/${r.year}';
}
String _ymd(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// Due date in words: "12 days overdue", not "-12".
String _dueWords(dynamic d) {
  if (d == null) return '—';
  final n = _num(d).toInt();
  if (n < 0) return tr('متأخّرة ${-n} يومًا', '${-n}d overdue');
  if (n == 0) return tr('تستحق اليوم', 'Due today');
  return tr('تستحق بعد $n يومًا', 'Due in ${n}d');
}

class CollectionsLedgerScreen extends StatefulWidget {
  const CollectionsLedgerScreen({super.key});
  @override
  State<CollectionsLedgerScreen> createState() => _CollectionsLedgerScreenState();
}

class _CollectionsLedgerScreenState extends State<CollectionsLedgerScreen> {
  List<Map<String, dynamic>> _rows = [];
  List<String> _bands = [], _statuses = [], _officers = [];
  num _sum = 0;
  int _total = 0, _pages = 1, _page = 1, _size = 200, _seq = 0;
  bool _loading = true, _busy = false;
  String? _error;
  String _search = '', _status = '', _kind = '', _officer = '', _band = '', _open = '', _dateField = 'invoiceDate', _from = '', _to = '';
  Timer? _deb;
  Timer? _searchDeb; // Search timer is independent: a live refresh used to cancel a pending search.
  final _searchCtl = TextEditingController(); // Text stays equal to _search.
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    Api.instance.get('/api/collections-dept/ledger/invoices/filters').then((d) {
      if (!mounted || d is! Map) return;
      setState(() {
        _statuses = [for (final x in (d['statuses'] as List? ?? const [])) '$x'];
        _officers = [for (final x in (d['officers'] as List? ?? const [])) '$x'];
      });
    }).catchError((_) {});
    _onLive = () {
      _deb?.cancel();
      _deb = Timer(const Duration(milliseconds: 800), () => _load(background: true));
    };
    Live.instance.on('collections:party', _onLive);
    Live.instance.on('collections:changed', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('collections:party', _onLive);
    Live.instance.off('collections:changed', _onLive);
    _deb?.cancel();
    _searchDeb?.cancel();
    _searchCtl.dispose();
    super.dispose();
  }

  List<String> _params() => [
        if (_search.isNotEmpty) 'search=${Uri.encodeQueryComponent(_search)}',
        if (_status.isNotEmpty) 'status=${Uri.encodeQueryComponent(_status)}',
        if (_kind.isNotEmpty) 'kind=$_kind',
        if (_officer.isNotEmpty) 'officer=${Uri.encodeQueryComponent(_officer)}',
        if (_band.isNotEmpty) 'band=${Uri.encodeQueryComponent(_band)}',
        if (_open.isNotEmpty) 'open=$_open',
        if (_from.isNotEmpty) 'from=$_from',
        if (_to.isNotEmpty) 'to=$_to',
        if (_from.isNotEmpty || _to.isNotEmpty) 'dateField=$_dateField',
      ];

  Future<void> _load({bool background = false}) async {
    final mine = ++_seq;
    if (!background) setState(() => _busy = true);
    try {
      final d = await Api.instance.get('/api/collections-dept/ledger/invoices?${[..._params(), 'page=$_page', 'limit=$_size'].join('&')}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = [for (final r in (d['rows'] as List? ?? const [])) Map<String, dynamic>.from(r as Map)];
        _bands = [for (final b in (d['bands'] as List? ?? const [])) b is Map ? '${b['key']}' : '$b'];
        _total = _num(d['total']).toInt();
        _pages = _num(d['pages']).toInt().clamp(1, 1 << 30);
        _sum = _num(d['sum']);
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e is ApiException ? e.message : '$e');
    } finally {
      if (mounted) setState(() { _busy = false; _loading = false; });
    }
  }

  void _refilter() { _page = 1; _load(); }
  bool get _active => [_search, _status, _kind, _officer, _band, _open, _from, _to].any((x) => x.isNotEmpty);

  List<ExportCol> get _cols => [
        ExportCol('رقم الفاتورة', 'Invoice no', (r) => r['invoiceNumber']),
        ExportCol('العميل', 'Customer', (r) => r['partyName']),
        ExportCol('الكود', 'Code', (r) => r['partyCode']),
        ExportCol('المبلغ', 'Amount', (r) => r['total']),
        ExportCol('الفوترة', 'Invoiced', (r) => _dt(r['invoiceDate'])),
        ExportCol('أيام حتى التسليم', 'Days to delivery', (r) => r['daysInvoiceToDelivery']),
        ExportCol('التسليم', 'Delivered', (r) => _dt(r['deliveryDate'])),
        ExportCol('أيام حتى التحصيل', 'Days to collection', (r) => r['daysDeliveryToCollection']),
        ExportCol('التحصيل', 'Collected', (r) => _dt(r['collectionDate'])),
        ExportCol('إجمالي الأيام', 'Total days', (r) => r['daysTotal']),
        ExportCol('العمر', 'Age', (r) => r['ageDays']),
        ExportCol('الشريحة', 'Band', (r) => bandLabel(_s(r, 'band'))),
        ExportCol('مهلة السداد', 'Terms', (r) => r['creditDays']),
        ExportCol('الاستحقاق', 'Due', (r) => _dt(r['dueDate'])),
        ExportCol('الحالة', 'Status', (r) => r['status']),
        ExportCol('أوامر النقل', 'Reports', (r) => (r['reportNumbers'] as List? ?? const []).join(', ')),
        ExportCol('ملاحظات', 'Comments', (r) => r['comments']),
      ];

  Future<void> _export() async {
    final scope = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(title: Text(tr('الصفوف المحمَّلة (${_rows.length})', 'Loaded rows (${_rows.length})')), onTap: () => Navigator.pop(c, 'page')),
          ListTile(title: Text(tr('كل نتائج الفلتر ($_total)', 'All matching ($_total)')), onTap: () => Navigator.pop(c, 'all')),
        ]),
      ),
    );
    if (scope == null || !mounted) return;
    var rows = _rows;
    if (scope == 'all') {
      try {
        final d = await Api.instance.get('/api/collections-dept/ledger/invoices?${[..._params(), 'page=1', 'limit=5000'].join('&')}');
        rows = [for (final r in (d['rows'] as List? ?? const [])) Map<String, dynamic>.from(r as Map)];
      } catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : '$e')));
        return;
      }
    }
    if (!mounted) return;
    await exportExcel(context, fileName: tr('دفتر-الفواتير', 'invoice-ledger'), sheets: [(tr('الفواتير', 'Invoices'), _cols, rows)]);
  }

  Future<void> _pick(String title, List<(String, String)> opts, String cur, void Function(String) set) async {
    final v = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(c).size.height * 0.7),
          child: ListView(shrinkWrap: true, children: [
            ListTile(title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800))),
            for (final o in opts)
              ListTile(title: Text(o.$2), trailing: cur == o.$1 ? const Icon(Icons.check, color: T.orange) : null, onTap: () => Navigator.pop(c, o.$1)),
          ]),
        ),
      ),
    );
    if (v == null) return;
    setState(() => set(v));
    _refilter();
  }

  Widget _chip(String label, String value, String shown, List<(String, String)> opts, void Function(String) set) => Padding(
        padding: const EdgeInsetsDirectional.only(end: 6),
        child: InputChip(
          label: Text(value.isEmpty ? label : '$label: $shown'),
          selected: value.isNotEmpty,
          onPressed: () => _pick(label, opts, value, set),
          onDeleted: value.isEmpty ? null : () { setState(() => set('')); _refilter(); },
        ),
      );

  Widget _card(Map<String, dynamic> r) {
    final overdue = r['overdue'] == true;
    final status = _s(r, 'status');
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Pressable(
        onTap: () => openTaxInvoice(context, _s(r, 'invoiceNumber')),
        child: Container(
          decoration: BoxDecoration(
            color: overdue ? T.danger.withValues(alpha: 0.04) : T.card,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: T.line),
          ),
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(_s(r, 'invoiceNumber'), style: const TextStyle(fontWeight: FontWeight.w800, color: T.orange))),
              Text(_m(r['total']), style: const TextStyle(fontWeight: FontWeight.w900)),
              IconButton(
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.attach_file_rounded, size: 18, color: T.orange),
                onPressed: () => openCollectionAttachments(context, kind: 'tax', key: _s(r, 'invoiceNumber'), label: _s(r, 'invoiceNumber')),
              ),
            ]),
            Text('${_s(r, 'partyCode')} ${_s(r, 'partyName')}'.trim(), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
            const SizedBox(height: 4),
            // The three milestones and the days between them: our work, then the customer's term.
            Text([
              '${tr('فُوترت', 'Invoiced')} ${_dt(r['invoiceDate']).isEmpty ? '—' : _dt(r['invoiceDate'])}',
              '${r['daysInvoiceToDelivery'] ?? '—'}${tr('ي', 'd')} →',
              '${tr('سُلّمت', 'Delivered')} ${_dt(r['deliveryDate']).isEmpty ? '—' : _dt(r['deliveryDate'])}',
              '${r['daysDeliveryToCollection'] ?? '—'}${tr('ي', 'd')} →',
              '${tr('حُصّلت', 'Collected')} ${_dt(r['collectionDate']).isEmpty ? '—' : _dt(r['collectionDate'])}',
            ].join(' '), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 4, children: [
              Chip2(status.isEmpty ? tr('مفتوحة', 'Open') : status, status == 'Collected' ? T.success : status == 'Delivered' ? T.info : T.inkSoft),
              if (_s(r, 'band').isNotEmpty) Chip2(bandLabel(_s(r, 'band')), T.cyan),
              if (r['ageDays'] != null) Chip2('${r['ageDays']} ${tr('يوم', 'd')}', T.inkSoft),
              if (r['daysTotal'] != null) Chip2('${tr('إجمالي الأيام', 'Total days')} ${r['daysTotal']}', T.inkSoft),
              if (_num(r['creditDays']) > 0) Chip2('${tr('مهلة', 'Terms')} ${r['creditDays']}', T.navy),
              if (r['daysToDue'] != null) Chip2(_dueWords(r['daysToDue']), overdue ? T.danger : T.inkSoft),
              if ((r['reportNumbers'] as List? ?? const []).isNotEmpty)
                Chip2('${(r['reportNumbers'] as List).length} ${tr('أمر نقل', 'reports')}', T.navy, icon: Icons.link),
            ]),
            if (_s(r, 'comments').isNotEmpty) Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(_s(r, 'comments'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
            ),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    const kinds = [('tax', 'ضريبي', 'Tax'), ('cash', 'كاش', 'Cash')];
    final dateFields = [('invoiceDate', tr('تاريخ الفوترة', 'Invoice date')), ('deliveryDate', tr('تاريخ التسليم للعميل', 'Delivered to customer')), ('collectionDate', tr('تاريخ التحصيل', 'Collection date'))];
    return AppScaffold(
      title: Text(tr('دفتر الفواتير', 'Invoice ledger')),
      actions: [
        IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _rows.isEmpty ? null : _export),
      ],
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null && _rows.isEmpty
              ? ErrorRetry(message: _error!, onRetry: _load)
              : Column(children: [
                  if (_busy) const LinearProgressIndicator(minHeight: 2),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(padding: const EdgeInsets.all(12), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                        Row(children: [
                          for (final c in [
                            (tr('فواتير', 'Invoices'), _m(_total), T.ink),
                            (tr('إجمالي المبالغ', 'Total value'), _m(_sum), T.ink),
                            (tr('متأخرة (هذه الصفحة)', 'Past due (page)'), '${_rows.where((r) => r['overdue'] == true).length}', T.danger),
                          ])
                            Expanded(child: Padding(
                              padding: const EdgeInsetsDirectional.only(end: 6),
                              child: AppCard(padding: const EdgeInsets.all(10), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(c.$1, style: const TextStyle(fontSize: 10.5, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis),
                                Text(c.$2, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: c.$3)),
                              ])),
                            )),
                        ]),
                        const SizedBox(height: 10),
                        SearchField(
                          controller: _searchCtl,
                          dense: true,
                          hint: tr('رقم فاتورة أو عميل أو كود…', 'Invoice no, customer, code…'),
                          onChanged: (v) {
                            _searchDeb?.cancel();
                            _searchDeb = Timer(const Duration(milliseconds: 350), () { _search = v.trim(); _refilter(); });
                          },
                        ),
                        const SizedBox(height: 8),
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(children: [
                            _chip(tr('الحالة', 'Status'), _status, _status, [for (final s in _statuses) (s, s)], (v) => _status = v),
                            _chip(tr('النوع', 'Kind'), _kind, _kind == 'tax' ? tr('ضريبي', 'Tax') : tr('كاش', 'Cash'),
                                [for (final k in kinds) (k.$1, tr(k.$2, k.$3))], (v) => _kind = v),
                            _chip(tr('موظف التحصيل', 'Officer'), _officer, _officer, [for (final o in _officers) (o, o)], (v) => _officer = v),
                            _chip(tr('شريحة العمر', 'Age band'), _band, bandLabel(_band), [for (final b in _bands) (b, bandLabel(b))], (v) => _band = v),
                            _chip(tr('محصَّلة؟', 'Collected?'), _open, _open == 'true' ? tr('غير محصَّلة', 'Uncollected') : tr('محصَّلة', 'Collected'),
                                [('true', tr('غير محصَّلة', 'Uncollected')), ('false', tr('محصَّلة', 'Collected'))], (v) => _open = v),
                          ]),
                        ),
                        const SizedBox(height: 6),
                        // The period is measured by whichever date the asker wants.
                        Row(children: [
                          Expanded(
                            child: DropdownButtonFormField<String>(
                              initialValue: _dateField,
                              isDense: true,
                              isExpanded: true,
                              decoration: InputDecoration(labelText: tr('الفترة محسوبة بـ', 'Period measured by'), isDense: true),
                              items: [for (final f in dateFields) DropdownMenuItem(value: f.$1, child: Text(f.$2, style: const TextStyle(fontSize: 13)))],
                              onChanged: (v) { setState(() => _dateField = v ?? 'invoiceDate'); if (_from.isNotEmpty || _to.isNotEmpty) _refilter(); },
                            ),
                          ),
                          Flexible(child: TextButton.icon(
                            icon: const Icon(Icons.date_range_rounded, size: 18),
                            label: Text(_from.isEmpty ? tr('الفترة', 'Period') : '$_from → $_to', maxLines: 2, style: const TextStyle(fontSize: 12)),
                            onPressed: () async {
                              final r = await showDateRangePicker(context: context, firstDate: DateTime(2018), lastDate: DateTime(DateTime.now().year + 1));
                              if (r == null) return;
                              setState(() { _from = _ymd(r.start); _to = _ymd(r.end); });
                              _refilter();
                            },
                          )),
                          if (_from.isNotEmpty) IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () { setState(() { _from = ''; _to = ''; }); _refilter(); }),
                        ]),
                        // Wrap, not Row: the chips drop to a second line on narrow screens instead of overflowing.
                        Wrap(spacing: 4, runSpacing: 2, crossAxisAlignment: WrapCrossAlignment.center, children: [
                          Padding(
                            padding: const EdgeInsetsDirectional.only(end: 2),
                            child: Text(tr('الصفوف المحمَّلة:', 'Rows loaded:'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                          ),
                          for (final n in [50, 200, 1000, 5000])
                            ChoiceChip(label: Text('$n'), selected: _size == n, visualDensity: VisualDensity.compact,
                                onSelected: (_) { setState(() => _size = n); _refilter(); }),
                          if (_active)
                            IconButton(
                              tooltip: tr('مسح', 'Clear'),
                              icon: const Icon(Icons.filter_alt_off_outlined, color: T.danger),
                              onPressed: () {
                                _searchDeb?.cancel();
                                _searchCtl.clear();
                                setState(() { _search = ''; _status = ''; _kind = ''; _officer = ''; _band = ''; _open = ''; _from = ''; _to = ''; });
                                _refilter();
                              },
                            ),
                        ]),
                        const SizedBox(height: 6),
                        if (_rows.isEmpty) EmptyState(icon: Icons.menu_book_outlined, title: _active ? tr('لا نتائج مطابقة', 'No matches') : tr('لا فواتير', 'No invoices')),
                        for (final r in _rows) _card(r),
                        if (_pages > 1)
                          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                            OutlinedButton(onPressed: _page <= 1 ? null : () { setState(() => _page--); _load(); }, child: Text(tr('السابق', 'Prev'))),
                            Text(tr('صفحة $_page من $_pages · $_total فاتورة', 'Page $_page of $_pages · $_total invoices'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                            OutlinedButton(onPressed: _page >= _pages ? null : () { setState(() => _page++); _load(); }, child: Text(tr('التالي', 'Next'))),
                          ]),
                      ]),
                    ),
                  ),
                ]),
    );
  }
}
