import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import '../ui/customs_link.dart';
import '../ui/report_follow_ups.dart';
import 'collection_attachments.dart';
import 'collections_invoices.dart' show CollectionsTaxInvoiceScreen;
import 'collections_party.dart';
import 'ops_workflow_detail.dart';
import '../ui/export_sheet.dart';
import '../resource/configs.dart' show collectionsCanEdit;

// ── تفاصيلُ المديونيّة — شاشةُ كلِّ رقمٍ في لوحة التحصيل ─────────────────────
// كان الرقمُ يفتح ورقةً سفليّةً تعيد الرقمَ نفسَه. والآن يفتح شاشةً كاملةً بصفوفه
// — كصفحة الموقع `/system/collections-dept/dashboard/receivables`: الصفوفُ نفسُها
// التي عدّت البطاقة (`/receivables/rows`)، بأعمدتها مختصرةً في بطاقة، وفلاترُها
// قابلةٌ للإزالة، وفلاترُ أعمدةٍ وفرزٌ وبحث، ومجاميعُ النتيجة كلِّها.

const _payLabels = {
  'tax': ('ضريبي', 'Tax'),
  'cash': ('كاش', 'Cash'),
  'deferred_invoice': ('آجل - فاتورة', 'Deferred – invoice'),
  'deferred_cash': ('آجل - كاش', 'Deferred – cash'),
  'cash_3pl': ('نقدي - 3PL', 'Cash – 3PL'),
  'cash_ht': ('نقدي - HT', 'Cash – HT'),
};
const _bandLabels = {
  'd1_15': ('1 – 15 يومًا', '1–15 days'),
  'd16_30': ('16 – 30 يومًا', '16–30 days'),
  'd31_60': ('31 – 60 يومًا', '31–60 days'),
  'd61_90': ('61 – 90 يومًا', '61–90 days'),
  'd91_plus': ('أكثر من 90 يومًا', 'Over 90 days'),
  'nodate': ('بلا تاريخ', 'No date'),
};
const _riskLabels = {'normal': ('طبيعي', 'Normal'), 'medium': ('متوسط', 'Medium'), 'hard': ('مرتفع', 'Hard'), 'nodate': ('بلا تاريخ', 'No date')};
const _issueLabels = {'none': ('بلا مشكلة', 'No issue'), 'negotiating': ('تحت التفاوض', 'Negotiating'), 'legal': ('قضايا', 'Legal')};
const _dueLabels = {
  'late': ('مستحق — تجاوز موعده', 'Due — past its date'),
  'noterm': ('مستحق — بلا مدّة سداد', 'Due — no credit term'),
  'within': ('غير مستحق', 'Not yet due'),
};
const _attachLabels = {'yes': ('مرفق', 'Has file'), 'no': ('بلا مرفق', 'No file'), '': ('لا ينطبق', 'n/a')};
const _termLabels = {'customer': ('مدّة العميل', 'Customer term'), 'default': ('افتراضية', 'Default')};

String _lbl(Map<String, (String, String)> m, String k) {
  final l = m[k];
  return l == null ? (k.isEmpty ? tr('(فارغ)', '(blank)') : k) : tr(l.$1, l.$2);
}

String _money(dynamic n) {
  final v = (n is num) ? n : num.tryParse('$n') ?? 0;
  return v.toStringAsFixed(0).replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');
}

String _date(dynamic v) {
  final s = (v ?? '').toString();
  if (s.length < 10) return '—';
  final d = DateTime.tryParse(s);
  if (d == null) return s.substring(0, 10);
  // يومُ الرياض: الخادمُ يحفظ منتصفَ ليل الرياض — +3 تعيده إلى يومه.
  final r = d.toUtc().add(const Duration(hours: 3));
  return '${r.day.toString().padLeft(2, '0')}/${r.month.toString().padLeft(2, '0')}/${r.year}';
}

/// اسمُ عقدةٍ أو فلترٍ في رأس الشاشة.
String _chipLabel(String k, String v) {
  final vals = v.split(',');
  String join(Map<String, (String, String)> m) => vals.map((x) => _lbl(m, x)).join('، ');
  switch (k) {
    case 'kind': return v == 'tax' ? tr('المديونية الضريبية', 'Tax receivables') : tr('المديونية الكاش', 'Cash receivables');
    case 'subtype': return _lbl(_payLabels, v);
    case 'due': return v == 'due' ? tr('مستحق', 'Due') : tr('غير مستحق', 'Not yet due');
    case 'band': return '${tr('العمر', 'Age')}: ${_lbl(_bandLabels, v)}';
    case 'risk': return '${tr('الخطورة', 'Risk')}: ${_lbl(_riskLabels, v)}';
    case 'attach': return v == 'missing_tax' ? tr('ضريبي بلا مرفق', 'Tax, no file') : tr('آجل - فاتورة بلا مرفق', 'Deferred invoice, no file');
    case 'term': return tr('على المدّة الافتراضية', 'On the default term');
    case 'officer': return '${tr('المسؤول', 'Collector')}: ${vals.join('، ')}';
    case 'parties': return '${tr('العميل', 'Customer')}: ${vals.length}';
    case 'pay': return '${tr('نوع الدفع', 'Payment')}: ${join(_payLabels)}';
    case 'dueState': return '${tr('الاستحقاق', 'Due')}: ${join(_dueLabels)}';
    case 'issue': return '${tr('القضايا', 'Cases')}: ${join(_issueLabels)}';
    case 'from': return '${tr('من', 'From')} $v';
    case 'to': return '${tr('إلى', 'To')} $v';
    default: return '$k: $v';
  }
}

