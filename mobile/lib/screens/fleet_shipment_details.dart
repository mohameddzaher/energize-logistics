import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// تفاصيل الشحنة — the SAME detail view the web opens: full info, the status
/// control, the follow-up form, and the complete event history (إنشاء /
/// تغييرات الحالة / تغيير سائق / متابعات) as a timeline.
class FleetShipmentDetailsScreen extends StatefulWidget {
  final String shipmentId;
  const FleetShipmentDetailsScreen({super.key, required this.shipmentId});

  @override
  State<FleetShipmentDetailsScreen> createState() => _FleetShipmentDetailsScreenState();
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

const _eventMeta = {
  'created': ('أُنشئت الحمولة', 'Created', Icons.add_circle_outline, T.success),
  'status': ('تغيير حالة', 'Status change', Icons.swap_horiz_rounded, T.info),
  'driver_change': ('تغيير سائق', 'Driver change', Icons.badge_outlined, T.violet),
  'followup': ('متابعة', 'Follow-up', Icons.phone_in_talk_outlined, T.cyan),
  'updated': ('تعديل', 'Edited', Icons.edit_outlined, T.inkSoft),
};

class _FleetShipmentDetailsScreenState extends State<FleetShipmentDetailsScreen> {
  Map<String, dynamic>? _shipment;
  List<Map<String, dynamic>> _events = [];
  bool _loading = true;
  String? _error;
  final _location = TextEditingController();
  final _note = TextEditingController();
  bool _busy = false;
  late final void Function() _onLive;

