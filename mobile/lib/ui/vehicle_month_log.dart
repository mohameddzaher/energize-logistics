import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import 'theme.dart';
import 'widgets.dart';

/// سجلّ السيّارة الشهريّ — بطاقةٌ واحدة تُقرأ في موضعين، كما في الويب.
///
/// متابعةُ الحمولة تجيب «أين هذه الشحنة الآن». وهذا يجيب السؤال الآخر: ماذا
/// جرى لهذه السيّارة هذا الشهر — عطلٌ يوم ٩، إطارٌ يوم ١٤، وستُّ حمولاتٍ
/// بينها. والشهرُ يُقفل مع أوّل الشهر التالي: حقيقةٌ عن الزمن لا خانةٌ يضغطها
/// أحد، فما أُضيف بعد الإقفال يظهر موسومًا «قيد متأخّر» ولا يُدَسّ.

const kindMeta = <String, (String, String, IconData, Color)>{
  'load': ('حمولة', 'Load', Icons.local_shipping_outlined, T.success),
  'breakdown': ('عطل', 'Breakdown', Icons.warning_amber_rounded, T.danger),
  'maintenance': ('صيانة', 'Maintenance', Icons.build_outlined, T.warn),
  'tire': ('إطارات', 'Tyres', Icons.trip_origin, T.inkSoft),
  'fuel': ('وقود', 'Fuel', Icons.local_gas_station_outlined, T.info),
  'accident': ('حادث', 'Accident', Icons.car_crash_outlined, T.danger),
  'violation': ('مخالفة', 'Violation', Icons.gavel_rounded, T.danger),
  'driver': ('تغيير سائق', 'Driver change', Icons.badge_outlined, T.violet),
  'idle': ('توقّف', 'Idle', Icons.pause_circle_outline, T.inkFaint),
  'note': ('ملاحظة', 'Note', Icons.sticky_note_2_outlined, T.warn),
  'event:followup': ('متابعة', 'Follow-up', Icons.phone_in_talk_outlined, T.cyan),
  'event:status': ('تغيير حالة', 'Status change', Icons.swap_horiz_rounded, T.info),
  'event:created': ('أُنشئت الحمولة', 'Created', Icons.add_circle_outline, T.success),
  'event:updated': ('تعديل', 'Edited', Icons.edit_outlined, T.inkSoft),
  'event:driver_change': ('تغيير سائق', 'Driver change', Icons.badge_outlined, T.violet),
};

String monthKeyNow() {
  final d = DateTime.now();
  return '${d.year}-${d.month.toString().padLeft(2, '0')}';
}

class VehicleMonthLog extends StatefulWidget {
  final String vehicle;        // اللوحة أو المعرّف
  final String? month;         // YYYY-MM
  final String? from;
  final String? to;
  final String? date;
  final bool canEdit;
  final String? shipmentId;    // لربط القيد بالحمولة المفتوحة
  const VehicleMonthLog({
    super.key,
    required this.vehicle,
    this.month,
    this.from,
    this.to,
    this.date,
    this.canEdit = false,
    this.shipmentId,
  });

  @override
  State<VehicleMonthLog> createState() => _VehicleMonthLogState();
}

