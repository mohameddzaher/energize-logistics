import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/contact.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'fleet_customer_presence.dart';
import 'ops_common.dart' show opsPickMonth, opsYmd, opsQs;
import '../ui/portal_account_card.dart';
import '../ui/search_field.dart';

/// Customer profile, matching web /system/shipment-orders/customers/[id] and /system/operations/customers/[id] (one screen).
/// Numbers first: trips and amounts, then the routes the customer actually works linked to the agreed price, then the price list, then the latest trips. The gap between the two tables is the value: a route worked without an agreed price is visible at a glance.
class CustomerRegistryProfileScreen extends StatefulWidget {
  final String customerId;
  const CustomerRegistryProfileScreen({super.key, required this.customerId});
  @override
  State<CustomerRegistryProfileScreen> createState() => _CustomerRegistryProfileScreenState();
}

/// Example: "1-5: 2,200 · 6 and above: 2,400"
String _tiersText(dynamic tiers) => List.from(tiers ?? []).map((t) {
      final a = t['minTrucks'], b = t['maxTrucks'];
      final range = b == null ? tr('$a فأكثر', '$a+') : (a == b ? '$a' : '$a–$b');
      return '$range: ${_money(t['price'])}';
    }).join(' · ');

String _money(dynamic v) {
  if (v == null) return '—';
  final n = (v is num) ? v : num.tryParse(v.toString()) ?? 0;
  final s = n.round().abs().toString();
  final b = StringBuffer(n < 0 ? '-' : '');
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write(',');
    b.write(s[i]);
  }
  return b.toString();
}

String _day(dynamic v) {
  final d = v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
  if (d == null) return '—';
  return '${d.day}/${d.month}/${d.year}';
}

String _sourceLabel(String s) {
  switch (s) {
    case 'sheet': return tr('من تقرير الفروع', 'branches report');
    case 'order': return tr('من شحنة أُنشئت', 'created shipment');
    case 'private': return tr('من التشغيل — خاصّ', 'Operations — private');
    case 'platform': return tr('من منصّة التشغيل', 'ops platform');
    case 'manual': return tr('أُدخل يدويًّا', 'entered by hand');
    default: return s;
  }
}

