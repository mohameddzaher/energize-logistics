import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'customs_detail.dart';
import '../ui/search_field.dart';

/// Customs transactions, counterpart of `/system/customs` on the web (page.tsx).
/// As on the web: all transactions in one batch and the filters run on the device (year, month, status, invoicing, return, customer, agent, port, branch, stage, period). Search covers the row contents here and the rest through the server index (`?ids=1&search=`). The upcoming-transactions button shows the count of those nearing their date, notes are written from the row, and export uses the same columns (displayed or all). Live on customs:created / customs:updated / customs:deleted.
class CustomsListScreen extends StatefulWidget {
  const CustomsListScreen({super.key});
  @override
  State<CustomsListScreen> createState() => _CustomsListScreenState();
}

List<Map<String, dynamic>> _maps(dynamic v) =>
    v is List ? [for (final e in v) if (e is Map) Map<String, dynamic>.from(e)] : [];
String _s(Map r, String k) => '${r[k] ?? ''}';
num _n(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;
String _money(dynamic v) => _n(v).round().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
String _ymd(DateTime d) => d.toIso8601String().substring(0, 10);

/// Same folding as on the server (utils/arabicSearch · searchKey).
String _key(dynamic v) {
  var s = '${v ?? ''}';
  const ar = '٠١٢٣٤٥٦٧٨٩', fa = '۰۱۲۳۴۵۶۷۸۹';
  for (var i = 0; i < 10; i++) {
    s = s.replaceAll(ar[i], '$i').replaceAll(fa[i], '$i');
  }
  return s.toLowerCase()
      .replaceAll(RegExp('[ً-ْٰـ]'), '')
      .replaceAll(RegExp('[أإآٱ]'), 'ا')
      .replaceAll('ة', 'ه')
      .replaceAll(RegExp('[ىئ]'), 'ي')
      .replaceAll('ؤ', 'و')
      .replaceAll(RegExp(r'''[\s\-_./\\,:;#|'"()\[\]{}–—]+'''), '');
}

bool _matches(String text, List<dynamic> values) {
  final whole = _key(text);
  if (whole.isEmpty) return true;
  final keys = values.where((v) => v != null && '$v'.isNotEmpty).map(_key).toList();
  if (keys.any((k) => k.contains(whole))) return true;
  final words = text.trim().split(RegExp(r'\s+')).map(_key).where((w) => w.isNotEmpty).toList();
  return words.length > 1 && words.every((w) => keys.any((k) => k.contains(w)));
}

const _months = [
  ('يناير', 'January'), ('فبراير', 'February'), ('مارس', 'March'), ('أبريل', 'April'),
  ('مايو', 'May'), ('يونيو', 'June'), ('يوليو', 'July'), ('أغسطس', 'August'),
  ('سبتمبر', 'September'), ('أكتوبر', 'October'), ('نوفمبر', 'November'), ('ديسمبر', 'December'),
];

const _returnLabel = {
  'returned': ('أُرجعت', 'Returned'), 'overdue': ('متأخّرة الإرجاع', 'Overdue'),
  'due': ('يقترب موعدها', 'Due soon'), 'open': ('في المهلة', 'Within window'), 'none': ('بلا موعد', 'No deadline'),
};

/// The five papers of an upcoming transaction, the same list as the required-papers `documents`.
const customsDocKeys = [
  ('bl', 'البوليصة', 'Bill of lading'),
  ('commercialInvoice', 'الفاتورة', 'Invoice'),
  ('certificateOfOrigin', 'شهادة المنشأ', 'Certificate of origin'),
  ('packingList', 'بيان التعبئة', 'Packing list'),
  ('saber', 'سابر', 'SABER'),
];

const _editRoles = ['super_admin', 'admin', 'operations_manager', 'customs_manager', 'customs_officer'];
const _deleteRoles = ['super_admin', 'admin', 'customs_manager', 'customs_officer'];

class _CustomsListScreenState extends State<CustomsListScreen> {
  List<Map<String, dynamic>> _list = [];
  bool _loading = true;
  String? _error;
  Map<String, dynamic> _alerts = const {'count': 0, 'days': 2, 'upcoming': [], 'total': 0};
  List<Map<String, dynamic>> _customers = [], _agents = [];
  final TextEditingController _search = TextEditingController();
  Set<String>? _hits;
  String _hitsQ = '';
  Timer? _debounce;
  int _seq = 0, _searchSeq = 0;
  // Filters, named as on the web.
  final Map<String, String> _f = {};
  late final void Function() _onCreated;
  late final void Function(dynamic) _onUpdated;

  @override
  void initState() {
    super.initState();
    _load();
    _loadAlerts();
    _loadParties();
    _onCreated = () { _load(); _loadAlerts(); };
    // Editing an upcoming transaction does not touch the ongoing table; the dialog is enough, as on the web.
    _onUpdated = (p) {
      final c = p is Map && p['clearance'] is Map ? p['clearance'] as Map : null;
      if (c?['upcoming'] != true) _load();
      _loadAlerts();
    };
    Live.instance.on('customs:created', _onCreated);
    Live.instance.on('customs:deleted', _onCreated);
    Live.instance.onData('customs:updated', _onUpdated);
  }

  @override
  void dispose() {
    Live.instance.off('customs:created', _onCreated);
    Live.instance.off('customs:deleted', _onCreated);
    Live.instance.offData('customs:updated', _onUpdated);
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/customs-clearance');
      if (!mounted || mine != _seq) return;
      setState(() { _list = _maps(d['clearances']); _loading = false; _error = null; });
      // The server search is repeated with every list read, as on the web (refreshKey).
      if (_search.text.trim().isNotEmpty) _runServerSearch();
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _loadAlerts() async {
    try {
      final d = await Api.instance.get('/api/customs-clearance/upcoming-alerts');
      if (mounted && d is Map) setState(() => _alerts = Map<String, dynamic>.from(d));
    } catch (_) {/* */}
  }

  Future<void> _loadParties() async {
    try {
      final r = await Future.wait([
        Api.instance.get('/api/customs-clearance/parties?kind=customer'),
        Api.instance.get('/api/customs-clearance/parties?kind=agent'),
      ]);
      if (mounted) setState(() { _customers = _maps(r[0]['parties']); _agents = _maps(r[1]['parties']); });
    } catch (_) {/* */}
  }

  void _onSearch(String v) {
    _debounce?.cancel();
    setState(() {});
    if (_key(v).isEmpty) { _searchSeq++; setState(() => _hits = null); return; }
    _debounce = Timer(const Duration(milliseconds: 250), _runServerSearch);
  }

  Future<void> _runServerSearch() async {
    final q = _search.text.trim();
    if (_key(q).isEmpty) return;
    final mine = ++_searchSeq;
    try {
      final r = await Api.instance.get('/api/customs-clearance?ids=1&search=${Uri.encodeQueryComponent(q)}');
      if (!mounted || mine != _searchSeq) return;
      setState(() { _hits = {for (final x in (r['ids'] as List? ?? const [])) '$x'}; _hitsQ = q; });
    } catch (_) {/* Local search remains. */}
  }

  // Values derived from the row, identical to the web.
  bool _invoiced(Map r) => r['invoiced'] == true || _s(r, 'saleInvoiceNumber').isNotEmpty;
  (String, String) _invoiceState(Map r) {
    if (_s(r, 'saleInvoiceNumber').isNotEmpty) return (tr('مفوترة', 'Invoiced'), _s(r, 'saleInvoiceNumber'));
    final b = r['billing'] is Map ? r['billing'] as Map : const {};
    return ('${b['invoiceStatus'] ?? ''}'.trim(), '${b['ourInvoiceNumber'] ?? ''}');
  }

  String _stateOf(Map r) => r['cancelled'] == true ? 'cancelled' : r['upcoming'] == true ? 'upcoming'
      : r['isCompleted'] == true ? (_invoiced(r) ? 'closedInvoiced' : 'closedNotInvoiced')
          : (_invoiced(r) ? 'openInvoiced' : 'openNotInvoiced');

  String _stageText(Map r) {
    final p = r['pipeline'] is Map ? r['pipeline'] as Map : const {};
    if (r['cancelled'] == true) return tr('ملغاة', 'Cancelled');
    if (r['isCompleted'] == true) return _invoiced(r) ? tr('مغلقة مفوترة', 'Closed · invoiced') : tr('مغلقة لم تُفوتَر', 'Closed · not invoiced');
    final next = '${p['next'] ?? ''}';
    if (next.isNotEmpty) return '${tr('تنتظر', 'Next')}: ${customsStageLabel(next, _s(r, 'cargoType'))}';
    return customsStageLabel(_s(r, 'stage'), _s(r, 'cargoType'));
  }

  String _returnState(Map r) {
    final done = r['stageDone'] is Map && (r['stageDone'] as Map)['containersReturned'] == true;
    if (done) return 'returned';
    // Same rule as the dashboard: only an open containers transaction can be late to return.
    if (r['cancelled'] == true || r['isCompleted'] == true || _s(r, 'cargoType') == 'vehicles') return 'none';
    final d = _s(r, 'returnDeadline');
    if (d.length < 10) return 'none';
    final today = _ymd(DateTime.now());
    if (d.substring(0, 10).compareTo(today) < 0) return 'overdue';
    final soon = _ymd(DateTime.now().add(const Duration(days: 7)));
    return d.substring(0, 10).compareTo(soon) <= 0 ? 'due' : 'open';
  }

  String _period(Map r) {
    final m = _n(r['periodMonth']).toInt();
    if (m >= 1 && m <= 12) return '${tr(_months[m - 1].$1, _months[m - 1].$2)} ${_s(r, 'periodYear')}'.trim();
    return _s(r, 'periodYear');
  }

  List<Map<String, dynamic>> get _filtered {
    final q = _search.text.trim();
    final hits = _hits != null && _hitsQ == q ? _hits : null;
    final f = _f;
    return _list.where((c) {
      if (q.isNotEmpty) {
        final local = _matches(q, [
          c['refNumber'], c['blNumber'], c['customerName'], c['shippingAgent'], c['invoiceNumber'], c['port'],
          c['declarationNumber'], c['billing'] is Map ? (c['billing'] as Map)['ourInvoiceNumber'] : null, c['saleInvoiceNumber'],
          c['exporterCompany'], c['city'], c['containerNumbers'] is List ? (c['containerNumbers'] as List).join(' ') : c['containerNumbers'],
          c['lastNote'] is Map ? (c['lastNote'] as Map)['text'] : null,
        ]);
        if (!local && !(hits?.contains('${c['_id']}') ?? false)) return false;
      }
      final st = f['state'] ?? '';
      if (st.isNotEmpty) {
        final done = c['isCompleted'] == true, cancelled = c['cancelled'] == true;
        if (st == 'closed' ? (!done || cancelled) : st == 'open' ? (done || cancelled || c['upcoming'] == true) : _stateOf(c) != st) return false;
      }
      if ((f['year'] ?? '').isNotEmpty && _s(c, 'periodYear') != f['year']) return false;
      if ((f['month'] ?? '').isNotEmpty && _s(c, 'periodMonth') != f['month']) return false;
      final inv = f['invoice'] ?? '';
      if (inv == '__none') {
        if (_invoiceState(c).$1.isNotEmpty) return false;
      } else if (inv == '__awaiting') {
        if (c['awaitingTransportInvoice'] != true) return false;
      } else if (inv.isNotEmpty && _invoiceState(c).$1 != inv) {
        return false;
      }
      if ((f['return'] ?? '').isNotEmpty && _returnState(c) != f['return']) return false;
      if ((f['customer'] ?? '').isNotEmpty && _s(c, 'customerParty') != f['customer']) return false;
      if ((f['agent'] ?? '').isNotEmpty && _s(c, 'agentParty') != f['agent']) return false;
      if ((f['port'] ?? '').isNotEmpty && _s(c, 'port') != f['port']) return false;
      if ((f['branch'] ?? '').isNotEmpty && _s(c, 'branch') != f['branch']) return false;
      if ((f['stage'] ?? '').isNotEmpty) {
        final next = c['pipeline'] is Map ? '${(c['pipeline'] as Map)['next'] ?? ''}' : '';
        if (c['isCompleted'] == true || c['cancelled'] == true || next != f['stage']) return false;
      }
      // Range is by transaction date, not by entry date.
      final from = f['from'] ?? '', to = f['to'] ?? '';
      if (from.isNotEmpty || to.isNotEmpty) {
        final d = _s(c, 'date').isNotEmpty ? _s(c, 'date') : (_s(c, 'createdAt').length >= 10 ? _s(c, 'createdAt').substring(0, 10) : '');
        if (d.isEmpty) return false;
        if (from.isNotEmpty && d.compareTo(from) < 0) return false;
        if (to.isNotEmpty && d.compareTo(to) > 0) return false;
      }
      return true;
    }).toList();
  }

  // Export: the same columns as the web.
  List<ExportCol> _exportCols(bool seesMoney) => [
        ExportCol('رقم البوليصة', 'BL number', (r) => _s(r, 'blNumber').isEmpty ? '—' : r['blNumber']),
        ExportCol('رقم المعاملة', 'Ref number', (r) => r['refNumber'] ?? ''),
        ExportCol('اسم العميل', 'Customer', (r) => _s(r, 'customerName').isEmpty ? '—' : r['customerName']),
        ExportCol('الفرع', 'Branch', (r) => r['branch'] == 'dammam' ? tr('الدمام', 'Dammam') : tr('جدة', 'Jeddah')),
        ExportCol('المدينة', 'City', (r) => _s(r, 'city').isEmpty ? '—' : r['city']),
        ExportCol('الشهر', 'Month', (r) {
          final m = _n(r['periodMonth']).toInt();
          return m >= 1 && m <= 12 ? tr(_months[m - 1].$1, _months[m - 1].$2) : '—';
        }),
        ExportCol('السنة', 'Year', (r) => _s(r, 'periodYear').isEmpty ? '—' : r['periodYear']),
        ExportCol('وكيل الشحن', 'Shipping agent', (r) => _s(r, 'shippingAgent').isEmpty ? '—' : r['shippingAgent']),
        ExportCol('رقم البيان', 'Declaration no.', (r) => _s(r, 'declarationNumber').isEmpty ? '—' : r['declarationNumber']),
        ExportCol('تاريخ التفريغ', 'Unloading date', (r) => _s(r, 'unloadingAppointment').length >= 10 ? _s(r, 'unloadingAppointment').substring(0, 10) : '—'),
        ExportCol('نوع المعاملة', 'Type', (r) => r['cargoType'] == 'vehicles' ? tr('سيّارات', 'Vehicles') : tr('حاويات', 'Containers')),
        ExportCol('العدد', 'Units', (r) => _n(r['containerCount'])),
        ExportCol('إجمالي المصروفات', 'Total costs', (r) => _n(r['costs'] is Map ? r['costs']['total'] : 0)),
        ExportCol('أجور التخليص', 'Clearance fee', (r) => _n(r['revenue'] is Map ? r['revenue']['clearanceFee'] : 0)),
        ExportCol('إجمالي الفاتورة', 'Total invoiced', (r) => _n(r['revenue'] is Map ? r['revenue']['totalInvoiced'] : 0)),
        if (seesMoney) ExportCol('صافي الربح', 'Net profit', (r) => _n(r['revenue'] is Map ? r['revenue']['profit'] : 0)),
        ExportCol('أيّام السماح للإرجاع', 'Return free days', (r) => _s(r, 'returnFreeDays').isEmpty || r['returnFreeDays'] == 0 ? '—' : r['returnFreeDays']),
        ExportCol('آخر موعد إرجاع', 'Return deadline', (r) => _s(r, 'returnDeadline').isEmpty ? '—' : r['returnDeadline']),
        ExportCol('حالة الإرجاع', 'Return state', (r) { final x = _returnLabel[_returnState(r)]!; return tr(x.$1, x.$2); }),
        ExportCol('حالة الفاتورة', 'Invoice status', (r) {
          final s = _invoiceState(r).$1;
          if (s.isEmpty) return tr('غير مفوترة', 'Not invoiced');
          return '$s${r['awaitingTransportInvoice'] == true ? tr(' — بانتظار فاتورة النقل', ' — awaiting transport invoice') : ''}';
        }),
        ExportCol('رقم فاتورتنا', 'Our invoice no.', (r) => _invoiceState(r).$2.isEmpty ? '—' : _invoiceState(r).$2),
        ExportCol('المرحلة', 'Stage', (r) => _stageText(r)),
        ExportCol('نسبة المراحل', 'Progress', (r) => '${r['pipeline'] is Map ? (r['pipeline']['percent'] ?? 0) : 0}%'),
      ];

  Future<void> _export(bool seesMoney, List<Map<String, dynamic>> shown) async {
    final pick = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.filter_alt_outlined), title: Text('${tr('المعروض', 'Shown')} (${shown.length})'), onTap: () => Navigator.pop(c, 'shown')),
          ListTile(leading: const Icon(Icons.select_all), title: Text('${tr('الكلّ', 'All')} (${_list.length})'), onTap: () => Navigator.pop(c, 'all')),
        ]),
      ),
    );
    if (pick == null || !mounted) return;
    final rows = pick == 'all' ? _list : shown;
    await exportExcel(context, fileName: 'customs-clearances', sheets: [(tr('التخليص الجمركي', 'Customs Clearance'), _exportCols(seesMoney), rows)]);
  }

  // Filters.
  Future<void> _openFilters() async {
    final years = {for (final c in _list) if (_s(c, 'periodYear').isNotEmpty) _s(c, 'periodYear')}.toList()..sort((a, b) => b.compareTo(a));
    final invoiceStatuses = {for (final c in _list) if (_invoiceState(c).$1.isNotEmpty) _invoiceState(c).$1}.toList()..sort();
    final ports = {for (final c in _list) if (_s(c, 'port').isNotEmpty) _s(c, 'port')}.toList();
    final stages = {for (final c in _list) if (c['pipeline'] is Map && '${c['pipeline']['next'] ?? ''}'.isNotEmpty) '${c['pipeline']['next']}'}.toList();
    final awaitingCount = _list.where((c) => c['awaitingTransportInvoice'] == true).length;
    final overdueCount = _list.where((c) => _returnState(c) == 'overdue').length;
    final draft = Map<String, String>.of(_f);
    final res = await showModalBottomSheet<Map<String, String>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (c) => StatefulBuilder(builder: (c, setSt) {
        Widget sel(String k, String label, List<(String, String)> opts) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: DropdownButtonFormField<String>(
                key: ValueKey('$k-${draft[k] ?? ''}'),
                initialValue: opts.any((o) => o.$1 == (draft[k] ?? '')) ? (draft[k] ?? '') : '',
                isExpanded: true,
                decoration: InputDecoration(isDense: true, labelText: label, border: const OutlineInputBorder()),
                items: [for (final o in opts) DropdownMenuItem(value: o.$1, child: Text(o.$2, overflow: TextOverflow.ellipsis))],
                onChanged: (v) => setSt(() => (v ?? '').isEmpty ? draft.remove(k) : draft[k] = v!),
              ),
            );
        Widget date(String k, String label) => Expanded(
              child: OutlinedButton(
                onPressed: () async {
                  final d = await showDatePicker(context: c, initialDate: DateTime.tryParse(draft[k] ?? '') ?? DateTime.now(),
                      firstDate: DateTime(2018), lastDate: DateTime(2100));
                  if (d != null) setSt(() => draft[k] = _ymd(d));
                },
                onLongPress: () => setSt(() => draft.remove(k)),
                child: Text('$label: ${draft[k] ?? '—'}', style: const TextStyle(fontSize: 12)),
              ),
            );
        return Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(child: Text(tr('فلتر', 'Filter'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
              TextButton(onPressed: () => setSt(draft.clear), child: Text(tr('مسح', 'Clear'))),
            ]),
            const SizedBox(height: 8),
            Flexible(
              child: ListView(shrinkWrap: true, children: [
                sel('year', tr('السنة', 'Year'), [('', tr('جميع السنوات', 'All years')), for (final y in years) (y, y)]),
                sel('month', tr('الشهر', 'Month'), [('', tr('جميع الأشهر', 'All months')), for (var i = 0; i < 12; i++) ('${i + 1}', tr(_months[i].$1, _months[i].$2))]),
                sel('state', tr('حالة المعاملة', 'Transaction state'), [
                  ('', tr('كلّ الحالات', 'All states')), ('open', tr('مفتوحة', 'Open')),
                  ('openNotInvoiced', tr('مفتوحة لم تُفوتَر', 'Open · not invoiced')), ('openInvoiced', tr('مفتوحة مفوترة', 'Open · invoiced')),
                  ('closed', tr('مغلقة (الكلّ)', 'Closed (all)')), ('closedInvoiced', tr('مغلقة مفوترة', 'Closed · invoiced')),
                  ('closedNotInvoiced', tr('مغلقة لم تُفوتَر', 'Closed · not invoiced')), ('upcoming', tr('قادمة', 'Upcoming')), ('cancelled', tr('ملغاة', 'Cancelled')),
                ]),
                sel('invoice', tr('حالة الفاتورة', 'Invoice status'), [
                  ('', tr('جميع حالات الفاتورة', 'All invoice statuses')), for (final s in invoiceStatuses) (s, s),
                  ('__awaiting', '${tr('مفوترة بانتظار فاتورة النقل', 'Invoiced — awaiting transport invoice')}${awaitingCount > 0 ? ' ($awaitingCount)' : ''}'),
                  ('__none', tr('غير مفوترة', 'Not invoiced')),
                ]),
                sel('return', tr('حالة الإرجاع', 'Return state'), [
                  ('', tr('جميع حالات الإرجاع', 'All return states')),
                  for (final k in const ['overdue', 'due', 'open', 'returned', 'none'])
                    (k, '${tr(_returnLabel[k]!.$1, _returnLabel[k]!.$2)}${k == 'overdue' && overdueCount > 0 ? ' ($overdueCount)' : ''}'),
                ]),
                sel('customer', tr('العميل', 'Customer'), [('', tr('جميع العملاء', 'All customers')), for (final p in _customers) ('${p['_id']}', '${p['name'] ?? ''}')]),
                sel('agent', tr('وكيل الشحن', 'Agent'), [('', tr('جميع الوكلاء', 'All agents')), for (final p in _agents) ('${p['_id']}', '${p['name'] ?? ''}')]),
                sel('port', tr('الميناء', 'Port'), [('', tr('جميع الموانئ', 'All ports')), for (final p in ports) (p, p)]),
                sel('branch', tr('الفرع', 'Branch'), [('', tr('جميع الفروع', 'All branches')), ('jeddah', tr('جدة', 'Jeddah')), ('dammam', tr('الدمام', 'Dammam'))]),
                sel('stage', tr('المرحلة', 'Stage'), [('', tr('جميع المراحل', 'All stages')), for (final s in stages) (s, '${tr('تنتظر', 'Next')}: ${customsStageLabel(s)}')]),
                Text(tr('المدّة (بتاريخ المعاملة):', 'Period (transaction date):'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkSoft)),
                const SizedBox(height: 6),
                Row(children: [date('from', tr('من', 'From')), const SizedBox(width: 8), date('to', tr('إلى', 'To'))]),
              ]),
            ),
            const SizedBox(height: 12),
            FilledButton(onPressed: () => Navigator.pop(c, draft), child: Text(tr('تطبيق', 'Apply'))),
          ]),
        );
      }),
    );
    if (res != null && mounted) setState(() { _f..clear()..addAll(res); });
  }

  // Create: ongoing or upcoming.
  Future<void> _create({required bool upcoming}) async {
    final res = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => FractionallySizedBox(
        heightFactor: 0.92,
        child: _CreateSheet(upcoming: upcoming, customers: _customers, agents: _agents),
      ),
    );
    if (res == null || !mounted) return;
    _load();
    _loadAlerts();
    // An upcoming one stays in its dialog and an ongoing one opens, as on the web.
    if (upcoming) {
      _openUpcoming();
    } else if (res['_id'] != null) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => CustomsDetailScreen(clearanceId: '${res['_id']}', ref: _s(res, 'refNumber'))));
    }
  }

  void _openUpcoming() {
    final auth = context.read<AuthProvider>();
    final canEdit = _editRoles.contains(auth.role) || auth.canEditSection('Customs');
    final canDelete = _deleteRoles.contains(auth.role) || auth.canEditSection('Customs');
    Navigator.push(context, MaterialPageRoute(builder: (_) => CustomsUpcomingScreen(canEdit: canEdit, canDelete: canDelete)))
        .then((_) { _load(); _loadAlerts(); });
  }

  Future<void> _delete(Map<String, dynamic> c) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(tr('حذف المعاملة؟', 'Delete this clearance?')),
        content: Text('${_s(c, 'blNumber')} ${_s(c, 'refNumber')}'.trim()),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(d, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      await Api.instance.delete('/api/customs-clearance/${c['_id']}');
      _load();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  /// Note written from the row: the transaction's own log (read in full on open).
  void _openNotes(Map<String, dynamic> c, bool canEdit) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => FractionallySizedBox(
        heightFactor: 0.8,
        child: _NotesSheet(clearanceId: '${c['_id']}', ref: _s(c, 'refNumber'), canEdit: canEdit, onChanged: _load),
      ),
    );
  }

  Widget _row(Map<String, dynamic> c, bool canEdit, bool canDelete) {
    final p = c['pipeline'] is Map ? c['pipeline'] as Map : const {};
    final percent = _n(p['percent']).toInt();
    final ret = _returnState(c);
    final inv = _invoiceState(c);
    final awaiting = c['awaitingTransportInvoice'] == true;
    final vehicles = c['cargoType'] == 'vehicles';
    final note = c['lastNote'] is Map ? c['lastNote'] as Map : null;
    final notesCount = _n(c['notesCount']).toInt();
    final totalInv = _n(c['revenue'] is Map ? c['revenue']['totalInvoiced'] : 0);
    final stageColor = c['cancelled'] == true ? T.inkFaint : c['isCompleted'] == true ? T.success
        : percent >= 60 ? T.info : percent >= 25 ? T.warn : T.orange;
    return Pressable(
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => CustomsDetailScreen(clearanceId: '${c['_id']}', ref: _s(c, 'refNumber')))),
      child: AppCard(
        topAccent: awaiting ? T.danger : null,
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(
              child: Text(_s(c, 'blNumber').isNotEmpty ? '${_s(c, 'blNumber')} — ${_s(c, 'customerName')}' : (_s(c, 'customerName').isEmpty ? '—' : _s(c, 'customerName')),
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5), maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
            if (canDelete)
              InkWell(
                onTap: () => _delete(c),
                child: const Padding(padding: EdgeInsets.all(2), child: Icon(Icons.delete_outline, size: 18, color: T.inkFaint)),
              ),
          ]),
          const SizedBox(height: 2),
          Text([
            '${tr('رقم المعاملة', 'Transaction no.')}: ${_s(c, 'refNumber')}',
            if (_s(c, 'declarationNumber').isNotEmpty) '${tr('رقم البيان', 'Declaration no.')}: ${_s(c, 'declarationNumber')}',
            if (_s(c, 'unloadingAppointment').length >= 10) '${tr('تاريخ التفريغ', 'Unloading date')}: ${_s(c, 'unloadingAppointment').substring(0, 10).split('-').reversed.join('/')}',
            if (_period(c).isNotEmpty) _period(c),
            if (totalInv != 0) '${tr('إجمالي الفاتورة', 'Invoiced')}: ${_money(totalInv)}',
          ].join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
          const SizedBox(height: 6),
          Wrap(spacing: 5, runSpacing: 5, children: [
            Chip2(_stageText(c), stageColor),
            if (c['cancelled'] != true && c['isCompleted'] != true) Chip2('$percent%', T.cyan),
            if (awaiting) Chip2(tr('بانتظار فاتورة النقل', 'Awaiting transport invoice'), T.danger, icon: Icons.error_outline)
            else if (inv.$1.isNotEmpty) Chip2('${inv.$1}${_s(c, 'saleInvoiceNumber').isNotEmpty ? ' · ${_s(c, 'saleInvoiceNumber')}' : ''}', T.success)
            else Chip2(tr('غير مفوترة', 'Not invoiced'), T.inkSoft),
            Chip2(tr(_returnLabel[ret]!.$1, _returnLabel[ret]!.$2),
                ret == 'returned' ? T.success : ret == 'overdue' ? T.danger : ret == 'due' ? T.warn : T.inkFaint),
            Chip2('${_n(c['containerCount']).toInt()} ${vehicles ? tr('سيّارة', 'vehicles') : tr('حاوية', 'containers')}', T.navy),
            Chip2(c['branch'] == 'dammam' ? tr('الدمام', 'Dammam') : tr('جدة', 'Jeddah'), T.inkSoft),
          ]),
          const SizedBox(height: 6),
          // The latest note, written from here, like the notes column on the web.
          InkWell(
            onTap: canEdit || note != null ? () => _openNotes(c, canEdit) : null,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(8)),
              child: note != null && '${note['text'] ?? ''}'.isNotEmpty
                  ? Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${note['text']}', style: const TextStyle(fontSize: 12.5), maxLines: 2, overflow: TextOverflow.ellipsis),
                      Text('${note['byName'] ?? ''}${notesCount > 1 ? ' · ${tr('$notesCount ملاحظات', '$notesCount notes')}' : ''}',
                          style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                    ])
                  : Row(children: [
                      const Icon(Icons.add_comment_outlined, size: 15, color: T.inkFaint),
                      const SizedBox(width: 5),
                      Text(tr('أضف ملاحظة', 'Add note'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                    ]),
            ),
          ),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    // As on the web: profits for management; edit and delete by roles or by matrix grant.
    final seesMoney = ['super_admin', 'admin', 'customs_manager'].contains(auth.role);
    final canEdit = _editRoles.contains(auth.role) || auth.canEditSection('Customs');
    final canDelete = _deleteRoles.contains(auth.role) || auth.canEditSection('Customs');
    final shown = _filtered;
    final alertCount = _n(_alerts['count']).toInt();
    final activeFilters = _f.values.where((v) => v.isNotEmpty).length;
    return AppScaffold(
      title: Text(tr('التخليص الجمركي', 'Customs Clearance')),
      actions: [
        // Badge of those nearing their date: a number that stays in view while work remains.
        IconButton(
          tooltip: tr('المعاملات القادمة (${_alerts['total'] ?? 0})', 'Upcoming (${_alerts['total'] ?? 0})'),
          onPressed: _openUpcoming,
          icon: Badge(
            isLabelVisible: alertCount > 0,
            label: Text('$alertCount'),
            backgroundColor: T.warn,
            child: Icon(Icons.notifications_outlined, color: alertCount > 0 ? T.warn : null),
          ),
        ),
        IconButton(tooltip: tr('تصدير Excel', 'Export Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: () => _export(seesMoney, shown)),
      ],
      floatingActionButton: canEdit
          ? FloatingActionButton.extended(
              onPressed: () async {
                final pick = await showModalBottomSheet<bool>(
                  context: context,
                  builder: (c) => SafeArea(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      ListTile(leading: const Icon(Icons.add), title: Text(tr('إضافة معاملة', 'New clearance')), onTap: () => Navigator.pop(c, false)),
                      ListTile(leading: const Icon(Icons.event_outlined), title: Text(tr('إنشاء معاملة قادمة', 'New upcoming')), onTap: () => Navigator.pop(c, true)),
                    ]),
                  ),
                );
                if (pick != null) _create(upcoming: pick);
              },
              icon: const Icon(Icons.add),
              label: Text(tr('إضافة', 'New')),
            )
          : null,
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
          child: Row(children: [
            Expanded(
              child: SearchField(
                controller: _search, dense: true,
                onChanged: _onSearch,
                hint: tr('ابحث بأيّ رقمٍ أو اسم: المعاملة، الحاوية، البوليصة، البيان، الفاتورة، العميل، الوكيل…',
                    'Any number or name: ref, container, BL, declaration, invoice, customer, agent…'),
              ),
            ),
            const SizedBox(width: 8),
            Badge(
              isLabelVisible: activeFilters > 0,
              label: Text('$activeFilters'),
              child: IconButton.filledTonal(onPressed: _openFilters, icon: const Icon(Icons.tune)),
            ),
          ]),
        ),
        if (activeFilters > 0 || shown.length != _list.length)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(children: [
              Expanded(
                child: Text('${shown.length != _list.length ? '${shown.length} ${tr('من', 'of')} ' : ''}${_list.length} ${tr('معاملة', 'transactions')}',
                    style: const TextStyle(fontSize: 12, color: T.inkSoft)),
              ),
              if (activeFilters > 0) TextButton(onPressed: () => setState(_f.clear), child: Text(tr('مسح', 'Clear'))),
            ]),
          ),
        Expanded(
          child: _loading
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 120)])
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(
                      onRefresh: () async { await Future.wait([_load(), _loadAlerts()]); },
                      child: shown.isEmpty
                          ? ListView(children: [EmptyState(icon: Icons.directions_boat_outlined, title: tr('لا معاملات', 'No clearances'))])
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              padding: const EdgeInsets.fromLTRB(14, 6, 14, 90),
                              itemCount: shown.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (_, i) => _row(shown[i], canEdit, canDelete),
                            ),
                    ),
        ),
      ]),
    );
  }
}

