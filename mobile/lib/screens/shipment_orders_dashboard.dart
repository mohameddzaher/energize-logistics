import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../resource/configs.dart' show customersRegisterCfg, customerEditRoles, customerRemoveRoles;
import '../resource/resource.dart';
import '../services/api.dart';
import 'dart:async';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/stat_grid.dart';
import 'ops_analytics_panel.dart';
import 'shipment_order_create.dart';
import 'shipment_order_detail.dart';
import 'shipment_orders.dart';
import 'shipment_orders_analytics.dart';
import 'shipment_orders_common.dart';
import 'shipment_orders_fleet.dart';

/// لوحةُ طلبات الشحنات — نظيرُ /system/shipment-orders/dashboard في الويب.
///
/// أُعيد بناؤها (٢٠٢٦/١٠/٢٧) كالويب: فترةٌ تُختار (اليوم، ٧ أيّام، الشهر، ٣٠ يومًا،
/// السنة)، وكلُّ رقمٍ بسهمه عن الفترة السابقة، والشحناتُ يومًا بيوم، وأين تقف،
/// وأداءُ مناديب التشغيل من «السيلز التشغيلي» المختار عند إنشاء الشحنة، والعملاءُ
/// والموردون والمسارات، وما يربطها ببقيّة الشركة (التخليص، المتابعة، السوّاق).
/// تتحدّث وحدَها مع كلّ تغيير وكلَّ دقيقة، وكلُّ رقمٍ يُفتَح على صفوفه.
class ShipmentOrdersDashboardScreen extends StatefulWidget {
  const ShipmentOrdersDashboardScreen({super.key});
  @override
  State<ShipmentOrdersDashboardScreen> createState() => _ShipmentOrdersDashboardScreenState();
}

const _periods = [('today', 'اليوم', 'Today'), ('7d', '٧ أيام', '7 days'), ('month', 'الشهر', 'Month'), ('30d', '٣٠ يومًا', '30 days'), ('year', 'السنة', 'Year')];
const _prefKey = 'shipmentOrders.dashPeriod';
const _navy = Color(0xFF12325C);

