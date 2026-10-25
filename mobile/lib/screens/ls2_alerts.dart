import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'ls2_common.dart';

/// تنبيهات لوكيشن سوليوشن — the telemetry alerts feed with severity/type
/// filters, live over ls2:updated.
class Ls2AlertsScreen extends StatefulWidget {
  const Ls2AlertsScreen({super.key});
  @override
  State<Ls2AlertsScreen> createState() => _Ls2AlertsScreenState();
}

const _severities = {
  'critical': ('حرجة', 'Critical', T.danger),
  'warning': ('تحذير', 'Warning', T.warn),
  'info': ('معلومة', 'Info', T.info),
};

class _Ls2AlertsScreenState extends State<Ls2AlertsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _severity = '';
  String _status = 'open';
  String _type = '';
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('ls2:updated', _onLive);
    Live.instance.on('ls2:alert', _onLive); // تنبيهٌ جديدٌ أو مُقَرّ
  }

  @override
  void dispose() {
    Live.instance.off('ls2:updated', _onLive);
    Live.instance.off('ls2:alert', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final seq = ++_seq;
    try {
      final params = ['status=$_status', if (_severity.isNotEmpty) 'severity=$_severity', if (_type.isNotEmpty) 'type=$_type'];
      final d = await Api.instance.get('/api/ls2/alerts?${params.join('&')}');
      if (!mounted || seq != _seq) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['items'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _dt(dynamic v) {
    final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
    return d == null ? '—' : '${d.day}/${d.month} ${d.hour}:${d.minute.toString().padLeft(2, '0')}';
  }

  // تأكيد الاطلاع على التنبيه — يسمع فورًا في كل مكان عبر ls2:updated.
  Future<void> _ack(Map<String, dynamic> a) async {
    try {
      await Api.instance.patch('/api/ls2/alerts/${a['_id'] ?? a['id']}/ack');
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم تأكيد الاطلاع', 'Acknowledged'))));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  static String _dtFull(dynamic v) => v == null ? '—' : ls2DateTime(v);
  static final _cols = [
    ExportCol('اللوحة', 'Plate', (r) => r['plate'] ?? ''),
    ExportCol('السائق', 'Driver', (r) => (r['driver'] ?? '').toString().isEmpty ? '—' : r['driver']),
    ExportCol('نوع التنبيه', 'Alert type', (r) => ls2AlertType(r['type'])),
    ExportCol('الخطورة', 'Severity', (r) { final s = ls2Severity(r['severity']); return tr(s.$1, s.$2); }),
    const ExportCol('الرسالة', 'Message', ls2AlertMessage),
    ExportCol('القيمة', 'Value', (r) => r['value'] ?? '—'),
    ExportCol('الحد', 'Threshold', (r) => r['threshold'] ?? '—'),
    ExportCol('الوحدة', 'Unit', (r) => (r['unit'] ?? '').toString().isEmpty ? '—' : r['unit']),
    ExportCol('الحالة', 'Status', (r) => r['status'] == 'open' ? tr('مفتوح', 'open') : tr('مغلق', '${r['status'] ?? '—'}')),
    ExportCol('أول ظهور', 'First seen', (r) => _dtFull(r['firstSeenAt'])),
    ExportCol('آخر ظهور', 'Last seen', (r) => _dtFull(r['lastSeenAt'])),
    ExportCol('تم الإقرار', 'Acknowledged', (r) => _dtFull(r['acknowledgedAt'])),
  ];

  /// «المعروض» ما تحت الفلتر، و«الكل» نداءٌ ثانٍ بلا فلاتر — وإلّا خرج ملفُّ
  /// «المفتوحة فقط» وهو يُحسَب سجلَّ التنبيهات كلَّه.
  Future<void> _export() async {
    final filtersOn = _severity.isNotEmpty || _type.isNotEmpty || _status != 'all';
    if (!filtersOn) {
      await exportExcel(context, fileName: 'ls2-alerts', sheets: [(tr('التنبيهات', 'Alerts'), _cols, _rows)]);
      return;
    }
    final pick = await showModalBottomSheet<String>(context: context, builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      ListTile(leading: const Icon(Icons.filter_alt_outlined), title: Text(tr('المعروض حاليًا', 'Shown on screen')), onTap: () => Navigator.pop(c, 'shown')),
      ListTile(leading: const Icon(Icons.select_all), title: Text(tr('الكل', 'All')), onTap: () => Navigator.pop(c, 'all')),
    ])));
    if (pick == null || !mounted) return;
    var rows = _rows;
    if (pick == 'all') {
      try {
        final d = await Api.instance.get('/api/ls2/alerts?status=all');
        rows = List<Map<String, dynamic>>.from(d['items'] ?? []);
      } catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
        return;
      }
    }
    if (mounted) await exportExcel(context, fileName: 'ls2-alerts', sheets: [(tr('التنبيهات', 'Alerts'), _cols, rows)]);
  }

  static const _types = ['tire_temp', 'tire_pressure_low', 'tire_pressure_critical', 'tire_pressure_high', 'tire_imbalance', 'tire_fault', 'coolant_temp', 'rpm_high', 'fuel_low', 'overload', 'speeding', 'battery_low', 'idling', 'maintenance_due', 'maintenance_overdue', 'deferred_task', 'tire_sensor_change', 'offline'];

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('تنبيهات المركبات', 'Fleet Alerts')),
      actions: [
        // نوعُ التنبيه — كقائمة الأنواع في الموقع.
        PopupMenuButton<String>(
          tooltip: tr('نوع التنبيه', 'Alert type'),
          icon: Badge(isLabelVisible: _type.isNotEmpty, smallSize: 8, child: const Icon(Icons.category_outlined)),
          onSelected: (v) { setState(() { _type = v; _loading = true; }); _load(); },
          itemBuilder: (_) => [
            CheckedPopupMenuItem(value: '', checked: _type.isEmpty, child: Text(tr('كل الأنواع', 'All types'))),
            for (final k in _types) CheckedPopupMenuItem(value: k, checked: _type == k, child: Text(ls2AlertType(k))),
          ],
        ),
        // الحالة: مفتوحة / مغلقة / الكل.
        PopupMenuButton<String>(
          tooltip: tr('الحالة', 'Status'),
          icon: const Icon(Icons.filter_list),
          onSelected: (v) { setState(() { _status = v; _loading = true; }); _load(); },
          itemBuilder: (_) => [
            CheckedPopupMenuItem(value: 'open', checked: _status == 'open', child: Text(tr('مفتوحة', 'Open'))),
            CheckedPopupMenuItem(value: 'resolved', checked: _status == 'resolved', child: Text(tr('مغلقة', 'Resolved'))),
            CheckedPopupMenuItem(value: 'all', checked: _status == 'all', child: Text(tr('الكل', 'All'))),
          ],
        ),
        IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export),
      ],
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              FilterChip(
                selected: _status == 'open',
                onSelected: (_) { setState(() { _status = _status == 'open' ? 'all' : 'open'; _loading = true; }); _load(); },
                label: Text(tr('المفتوحة فقط', 'Open only')),
                labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _status == 'open' ? Colors.white : T.navy),
                selectedColor: T.navy,
                backgroundColor: T.navy.withValues(alpha: 0.08),
                checkmarkColor: Colors.white,
                side: BorderSide.none,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
              ),
              const SizedBox(width: 6),
              ..._severities.entries.map((e) {
                final selected = _severity == e.key;
                return Padding(
                  padding: const EdgeInsets.only(left: 6),
                  child: FilterChip(
                    selected: selected,
                    onSelected: (_) { setState(() { _severity = selected ? '' : e.key; _loading = true; }); _load(); },
                    label: Text(tr(e.value.$1, e.value.$2)),
                    labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : e.value.$3),
                    selectedColor: e.value.$3,
                    backgroundColor: e.value.$3.withValues(alpha: 0.1),
                    checkmarkColor: Colors.white,
                    side: BorderSide.none,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                  ),
                );
              }),
            ]),
          ),
        ),
        Expanded(
          child: _loading
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.notifications_off_outlined, title: tr('لا توجد تنبيهات 👌', 'No alerts 👌'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final a = _rows[i];
                                final sev = _severities[a['severity']] ?? _severities['info']!;
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  child: AppCard(
                                    topAccent: sev.$3,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text(ls2AlertType(a['type']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                        Chip2(tr(sev.$1, sev.$2), sev.$3),
                                      ]),
                                      if (ls2AlertMessage(a).isNotEmpty) ...[
                                        const SizedBox(height: 4),
                                        Text(ls2AlertMessage(a), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                                      ],
                                      const SizedBox(height: 6),
                                      Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                                        if ((a['plate'] ?? a['vehicleName'] ?? '').toString().isNotEmpty)
                                          Chip2((a['plate'] ?? a['vehicleName']).toString(), T.navy, icon: Icons.local_shipping_outlined),
                                        Chip2(_dt(a['createdAt'] ?? a['at'] ?? a['firstSeenAt']), T.inkFaint, icon: Icons.schedule_outlined),
                                        if (a['acknowledgedAt'] != null)
                                          Chip2('${tr('تم الاطلاع', 'Acked')} · ${_dt(a['acknowledgedAt'])}', T.success, icon: Icons.check_circle_outline),
                                      ]),
                                      // زر تأكيد الاطلاع للتنبيهات المفتوحة غير المؤكَّدة.
                                      if (a['acknowledgedAt'] == null && (a['status'] ?? 'open') != 'resolved') ...[
                                        const SizedBox(height: 6),
                                        Align(
                                          alignment: AlignmentDirectional.centerEnd,
                                          child: FilledButton.tonalIcon(
                                            style: FilledButton.styleFrom(minimumSize: const Size(0, 34), padding: const EdgeInsets.symmetric(horizontal: 14)),
                                            onPressed: () => _ack(a),
                                            icon: const Icon(Icons.check_rounded, size: 16),
                                            label: Text(tr('تأكيد الاطلاع', 'Acknowledge'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                                          ),
                                        ),
                                      ],
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