/// Create form, like the web dialog: branch, waybill, customer and agent from their files, transaction type and unit count; for an upcoming one, its expected date and its five papers.
class _CreateSheet extends StatefulWidget {
  final bool upcoming;
  final List<Map<String, dynamic>> customers, agents;
  const _CreateSheet({required this.upcoming, required this.customers, required this.agents});
  @override
  State<_CreateSheet> createState() => _CreateSheetState();
}

class _CreateSheetState extends State<_CreateSheet> {
  String _branch = 'jeddah', _cargo = 'containers', _expected = '';
  final TextEditingController _bl = TextEditingController();
  final TextEditingController _count = TextEditingController(text: '0');
  Map<String, dynamic>? _customer, _agent;
  final Map<String, bool> _docs = {};
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _bl.dispose();
    _count.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>?> _pick(List<Map<String, dynamic>> list, String title) => showDialog<Map<String, dynamic>>(
        context: context,
        builder: (c) {
          var q = '';
          return StatefulBuilder(builder: (c, setSt) {
            final shown = list.where((p) => _matches(q, [p['name'], p['email']])).toList();
            return AlertDialog(
              title: Text(title),
              contentPadding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              content: SizedBox(
                width: double.maxFinite,
                height: 420,
                child: Column(children: [
                  SearchField(autofocus: true, dense: true, onChanged: (v) => setSt(() => q = v),
                      hint: tr('اكتب للبحث…', 'Type to search…')),
                  const SizedBox(height: 6),
                  Expanded(
                    child: shown.isEmpty
                        ? Center(child: Text(tr('لا نتائج — أضِفه من صفحته', 'No match — add it from its page'), style: const TextStyle(color: T.inkFaint)))
                        : ListView.builder(
                            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                            itemCount: shown.length,
                            itemBuilder: (_, i) => ListTile(
                              dense: true,
                              title: Text('${shown[i]['name'] ?? ''}'),
                              subtitle: '${shown[i]['email'] ?? ''}'.isEmpty ? null : Text('${shown[i]['email']}'),
                              onTap: () => Navigator.pop(c, shown[i]),
                            ),
                          ),
                  ),
                ]),
              ),
              actions: [TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel')))],
            );
          });
        },
      );

  Future<void> _save() async {
    if (widget.upcoming && _expected.isEmpty) {
      setState(() => _error = tr('اختر تاريخ المعاملة المتوقَّع.', 'Pick the expected date.'));
      return;
    }
    setState(() { _saving = true; _error = null; });
    try {
      final body = <String, dynamic>{
        'branch': _branch,
        'blNumber': _bl.text.trim(),
        'customerParty': _customer?['_id'] ?? '',
        'customerName': _customer?['name'] ?? '',
        'agentParty': _agent?['_id'] ?? '',
        'shippingAgent': _agent?['name'] ?? '',
        if (_agent != null) 'shippingAgentEmail': _agent!['email'] ?? '',
        'cargoType': _cargo,
        'containerCount': int.tryParse(_count.text.trim()) ?? 0,
        if (widget.upcoming) ...{'upcoming': true, 'expectedDate': _expected, 'documents': _docs},
      };
      final r = await Api.instance.post('/api/customs-clearance', body);
      if (!mounted) return;
      Navigator.pop(context, r is Map && r['clearance'] is Map ? Map<String, dynamic>.from(r['clearance']) : <String, dynamic>{});
    } catch (e) {
      if (mounted) setState(() { _saving = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final vehicles = _cargo == 'vehicles';
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(widget.upcoming ? tr('إنشاء معاملة قادمة', 'New upcoming transaction') : tr('إضافة معاملة', 'New clearance'),
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
        const SizedBox(height: 10),
        Expanded(
          child: ListView(children: [
            DropdownButtonFormField<String>(
              initialValue: _branch,
              decoration: InputDecoration(labelText: tr('الفرع', 'Branch')),
              items: [
                DropdownMenuItem(value: 'jeddah', child: Text(tr('جدة', 'Jeddah'))),
                DropdownMenuItem(value: 'dammam', child: Text(tr('الدمام', 'Dammam'))),
              ],
              onChanged: (v) => setState(() => _branch = v ?? 'jeddah'),
            ),
            const SizedBox(height: 10),
            TextField(controller: _bl, decoration: InputDecoration(labelText: tr('رقم البوليصة BL', 'BL number'))),
            const SizedBox(height: 10),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(tr('اسم العميل', 'Customer'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
              subtitle: Text('${_customer?['name'] ?? tr('اختر العميل — اكتب للبحث…', 'Pick customer — type to search…')}',
                  style: const TextStyle(fontSize: 14, color: T.ink)),
              trailing: const Icon(Icons.arrow_drop_down),
              onTap: () async { final p = await _pick(widget.customers, tr('العميل', 'Customer')); if (p != null) setState(() => _customer = p); },
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(tr('وكيل الشحن', 'Shipping agent'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
              subtitle: Text('${_agent?['name'] ?? tr('اختر الوكيل — اكتب للبحث…', 'Pick agent — type to search…')}',
                  style: const TextStyle(fontSize: 14, color: T.ink)),
              trailing: const Icon(Icons.arrow_drop_down),
              onTap: () async { final p = await _pick(widget.agents, tr('وكيل الشحن', 'Shipping agent')); if (p != null) setState(() => _agent = p); },
            ),
            DropdownButtonFormField<String>(
              initialValue: _cargo,
              decoration: InputDecoration(labelText: tr('نوع المعاملة', 'Transaction type')),
              items: [
                DropdownMenuItem(value: 'containers', child: Text(tr('حاويات', 'Containers'))),
                DropdownMenuItem(value: 'vehicles', child: Text(tr('سيّارات', 'Vehicles'))),
              ],
              onChanged: (v) => setState(() => _cargo = v ?? 'containers'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _count,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(labelText: vehicles ? tr('عدد السيّارات', 'Number of vehicles') : tr('عدد الحاويات', 'Containers')),
            ),
            if (widget.upcoming) ...[
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: () async {
                  final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(_expected) ?? DateTime.now(),
                      firstDate: DateTime(2020), lastDate: DateTime(2100));
                  if (d != null) setState(() => _expected = _ymd(d));
                },
                icon: const Icon(Icons.event_outlined, size: 18),
                label: Text('${tr('تاريخ المعاملة المتوقَّع', 'Expected date')}: ${_expected.isEmpty ? '—' : _expected}'),
              ),
              const SizedBox(height: 10),
              Text(tr('الأوراق المطلوبة — علِّم ما استُلِم', 'Required papers — tick what has been received'),
                  style: const TextStyle(fontSize: 12, color: T.inkSoft)),
              const SizedBox(height: 6),
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final k in customsDocKeys)
                  FilterChip(
                    label: Text(tr(k.$2, k.$3)),
                    selected: _docs[k.$1] == true,
                    onSelected: (on) => setState(() => _docs[k.$1] = on),
                  ),
              ]),
            ],
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(_error!, style: const TextStyle(color: T.danger, fontSize: 12.5))),
          ]),
        ),
        const SizedBox(height: 8),
        FilledButton.icon(
          onPressed: _saving ? null : _save,
          icon: _saving ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.check),
          label: Text(tr('إنشاء', 'Create')),
        ),
      ]),
    );
  }
}

