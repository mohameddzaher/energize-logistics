import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/contact.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// ملفُّ العميل — مطابقٌ لصفحة الويب /system/shipment-orders/customers/[id]
/// و/system/operations/customers/[id] (وهما شاشةٌ واحدة).
///
/// أرقامُه أوّلًا: كم رحلةً وبكم، ثمّ المساراتُ التي **يعمل** عليها فعلًا
/// موصولةً بالسعر المتّفق عليه، ثمّ قائمةُ الأسعار، ثمّ آخرُ رحلاته. والفرقُ
/// بين الجدولين هو الفائدة: مسارٌ يُشتغَل عليه بلا سعرٍ متّفقٍ عليه يُرى بالعين.
class CustomerRegistryProfileScreen extends StatefulWidget {
  final String customerId;
  const CustomerRegistryProfileScreen({super.key, required this.customerId});
  @override
  State<CustomerRegistryProfileScreen> createState() => _CustomerRegistryProfileScreenState();
}

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
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/customer-registry/${widget.customerId}?page=$_page&limit=25');
      if (!mounted) return;
      setState(() { _data = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
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
    // المالُ يُخفى عمّن لا يراه — الخادمُ يحذف الحقلَ أصلًا، فلا تُرسَم بطاقةٌ فارغة.
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
                      GridView.count(
                        crossAxisCount: 2,
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        childAspectRatio: 1.7,
                        mainAxisSpacing: 8,
                        crossAxisSpacing: 8,
                        children: [
                          _tile(tr('الرحلات (كشوف)', 'Trips (sheets)'), '${a['sheets'] ?? 0}', T.orange, Icons.route_outlined),
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

                      // المساراتُ التي يعمل عليها فعلًا — من كشوف التشغيل.
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
                                  ]),
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

                      // قائمةُ الأسعار المتّفق عليها.
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

                      // الرحلاتُ صفحةً صفحة — عميلٌ له أربعةُ آلافِ كشف.
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
                                onPressed: _page <= 1 ? null : () { setState(() { _page--; _loading = true; }); _load(); },
                                icon: const Icon(Icons.chevron_right_rounded)),
                              Text('${tr('صفحة', 'Page')} ${sheets['page'] ?? 1} / ${sheets['pages'] ?? 1}',
                                  style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                              IconButton(
                                onPressed: (sheets['page'] ?? 1) >= (sheets['pages'] ?? 1)
                                    ? null
                                    : () { setState(() { _page++; _loading = true; }); _load(); },
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