  static const _quickNotes = [
    'في الطريق إلى موقع التنزيل', 'حمّل وتحرّك', 'نايم — استراحة', 'فاضي',
    'واقف — مشكلة على الطريق', 'وصل موقع التنزيل', 'جاري التفريغ',
  ];

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
      final d = await Api.instance.get('/api/fleet/shipments/${widget.shipmentId}');
      if (!mounted) return;
      setState(() {
        _shipment = d['shipment'] as Map<String, dynamic>?;
        _events = List<Map<String, dynamic>>.from(d['events'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _setStatus(String v) async {
    try {
      await Api.instance.patch('/api/fleet/shipments/${widget.shipmentId}/status', {'status': v});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _sendFollowUp() async {
    if ((_location.text.trim().isEmpty && _note.text.trim().isEmpty) || _busy) return;
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/fleet/shipments/${widget.shipmentId}/followups', {
        'currentLocation': _location.text,
        'note': _note.text,
      });
      _location.clear();
      _note.clear();
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _dt(String? v) {
    final d = v != null ? DateTime.tryParse(v)?.toLocal() : null;
    if (d == null) return '—';
    return '${d.day}/${d.month} ${d.hour}:${d.minute.toString().padLeft(2, '0')}';
  }

  String _eventText(Map<String, dynamic> e) {
    final data = e['data'] as Map<String, dynamic>? ?? {};
    switch (e['type']) {
      case 'created':
        return tr('بوليصة رقم ${data['waybillNumber'] ?? ''}', 'Waybill ${data['waybillNumber'] ?? ''}');
      case 'status':
        final st = _statuses[data['to'] ?? data['status']];
        return st != null ? tr('إلى «${st.$1}»', 'To "${st.$2}"') : (data['to'] ?? '').toString();
      case 'followup':
        return [
          if ((data['currentLocation'] ?? '').toString().isNotEmpty) '${tr('الموقع', 'Location')}: ${data['currentLocation']}',
          if ((data['note'] ?? '').toString().isNotEmpty) data['note'].toString(),
        ].join(' — ');
      case 'driver_change':
        return (data['text'] ?? '').toString();
      default:
        return (data['text'] ?? data['note'] ?? '').toString();
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _shipment;
    final st = s != null ? (_statuses[s['status']] ?? ('—', '—', T.inkFaint)) : ('—', '—', T.inkFaint);
    return Scaffold(
      appBar: AppBar(title: Text(s != null ? '${tr('بوليصة', 'Waybill')} ${s['waybillNumber'] ?? ''}' : tr('تفاصيل الشحنة', 'Shipment'))),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 140), SizedBox(height: 10), Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 260),
            ])
          : _error != null || s == null
              ? ErrorRetry(message: _error ?? '—', onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(14),
                    children: [
                      // بطاقة المعلومات الرئيسية
                      FadeSlideIn(
                        child: AppCard(
                          topAccent: st.$3,
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Text('${s['fromCity'] ?? '—'} ← ${s['toCity'] ?? '—'}',
                                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                              const Spacer(),
                              Chip2(tr(st.$1, st.$2), st.$3),
                            ]),
                            const SizedBox(height: 10),
                            Wrap(spacing: 6, runSpacing: 6, children: [
                              if ((s['customerName'] ?? '').toString().isNotEmpty)
                                Chip2(s['customerName'], T.navy, icon: Icons.people_outline),
                              if ((s['vehiclePlate'] ?? '').toString().isNotEmpty)
                                Chip2(s['vehiclePlate'], T.cyan, icon: Icons.local_shipping_outlined),
                              if ((s['driverName'] ?? '').toString().isNotEmpty)
                                Chip2(s['driverName'], T.inkSoft, icon: Icons.person_outline),
                              if ((s['supervisorName'] ?? '').toString().isNotEmpty)
                                Chip2('${tr('المشرف', 'Supervisor')}: ${s['supervisorName']}', T.violet, icon: Icons.supervisor_account_outlined),
                              if (s['loadDate'] != null)
                                Chip2('${tr('التحميل', 'Load')}: ${_dt(s['loadDate'])}', T.info, icon: Icons.event_outlined),
                              if (s['expectedArrival'] != null)
                                Chip2('${tr('الوصول المتوقع', 'ETA')}: ${_dt(s['expectedArrival'])}', T.warn, icon: Icons.schedule_outlined),
                            ]),
                            if ((s['notes'] ?? '').toString().isNotEmpty) ...[
                              const SizedBox(height: 8),
                              Text(s['notes'], style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                            ],
                            const SizedBox(height: 12),
                            DropdownButtonFormField<String>(
                              initialValue: (s['status'] ?? '').toString().isEmpty ? null : s['status'],
                              decoration: InputDecoration(labelText: tr('تغيير الحالة', 'Change status')),
                              items: _statuses.entries
                                  .map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2))))
                                  .toList(),
                              onChanged: (v) { if (v != null) _setStatus(v); },
                            ),
                          ]),
                        ),
                      ),
                      const SizedBox(height: 12),
                      // تسجيل متابعة
                      FadeSlideIn(
                        delayMs: 80,
                        child: AppCard(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
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
                            const SizedBox(height: 10),
                            FilledButton.icon(
                              icon: const Icon(Icons.phone_in_talk_outlined),
                              onPressed: _busy ? null : _sendFollowUp,
                              label: Text(tr('حفظ المتابعة', 'Save follow-up')),
                            ),
                          ]),
                        ),
                      ),
                      const SizedBox(height: 12),
                      // سجل الأحداث الكامل — نفس هيستوري السيستم.
                      FadeSlideIn(
                        delayMs: 140,
                        child: AppCard(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              const Icon(Icons.history_rounded, size: 18, color: T.navy),
                              const SizedBox(width: 6),
                              Text(tr('سجل الأحداث', 'Event history'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                              const Spacer(),
                              Chip2('${_events.length}', T.navy),
                            ]),
                            const SizedBox(height: 12),
                            if (_events.isEmpty)
                              Text(tr('لا توجد أحداث بعد', 'No events yet'), style: const TextStyle(color: T.inkFaint, fontSize: 13)),
                            ..._events.map((e) {
                              final meta = _eventMeta[e['type']] ?? _eventMeta['updated']!;
                              final isLast = e == _events.last;
                              return IntrinsicHeight(
                                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Column(children: [
                                    Container(
                                      padding: const EdgeInsets.all(6),
                                      decoration: BoxDecoration(
                                        color: meta.$4.withValues(alpha: 0.12),
                                        shape: BoxShape.circle,
                                      ),
                                      child: Icon(meta.$3, size: 15, color: meta.$4),
                                    ),
                                    if (!isLast)
                                      Expanded(child: Container(width: 2, color: const Color(0xFFE8EDF4))),
                                  ]),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Padding(
                                      padding: const EdgeInsets.only(bottom: 14),
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Text(tr(meta.$1, meta.$2), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                                          const Spacer(),
                                          Text(_dt(e['createdAt']), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                        ]),
                                        if (_eventText(e).isNotEmpty)
                                          Text(_eventText(e), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                                        if ((e['byName'] ?? '').toString().isNotEmpty)
                                          Text(e['byName'], style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                      ]),
                                    ),
                                  ),
                                ]),
                              );
                            }),
                          ]),
                        ),
                      ),
                    ],
                  ),
                ),
    );
  }
}
