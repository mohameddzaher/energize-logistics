import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/doc_pdf.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'shipment_order_create.dart';

/// طلبات الشحنات — the standalone shipment-orders trial: the orders list with
/// the same status vocabulary, search and inline status change.
class ShipmentOrdersScreen extends StatefulWidget {
  const ShipmentOrdersScreen({super.key});
  @override
  State<ShipmentOrdersScreen> createState() => _ShipmentOrdersScreenState();
}

/// الحالاتُ الأساسيّة — تُرسَم بها الشاشةُ قبل أن يردّ الخادم، وتبقى إن تعذّر
/// الاتّصال. والمضبوطُ من إعدادات القسم يحلّ محلَّها متى وصل.
const _soStatuses = {
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

/// سجلُّ حالةٍ كما تعرضه الشاشة: مفتاحُها واسمُها ولونُها.
typedef _Status = (String key, String ar, String en, Color color);

Color _hex(String? v) {
  final h = (v ?? '').replaceAll('#', '').trim();
  if (h.length != 6) return T.inkFaint;
  final n = int.tryParse(h, radix: 16);
  return n == null ? T.inkFaint : Color(0xFF000000 | n);
}

class _ShipmentOrdersScreenState extends State<ShipmentOrdersScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  // ── والحالةُ تُنتقى بالتراكم ─────────────────────────────────────────────
  // «أرِني المتأخّرةَ وما في الطريق معًا» — سؤالٌ يُسأل كلَّ صباح، وشريحةٌ
  // واحدةٌ تجيب عن نصفه.
  final Set<String> _statuses = {};
  // مضبوطةٌ من إعدادات القسم؛ والقائمةُ المكتوبةُ أعلاه ريثما تصل.
  List<_Status> _vocab = _soStatuses.entries
      .map((e) => (e.key, e.value.$1, e.value.$2, e.value.$3))
      .toList();
  late final void Function() _onLive;

  _Status _statusOf(dynamic key) => _vocab.firstWhere(
        (v) => v.$1 == key,
        orElse: () => ('', '—', '—', T.inkFaint),
      );

  Future<void> _loadStatuses() async {
    try {
      final d = await Api.instance.get('/api/shipment-orders/statuses');
      final rows = List<Map<String, dynamic>>.from(d['statuses'] ?? []);
      if (!mounted || rows.isEmpty) return;
      setState(() {
        _vocab = rows
            .map((r) => (
                  (r['key'] ?? '').toString(),
                  (r['ar'] ?? '').toString(),
                  (r['en'] ?? '').toString(),
                  _hex(r['color'] as String?),
                ))
            .toList();
      });
    } catch (_) {/* المكتوبةُ تكفي */}
  }

  @override
  void initState() {
    super.initState();
    _load();
    _loadStatuses();
    _onLive = () => _load();
    Live.instance.on('shipmentOrders:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('shipmentOrders:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      // مفصولةً بفاصلة — الخادمُ يقرؤها `\$in`.
      final qs = _statuses.isEmpty ? '' : '&status=${_statuses.join(',')}';
      final d = await Api.instance.get('/api/shipment-orders/orders?limit=100$qs');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['orders'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _setStatus(Map<String, dynamic> o, String v) async {
    try {
      await Api.instance.patch('/api/shipment-orders/orders/${o['_id']}/status', {'status': v});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // طباعة/مشاركة بوليصة الطلب كـ PDF.
  Future<void> _printOrder(Map<String, dynamic> r) async {
    String s(String k) => (r[k] ?? '').toString();
    await printDocument(
      title: tr('بوليصة شحن', 'Shipment waybill'),
      number: s('reference').isNotEmpty ? s('reference') : s('waybillNumber'),
      subtitle: '${s('fromCity')} ← ${s('toCity')}',
      rows: [
        (tr('العميل', 'Customer'), s('customerName')),
        (tr('المورّد', 'Supplier'), s('supplierName')),
        (tr('من', 'From'), s('fromCity')),
        (tr('إلى', 'To'), s('toCity')),
        (tr('نوع الشاحنة', 'Truck type'), s('truckType')),
        (tr('نوع البضاعة', 'Cargo'), s('cargoType')),
        (tr('السيارة', 'Vehicle'), s('vehicleName').isNotEmpty ? s('vehicleName') : s('vehiclePlate')),
        (tr('السائق', 'Driver'), s('driverName')),
        (tr('هاتف السائق', 'Driver phone'), s('driverPhone')),
        (tr('سعر البيع', 'Sell price'), s('sellPrice')),
        (tr('سعر الشراء', 'Buy price'), s('buyPrice')),
        (tr('الفرع', 'Branch'), s('branch')),
        (tr('ملاحظات', 'Notes'), s('notes')),
      ],
    );
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((r) {
      if (q.isEmpty) return true;
      return [r['reference'], r['waybillNumber'], r['graduationNumber'], r['customerName'], r['supplierName'], r['vehiclePlate'], r['fromCity'], r['toCity'], r['driverName']]
          .any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    return AppScaffold(
      title: Text(tr('طلبات الشحنات', 'Shipment Orders')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final created = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const ShipmentOrderCreateScreen()));
          if (created == true) _load();
        },
        icon: const Icon(Icons.add),
        label: Text(tr('طلب جديد', 'New')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث بالبوليصة أو العميل أو المورد…', 'Search…'), prefixIcon: const Icon(Icons.search)),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: [
                          Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: _statuses.isEmpty,
                              onSelected: (_) { setState(() { _statuses.clear(); _loading = true; }); _load(); },
                              label: Text(tr('الكل', 'All')),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _statuses.isEmpty ? Colors.white : T.navy),
                              selectedColor: T.navy,
                              backgroundColor: T.navy.withValues(alpha: 0.1),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          ),
                          ..._vocab.map((v) {
                            final selected = _statuses.contains(v.$1);
                            return Padding(
                              padding: const EdgeInsets.only(left: 6),
                              child: FilterChip(
                                selected: selected,
                                onSelected: (_) {
                                  setState(() {
                                    selected ? _statuses.remove(v.$1) : _statuses.add(v.$1);
                                    _loading = true;
                                  });
                                  _load();
                                },
                                label: Text(tr(v.$2, v.$3)),
                                labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : v.$4),
                                selectedColor: v.$4,
                                backgroundColor: v.$4.withValues(alpha: 0.1),
                                checkmarkColor: Colors.white,
                                side: BorderSide.none,
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                              ),
                            );
                          }),
                        ],
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? EmptyState(icon: Icons.assignment_outlined, title: tr('لا توجد طلبات مطابقة', 'No matches'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final r = filtered[i];
                                final st = _statusOf(r['status']);
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  child: Pressable(
                                    onTap: () async {
                                      final saved = await Navigator.push<bool>(
                                          context, MaterialPageRoute(builder: (_) => ShipmentOrderCreateScreen(order: r)));
                                      if (saved == true) _load();
                                    },
                                    onLongPress: () async {
                                      final ok = await showDialog<bool>(
                                        context: context,
                                        builder: (c) => AlertDialog(
                                          title: Text(tr('حذف الطلب', 'Delete order')),
                                          content: Text(tr('حذف بوليصة ${r['reference'] ?? r['waybillNumber'] ?? ''} نهائيًا؟', 'Delete this order?')),
                                          actions: [
                                            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
                                            FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
                                          ],
                                        ),
                                      );
                                      if (ok != true) return;
                                      try { await Api.instance.delete('/api/shipment-orders/orders/${r['_id']}'); _load(); }
                                      catch (e) { if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
                                    },
                                    child: AppCard(
                                    topAccent: st.$4,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        // المرجعُ لا الرقمُ الخام: المنقولُ من المنصّة لا رقمَ بوليصةٍ
                                        // له عندنا، فكان العنوانُ يُقرأ «بوليصة » فارغًا.
                                        Text('${tr('بوليصة', 'WB')} ${r['reference'] ?? r['waybillNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                                        if (r['source'] == 'platform') ...[
                                          const SizedBox(width: 5),
                                          Text(tr('منصّة', 'platform'), style: const TextStyle(fontSize: 10, color: T.inkFaint)),
                                        ],
                                        const Spacer(),
                                        InkWell(
                                          onTap: () => _printOrder(r),
                                          borderRadius: BorderRadius.circular(8),
                                          child: const Padding(padding: EdgeInsets.all(4), child: Icon(Icons.print_outlined, size: 19, color: T.navy)),
                                        ),
                                        const SizedBox(width: 6),
                                        Chip2(tr(st.$2, st.$3), st.$4),
                                      ]),
                                      const SizedBox(height: 4),
                                      Text('${r['fromCity'] ?? '—'} ← ${r['toCity'] ?? '—'}${(r['customerName'] ?? '').toString().isNotEmpty ? ' · ${r['customerName']}' : ''}',
                                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                                      const SizedBox(height: 6),
                                      Row(children: [
                                        if ((r['vehiclePlate'] ?? '').toString().isNotEmpty)
                                          Chip2(r['vehiclePlate'], T.navy, icon: Icons.local_shipping_outlined),
                                        const Spacer(),
                                        DropdownButton<String>(
                                          value: _vocab.any((v) => v.$1 == r['status']) ? r['status'] as String : null,
                                          hint: Text(tr('الحالة', 'Status'), style: const TextStyle(fontSize: 12)),
                                          underline: const SizedBox.shrink(),
                                          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.ink),
                                          items: _vocab
                                              .map((v) => DropdownMenuItem(value: v.$1, child: Text(tr(v.$2, v.$3))))
                                              .toList(),
                                          onChanged: (v) { if (v != null) _setStatus(r, v); },
                                        ),
                                      ]),
                                    ]),
                                    ),
                                  ),
                                );
                              },
                            ),
                    ),
                  ),
                ]),
    );
  }
}
