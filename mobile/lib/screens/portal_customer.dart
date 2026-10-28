import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Customer side of the portal: overview, one shipment list (no statuses or
/// operations fields, From and To apart) and invoices. Mirrors the web portal.

String _dmy(dynamic v) {
  final s = '${v ?? ''}';
  return s.length >= 10 ? '${s.substring(8, 10)}/${s.substring(5, 7)}/${s.substring(0, 4)}' : '—';
}

String _n0(dynamic v) {
  final n = (v is num) ? v : num.tryParse('${v ?? ''}') ?? 0;
  final s = n.round().toString();
  final b = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0 && s[i - 1] != '-') b.write(',');
    b.write(s[i]);
  }
  return b.toString();
}

const _months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const _monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

class CustomerOverviewTab extends StatelessWidget {
  final Map<String, dynamic> overview;
  final Future<void> Function() onRefresh;
  final void Function(int tab)? goTo;
  const CustomerOverviewTab({super.key, required this.overview, required this.onRefresh, this.goTo});

  @override
  Widget build(BuildContext context) {
    final t = Map<String, dynamic>.from(overview['totals'] ?? {});
    final monthly = List<Map<String, dynamic>>.from(overview['monthly'] ?? []);
    final routes = List<Map<String, dynamic>>.from(overview['topRoutes'] ?? []);
    final recent = Map<String, dynamic>.from(overview['recent'] ?? {});
    final ships = List<Map<String, dynamic>>.from(recent['shipments'] ?? []);
    final invs = List<Map<String, dynamic>>.from(recent['invoices'] ?? []);
    final maxM = monthly.fold<num>(1, (a, m) => (m['count'] as num? ?? 0) > a ? (m['count'] as num) : a);
    final maxR = routes.fold<num>(1, (a, r) => (r['count'] as num? ?? 0) > a ? (r['count'] as num) : a);
    final thisM = (t['thisMonth'] as num?) ?? 0;
    final lastM = (t['lastMonth'] as num?) ?? 0;
    final delta = lastM > 0 ? ((thisM - lastM) / lastM * 100).round() : null;

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(gradient: T.navyGradient, borderRadius: BorderRadius.circular(18)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('بوابة العملاء · تنشيط للخدمات اللوجستية', 'Customer portal · Energize Logistics'), style: const TextStyle(color: Colors.white60, fontSize: 11.5)),
            const SizedBox(height: 4),
            Text('${overview['name'] ?? ''}', style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w900)),
            const SizedBox(height: 14),
            GridView.count(
              crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 8, crossAxisSpacing: 8, childAspectRatio: 1.9,
              children: [
                _hero(tr('إجمالي الشحنات', 'Total shipments'), _n0(t['shipments'])),
                _hero(tr('هذا الشهر', 'This month'), _n0(thisM),
                    sub: delta == null ? '${tr('الشهر الماضي', 'Last month')} ${_n0(lastM)}' : '${delta >= 0 ? '+' : ''}$delta% ${tr('عن الشهر الماضي', 'vs last month')}'),
                _hero(tr('الوجهات', 'Destinations'), _n0(t['destinations']), sub: '${_n0(t['routes'])} ${tr('مسارًا', 'routes')}'),
                _hero(tr('الفواتير', 'Invoices'), _n0(t['invoices']),
                    sub: (t['outstandingCount'] ?? 0) == 0 ? tr('كلها مسدّدة', 'All settled') : '${_n0(t['outstandingCount'])} ${tr('غير مسدّدة', 'unpaid')}'),
              ],
            ),
          ]),
        ),
        const SizedBox(height: 12),
        AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(tr('الشحنات شهريًا', 'Shipments per month'), style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          SizedBox(
            height: 130,
            child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              for (final m in monthly)
                Expanded(child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                  Text('${m['count'] ?? 0}', style: const TextStyle(fontSize: 8.5, color: T.inkFaint)),
                  const SizedBox(height: 2),
                  Container(
                    height: 90 * ((m['count'] as num? ?? 0) / maxM).toDouble() + 2,
                    margin: const EdgeInsets.symmetric(horizontal: 2),
                    decoration: BoxDecoration(color: T.navy.withValues(alpha: 0.85), borderRadius: const BorderRadius.vertical(top: Radius.circular(4))),
                  ),
                  const SizedBox(height: 3),
                  Text(((Lang.instance.ar ? _months : _monthsEn)[(int.tryParse('${m['month']}'.substring(5, 7)) ?? 1) - 1]).substring(0, 3),
                      style: const TextStyle(fontSize: 8.5, color: T.inkFaint)),
                ])),
            ]),
          ),
        ])),
        if (routes.isNotEmpty) ...[
          const SizedBox(height: 12),
          AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('أكثر المسارات', 'Top routes'), style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            for (final r in routes) ...[
              Row(children: [
                Expanded(child: Text('${r['label']}', style: const TextStyle(fontSize: 12.5), overflow: TextOverflow.ellipsis)),
                Text(_n0(r['count']), style: const TextStyle(fontWeight: FontWeight.w800)),
              ]),
              const SizedBox(height: 4),
              ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(value: ((r['count'] as num? ?? 0) / maxR).toDouble(), minHeight: 5, color: T.orange, backgroundColor: T.canvas)),
              const SizedBox(height: 10),
            ],
          ])),
        ],
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: Text(tr('أحدث الشحنات', 'Latest shipments'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
          if (goTo != null) TextButton(onPressed: () => goTo!(1), child: Text(tr('كل الشحنات', 'All shipments'))),
        ]),
        for (final s in ships) Padding(padding: const EdgeInsets.only(bottom: 8), child: ShipmentCard(s)),
        if (invs.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(tr('أحدث الفواتير', 'Latest invoices'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 8),
          for (final i in invs) Padding(padding: const EdgeInsets.only(bottom: 8), child: _InvoiceCard(i)),
        ],
      ]),
    );
  }

  Widget _hero(String label, String value, {String? sub}) => Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12), border: Border.all(color: Colors.white24)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(label, style: const TextStyle(color: Colors.white70, fontSize: 11)),
          Text(value, style: const TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w900)),
          if (sub != null) Text(sub, style: const TextStyle(color: Colors.white60, fontSize: 10), maxLines: 1, overflow: TextOverflow.ellipsis),
        ]),
      );
}

