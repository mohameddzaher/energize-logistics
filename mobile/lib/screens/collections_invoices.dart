import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/customs_link.dart';
import '../ui/export_sheet.dart';
import '../ui/report_follow_ups.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import '../resource/configs.dart' show collectionsCanEdit, collectionsCanEditAmount;
import 'collection_attachments.dart';
import 'collection_collect.dart';
import 'collections_party.dart';
import 'collections_send.dart';
import 'ops_workflow_detail.dart';

// Collection invoices, cash and tax, on the same screen as two types. The counterpart of components/collections/InvoicesPage on the web, with all its actions: the three-state collection status with counts, cards, search and filters (age, customer, branch, details, period), paging, selecting rows and delivering them together, delivery, collection (its payments are edited and revoked), not-collected, value edit, attachments, account statement PDF, send to customer, and export. Live on the same events as the web.

String _s(Map r, String k) => '${r[k] ?? ''}';
num _num(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;
String _m(dynamic n) {
  final v = _num(n);
  return v.round().toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');
}
String _dt(dynamic v) {
  final d = DateTime.tryParse('${v ?? ''}');
  if (d == null) return '';
  final r = d.toUtc().add(const Duration(hours: 3));
  return '${r.day.toString().padLeft(2, '0')}/${r.month.toString().padLeft(2, '0')}/${r.year}';
}
String _ymd(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// Age buckets: non-overlapping, like the web.
const _ageBands = [
  ('0_15', 'حتى 15 يومًا', 'Up to 15 days'),
  ('15_30', 'من 15 إلى 30', '15 – 30 days'),
  ('30_45', 'من 30 إلى 45', '30 – 45 days'),
  ('45_60', 'من 45 إلى 60', '45 – 60 days'),
  ('60_plus', 'أكثر من 60', 'Over 60 days'),
];

const _stateTabs = [
  ('', 'all', 'الكل', 'All'),
  ('no', 'no', 'لم تُحصَّل بعد', 'Not collected'),
  ('partial', 'partial', 'تم تحصيلها جزئيًّا', 'Partially collected'),
  ('yes', 'yes', 'تم تحصيلها', 'Collected'),
];

String _stateLabel(String s) => s == 'full'
    ? tr('تم تحصيلها بالكامل', 'Fully collected')
    : s == 'partial' ? tr('تم تحصيلها جزئيًّا', 'Partially collected') : tr('لم تُحصَّل بعد', 'Not collected');
Color _stateColor(String s) => s == 'full' ? T.success : s == 'partial' ? T.warn : T.danger;

Color _ageColor(dynamic d) {
  final n = _num(d);
  if (n > 60) return T.danger;
  if (n > 45) return T.orange;
  if (n > 30) return T.warn;
  if (n > 15) return T.info;
  return T.inkSoft;
}

/// Opens a tax invoice's detail.
void openTaxInvoice(BuildContext context, String invoiceNumber) {
  if (invoiceNumber.isEmpty) return;
  Navigator.push(context, MaterialPageRoute(builder: (_) => CollectionsTaxInvoiceScreen(invoiceNumber: invoiceNumber)));
}

class CollectionsInvoicesScreen extends StatefulWidget {
  final String kind; // cash | tax
  const CollectionsInvoicesScreen({super.key, required this.kind});
  @override
  State<CollectionsInvoicesScreen> createState() => _CollectionsInvoicesScreenState();
}

class _CollectionsInvoicesScreenState extends State<CollectionsInvoicesScreen> {
  bool get _cash => widget.kind == 'cash';
  List<Map<String, dynamic>> _rows = [];
  // "I searched for the number and did not find it": where it is; the server returns it with the empty result (locateNumber).
  Map<String, dynamic>? _elsewhere;
  Map<String, dynamic> _totals = {};
  Map<String, dynamic> _stateCounts = {};
  int _total = 0, _pages = 1, _page = 1;
  bool _loading = true, _refreshing = false;
  String? _error;
  int _seq = 0;

  // Filters: all are sent to the server as the web sends them.
  String _collected = '';
  String _q = '';
  String _age = '', _customer = '', _branch = '', _detail = '', _from = '', _to = '';
  List<String> _customers = [], _branches = [];
  List<String> _details = [];
  final Set<String> _selected = {};
  final _search = TextEditingController();
  Timer? _deb, _liveTick;

  late final void Function() _onWf;
  late final void Function() _onSoon;
  late final void Function(dynamic) _onAtt;

  @override
  void initState() {
    super.initState();
    _load();
    Api.instance.get('/api/collections-dept/invoices/filters?kind=${widget.kind}').then((d) {
      if (!mounted || d is! Map) return;
      setState(() {
        _customers = [for (final x in (d['customers'] as List? ?? const [])) '$x'];
        _branches = [for (final x in (d['branches'] as List? ?? const [])) '$x'];
      });
    }).catchError((_) {});
    if (_cash) {
      Api.instance.get('/api/lookups?type=collections_detail&active=true&limit=200').then((d) {
        if (!mounted || d is! Map) return;
        setState(() => _details = [for (final x in (d['items'] as List? ?? const [])) if ('${(x as Map)['nameAr'] ?? ''}'.isNotEmpty) '${x['nameAr']}']);
      }).catchError((_) {});
    }
    // Collection is written on the sheet, so any edit there updates here at once.
    _onWf = () => _load(background: true);
    // Clearance linking and whatever adds or removes a sheet from the screen are batched for what arrives within a second.
    _onSoon = () {
      _liveTick?.cancel();
      _liveTick = Timer(const Duration(milliseconds: 800), () => _load(background: true));
    };
    // The attachment count updates in place; the event carries the new count.
    _onAtt = (d) {
      if (d is! Map || '${d['kind']}' != widget.kind || '${d['key'] ?? ''}'.isEmpty) return;
      final key = '${d['key']}';
      setState(() {
        for (final r in _rows) {
          if (_keyOf(r) == key) r['attachments'] = _num(d['count']).toInt();
        }
      });
    };
    Live.instance.on('workflow:updated', _onWf);
    Live.instance.on('collections:changed', _onSoon);
    Live.instance.on('workflow:bulkImported', _onSoon);
    Live.instance.onData('collections:attachments', _onAtt);
  }

  @override
  void dispose() {
    Live.instance.off('workflow:updated', _onWf);
    Live.instance.off('collections:changed', _onSoon);
    Live.instance.off('workflow:bulkImported', _onSoon);
    Live.instance.offData('collections:attachments', _onAtt);
    _deb?.cancel();
    _liveTick?.cancel();
    _search.dispose();
    super.dispose();
  }

  String _keyOf(Map r) => _cash ? _s(r, '_id') : _s(r, 'invoiceNumber');

  /// Everything the server understands as filtering in one place; read by the table, the statement and the send.
  QueryPairs _params() => [
        if (_q.isNotEmpty) ('q', _q),
        if (_collected.isNotEmpty) ('collected', _collected),
        if (_age.isNotEmpty) ('age', _age),
        if (_customer.isNotEmpty) ('customer', _customer),
        if (_branch.isNotEmpty) ('branch', _branch),
        if (_cash && _detail.isNotEmpty) ('detail', _detail),
        if (_from.isNotEmpty) ('from', _from),
        if (_to.isNotEmpty) ('to', _to),
      ];

  /// The filter changed: first page, and the selection does not cross a filter.
  void _refilter() {
    _page = 1;
    _selected.clear();
    _load();
  }

  Future<void> _load({bool background = false}) async {
    final mine = ++_seq;
    if (!background && mounted) setState(() => _refreshing = true);
    try {
      final p = [..._params(), ('page', '$_page'), ('limit', '100')];
      final d = await Api.instance.get('/api/collections-dept/invoices/${widget.kind}?${queryString(p)}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = [for (final r in (d['invoices'] as List? ?? const [])) Map<String, dynamic>.from(r as Map)];
        _elsewhere = d['elsewhere'] is Map ? Map<String, dynamic>.from(d['elsewhere'] as Map) : null;
        _totals = Map<String, dynamic>.from((d['totals'] as Map?) ?? const {});
        _stateCounts = Map<String, dynamic>.from((d['stateCounts'] as Map?) ?? const {});
        _total = _num(d['total']).toInt();
        _pages = _num(d['pages']).toInt().clamp(1, 1 << 30);
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e is ApiException ? e.message : '$e');
    } finally {
      // The flag is always cleared.
      if (mounted) setState(() { if (!background) _refreshing = false; _loading = false; });
    }
  }

  // The selection if any, otherwise the filter result
  QueryPairs _statementParams() => [
        ..._params(),
        for (final k in _selected) ('sel', k),
        ('lang', Lang.instance.ar ? 'ar' : 'en'),
      ];

  /// Collects the selected rows in full on one date; a row that fails is named.
  Future<void> _collectMany(List<Map<String, dynamic>> rows) async {
    final open = rows.where((r) => _s(r, 'collectionState') != 'full').toList();
    final messenger = ScaffoldMessenger.of(context);
    if (open.isEmpty) {
      messenger.showSnackBar(SnackBar(content: Text(tr('كل المحدَّد محصَّل بالفعل', 'Everything selected is already collected'))));
      return;
    }
    final d = await showDatePicker(
      context: context,
      helpText: tr('تحصيل ${open.length} بالكامل', 'Collect ${open.length} in full'),
      initialDate: DateTime.now(), firstDate: DateTime(2020), lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (d == null || !mounted) return;
    try {
      final r = await Api.instance.post('/api/collections-dept/invoices/collect-bulk', {
        'items': [for (final x in open) _cash ? {'id': _s(x, '_id'), 'label': _s(x, 'reportNumber')} : {'invoiceNumber': _s(x, 'invoiceNumber'), 'label': _s(x, 'invoiceNumber')}],
        'collectionDate': d.toIso8601String().substring(0, 10),
      });
      final failed = r is Map ? List.from(r['failed'] ?? const []) : const [];
      final msg = r is Map ? '${r['message'] ?? ''}' : '';
      messenger.showSnackBar(SnackBar(content: Text(failed.isEmpty ? msg : '$msg — ${failed.first['label']}: ${failed.first['message']}')));
      setState(() => _selected.clear());
      _load();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  // Delivery is a step before collection, and the term is counted from it
  Future<void> _deliver(List<Map<String, dynamic>> rows) async {
    if (rows.isEmpty) return;
    final first = DateTime.tryParse(_s(rows.first, 'deliveryDate'));
    final d = await showDatePicker(
      context: context,
      helpText: rows.length == 1
          ? '${tr('تسجيل تسليم', 'Record delivery')} — ${_cash ? _s(rows.first, 'reportNumber') : _s(rows.first, 'invoiceNumber')}'
          : tr('تسليم ${rows.length} للعميل', 'Deliver ${rows.length} to customer'),
      initialDate: rows.length == 1 && first != null ? first : DateTime.now(),
      firstDate: DateTime(2020), lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (d == null || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      String msg = '';
      if (_cash) {
        // Cash sheets are delivered together in one request.
        final r = await Api.instance.post('/api/collections-dept/invoices/deliver', {'ids': rows.map((x) => _s(x, '_id')).toList(), 'deliveryDate': _ymd(d)});
        msg = r is Map ? '${r['message'] ?? ''}' : '';
      } else {
        // A tax invoice is delivered by its number, one at a time.
        for (final x in rows) {
          final r = await Api.instance.post('/api/collections-dept/invoices/deliver', {'invoiceNumber': _s(x, 'invoiceNumber'), 'deliveryDate': _ymd(d)});
          if (rows.length == 1) msg = r is Map ? '${r['message'] ?? ''}' : '';
        }
        if (rows.length > 1) msg = tr('سُجِّل تسليم ${rows.length} فاتورة', '${rows.length} invoices delivered');
      }
      messenger.showSnackBar(SnackBar(content: Text(msg.isNotEmpty ? msg : tr('سُجِّل التسليم', 'Delivery recorded'))));
      setState(() => _selected.clear());
      _load();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر الحفظ', 'Could not save'))));
    }
  }

  /// The number exists but is not on this page: where it is, why, and a door to it.
  Widget _elsewhereHint(Map<String, dynamic> e) {
    final ledger = [for (final x in (e['ledger'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)];
    final sheets = [for (final x in (e['sheets'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)];
    final n = _s(e, 'number');
    const why = {
      'cancelled': ('أمر النقل ملغي', 'the report is cancelled'),
      'tax': ('نوع الدفع على أمر النقل «ضريبي»', 'the report is marked tax'),
      'noType': ('نوع الدفع على أمر النقل غير محدَّد', 'the report has no payment type'),
      'noPaymentDate': ('لا تاريخ سداد على أمر النقل بعد', 'the report has no payment date yet'),
      'notReviewed': ('لم يراجعه التشغيل بعد', 'operations has not reviewed it yet'),
    };
    return AppCard(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(ledger.isEmpty && sheets.isEmpty
            ? tr('الرقم $n غير موجود في دفتر التحصيل ولا في أوامر النقل.', '$n is in neither the collections book nor the operations reports.')
            : tr('الرقم $n موجودٌ لكن ليس في هذه الصفحة:', '$n exists, but not on this page:'),
            style: const TextStyle(fontWeight: FontWeight.w800)),
        for (final l in ledger)
          ListTile(
            dense: true, contentPadding: EdgeInsets.zero,
            title: Text('${_s(l, 'kind') == 'cash' ? tr('فاتورة نقديّة في دفتر التحصيل', 'Cash invoice in the collections book') : tr('فاتورة ضريبيّة في دفتر التحصيل', 'Tax invoice in the collections book')}'
                '${_s(l, 'customer').isEmpty ? '' : ' — ${_s(l, 'customer')}'} · ${l['collected'] == true ? tr('محصَّلة', 'collected') : tr('لم تُحصَّل', 'open')}'),
            trailing: Text(tr('افتحها', 'Open'), style: const TextStyle(color: T.orange, fontWeight: FontWeight.w700)),
            onTap: () async {
              await Navigator.push(context, MaterialPageRoute(builder: (_) => CollectionsTaxInvoiceScreen(invoiceNumber: _s(l, 'invoiceNumber'))));
              _load(background: true);
            },
          ),
        for (final w in sheets)
          ListTile(
            dense: true, contentPadding: EdgeInsets.zero,
            title: Text('${tr('أمر نقل', 'Operations report')} ${_s(w, 'reportNumber')}${_s(w, 'customer').isEmpty ? '' : ' — ${_s(w, 'customer')}'}'
                '${_cash && why[_s(w, 'why')] != null ? ' · ${tr('ليس في صفحة الكاش لأنّ', 'not on the cash page because')} ${tr(why[_s(w, 'why')]!.$1, why[_s(w, 'why')]!.$2)}' : ''}'),
            trailing: Text(tr('افتح أمر النقل', 'Open'), style: const TextStyle(color: T.orange, fontWeight: FontWeight.w700)),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => OpsWorkflowDetailScreen(id: _s(w, '_id')))),
          ),
      ]),
    );
  }

  Future<void> _uncollect(Map<String, dynamic> r) async {
    final ctrl = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('لم تُحصَّل', 'Not collected')),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(
            _s(r, 'collectionState') == 'partial'
                ? tr('مسجَّلٌ عليها تحصيلٌ جزئيّ. «لم تُحصَّل» ترفع الدفعات كلَّها — ولرفع دفعةٍ واحدةٍ استعمل «رفع» بجانبها في نافذة التحصيل.',
                    'Partly collected. “Not collected” removes every payment — to remove one, use “Remove” in the collect sheet.')
                : tr('يُمحى تاريخُ التحصيل ومبلغُه من أوامر النقل (ومن سير عمل التشغيل) وتعود في دفتر التحصيل غيرَ محصَّلة. يُقيَّد ذلك باسمك (وسببك إن كتبته).',
                    'The collection date and amount are cleared and it returns to not collected — recorded under your name.'),
            style: const TextStyle(fontSize: 13),
          ),
          TextField(controller: ctrl, decoration: InputDecoration(labelText: tr('السبب (اختياري)', 'Reason (optional)'),
              hintText: tr('مثال: الشيك رُدّ', 'e.g. cheque bounced'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('تراجع', 'Back'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, ctrl.text.trim()),
              child: Text(tr('تأكيد: لم تُحصَّل', 'Confirm: not collected'))),
        ],
      ),
    );
    ctrl.dispose();
    if (reason == null || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      final res = await Api.instance.post('/api/collections-dept/invoices/uncollect', {
        if (_cash) 'ids': [_s(r, '_id')] else 'invoiceNumber': _s(r, 'invoiceNumber'),
        'reason': reason,
      });
      messenger.showSnackBar(SnackBar(content: Text(res is Map && '${res['message'] ?? ''}'.isNotEmpty ? '${res['message']}' : tr('رُفع التحصيل', 'Collection undone'))));
      _load();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر الحفظ', 'Could not save'))));
    }
  }

  Future<void> _editAmount(Map<String, dynamic> r) async {
    final ctrl = TextEditingController(text: _s(r, 'value'));
    final v = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text('${tr('تعديل قيمة الفاتورة', 'Edit invoice amount')} ${_s(r, 'invoiceNumber')}'),
        content: TextField(controller: ctrl, autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(signed: true, decimal: true),
            decoration: InputDecoration(labelText: tr('القيمة الجديدة (ويجوز بالسالب)', 'New amount (negative allowed)'),
                helperText: '${tr('القيمة الحالية', 'Current')} ${_m(r['value'])}')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, ctrl.text.trim()), child: Text(tr('حفظ', 'Save'))),
        ],
      ),
    );
    ctrl.dispose();
    if (v == null || v.isEmpty || !mounted) return;
    final n = num.tryParse(v.replaceAll(',', ''));
    final messenger = ScaffoldMessenger.of(context);
    if (n == null) { messenger.showSnackBar(SnackBar(content: Text(tr('اكتب رقمًا', 'Enter a number')))); return; }
    try {
      await Api.instance.put('/api/collections-dept/invoices/tax/${Uri.encodeComponent(_s(r, 'invoiceNumber'))}/amount', {'total': n});
      messenger.showSnackBar(SnackBar(content: Text(tr('عُدِّلت القيمة', 'Amount updated'))));
      _load();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر الحفظ', 'Could not save'))));
    }
  }

  /// Collection detail (cash): where the money came from, from the section's settings list.
  Future<void> _setDetail(Map<String, dynamic> r) async {
    final v = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          ListTile(title: Text(tr('التفاصيل', 'Detail'), style: const TextStyle(fontWeight: FontWeight.w800))),
          ListTile(title: const Text('—'), onTap: () => Navigator.pop(c, '')),
          for (final d in _details)
            ListTile(title: Text(d), trailing: _s(r, 'collectionDetail') == d ? const Icon(Icons.check, color: T.orange) : null,
                onTap: () => Navigator.pop(c, d)),
        ]),
      ),
    );
    if (v == null || !mounted) return;
    final old = _s(r, 'collectionDetail');
    setState(() => r['collectionDetail'] = v);
    try {
      await Api.instance.put('/api/collections-dept/invoices/detail', {'ids': [_s(r, '_id')], 'detail': v});
    } catch (e) {
      if (!mounted) return;
      setState(() => r['collectionDetail'] = old);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر الحفظ', 'Could not save'))));
    }
  }

  bool _isCollected(Map r) => _cash ? (_s(r, 'collectionDate').isNotEmpty || r['collectedNoDate'] == true) : r['fullyCollected'] == true;
  bool _canUndo(Map r) => _cash
      ? (_s(r, 'collectionDate').isNotEmpty || _num(r['collectedAmount']) > 0 || r['collectedNoDate'] == true)
      : (r['fullyCollected'] == true || _s(r, 'collectionDate').isNotEmpty || _s(r, 'collectionState') == 'partial' || _num(r['collectedAmount']) > 0);

  /// Row actions: the web row buttons, in one sheet.
  Future<void> _rowActions(Map<String, dynamic> r) async {
    final label = _cash ? _s(r, 'reportNumber') : _s(r, 'invoiceNumber');
    final pick = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          ListTile(title: Text(label, style: const TextStyle(fontWeight: FontWeight.w800)), subtitle: Text(_s(r, 'customer'))),
          if (!_cash) ListTile(leading: const Icon(Icons.open_in_new_rounded), title: Text(tr('فتح الفاتورة', 'Open invoice')), onTap: () => Navigator.pop(c, 'open')),
          if (_cash && _s(r, '_id').isNotEmpty)
            ListTile(leading: const Icon(Icons.description_outlined), title: Text(tr('فتح أمر النقل', 'Open report')), onTap: () => Navigator.pop(c, 'report')),
          if (_s(r, 'partyId').isNotEmpty)
            ListTile(leading: const Icon(Icons.person_outline), title: Text(tr('ملفّ العميل', 'Customer file')), onTap: () => Navigator.pop(c, 'party')),
          if (collectionsCanEdit)
            ListTile(leading: const Icon(Icons.local_shipping_outlined, color: T.info),
                title: Text(_s(r, 'deliveryDate').isNotEmpty ? tr('تعديل التسليم', 'Edit delivery') : tr('تسليم', 'Deliver')),
                subtitle: Text(tr('يومُ استلام العميل للفاتورة — منه تُعَدُّ المهلة', 'When the customer received it — the term starts here'), style: const TextStyle(fontSize: 11.5)),
                onTap: () => Navigator.pop(c, 'deliver')),
          if (collectionsCanEdit)
            ListTile(leading: const Icon(Icons.check_circle_outline_rounded, color: T.orange),
                title: Text(_isCollected(r) ? tr('تعديل التحصيل', 'Edit collection') : tr('تحصيل', 'Collect')), onTap: () => Navigator.pop(c, 'collect')),
          if (collectionsCanEdit && _canUndo(r))
            ListTile(leading: const Icon(Icons.undo_rounded, color: T.danger), title: Text(tr('لم تُحصَّل', 'Not collected')), onTap: () => Navigator.pop(c, 'undo')),
          if (collectionsCanEditAmount && !_cash)
            ListTile(leading: const Icon(Icons.edit_note_rounded), title: Text(tr('تعديل القيمة', 'Edit amount')), onTap: () => Navigator.pop(c, 'amount')),
          if (_cash && collectionsCanEdit)
            ListTile(leading: const Icon(Icons.label_outline), title: Text(tr('التفاصيل', 'Detail')),
                subtitle: Text(_s(r, 'collectionDetail').isEmpty ? '—' : _s(r, 'collectionDetail')), onTap: () => Navigator.pop(c, 'detail')),
          ListTile(leading: const Icon(Icons.attach_file_rounded, color: T.orange),
              title: Text('${tr('المرفقات', 'Attachments')} (${_num(r['attachments']).toInt()})'), onTap: () => Navigator.pop(c, 'files')),
        ]),
      ),
    );
    if (pick == null || !mounted) return;
    switch (pick) {
      case 'open': openTaxInvoice(context, _s(r, 'invoiceNumber'));
      case 'report': Navigator.push(context, MaterialPageRoute(builder: (_) => OpsWorkflowDetailScreen(id: _s(r, '_id'))));
      case 'party': Navigator.push(context, MaterialPageRoute(builder: (_) => CollectionsPartyScreen(id: _s(r, 'partyId'))));
      case 'deliver': await _deliver([r]);
      case 'collect': if (await openCollectSheet(context, isCash: _cash, row: r)) _load();
      case 'undo': await _uncollect(r);
      case 'amount': await _editAmount(r);
      case 'detail': await _setDetail(r);
      case 'files': if (await openCollectionAttachments(context, kind: widget.kind, key: _keyOf(r), label: label)) _load(background: true);
    }
  }

  // Export columns: the web columns in the same order and values
  List<ExportCol> get _cols => _cash
      ? [
          ExportCol('رقم أمر النقل', 'Report no.', (r) => r['reportNumber']),
          ExportCol('العميل', 'Customer', (r) => r['customer']),
          ExportCol('المسار', 'Route', (r) => r['route']),
          ExportCol('التخليص', 'Customs', (r) {
            final c = r['customs'];
            return c is Map && '${c['refNumber'] ?? ''}'.isNotEmpty ? '${c['refNumber']}${'${c['blNumber'] ?? ''}'.isNotEmpty ? ' · ${c['blNumber']}' : ''}' : '';
          }),
          ExportCol('تاريخ السداد', 'Paid on', (r) => _dt(r['paymentDate'])),
          ExportCol('الفرع المسدد', 'Paying branch', (r) => r['payingBranch']),
          ExportCol('العمر (يوم)', 'Age (days)', (r) => r['ageDays']),
          ExportCol('قيمة أمر النقل', 'Value', (r) => r['value']),
          ExportCol('مبلغ التحصيل', 'Collected', (r) => r['collectedAmount']),
          ExportCol('المتبقي', 'Balance', (r) => r['remaining']),
          ExportCol('حالة التحصيل', 'Collection status', (r) => _stateLabel(_s(r, 'collectionState'))),
          ExportCol('التسليم للعميل', 'To customer', (r) => _dt(r['deliveryDate'])),
          ExportCol('التفاصيل', 'Detail', (r) => r['collectionDetail']),
          ExportCol('تاريخ التحصيل', 'Collected on', (r) => _s(r, 'collectionDate').isNotEmpty
              ? _dt(r['collectionDate']) : (r['collectedNoDate'] == true ? tr('محصَّل — بلا تاريخ', 'Collected — no date') : '')),
          ExportCol('عدد المرفقات', 'Attachments count', (r) => _num(r['attachments']).toInt()),
        ]
      : [
          ExportCol('رقم الفاتورة', 'Invoice no.', (r) => r['invoiceNumber']),
          ExportCol('العميل', 'Customer', (r) => r['customer']),
          ExportCol('كود الحساب', 'Account code', (r) => r['partyCode']),
          ExportCol('عدد أوامر النقل', 'Reports', (r) => r['reports']),
          ExportCol('التخليص', 'Customs', (r) => (r['customs'] is List)
              ? (r['customs'] as List).map((x) => x is Map ? '${x['refNumber'] ?? ''}' : '').where((x) => x.isNotEmpty).join('، ') : ''),
          ExportCol('القيمة', 'Value', (r) => r['value']),
          ExportCol('المحصَّل', 'Collected', (r) => r['collectedAmount']),
          ExportCol('المتبقي', 'Balance', (r) => r['remaining']),
          ExportCol('تاريخ الفاتورة', 'Invoice date', (r) => _dt(r['invoiceDate'])),
          ExportCol('التسليم للعميل', 'To customer', (r) => _dt(r['deliveryDate'])),
          ExportCol('العمر (يوم)', 'Age (days)', (r) => r['ageDays']),
          ExportCol('تاريخ التحصيل', 'Collected on', (r) => _dt(r['collectionDate'])),
          ExportCol('حالة التحصيل', 'Collection status', (r) => _stateLabel(_s(r, 'collectionState'))),
          ExportCol('الحالة', 'Status', (r) => r['status']),
          ExportCol('عدد المرفقات', 'Attachments count', (r) => _num(r['attachments']).toInt()),
        ];

  String get _title => _cash ? tr('فواتير الكاش', 'Cash invoices') : tr('الفواتير الضريبية', 'Tax invoices');

  Future<void> _export() async {
    final sel = _rows.where((r) => _selected.contains(_keyOf(r))).toList();
    String? scope = 'shown';
    if (sel.isNotEmpty) {
      scope = await showModalBottomSheet<String>(
        context: context,
        builder: (c) => SafeArea(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            ListTile(title: Text(tr('المحدَّد (${sel.length})', 'Selected (${sel.length})')), onTap: () => Navigator.pop(c, 'selected')),
            ListTile(title: Text(tr('المعروض بعد الفلتر', 'Shown (filtered)')), onTap: () => Navigator.pop(c, 'shown')),
          ]),
        ),
      );
    }
    if (scope == null || !mounted) return;
    final rows = scope == 'selected' ? sel : _rows;
    if (rows.isEmpty) return;
    await exportExcel(context, fileName: 'collections-${widget.kind}-invoices', sheets: [(_title, _cols, rows)]);
  }

  int get _activeCount => [_age, _customer, _branch, _from, _to, _detail].where((x) => x.isNotEmpty).length;

  Future<void> _openFilters() async {
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, set) {
        void up(VoidCallback f) { set(f); setState(() {}); }
        Future<String?> pickFrom(String title, List<String> opts) => showModalBottomSheet<String>(
              context: c, isScrollControlled: true,
              builder: (cc) => _SearchPick(title: title, options: opts),
            );
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 14, 16, 16 + MediaQuery.of(c).viewInsets.bottom),
            child: SingleChildScrollView(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                Text(tr('فلاتر', 'Filters'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                const SizedBox(height: 10),
                Text(tr('عمر الفاتورة', 'Invoice age'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkSoft)),
                Wrap(spacing: 6, children: [
                  for (final b in _ageBands)
                    ChoiceChip(label: Text(tr(b.$2, b.$3)), selected: _age == b.$1, onSelected: (_) => up(() => _age = _age == b.$1 ? '' : b.$1)),
                ]),
                const SizedBox(height: 8),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(tr('العميل', 'Customer')),
                  subtitle: Text(_customer.isEmpty ? tr('جميع العملاء', 'All customers') : _customer),
                  trailing: _customer.isEmpty ? const Icon(Icons.chevron_right) : IconButton(icon: const Icon(Icons.close), onPressed: () => up(() => _customer = '')),
                  onTap: () async { final v = await pickFrom(tr('العميل', 'Customer'), _customers); if (v != null) up(() => _customer = v); },
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(tr('الفرع المسدد', 'Paying branch')),
                  subtitle: Text(_branch.isEmpty ? tr('جميع الفروع', 'All branches') : _branch),
                  trailing: _branch.isEmpty ? const Icon(Icons.chevron_right) : IconButton(icon: const Icon(Icons.close), onPressed: () => up(() => _branch = '')),
                  onTap: () async { final v = await pickFrom(tr('الفرع المسدد', 'Paying branch'), _branches); if (v != null) up(() => _branch = v); },
                ),
                if (_cash)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(tr('التفاصيل', 'Detail')),
                    subtitle: Text(_detail.isEmpty ? tr('الكل', 'All') : _detail),
                    trailing: _detail.isEmpty ? const Icon(Icons.chevron_right) : IconButton(icon: const Icon(Icons.close), onPressed: () => up(() => _detail = '')),
                    onTap: () async { final v = await pickFrom(tr('التفاصيل', 'Detail'), _details); if (v != null) up(() => _detail = v); },
                  ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(_cash ? tr('مدى تاريخ السداد', 'Payment date range') : tr('مدى تاريخ الفاتورة', 'Invoice date range')),
                  subtitle: Text(_from.isEmpty && _to.isEmpty ? '—' : '${_from.isEmpty ? '…' : _from} → ${_to.isEmpty ? '…' : _to}'),
                  trailing: _from.isEmpty && _to.isEmpty ? const Icon(Icons.date_range_rounded) : IconButton(icon: const Icon(Icons.close), onPressed: () => up(() { _from = ''; _to = ''; })),
                  onTap: () async {
                    final r = await showDateRangePicker(context: c, firstDate: DateTime(2020), lastDate: DateTime(DateTime.now().year + 1));
                    if (r != null) up(() { _from = _ymd(r.start); _to = _ymd(r.end); });
                  },
                ),
                const SizedBox(height: 8),
                Row(children: [
                  if (_activeCount > 0)
                    TextButton.icon(
                      onPressed: () => up(() { _age = ''; _customer = ''; _branch = ''; _from = ''; _to = ''; _detail = ''; }),
                      icon: const Icon(Icons.close, color: T.danger), label: Text(tr('إزالة الفلاتر', 'Clear filters'), style: const TextStyle(color: T.danger)),
                    ),
                  const Spacer(),
                  FilledButton(onPressed: () => Navigator.pop(c), child: Text(tr('تطبيق', 'Apply'))),
                ]),
              ]),
            ),
          ),
        );
      }),
    );
    _refilter();
  }

  Widget _stat(String label, String value, Color color) => Container(
        width: 150,
        margin: const EdgeInsetsDirectional.only(end: 8),
        child: AppCard(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(fontSize: 11, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 2),
            FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
                child: Text(value, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: color))),
          ]),
        ),
      );

  Widget _stats() {
    final t = _totals;
    final none = t['noneCount'] ?? t['pendingCount'];
    final noneTax = t['none'] ?? t['pending'];
    // A horizontal strip whose height follows its content (no fixed height that clips numbers at large font sizes).
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _stat(_cash ? tr('أوامر نقل', 'Reports') : tr('فواتير', 'Invoices'), _m(_total), T.ink),
        if (_cash) ...[
          _stat(tr('المحصَّل', 'Collected'), _m(t['collected']), T.success),
          _stat(tr('محصَّلة بالكامل', 'Fully collected'), _m(t['collectedCount']), T.success),
          _stat(tr('محصَّلة جزئيًّا', 'Partially collected'), _m(t['partialCount']), _num(t['partialCount']) > 0 ? T.warn : T.inkFaint),
          _stat(tr('لم يُحصَّل بعد', 'Not collected'), _m(none), _num(none) > 0 ? T.danger : T.inkFaint),
        ] else ...[
          _stat(tr('قيمة الفواتير', 'Invoiced value'), _m(t['value']), T.ink),
          _stat(tr('محصَّلة بالكامل', 'Fully collected'), _m(t['fullyCollected']), T.success),
          _stat(tr('محصَّلة جزئيًّا', 'Partially collected'), _m(t['partial']), _num(t['partial']) > 0 ? T.warn : T.inkFaint),
          _stat(tr('لم تُحصَّل بعد', 'Not collected'), _m(noneTax), _num(noneTax) > 0 ? T.danger : T.inkFaint),
        ],
        _stat(tr('المتبقي', 'Balance due'), _m(t['remaining']), _num(t['remaining']) > 0 ? T.danger : T.inkFaint),
      ])),
    );
  }

  Widget _row(Map<String, dynamic> r) {
    final k = _keyOf(r);
    final on = _selected.contains(k);
    final st = _s(r, 'collectionState');
    final remaining = _num(r['remaining']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Pressable(
        onTap: () {
          if (_selected.isNotEmpty) { setState(() { if (!_selected.remove(k)) _selected.add(k); }); return; }
          if (!_cash) { openTaxInvoice(context, _s(r, 'invoiceNumber')); } else { _rowActions(r); }
        },
        child: GestureDetector(
          onLongPress: () => setState(() { if (!_selected.remove(k)) _selected.add(k); }),
          child: Container(
            decoration: BoxDecoration(
              color: on ? T.orange.withValues(alpha: 0.06) : T.card,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: on ? T.orange : T.line),
            ),
            padding: const EdgeInsets.fromLTRB(4, 8, 8, 10),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Checkbox(value: on, onChanged: (_) => setState(() { if (!_selected.remove(k)) _selected.add(k); })),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(_cash ? _s(r, 'reportNumber') : _s(r, 'invoiceNumber'),
                        style: const TextStyle(fontWeight: FontWeight.w800, color: T.orange, fontSize: 14))),
                    Text(_m(r['value']), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
                  ]),
                  const SizedBox(height: 2),
                  InkWell(
                    onTap: _s(r, 'partyId').isEmpty ? null
                        : () => Navigator.push(context, MaterialPageRoute(builder: (_) => CollectionsPartyScreen(id: _s(r, 'partyId')))),
                    child: Text(
                      [_s(r, 'customer'), if (!_cash && _s(r, 'partyCode').isNotEmpty) _s(r, 'partyCode'), if (_cash) _s(r, 'payingBranch')].where((x) => x.isNotEmpty).join(' · '),
                      style: TextStyle(fontSize: 12.5, color: _s(r, 'partyId').isEmpty ? T.inkSoft : T.info),
                    ),
                  ),
                  if (_cash && _s(r, 'route').isNotEmpty)
                    Text(_s(r, 'route'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                  const SizedBox(height: 6),
                  Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    Chip2(_stateLabel(st), _stateColor(st)),
                    if (r['ageDays'] != null) Chip2('${r['ageDays']} ${tr('يوم', 'd')}', _ageColor(r['ageDays'])),
                    if (_num(r['collectedAmount']) > 0) Chip2('${tr('محصَّل', 'Collected')} ${_m(r['collectedAmount'])}', T.success),
                    if (st != 'full' && remaining > 0) Chip2('${tr('باقٍ', 'Balance')} ${_m(remaining)}', st == 'partial' ? T.warn : T.danger),
                    if (!_cash) Chip2('${r['reports'] ?? 0} ${tr('أمر نقل', 'reports')}'
                        '${_num(r['reports']) > _num(r['collectedReports']) && _num(r['collectedReports']) > 0 ? ' (${r['collectedReports']} ${tr('محصَّل', 'collected')})' : ''}', T.navy),
                    if (_s(r, 'deliveryDate').isEmpty) Chip2(tr('لم تُسلَّم', 'Not delivered'), T.warn)
                    else Chip2('${tr('سُلِّمت', 'Delivered')} ${_dt(r['deliveryDate'])}', T.info),
                    if (_cash && r['collectedNoDate'] == true) Chip2(tr('محصَّل — بلا تاريخ', 'Collected — no date'), T.success)
                    else if (_s(r, 'collectionDate').isNotEmpty) Chip2('${tr('حُصّلت', 'Collected')} ${_dt(r['collectionDate'])}', T.success),
                    if (_cash && _s(r, 'paymentDate').isNotEmpty) Chip2('${tr('السداد', 'Paid')} ${_dt(r['paymentDate'])}', T.inkSoft),
                    if (!_cash && _s(r, 'invoiceDate').isNotEmpty) Chip2(_dt(r['invoiceDate']), T.inkSoft),
                    if (_cash && _s(r, 'collectionDetail').isNotEmpty) Chip2(_s(r, 'collectionDetail'), T.navy),
                    if (!_cash && _s(r, 'status').isNotEmpty) Chip2(_s(r, 'status'), T.inkSoft),
                    if (_num(r['attachments']) > 0) Chip2('${_num(r['attachments']).toInt()} ${tr('مرفقات', 'files')}', T.orange, icon: Icons.attach_file_rounded),
                    if (_cash && r['customs'] is Map) CustomsLinkChip(r['customs'], compact: true),
                    if (!_cash && r['customs'] is List && (r['customs'] as List).isNotEmpty) CustomsLinkChips(r['customs']),
                  ]),
                ]),
              ),
              IconButton(icon: const Icon(Icons.more_vert_rounded), onPressed: () => _rowActions(r)),
            ]),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final selRows = _rows.where((r) => _selected.contains(_keyOf(r))).toList();
    final allOn = _rows.isNotEmpty && _rows.every((r) => _selected.contains(_keyOf(r)));
    return AppScaffold(
      title: Text(_title),
      actions: [
        IconButton(
          tooltip: _selected.isNotEmpty ? tr('كشف حساب PDF للمحدَّد', 'Statement PDF of the selection') : tr('كشف حساب PDF', 'Statement PDF'),
          icon: const Icon(Icons.picture_as_pdf_outlined),
          onPressed: () => openCollectionsStatement(context, widget.kind, _statementParams()),
        ),
        if (collectionsCanEdit)
          IconButton(
            tooltip: tr('إرسال للعميل', 'Email customer'),
            icon: const Icon(Icons.forward_to_inbox_rounded, color: T.orange),
            onPressed: () => openSendStatement(context, kind: widget.kind, params: _statementParams()),
          ),
        IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _rows.isEmpty ? null : _export),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null && _rows.isEmpty
              ? ErrorRetry(message: _error!, onRetry: _load)
              : Column(children: [
                  if (_refreshing) const LinearProgressIndicator(minHeight: 2),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(padding: const EdgeInsets.fromLTRB(12, 10, 12, 20), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                        // Collection status, with the count under the other filters
                        SizedBox(
                          height: 40,
                          child: ListView(scrollDirection: Axis.horizontal, children: [
                            for (final s in _stateTabs)
                              Padding(
                                padding: const EdgeInsetsDirectional.only(end: 6),
                                child: ChoiceChip(
                                  label: Text('${tr(s.$3, s.$4)}${_stateCounts[s.$2] != null ? '  ${_m(_stateCounts[s.$2])}' : ''}'),
                                  selected: _collected == s.$1,
                                  onSelected: (_) { setState(() => _collected = s.$1); _refilter(); },
                                ),
                              ),
                          ]),
                        ),
                        const SizedBox(height: 8),
                        _stats(),
                        const SizedBox(height: 10),
                        Row(children: [
                          Expanded(
                            child: SearchField(
                              controller: _search,
                              dense: true,
                              hint: _cash ? tr('رقم أمر النقل أو العميل أو السند…', 'report no., customer, voucher…') : tr('رقم الفاتورة أو العميل…', 'invoice no., customer…'),
                              onChanged: (v) {
                                _deb?.cancel();
                                _deb = Timer(const Duration(milliseconds: 350), () { _q = v.trim(); _refilter(); });
                              },
                            ),
                          ),
                          const SizedBox(width: 6),
                          Badge(
                            isLabelVisible: _activeCount > 0,
                            label: Text('$_activeCount'),
                            child: IconButton.filledTonal(icon: const Icon(Icons.tune_rounded), onPressed: _openFilters),
                          ),
                        ]),
                        const SizedBox(height: 8),
                        // Selection: deliver together, and export, statement and send for the selection
                        Row(children: [
                          Checkbox(value: allOn, onChanged: (_) => setState(() {
                            if (allOn) { _selected.clear(); } else { _selected.addAll(_rows.map(_keyOf)); }
                          })),
                          Text(_selected.isEmpty ? tr('تحديد الصفحة', 'Select page') : tr('محدَّد: ${_selected.length}', '${_selected.length} selected'),
                              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                          const Spacer(),
                          if (_selected.isNotEmpty && collectionsCanEdit)
                            TextButton.icon(onPressed: () => _collectMany(selRows), icon: const Icon(Icons.payments_outlined, size: 18), label: Text(tr('تحصيل بالكامل', 'Collect in full'))),
                            TextButton.icon(onPressed: () => _deliver(selRows), icon: const Icon(Icons.local_shipping_outlined, size: 18),
                                label: Text(tr('تسليم المحدَّد', 'Deliver selected'))),
                          if (_selected.isNotEmpty)
                            IconButton(tooltip: tr('إلغاء التحديد', 'Clear selection'), icon: const Icon(Icons.close), onPressed: () => setState(() => _selected.clear())),
                        ]),
                        if (_rows.isEmpty)
                          EmptyState(icon: Icons.receipt_long_outlined, title: _activeCount > 0 || _q.isNotEmpty ? tr('لا نتائج للفلتر المحدد', 'No rows match the filters') : tr('لا نتائج', 'No results')),
                        if (_rows.isEmpty && _elsewhere != null) _elsewhereHint(_elsewhere!),
                        for (final r in _rows) _row(r),
                        if (_pages > 1)
                          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                            OutlinedButton(onPressed: _page <= 1 ? null : () { setState(() { _page--; _selected.clear(); }); _load(); }, child: Text(tr('السابق', 'Prev'))),
                            Text(tr('صفحة $_page من $_pages · ${_m(_total)}', 'Page $_page of $_pages · ${_m(_total)}'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                            OutlinedButton(onPressed: _page >= _pages ? null : () { setState(() { _page++; _selected.clear(); }); _load(); }, child: Text(tr('التالي', 'Next'))),
                          ]),
                      ]),
                    ),
                  ),
                ]),
    );
  }
}