/// فلاترُ الأعمدة المتاحة على الهاتف — قيمُها من `/receivables/column-options`.
const _colFilters = [
  ('officer', 'المسؤول', 'Collector', null),
  ('payKind', 'نوع الدفع', 'Payment type', _payLabels),
  ('ageBand', 'شريحة العمر', 'Age band', _bandLabels),
  ('risk', 'الخطورة', 'Risk', _riskLabels),
  ('dueState', 'الاستحقاق', 'Due status', _dueLabels),
  ('issue', 'حالة القضية', 'Case state', _issueLabels),
  ('termSource', 'المدّة', 'Term', _termLabels),
  ('attach', 'المرفقات', 'Files', _attachLabels),
  ('customer', 'العميل', 'Customer', null),
];

const _sorts = [
  ('', 'الأقدم ثم الأكبر', 'Oldest, then largest'),
  ('total', 'القيمة', 'Value'),
  ('age', 'العمر', 'Age'),
  ('daysLate', 'التأخير', 'Days late'),
  ('dueDate', 'تاريخ الاستحقاق', 'Due date'),
  ('invoiceDate', 'تاريخ الإصدار', 'Issue date'),
  ('customer', 'العميل', 'Customer'),
  ('risk', 'الخطورة', 'Risk'),
];

class CollectionsReceivablesScreen extends StatefulWidget {
  /// فلاترُ اللوحة والعقدةُ التي ضُغطت — كما يحملها رابطُ الموقع.
  final Map<String, String> query;
  final String title;
  const CollectionsReceivablesScreen({super.key, required this.query, required this.title});
  @override
  State<CollectionsReceivablesScreen> createState() => _CollectionsReceivablesScreenState();
}