/// Notes of a transaction from a table row: the same transaction log (ClearanceNotes compact).
class _NotesSheet extends StatefulWidget {
  final String clearanceId, ref;
  final bool canEdit;
  final VoidCallback onChanged;
  const _NotesSheet({required this.clearanceId, required this.ref, required this.canEdit, required this.onChanged});
  @override
  State<_NotesSheet> createState() => _NotesSheetState();
}

class _NotesSheetState extends State<_NotesSheet> {
  Map<String, dynamic>? _c;
  final TextEditingController _text = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/customs-clearance/${widget.clearanceId}');
      if (mounted && d is Map && d['clearance'] is Map) setState(() => _c = Map<String, dynamic>.from(d['clearance']));
    } catch (_) {/* */}
  }

  Future<void> _run(Future<dynamic> Function() call) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await call();
      await _load();
      widget.onChanged();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _when(dynamic v) {
    final d = DateTime.tryParse('${v ?? ''}')?.toLocal();
    if (d == null) return '';
    return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final log = _maps(_c?['notesLog']).reversed.toList();
    final old = '${_c?['notes'] ?? ''}';
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('${tr('ملاحظات', 'Notes')} · ${widget.ref}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 10),
        if (widget.canEdit)
          Row(children: [
            Expanded(
              child: TextField(controller: _text, minLines: 1, maxLines: 3,
                  decoration: InputDecoration(isDense: true, hintText: tr('اكتب ملاحظة…', 'Write a note…'))),
            ),
            const SizedBox(width: 8),
            FilledButton(
              onPressed: _busy ? null : () {
                final v = _text.text.trim();
                if (v.isEmpty) return;
                _run(() async {
                  await Api.instance.post('/api/customs-clearance/${widget.clearanceId}/notes', {'text': v});
                  _text.clear();
                });
              },
              child: Text(tr('إضافة', 'Add')),
            ),
          ]),
        const SizedBox(height: 10),
        Expanded(
          child: _c == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(children: [
                  if (log.isEmpty && old.isEmpty)
                    Padding(padding: const EdgeInsets.all(16), child: Text(tr('لا ملاحظات بعد', 'No notes yet'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
                  for (final nt in log)
                    Container(
                      margin: const EdgeInsets.only(bottom: 6),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10)),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${nt['text'] ?? ''}', style: const TextStyle(fontSize: 12.5)),
                        const SizedBox(height: 3),
                        Row(children: [
                          Expanded(child: Text('${nt['byName'] ?? tr('غير معروف', 'unknown')} · ${_when(nt['at'])}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint))),
                          if (widget.canEdit && '${nt['_id'] ?? ''}'.isNotEmpty)
                            InkWell(
                              onTap: _busy ? null : () => _run(() => Api.instance.delete('/api/customs-clearance/${widget.clearanceId}/notes/${nt['_id']}')),
                              child: const Icon(Icons.delete_outline, size: 16, color: T.danger),
                            ),
                        ]),
                      ]),
                    ),
                  if (old.isNotEmpty)
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), border: Border.all(color: T.line)),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(old, style: const TextStyle(fontSize: 12)),
                        Text(tr('ملاحظة قديمة (قبل سجلّ الملاحظات)', 'Older note (before the notes log)'), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                      ]),
                    ),
                ]),
        ),
      ]),
    );
  }
}