/// Dropdown with search; customer lists run to hundreds.
class _SearchPick extends StatefulWidget {
  final String title;
  final List<String> options;
  const _SearchPick({required this.title, required this.options});
  @override
  State<_SearchPick> createState() => _SearchPickState();
}

class _SearchPickState extends State<_SearchPick> {
  String _q = '';
  @override
  Widget build(BuildContext context) {
    final q = _q.toLowerCase();
    final list = widget.options.where((o) => q.isEmpty || o.toLowerCase().contains(q)).toList();
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.75,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: SearchField(
              autofocus: true,
              dense: true,
              hint: widget.title,
              onChanged: (v) => setState(() => _q = v.trim()),
            ),
          ),
          if (list.isEmpty && q.isNotEmpty)
            Padding(padding: const EdgeInsets.all(20), child: Text(tr('لا نتائج مطابقة', 'No matches'), style: const TextStyle(color: T.inkFaint))),
          Expanded(
            child: ListView.builder(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              itemCount: list.length,
              itemBuilder: (c, i) => ListTile(title: Text(list[i]), onTap: () => Navigator.pop(context, list[i])),
            ),
          ),
        ]),
      ),
    );
  }
}

// Tax invoice detail: all its sheets with their numbers, the follow-ups of each sheet, and its attachments. The counterpart of /system/collections-dept/invoices/tax/[invoiceNumber].
class CollectionsTaxInvoiceScreen extends StatefulWidget {
  final String invoiceNumber;
  const CollectionsTaxInvoiceScreen({super.key, required this.invoiceNumber});
  @override
  State<CollectionsTaxInvoiceScreen> createState() => _CollectionsTaxInvoiceScreenState();
}