class _CollectionsReceivablesScreenState extends State<CollectionsReceivablesScreen> {
  late Map<String, String> _query = {...widget.query};
  final Map<String, Set<String>> _cf = {};
  String _q = '';
  String _sort = '';
  String _dir = 'desc';
  int _page = 1;
  final List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic>? _totals;
  bool _loading = true;
  bool _more = false;
  String? _error;
  int _seq = 0;
  void Function()? _onLive;
  final _search = TextEditingController();
  Timer? _searchDeb; // البحثُ أثناء الكتابة — و✕ يُعيد القائمة كاملة

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('collections:changed', _onLive!);
  }

  @override
  void dispose() {
    if (_onLive != null) Live.instance.off('collections:changed', _onLive!);
    _search.dispose();
    _searchDeb?.cancel();
    super.dispose();
  }

  List<String> _params({String skipCol = '', bool view = true}) => [
        for (final e in _query.entries) '${Uri.encodeQueryComponent(e.key)}=${Uri.encodeQueryComponent(e.value)}',
        for (final e in _cf.entries)
          if (e.key != skipCol)
            for (final v in e.value) 'cf_${e.key}=${Uri.encodeQueryComponent(v)}',
        if (_q.isNotEmpty) 'q=${Uri.encodeQueryComponent(_q)}',
        if (view && _sort.isNotEmpty) ...['sort=$_sort', 'dir=$_dir'],
      ];

  Future<void> _load({bool append = false}) async {
    final mine = ++_seq;
    final page = append ? _page + 1 : 1;
    if (!append) setState(() => _loading = true);
    try {
      final d = await Api.instance.get('/api/collections-dept/receivables/rows?${[..._params(), 'page=$page', 'limit=50'].join('&')}');
      if (!mounted || mine != _seq) return;
      final rows = [for (final r in (d['rows'] as List? ?? const [])) Map<String, dynamic>.from(r as Map)];
      setState(() {
        if (!append) _rows.clear();
        _rows.addAll(rows);
        _page = page;
        _totals = Map<String, dynamic>.from(d as Map);
        _more = page < ((d['pages'] as num?) ?? 1);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _pickColumn((String, String, String, Map<String, (String, String)>?) c) async {
    final picked = {...(_cf[c.$1] ?? <String>{})};
    List<Map<String, dynamic>> opts = [];
    try {
      final d = await Api.instance.get('/api/collections-dept/receivables/column-options?${[..._params(skipCol: c.$1, view: false), 'col=${c.$1}'].join('&')}');
      opts = [for (final o in (d['values'] as List? ?? const [])) Map<String, dynamic>.from(o as Map)];
    } catch (_) {}
    if (!mounted) return;
    var search = '';
    final applied = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => StatefulBuilder(builder: (ctx, set) {
        String label(String v) => c.$4 == null ? (v.isEmpty ? tr('(فارغ)', '(blank)') : v) : _lbl(c.$4!, v);
        final shown = opts.where((o) => search.isEmpty || label('${o['value']}').toLowerCase().contains(search.toLowerCase())).toList();
        return SafeArea(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.8),
            child: Padding(
              padding: EdgeInsets.fromLTRB(16, 12, 16, 12 + MediaQuery.of(ctx).viewInsets.bottom),
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  Expanded(child: Text(tr(c.$2, c.$3), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
                  if (picked.isNotEmpty) TextButton(onPressed: () => set(picked.clear), child: Text(tr('مسح', 'Clear'))),
                ]),
                if (opts.length > 8)
                  SearchField(
                    dense: true,
                    hint: tr('ابحث…', 'Search…'),
                    onChanged: (v) => set(() => search = v.trim()),
                  ),
                Flexible(
                  child: ListView(shrinkWrap: true, keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                    for (final o in shown)
                      CheckboxListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        controlAffinity: ListTileControlAffinity.leading,
                        value: picked.contains('${o['value']}'),
                        onChanged: (on) => set(() => on == true ? picked.add('${o['value']}') : picked.remove('${o['value']}')),
                        title: Text(label('${o['value']}'), style: const TextStyle(fontSize: 13.5)),
                        secondary: Text('${o['count'] ?? 0}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                      ),
                    if (shown.isEmpty)
                      Padding(padding: const EdgeInsets.all(18), child: Text(search.isNotEmpty ? tr('لا نتائج مطابقة', 'No matches') : tr('لا قيم', 'No values'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
                  ]),
                ),
                const SizedBox(height: 8),
                FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(tr('تطبيق', 'Apply'))),
              ]),
            ),
          ),
        );
      }),
    );
    if (applied != true) return;
    setState(() { if (picked.isEmpty) { _cf.remove(c.$1); } else { _cf[c.$1] = picked; } });
    _load();
  }

  Future<void> _pickSort() async {
    final v = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 4), child: Text(tr('الفرز', 'Sort'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
          for (final s in _sorts)
            ListTile(
              dense: true,
              title: Text(tr(s.$2, s.$3)),
              trailing: _sort == s.$1 ? Icon(s.$1.isEmpty ? Icons.check : (_dir == 'asc' ? Icons.arrow_upward : Icons.arrow_downward), size: 18, color: T.orange) : null,
              onTap: () => Navigator.pop(ctx, s.$1),
            ),
        ]),
      ),
    );
    if (v == null) return;
    setState(() {
      if (v.isEmpty) { _sort = ''; _dir = 'desc'; }
      else if (_sort == v) { _dir = _dir == 'desc' ? 'asc' : 'desc'; }
      else { _sort = v; _dir = 'desc'; }
    });
    _load();
  }

  Widget _summary() {
    final t = _totals;
    if (t == null) return const SizedBox.shrink();
    Widget cell(String label, String v) => Expanded(
          child: Column(children: [
            Text(label, style: const TextStyle(fontSize: 11, color: T.inkSoft, fontWeight: FontWeight.w600)),
            const SizedBox(height: 3),
            Text(v, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800, color: T.ink)),
          ]),
        );
    final tax = (t['taxCount'] as num?) ?? 0;
    final cash = (t['cashCount'] as num?) ?? 0;
    return AppCard(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
      child: Column(children: [
        Text([
          if (tax > 0 || cash == 0) '${_money(tax)} ${tr('فاتورة', 'invoices')}',
          if (cash > 0) '${_money(cash)} ${tr('أمر نقل', 'reports')}',
          '${_money(t['customers'])} ${tr('عميل', 'customers')}',
        ].join(' · '), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
        const SizedBox(height: 8),
        Row(children: [
          cell(tr('القيمة', 'Value'), _money(t['value'])),
          cell(tr('المحصَّل', 'Collected'), _money(t['collected'])),
          cell(tr('المتبقّي', 'Remaining'), _money(t['remaining'])),
        ]),
      ]),
    );
  }

  Widget _row(Map<String, dynamic> r) {
    final isReport = r['source'] == 'workflow' || r['kind'] == 'cash';
    final late = (r['daysLate'] is num) && (r['daysLate'] as num) > 0;
    final issue = '${r['issueState'] ?? 'none'}';
    final att = (r['attachments'] is num) ? (r['attachments'] as num).toInt() : null;
    TextStyle k = const TextStyle(fontSize: 11, color: T.inkFaint);
    TextStyle v = const TextStyle(fontSize: 12, color: T.ink, fontWeight: FontWeight.w600);
    Widget kv(String a, String b) => Padding(
          padding: const EdgeInsets.only(top: 3),
          child: Row(children: [Expanded(child: Text(a, style: k)), Text(b, style: v)]),
        );
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Pressable(
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => _ReceivableDetailScreen(row: r))).then((_) => _load()),
        child: AppCard(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Text('${r['invoiceNumber'] ?? '—'}  ·  ${isReport ? tr('أمر نقل', 'report') : tr('فاتورة', 'invoice')}',
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
              ),
              Text(_money(r['remaining'] ?? r['total']), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14.5)),
            ]),
            const SizedBox(height: 2),
            Text('${r['partyName'] ?? '—'}${(r['partyCode'] ?? '').toString().isNotEmpty ? ' · ${r['partyCode']}' : ''}',
                maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 4, children: [
              Chip2(_lbl(_payLabels, '${r['payKind'] ?? ''}'), T.navy),
              Chip2('${tr('الخطورة', 'Risk')}: ${_lbl(_riskLabels, '${r['risk'] ?? ''}')}', T.inkSoft),
              if (issue != 'none') Chip2(_lbl(_issueLabels, issue), T.navy, icon: Icons.gavel_rounded),
              if (att != null) Chip2(att > 0 ? '$att ${tr('مرفق', 'files')}' : tr('بلا مرفق', 'no file'), T.inkSoft, icon: Icons.attach_file_rounded),
              // معاملةُ التخليص التي تخدمها كشوفُ الصفّ — كشارة الموقع.
              if (r['customs'] is List && (r['customs'] as List).isNotEmpty) CustomsLinkChips(r['customs']),
            ]),
            const SizedBox(height: 4),
            kv(tr('مسؤول التحصيل', 'Collector'), '${r['officer'] ?? '—'}${r['officerIsDefault'] == true ? ' (${tr('غير مُسنَد', 'unassigned')})' : ''}'),
            kv(isReport && r['source'] == 'workflow' ? tr('السداد / التسليم', 'Paid / delivered') : tr('الإصدار / التسليم', 'Issued / delivered'),
                '${_date(r['invoiceDate'])} / ${_date(r['deliveryDate'])}'),
            kv(tr('المدّة / الاستحقاق', 'Term / due'),
                '${r['term'] ?? '—'}${r['termIsDefault'] == true ? ' (${tr('افتراضية', 'default')})' : ''} / ${_date(r['dueDate'])}'),
            kv(tr('العمر / التأخير', 'Age / late'),
                '${r['age'] ?? '—'} (${_lbl(_bandLabels, '${r['ageBand'] ?? ''}')}) / ${late ? r['daysLate'] : '—'}'),
            kv(tr('القيمة / المحصَّل', 'Value / collected'), '${_money(r['total'])} / ${_money(r['collected'])}'),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final chips = <Widget>[
      for (final e in _query.entries)
        InputChip(
          label: Text(_chipLabel(e.key, e.value), style: const TextStyle(fontSize: 12)),
          onDeleted: () { setState(() => _query = {..._query}..remove(e.key)); _load(); },
        ),
      for (final e in _cf.entries)
        InputChip(
          label: Text('${tr(_colFilters.firstWhere((c) => c.$1 == e.key).$2, _colFilters.firstWhere((c) => c.$1 == e.key).$3)}: ${e.value.length}',
              style: const TextStyle(fontSize: 12)),
          onDeleted: () { setState(() => _cf.remove(e.key)); _load(); },
        ),
    ];
    return AppScaffold(
      title: Text(widget.title),
      actions: [IconButton(onPressed: _pickSort, icon: const Icon(Icons.sort_rounded), tooltip: tr('الفرز', 'Sort'))],
      body: RefreshIndicator(
        onRefresh: _load,
        child: NotificationListener<ScrollNotification>(
          onNotification: (n) {
            if (_more && !_loading && n.metrics.pixels > n.metrics.maxScrollExtent - 300) {
              _more = false;
              _load(append: true);
            }
            return false;
          },
          child: ListView(padding: const EdgeInsets.all(14), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
            if (chips.isNotEmpty) Wrap(spacing: 6, runSpacing: 6, children: chips),
            const SizedBox(height: 8),
            SearchField(
              controller: _search,
              dense: true,
              hint: tr('رقم الفاتورة أو أمر النقل أو العميل…', 'Number, customer or code…'),
              onChanged: (v) {
                _searchDeb?.cancel();
                _searchDeb = Timer(const Duration(milliseconds: 350), () { if (!mounted || v.trim() == _q) return; _q = v.trim(); _load(); });
              },
            ),
            const SizedBox(height: 8),
            SizedBox(
              height: 36,
              child: ListView(scrollDirection: Axis.horizontal, children: [
                for (final c in _colFilters)
                  Padding(
                    padding: const EdgeInsetsDirectional.only(end: 6),
                    child: ActionChip(
                      avatar: Icon(Icons.filter_list_rounded, size: 15, color: (_cf[c.$1]?.isNotEmpty ?? false) ? T.orange : T.inkSoft),
                      label: Text(tr(c.$2, c.$3), style: const TextStyle(fontSize: 12)),
                      onPressed: () => _pickColumn(c),
                    ),
                  ),
              ]),
            ),
            const SizedBox(height: 10),
            _summary(),
            const SizedBox(height: 10),
            if (_loading && _rows.isEmpty)
              ...const [Shimmer(height: 120), SizedBox(height: 8), Shimmer(height: 120)]
            else if (_error != null && _rows.isEmpty)
              ErrorRetry(message: _error!, onRetry: _load)
            else if (_rows.isEmpty)
              EmptyState(icon: Icons.inbox_outlined, title: _q.isNotEmpty ? tr('لا نتائج مطابقة', 'No matches') : tr('لا صفوف', 'No rows'))
            else
              ..._rows.map(_row),
            if (_more) const Padding(padding: EdgeInsets.all(12), child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
          ]),
        ),
      ),
    );
  }
}

