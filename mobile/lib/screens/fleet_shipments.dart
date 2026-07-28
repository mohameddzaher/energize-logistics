import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// شحنات إدارة الأسطول — native: search, status filter chips, and a detail
/// sheet with the follow-up form (the 3-hour cadence lives on this screen).
class FleetShipmentsScreen extends StatefulWidget {
  const FleetShipmentsScreen({super.key});
  @override
  State<FleetShipmentsScreen> createState() => _FleetShipmentsScreenState();
}

const _statuses = {
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

class _FleetShipmentsScreenState extends State<FleetShipmentsScreen> {
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
    Live.instance.on('fleet:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('fleet:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final qs = _status.isEmpty ? '' : '&status=$_status';
      final d = await Api.instance.get('/api/fleet/shipments?limit=100$qs');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['shipments'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s
      .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  void _open(Map<String, dynamic> s) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => _ShipmentSheet(shipment: s, onDone: _load),
    );
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((s) {
      if (q.isEmpty) return true;
      return [s['waybillNumber'], s['customerName'], s['vehiclePlate'], s['driverName'], s['fromCity'], s['toCity']]
          .any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    return Scaffold(
      appBar: AppBar(title: Text(tr('شحنات الأسطول', 'Fleet Shipments'))),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer(),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(
                        hintText: tr('ابحث برقم البوليصة أو العميل أو اللوحة…', 'Search waybill, customer, plate…'),
                        prefixIcon: const Icon(Icons.search),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: _statuses.entries.map((e) {
                          final selected = _status == e.key;
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: selected,
                              onSelected: (_) {
                                setState(() { _status = selected ? '' : e.key; _loading = true; });
                                _load();
                              },
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
                          ? EmptyState(icon: Icons.inventory_2_outlined, title: tr('لا توجد شحنات مطابقة', 'No matching shipments'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final s = filtered[i];
                                final st = _statuses[s['status']] ?? ('—', '—', T.inkFaint);
                                return FadeSlideIn(
                                  delayMs: (i * 25).clamp(0, 250),
                                  child: Pressable(
                                    onTap: () => _open(s),
                                    child: AppCard(
                                      topAccent: st.$3,
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Text('${tr('بوليصة', 'WB')} ${s['waybillNumber'] ?? ''}',
                                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                                          const Spacer(),
                                          Chip2(tr(st.$1, st.$2), st.$3),
                                        ]),
                                        const SizedBox(height: 6),
                                        Text('${s['fromCity'] ?? '—'} ← ${s['toCity'] ?? '—'}${(s['customerName'] ?? '').toString().isNotEmpty ? ' · ${s['customerName']}' : ''}',
                                            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                                        const SizedBox(height: 6),
                                        Wrap(spacing: 6, runSpacing: 6, children: [
                                          if ((s['vehiclePlate'] ?? '').toString().isNotEmpty)
                                            Chip2(s['vehiclePlate'], T.navy, icon: Icons.local_shipping_outlined),
                                          if ((s['driverName'] ?? '').toString().isNotEmpty)
                                            Chip2(s['driverName'], T.inkSoft, icon: Icons.person_outline),
                                          if (s['lastContactAt'] != null)
                                            Chip2('${tr('آخر تواصل', 'Last contact')}: ${_ago(s['lastContactAt'])}',
                                                _hoursSince(s['lastContactAt']) >= 3 ? T.danger : T.success,
                                                icon: Icons.phone_in_talk_outlined),
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

  int _hoursSince(String? v) {
    final d = v != null ? DateTime.tryParse(v) : null;
    return d == null ? 999 : DateTime.now().difference(d).inHours;
  }

  String _ago(String? v) {
    final h = _hoursSince(v);
    if (h >= 999) return '—';
    if (h < 1) return tr('منذ أقل من ساعة', '<1h ago');
    return tr('منذ $h ساعة', '${h}h ago');
  }
}

/// Shipment detail + the follow-up form.
class _ShipmentSheet extends StatefulWidget {
  final Map<String, dynamic> shipment;
  final Future<void> Function() onDone;
  const _ShipmentSheet({required this.shipment, required this.onDone});
  @override
  State<_ShipmentSheet> createState() => _ShipmentSheetState();
}

class _ShipmentSheetState extends State<_ShipmentSheet> {
  final _location = TextEditingController();
  final _note = TextEditingController();
  bool _busy = false;

  static const _quickNotes = [
    'في الطريق إلى موقع التنزيل', 'حمّل وتحرّك', 'نايم — استراحة', 'فاضي',
    'واقف — مشكلة على الطريق', 'وصل موقع التنزيل', 'جاري التفريغ',
  ];

  Future<void> _send() async {
    if ((_location.text.trim().isEmpty && _note.text.trim().isEmpty) || _busy) return;
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/fleet/shipments/${widget.shipment['_id']}/followups', {
        'currentLocation': _location.text,
        'note': _note.text,
      });
      widget.onDone();
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.shipment;
    final st = _statuses[s['status']] ?? ('—', '—', T.inkFaint);
    return Padding(
      padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(context).viewInsets.bottom + 18),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text('${tr('بوليصة', 'Waybill')} ${s['waybillNumber']}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            const Spacer(),
            Chip2(tr(st.$1, st.$2), st.$3),
          ]),
          const SizedBox(height: 10),
          Text('${s['fromCity'] ?? '—'} ← ${s['toCity'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w700)),
          Text([s['customerName'], s['vehiclePlate'], s['driverName']].where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
              style: const TextStyle(fontSize: 13, color: T.inkSoft)),
          const Divider(height: 26),
          Text(tr('تسجيل متابعة', 'Log a follow-up'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 10),
          TextField(controller: _location, decoration: InputDecoration(labelText: tr('الموقع الحالي', 'Current location'))),
          const SizedBox(height: 8),
          TextField(controller: _note, decoration: InputDecoration(labelText: tr('ملاحظة المتابعة', 'Note'))),
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, children: _quickNotes.map((n) => ActionChip(
                label: Text(n, style: const TextStyle(fontSize: 11.5)),
                onPressed: () => setState(() => _note.text = n),
                backgroundColor: T.navy.withValues(alpha: 0.06),
                side: BorderSide.none,
              )).toList()),
          const SizedBox(height: 12),
          FilledButton.icon(
            icon: const Icon(Icons.phone_in_talk_outlined),
            onPressed: _busy ? null : _send,
            label: Text(tr('حفظ المتابعة', 'Save follow-up')),
          ),
        ]),
      ),
    );
  }
}