/// One shipment: number, date, From and To apart, truck, plate, driver.
class ShipmentCard extends StatelessWidget {
  final Map<String, dynamic> s;
  const ShipmentCard(this.s, {super.key});
  @override
  Widget build(BuildContext context) {
    Widget kv(String k, String v) => Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(k, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
          Text(v.isEmpty ? '—' : v, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
        ]));
    return AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Text('#${s['number'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w900, color: T.navy, fontSize: 14)),
        const Spacer(),
        Text(_dmy(s['date']), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
      ]),
      const SizedBox(height: 8),
      Row(children: [kv(tr('من', 'From'), '${s['from'] ?? ''}'), kv(tr('إلى', 'To'), '${s['to'] ?? ''}')]),
      const SizedBox(height: 6),
      Row(children: [kv(tr('الشاحنة', 'Truck'), '${s['truck'] ?? ''}'), kv(tr('اللوحة', 'Plate'), '${s['plate'] ?? ''}')]),
      const SizedBox(height: 6),
      Row(children: [kv(tr('السائق', 'Driver'), '${s['driver'] ?? ''}')]),
    ]));
  }
}

class CustomerShipmentsTab extends StatefulWidget {
  const CustomerShipmentsTab({super.key});
  @override
  State<CustomerShipmentsTab> createState() => _CustomerShipmentsTabState();
}

