import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/tire_sensor_badge.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'ls2_common.dart';
import 'ls2_vehicle_detail.dart';

/// الأسطول المباشر — نظيرُ /system/ls2/live: كلُّ شاحنةٍ بحالتها وسرعتها
/// وأسخن فردة وحرارة الموتور والعداد و«كم في الفترة»، مع فلتر الحالة
/// (يتحرك/خامل/متوقف/غير متصل) والفترة والبحث — حيٌّ على ls2:updated.
class Ls2LiveScreen extends StatefulWidget {
  final String status;
  const Ls2LiveScreen({super.key, this.status = ''});
  @override
  State<Ls2LiveScreen> createState() => _Ls2LiveScreenState();
}

class _Ls2LiveScreenState extends State<Ls2LiveScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;
  late String _status = widget.status;
  String _q = '';
  DateTimeRange _range = ls2ThisMonthToDate();
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = _load;
    Live.instance.on('ls2:updated', _onLive);
  }

  @override
  void dispose() { Live.instance.off('ls2:updated', _onLive); super.dispose(); }

  Future<void> _load() async {
    final seq = ++_seq;
    try {
      final qs = [if (_status.isNotEmpty) 'status=$_status', 'from=${ls2Ymd(_range.start)}', 'to=${ls2Ymd(_range.end)}'].join('&');
      final d = await Api.instance.get('/api/ls2/vehicles?$qs');
      if (!mounted || seq != _seq) return;
      setState(() { _items = ls2List(d['items']); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && seq == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  List<Map<String, dynamic>> get _filtered {
    final s = _q.trim().toLowerCase();
    if (s.isEmpty) return _items;
    return _items.where((v) => '${v['plate']} ${v['driver']} ${v['name']} ${ls2Map(v['profile'])['brand'] ?? ''} ${ls2Map(v['profile'])['vin'] ?? ''}'.toLowerCase().contains(s)).toList();
  }

  static final _cols = [
    ExportCol('اللوحة', 'Plate', (r) => r['plate'] ?? r['name'] ?? ''),
    ExportCol('السائق', 'Driver', (r) => r['driver'] ?? ''),
    ExportCol('الحالة', 'Status', (r) { final st = ls2Status(r['status']); return tr(st.$1, st.$2); }),
    ExportCol('السرعة كم/س', 'Speed km/h', (r) => r['speed'] ?? ''),
    ExportCol('العداد كم', 'Odometer km', (r) => r['odometerKm'] ?? ''),
    ExportCol('كم في الفترة', 'Km in period', (r) => ls2Num(r['periodKm'])?.round() ?? ''),
    ExportCol('ساعات الموتور', 'Engine hours', (r) => r['engineHours'] ?? ''),
    ExportCol('الوقود %', 'Fuel %', (r) => r['fuelPct'] ?? ''),
    ExportCol('حرارة الموتور', 'Coolant °C', (r) => r['coolantC'] ?? ''),
    ExportCol('أقصى حرارة كاوتش', 'Max tire temp °C', (r) => r['maxTireTempC'] ?? ''),
    ExportCol('حساسات الكاوتش (يعمل/بدون/استبن)', 'Tire sensors (ok/none/spare)', (r) => ls2Map(r['tireSensors'])['label'] ?? ''),
    ExportCol('حساس مركّب لا يبثّ', 'Fitted but silent', (r) => ls2Map(r['tireSensors'])['silent'] ?? ''),
    ExportCol('الوزن كجم', 'Weight kg', (r) => r['weightKg'] ?? ''),
    ExportCol('تنبيهات مفتوحة', 'Open alerts', (r) => r['activeAlertCount'] ?? ''),
    ExportCol('آخر إشارة', 'Last signal', (r) => ls2DateTime(r['lastMessageAt'])),
  ];

  Color _coolant(dynamic c) {
    final n = ls2Num(c);
    if (n == null) return T.inkFaint;
    if (n >= 110) return T.danger;
    if (n >= 100) return T.warn;
    return T.inkSoft;
  }

  Color _tireTemp(dynamic c) {
    final n = ls2Num(c);
    if (n == null) return T.inkFaint;
    if (n >= 85) return T.danger;
    if (n >= 75) return T.warn;
    return T.success;
  }

  @override
  Widget build(BuildContext context) {
    final rows = _filtered;
    final totalKm = _items.fold<num>(0, (a, v) => a + (ls2Num(v['periodKm']) ?? 0));
    return AppScaffold(
      title: Text(tr('الأسطول المباشر', 'Live Fleet')),
      actions: [
        IconButton(
          tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined),
          onPressed: () => ls2ExportMenu(context, fileName: 'ls2-live-fleet', options: [
            ('كل العربيات', 'All vehicles', [(tr('كل العربيات', 'All vehicles'), _cols, _items)]),
            ('النتائج الحالية (بعد الفلتر)', 'Current filtered results', [(tr('النتائج الحالية', 'Filtered results'), _cols, rows)]),
          ]),
        ),
      ],
      body: Column(children: [
        const SizedBox(height: 8),
        // الفترةُ تحكم عمود «كم في الفترة» (عدّاد Wialon الحقيقيّ).
        Ls2RangeBar(value: _range, onChanged: (r) { setState(() { _range = r; _loading = true; }); _load(); }),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 4, 14, 0),
          child: Row(children: [
            const Icon(Icons.route_outlined, size: 15, color: T.orange),
            const SizedBox(width: 4),
            Text('${tr('إجمالي المسافة', 'Total distance')}: ${ls2Km(totalKm)}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
          child: SearchField(hint: tr('بحث…', 'Search…'), dense: true, suffixText: '${rows.length}', onChanged: (v) => setState(() => _q = v)),
        ),
        SizedBox(
          height: 46,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(14, 6, 14, 0), children: [
            for (final s in ['', 'moving', 'idle', 'stopped', 'offline'])
              Padding(
                padding: const EdgeInsetsDirectional.only(end: 6),
                child: ChoiceChip(
                  selected: _status == s, showCheckmark: false,
                  label: Text(s.isEmpty ? tr('الكل', 'All') : tr(ls2Status(s).$1, ls2Status(s).$2)),
                  selectedColor: T.orange,
                  labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _status == s ? Colors.white : T.navy),
                  onSelected: (_) { setState(() { _status = s; _loading = true; }); _load(); },
                ),
              ),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 2, 14, 0),
          child: Text(tr('يتحرك = أثناء السير · خامل = المحرك يعمل والمركبة متوقفة · متوقف = المحرك متوقف · غير متصل = لا توجد إشارة',
                  'Moving = driving · Idle = engine on, stationary · Stopped = engine off · Offline = no signal'),
              style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
        ),
        Expanded(
          child: _loading && _items.isEmpty
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer()])
              : _error != null && _items.isEmpty
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.satellite_alt_outlined, title: _q.trim().isNotEmpty ? tr('لا نتائج مطابقة للبحث', 'No matches') : tr('لا توجد بيانات', 'No data'))])
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              padding: const EdgeInsets.all(14),
                              itemCount: rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) => _row(rows[i]),
                            ),
                    ),
        ),
      ]),
    );
  }

  Widget _row(Map<String, dynamic> v) {
    final st = ls2Status(v['status']);
    final prof = ls2Map(v['profile']);
    final pos = ls2Map(v['position']);
    final kmTo = ls2Num(v['kmToService']);
    return Pressable(
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => Ls2VehicleDetailScreen(vehicleId: '${v['unitId']}', plate: '${v['plate'] ?? v['name'] ?? ''}'))),
      child: AppCard(
        topAccent: st.$3,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${v['plate'] ?? v['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              if ((prof['brand'] ?? '').toString().isNotEmpty)
                Text('${prof['brand']}${(prof['modelYear'] ?? '').toString().isNotEmpty ? ' · ${prof['modelYear']}' : ''}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
            ])),
            Chip2(tr(st.$1, st.$2), st.$3),
            if (pos['lat'] != null && pos['lng'] != null)
              IconButton(
                tooltip: tr('فتح على الخريطة', 'Open in map'),
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.place_outlined, color: T.orange),
                onPressed: () => launchUrl(Uri.parse('https://www.openstreetmap.org/?mlat=${pos['lat']}&mlon=${pos['lng']}#map=15/${pos['lat']}/${pos['lng']}'), mode: LaunchMode.externalApplication),
              ),
          ]),
          Text('${v['driver'] ?? '—'} · ${ls2TimeAgo(v['lastMessageAt'])}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            if (v['speed'] != null) Chip2('${v['speed']} km/h', T.navy, icon: Icons.speed),
            if (v['maxTireTempC'] != null) Chip2('${v['maxTireTempC']}° / ${v['minTireTempC'] ?? '—'}°', _tireTemp(v['maxTireTempC']), icon: Icons.thermostat),
            if (v['maxTirePressurePsi'] != null)
              Chip2('${v['maxTirePressurePsi']} / ${v['minTirePressurePsi'] ?? '—'} psi', (ls2Num(v['minTirePressurePsi']) ?? 999) < 90 ? T.danger : T.inkSoft),
            if (v['tireSensors'] is Map)
              TireSensorBadge(cov: ls2Map(v['tireSensors']), plate: '${v['plate'] ?? v['name'] ?? ''}', unitId: ls2Num(v['unitId'])?.toInt()),
            if (v['coolantC'] != null) Chip2('${tr('الموتور', 'Engine')} ${v['coolantC']}°C', _coolant(v['coolantC'])),
            Chip2('${tr('العداد', 'Odo')}: ${ls2Km(v['odometerKm'])}', T.navy),
            if (v['periodKm'] != null) Chip2('${tr('في الفترة', 'Period')}: ${ls2Km(v['periodKm'])}', T.orange),
            if (kmTo != null)
              Chip2(kmTo < 0 ? '−${ls2Fmt(kmTo.abs())} ${tr('كم متأخرة', 'km over')}' : '${ls2Fmt(kmTo)} ${tr('كم للصيانة', 'km to service')}',
                  kmTo < 0 ? T.danger : v['maintenanceStatus'] == 'due' ? T.warn : T.inkSoft, icon: Icons.build_outlined),
          ]),
        ]),
      ),
    );
  }
}
