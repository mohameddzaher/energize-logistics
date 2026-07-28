import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// طلبات الشحنات — the standalone shipment-orders trial: the orders list with
/// the same status vocabulary, search and inline status change.
class ShipmentOrdersScreen extends StatefulWidget {
  const ShipmentOrdersScreen({super.key});
  @override
  State<ShipmentOrdersScreen> createState() => _ShipmentOrdersScreenState();
}

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

class _ShipmentOrdersScreenState extends State<ShipmentOrdersScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  String _status = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('shipment-orders:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('shipment-orders:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final qs = _status.isEmpty ? '' : '&status=$_status';
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

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((r) {
      if (q.isEmpty) return true;
      return [r['waybillNumber'], r['customerName'], r['supplierName'], r['vehiclePlate'], r['fromCity'], r['toCity'], r['driverName']]
          .any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    return AppScaffold(
      title: Text(tr('طلبات الشحنات', 'Shipment Orders')),
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
                        children: _soStatuses.entries.map((e) {
                          final selected = _status == e.key;
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: selected,
                              onSelected: (_) { setState(() { _status = selected ? '' : e.key; _loading = true; }); _load(); },
                              label: Text(tr(e.value.$1, e.value.$2)),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : e.value.$3),
                              selectedColor: e.value.$3,
                              backgroundColor: e.value.$3.withValues(alpha: 0.1),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          );
                        }).toList(),
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
                                final st = _soStatuses[r['status']] ?? ('—', '—', T.inkFaint);
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  child: AppCard(
                                    topAccent: st.$3,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Text('${tr('بوليصة', 'WB')} ${r['waybillNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                                        const Spacer(),
                                        Chip2(tr(st.$1, st.$2), st.$3),
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
                                          value: _soStatuses.containsKey(r['status']) ? r['status'] : null,
                                          hint: Text(tr('الحالة', 'Status'), style: const TextStyle(fontSize: 12)),
                                          underline: const SizedBox.shrink(),
                                          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.ink),
                                          items: _soStatuses.entries
                                              .map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2))))
                                              .toList(),
                                          onChanged: (v) { if (v != null) _setStatus(r, v); },
                                        ),
                                      ]),
                                    ]),
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