/// Upcoming transactions, counterpart of UpcomingPanel on the web: all ordered by nearest, each with the time left, its date and branch editable in place, its five papers markable, and convertible to ongoing (with a prompt) or deletable.
class CustomsUpcomingScreen extends StatefulWidget {
  final bool canEdit, canDelete;
  const CustomsUpcomingScreen({super.key, required this.canEdit, required this.canDelete});
  @override
  State<CustomsUpcomingScreen> createState() => _CustomsUpcomingScreenState();
}

class _CustomsUpcomingScreenState extends State<CustomsUpcomingScreen> {
  List<Map<String, dynamic>> _items = [];
  int _days = 2;
  bool _loading = true;
  String _busy = '';
  int _seq = 0;
  // The mark shows at once and saving follows behind; requests for one transaction are queued.
  final Map<String, Map<String, dynamic>> _local = {};
  final Map<String, Future<void>> _queue = {};
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () => _load();
    _load();
    Live.instance.on('customs:created', _onLive);
    Live.instance.on('customs:updated', _onLive);
    Live.instance.on('customs:deleted', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('customs:created', _onLive);
    Live.instance.off('customs:updated', _onLive);
    Live.instance.off('customs:deleted', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/customs-clearance/upcoming-alerts');
      if (!mounted || mine != _seq) return;
      setState(() { _items = _maps(d['upcoming']); _days = _n(d['days'] ?? 2).toInt(); _loading = false; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _loading = false);
    }
  }

  void _say(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Map<String, dynamic> _view(Map<String, dynamic> x) {
    final o = _local['${x['_id']}'];
    if (o == null) return x;
    return {
      ...x,
      if (o.containsKey('expectedDate')) 'expectedDate': o['expectedDate'],
      if (o.containsKey('branch')) 'branch': o['branch'],
      'documents': {...(x['documents'] is Map ? x['documents'] as Map : const {}), ...(o['documents'] is Map ? o['documents'] as Map : const {})},
    };
  }

  Future<void> _put(String id, Map<String, dynamic> body, void Function() undo, String failMsg) async {
    final prev = _queue[id] ?? Future.value();
    final mine = prev.catchError((_) {}).then((_) => Api.instance.put('/api/customs-clearance/$id', body)).then((_) {});
    _queue[id] = mine;
    try {
      await mine;
      _load();
    } catch (e) {
      if (!mounted) return;
      setState(undo);
      _say(e.toString().isNotEmpty ? e.toString() : failMsg);
    }
  }

  void _toggleDoc(Map<String, dynamic> x, String k, bool on) {
    final id = '${x['_id']}';
    setState(() {
      final o = _local.putIfAbsent(id, () => {});
      o['documents'] = {...(o['documents'] as Map? ?? const {}), k: on};
    });
    _put(id, {'documents': {k: on}}, () {
      final o = _local.putIfAbsent(id, () => {});
      o['documents'] = {...(o['documents'] as Map? ?? const {}), k: !on};
    }, tr('تعذّر الحفظ — عادت العلامةُ كما كانت', 'Not saved — the tick was restored'));
  }

  Future<void> _editNotes(Map<String, dynamic> x, String current) async {
    final ctl = TextEditingController(text: current);
    final saved = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (c) => Padding(
        padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: MediaQuery.of(c).viewInsets.bottom + 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('ملاحظات المعاملة', 'Transaction notes'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 10),
          TextField(controller: ctl, autofocus: true, minLines: 3, maxLines: 8, maxLength: 2000,
              decoration: InputDecoration(hintText: tr('ملاحظات وتفاصيل المعاملة…', 'Notes and details…'))),
          const SizedBox(height: 6),
          FilledButton(onPressed: () => Navigator.pop(c, ctl.text.trim()), child: Text(tr('حفظ الملاحظات', 'Save notes'))),
        ]),
      ),
    );
    ctl.dispose();
    if (saved == null || saved == current.trim()) return;
    await _save(x, 'notes', saved);
  }

  Future<void> _save(Map<String, dynamic> x, String key, String value) async {
    final id = '${x['_id']}';
    final before = x[key];
    setState(() { _busy = id; _local.putIfAbsent(id, () => {})[key] = value; });
    await _put(id, {key: value}, () => _local.putIfAbsent(id, () => {})[key] = before,
        tr('تعذّر الحفظ — عادت القيمةُ كما كانت', 'Not saved — the value was restored'));
    if (mounted) setState(() => _busy = '');
  }

  Future<bool> _ask(String msg, {bool danger = false, required String action}) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(msg),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: danger ? FilledButton.styleFrom(backgroundColor: T.danger) : null,
            onPressed: () => Navigator.pop(c, true),
            child: Text(action),
          ),
        ],
      ),
    );
    return ok == true;
  }

  Future<void> _activate(Map<String, dynamic> x) async {
    final name = _s(x, 'blNumber').isNotEmpty ? _s(x, 'blNumber') : _s(x, 'refNumber');
    if (!await _ask(tr('تحويلُ المعاملة $name إلى معاملةٍ جارية؟ ستخرج من المعاملات القادمة وتدخل قائمةَ الجارية.',
        'Convert $name to a current transaction? It leaves the upcoming list and joins the current one.'), action: tr('تحويل', 'Convert'))) {
      return;
    }
    setState(() => _busy = '${x['_id']}');
    try {
      await Api.instance.patch('/api/customs-clearance/${x['_id']}/activate', {});
      _say(tr('صارت معاملةً جارية', 'Now a current transaction'));
      _load();
    } catch (e) {
      _say(e.toString());
    }
    if (mounted) setState(() => _busy = '');
  }

  Future<void> _remove(Map<String, dynamic> x) async {
    final name = _s(x, 'blNumber').isNotEmpty ? _s(x, 'blNumber') : _s(x, 'refNumber');
    if (!await _ask(tr('حذفُ المعاملة القادمة $name نهائيًّا؟ لا يمكن استرجاعُها بعد الحذف.',
        'Permanently delete upcoming transaction $name? This cannot be undone.'), danger: true, action: tr('حذف', 'Delete'))) {
      return;
    }
    setState(() => _busy = '${x['_id']}');
    try {
      await Api.instance.delete('/api/customs-clearance/${x['_id']}');
      _say(tr('حُذفت المعاملة', 'Transaction deleted'));
      _load();
    } catch (e) {
      _say(e.toString());
    }
    if (mounted) setState(() => _busy = '');
  }

  String _remaining(dynamic v) {
    if (v == null) return tr('بلا تاريخ', 'No date');
    final n = _n(v).toInt();
    if (n == 0) return tr('اليوم', 'Today');
    if (n == 1) return tr('باقي يوم واحد', '1 day left');
    if (n == 2) return tr('باقي يومان', '2 days left');
    if (n > 2) return tr('باقي $n ${n <= 10 ? 'أيّام' : 'يومًا'}', '$n days left');
    final late = -n;
    if (late == 1) return tr('فات يوم واحد', '1 day overdue');
    if (late == 2) return tr('فات يومان', '2 days overdue');
    return tr('فات $late ${late <= 10 ? 'أيّام' : 'يومًا'}', '$late days overdue');
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text('${tr('المعاملات القادمة', 'Upcoming transactions')} (${_items.length})'),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 140)])
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.fromLTRB(14, 10, 14, 30), children: [
                Text(tr('الملوَّنُ ما قرُب موعدُه — خلال $_days يوم، وتُضبَط المدّةُ من إعدادات القسم', 'Highlighted: due within $_days days — set in section settings'),
                    style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                const SizedBox(height: 10),
                if (_items.isEmpty) EmptyState(icon: Icons.event_outlined, title: tr('لا معاملات قادمة.', 'No upcoming transactions.')),
                for (final raw in _items)
                  () {
                    final x = _view(raw);
                    final id = '${x['_id']}';
                    final docs = x['documents'] is Map ? x['documents'] as Map : const {};
                    final received = customsDocKeys.where((k) => docs[k.$1] == true).length;
                    final tone = x['overdue'] == true ? T.danger : x['dueSoon'] == true ? T.warn : null;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: AppCard(
                        topAccent: tone,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          Row(children: [
                            Expanded(
                              child: Text(_s(x, 'blNumber').isEmpty ? tr('بلا رقم بوليصة', 'No BL number') : _s(x, 'blNumber'),
                                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            ),
                            Chip2(_remaining(x['daysLeft']), tone ?? T.inkSoft),
                            if (_busy == id) const Padding(padding: EdgeInsets.only(left: 6, right: 6), child: SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))),
                          ]),
                          Text([
                            _s(x, 'customerName').isEmpty ? '—' : _s(x, 'customerName'),
                            if (_s(x, 'shippingAgent').isNotEmpty) _s(x, 'shippingAgent'),
                            if (_n(x['containerCount']) > 0) '${x['containerCount']} ${tr('حاوية', 'containers')}',
                            x['branch'] == 'dammam' ? tr('الدمام', 'Dammam') : tr('جدة', 'Jeddah'),
                          ].join(' · '), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                          Text(_s(x, 'refNumber'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                          const SizedBox(height: 8),
                          Row(children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed: !widget.canEdit ? null : () async {
                                  final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(_s(x, 'expectedDate')) ?? DateTime.now(),
                                      firstDate: DateTime(2020), lastDate: DateTime(2100));
                                  if (d != null) _save(raw, 'expectedDate', _ymd(d));
                                },
                                icon: const Icon(Icons.event_outlined, size: 16),
                                label: Text('${tr('تاريخ المعاملة', 'Expected date')}: ${_s(x, 'expectedDate').isEmpty ? '—' : _s(x, 'expectedDate')}',
                                    style: const TextStyle(fontSize: 12), overflow: TextOverflow.ellipsis),
                              ),
                            ),
                            const SizedBox(width: 8),
                            DropdownButton<String>(
                              value: x['branch'] == 'dammam' ? 'dammam' : 'jeddah',
                              items: [
                                DropdownMenuItem(value: 'jeddah', child: Text(tr('جدة', 'Jeddah'))),
                                DropdownMenuItem(value: 'dammam', child: Text(tr('الدمام', 'Dammam'))),
                              ],
                              onChanged: !widget.canEdit ? null : (v) { if (v != null) _save(raw, 'branch', v); },
                            ),
                          ]),
                          Text(tr('الأوراق: $received من ${customsDocKeys.length}', 'Papers: $received of ${customsDocKeys.length}'),
                              style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                          const SizedBox(height: 4),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            for (final k in customsDocKeys)
                              FilterChip(
                                label: Text(tr(k.$2, k.$3), style: const TextStyle(fontSize: 12)),
                                selected: docs[k.$1] == true,
                                onSelected: widget.canEdit ? (on) => _toggleDoc(raw, k.$1, on) : null,
                              ),
                          ]),
                          // Notes of an upcoming transaction: written and edited from here, as on the web.
                          const SizedBox(height: 8),
                          InkWell(
                            borderRadius: BorderRadius.circular(10),
                            onTap: !widget.canEdit ? null : () => _editNotes(raw, _s(x, 'notes')),
                            child: Container(
                              width: double.infinity,
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                              decoration: BoxDecoration(border: Border.all(color: T.line), borderRadius: BorderRadius.circular(10)),
                              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                const Icon(Icons.sticky_note_2_outlined, size: 16, color: T.inkSoft),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    _s(x, 'notes').isEmpty
                                        ? (widget.canEdit ? tr('إضافة ملاحظات وتفاصيل…', 'Add notes and details…') : tr('لا ملاحظات', 'No notes'))
                                        : _s(x, 'notes'),
                                    style: TextStyle(fontSize: 12.5, color: _s(x, 'notes').isEmpty ? T.inkFaint : T.ink, height: 1.4),
                                  ),
                                ),
                                if (widget.canEdit) const Icon(Icons.edit_outlined, size: 15, color: T.inkFaint),
                              ]),
                            ),
                          ),
                          const SizedBox(height: 8),
                          Row(children: [
                            if (widget.canEdit)
                              FilledButton.icon(
                                onPressed: _busy == id ? null : () => _activate(raw),
                                icon: const Icon(Icons.check, size: 16),
                                label: Text(tr('تحويل إلى معاملة جارية', 'Convert to current')),
                              ),
                            const Spacer(),
                            if (widget.canDelete)
                              OutlinedButton.icon(
                                style: OutlinedButton.styleFrom(foregroundColor: T.danger),
                                onPressed: _busy == id ? null : () => _remove(raw),
                                icon: const Icon(Icons.delete_outline, size: 16),
                                label: Text(tr('حذف', 'Delete')),
                              ),
                          ]),
                        ]),
                      ),
                    );
                  }(),
              ]),
            ),
    );
  }
}
