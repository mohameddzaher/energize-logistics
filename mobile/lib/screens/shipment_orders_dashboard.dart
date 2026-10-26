import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../resource/configs.dart' show customersRegisterCfg, customerEditRoles, customerRemoveRoles;
import '../resource/resource.dart';
import '../services/api.dart';
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

/// لوحةُ طلبات الشحنات — نظيرُ /system/shipment-orders/dashboard في الويب:
/// لوحةُ مدير التشغيل (ops-analytics) أوّلًا، ثمّ حالُ القسم اليومَ والشهر —
/// وكلُّ رقمٍ يُفتَح على صفوفه بفلتره.
class ShipmentOrdersDashboardScreen extends StatefulWidget {
  const ShipmentOrdersDashboardScreen({super.key});
  @override
  State<ShipmentOrdersDashboardScreen> createState() => _ShipmentOrdersDashboardScreenState();
}

String _iso(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
String _monthStart() { final n = DateTime.now(); return _iso(DateTime(n.year, n.month, 1)); }

class _ShipmentOrdersDashboardScreenState extends State<ShipmentOrdersDashboardScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  int _seq = 0;
  List<SoStatus> _vocab = soBaseStatuses;
  late final void Function() _onLive = _load;

  @override
  void initState() {
    super.initState();
    _load();
    loadSoStatuses().then((v) { if (mounted) setState(() => _vocab = v); });
    Live.instance.on('shipmentOrders:updated', _onLive);
    Live.instance.on('shipmentOrders:fleet', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('shipmentOrders:updated', _onLive);
    Live.instance.off('shipmentOrders:fleet', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/shipment-orders/dashboard');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _openList({List<String> statuses = const [], String from = ''}) =>
      Navigator.push(context, MaterialPageRoute(builder: (_) => ShipmentOrdersScreen(initialStatuses: statuses, initialFrom: from)));
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

  Widget _tile(String value, String label, {String? sub, Color color = T.ink, VoidCallback? onTap}) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(value, style: TextStyle(fontSize: 21, fontWeight: FontWeight.w900, color: color)),
          Text(label, style: const TextStyle(fontSize: 12, color: T.inkSoft)),
          if (sub != null) Text(sub, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
        ])),
      );

  @override
  Widget build(BuildContext context) {
    final auth = context.read<AuthProvider>();
    final editor = canEditOrders(context);
    // القراءةُ تكفي لرؤية اللوحة: مَن مُنح «عرض» على القسم يقرأ حالَه.
    if (!editor && !auth.canAccessSection('Shipment Orders')) {
      return AppScaffold(title: Text(tr('لوحة طلبات الشحنات', 'Shipment Orders Dashboard')),
          body: EmptyState(icon: Icons.lock_outline, title: tr('لا تملك صلاحية.', 'Not authorized.')));
    }
    final month = Map<String, dynamic>.from(_d?['month'] ?? {});
    final today = Map<String, dynamic>.from(_d?['today'] ?? {});
    final fleet = Map<String, dynamic>.from(_d?['fleet'] ?? {});
    final t = Map<String, dynamic>.from(month['totals'] ?? {});
    final td = Map<String, dynamic>.from(today['totals'] ?? {});
    final recent = List<Map<String, dynamic>>.from(_d?['recent'] ?? const []);
    final byStatus = Map<String, dynamic>.from(month['byStatus'] ?? {});
    final statusCards = byStatus.entries.where((e) => (e.value as num? ?? 0) > 0).toList()
      ..sort((a, b) => (b.value as num).compareTo(a.value as num));
    final margin = num.tryParse('${t['margin'] ?? 0}') ?? 0;
    final byMonth = List.from(month['byMonth'] ?? const []);
    final last12 = byMonth.length > 12 ? byMonth.sublist(byMonth.length - 12) : byMonth;

    return AppScaffold(
      title: Text(tr('لوحة طلبات الشحنات', 'Shipment Orders Dashboard')),
      actions: [
        IconButton(tooltip: tr('كل الشحنات', 'All shipments'), icon: const Icon(Icons.manage_search), onPressed: () => _openList()),
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
          // ── لوحةُ مدير التشغيل أوّلًا — كما في الويب. والويبُ يستمع إلى
          // `shipmentOrders:changed` ولا يبثّه الخادم، فالحيُّ هنا على `updated`.
          const OpsAnalyticsPanel(base: '/api/shipment-orders/ops-analytics', liveEvent: 'shipmentOrders:updated'),
          const SizedBox(height: 6),
          if (_loading && _d == null)
            const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator()))
          else if (_error != null && _d == null)
            ErrorRetry(message: _error!, onRetry: _load)
          else ...[
            // ── اليومُ والشهر ──
            // الصفُّ يطول مع النصّ (الخطُّ الكبير) — النسبةُ الثابتة كانت تقصّه.
            StatGrid(
              spacing: 8, minColumns: 2, maxColumns: 4,
              children: [
                _tile('${td['orders'] ?? 0}', tr('شحنات اليوم', 'Today'), sub: tr('اضغط لعرضها', 'tap to open'), color: T.orange,
                    onTap: () => _openList(from: _iso(DateTime.now()))),
                _tile('${t['orders'] ?? 0}', tr('شحنات الشهر', 'This month'), sub: '${tr('منها ملغاة', 'cancelled')}: ${t['cancelled'] ?? 0}',
                    onTap: () => _openList(from: _monthStart())),
                _tile(soMoney(margin.round()), tr('ربح الشهر (ر.س)', 'Month margin (SAR)'), color: margin >= 0 ? T.success : T.danger,
                    sub: '${tr('بيع', 'sell')} ${soMoney((num.tryParse('${t['sell'] ?? 0}') ?? 0).round())} · ${tr('شراء', 'buy')} ${soMoney((num.tryParse('${t['buy'] ?? 0}') ?? 0).round())} · ${t['marginPct'] ?? 0}%'),
                _tile(soMoney((num.tryParse('${t['avgMargin'] ?? 0}') ?? 0).round()), tr('متوسط ربح الشحنة', 'Avg margin / load'),
                    sub: '${tr('متوسط البيع', 'avg sell')} ${soMoney((num.tryParse('${t['avgSell'] ?? 0}') ?? 0).round())}'),
              ],
            ),
            // ── ما يحتاج تصرُّفًا ──
            if ((t['losing'] ?? 0) as num > 0)
              Padding(padding: const EdgeInsets.only(top: 8), child: ListTile(
                tileColor: T.danger.withValues(alpha: 0.07),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                leading: const Icon(Icons.trending_down, color: T.danger),
                title: Text('${t['losing']} ${tr('شحنة بخسارة هذا الشهر', 'loss-making loads this month')}', style: const TextStyle(fontWeight: FontWeight.w800, color: T.danger)),
                subtitle: Text(tr('البيع أقلُّ من الشراء — تُراجَع في التحليلات', 'sold below cost — review in analytics'), style: const TextStyle(fontSize: 11)),
                onTap: _openAnalytics,
              )),
            if ((t['missingPrice'] ?? 0) as num > 0)
              Padding(padding: const EdgeInsets.only(top: 8), child: ListTile(
                tileColor: T.warn.withValues(alpha: 0.08),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                leading: const Icon(Icons.warning_amber_rounded, color: T.warn),
                title: Text('${t['missingPrice']} ${tr('شحنة بلا سعر', 'loads with no price')}', style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xFF92400E))),
                subtitle: Text(tr('لا تدخل حسابَ الربح حتى يُكتب سعرُها', 'excluded from margin until priced'), style: const TextStyle(fontSize: 11)),
                onTap: () => _openList(from: _monthStart()),
              )),
            // ── أين تقف شحناتُ الشهر ──
            if (statusCards.isNotEmpty) ...[
              const SizedBox(height: 10),
              AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(tr('أين تقف شحنات الشهر', 'Where this month stands'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                const SizedBox(height: 8),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  for (final e in statusCards)
                    InkWell(
                      onTap: () => _openList(statuses: [e.key], from: _monthStart()),
                      child: Container(
                        width: 96,
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10), border: Border.all(color: T.line)),
                        child: Column(children: [
                          Text('${e.value}', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: soStatusOf(_vocab, e.key).$4)),
                          Text(tr(soStatusOf(_vocab, e.key).$2, soStatusOf(_vocab, e.key).$3), style: const TextStyle(fontSize: 11, color: T.inkSoft), overflow: TextOverflow.ellipsis),
                        ]),
                      ),
                    ),
                ]),
              ])),
            ],
            // ── السجلُّ الذي يُحمَّل منه ──
            const SizedBox(height: 10),
            // الصفُّ يطول مع النصّ (الخطُّ الكبير) — النسبةُ الثابتة كانت تقصّه.
            StatGrid(
              spacing: 8, minColumns: 2, maxColumns: 4,
              children: [
                _tile('${fleet['suppliers'] ?? 0}', tr('مورّد', 'Suppliers'), onTap: _openFleet),
                _tile('${fleet['vehicles'] ?? 0}', tr('شاحنة في السجلّ', 'Trucks on file'), onTap: _openFleet,
                    sub: ((fleet['gaps'] as Map?)?['unknown'] ?? 0) as num > 0 ? '${tr('مجهولة المالك', 'owner unknown')}: ${(fleet['gaps'] as Map)['unknown']}' : null),
                _tile('${fleet['drivers'] ?? 0}', tr('سائق', 'Drivers'), onTap: _openFleet),
                _tile('${t['customers'] ?? 0}', tr('عميل عمل هذا الشهر', 'Customers this month'), sub: '${tr('مسارات', 'routes')}: ${t['routes'] ?? 0}', onTap: _openCustomers),
              ],
            ),
            // ── مَن يحمل العمل ──
            for (final g in [
              (tr('أكبر العملاء', 'Top customers'), month['byCustomer'], _openCustomers),
              (tr('أكبر الموردين', 'Top suppliers'), month['bySupplier'], _openFleet),
              (tr('أكثر المسارات', 'Top routes'), month['byRoute'], _openAnalytics),
            ])
              Padding(padding: const EdgeInsets.only(top: 10), child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  const Icon(Icons.bar_chart, size: 17, color: T.orange),
                  const SizedBox(width: 5),
                  Text(g.$1, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                  const Spacer(),
                  TextButton(onPressed: g.$3, child: Text(tr('الكل', 'all'))),
                ]),
                if (List.from(g.$2 ?? const []).isEmpty)
                  Padding(padding: const EdgeInsets.all(12), child: Text(tr('لا بيانات هذا الشهر', 'nothing this month'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: T.inkFaint)))
                else
                  for (final r in List.from(g.$2).take(6))
                    Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(children: [
                      Expanded(child: Text('${r['name']}', style: const TextStyle(fontSize: 13), overflow: TextOverflow.ellipsis)),
                      Text('${r['orders'] ?? 0}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                      const SizedBox(width: 10),
                      Text(soMoney((num.tryParse('${r['margin'] ?? 0}') ?? 0).round()),
                          style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: (num.tryParse('${r['margin'] ?? 0}') ?? 0) >= 0 ? T.success : T.danger)),
                    ])),
              ]))),
            // ── اتّجاهُ الأشهر ──
            if (last12.length > 1)
              Padding(padding: const EdgeInsets.only(top: 10), child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(tr('الأشهر الأخيرة', 'Recent months'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                const SizedBox(height: 8),
                SizedBox(height: 130, child: Builder(builder: (_) {
                  final vals = last12.map((b) => num.tryParse('${b['margin'] ?? 0}') ?? 0).toList();
                  final max = vals.fold<num>(1, (a, b) => b.abs() > a ? b.abs() : a);
                  return Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    for (var i = 0; i < last12.length; i++)
                      Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 1.5), child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                        Text(soMoney(vals[i].round()), style: const TextStyle(fontSize: 8, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.clip),
                        Container(height: 4 + 80 * (vals[i].abs() / max), decoration: BoxDecoration(color: vals[i] >= 0 ? T.orange.withValues(alpha: 0.7) : T.danger, borderRadius: const BorderRadius.vertical(top: Radius.circular(3)))),
                        Text('${last12[i]['key']}'.length >= 7 ? '${last12[i]['key']}'.substring(2) : '${last12[i]['key']}', style: const TextStyle(fontSize: 8.5, color: T.inkFaint)),
                      ]))),
                  ]);
                })),
              ]))),
            // ── آخرُ ما سُجِّل ──
            Padding(padding: const EdgeInsets.only(top: 10), child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                Text(tr('آخر الشحنات', 'Latest shipments'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                const Spacer(),
                TextButton(onPressed: () => _openList(), child: Text(tr('كل الشحنات', 'all'))),
              ]),
              if (recent.isEmpty) Padding(padding: const EdgeInsets.all(12), child: Text(tr('لا شحنات بعد', 'nothing yet'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
              for (final o in recent)
                ListTile(
                  dense: true, contentPadding: EdgeInsets.zero,
                  title: Text('${soRef(o)} · ${o['customerName'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
                  subtitle: Text('${o['fromCity'] ?? '—'} ← ${o['toCity'] ?? '—'}  ${o['vehiclePlate'] ?? ''}'),
                  trailing: Chip2(tr(soStatusOf(_vocab, o['status']).$2, soStatusOf(_vocab, o['status']).$3), soStatusOf(_vocab, o['status']).$4),
                  onTap: () async {
                    await Navigator.push(context, MaterialPageRoute(builder: (_) => ShipmentOrderDetailScreen(order: o, vocab: _vocab)));
                    _load();
                  },
                ),
            ]))),
          ],
        ]),
      ),
    );
  }
}
