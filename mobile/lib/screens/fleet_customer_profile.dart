import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/contact.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// ملف العميل — عميل واحد بكامل سجل رحلاته وإحصائياته، وتعديل نوعه وتقييمنا له.
/// مطابق لصفحة الويب /system/fleet/customers/[id].
class FleetCustomerProfileScreen extends StatefulWidget {
  final String customerId;
  const FleetCustomerProfileScreen({super.key, required this.customerId});
  @override
  State<FleetCustomerProfileScreen> createState() => _FleetCustomerProfileScreenState();
}

const _statusLabels = {
  'requesting': ('قيد الطلب', 'Requesting', T.inkFaint),
  'loading': ('جاري التحميل', 'Loading', T.warn),
  'uploaded': ('تم التحميل', 'Uploaded', Color(0xFFCA8A04)),
  'on_way': ('في الطريق', 'On way', T.info),
  'arrived': ('وصلت', 'Arrived', Color(0xFF4F46E5)),
  'bond_sent': ('أُرسل السند', 'Bond sent', T.cyan),
  'bond_received': ('استُلم السند', 'Bond received', T.success),
  'late': ('متأخرة', 'Late', Color(0xFFEA580C)),
  'invoiced': ('تمت الفوترة', 'Invoiced', T.violet),
  'cancelled': ('ملغاة', 'Cancelled', T.danger),
};

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  final s = n.round().toString();
  final b = StringBuffer();
  for (int i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write(',');
    b.write(s[i]);
  }
  return b.toString();
}

String _statusLabel(String? k) {
  final m = _statusLabels[k];
  return m == null ? (k ?? '—') : tr(m.$1, m.$2);
}

class _FleetCustomerProfileScreenState extends State<FleetCustomerProfileScreen> {
  Map<String, dynamic>? _data;
  List<Map<String, dynamic>> _loadTypes = [];
  bool _loading = true;
  String? _error;
  bool _saving = false;
  String _type = '';
  String _payType = '';
  int _rating = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('fleet:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('fleet:updated', _onLive);
    super.dispose();
  }