/// تفصيلُ صفّ — كلُّ ما يُعرَف عنه، وفاتورةُ الدفتر بكشوفها، والمرفقات، وحالةُ القضيّة.
class _ReceivableDetailScreen extends StatefulWidget {
  final Map<String, dynamic> row;
  const _ReceivableDetailScreen({required this.row});
  @override
  State<_ReceivableDetailScreen> createState() => _ReceivableDetailScreenState();
}

class _ReceivableDetailScreenState extends State<_ReceivableDetailScreen> {
  Map<String, dynamic>? _inv;
  late Map<String, dynamic> r = {...widget.row};

  @override
  void initState() {
    super.initState();
    if (r['kind'] == 'tax' && r['source'] != 'workflow') {
      Api.instance.get('/api/collections-dept/invoices/tax/${Uri.encodeComponent('${r['invoiceNumber']}')}').then((d) {
        if (mounted) setState(() => _inv = Map<String, dynamic>.from(d as Map));
      }).catchError((_) {});
    }
  }

  Future<void> _setIssue(String state) async {
    final party = '${r['party'] ?? ''}';
    if (party.isEmpty) return;
    var note = '';
    if (state != 'none') {
      final ctrl = TextEditingController(text: r['issueState'] == state ? '${r['issueNote'] ?? ''}' : '');
      final v = await showDialog<String>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text(_lbl(_issueLabels, state)),
          content: TextField(controller: ctrl, autofocus: true, maxLines: 3,
              decoration: InputDecoration(labelText: state == 'legal' ? tr('رقم القضية أو بيانها', 'Case number or details') : tr('ما المتّفق عليه', 'What was agreed'))),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel'))),
            FilledButton(onPressed: () => Navigator.pop(c, ctrl.text.trim()), child: Text(tr('حفظ', 'Save'))),
          ],
        ),
      );
      if (v == null || v.isEmpty) return;
      note = v;
    }
    try {
      await Api.instance.put('/api/collections-dept/parties/$party/issue', {'state': state, 'note': note});
      if (mounted) setState(() { r['issueState'] = state; r['issueNote'] = note; });
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final isWf = r['source'] == 'workflow';
    final attKind = isWf ? 'cash' : (r['kind'] == 'tax' ? 'tax' : '');
    final attKey = isWf ? '${r['_id']}' : '${r['invoiceNumber']}';
    Widget kv(String a, String b) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(flex: 2, child: Text(a, style: const TextStyle(fontSize: 12.5, color: T.inkSoft))),
            Expanded(flex: 3, child: Text(b, textAlign: TextAlign.end, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700))),
          ]),
        );
    final reports = [for (final x in (_inv?['reports'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)];
    return AppScaffold(
      title: Text('${r['invoiceNumber'] ?? ''}'),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${r['partyName'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            if ('${r['partyCode'] ?? ''}'.isNotEmpty) Text('${r['partyCode']}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
            const Divider(height: 18),
            kv(tr('النوع', 'Type'), isWf || r['kind'] == 'cash' ? tr('أمر نقل', 'Exit report') : tr('فاتورة', 'Invoice')),
            kv(tr('نوع الدفع', 'Payment type'), _lbl(_payLabels, '${r['payKind'] ?? ''}')),
            kv(tr('مسؤول التحصيل', 'Collector'), '${r['officer'] ?? '—'}${r['officerIsDefault'] == true ? ' (${tr('مدير القسم — غير مُسنَد', 'manager — unassigned')})' : ''}'),
            kv(isWf ? tr('تاريخ السداد', 'Payment date') : tr('تاريخ الإصدار', 'Issue date'), _date(r['invoiceDate'])),
            kv(tr('التسليم للعميل', 'Delivered'), _date(r['deliveryDate'])),
            kv(tr('المدّة (يوم)', 'Term (days)'), '${r['term'] ?? '—'}${r['termIsDefault'] == true ? ' (${tr('افتراضية', 'default')})' : ''}'),
            kv(tr('تاريخ الاستحقاق', 'Due date'), _date(r['dueDate'])),
            kv(tr('الاستحقاق', 'Due status'), _lbl(_dueLabels, '${r['dueState'] ?? ''}')),
            kv(tr('العمر (يوم)', 'Age (days)'), '${r['age'] ?? '—'} · ${_lbl(_bandLabels, '${r['ageBand'] ?? ''}')}'),
            kv(tr('الخطورة', 'Risk'), _lbl(_riskLabels, '${r['risk'] ?? ''}')),
            kv(tr('التأخير (يوم)', 'Days late'), (r['daysLate'] is num && (r['daysLate'] as num) > 0) ? '${r['daysLate']}' : '—'),
            const Divider(height: 18),
            kv(tr('القيمة', 'Value'), _money(r['total'])),
            kv(tr('المحصَّل', 'Collected'), _money(r['collected'])),
            kv(tr('المتبقّي', 'Remaining'), _money(r['remaining'])),
            // ومعاملاتُ التخليص التي تخدمها كشوفُه.
            if (r['customs'] is List && (r['customs'] as List).isNotEmpty) ...[
              const Divider(height: 18),
              Text(tr('التخليص الجمركي', 'Customs clearance'), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
              const SizedBox(height: 6),
              Wrap(spacing: 6, runSpacing: 6, children: [for (final l in r['customs'] as List) CustomsLinkChip(l)]),
            ],
          ]),
        ),
        const SizedBox(height: 10),
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('حالة القضية', 'Case state'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
            const SizedBox(height: 6),
            Text(_lbl(_issueLabels, '${r['issueState'] ?? 'none'}'), style: const TextStyle(fontWeight: FontWeight.w700)),
            if ('${r['issueNote'] ?? ''}'.isNotEmpty) Text('${r['issueNote']}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
            if (collectionsCanEdit && '${r['party'] ?? ''}'.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(spacing: 8, children: [
                OutlinedButton.icon(onPressed: () => _setIssue('negotiating'), icon: const Icon(Icons.handshake_outlined, size: 16), label: Text(tr('تحت التفاوض', 'Negotiating'))),
                OutlinedButton.icon(onPressed: () => _setIssue('legal'), icon: const Icon(Icons.gavel_rounded, size: 16), label: Text(tr('قضايا', 'Legal'))),
                if (r['issueState'] != 'none') TextButton(onPressed: () => _setIssue('none'), child: Text(tr('رفع الحالة', 'Clear'))),
              ]),
            ],
          ]),
        ),
        if (attKind.isNotEmpty) ...[
          const SizedBox(height: 10),
          AppCard(
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.attach_file_rounded, color: T.navy),
              title: Text(tr('المرفقات', 'Attachments')),
              subtitle: Text('${r['attachments'] ?? 0}'),
              trailing: Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right),
              onTap: () => openCollectionAttachments(context, kind: attKind, key: attKey, label: '${r['invoiceNumber']}'),
            ),
          ),
        ],
        if (reports.isNotEmpty) ...[
          const SizedBox(height: 10),
          AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${tr('أوامر نقل الفاتورة', 'Invoice reports')} (${reports.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              const SizedBox(height: 6),
              for (final x in reports)
                InkWell(
                  // الكشفُ يُضغط فتُفتح متابعاتُه — السجلُّ نفسُه في التشغيل والتخليص.
                  onTap: () => showModalBottomSheet(
                    context: context,
                    isScrollControlled: true,
                    useSafeArea: true,
                    builder: (_) => FractionallySizedBox(
                      heightFactor: 0.8,
                      child: ListView(padding: const EdgeInsets.all(16), children: [
                        Text('${tr('متابعات أمر النقل', 'Report follow-ups')} ${x['reportNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                        const SizedBox(height: 10),
                        ReportFollowUpsView(workflowId: '${x['_id']}', basePath: '/api/collections-dept/reports/${x['_id']}/follow-ups'),
                      ]),
                    ),
                  ),
                  child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Row(children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${x['reportNumber'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                        Text('${x['fromLocation'] ?? ''} → ${x['toLocation'] ?? ''} · ${_date(x['reportDate'])}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                        if (customsIdOf(x['customs']).isNotEmpty)
                          Padding(padding: const EdgeInsets.only(top: 3), child: CustomsLinkChip(x['customs'], compact: true)),
                      ]),
                    ),
                    if ((x['followUps'] ?? 0) is num && (x['followUps'] as num) > 0)
                      Padding(
                        padding: const EdgeInsetsDirectional.only(end: 8),
                        child: Row(mainAxisSize: MainAxisSize.min, children: [
                          const Icon(Icons.chat_bubble_outline, size: 13, color: T.inkSoft),
                          const SizedBox(width: 2),
                          Text('${x['followUps']}', style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                        ]),
                      ),
                    Text(_money(x['totalInvoice'] ?? x['sellingValue']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                  ]),
                  ),
                ),
            ]),
          ),
        ],
      ]),
    );
  }
}

