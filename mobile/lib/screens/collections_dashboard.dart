import 'dart:async';
import 'package:flutter/material.dart';
import '../resource/configs.dart' show collectionsCanEdit, collectionsAgingCfg, collectionsSuppliersCfg;
import '../resource/resource.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'collections_party.dart';
import 'collections_receivables.dart';

/// Collections dashboard, like the web page /system/collections-dept/dashboard: the debt tree from the invoice ledger under five filters and a date range, debt by collection officer, largest debts, entries to aging, cases and suppliers, and writing customer terms against the default term. Every number opens a screen of its rows. Live: any edit to a sheet, invoice, party, attachment or finance re-reads after the batch settles, and existing numbers stay until the new ones arrive.
class CollectionsDashboardScreen extends StatefulWidget {
  const CollectionsDashboardScreen({super.key});
  @override
  State<CollectionsDashboardScreen> createState() => _CollectionsDashboardScreenState();
}

String _m(dynamic n) {
  final v = (n is num) ? n : num.tryParse('$n') ?? 0;
  final s = v.round().abs().toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');
  return v < 0 ? '-$s' : s;
}
String _ymd(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
Map<String, dynamic> _map(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};
num _num(dynamic v) => v is num ? v : 0;

const _filters = [
  ('officer', 'مسؤول التحصيل', 'Collector', true),
  ('parties', 'العميل', 'Customer', true),
  ('pay', 'نوع الدفع', 'Payment type', false),
  ('dueState', 'الاستحقاق', 'Due status', false),
  ('issue', 'القضايا', 'Cases', false),
];
const _fixedLabels = <String, Map<String, (String, String)>>{
  'pay': {
    'tax': ('ضريبي', 'Tax'), 'cash': ('كاش', 'Cash'),
    'deferred_invoice': ('آجل - فاتورة', 'Deferred – invoice'), 'deferred_cash': ('آجل - كاش', 'Deferred – cash'),
    'cash_3pl': ('نقدي - 3PL', 'Cash – 3PL'), 'cash_ht': ('نقدي - HT', 'Cash – HT'),
  },
  'dueState': {
    'late': ('مستحق — تجاوز موعده', 'Due — past its date'),
    'noterm': ('مستحق — بلا مدّة سداد', 'Due — no credit term'),
    'within': ('غير مستحق', 'Not yet due'),
  },
  'issue': {
    'none': ('بلا مشكلة', 'No issue'), 'negotiating': ('تحت التفاوض', 'Negotiating'), 'legal': ('قضايا', 'Legal'),
  },
};
const _subtypes = [
  ('deferred_invoice', 'آجل - فاتورة', 'Deferred – invoice', Color(0xFF475569), true),
  ('deferred_cash', 'آجل - كاش', 'Deferred – cash', Color(0xFF0D9488), false),
  ('cash_3pl', 'نقدي - 3PL', 'Cash – 3PL', Color(0xFF14B8A6), false),
  ('cash_ht', 'نقدي - HT', 'Cash – HT', Color(0xFF5EEAD4), false),
];
const _bands = [
  ('d1_15', '1 – 15 يومًا', '1–15 days'),
  ('d16_30', '16 – 30 يومًا', '16–30 days'),
  ('d31_60', '31 – 60 يومًا', '31–60 days'),
  ('d61_90', '61 – 90 يومًا', '61–90 days'),
  ('d91_plus', 'أكثر من 90 يومًا', 'Over 90 days'),
];
const _risks = [('normal', 'طبيعي', 'Normal', T.success), ('medium', 'متوسط', 'Medium', T.warn), ('hard', 'مرتفع', 'Hard', T.danger)];

/// "12 invoices, 3 clearance sheets": what the cell holds of each; zero is not mentioned.
String _units(Map<String, dynamic> n) {
  final cash = _num(n['cash']);
  final tax = n['tax'] is num ? n['tax'] as num : (cash != 0 ? 0 : _num(n['count']));
  return [
    if (tax != 0 || cash == 0) '${_m(tax)} ${tr('فاتورة', 'invoices')}',
    if (cash != 0) '${_m(cash)} ${tr('أمر نقل', 'reports')}',
  ].join(' · ');
}

class _CollectionsDashboardScreenState extends State<CollectionsDashboardScreen> {
  Map<String, dynamic>? _recv;
  Map<String, dynamic>? _dash;
  bool _loading = true;
  String? _error;
  final Map<String, Set<String>> _sel = {};
  String _from = '', _to = '';
  int _recvSeq = 0, _dashSeq = 0;
  Timer? _tick;
  late final void Function() _soon;
  static const _events = ['workflow:updated', 'workflow:bulkImported', 'collections:party', 'finance:changed', 'collections:changed', 'collections:attachments'];

  @override
  void initState() {
    super.initState();
    _soon = () {
      _tick?.cancel();
      _tick = Timer(const Duration(milliseconds: 800), _load);
    };
    for (final e in _events) { Live.instance.on(e, _soon); }
    _load();
  }

  @override
  void dispose() {
    for (final e in _events) { Live.instance.off(e, _soon); }
    _tick?.cancel();
    super.dispose();
  }

  /// Filters as the server reads them (parseFilters), comma-separated.
  Map<String, String> get _filterQuery => {
        if (_from.isNotEmpty) 'from': _from,
        if (_to.isNotEmpty) 'to': _to,
        for (final e in _sel.entries) if (e.value.isNotEmpty) e.key: e.value.join(','),
      };

  void _load() { _loadRecv(); _loadDash(); }

  Future<void> _loadRecv() async {
    final mine = ++_recvSeq;
    try {
      final q = _filterQuery.entries.map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&');
      final d = await Api.instance.get('/api/collections-dept/receivables/overview${q.isEmpty ? '' : '?$q'}');
      if (!mounted || mine != _recvSeq) return;
      setState(() { _recv = _map(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _recvSeq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  // From the operations sheets dashboard only the supplier count remains; all money comes from the ledger.
  Future<void> _loadDash() async {
    final mine = ++_dashSeq;
    try {
      final d = await Api.instance.get('/api/collections-dept/dashboard');
      if (mounted && mine == _dashSeq) setState(() => _dash = _map(d));
    } catch (_) {/* Does not stop the dashboard. */}
  }

  void _open(String title, [Map<String, String> node = const {}]) {
    Navigator.push(context, MaterialPageRoute(builder: (_) => CollectionsReceivablesScreen(title: title, query: {..._filterQuery, ...node})));
  }

  // Filters
  List<Map<String, dynamic>> _facet(String key) =>
      [for (final o in (_map(_recv?['facets'])[key] as List? ?? const [])) _map(o)];

  String _optLabel(String key, Map<String, dynamic> o) {
    final v = '${o['value'] ?? ''}';
    final l = _fixedLabels[key]?[v];
    if (l != null) return tr(l.$1, l.$2);
    final s = '${o['label'] ?? ''}';
    final base = s.isEmpty ? v : s;
    if (key == 'officer' && o['isManager'] == true) return '$base — ${tr('مدير القسم', 'Dept. manager')}';
    return base;
  }

  void _openFilter((String, String, String, bool) f) {
    final opts = _facet(f.$1);
    final picked = {...(_sel[f.$1] ?? <String>{})};
    var q = '';
    showModalBottomSheet(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setSheet) {
        final shown = opts.where((o) {
          final v = '${o['value'] ?? ''}';
          if (_num(o['count']) <= 0 && !picked.contains(v)) return false;
          if (q.isEmpty) return true;
          final l = q.toLowerCase();
          return _optLabel(f.$1, o).toLowerCase().contains(l) || v.toLowerCase().contains(l) || '${o['code'] ?? ''}'.toLowerCase().contains(l);
        }).toList();
        return SafeArea(child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(c).size.height * 0.8),
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 12, 16, 12 + MediaQuery.of(c).viewInsets.bottom),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                Expanded(child: Text(tr(f.$2, f.$3), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
                if (picked.isNotEmpty) TextButton(onPressed: () => setSheet(picked.clear), child: Text(tr('مسح', 'Clear'))),
              ]),
              if (f.$4)
                Padding(padding: const EdgeInsets.only(bottom: 6), child: SearchField(
                  dense: true,
                  hint: tr('ابحث…', 'Search…'),
                  onChanged: (v) => setSheet(() => q = v.trim()),
                )),
              Flexible(child: ListView(shrinkWrap: true, keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                for (final o in shown)
                  CheckboxListTile(
                    dense: true, contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading,
                    value: picked.contains('${o['value'] ?? ''}'),
                    onChanged: (on) => setSheet(() { final v = '${o['value'] ?? ''}'; on == true ? picked.add(v) : picked.remove(v); }),
                    title: Text(_optLabel(f.$1, o), style: const TextStyle(fontSize: 13.5)),
                    subtitle: o['amount'] is num ? Text(_m(o['amount']), style: const TextStyle(fontSize: 11)) : null,
                    secondary: Text('${o['count'] ?? 0}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                  ),
                if (shown.isEmpty)
                  Padding(padding: const EdgeInsets.all(18), child: Text(tr('لا نتائج', 'No matches'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
              ])),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: () { Navigator.pop(c); setState(() => _sel[f.$1] = picked); _loadRecv(); },
                child: Text(tr('تطبيق', 'Apply')),
              ),
            ]),
          ),
        ));
      }),
    );
  }

  Future<void> _pickDate(bool from) async {
    final cur = DateTime.tryParse(from ? _from : _to) ?? DateTime.now();
    final v = await showDatePicker(context: context, initialDate: cur, firstDate: DateTime(2018), lastDate: DateTime(2035));
    if (v == null) return;
    setState(() { if (from) { _from = _ymd(v); } else { _to = _ymd(v); } });
    _loadRecv();
  }

  Widget _filterBar() {
    final active = _sel.values.where((v) => v.isNotEmpty).length + (_from.isNotEmpty || _to.isNotEmpty ? 1 : 0);
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(children: [
        for (final f in _filters) ...[
          FilterChip(
            label: Text('${tr(f.$2, f.$3)}${(_sel[f.$1]?.isNotEmpty ?? false) ? ' (${_sel[f.$1]!.length})' : ''}', style: const TextStyle(fontSize: 12)),
            selected: _sel[f.$1]?.isNotEmpty ?? false,
            selectedColor: T.orange.withValues(alpha: 0.15),
            onSelected: (_) => _openFilter(f),
          ),
          const SizedBox(width: 6),
        ],
        ActionChip(avatar: const Icon(Icons.event, size: 16), label: Text(_from.isEmpty ? tr('من', 'From') : _from, style: const TextStyle(fontSize: 12)), onPressed: () => _pickDate(true)),
        const SizedBox(width: 6),
        ActionChip(avatar: const Icon(Icons.event, size: 16), label: Text(_to.isEmpty ? tr('إلى', 'To') : _to, style: const TextStyle(fontSize: 12)), onPressed: () => _pickDate(false)),
        if (active > 0) ...[
          const SizedBox(width: 6),
          ActionChip(
            avatar: const Icon(Icons.clear, size: 16, color: T.danger),
            label: Text(tr('مسح الفلاتر', 'Clear filters'), style: const TextStyle(fontSize: 12, color: T.danger)),
            onPressed: () { setState(() { _sel.clear(); _from = ''; _to = ''; }); _loadRecv(); },
          ),
        ],
      ]),
    );
  }

  // Tree items
  Widget _cell(String label, Map<String, dynamic> n, String sub, VoidCallback onTap, {Color? dot, double size = 18}) => InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
          child: Column(children: [
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              if (dot != null) ...[Container(width: 7, height: 7, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)), const SizedBox(width: 4)],
              Flexible(child: Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 11.5, color: T.inkSoft, fontWeight: FontWeight.w600))),
            ]),
            const SizedBox(height: 2),
            Text(_m(n['value']), style: TextStyle(fontSize: size, fontWeight: FontWeight.w800)),
            Text(sub, textAlign: TextAlign.center, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
          ]),
        ),
      );

  String _customers(Map<String, dynamic> n) => '${_m(n['customers'])} ${tr('عميل', 'customers')}';

  Widget _tree(Map<String, dynamic> tree) {
    final all = _map(tree['all']);
    final byKind = _map(tree['byKind']);
    final tax = _map(byKind['tax']), cash = _map(byKind['cash']);
    final allV = _num(all['value']);
    double share(Map<String, dynamic> n) => allV == 0 ? 0 : _num(n['value']) / allV;
    final subtypes = _map(tree['subtypes']);
    final ages = _map(tree['ages']);
    final risk = _map(tree['risk']);
    final nodate = _map(_map(ages['nodate'])['total']);
    final attach = _map(_recv?['attachments']);
    final term = _map(_recv?['defaultTerm']);
    final checks = [for (final c in (_recv?['checks'] as List? ?? const [])) _map(c)];
    final bad = checks.where((c) => c['ok'] != true).toList();

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      // 1. The total and its two halves
      Text(tr('إجمالي المديونية', 'Total receivables'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: T.inkSoft)),
      const SizedBox(height: 6),
      AppCard(padding: EdgeInsets.zero, child: Column(children: [
        InkWell(
          onTap: () => _open(tr('كلُّ المديونية', 'All receivables')),
          child: Padding(padding: const EdgeInsets.fromLTRB(12, 16, 12, 10), child: Column(children: [
            Text(tr('كلُّ ما لنا — غيرُ محصَّل', 'All outstanding'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
            const SizedBox(height: 4),
            Text(_m(allV), style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w900)),
            Text('${_m(tax['count'])} ${tr('فاتورة', 'invoices')} · ${_m(cash['count'])} ${tr('أمر نقل', 'reports')}${all['customers'] != null ? ' · ${_customers(all)}' : ''}',
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          ])),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: ClipRRect(borderRadius: BorderRadius.circular(4), child: SizedBox(height: 6, child: Row(children: [
            Expanded(flex: (share(tax) * 1000).round().clamp(0, 1000), child: Container(color: const Color(0xFF475569))),
            Expanded(flex: (share(cash) * 1000).round().clamp(0, 1000), child: Container(color: const Color(0xFF14B8A6))),
            Expanded(flex: (1000 - (share(tax) * 1000).round() - (share(cash) * 1000).round()).clamp(0, 1000), child: Container(color: T.line)),
          ]))),
        ),
        const Divider(height: 16),
        Row(children: [
          Expanded(child: _cell(tr('فواتير', 'Invoices'), tax, '${_m(tax['count'])} ${tr('فاتورة', 'invoices')} · ${(share(tax) * 100).toStringAsFixed(1)}%',
              () => _open(tr('المديونية الضريبية', 'Tax receivables'), {'kind': 'tax'}), dot: const Color(0xFF475569))),
          Expanded(child: _cell(tr('كاش', 'Cash'), cash, '${_m(cash['count'])} ${tr('أمر نقل', 'reports')} · ${(share(cash) * 100).toStringAsFixed(1)}%',
              () => _open(tr('المديونية الكاش', 'Cash receivables'), {'kind': 'cash'}), dot: const Color(0xFF14B8A6))),
        ]),
      ])),
      const SizedBox(height: 14),
      // 2. The four payment types
      Text(tr('بأنواع الدفع — مستحق وغير مستحق', 'By payment type — due and not yet due'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: T.inkSoft)),
      Text(tr('المستحقُّ ما تجاوز موعدَه، ومعه ما لا مدّةَ سدادٍ له — فلا شيءَ يؤجّله', 'Due = past its due date, plus anything with no credit term'),
          style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
      const SizedBox(height: 6),
      for (final s in _subtypes) Builder(builder: (_) {
        final n = _map(subtypes[s.$1]);
        final total = _map(n['total']);
        final unit = s.$5 ? tr('فاتورة', 'invoices') : tr('أمر نقل', 'reports');
        final label = tr(s.$2, s.$3);
        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: AppCard(padding: const EdgeInsets.fromLTRB(8, 10, 8, 2), child: Column(children: [
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              Container(width: 7, height: 7, decoration: BoxDecoration(color: s.$4, shape: BoxShape.circle)),
              const SizedBox(width: 5),
              Text(label, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
              const SizedBox(width: 8),
              Text('${_m(total['value'])} · ${_m(total['count'])} $unit', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            ]),
            Row(children: [
              Expanded(child: _cell(tr('مستحق', 'Due'), _map(n['due']), '${_m(_map(n['due'])['count'])} $unit',
                  () => _open('$label — ${tr('مستحق', 'Due')}', {'subtype': s.$1, 'due': 'due'}), size: 16)),
              Expanded(child: _cell(tr('غير مستحق', 'Not yet due'), _map(n['notDue']), '${_m(_map(n['notDue'])['count'])} $unit',
                  () => _open('$label — ${tr('غير مستحق', 'Not yet due')}', {'subtype': s.$1, 'due': 'notdue'}), size: 16)),
            ]),
          ])),
        );
      }),
      // 3. Age of delay
      if (tree['ages'] != null) ...[
        const SizedBox(height: 8),
        Text(tr('عمر التأخير', 'Age of receivables'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: T.inkSoft)),
        Text(tr('العمرُ من تسليم الفاتورة للعميل (وإلّا من إصدارها) · الخطورةُ على مدّة كلّ عميل N: طبيعي حتى N، متوسط حتى N+30، مرتفع بعدها',
            'Age from delivery to the customer (else issue) · risk on each customer’s term N: normal ≤ N, medium ≤ N+30, hard beyond'),
            style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
        const SizedBox(height: 6),
        if (tree['risk'] != null)
          AppCard(padding: EdgeInsets.zero, child: Row(children: [
            for (final r in _risks)
              Expanded(child: _cell(tr(r.$2, r.$3), _map(risk[r.$1]), '${_customers(_map(risk[r.$1]))}\n${_units(_map(risk[r.$1]))}',
                  () => _open('${tr('الخطورة', 'Risk')} — ${tr(r.$2, r.$3)}', {'risk': r.$1}), dot: r.$4, size: 15)),
          ])),
        const SizedBox(height: 8),
        for (final b in _bands) Builder(builder: (_) {
          final band = _map(ages[b.$1]);
          final total = _map(band['total']);
          final label = tr(b.$2, b.$3);
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: AppCard(padding: EdgeInsets.zero, child: Column(children: [
              _cell(label, total, '${_customers(total)} · ${_units(total)}', () => _open('${tr('عمر التأخير', 'Age')} — $label', {'band': b.$1}), size: 19),
              const Divider(height: 1),
              Row(children: [
                for (final r in _risks)
                  Expanded(child: Opacity(
                    opacity: _num(_map(band[r.$1])['count']) == 0 ? 0.55 : 1,
                    child: _cell(tr(r.$2, r.$3), _map(band[r.$1]), _units(_map(band[r.$1])),
                        () => _open('$label — ${tr(r.$2, r.$3)}', {'band': b.$1, 'risk': r.$1}), dot: r.$4, size: 14),
                  )),
              ]),
            ])),
          );
        }),
        if (_num(nodate['count']) > 0)
          TextButton(
            onPressed: () => _open(tr('بلا تاريخ', 'No date'), {'band': 'nodate'}),
            child: Text('${tr('بلا تاريخ تسليمٍ ولا إصدار', 'No delivery or issue date')}: ${_m(nodate['value'])} · ${_units(nodate)}', style: const TextStyle(fontSize: 11.5)),
          ),
      ],
      // 4. What the file lacks
      if (attach.isNotEmpty) ...[
        const SizedBox(height: 6),
        AppCard(padding: EdgeInsets.zero, child: Column(children: [
          _cell(tr('«آجل - فاتورة» بلا مرفق', '“Deferred – invoice” with no attachment'), _map(attach['missing']),
              '${_m(_map(attach['missing'])['count'])} ${tr('فاتورة', 'invoices')} ${tr('من', 'of')} ${_m(_map(attach['of'])['count'])} · ${tr('افتحها وارفع من الجدول', 'open and upload from the table')}',
              () => _open(tr('آجل - فاتورة — بلا مرفق', 'Deferred invoice — no attachment'), {'attach': 'missing'}), size: 20),
          if (_num(_map(attach['plainTaxMissing'])['count']) > 0) ...[
            const Divider(height: 1),
            TextButton(
              onPressed: () => _open(tr('ضريبي (بلا نوع) — بلا مرفق', 'Tax (no subtype) — no attachment'), {'attach': 'missing_tax'}),
              child: Text('${tr('ومن «ضريبي» بلا نوعٍ جديد', 'And plain “tax” (no subtype)')}: ${_m(_map(attach['plainTaxMissing'])['count'])} ${tr('فاتورة بلا مرفق', 'with no attachment')} · ${_m(_map(attach['plainTaxMissing'])['value'])}',
                  style: const TextStyle(fontSize: 11.5)),
            ),
          ],
        ])),
      ],
      if (term.isNotEmpty) ...[
        const SizedBox(height: 8),
        AppCard(padding: EdgeInsets.zero, child: Column(children: [
          InkWell(
            onTap: () => _open(tr('فواتير على المدّة الافتراضية', 'Invoices on the default term'), {'term': 'default'}),
            child: Padding(padding: const EdgeInsets.all(12), child: Column(children: [
              Text(tr('بمدّة افتراضية ${term['days'] ?? 30} يومًا — حدّد مدّة العميل', 'On the default ${term['days'] ?? 30}-day term — set the customer’s term'),
                  textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: T.inkSoft)),
              const SizedBox(height: 2),
              Text('${_m(term['customers'])} ${tr('عميل', 'customers')}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
              Text('${_m(term['value'])} · ${_units(term)}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            ])),
          ),
          const Divider(height: 1),
          TextButton(onPressed: _openDefaultTerm, child: Text(tr('حدّد مدد العملاء', 'Set the customers’ terms'))),
        ])),
      ],
      // 5. Verification bar
      const SizedBox(height: 8),
      Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: (bad.isEmpty ? T.success : T.danger).withValues(alpha: 0.08),
          border: Border.all(color: (bad.isEmpty ? T.success : T.danger).withValues(alpha: 0.3)),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(bad.isEmpty ? Icons.check_circle_outline : Icons.warning_amber_rounded, size: 18, color: bad.isEmpty ? T.success : T.danger),
          const SizedBox(width: 6),
          Expanded(child: Text(
            bad.isEmpty
                ? tr('الأرقام تُطابق نفسَها: الإجمالي = ضريبي + نقدي = شرائح العمر الخمس، وكلُّ شريحة = طبيعي + متوسط + مرتفع، وكلُّ نوعٍ من الأربعة = مستحق + غير مستحق.',
                    'The numbers reconcile at every level of the tree.')
                : bad.map((c) => '${c['of']}: ${tr('فرق', 'diff')} ${_m(c['diff'])} / ${c['n']}').join('\n'),
            style: TextStyle(fontSize: 11.5, color: bad.isEmpty ? T.success : T.danger),
          )),
        ]),
      ),
    ]);
  }

  Widget _officers() {
    final officers = [for (final o in (_recv?['officers'] as List? ?? const [])) _map(o)];
    if (officers.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SizedBox(height: 14),
      Row(children: [
        const Icon(Icons.how_to_reg_outlined, size: 18, color: T.inkSoft),
        const SizedBox(width: 6),
        Text(tr('المديونية بمسؤول التحصيل', 'Receivables by collector'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
      ]),
      const SizedBox(height: 6),
      for (final o in officers)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Pressable(
            // Opens the officer's rows with the dashboard filters, the officer alone instead of choosing the filter.
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => CollectionsReceivablesScreen(
                title: '${o['officer']}', query: {..._filterQuery, 'officer': '${o['officer'] ?? ''}'}))),
            child: AppCard(padding: const EdgeInsets.all(12), child: Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text.rich(TextSpan(children: [
                  TextSpan(text: '${o['officer'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                  if (o['isManager'] == true) TextSpan(text: '  ${tr('مدير القسم', 'Dept. manager')}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                ])),
                Text('${o['count'] ?? 0} ${tr('صف', 'rows')} · ${tr('متأخر', 'late')} ${_m(o['lateValue'])} · ${tr('مرتفع', 'hard')} ${_m(o['hardValue'])}',
                    style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                if (_num(o['defaulted']) > 0)
                  Text(tr('منها ${o['defaulted']} غير مُسنَد', '${o['defaulted']} of them unassigned'), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
              ])),
              Text(_m(o['value']), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
            ])),
          ),
        ),
    ]);
  }

  Widget _top() {
    final parties = [for (final p in (_recv?['parties'] as List? ?? const [])) _map(p)];
    final top = parties.take(15).toList();
    final maxV = top.fold<num>(1, (a, r) => _num(r['value']) > a ? _num(r['value']) : a);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SizedBox(height: 14),
      Row(children: [
        const Icon(Icons.groups_outlined, size: 18, color: T.inkSoft),
        const SizedBox(width: 6),
        Expanded(child: Text(tr('أكبر المديونيات', 'Largest receivables'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
        Text(tr('أعلى ${top.length} من ${parties.length}', 'Top ${top.length} of ${parties.length}'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
      ]),
      const SizedBox(height: 6),
      if (top.isEmpty)
        Padding(padding: const EdgeInsets.all(20), child: Text(tr('لا شيء مستحق', 'Nothing outstanding'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint)))
      else
        AppCard(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4), child: Column(children: [
          for (var i = 0; i < top.length; i++)
            InkWell(
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => CollectionsReceivablesScreen(
                  title: '${top[i]['name'] ?? ''}', query: {..._filterQuery, 'parties': '${top[i]['key'] ?? ''}'}))),
              onLongPress: '${top[i]['party'] ?? ''}'.isEmpty || top[i]['party'] == null
                  ? null
                  : () => Navigator.push(context, MaterialPageRoute(builder: (_) => CollectionsPartyScreen(id: '${top[i]['party']}'))),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(children: [
                  Container(
                    width: 26, height: 26, alignment: Alignment.center,
                    decoration: BoxDecoration(color: (i < 3 ? T.danger : T.inkSoft).withValues(alpha: 0.1), borderRadius: BorderRadius.circular(7)),
                    child: Text('${i + 1}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: i < 3 ? T.danger : T.inkSoft)),
                  ),
                  const SizedBox(width: 10),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text('${top[i]['name'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                      Text(_m(top[i]['value']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                    ]),
                    const SizedBox(height: 4),
                    ClipRRect(borderRadius: BorderRadius.circular(3), child: LinearProgressIndicator(
                      value: (_num(top[i]['value']) / maxV).clamp(0, 1).toDouble(), minHeight: 5,
                      backgroundColor: T.line.withValues(alpha: 0.4), color: T.danger.withValues(alpha: 0.7))),
                    const SizedBox(height: 2),
                    Text('${_m(top[i]['count'])} ${tr('فاتورة', 'invoices')} · ${tr('متأخّر', 'late')} ${_m(top[i]['lateValue'])}${'${top[i]['officer'] ?? ''}'.isNotEmpty ? ' · ${top[i]['officer']}' : ''}',
                        style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                  ])),
                ]),
              ),
            ),
        ])),
    ]);
  }

  Widget _navCard(IconData icon, String label, String value, VoidCallback onTap) => Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Pressable(onTap: onTap, child: AppCard(child: Row(children: [
          Container(width: 36, height: 36, decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10)), child: Icon(icon, color: T.inkSoft, size: 20)),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(fontSize: 12, color: T.inkFaint)),
            Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
          ])),
          const Icon(Icons.chevron_right, color: T.inkFaint),
        ]))),
      );

  void _openDefaultTerm() {
    final term = _map(_recv?['defaultTerm']);
    final parties = [for (final p in (term['parties'] as List? ?? const [])) _map(p)];
    showModalBottomSheet(
      context: context, isScrollControlled: true, useSafeArea: true,
      builder: (_) => _DefaultTermSheet(
        parties: parties, days: _num(term['days']) == 0 ? 30 : _num(term['days']).toInt(),
        canEdit: collectionsCanEdit, onSaved: _load,
        onOpenInvoices: (p) => _open('${p['name'] ?? ''}', {'parties': '${p['key'] ?? ''}', 'term': 'default'}),
      ),
    );
  }

  List<ExportCol> get _topCols => [
        ExportCol('الكود', 'Code', (r) => r['code']),
        ExportCol('العميل', 'Customer', (r) => r['name']),
        ExportCol('موظف التحصيل', 'Officer', (r) => r['officer']),
        ExportCol('فواتير', 'Invoices', (r) => r['count']),
        ExportCol('المديونية', 'Outstanding', (r) => r['value']),
        ExportCol('منها متأخر', 'Of which late', (r) => r['lateValue']),
        ExportCol('منها مرتفع الخطورة', 'Of which hard risk', (r) => r['hardValue']),
      ];

  @override
  Widget build(BuildContext context) {
    final recv = _recv;
    final issueAmount = _facet('issue').where((x) => x['value'] != 'none').fold<num>(0, (a, x) => a + _num(x['amount']));
    final suppliers = _map(_map(_dash?['counts'])['supplier']);
    return AppScaffold(
      title: Text(tr('لوحة التحصيل', 'Collections dashboard')),
      actions: [
        ExportButton(
          fileName: 'collections-dashboard',
          sheetName: tr('المديونية بالعميل', 'Receivables by customer'),
          columns: _topCols,
          rows: () => [for (final p in (_recv?['parties'] as List? ?? const [])) _map(p)],
        ),
      ],
      body: _loading && recv == null
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 50), SizedBox(height: 10), Shimmer(height: 180), SizedBox(height: 10), Shimmer(height: 120)])
          : recv == null
              ? ErrorRetry(message: _error ?? tr('تعذّر التحميل', 'Could not load'), onRetry: _load)
              : RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: ListView(padding: const EdgeInsets.fromLTRB(14, 10, 14, 40), children: [
                    Row(children: [
                      Expanded(child: Text(tr('محسوبةٌ من دفتر الفواتير — حيّةٌ مع كلّ تحصيلٍ وتسليم', 'Straight from the invoice ledger — live with every collection and delivery'),
                          style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
                      Chip2(tr('مباشر', 'Live'), T.success, icon: Icons.circle),
                    ]),
                    const SizedBox(height: 8),
                    _filterBar(),
                    if (_error != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(_error!, style: const TextStyle(color: T.danger, fontSize: 12))),
                    const SizedBox(height: 10),
                    if (recv['tree'] != null) _tree(_map(recv['tree'])),
                    _officers(),
                    _top(),
                    _navCard(Icons.groups_outlined, tr('أعمار الديون — كلُّ الحسابات', 'Ageing — every account'), _m(_map(_map(recv['tree'])['all'])['value']),
                        () => Navigator.push(context, MaterialPageRoute(builder: (_) => ResourceScreen(config: collectionsAgingCfg)))),
                    _navCard(Icons.balance_outlined, tr('القضايا والتفاوض', 'Cases & negotiations'), _m(issueAmount),
                        () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CollectionsCasesScreen()))),
                    _navCard(Icons.local_shipping_outlined, tr('موردون مسجَّلون', 'Registered suppliers'), _dash == null ? '—' : _m(suppliers['active']),
                        () => Navigator.push(context, MaterialPageRoute(builder: (_) => ResourceScreen(config: collectionsSuppliersCfg)))),
                  ]),
                ),
    );
  }
}