  String _loadTypeLabel(String? key) {
    if (key == null || key.isEmpty) return '';
    final it = _loadTypes.firstWhere((x) => (x['key'] ?? '').toString() == key, orElse: () => const {});
    if (it.isEmpty) return key;
    return (Lang.instance.ar ? (it['nameAr'] ?? it['nameEn']) : (it['nameEn'] ?? it['nameAr'])).toString();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        Api.instance.get('/api/fleet/customers/${widget.customerId}/profile'),
        if (_loadTypes.isEmpty)
          Api.instance.get('/api/lookups?type=fleet_load_type&active=true').catchError((_) => <String, dynamic>{'items': []}),
      ]);
      if (!mounted) return;
      final d = Map<String, dynamic>.from(results[0]);
      final c = Map<String, dynamic>.from(d['customer'] ?? {});
      setState(() {
        _data = d;
        if (results.length > 1) _loadTypes = List<Map<String, dynamic>>.from(results[1]['items'] ?? []);
        _type = (c['customerType'] ?? '').toString();
        _payType = (c['paymentType'] ?? '').toString();
        _rating = (c['rating'] is num) ? (c['rating'] as num).toInt() : 0;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _saveMeta() async {
    setState(() => _saving = true);
    try {
      await Api.instance.put('/api/fleet/customers/${widget.customerId}',
          {'customerType': _type, 'rating': _rating, 'paymentType': _payType});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم الحفظ', 'Saved'))));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String _dt(String? v) {
    final d = v != null ? DateTime.tryParse(v)?.toLocal() : null;
    if (d == null) return '—';
    return '${d.day}/${d.month}/${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final c = d != null ? Map<String, dynamic>.from(d['customer'] ?? {}) : <String, dynamic>{};
    final stats = d != null ? Map<String, dynamic>.from(d['stats'] ?? {}) : <String, dynamic>{};
    final shipments = List<Map<String, dynamic>>.from(d?['shipments'] ?? []);
    final routes = List<Map<String, dynamic>>.from(c['routes'] ?? []);
    final byStatus = Map<String, dynamic>.from(stats['byStatus'] ?? {});

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
                      // بطاقات الإحصاءات
                      GridView.count(
                        crossAxisCount: 2,
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        childAspectRatio: 1.7,
                        mainAxisSpacing: 8,
                        crossAxisSpacing: 8,
                        children: [
                          _tile(tr('إجمالي الرحلات', 'Total trips'), '${stats['trips'] ?? 0}', T.orange, Icons.route_outlined),
                          _tile(tr('إجمالي الدخل', 'Total income'), _money(stats['income']), T.success, Icons.payments_outlined),
                          _tile(tr('متوسط الرحلة', 'Avg / trip'), _money(stats['avgTripIncome']), T.navy, Icons.trending_up_rounded),
                          _tile(tr('آخر رحلة', 'Last trip'), _dt(stats['lastTrip']?.toString()), T.info, Icons.event_outlined),
                          _tile(tr('رحلاتٌ جارية', 'Open trips'), '${stats['openTrips'] ?? 0}', T.warn, Icons.local_shipping_outlined),
                          _tile(tr('مصروف السائقين', 'Driver expense'), _money(stats['driverExpense']), T.danger, Icons.money_off_outlined),
                        ],
                      ),
                      const SizedBox(height: 12),
                      // ── الربط بالـCRM ─────────────────────────────────────
                      // العميل هنا وشركتُه في الـCRM سجلّان مستقلّان يجمعهما
                      // الاسم المطبَّع. وحين يجتمعان يجب أن يُريا.
                      if (d['crm'] != null) ...[
                        AppCard(
                          child: Row(children: [
                            const Icon(Icons.link_rounded, size: 18, color: T.info),
                            const SizedBox(width: 8),
                            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(
                                (Map<String, dynamic>.from(d['crm']['company'] ?? {})['arabicName'] ??
                                        Map<String, dynamic>.from(d['crm']['company'] ?? {})['name'] ?? '—')
                                    .toString(),
                                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                              const SizedBox(height: 2),
                              Text(
                                '${tr('أنشطة', 'Activities')}: ${d['crm']['activities'] ?? 0} · ${tr('صفقات', 'Deals')}: ${d['crm']['deals'] ?? 0}',
                                style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                            ])),
                          ]),
                        ),
                        const SizedBox(height: 12),
                      ],
                      // بيانات العميل + التقييم
                      AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('بيانات العميل', 'Customer details'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                          const SizedBox(height: 10),
                          if ((c['phone'] ?? '').toString().isNotEmpty)
                            Row(children: [
                              const Icon(Icons.phone_outlined, size: 15, color: T.inkSoft),
                              const SizedBox(width: 6),
                              Text(c['phone'].toString(), style: const TextStyle(fontSize: 13)),
                              const Spacer(),
                              ContactButtons(phone: c['phone'].toString(), compact: true),
                            ]),
                          if (routes.isNotEmpty) ...[
                            const SizedBox(height: 8),
                            Wrap(spacing: 6, runSpacing: 6, children: routes.map((r) =>
                                Chip2('${r['fromCity'] ?? ''} ← ${r['toCity'] ?? ''}${r['price'] != null ? ' · ${_money(r['price'])}' : ''}', T.inkSoft)).toList()),
                          ],
                          const Divider(height: 22),
                          Text(tr('نوع العميل', 'Customer type'), style: const TextStyle(fontSize: 12.5, color: T.inkFaint, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 6),
                          Row(children: [
                            Expanded(child: _seg(tr('نقل ثقيل', 'Heavy'), _type == 'heavy', () => setState(() => _type = 'heavy'))),
                            const SizedBox(width: 8),
                            Expanded(child: _seg(tr('عملاء الفروع', 'Branch'), _type == 'branch', () => setState(() => _type = 'branch'))),
                          ]),
                          const SizedBox(height: 12),
                          // نوع الدفع المتفق عليه: يُملأ تلقائيًّا في كل حمولةٍ
                          // جديدة لهذا العميل، ويبقى قابلًا للتعديل في تلك
                          // الحمولة وحدها — الاتفاق افتراضٌ لا قيد.
                          Text(tr('نوع الدفع المتفق عليه', 'Agreed payment type'),
                              style: const TextStyle(fontSize: 12.5, color: T.inkFaint, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 6),
                          Row(children: [
                            Expanded(child: _seg(tr('ضريبي', 'Tax'), _payType == 'tax', () => setState(() => _payType = _payType == 'tax' ? '' : 'tax'))),
                            const SizedBox(width: 8),
                            Expanded(child: _seg(tr('كاش', 'Cash'), _payType == 'cash', () => setState(() => _payType = _payType == 'cash' ? '' : 'cash'))),
                          ]),
                          const SizedBox(height: 12),
                          Text(tr('تقييمنا للعميل', 'Our rating'), style: const TextStyle(fontSize: 12.5, color: T.inkFaint, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 4),
                          Row(children: [1, 2, 3, 4, 5].map((n) => IconButton(
                                padding: const EdgeInsets.symmetric(horizontal: 2),
                                constraints: const BoxConstraints(),
                                onPressed: () => setState(() => _rating = n == _rating ? 0 : n),
                                icon: Icon(n <= _rating ? Icons.star_rounded : Icons.star_outline_rounded,
                                    color: n <= _rating ? const Color(0xFFF59E0B) : T.inkFaint, size: 28),
                              )).toList()),
                          const SizedBox(height: 6),
                          FilledButton.icon(
                            icon: const Icon(Icons.save_outlined, size: 18),
                            onPressed: _saving ? null : _saveMeta,
                            label: Text(tr('حفظ', 'Save')),
                          ),
                        ]),
                      ),
                      const SizedBox(height: 12),
                      // حالات الرحلات
                      if (byStatus.isNotEmpty)
                        AppCard(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(tr('حالات الرحلات', 'Trip statuses'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                            const SizedBox(height: 10),
                            Wrap(spacing: 6, runSpacing: 6, children: byStatus.entries.map((e) {
                              final m = _statusLabels[e.key];
                              return Chip2('${_statusLabel(e.key)}: ${e.value}', m?.$3 ?? T.inkFaint);
                            }).toList()),
                          ]),
                        ),
                      const SizedBox(height: 12),
                      // سجل الرحلات الكامل
                      Text('${tr('سجل الرحلات الكامل', 'Full trip history')} (${shipments.length})',
                          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                      const SizedBox(height: 8),
                      if (shipments.isEmpty)
                        EmptyState(icon: Icons.inventory_2_outlined, title: tr('لا توجد رحلات لهذا العميل', 'No trips'))
                      else
                        ...shipments.map((s) => Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: AppCard(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    Text('${tr('بوليصة', 'WB')} ${s['waybillNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800)),
                                    const Spacer(),
                                    if ((num.tryParse((s['price'] ?? '').toString()) ?? 0) > 0)
                                      Text(_money(s['price']), style: const TextStyle(fontWeight: FontWeight.w800, color: T.success)),
                                  ]),
                                  const SizedBox(height: 4),
                                  Text('${s['fromCity'] ?? '—'} ← ${s['toCity'] ?? '—'}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                                  const SizedBox(height: 6),
                                  Wrap(spacing: 6, runSpacing: 6, children: [
                                    if ((s['vehiclePlate'] ?? '').toString().isNotEmpty) Chip2(s['vehiclePlate'].toString(), T.navy, icon: Icons.local_shipping_outlined),
                                    if ((s['driverName'] ?? '').toString().isNotEmpty) Chip2(s['driverName'].toString(), T.inkSoft, icon: Icons.person_outline),
                                    if (_loadTypeLabel((s['loadType'] ?? '').toString()).isNotEmpty) Chip2(_loadTypeLabel((s['loadType'] ?? '').toString()), T.inkSoft, icon: Icons.category_outlined),
                                    Chip2(_statusLabel(s['status']?.toString()), _statusLabels[s['status']]?.$3 ?? T.inkFaint),
                                    Chip2(_dt(s['loadDate']?.toString() ?? s['createdAt']?.toString()), T.inkFaint, icon: Icons.event_outlined),
                                  ]),
                                ]),
                              ),
                            )),
                      const SizedBox(height: 24),
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

  Widget _seg(String label, bool active, VoidCallback onTap) => Pressable(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          padding: const EdgeInsets.symmetric(vertical: 11),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: active ? T.orange.withValues(alpha: 0.12) : Colors.white,
            border: Border.all(color: active ? T.orange : const Color(0xFFE2E8F0), width: active ? 1.4 : 1),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(label, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: active ? T.orange : T.inkFaint)),
        ),
      );
}