// ── القضايا — العملاءُ تحت التفاوض أو في القضاء ─────────────────────────────
// كصفحة الموقع `/system/collections-dept/cases`: من `/receivables/cases`، والضغطُ
// على عميلٍ يفتح فواتيرَه في شاشة تفاصيل المديونيّة بحالته.
class CollectionsCasesScreen extends StatefulWidget {
  const CollectionsCasesScreen({super.key});
  @override
  State<CollectionsCasesScreen> createState() => _CollectionsCasesScreenState();
}

class _CollectionsCasesScreenState extends State<CollectionsCasesScreen> {
  Map<String, dynamic>? _data;
  String? _error;
  // الفلاترُ متعدّدةُ القيم كالموقع: الحالة، مسؤول التحصيل، نوع الدفع، الاستحقاق.
  final Set<String> _state = {}, _officer = {}, _pay = {}, _due = {};
  String _q = '';
  int _seq = 0, _miniSeq = 0;
  String _busy = '';
  // فواتيرُ عميلٍ تُفتَح تحت صفّه.
  String _open = '';
  Map<String, dynamic>? _mini;
  Timer? _tick;
  Timer? _searchDeb; // مستقلٌّ عن مؤقِّت التحديث الحيّ — كان يُلغي بحثًا مُنتظِرًا
  final _searchCtl = TextEditingController(); // النصُّ يبقى مطابقًا لـ_q
  void Function()? _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () {
      _tick?.cancel();
      _tick = Timer(const Duration(milliseconds: 800), _load);
    };
    for (final e in const ['collections:changed', 'collections:party', 'workflow:updated']) {
      Live.instance.on(e, _onLive!);
    }
  }

  @override
  void dispose() {
    for (final e in const ['collections:changed', 'collections:party', 'workflow:updated']) {
      Live.instance.off(e, _onLive!);
    }
    _tick?.cancel();
    _searchDeb?.cancel();
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/collections-dept/receivables/cases?${[
        if (_state.isNotEmpty) 'state=${_state.join(',')}',
        if (_officer.isNotEmpty) 'officer=${Uri.encodeQueryComponent(_officer.join(','))}',
        if (_pay.isNotEmpty) 'pay=${_pay.join(',')}',
        if (_due.isNotEmpty) 'dueState=${_due.join(',')}',
        if (_q.isNotEmpty) 'q=${Uri.encodeQueryComponent(_q)}',
      ].join('&')}');
      if (!mounted || mine != _seq) return;
      setState(() { _data = Map<String, dynamic>.from(d as Map); _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e.toString());
    }
  }

  Future<void> _toggle(Map<String, dynamic> p) async {
    final key = '${p['key']}';
    if (_open == key) { setState(() => _open = ''); return; }
    setState(() { _open = key; _mini = null; });
    final mine = ++_miniSeq;
    try {
      final d = await Api.instance.get('/api/collections-dept/receivables/rows?${[
        'parties=${Uri.encodeQueryComponent(key)}', 'issue=${p['state']}', 'limit=50',
        if (_pay.isNotEmpty) 'pay=${_pay.join(',')}',
        if (_due.isNotEmpty) 'dueState=${_due.join(',')}',
      ].join('&')}');
      if (!mounted || mine != _miniSeq) return;
      setState(() => _mini = {'key': key, 'rows': d['rows'] ?? const [], 'total': d['total'] ?? 0});
    } catch (e) {
      if (mounted && mine == _miniSeq) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر التحميل', 'Could not load'))));
      }
    }
  }

  void _openReceivables(Map<String, dynamic> p) => Navigator.push(context, MaterialPageRoute(builder: (_) => CollectionsReceivablesScreen(
        title: '${p['name']}',
        query: {
          'parties': '${p['key']}', 'issue': '${p['state']}',
          if (_pay.isNotEmpty) 'pay': _pay.join(','),
          if (_due.isNotEmpty) 'dueState': _due.join(','),
        },
      )));

  /// تحت التفاوض أو قضايا — ببيانٍ يُكتب؛ أو رفعُ الحالة.
  Future<void> _setIssue(Map<String, dynamic> p, String next) async {
    var note = '';
    if (next != 'none') {
      final ctrl = TextEditingController(text: '${p['state']}' == next ? '${p['note'] ?? ''}' : '');
      final v = await showDialog<String>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text(next == 'legal' ? tr('قضايا', 'Legal') : tr('تحت التفاوض', 'Negotiating')),
          content: TextField(controller: ctrl, autofocus: true, maxLines: 3, minLines: 1, decoration: InputDecoration(
            labelText: next == 'legal' ? tr('رقمُ القضيّة أو بيانُها — «${p['name']}»', 'Case number or details — “${p['name']}”')
                : tr('ما المتَّفقُ عليه مع «${p['name']}»؟', 'What was agreed with “${p['name']}”?'),
          )),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel'))),
            FilledButton(onPressed: () => Navigator.pop(c, ctrl.text.trim()), child: Text(tr('حفظ', 'Save'))),
          ],
        ),
      );
      ctrl.dispose();
      if (v == null || v.isEmpty) return;
      note = v;
    }
    setState(() => _busy = '${p['key']}');
    try {
      await Api.instance.put('/api/collections-dept/parties/${p['party']}/issue', {'state': next, 'note': note});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(next == 'none' ? tr('رُفعت الحالة', 'Cleared') : tr('سُجِّلت الحالة', 'Recorded'))));
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر الحفظ', 'Could not save'))));
    }
    if (mounted) setState(() => _busy = '');
  }

  Future<void> _pickMulti(String title, List<(String, String)> opts, Set<String> sel) async {
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, set) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(c).size.height * 0.7),
          child: ListView(shrinkWrap: true, children: [
            ListTile(title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
                trailing: TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('تم', 'Done')))),
            for (final o in opts)
              CheckboxListTile(
                value: sel.contains(o.$1), title: Text(o.$2),
                onChanged: (_) => set(() { if (!sel.remove(o.$1)) sel.add(o.$1); }),
              ),
          ]),
        ),
      )),
    );
    setState(() {});
    _load();
  }

  Widget _filter(String label, Set<String> sel, List<(String, String)> opts) => Padding(
        padding: const EdgeInsetsDirectional.only(end: 6),
        child: InputChip(
          label: Text(sel.isEmpty ? label : '$label (${sel.length})'),
          selected: sel.isNotEmpty,
          onPressed: () => _pickMulti(label, opts, sel),
          onDeleted: sel.isEmpty ? null : () { setState(sel.clear); _load(); },
        ),
      );

  static String _stateLabel(String s) => s == 'legal' ? tr('قضايا', 'Legal') : tr('تحت التفاوض', 'Negotiating');

  List<ExportCol> get _cols => [
        ExportCol('العميل', 'Customer', (r) => r['name']),
        ExportCol('الكود', 'Code', (r) => r['code']),
        ExportCol('الحالة', 'State', (r) => _stateLabel('${r['state']}')),
        ExportCol('البيان', 'Note', (r) => r['note']),
        ExportCol('منذ', 'Since', (r) => _date(r['since'])),
        ExportCol('سجّلها', 'Recorded by', (r) => r['updatedByName']),
        ExportCol('مسؤول التحصيل', 'Collector', (r) => r['officer']),
        ExportCol('فواتير مفتوحة', 'Open invoices', (r) => r['count']),
        ExportCol('المديونية', 'Outstanding', (r) => r['value']),
        ExportCol('منها متأخر', 'Of which late', (r) => r['lateValue']),
        ExportCol('منها مرتفع الخطورة', 'Of which hard risk', (r) => r['hardValue']),
        ExportCol('أقدم عمر (يوم)', 'Oldest (days)', (r) => r['oldest']),
      ];

  Widget _miniRows(Map<String, dynamic> p) {
    final bands = (p['bands'] as Map?) ?? const {};
    final m = _mini;
    final rows = m != null && m['key'] == p['key'] ? [for (final r in (m['rows'] as List)) Map<String, dynamic>.from(r as Map)] : null;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Divider(),
      // شرائحُ العمر لهذا العميل — قيمٌ لا ألوان.
      Wrap(spacing: 10, runSpacing: 2, children: [
        for (final b in const ['d1_15', 'd16_30', 'd31_60', 'd61_90', 'd91_plus'])
          Text('${_lbl(_bandLabels, b)}: ${_money(bands[b])}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
        Text('${tr('المدّة', 'Term')}: ${p['term'] ?? '—'}${(p['creditDays'] ?? 0) == 0 ? ' (${tr('افتراضية', 'default')})' : ''}',
            style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
      ]),
      const SizedBox(height: 6),
      if (rows == null)
        Text(tr('جارٍ التحميل…', 'Loading…'), style: const TextStyle(fontSize: 12, color: T.inkFaint))
      else if (rows.isEmpty)
        Text(tr('لا فواتير مفتوحة', 'No open invoices'), style: const TextStyle(fontSize: 12, color: T.inkFaint))
      else
        for (final r in rows)
          InkWell(
            onTap: () {
              if ('${r['kind']}' == 'tax') {
                Navigator.push(context, MaterialPageRoute(builder: (_) => CollectionsTaxInvoiceScreen(invoiceNumber: '${r['invoiceNumber']}')));
              } else if ('${r['workflowId'] ?? ''}'.isNotEmpty) {
                Navigator.push(context, MaterialPageRoute(builder: (_) => OpsWorkflowDetailScreen(id: '${r['workflowId']}')));
              }
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${r['invoiceNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700, color: T.orange, fontSize: 12.5)),
                    Text([
                      _lbl(_payLabels, '${r['payKind'] ?? ''}'),
                      '${tr('الإصدار', 'Issued')} ${_date(r['invoiceDate'])}',
                      '${tr('التسليم', 'Delivered')} ${_date(r['deliveryDate'])}',
                      '${tr('الاستحقاق', 'Due')} ${_date(r['dueDate'])}',
                      '${tr('العمر', 'Age')} ${r['age'] ?? '—'}',
                      if ((r['daysLate'] is num) && (r['daysLate'] as num) > 0) '${tr('التأخير', 'Late')} ${r['daysLate']}',
                    ].join(' · '), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                  ]),
                ),
                Text(_money(r['total']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
              ]),
            ),
          ),
      if (m != null && m['key'] == p['key'] && ((m['total'] as num?) ?? 0) > (rows?.length ?? 0))
        TextButton(
          onPressed: () => _openReceivables(p),
          child: Text(tr('يُعرَض ${rows?.length ?? 0} من ${m['total']} — افتح الكلّ', 'Showing ${rows?.length ?? 0} of ${m['total']} — open all')),
        ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final parties = [for (final p in (_data?['parties'] as List? ?? const [])) Map<String, dynamic>.from(p as Map)];
    final summary = (_data?['summary'] as Map?) ?? const {};
    final officers = [for (final o in (_data?['officers'] as List? ?? const [])) '$o'];
    final manager = '${((_data?['manager'] as Map?) ?? const {})['name'] ?? ''}';
    final totalValue = parties.fold<num>(0, (a, p) => a + ((p['value'] as num?) ?? 0));
    final active = _state.length + _officer.length + _pay.length + _due.length + (_q.isNotEmpty ? 1 : 0);
    Widget card(String s) {
      final n = (summary[s] as Map?) ?? const {};
      final on = _state.length == 1 && _state.contains(s);
      return Expanded(
        child: Pressable(
          onTap: () { setState(() { _state.clear(); if (!on) _state.add(s); }); _load(); },
          child: AppCard(
            padding: const EdgeInsets.all(12),
            topAccent: on ? T.orange : null,
            child: Column(children: [
              Text(_lbl(_issueLabels, s), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: on ? T.ink : T.inkSoft)),
              const SizedBox(height: 4),
              Text(_money(n['value']), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
              Text('${_money(n['customers'])} ${tr('عميل', 'customers')} · ${_money(n['count'])} ${tr('فاتورة مفتوحة', 'open invoices')}',
                  style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            ]),
          ),
        ),
      );
    }

    return AppScaffold(
      title: Text(tr('القضايا', 'Cases')),
      actions: [
        if (parties.isNotEmpty)
          ExportButton(fileName: 'collections-cases', sheetName: tr('القضايا', 'Cases'), columns: _cols, rows: () => parties),
      ],
      body: _data == null && _error == null
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer()])
          : _error != null && _data == null
              ? ErrorRetry(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                    Row(children: [card('negotiating'), const SizedBox(width: 10), card('legal')]),
                    const SizedBox(height: 10),
                    SearchField(
                      controller: _searchCtl,
                      dense: true,
                      hint: tr('اسم العميل أو كوده…', 'Customer or code…'),
                      onChanged: (v) {
                        _searchDeb?.cancel();
                        _searchDeb = Timer(const Duration(milliseconds: 350), () { _q = v.trim(); _load(); });
                      },
                    ),
                    const SizedBox(height: 8),
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(children: [
                        _filter(tr('الحالة', 'State'), _state, [('negotiating', _stateLabel('negotiating')), ('legal', _stateLabel('legal'))]),
                        _filter(tr('مسؤول التحصيل', 'Collector'), _officer,
                            [for (final o in officers) (o, o == manager ? '$o — ${tr('مدير القسم', 'Dept. manager')}' : o)]),
                        _filter(tr('نوع الدفع', 'Payment type'), _pay, [for (final e in _payLabels.entries) (e.key, tr(e.value.$1, e.value.$2))]),
                        _filter(tr('الاستحقاق', 'Due status'), _due, [for (final e in _dueLabels.entries) (e.key, tr(e.value.$1, e.value.$2))]),
                        if (active > 0)
                          TextButton.icon(
                            onPressed: () { setState(() { _state.clear(); _officer.clear(); _pay.clear(); _due.clear(); }); _load(); },
                            icon: const Icon(Icons.close, color: T.danger),
                            label: Text(tr('إزالة الفلاتر ($active)', 'Clear filters ($active)'), style: const TextStyle(color: T.danger)),
                          ),
                      ]),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Text(tr('${parties.length} عميل · ${_money(totalValue)}', '${parties.length} customers · ${_money(totalValue)}'),
                          style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                    ),
                    if (parties.isEmpty) EmptyState(icon: Icons.gavel_rounded, title: _q.isNotEmpty ? tr('لا نتائج مطابقة', 'No matches') : tr('لا عملاء تحت التفاوض أو في القضايا', 'No customers in cases')),
                    for (final p in parties)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Pressable(
                          onTap: () => _toggle(p),
                          child: AppCard(
                            padding: const EdgeInsets.all(12),
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [
                                Icon(_open == '${p['key']}' ? Icons.expand_less : Icons.expand_more, size: 18, color: T.inkFaint),
                                Expanded(
                                  child: InkWell(
                                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => CollectionsPartyScreen(id: '${p['party']}'))),
                                    child: Text('${p['name']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: T.orange)),
                                  ),
                                ),
                                InkWell(
                                  onTap: ((p['count'] as num?) ?? 0) > 0 ? () => _openReceivables(p) : null,
                                  child: Text(_money(p['value']), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14.5, decoration: TextDecoration.underline)),
                                ),
                              ]),
                              const SizedBox(height: 4),
                              Wrap(spacing: 6, runSpacing: 4, children: [
                                Chip2(_lbl(_issueLabels, '${p['state']}'), '${p['state']}' == 'legal' ? T.danger : T.info, icon: Icons.gavel_rounded),
                                Chip2('${_money(p['count'])} ${tr('فاتورة مفتوحة', 'open invoices')}', T.inkSoft),
                                if ('${p['code'] ?? ''}'.isNotEmpty) Chip2('${p['code']}', T.inkSoft),
                                Chip2('${tr('متأخر', 'late')} ${_money(p['lateValue'])}', T.warn),
                                Chip2('${tr('مرتفع الخطورة', 'hard risk')} ${_money(p['hardValue'])}', T.danger),
                              ]),
                              if ('${p['note'] ?? ''}'.isNotEmpty) ...[
                                const SizedBox(height: 4),
                                Text('${p['note']}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                              ],
                              const SizedBox(height: 4),
                              Text([
                                '${tr('منذ', 'Since')} ${_date(p['since'])}',
                                if ('${p['updatedByName'] ?? ''}'.isNotEmpty) '${p['updatedByName']}',
                                '${p['officer'] ?? '—'}${p['officerIsDefault'] == true ? ' (${tr('غير مُسنَد', 'unassigned')})' : ''}',
                                '${tr('أقدم', 'oldest')} ${p['oldest'] ?? '—'}',
                              ].join(' · '), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                              Row(children: [
                                if (collectionsCanEdit) ...[
                                  IconButton(tooltip: tr('تحت التفاوض', 'Negotiating'), icon: const Icon(Icons.handshake_outlined, size: 20),
                                      onPressed: _busy == '${p['key']}' ? null : () => _setIssue(p, 'negotiating')),
                                  IconButton(tooltip: tr('قضايا', 'Legal'), icon: const Icon(Icons.balance_rounded, size: 20),
                                      onPressed: _busy == '${p['key']}' ? null : () => _setIssue(p, 'legal')),
                                  IconButton(tooltip: tr('رفعُ الحالة', 'Clear'), icon: const Icon(Icons.block, size: 20),
                                      onPressed: _busy == '${p['key']}' ? null : () => _setIssue(p, 'none')),
                                ],
                                Expanded(child: Align(alignment: AlignmentDirectional.centerEnd, child: TextButton.icon(
                                  onPressed: ((p['count'] as num?) ?? 0) > 0 ? () => _openReceivables(p) : null,
                                  icon: const Icon(Icons.open_in_new, size: 16),
                                  label: Text(tr('تفاصيل المديونية', 'Receivables detail'), maxLines: 2, textAlign: TextAlign.center),
                                ))),
                              ]),
                              if (_open == '${p['key']}') _miniRows(p),
                            ]),
                          ),
                        ),
                      ),
                  ]),
                ),
    );
  }
}