class _ShipmentOrdersDashboardScreenState extends State<ShipmentOrdersDashboardScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  int _seq = 0;
  List<SoStatus> _vocab = soBaseStatuses;
  late final void Function() _onLive = _load;
  late String _period = (() {
    final v = context.read<AuthProvider>().pref(_prefKey);
    return _periods.any((p) => p.$1 == v) ? v : 'month';
  })();
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _load();
    loadSoStatuses().then((v) { if (mounted) setState(() => _vocab = v); });
    for (final e in ['shipmentOrders:updated', 'shipmentOrders:fleet', 'customs:opsLinks']) { Live.instance.on(e, _onLive); }
    _tick = Timer.periodic(const Duration(minutes: 1), (_) => _load());
  }

  @override
  void dispose() {
    for (final e in ['shipmentOrders:updated', 'shipmentOrders:fleet', 'customs:opsLinks']) { Live.instance.off(e, _onLive); }
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/shipment-orders/dashboard?period=$_period');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _pick(String k) {
    setState(() => _period = k);
    context.read<AuthProvider>().setPref(_prefKey, k);
    _load();
  }

  Map<String, dynamic> get _p => Map<String, dynamic>.from(_d?['period'] ?? {});

  void _openList({List<String> statuses = const [], Map<String, Set<String>> cols = const {}, bool all = false}) {
    final p = _p;
    Navigator.push(context, MaterialPageRoute(builder: (_) => ShipmentOrdersScreen(
      initialStatuses: statuses,
      initialFrom: all ? '' : '${p['from'] ?? ''}', initialTo: all ? '' : '${p['to'] ?? ''}',
      byPickup: !all, initialCols: cols,
    )));
  }

  void _openFleet() => Navigator.push(context, MaterialPageRoute(builder: (_) => const ShipmentOrdersFleetScreen()));
  void _openAnalytics() => Navigator.push(context, MaterialPageRoute(builder: (_) => const ShipmentOrdersAnalyticsScreen()));
  // سجلُّ العملاء بقاعدة الويب نفسِها (canEditCustomers / canRemoveCustomers).
  void _openCustomers() {
    final a = context.read<AuthProvider>();
    Navigator.push(context, MaterialPageRoute(builder: (_) => ResourceScreen(config: customersRegisterCfg(
      canEdit: customerEditRoles.contains(a.role) || a.canEditSection('Shipment Orders'),
      canDelete: customerRemoveRoles.contains(a.role) || a.canEditSection('Shipment Orders'),
    ))));
  }


  static num _n(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;
  String _short(num v) {
    final a = v.abs();
    if (a >= 1e6) return '${(v / 1e6).toStringAsFixed(1)}${tr(' م', 'M')}';
    if (a >= 1e3) return '${(v / 1e3).toStringAsFixed(0)}${tr(' ألف', 'k')}';
    return soMoney(v.round());
  }

  /// سهمُ التغيّر عن الفترة السابقة.
  Widget _delta(num cur, num prev, {bool goodWhenUp = true}) {
    if (cur == 0 && prev == 0) return const SizedBox.shrink();
    final String label;
    bool? up;
    if (prev == 0) { label = tr('جديد', 'new'); up = true; } else {
      final pct = ((cur - prev) / prev.abs()) * 100;
      label = '${pct.abs().toStringAsFixed(pct.abs() < 10 ? 1 : 0)}%';
      up = pct > 0.05 ? true : pct < -0.05 ? false : null;
    }
    final good = up == null ? null : up == goodWhenUp;
    final c = good == null ? T.inkFaint : good ? T.success : T.danger;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(up == null ? Icons.remove : up ? Icons.north_east : Icons.south_east, size: 12, color: c),
        Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: c)),
      ]),
    );
  }

  Widget _kpi(IconData icon, String label, String value, {String? sub, Color tone = _navy, Widget? delta, VoidCallback? onTap}) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Container(width: 32, height: 32, decoration: BoxDecoration(color: tone.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
                child: Icon(icon, size: 17, color: tone)),
            const SizedBox(width: 8),
            Expanded(child: Text(label, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.inkSoft), maxLines: 2)),
          ]),
          const SizedBox(height: 10),
          Row(children: [
            Flexible(child: FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
                child: Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: tone)))),
            if (delta != null) ...[const SizedBox(width: 6), delta],
          ]),
          if (sub != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(sub, style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
        ])),
      );

  Widget _section(String title, IconData icon, List<Widget> children, {Widget? action}) => Padding(
        padding: const EdgeInsets.only(top: 12),
        child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Icon(icon, size: 17, color: T.orange),
            const SizedBox(width: 6),
            Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
            if (action != null) action,
          ]),
          const SizedBox(height: 10),
          ...children,
        ])),
      );

  @override
  Widget build(BuildContext context) {
    final auth = context.read<AuthProvider>();
    final editor = canEditOrders(context);
    if (!editor && !auth.canAccessSection('Shipment Orders')) {
      return AppScaffold(title: Text(tr('لوحة طلبات الشحنات', 'Shipment Orders Dashboard')),
          body: EmptyState(icon: Icons.lock_outline, title: tr('لا تملك صلاحية.', 'Not authorized.')));
    }
    final p = _p;
    final cur = Map<String, dynamic>.from(p['cur'] ?? {});
    final t = Map<String, dynamic>.from(cur['totals'] ?? {});
    final prev = Map<String, dynamic>.from(p['prev'] ?? {});
    final fleet = Map<String, dynamic>.from(_d?['fleet'] ?? {});
    final recent = List<Map<String, dynamic>>.from(_d?['recent'] ?? const []);
    final byDay = List<Map<String, dynamic>>.from(p['byDay'] ?? const []);
    final reps = List<Map<String, dynamic>>.from(cur['salesRanking'] ?? const []);
    final byStatus = Map<String, dynamic>.from(cur['byStatus'] ?? {});
    final statuses = byStatus.entries.where((e) => _n(e.value) > 0).toList()..sort((a, b) => _n(b.value).compareTo(_n(a.value)));
    final statusTotal = statuses.fold<num>(0, (a, e) => a + _n(e.value));
    final cancelReasons = List<Map<String, dynamic>>.from(cur['cancelReasons'] ?? const []);
    final margin = _n(t['margin']);

    return AppScaffold(
      title: Text(tr('لوحة طلبات الشحنات', 'Shipment Orders Dashboard')),
      actions: [
        IconButton(tooltip: tr('كل الشحنات', 'All shipments'), icon: const Icon(Icons.manage_search), onPressed: () => _openList(all: true)),
      ],
      floatingActionButton: editor
          ? FloatingActionButton.extended(
              onPressed: () async {
                final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const ShipmentOrderCreateScreen()));
                if (ok == true) _load();
              },
              icon: const Icon(Icons.add),
              label: Text(tr('شحنة جديدة', 'New shipment')),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 90), children: [
          // ── الفترة ──
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              for (final pr in _periods)
                Padding(padding: const EdgeInsetsDirectional.only(end: 6), child: ChoiceChip(
                  label: Text(tr(pr.$2, pr.$3), style: TextStyle(fontWeight: FontWeight.w700, color: _period == pr.$1 ? Colors.white : T.ink)),
                  selected: _period == pr.$1, selectedColor: _navy, showCheckmark: false,
                  onSelected: (_) => _pick(pr.$1),
                )),
            ]),
          ),
          if (p['from'] != null)
            Padding(padding: const EdgeInsets.only(top: 6), child: Row(children: [
              Container(width: 8, height: 8, decoration: const BoxDecoration(color: T.success, shape: BoxShape.circle)),
              const SizedBox(width: 6),
              Expanded(child: Text(tr('مباشر · ${p['from']} — ${p['to']} · مقارنةً بـ ${p['prevFrom']} — ${p['prevTo']}',
                  'Live · ${p['from']} — ${p['to']} · vs ${p['prevFrom']} — ${p['prevTo']}'),
                  style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
            ])),
          const SizedBox(height: 10),
          if (_loading && _d == null)
            const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator()))
          else if (_error != null && _d == null)
            ErrorRetry(message: _error!, onRetry: _load)
          else if (t.isNotEmpty) ...[
            StatGrid(spacing: 8, minColumns: 2, maxColumns: 3, children: [
              _kpi(Icons.inventory_2_outlined, tr('الشحنات', 'Shipments'), soMoney(_n(t['orders'])), tone: _navy,
                  delta: _delta(_n(t['orders']), _n(prev['orders'])), onTap: () => _openList(),
                  sub: tr('${t['live']} منفَّذة · ${t['cancelled']} ملغاة', '${t['live']} live · ${t['cancelled']} cancelled')),
              _kpi(Icons.receipt_long_outlined, tr('الإيرادات', 'Revenue'), _short(_n(t['sell'])), tone: T.orange,
                  delta: _delta(_n(t['sell']), _n(prev['sell'])), sub: tr('متوسط ${soMoney(_n(t['avgSell']).round())}', 'avg ${soMoney(_n(t['avgSell']).round())}')),
              _kpi(Icons.account_balance_wallet_outlined, tr('التكلفة', 'Cost'), _short(_n(t['buy'])), tone: T.inkSoft,
                  delta: _delta(_n(t['buy']), _n(prev['buy']), goodWhenUp: false)),
              _kpi(Icons.savings_outlined, tr('الربح', 'Margin'), _short(margin), tone: margin >= 0 ? T.success : T.danger,
                  delta: _delta(margin, _n(prev['margin'])), sub: tr('هامش ${t['marginPct']}%', '${t['marginPct']}%')),
              _kpi(Icons.block, tr('نسبة الإلغاء', 'Cancel rate'), '${t['cancelRate']}%', tone: _n(t['cancelRate']) > 15 ? T.danger : T.inkSoft,
                  delta: _delta(_n(t['cancelled']), _n(prev['cancelled']), goodWhenUp: false), onTap: () => _openList(statuses: ['cancelled']),
                  sub: cancelReasons.isNotEmpty ? '${cancelReasons.first['reason']}' : null),
              _kpi(Icons.payments_outlined, tr('السلف للسائقين', 'Driver advances'), _short(_n(p['advances'])), tone: const Color(0xFF7C3AED),
                  sub: tr('على ${p['withAdvance'] ?? 0} شحنة', 'on ${p['withAdvance'] ?? 0} loads')),
            ]),
            // ── يومًا بيوم ──
            _section(tr('الشحنات يومًا بيوم', 'Shipments by day'), Icons.insights, [
              if (byDay.isEmpty)
                Padding(padding: const EdgeInsets.all(16), child: Text(tr('لا شحنات في هذه الفترة', 'No shipments in this period'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint)))
              else
                SizedBox(height: 120, child: Builder(builder: (_) {
                  final shown = byDay.length > 31 ? byDay.sublist(byDay.length - 31) : byDay;
                  final max = shown.fold<num>(1, (a, d) => _n(d['orders']) > a ? _n(d['orders']) : a);
                  return Directionality(textDirection: TextDirection.ltr, child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    for (final d in shown)
                      Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 1), child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                        Container(height: 2 + 70 * (_n(d['cancelled']) / max), color: const Color(0xFFCBD5E1)),
                        Container(height: 2 + 70 * (_n(d['live']) / max), decoration: const BoxDecoration(color: _navy, borderRadius: BorderRadius.vertical(top: Radius.circular(2)))),
                        const SizedBox(height: 3),
                        Text('${d['day']}'.length >= 10 ? '${d['day']}'.substring(8) : '', style: const TextStyle(fontSize: 8, color: T.inkFaint)),
                      ]))),
                  ]));
                })),
            ]),
            // ── أين تقف ──
            _section(tr('أين تقف الشحنات', 'Where shipments stand'), Icons.local_shipping_outlined, [
              if (statuses.isNotEmpty)
                ClipRRect(borderRadius: BorderRadius.circular(8), child: SizedBox(height: 10, child: Row(children: [
                  for (final e in statuses) Expanded(flex: (_n(e.value) * 1000 ~/ (statusTotal == 0 ? 1 : statusTotal)).clamp(1, 1000).toInt(), child: Container(color: soStatusOf(_vocab, e.key).$4)),
                ]))),
              const SizedBox(height: 6),
              for (final e in statuses)
                InkWell(
                  onTap: () => _openList(statuses: [e.key]),
                  child: Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Row(children: [
                    Container(width: 10, height: 10, decoration: BoxDecoration(color: soStatusOf(_vocab, e.key).$4, shape: BoxShape.circle)),
                    const SizedBox(width: 8),
                    Expanded(child: Text(tr(soStatusOf(_vocab, e.key).$2, soStatusOf(_vocab, e.key).$3), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600))),
                    Text(soMoney(_n(e.value)), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
                    SizedBox(width: 52, child: Text('${statusTotal == 0 ? 0 : (_n(e.value) * 100 / statusTotal).toStringAsFixed(1)}%', textAlign: TextAlign.end, style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
                  ])),
                ),
            ]),
            // ── أداءُ مناديب التشغيل ──
            _section(tr('أداء مناديب التشغيل', 'Operations reps performance'), Icons.emoji_events_outlined, [
              Text(tr('من «السيلز التشغيلي» المختار عند إنشاء كلّ شحنة. اضغط اسمًا لترى شحناته.', 'From the «operational sales» chosen at creation. Tap a name for their shipments.'),
                  style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
              if (_n(p['noSalesRep']) > 0)
                Padding(padding: const EdgeInsets.only(top: 4), child: Text(tr('${p['noSalesRep']} شحنة بلا مندوب', '${p['noSalesRep']} with no rep'),
                    style: const TextStyle(fontSize: 11.5, color: T.warn, fontWeight: FontWeight.w700))),
              const SizedBox(height: 6),
              if (reps.isEmpty)
                Padding(padding: const EdgeInsets.all(12), child: Text(tr('لا شحنات مسجَّلٌ عليها مندوب في هذه الفترة', 'No shipments with a rep'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint)))
              else
                for (final r in reps)
                  InkWell(
                    onTap: () => _openList(cols: {'salesRepName': {'${r['name']}'}}),
                    child: Padding(padding: const EdgeInsets.symmetric(vertical: 7), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Container(width: 24, height: 24, alignment: Alignment.center,
                            decoration: BoxDecoration(color: _n(r['rank']) == 1 ? const Color(0xFFFEF3C7) : T.canvas, shape: BoxShape.circle),
                            child: Text('${r['rank']}', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: _n(r['rank']) == 1 ? const Color(0xFFB45309) : T.inkSoft))),
                        const SizedBox(width: 8),
                        Expanded(child: Text('${r['name']}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700))),
                        Text('${r['live']}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
                        const SizedBox(width: 10),
                        Text(_short(_n(r['margin'])), style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: _n(r['margin']) >= 0 ? T.success : T.danger)),
                      ]),
                      const SizedBox(height: 4),
                      ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(
                        value: reps.isEmpty ? 0 : (_n(r['live']) / _n(reps.first['live'] == 0 ? 1 : reps.map((x) => _n(x['live'])).reduce((a, b) => a > b ? a : b))).toDouble(),
                        minHeight: 6, backgroundColor: T.canvas, color: T.orange)),
                      Text(tr('${r['cancelled']} ملغاة (${r['cancelRate']}%) · إيرادات ${soMoney(_n(r['sell']).round())}', '${r['cancelled']} cancelled (${r['cancelRate']}%) · revenue ${soMoney(_n(r['sell']).round())}'),
                          style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                    ])),
                  ),
            ]),
            // ── العملاء والموردون والمسارات ──
            for (final g in [
              (tr('أكبر العملاء', 'Top customers'), Icons.people_outline, cur['byCustomer'], 'customerName'),
              (tr('أكبر الموردين', 'Top suppliers'), Icons.store_outlined, cur['bySupplier'], 'supplierName'),
              (tr('أكثر المسارات', 'Top routes'), Icons.alt_route, cur['byRoute'], ''),
            ])
              _section(g.$1, g.$2, [
                if ((g.$3 as List? ?? const []).isEmpty)
                  Padding(padding: const EdgeInsets.all(8), child: Text(tr('لا بيانات في الفترة', 'nothing in this period'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
                for (final r in (g.$3 as List? ?? const []).take(6))
                  InkWell(
                    onTap: g.$4.isEmpty ? null : () => _openList(cols: {g.$4: {'${r['name']}'}}),
                    child: Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Row(children: [
                      Expanded(child: Text('${r['name']}', style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis)),
                      Text('${r['orders']}', style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
                      const SizedBox(width: 10),
                      Text(_short(_n(r['margin'])), style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: _n(r['margin']) >= 0 ? T.success : T.danger)),
                    ])),
                  ),
              ], action: g.$4 == 'customerName' ? TextButton(onPressed: _openCustomers, child: Text(tr('الكل', 'all')))
                  : g.$4 == 'supplierName' ? TextButton(onPressed: _openFleet, child: Text(tr('الكل', 'all')))
                  : TextButton(onPressed: _openAnalytics, child: Text(tr('الكل', 'all')))),
            // ── مربوطةٌ بالشركة ──
            const SizedBox(height: 12),
            StatGrid(spacing: 8, minColumns: 2, maxColumns: 3, children: [
              _kpi(Icons.trending_down, tr('بيع أقل من الشراء', 'Sold below cost'), soMoney(_n(t['losing'])), tone: _n(t['losing']) > 0 ? T.danger : T.inkFaint, onTap: _openAnalytics),
              _kpi(Icons.warning_amber_rounded, tr('بلا سعر', 'No price'), soMoney(_n(t['missingPrice'])), tone: _n(t['missingPrice']) > 0 ? T.warn : T.inkFaint,
                  onTap: () => _openList(cols: {'buyPrice': {'__blank__'}})),
              _kpi(Icons.schedule, tr('متأخرة الآن', 'Late now'), soMoney(_n(p['lateNow'])), tone: _n(p['lateNow']) > 0 ? T.danger : T.inkFaint,
                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ShipmentOrdersScreen(initialStatuses: ['late'])))),
              // تُفتح الشحناتُ المربوطةُ هنا، في القسم نفسِه — لا قسمُ التخليص.
              _kpi(Icons.directions_boat_outlined, tr('مربوطة بالتخليص', 'Linked to customs'), soMoney(_n(p['customsLinked'])), tone: const Color(0xFF0E7490),
                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ShipmentOrdersScreen(
                    initialFrom: '${p['from'] ?? ''}', initialTo: '${p['to'] ?? ''}', byPickup: true, customsLinked: true)))),
              _kpi(Icons.forum_outlined, tr('ملاحظات المتابعة', 'Follow-up notes'), soMoney(_n(p['followUpNotes'])), tone: const Color(0xFF0369A1),
                  sub: tr('على ${p['followUpShipments'] ?? 0} شحنة', 'on ${p['followUpShipments'] ?? 0} loads')),
              _kpi(Icons.badge_outlined, tr('بطاقات سائقين منتهية', 'Expired driver cards'), soMoney(_n(p['driversExpired'])), tone: _n(p['driversExpired']) > 0 ? T.warn : T.inkFaint, onTap: _openFleet),
              _kpi(Icons.store_outlined, tr('الموردون', 'Suppliers'), soMoney(_n(fleet['suppliers'])), onTap: _openFleet),
              _kpi(Icons.local_shipping_outlined, tr('شاحنات في السجل', 'Trucks on file'), soMoney(_n(fleet['vehicles'])), onTap: _openFleet,
                  sub: _n((fleet['gaps'] as Map?)?['unknown']) > 0 ? tr('${(fleet['gaps'] as Map)['unknown']} مجهولة المالك', '${(fleet['gaps'] as Map)['unknown']} owner unknown') : null),
              _kpi(Icons.people_alt_outlined, tr('عملاء نشطون', 'Active customers'), soMoney(_n(t['customers'])), onTap: _openCustomers,
                  sub: tr('${t['routes']} مسار', '${t['routes']} routes')),
            ]),
          ],
          // ── آخرُ ما سُجِّل ──
          _section(tr('آخر الشحنات', 'Latest shipments'), Icons.history, [
            if (recent.isEmpty) Padding(padding: const EdgeInsets.all(12), child: Text(tr('لا شحنات بعد', 'nothing yet'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
            // Material شفّاف: ListTile داخل بطاقةٍ ملوّنة يحتاج سطحًا يرسم عليه أثرَ الضغط.
            for (final o in recent)
              Material(type: MaterialType.transparency, child: ListTile(
                dense: true, contentPadding: EdgeInsets.zero,
                title: Text('${soRef(o)} · ${o['customerName'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
                subtitle: Text('${o['fromCity'] ?? '—'} ← ${o['toCity'] ?? '—'}${'${o['salesRepName'] ?? ''}'.isNotEmpty ? '  · ${o['salesRepName']}' : ''}'),
                trailing: Chip2(tr(soStatusOf(_vocab, o['status']).$2, soStatusOf(_vocab, o['status']).$3), soStatusOf(_vocab, o['status']).$4),
                onTap: () async {
                  await Navigator.push(context, MaterialPageRoute(builder: (_) => ShipmentOrderDetailScreen(order: o, vocab: _vocab)));
                  _load();
                },
              )),
          ], action: TextButton(onPressed: () => _openList(all: true), child: Text(tr('كل الشحنات', 'all')))),
          // ── تحليلُ تقرير الفروع — مصدرٌ آخر ──
          Padding(padding: const EdgeInsets.only(top: 12), child: AppCard(child: Theme(
            data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
            child: Material(type: MaterialType.transparency, child: ExpansionTile(
              tilePadding: EdgeInsets.zero,
              title: Text(tr('تحليل تقرير الفروع', 'Branch report analysis'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              subtitle: Text(tr('من شيت الفروع، لا من الشحنات أعلاه', 'from the branch sheet, not the shipments above'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
              children: const [OpsAnalyticsPanel(base: '/api/shipment-orders/ops-analytics', liveEvent: 'shipmentOrders:updated')],
            )),
          ))),
        ]),
      ),
    );
  }
}