class _CollectionsTaxInvoiceScreenState extends State<CollectionsTaxInvoiceScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  String _openFu = '';
  int _seq = 0;
  late final void Function(dynamic) _onCustoms;
  late final void Function(dynamic) _onFu;

  @override
  void initState() {
    super.initState();
    _load();
    // Linking its sheets to clearance changes from operations or from the transaction page.
    _onCustoms = (d) { if (d is Map && d['source'] == 'customs-link') _load(); };
    // Follow-ups of its sheets are also written from operations and clearance; the count follows.
    _onFu = (d) {
      final inv = d is Map ? '${d['invoiceNumber'] ?? ''}' : '';
      if (inv.isEmpty || inv == widget.invoiceNumber) _load();
    };
    Live.instance.onData('collections:changed', _onCustoms);
    Live.instance.onData('workflow:followUps', _onFu);
  }

  @override
  void dispose() {
    Live.instance.offData('collections:changed', _onCustoms);
    Live.instance.offData('workflow:followUps', _onFu);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/collections-dept/invoices/tax/${Uri.encodeComponent(widget.invoiceNumber)}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d as Map); _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e is ApiException ? e.message : '$e');
    }
  }

  // Collecting the invoice from its own page, the counterpart of CollectionPanel on the web. A cash invoice in the ledger with no sheet appears in neither the cash nor the tax list, so this screen is the only door to collect it. The server knows where to write by its number.
  Widget _collectionCard(Map<String, dynamic> c) {
    final st = _s(c, 'collectionState');
    final full = st == 'full';
    final chip = full
        ? (tr('محصَّلة بالكامل', 'Fully collected'), T.success)
        : st == 'partial' ? (tr('محصَّلة جزئيًّا', 'Partly collected'), T.warn) : (tr('لم تُحصَّل', 'Not collected'), T.danger);
    final row = {
      ...c,
      'invoiceNumber': widget.invoiceNumber,
      'fullyCollected': full,
      'remaining': c['remaining'],
    };
    return AppCard(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Text(tr('التحصيل', 'Collection'), style: const TextStyle(fontWeight: FontWeight.w800)),
          Chip2(chip.$1, chip.$2),
          if (full && _s(c, 'collectionDate').isNotEmpty) Text('${tr('بتاريخ', 'on')} ${_dt(c['collectionDate'])}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
        ]),
        const SizedBox(height: 4),
        Text('${tr('القيمة', 'Value')} ${_m(c['value'])} · ${tr('المحصَّل', 'Collected')} ${_m(c['collectedAmount'])}'
            '${!full && _num(c['value']) > 0 ? ' · ${tr('الباقي', 'Remaining')} ${_m(c['remaining'])}' : ''}',
            style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
        if (_s(c, 'target') == 'cashLedger')
          Text(tr('فاتورةٌ نقديّةٌ في دفتر التحصيل بلا أمر نقل', 'A cash book invoice with no operations report'),
              style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
        if (collectionsCanEdit) ...[
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 6, children: [
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: T.success),
              icon: const Icon(Icons.payments_outlined, size: 18),
              label: Text(full ? tr('تعديل تاريخ التحصيل', 'Change date') : tr('تسجيل التحصيل', 'Record collection')),
              onPressed: () async { if (await openCollectSheet(context, isCash: false, row: row)) _load(); },
            ),
            if (full || st == 'partial')
              OutlinedButton(
                style: OutlinedButton.styleFrom(foregroundColor: T.danger),
                onPressed: _undo,
                child: Text(tr('لم تُحصَّل', 'Not collected')),
              ),
          ]),
        ],
      ]),
    );
  }

  Future<void> _undo() async {
    final ctrl = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('لم تُحصَّل', 'Not collected')),
        content: TextField(controller: ctrl, decoration: InputDecoration(labelText: tr('السبب (اختياري)', 'Reason (optional)'))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('تراجع', 'Back'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, ctrl.text.trim()),
              child: Text(tr('تأكيد: لم تُحصَّل', 'Confirm: not collected'))),
        ],
      ),
    );
    ctrl.dispose();
    if (reason == null || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      final res = await Api.instance.post('/api/collections-dept/invoices/uncollect', {'invoiceNumber': widget.invoiceNumber, 'reason': reason});
      messenger.showSnackBar(SnackBar(content: Text(res is Map && '${res['message'] ?? ''}'.isNotEmpty ? '${res['message']}' : tr('رُفع التحصيل', 'Collection undone'))));
      _load();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر الحفظ', 'Could not save'))));
    }
  }

  List<ExportCol> get _cols => [
        ExportCol('رقم أمر النقل', 'Report no.', (r) => r['reportNumber']),
        ExportCol('التاريخ', 'Date', (r) => _dt(r['reportDate'])),
        ExportCol('من', 'From', (r) => r['fromLocation']),
        ExportCol('إلى', 'To', (r) => r['toLocation']),
        ExportCol('الفرع', 'Branch', (r) => r['branch']),
        ExportCol('رقم السيارة', 'Vehicle', (r) => r['carNumber']),
        ExportCol('معاملة التخليص', 'Clearance', (r) => r['customs'] is Map ? '${(r['customs'] as Map)['refNumber'] ?? ''}' : ''),
        ExportCol('صافي الفاتورة', 'Net', (r) => r['netInvoice']),
        ExportCol('ضريبة', 'VAT', (r) => r['tax']),
        ExportCol('إجمالي الفاتورة', 'Total', (r) => r['totalInvoice']),
        ExportCol('تاريخ التسليم', 'Delivered', (r) => _dt(r['deliveryDate'])),
        ExportCol('تاريخ التحصيل', 'Collected', (r) => _dt(r['collectionDate'])),
      ];

  Widget _stat(String l, String v, [Color c = T.ink]) => Expanded(
        child: AppCard(
          padding: const EdgeInsets.all(10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(l, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            Text(v, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: c)),
          ]),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final reports = [for (final r in (d?['reports'] as List? ?? const [])) Map<String, dynamic>.from(r as Map)];
    final t = (d?['totals'] as Map?) ?? const {};
    final allCollected = _num(t['reports']) > 0 && _num(t['collectedReports']) == _num(t['reports']);
    return AppScaffold(
      title: Text('${tr('فاتورة', 'Invoice')} ${widget.invoiceNumber}'),
      actions: [
        if (reports.isNotEmpty)
          ExportButton(fileName: 'invoice-${widget.invoiceNumber}', sheetName: tr('أوامر النقل', 'Reports'), columns: _cols, rows: () => reports),
      ],
      body: d == null && _error == null
          ? const Center(child: CircularProgressIndicator())
          : d == null
              ? ErrorRetry(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(12), children: [
                    Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                      InkWell(
                        onTap: _s(d, 'partyId').isEmpty ? null
                            : () => Navigator.push(context, MaterialPageRoute(builder: (_) => CollectionsPartyScreen(id: _s(d, 'partyId')))),
                        child: Text(_s(d, 'customer'), style: TextStyle(fontWeight: FontWeight.w800, color: _s(d, 'partyId').isEmpty ? T.ink : T.orange)),
                      ),
                      if (_s(d, 'invoiceDate').isNotEmpty) Text('· ${_dt(d['invoiceDate'])}', style: const TextStyle(color: T.inkFaint)),
                      if (_s(d, 'kind') == 'cash') Chip2(tr('نقديّة', 'Cash'), T.success),
                    ]),
                    const SizedBox(height: 10),
                    Row(children: [
                      _stat(tr('عدد أوامر النقل', 'Reports'), _m(t['reports'])),
                      const SizedBox(width: 6),
                      _stat(tr('صافي الفواتير', 'Net'), _m(t['net'])),
                      const SizedBox(width: 6),
                      _stat(tr('الضريبة', 'VAT'), _m(t['vat'])),
                    ]),
                    const SizedBox(height: 6),
                    Row(children: [
                      _stat(tr('القيمة', 'Value'), _m(t['value'])),
                      const SizedBox(width: 6),
                      _stat(tr('المحصَّل منها', 'Collected'), '${t['collectedReports'] ?? 0} / ${t['reports'] ?? 0}', allCollected ? T.success : T.danger),
                    ]),
                    if (d['collection'] is Map) ...[
                      const SizedBox(height: 10),
                      _collectionCard(Map<String, dynamic>.from(d['collection'] as Map)),
                    ],
                    if (d['customs'] is List && (d['customs'] as List).isNotEmpty) ...[
                      const SizedBox(height: 10),
                      AppCard(
                        padding: const EdgeInsets.all(12),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('التخليص الجمركي', 'Customs clearance'), style: const TextStyle(fontWeight: FontWeight.w800)),
                          const SizedBox(height: 6),
                          for (final c in (d['customs'] as List).whereType<Map>())
                            Padding(
                              padding: const EdgeInsets.only(bottom: 4),
                              child: Wrap(spacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                                CustomsLinkChip(c),
                                if ('${c['customerName'] ?? ''}'.isNotEmpty) Text('${c['customerName']}', style: const TextStyle(fontSize: 12)),
                                Text(tr('· ${c['reports'] ?? 1} من أوامر النقل', '· ${c['reports'] ?? 1} report(s)'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                              ]),
                            ),
                        ]),
                      ),
                    ],
                    const SizedBox(height: 12),
                    Text(tr('أوامر نقل هذه الفاتورة', 'Reports under this invoice'), style: const TextStyle(fontWeight: FontWeight.w800)),
                    const SizedBox(height: 6),
                    if (reports.isEmpty)
                      AppCard(child: Text(d['inLedger'] == true
                          ? tr('فاتورةٌ من دفتر التحصيل، لا أوامر نقلٍ مرتبطةً بها.', 'A ledger invoice with no linked operations reports.')
                          : tr('لا أوامر نقل تحت هذه الفاتورة.', 'No reports under this invoice.'), style: const TextStyle(color: T.inkSoft))),
                    for (final r in reports)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: AppCard(
                          padding: const EdgeInsets.all(12),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Expanded(
                                child: InkWell(
                                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => OpsWorkflowDetailScreen(id: _s(r, '_id')))),
                                  child: Text(_s(r, 'reportNumber').isEmpty ? '—' : _s(r, 'reportNumber'),
                                      style: const TextStyle(fontWeight: FontWeight.w800, color: T.orange)),
                                ),
                              ),
                              Text(_m(r['totalInvoice']), style: const TextStyle(fontWeight: FontWeight.w900)),
                            ]),
                            const SizedBox(height: 3),
                            Text([_dt(r['reportDate']), [_s(r, 'fromLocation'), _s(r, 'toLocation')].where((x) => x.isNotEmpty).join(' — '), _s(r, 'branch'), _s(r, 'carNumber')]
                                .where((x) => x.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                            const SizedBox(height: 5),
                            Wrap(spacing: 6, runSpacing: 4, children: [
                              Chip2('${tr('الصافي', 'Net')} ${_m(r['netInvoice'])} · ${tr('الضريبة', 'VAT')} ${_m(r['tax'])}', T.inkSoft),
                              if (_s(r, 'deliveryDate').isNotEmpty) Chip2('${tr('التسليم', 'Delivered')} ${_dt(r['deliveryDate'])}', T.info),
                              _s(r, 'collectionDate').isNotEmpty
                                  ? Chip2('${tr('حُصّل', 'Collected')} ${_dt(r['collectionDate'])}', T.success)
                                  : Chip2(tr('لم يُحصَّل', 'open'), T.danger),
                              if (r['customs'] is Map) CustomsLinkChip(r['customs'], compact: true),
                              ActionChip(
                                avatar: const Icon(Icons.forum_outlined, size: 15),
                                label: Text('${tr('المتابعة', 'Follow-up')} ${r['followUps'] ?? 0}'),
                                onPressed: () => setState(() => _openFu = _openFu == _s(r, '_id') ? '' : _s(r, '_id')),
                              ),
                            ]),
                            if (_openFu == _s(r, '_id')) ...[
                              const Divider(),
                              Text(tr('متابعات أمر النقل ${_s(r, 'reportNumber')}', 'Follow-ups — ${_s(r, 'reportNumber')}'),
                                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                              ReportFollowUpsView(basePath: '/api/collections-dept/reports/${_s(r, '_id')}/follow-ups', workflowId: _s(r, '_id')),
                            ],
                          ]),
                        ),
                      ),
                    if (reports.isNotEmpty)
                      AppCard(
                        padding: const EdgeInsets.all(12),
                        child: Text(
                          '${tr('الإجمالي', 'Total')}: ${tr('الصافي', 'Net')} ${_m(reports.fold<num>(0, (a, r) => a + _num(r['netInvoice'])))}'
                          ' · ${tr('الضريبة', 'VAT')} ${_m(reports.fold<num>(0, (a, r) => a + _num(r['tax'])))}'
                          ' · ${tr('الإجمالي', 'Total')} ${_m(reports.fold<num>(0, (a, r) => a + _num(r['totalInvoice'])))}',
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                      ),
                    const SizedBox(height: 10),
                    // Invoice papers: the signed copy, the receipt of delivery and what is claimed.
                    OutlinedButton.icon(
                      icon: const Icon(Icons.attach_file_rounded, color: T.orange),
                      label: Text(tr('مرفقات الفاتورة', 'Invoice attachments')),
                      onPressed: () => openCollectionAttachments(context, kind: 'tax', key: widget.invoiceNumber, label: widget.invoiceNumber),
                    ),
                  ]),
                ),
    );
  }
}