class _VehicleMonthLogState extends State<VehicleMonthLog> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  bool _saving = false;

  String get _query {
    final q = <String, String>{'vehicle': widget.vehicle};
    if ((widget.date ?? '').isNotEmpty) {
      q['date'] = widget.date!;
    } else if ((widget.from ?? '').isNotEmpty || (widget.to ?? '').isNotEmpty) {
      if ((widget.from ?? '').isNotEmpty) q['from'] = widget.from!;
      if ((widget.to ?? '').isNotEmpty) q['to'] = widget.to!;
    } else {
      q['month'] = widget.month ?? monthKeyNow();
    }
    return q.entries.map((e) => '${e.key}=${Uri.encodeComponent(e.value)}').join('&');
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant VehicleMonthLog old) {
    super.didUpdateWidget(old);
    if (old.vehicle != widget.vehicle || old.month != widget.month ||
        old.from != widget.from || old.to != widget.to || old.date != widget.date) {
      setState(() => _loading = true);
      _load();
    }
  }

  Future<void> _load() async {
    if (widget.vehicle.isEmpty) { if (mounted) setState(() => _loading = false); return; }
    try {
      final d = await Api.instance.get('/api/fleet/vehicle-logs?$_query');
      if (!mounted) return;
      setState(() { _d = Map<String, dynamic>.from(d as Map); _loading = false; });
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  num _n(dynamic v) => v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  String _money(dynamic v) => _n(v).toStringAsFixed(0)
      .replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
  String _dt(dynamic v) {
    final d = DateTime.tryParse(v?.toString() ?? '')?.toLocal();
    if (d == null) return '—';
    String p(int n) => n.toString().padLeft(2, '0');
    return '${p(d.day)}/${p(d.month)} ${p(d.hour)}:${p(d.minute)}';
  }

  Future<void> _add() async {
    final kinds = List<Map<String, dynamic>>.from(
        (_d?['kinds'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
    if (kinds.isEmpty) return;
    String kind = 'breakdown';
    bool link = widget.shipmentId != null;
    final text = TextEditingController();
    final location = TextEditingController();
    final cost = TextEditingController();
    DateTime at = DateTime.now();

    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(
        builder: (c, setSt) => SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(tr('قيد جديد في سجلّ السيّارة', 'New vehicle-log entry'),
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: kind,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: tr('النوع', 'Kind')),
                  items: kinds.map((k) => DropdownMenuItem(
                    value: k['key'] as String,
                    child: Text(tr('${k['ar']}', '${k['en']}')),
                  )).toList(),
                  onChanged: (v) => setSt(() => kind = v ?? 'note'),
                ),
                const SizedBox(height: 10),
                InkWell(
                  onTap: () async {
                    final d = await showDatePicker(
                      context: c, initialDate: at,
                      firstDate: DateTime(at.year - 2), lastDate: DateTime(at.year + 1),
                    );
                    if (d != null) setSt(() => at = DateTime(d.year, d.month, d.day, at.hour, at.minute));
                  },
                  child: InputDecorator(
                    decoration: InputDecoration(labelText: tr('وقت الحدث', 'When it happened')),
                    child: Text('${at.year}-${at.month.toString().padLeft(2, '0')}-${at.day.toString().padLeft(2, '0')}'),
                  ),
                ),
                const SizedBox(height: 10),
                TextField(controller: text, maxLines: 2, decoration: InputDecoration(labelText: tr('ماذا حدث', 'What happened'))),
                const SizedBox(height: 10),
                TextField(controller: location, decoration: InputDecoration(labelText: tr('الموقع', 'Location'))),
                const SizedBox(height: 10),
                TextField(controller: cost, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('التكلفة (ر.س)', 'Cost (SAR)'))),
                if (widget.shipmentId != null) ...[
                  const SizedBox(height: 6),
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    controlAffinity: ListTileControlAffinity.leading,
                    value: link,
                    onChanged: (v) => setSt(() => link = v ?? false),
                    title: Text(tr('اربط القيد بهذه الحمولة', 'Link to the open shipment'),
                        style: const TextStyle(fontSize: 12.5)),
                  ),
                ],
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
                ),
              ]),
            ),
          ),
        ),
      ),
    );
    if (ok != true) return;
    if (text.text.trim().isEmpty) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('اكتب ما حدث', 'Say what happened'))));
      return;
    }
    setState(() => _saving = true);
    try {
      final r = await Api.instance.post('/api/fleet/vehicle-logs', {
        'vehicle': widget.vehicle,
        'kind': kind,
        'at': at.toUtc().toIso8601String(),
        'text': text.text.trim(),
        'location': location.text.trim(),
        'cost': num.tryParse(cost.text) ?? 0,
        if (widget.shipmentId != null && link) 'shipment': widget.shipmentId,
      });
      if (mounted && (r is Map && r['lateEntry'] == true)) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(tr('أُضيف كقيدٍ متأخّر — شهرُه مقفل', 'Added as a late entry — its month is closed'))));
      }
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _delete(Map<String, dynamic> row) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف القيد', 'Delete entry')),
        content: Text('${row['text'] ?? ''}'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/fleet/vehicle-logs/${row['id']}');
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const AppCard(child: SizedBox(height: 120, child: Center(child: CircularProgressIndicator(strokeWidth: 2))));
    final d = _d;
    if (d == null) return const SizedBox.shrink();

    final timeline = List<Map<String, dynamic>>.from(
        (d['timeline'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
    final s = Map<String, dynamic>.from(d['summary'] ?? {});
    final period = Map<String, dynamic>.from(d['period'] ?? {});
    final closed = d['closed'] == true;
    final plate = (d['vehicle']?['plate'] ?? widget.vehicle).toString();

    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.history_rounded, size: 18, color: T.navy),
          const SizedBox(width: 6),
          Expanded(
            child: Text(tr('السجلّ الكامل للسيّارة', 'Full vehicle log'),
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          ),
          Chip2('$plate · ${period['label'] ?? ''}', T.navy),
        ]),
        if (closed)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Row(children: [
              const Icon(Icons.lock_outline, size: 14, color: T.inkFaint),
              const SizedBox(width: 4),
              Text(tr('هذا الشهر مقفل', 'This month is closed'),
                  style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            ]),
          ),
        const SizedBox(height: 10),
        Wrap(spacing: 8, runSpacing: 8, children: [
          _stat(tr('حمولات', 'Loads'), '${s['loads'] ?? 0}'),
          _stat(tr('الدخل', 'Income'), _money(s['income'])),
          _stat(tr('مصروف السائق', 'Driver exp.'), _money(s['driverExpense'])),
          _stat(tr('تكلفة السجلّ', 'Log cost'), _money(s['logCost'])),
          _stat(tr('الصافي', 'Net'), _money(s['net'])),
        ]),
        if (widget.canEdit) ...[
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _saving ? null : _add,
              icon: const Icon(Icons.add, size: 16),
              label: Text(tr('إضافة قيد', 'Add entry')),
            ),
          ),
        ],
        const SizedBox(height: 10),
        if (timeline.isEmpty)
          Text(tr('لا شيء مسجَّل على هذه السيّارة في هذه الفترة.', 'Nothing recorded for this vehicle in this period.'),
              style: const TextStyle(color: T.inkFaint, fontSize: 12.5))
        else
          ...timeline.map((r) {
            final meta = kindMeta[r['kind']] ?? kindMeta['note']!;
            return Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(color: meta.$4.withValues(alpha: 0.12), shape: BoxShape.circle),
                  child: Icon(meta.$3, size: 15, color: meta.$4),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Text(tr(meta.$1, meta.$2), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
                      if (r['waybillNumber'] != null) ...[
                        const SizedBox(width: 6),
                        Text('#${r['waybillNumber']}', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.orange)),
                      ],
                      if (r['lateEntry'] == true) ...[
                        const SizedBox(width: 6),
                        const Icon(Icons.schedule, size: 12, color: T.inkFaint),
                      ],
                      const Spacer(),
                      Text(_dt(r['at']), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                    ]),
                    if ((r['text'] ?? '').toString().isNotEmpty)
                      Text('${r['text']}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                    Row(children: [
                      if ((r['location'] ?? '').toString().isNotEmpty)
                        Text('${r['location']}  ', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                      if (_n(r['cost']) != 0)
                        Text('${tr('التكلفة', 'Cost')} ${_money(r['cost'])}  ', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                      if ((r['byName'] ?? '').toString().isNotEmpty)
                        Expanded(child: Text('${r['byName']}', style: const TextStyle(fontSize: 11, color: T.inkFaint), overflow: TextOverflow.ellipsis)),
                    ]),
                  ]),
                ),
                if (widget.canEdit && r['source'] == 'entry' && !closed)
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.delete_outline, size: 18, color: T.danger),
                    onPressed: () => _delete(r),
                  ),
              ]),
            );
          }),
      ]),
    );
  }

  Widget _stat(String label, String value) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(color: const Color(0xFFF4F7FB), borderRadius: BorderRadius.circular(10)),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
      Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
    ]),
  );
}
