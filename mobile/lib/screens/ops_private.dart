import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// «التشغيل — خاصّ»: كشوفُ التشغيل نفسُها بسعر بيعنا الحقيقيّ.
///
/// سعرُ البيع في سير عمل التشغيل يأتي من منصّةٍ ليست لنا وهو مساوٍ لسعر
/// الشراء — فريقُهم لا يعرف هامشَنا. فهذه الشاشةُ تقرأ الكشوفَ من موضعها
/// وتملك منها عمودًا واحدًا: سعرَ البيع، محفوظًا عندنا ولا يُرسَل إلى أحد.
/// نفسُ نقطة الويب حرفًا بحرف (/api/operations-private) — فالرقمُ واحد.
class OpsPrivateScreen extends StatefulWidget {
  const OpsPrivateScreen({super.key});
  @override
  State<OpsPrivateScreen> createState() => _OpsPrivateScreenState();
}

String _money(dynamic v) {
  if (v == null) return '—';
  final n = (v is num) ? v : num.tryParse(v.toString()) ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

String _d(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? '—' : '${d.day}/${d.month}/${d.year}';
}

String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// وضعُ الفترة — كالويب: يومٌ بعينه، أو شهرٌ بعينه، أو مدًى من/إلى.
enum _DateMode { day, month, range }

class _OpsPrivateScreenState extends State<OpsPrivateScreen> {
  List<Map<String, dynamic>> _rows = const [];
  Map<String, dynamic> _stats = const {};
  bool _loading = true;
  String? _error;
  String _q = '';
  int _page = 1;
  int _pages = 1;
  int _total = 0;
  // والردُّ القديم لا يكتب فوق الأحدث: كلُّ طلبٍ يُرقَّم ولا يُقبل إلّا آخرُه.
  int _seq = 0;
  // يُفتح على الشهر الجاري — كالويب.
  _DateMode _mode = _DateMode.month;
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);
  DateTime? _day;
  DateTimeRange? _range;
  String _priced = ''; // '' | yes | no
  late final void Function() _onLive;

  static const _events = [
    'workflow:created', 'workflow:updated', 'workflow:deleted',
    'workflow:stageChanged', 'workflow:bulkImported', 'operationsPrivate:updated',
  ];

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    // كلُّ ما يحدث في التشغيل يظهر هنا — نفسُ أحداث تلك الشاشة.
    for (final e in _events) { Live.instance.on(e, _onLive); }
  }

  @override
  void dispose() {
    for (final e in _events) { Live.instance.off(e, _onLive); }
    super.dispose();
  }

  /// المدى الذي يفهمه الخادم (dateFrom/dateTo) — «إلى» تشمل يومَها كلَّه هناك.
  (String?, String?) get _dates {
    switch (_mode) {
      case _DateMode.day:
        return _day == null ? (null, null) : (_ymd(_day!), _ymd(_day!));
      case _DateMode.month:
        final last = DateTime(_month.year, _month.month + 1, 0);
        return (_ymd(_month), _ymd(last));
      case _DateMode.range:
        return _range == null ? (null, null) : (_ymd(_range!.start), _ymd(_range!.end));
    }
  }

  String get _filterQs {
    final (from, to) = _dates;
    return [
      if (_q.trim().isNotEmpty) 'search=${Uri.encodeQueryComponent(_q.trim())}',
      if (from != null) 'dateFrom=$from',
      if (to != null) 'dateTo=$to',
      if (_priced.isNotEmpty) 'priced=$_priced',
    ].join('&');
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final f = _filterQs;
      final results = await Future.wait([
        Api.instance.get('/api/operations-private?page=$_page&limit=40${f.isEmpty ? '' : '&$f'}'),
        Api.instance.get('/api/operations-private/stats${f.isEmpty ? '' : '?$f'}')
            .catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(results[0]['workflows'] ?? const []);
        _pages = ((results[0]['pages'] ?? 1) as num).toInt();
        _total = ((results[0]['total'] ?? 0) as num).toInt();
        _stats = Map<String, dynamic>.from(results[1]);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _reload() { setState(() { _page = 1; _loading = true; }); _load(); }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    switch (_mode) {
      case _DateMode.day:
        final d = await showDatePicker(context: context, initialDate: _day ?? now, firstDate: DateTime(2020), lastDate: DateTime(now.year + 1));
        if (d != null) { _day = d; _reload(); }
      case _DateMode.month:
        final d = await showDatePicker(context: context, initialDate: _month, firstDate: DateTime(2020), lastDate: DateTime(now.year + 1),
            helpText: tr('اختر أيّ يومٍ من الشهر', 'Pick any day of the month'));
        if (d != null) { _month = DateTime(d.year, d.month); _reload(); }
      case _DateMode.range:
        final r = await showDateRangePicker(context: context, initialDateRange: _range, firstDate: DateTime(2020), lastDate: DateTime(now.year + 1));
        if (r != null) { _range = r; _reload(); }
    }
  }

  String get _dateLabel {
    final (from, to) = _dates;
    if (from == null) return tr('اختر…', 'Pick…');
    if (_mode == _DateMode.month) return '${_month.month}/${_month.year}';
    return from == to ? from : '$from → $to';
  }

  /// سعرُ البيع وحدَه يُعدَّل — ويصير آخرَ سعرٍ في ملفّ العميل على هذا المسار.
  Future<void> _editPrice(Map<String, dynamic> w) async {
    final ctrl = TextEditingController(
      text: (w['sellingValue'] ?? 0) == 0 ? '' : '${w['sellingValue']}',
    );
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('سعر البيع الحقيقي', 'Real selling price'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 2),
            Text('${w['reportNumber'] ?? ''} · ${w['username'] ?? ''}\n${w['fromLocation'] ?? ''} ← ${w['toLocation'] ?? ''} · ${tr('شراء', 'purchase')} ${_money(w['purchaseValue'])}',
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            const SizedBox(height: 12),
            TextField(controller: ctrl, keyboardType: TextInputType.number, autofocus: true,
                decoration: InputDecoration(labelText: tr('سعر البيع', 'Selling price'))),
            const SizedBox(height: 6),
            Text(tr('يُحفَظ عندنا فقط — لا يصل منصّة التشغيل. ويصير آخرَ سعرٍ لهذا المسار في ملفّ العميل.',
                    'Kept here only — never sent to the platform. Becomes the latest price for this route on the customer profile.'),
                style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            const SizedBox(height: 12),
            SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save')))),
          ]),
        ),
      ),
    );
    if (ok != true) return;
    final v = num.tryParse(ctrl.text.trim());
    if (v == null || v < 0) return;
    try {
      await Api.instance.put('/api/operations-private/${w['_id']}', {'sellingValue': v});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Widget _kpi(String label, String value, String sub, Color tone, IconData icon, {VoidCallback? onTap, bool active = false}) => Expanded(
        child: Pressable(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(11),
            decoration: BoxDecoration(
              color: active ? T.warn.withValues(alpha: 0.08) : T.card,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: active ? T.warn : T.line),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w700))),
                Icon(icon, size: 15, color: tone),
              ]),
              const SizedBox(height: 5),
              FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
                  child: Text(value, style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: tone))),
              const SizedBox(height: 2),
              Text(sub, maxLines: 2, style: const TextStyle(fontSize: 10, color: T.inkFaint)),
            ]),
          ),
        ),
      );

  Widget _header() {
    final s = _stats;
    final has = s.isNotEmpty;
    final priced = (s['priced'] ?? 0) as num;
    final unpriced = (s['unpriced'] ?? 0) as num;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      // ── البطاقاتُ على الفلتر كلِّه لا على الصفحة ──────────────────────────
      Row(children: [
        _kpi(tr('إجمالي البيع', 'Selling total'), has ? _money(s['sumSelling']) : '…',
            tr('على $priced مسعَّرًا', 'over $priced priced'), T.success, Icons.payments_outlined),
        const SizedBox(width: 8),
        _kpi(tr('إجمالي الشراء', 'Purchase total'), has ? _money(s['sumPurchaseAll']) : '…',
            tr('غير المسعَّر ${_money(s['sumPurchaseUnpriced'])}', 'unpriced ${_money(s['sumPurchaseUnpriced'])}'), T.inkSoft, Icons.shopping_cart_outlined),
      ]),
      const SizedBox(height: 8),
      Row(children: [
        _kpi(tr('الربح', 'Profit'), has ? _money(s['profit']) : '…',
            tr('هامش ${s['margin'] ?? 0}% · على المسعَّر', 'margin ${s['margin'] ?? 0}% · priced only'),
            ((s['profit'] ?? 0) as num) < 0 ? T.danger : T.orange, Icons.trending_up),
        const SizedBox(width: 8),
        _kpi(tr('مسعَّر / بلا سعر', 'Priced / unpriced'), has ? '$priced / $unpriced' : '…',
            _priced == 'no' ? tr('تعرض بلا سعر — اضغط للإلغاء', 'showing unpriced — tap to clear') : tr('اضغط لعرض ما بلا سعر', 'tap to show unpriced'),
            T.warn, Icons.sell_outlined, active: _priced == 'no',
            onTap: () { _priced = _priced == 'no' ? '' : 'no'; _reload(); }),
      ]),
      const SizedBox(height: 10),
      // ── الفترة: يوم / شهر / مدى ──────────────────────────────────────────
      Row(children: [
        for (final m in _DateMode.values) ...[
          ChoiceChip(
            label: Text(switch (m) { _DateMode.day => tr('يوم', 'Day'), _DateMode.month => tr('شهر', 'Month'), _DateMode.range => tr('مدى', 'Range') }),
            selected: _mode == m,
            onSelected: (_) { if (_mode == m) return; setState(() => _mode = m); if (m == _DateMode.month) { _reload(); } else { _pickDate().whenComplete(() { if (mounted && _dates.$1 == null) _reload(); }); } },
          ),
          const SizedBox(width: 6),
        ],
        Expanded(
          child: OutlinedButton.icon(
            onPressed: _pickDate,
            icon: const Icon(Icons.calendar_month_outlined, size: 16),
            label: Text(_dateLabel, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12)),
          ),
        ),
      ]),
      const SizedBox(height: 6),
      Row(children: [
        for (final p in const [('', 'الكل', 'All'), ('yes', 'مسعَّر', 'Priced'), ('no', 'بلا سعر', 'Unpriced')]) ...[
          ChoiceChip(
            label: Text(tr(p.$2, p.$3)),
            selected: _priced == p.$1,
            onSelected: (_) { _priced = p.$1; _reload(); },
          ),
          const SizedBox(width: 6),
        ],
        const Spacer(),
        Text(tr('$_total كشفًا', '$_total sheets'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft, fontWeight: FontWeight.w700)),
      ]),
      const SizedBox(height: 8),
      TextField(
        onSubmitted: (v) { _q = v; _reload(); },
        onChanged: (v) => _q = v,
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(hintText: tr('كشف أو عميل أو مدينة…', 'Sheet, customer or city…'), prefixIcon: const Icon(Icons.search)),
      ),
    ]);
  }

  Widget _rowCard(Map<String, dynamic> w) {
    final priced = ((w['sellingValue'] ?? 0) as num) > 0;
    final profit = w['profit'];
    final margin = w['margin'];
    return AppCard(
      topAccent: priced ? T.success : T.warn,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text('${w['username'] ?? '—'}', maxLines: 1, overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13))),
          Text('${w['reportNumber'] ?? ''}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        ]),
        const SizedBox(height: 3),
        Text('${w['fromLocation'] ?? '—'} ← ${w['toLocation'] ?? '—'} · ${_d(w['reportDate'])}',
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
        if ((w['branch'] ?? '').toString().isNotEmpty || (w['driverName'] ?? '').toString().isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text([w['branch'], w['driverName'], w['carNumber']].where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
                maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: T.inkSoft)),
          ),
        const SizedBox(height: 8),
        Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Chip2('${tr('شراء', 'buy')} ${_money(w['purchaseValue'])}', T.inkSoft),
          Chip2('${tr('المنصّة', 'platform')} ${_money(w['platformSellingValue'])}', T.inkFaint),
          Pressable(
            onTap: () => _editPrice(w),
            child: Chip2(
              priced ? '${tr('بيع', 'sell')} ${_money(w['sellingValue'])}' : tr('بلا سعر', 'not priced'),
              priced ? T.success : T.warn,
              icon: Icons.edit_outlined,
            ),
          ),
          if (profit != null)
            Text('${_money(profit)}${margin != null ? '  ($margin%)' : ''}',
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13,
                    color: (profit as num) >= 0 ? T.success : T.danger)),
        ]),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('التشغيل — خاصّ', 'Operations — private')),
      body: _loading && _rows.isEmpty && _stats.isEmpty
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(height: 180)])
          : _error != null && _rows.isEmpty
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(14),
                    children: [
                      _header(),
                      const SizedBox(height: 10),
                      if (_loading) const LinearProgressIndicator(minHeight: 2),
                      if (_rows.isEmpty)
                        EmptyState(icon: Icons.lock_outline, title: tr('لا كشوف', 'No sheets'))
                      else
                        for (final w in _rows) ...[_rowCard(w), const SizedBox(height: 8)],
                      if (_pages > 1)
                        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                          IconButton(onPressed: _page > 1 ? () { setState(() { _page--; _loading = true; }); _load(); } : null, icon: const Icon(Icons.chevron_right)),
                          Text('$_page / $_pages', style: const TextStyle(fontWeight: FontWeight.w800)),
                          IconButton(onPressed: _page < _pages ? () { setState(() { _page++; _loading = true; }); _load(); } : null, icon: const Icon(Icons.chevron_left)),
                        ]),
                    ],
                  ),
                ),
    );
  }
}