class _CustomerShipmentsTabState extends State<CustomerShipmentsTab> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  String _dest = '';
  int _shown = 60;
  final _searchCtl = TextEditingController();
  late final void Function() _onLive = _load;

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('fleet:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('fleet:updated', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/portal/shipments?type=all');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(((d as Map)['items'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _q.trim().toLowerCase();
    final dests = {for (final r in _rows) '${r['to'] ?? ''}'}..remove('');
    final list = _rows.where((r) => (_dest.isEmpty || r['to'] == _dest)
        && (q.isEmpty || '${r['number']} ${r['from']} ${r['to']} ${r['driver']} ${r['plate']}'.toLowerCase().contains(q))).toList();
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
        child: SearchField(controller: _searchCtl, dense: true, onChanged: (v) => setState(() { _q = v; _shown = 60; }),
            hint: tr('ابحث برقم الشحنة أو المدينة أو السائق', 'Number, city, driver, plate')),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(14, 4, 14, 4),
        child: DropdownButtonFormField<String>(
          initialValue: _dest, isExpanded: true,
          decoration: InputDecoration(labelText: tr('الوجهة', 'Destination'), isDense: true),
          items: [DropdownMenuItem(value: '', child: Text(tr('كل الوجهات', 'All destinations'))), ...(dests.toList()..sort()).map((d) => DropdownMenuItem(value: d, child: Text(d, overflow: TextOverflow.ellipsis)))],
          onChanged: (v) => setState(() { _dest = v ?? ''; _shown = 60; }),
        ),
      ),
      Expanded(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? ErrorRetry(message: _error!, onRetry: _load)
                : RefreshIndicator(
                    onRefresh: _load,
                    child: list.isEmpty
                        ? ListView(children: [EmptyState(icon: Icons.local_shipping_outlined, title: tr('لا توجد شحنات', 'No shipments'))])
                        : ListView.builder(
                            padding: const EdgeInsets.all(14),
                            itemCount: (list.length > _shown ? _shown : list.length) + (list.length > _shown ? 1 : 0),
                            itemBuilder: (c, i) {
                              if (i >= _shown) {
                                return TextButton(onPressed: () => setState(() => _shown += 60), child: Text('${tr('عرض المزيد', 'Show more')} (${list.length - _shown})'));
                              }
                              return Padding(padding: const EdgeInsets.only(bottom: 8), child: ShipmentCard(list[i]));
                            },
                          ),
                  ),
      ),
    ]);
  }
}

class _InvoiceCard extends StatelessWidget {
  final Map<String, dynamic> i;
  const _InvoiceCard(this.i);
  @override
  Widget build(BuildContext context) {
    final paid = i['paid'] == true;
    return AppCard(child: Row(children: [
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${i['number']}', style: const TextStyle(fontWeight: FontWeight.w900, color: T.navy)),
        Text('${_dmy(i['date'])} · ${i['shipments'] ?? 0} ${tr('شحنة', 'shipments')}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
      ])),
      Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
        Text('${_n0(i['total'])} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontWeight: FontWeight.w900)),
        const SizedBox(height: 4),
        Chip2(paid ? tr('مسدّدة', 'Paid') : tr('غير مسدّدة', 'Unpaid'), paid ? T.success : T.warn),
      ]),
    ]));
  }
}

class CustomerInvoicesTab extends StatefulWidget {
  const CustomerInvoicesTab({super.key});
  @override
  State<CustomerInvoicesTab> createState() => _CustomerInvoicesTabState();
}

class _CustomerInvoicesTabState extends State<CustomerInvoicesTab> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _totals = {};
  bool _loading = true;
  String? _error;
  String _state = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/portal/invoices');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(((d as Map)['items'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
        _totals = Map<String, dynamic>.from(d['totals'] as Map? ?? const {});
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return ErrorRetry(message: _error!, onRetry: _load);
    final list = _rows.where((r) => _state.isEmpty || (_state == 'paid' ? r['paid'] == true : r['paid'] != true)).toList();
    Widget stat(String k, String label, String value, String sub, Color c) => Expanded(child: Pressable(
          onTap: () => setState(() => _state = _state == k ? '' : k),
          child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
            Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: c)),
            Text(sub, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
          ])),
        ));
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        Row(children: [
          stat('', tr('الكل', 'All'), _n0(_totals['total']), '${_totals['count'] ?? 0} ${tr('فاتورة', 'inv.')}', T.ink),
          const SizedBox(width: 8),
          stat('paid', tr('مسدّدة', 'Paid'), _n0(_totals['paid']), '${_totals['paidCount'] ?? 0} ${tr('فاتورة', 'inv.')}', T.success),
          const SizedBox(width: 8),
          stat('open', tr('غير مسدّدة', 'Unpaid'), _n0(_totals['open']), '${_totals['openCount'] ?? 0} ${tr('فاتورة', 'inv.')}', T.warn),
        ]),
        const SizedBox(height: 12),
        if (list.isEmpty) EmptyState(icon: Icons.receipt_long_outlined, title: tr('لا توجد فواتير', 'No invoices')),
        for (final i in list) Padding(padding: const EdgeInsets.only(bottom: 8), child: _InvoiceCard(i)),
      ]),
    );
  }
}