/// Customers on the default term, where their terms are written (DefaultTermList on the web): the term is saved in the customer file so it leaves the list and the severity of its invoices is recomputed.
class _DefaultTermSheet extends StatefulWidget {
  final List<Map<String, dynamic>> parties;
  final int days;
  final bool canEdit;
  final VoidCallback onSaved;
  final void Function(Map<String, dynamic>) onOpenInvoices;
  const _DefaultTermSheet({required this.parties, required this.days, required this.canEdit, required this.onSaved, required this.onOpenInvoices});
  @override
  State<_DefaultTermSheet> createState() => _DefaultTermSheetState();
}

class _DefaultTermSheetState extends State<_DefaultTermSheet> {
  String _q = '';
  final Map<String, TextEditingController> _draft = {};
  final Set<String> _done = {};
  String _busy = '';

  String _fold(String s) => s.toLowerCase().replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').replaceAll(RegExp(r'\s+'), ' ').trim();

  @override
  void dispose() { for (final c in _draft.values) { c.dispose(); } super.dispose(); }

  TextEditingController _ctrl(String key) => _draft.putIfAbsent(key, () => TextEditingController());

  Future<void> _save(Map<String, dynamic> p) async {
    final key = '${p['key']}';
    final n = num.tryParse(_ctrl(key).text.trim());
    final messenger = ScaffoldMessenger.of(context);
    if (p['party'] == null || n == null || n <= 0) {
      messenger.showSnackBar(SnackBar(content: Text(tr('اكتب عددَ أيّامٍ أكبر من صفر', 'Enter a number of days above zero')), backgroundColor: T.danger));
      return;
    }
    setState(() => _busy = key);
    try {
      await Api.instance.put('/api/collections-dept/parties/${p['party']}', {'creditDays': n.round()});
      setState(() => _done.add(key));
      messenger.showSnackBar(SnackBar(content: Text(tr('حُفظت مدّةُ «${p['name']}»: ${n.round()} يومًا', 'Saved ${p['name']}: ${n.round()} days')), backgroundColor: T.success));
      widget.onSaved();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('$e'), backgroundColor: T.danger));
    }
    if (mounted) setState(() => _busy = '');
  }

  @override
  Widget build(BuildContext context) {
    final s = _fold(_q);
    final shown = s.isEmpty ? widget.parties : widget.parties.where((p) =>
        _fold('${p['name'] ?? ''}').contains(s) || _fold('${p['code'] ?? ''}').contains(s) || _fold('${p['officer'] ?? ''}').contains(s)).toList();
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.85,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 4), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('عملاء بمدّة افتراضية ${widget.days} يومًا', 'Customers on the default ${widget.days}-day term'),
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            Text(tr('اكتب مدّة سداد كلّ عميل كما اتُّفق معه — تُحفظ في ملفّه وتُعاد خطورةُ فواتيره فورًا',
                'Enter each customer’s agreed term — saved to their file, risk recomputed at once'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            const SizedBox(height: 8),
            SearchField(
              dense: true,
              onChanged: (v) => setState(() => _q = v),
              hint: tr('ابحث بالاسم أو الكود أو المسؤول…', 'Search name, code, officer…'),
            ),
          ])),
          Expanded(child: shown.isEmpty
              ? Center(child: Text(s.isNotEmpty ? tr('لا نتائج مطابقة', 'No matches') : tr('لا عملاء', 'No customers'), style: const TextStyle(color: T.inkFaint)))
              : ListView.builder(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(12, 6, 12, 20),
                  itemCount: shown.length,
                  itemBuilder: (_, i) {
                    final p = shown[i];
                    final key = '${p['key']}';
                    final hasParty = p['party'] != null && '${p['party']}'.isNotEmpty;
                    return Card(
                      margin: const EdgeInsets.only(bottom: 6),
                      child: Padding(padding: const EdgeInsets.all(10), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text('${p['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700))),
                          Text(_m(p['value']), style: const TextStyle(fontWeight: FontWeight.w800)),
                        ]),
                        Text([
                          if ('${p['code'] ?? ''}'.isNotEmpty) '${p['code']}',
                          '${p['officer'] ?? ''}'.isNotEmpty ? '${p['officer']}' : tr('مدير القسم', 'Dept. manager'),
                        ].join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                        Row(children: [
                          TextButton(
                            onPressed: () => widget.onOpenInvoices(p),
                            child: Text([
                              if (_num(p['tax']) > 0) '${p['tax']} ${tr('فاتورة', 'inv')}',
                              if (_num(p['cash']) > 0) '${p['cash']} ${tr('أمر نقل', 'rep')}',
                            ].join(' · '), style: const TextStyle(fontSize: 12)),
                          ),
                          const Spacer(),
                          if (_done.contains(key))
                            Chip2(tr('حُفظت', 'Saved'), T.success, icon: Icons.check)
                          else if (widget.canEdit && hasParty) ...[
                            SizedBox(width: 70, child: TextField(
                              controller: _ctrl(key), keyboardType: TextInputType.number,
                              decoration: InputDecoration(isDense: true, hintText: '${widget.days}'),
                              onSubmitted: (_) => _save(p),
                            )),
                            const SizedBox(width: 6),
                            FilledButton(
                              onPressed: _busy == key ? null : () => _save(p),
                              style: FilledButton.styleFrom(backgroundColor: T.orange, visualDensity: VisualDensity.compact),
                              child: _busy == key ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(tr('حفظ', 'Save')),
                            ),
                          ] else
                            Text(hasParty ? '—' : tr('بلا حسابٍ مربوط', 'no linked account'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                          if (hasParty)
                            IconButton(
                              tooltip: tr('ملفُّ العميل', 'Customer file'),
                              icon: const Icon(Icons.open_in_new, size: 18),
                              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => CollectionsPartyScreen(id: '${p['party']}'))),
                            ),
                        ]),
                      ])),
                    );
                  },
                )),
        ]),
      ),
    );
  }
}