class _CustomerRegistryProfileScreenState extends State<CustomerRegistryProfileScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;
  int _page = 1;
  late final void Function() _onLive;
  // Trip filters, same params as the web: '' | this_month | last_month | month | range, plus search. The server resolves the months on the Riyadh calendar.
  String _mode = '';
  DateTime? _month;
  DateTimeRange? _range;
  String _q = '';
  Timer? _qDebounce;
  // Held here so the typed text survives the list being rebuilt while a page loads.
  final _searchCtl = TextEditingController();
  int _seq = 0;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('shipmentOrders:customers', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('shipmentOrders:customers', _onLive);
    _qDebounce?.cancel();
    _searchCtl.dispose();
    super.dispose();
  }

  /// Price tiers by vehicle count, counterpart of `TierEditor` on the web.
  Future<void> _editTiers(Map<String, dynamic> route) async {
    final rows = List.from(route['tiers'] ?? []).map((t) => [
          TextEditingController(text: '${t['minTrucks'] ?? ''}'),
          TextEditingController(text: t['maxTrucks'] == null ? '' : '${t['maxTrucks']}'),
          TextEditingController(text: '${t['price'] ?? ''}'),
        ]).toList();
    if (rows.isEmpty) rows.add([TextEditingController(text: '1'), TextEditingController(), TextEditingController()]);
    final ok = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => StatefulBuilder(builder: (c, set) {
        Widget f(TextEditingController t, String label) => Expanded(child: Padding(
          padding: const EdgeInsetsDirectional.only(end: 6),
          child: TextField(controller: t, keyboardType: TextInputType.number,
              decoration: InputDecoration(isDense: true, labelText: label, border: const OutlineInputBorder())),
        ));
        return Padding(
          padding: EdgeInsets.fromLTRB(16, 18, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(tr('السعر بعدد السيارات', 'Price by truck count'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 4),
            Text('${route['from'] ?? ''} ← ${route['to'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(tr('السعرُ للسيارة الواحدة، بحسب عدد السيارات التي يطلبها العميل على المسار. اترك «إلى» فارغةً في آخر شريحةٍ لتعني «فما فوق». و«التشغيل — خاصّ» يكتب للأمر نقل أعلى سعرٍ هنا.',
                'Price per truck, by how many trucks the customer orders on the route. Leave “to” empty on the last tier for “and above”. Operations — private applies the highest price.'),
                style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            const SizedBox(height: 12),
            for (var i = 0; i < rows.length; i++) Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(children: [
                f(rows[i][0], tr('من عدد', 'From')), f(rows[i][1], tr('إلى عدد', 'To')), f(rows[i][2], tr('سعر السيارة', 'Per truck')),
                IconButton(icon: const Icon(Icons.close, size: 18, color: T.inkFaint), onPressed: () => set(() => rows.removeAt(i))),
              ]),
            ),
            Align(alignment: AlignmentDirectional.centerStart, child: TextButton.icon(
              icon: const Icon(Icons.add), label: Text(tr('شريحة أخرى', 'Another tier')),
              onPressed: () => set(() {
                final last = rows.isEmpty ? null : int.tryParse(rows.last[1].text);
                rows.add([TextEditingController(text: last == null ? '' : '${last + 1}'), TextEditingController(), TextEditingController()]);
              }),
            )),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: T.navy, padding: const EdgeInsets.symmetric(vertical: 14)),
              onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save')),
            ),
          ])),
        );
      }),
    );
    if (ok != true) return;
    try {
      await Api.instance.put('/api/customer-registry/${widget.customerId}/route-tiers', {
        'fromCity': route['from'], 'toCity': route['to'],
        'tiers': rows.where((r) => r.any((t) => t.text.trim().isNotEmpty)).map((r) => {
              'minTrucks': int.tryParse(r[0].text.trim()), 'maxTrucks': r[1].text.trim().isEmpty ? null : int.tryParse(r[1].text.trim()),
              'price': num.tryParse(r[2].text.trim()),
            }).toList(),
      });
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  List<(String, String)> get _filterParams => [
        if (_mode == 'this_month' || _mode == 'last_month') ('preset', _mode),
        if (_mode == 'month' && _month != null) ('month', opsYmd(_month!).substring(0, 7)),
        if (_mode == 'range' && _range != null) ...[('from', opsYmd(_range!.start)), ('to', opsYmd(_range!.end))],
        if (_q.isNotEmpty) ('q', _q),
      ];

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final qs = opsQs([..._filterParams, ('page', '$_page'), ('limit', '25')]);
      final d = await Api.instance.get('/api/customer-registry/${widget.customerId}?$qs');
      // A slower reply to an older filter must not overwrite the newer one.
      if (!mounted || mine != _seq) return;
      setState(() { _data = Map<String, dynamic>.from(d); _loading = false; _busy = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _busy = false; _error = e.toString(); });
    }
  }

  /// A filter change reloads in place from page 1, without the skeleton, so the filter bar is not rebuilt under the user's finger.
  void _refilter() {
    setState(() { _page = 1; _busy = true; });
    _load();
  }

  Future<void> _pickMode(String m) async {
    if (m == 'month') {
      final now = DateTime.now();
      final picked = await opsPickMonth(context, _month ?? DateTime(now.year, now.month));
      if (picked == null) return;
      _month = picked;
    } else if (m == 'range') {
      final now = DateTime.now();
      final picked = await showDateRangePicker(
          context: context, initialDateRange: _range, firstDate: DateTime(2018), lastDate: DateTime(now.year + 1, 12, 31));
      if (picked == null) return;
      _range = picked;
    }
    _mode = m;
    _refilter();
  }

  String _modeLabel(String m) {
    switch (m) {
      case 'this_month': return tr('هذا الشهر', 'This month');
      case 'last_month': return tr('الشهر الماضي', 'Last month');
      case 'month':
        return _mode == 'month' && _month != null
            ? '${_month!.month.toString().padLeft(2, '0')}/${_month!.year}'
            : tr('شهر محدّد', 'A month');
      case 'range':
        return _mode == 'range' && _range != null
            ? '${_day(_range!.start.toIso8601String())} – ${_day(_range!.end.toIso8601String())}'
            : tr('من — إلى', 'Custom range');
      default: return tr('كلّ المدّة', 'All time');
    }
  }

  Widget _filterBar(Map<String, dynamic>? d) {
    final period = d?['period'] is Map ? Map<String, dynamic>.from(d!['period']) : null;
    return AppCard(
      padding: const EdgeInsets.all(10),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final m in const ['', 'this_month', 'last_month', 'month', 'range'])
            ChoiceChip(
              visualDensity: VisualDensity.compact,
              label: Text(_modeLabel(m), style: const TextStyle(fontSize: 12)),
              selected: _mode == m,
              // Month and range reopen their picker even when already selected, to change the choice.
              onSelected: (_) {
                if (m == 'month' || m == 'range') { _pickMode(m); return; }
                if (_mode == m) return;
                _mode = m;
                _refilter();
              },
            ),
        ]),
        const SizedBox(height: 8),
        SearchField(
          controller: _searchCtl,
          dense: true,
          hint: tr('بحث: رقم، سائق، مركبة، مدينة…', 'Search: number, driver, vehicle, city…'),
          onChanged: (v) {
            _qDebounce?.cancel();
            _qDebounce = Timer(const Duration(milliseconds: 350), () {
              if (!mounted || v.trim() == _q) return;
              _q = v.trim();
              _refilter();
            });
          },
        ),
        if (_busy) const Padding(padding: EdgeInsets.only(top: 6), child: LinearProgressIndicator(minHeight: 2)),
        if (d?['filtered'] == true) ...[
          const SizedBox(height: 6),
          Text(
            '${tr('الأرقام والمسارات والرحلات أدناه بحسب الفلاتر المختارة', 'Figures, routes and trips below follow the chosen filters')}'
            '${period != null ? ' — ${_ymdLabel(period['from'], tr('البداية', 'start'))} ${tr('إلى', 'to')} ${_ymdLabel(period['to'], tr('اليوم', 'today'))}' : ''}',
            style: const TextStyle(fontSize: 11.5, color: T.inkSoft),
          ),
        ],
      ]),
    );
  }

  /// "2026-10-01" as 1/10/2026, read as a calendar day (no zone shift).
  String _ymdLabel(dynamic ymd, String empty) {
    final s = (ymd ?? '').toString();
    final p = s.split('-');
    if (p.length != 3) return empty;
    return '${int.tryParse(p[2]) ?? p[2]}/${int.tryParse(p[1]) ?? p[1]}/${p[0]}';
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final c = d != null ? Map<String, dynamic>.from(d['customer'] ?? {}) : <String, dynamic>{};
    final a = d != null ? Map<String, dynamic>.from(d['analysis'] ?? {}) : <String, dynamic>{};
    final runRoutes = List<Map<String, dynamic>>.from(d?['routes'] ?? []);
    final agreed = List<Map<String, dynamic>>.from(c['routes'] ?? []);
    final sheets = d != null ? Map<String, dynamic>.from(d['sheets'] ?? {}) : <String, dynamic>{};
    final trips = List<Map<String, dynamic>>.from(sheets['rows'] ?? []);
    // Money is hidden from those who cannot see it; the server drops the field, so no empty card is drawn.
    final money = a['purchaseTotal'] != null;

    return AppScaffold(
      title: Text(c['name']?.toString() ?? tr('ملف العميل', 'Customer')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 140), SizedBox(height: 10), Shimmer(height: 200),
            ])
          : _error != null || d == null
              ? ErrorRetry(message: _error ?? '—', onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(14),
                    children: [
                      // Period and search drive the tiles, routes run and trips below (server-side, like the web).
                      _filterBar(d),
                      const SizedBox(height: 10),
                      GridView.count(
                        crossAxisCount: 2,
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        childAspectRatio: 1.7,
                        mainAxisSpacing: 8,
                        crossAxisSpacing: 8,
                        children: [
                          _tile(tr('الرحلات (أوامر نقل)', 'Trips (sheets)'), '${a['sheets'] ?? 0}', T.orange, Icons.route_outlined),
                          if (money) _tile(tr('قيمة الشراء', 'Purchase total'), _money(a['purchaseTotal']), T.violet, Icons.payments_outlined),
                          if (money) _tile(tr('متوسّط الرحلة', 'Avg per trip'), _money(a['avgPerSheet']), T.navy, Icons.trending_up_rounded),
                          _tile(tr('مسارات متّفق عليها', 'Agreed routes'), '${a['routesCount'] ?? 0}', T.info, Icons.alt_route_outlined),
                          _tile(tr('منها مُسعَّرة', 'Priced'), '${a['pricedRoutes'] ?? 0}',
                              (a['pricedRoutes'] ?? 0) < (a['routesCount'] ?? 0) ? T.warn : T.success, Icons.sell_outlined),
                          _tile(tr('أوّل عمل', 'First work'), _day(a['firstAt']), T.inkSoft, Icons.event_outlined),
                          _tile(tr('آخر عمل', 'Last work'), _day(a['lastAt']), T.cyan, Icons.event_available_outlined),
                        ],
                      ),
                      const SizedBox(height: 12),
                      // "Same customer in" block and portal account, like the web customer profile.
                      CustomerPresence(reg: 'shipment', id: widget.customerId, onChanged: _load),
                      const SizedBox(height: 8),
                      PortalAccountCard(source: 'shipment_order_customer', refId: widget.customerId, name: c['name']?.toString()),
                      const SizedBox(height: 12),

                      AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('بيانات العميل', 'Customer details'),
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                          const SizedBox(height: 10),
                          if ((c['phone'] ?? '').toString().isNotEmpty)
                            Row(children: [
                              const Icon(Icons.phone_outlined, size: 15, color: T.inkSoft),
                              const SizedBox(width: 6),
                              Text(c['phone'].toString(), style: const TextStyle(fontSize: 13)),
                              const Spacer(),
                              ContactButtons(phone: c['phone'].toString(), compact: true),
                            ]),
                          if ((c['email'] ?? '').toString().isNotEmpty) ...[
                            const SizedBox(height: 6),
                            Row(children: [
                              const Icon(Icons.mail_outline, size: 15, color: T.inkSoft),
                              const SizedBox(width: 6),
                              Expanded(child: Text(c['email'].toString(), style: const TextStyle(fontSize: 13))),
                            ]),
                          ],
                          if (List.from(a['branches'] ?? []).isNotEmpty) ...[
                            const SizedBox(height: 8),
                            Wrap(spacing: 6, runSpacing: 6, children: List.from(a['branches'] ?? [])
                                .map((b) => Chip2(b.toString(), T.navy)).toList()),
                          ],
                          if ((c['notes'] ?? '').toString().isNotEmpty) ...[
                            const Divider(height: 22),
                            Text(c['notes'].toString(), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                          ],
                        ]),
                      ),
                      const SizedBox(height: 12),

                      // Routes actually worked, from the operations sheets.
                      if (runRoutes.isNotEmpty) ...[
                        AppCard(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${tr('المسارات التي يعمل عليها', 'Routes they run')} (${runRoutes.length})',
                                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                            const SizedBox(height: 8),
                            ...runRoutes.take(25).map((r) => Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 5),
                                  child: Row(children: [
                                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Text('${r['from'] ?? ''} ← ${r['to'] ?? ''}',
                                          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                                      Text(
                                        '${tr('رحلات', 'trips')}: ${r['sheets'] ?? 0}'
                                        '${money && r['purchase'] != null ? ' · ${tr('شراء', 'purchase')}: ${_money(r['purchase'])}' : ''}'
                                        ' · ${_day(r['lastAt'])}',
                                        style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                    ])),
                                    r['price'] == null
                                        ? Chip2(tr('بلا سعر', 'no price'), T.warn)
                                        : Chip2(_money(r['price']), T.success),
                                    // Price tiers are editable only by the operations manager and the system admin.
                                    if (d['canEditTiers'] == true)
                                      IconButton(
                                        visualDensity: VisualDensity.compact,
                                        tooltip: tr('السعر بعدد السيارات', 'Price by truck count'),
                                        icon: const Icon(Icons.edit_outlined, size: 18, color: T.inkSoft),
                                        onPressed: () => _editTiers(r),
                                      ),
                                  ]),
                                )).expand((w) => [w]),
                            // Price by vehicle count, shown under its route.
                            ...runRoutes.take(25).where((r) => List.from(r['tiers'] ?? []).isNotEmpty).map((r) => Padding(
                                  padding: const EdgeInsets.only(top: 4),
                                  child: Text('${r['from'] ?? ''} ← ${r['to'] ?? ''}: ${_tiersText(r['tiers'])}',
                                      style: const TextStyle(fontSize: 11.5, color: T.success, fontWeight: FontWeight.w700)),
                                )),
                            if (runRoutes.length > 25)
                              Padding(
                                padding: const EdgeInsets.only(top: 6),
                                child: Text(tr('و${runRoutes.length - 25} مسارًا آخر — تُقرأ كلُّها على الويب',
                                    '${runRoutes.length - 25} more — see the web page'),
                                    style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                              ),
                          ]),
                        ),
                        const SizedBox(height: 12),
                      ],

                      // Agreed price list.
                      if (agreed.isNotEmpty) ...[
                        AppCard(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${tr('أسعار المسارات المتّفق عليها', 'Agreed prices')} (${agreed.length})',
                                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                            const SizedBox(height: 8),
                            ...agreed.take(30).map((r) => Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 4),
                                  child: Row(children: [
                                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Text('${r['fromCity'] ?? ''} ← ${r['toCity'] ?? ''}',
                                          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                                      Text('${_day(r['at'])}${(r['source'] ?? '').toString().isNotEmpty ? ' · ${_sourceLabel(r['source'].toString())}' : ''}',
                                          style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                    ])),
                                    r['price'] == null
                                        ? Chip2(tr('بلا سعر', 'no price'), T.warn)
                                        : Text(_money(r['price']),
                                            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: T.ink)),
                                  ]),
                                )),
                          ]),
                        ),
                        const SizedBox(height: 12),
                      ],

                      // Trips page by page: a customer can have thousands of sheets.
                      AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${tr('الرحلات', 'Trips')} (${sheets['total'] ?? 0})',
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                          const SizedBox(height: 8),
                          if (trips.isEmpty)
                            Text(tr('لا رحلات.', 'No trips.'), style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
                          ...trips.map((s) => Padding(
                                padding: const EdgeInsets.symmetric(vertical: 5),
                                child: Row(children: [
                                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text('${s['fromLocation'] ?? ''} ← ${s['toLocation'] ?? ''}',
                                        style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                                    Text([
                                      '#${s['reportNumber'] ?? '—'}',
                                      _day(s['reportDate']),
                                      if ((s['branch'] ?? '').toString().isNotEmpty) s['branch'].toString(),
                                      if ((s['driverName'] ?? '').toString().isNotEmpty) s['driverName'].toString(),
                                    ].join(' · '), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                  ])),
                                  if (money && s['purchaseValue'] != null)
                                    Text(_money(s['purchaseValue']),
                                        style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: T.violet)),
                                ]),
                              )),
                          if (((sheets['pages'] ?? 1) as num) > 1) ...[
                            const Divider(height: 20),
                            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                              IconButton(
                                onPressed: _page <= 1 ? null : () { setState(() { _page--; _busy = true; }); _load(); },
                                icon: const Icon(Icons.chevron_right_rounded)),
                              Text('${tr('صفحة', 'Page')} ${sheets['page'] ?? 1} / ${sheets['pages'] ?? 1}',
                                  style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                              IconButton(
                                onPressed: (sheets['page'] ?? 1) >= (sheets['pages'] ?? 1)
                                    ? null
                                    : () { setState(() { _page++; _busy = true; }); _load(); },
                                icon: const Icon(Icons.chevron_left_rounded)),
                            ]),
                          ],
                        ]),
                      ),
                    ],
                  ),
                ),
    );
  }

  Widget _tile(String label, String value, Color color, IconData icon) => AppCard(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, size: 16, color: color),
          ),
          const SizedBox(height: 8),
          Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: color, height: 1)),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(fontSize: 11, color: T.inkSoft, fontWeight: FontWeight.w600)),
        ]),
      );
}
