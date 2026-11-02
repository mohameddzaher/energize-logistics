import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/report_button.dart';
import '../ui/theme.dart';
import '../ui/tire_states.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'ls2_common.dart';
import 'ls2_vehicle_assets.dart';
import 'ls2_vehicle_detail.dart';

/// Tires (TPMS), counterpart of /system/ls2/tires: pressure and temperature of every tire across the fleet, hottest first. Colors use the section thresholds from settings, not hardcoded numbers, so the screen and the alert never disagree about the same tire.
class Ls2TiresScreen extends StatefulWidget {
  const Ls2TiresScreen({super.key});
  @override
  State<Ls2TiresScreen> createState() => _Ls2TiresScreenState();
}

class _Ls2TiresScreenState extends State<Ls2TiresScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;
  String _chip = '';
  String _q = '';
  final Set<String> _open = {};
  final Map<String, num> _th = {'tirePressureMinPsi': 90, 'tirePressureCriticalPsi': 60, 'tirePressureMaxPsi': 150, 'tireTempC': 75, 'tireTempCriticalC': 85};
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _loadThresholds();
    // Settings changes are announced by the same event, so thresholds are re-read with it.
    _onLive = () { _load(); _loadThresholds(); };
    Live.instance.on('ls2:updated', _onLive);
  }

  @override
  void dispose() { Live.instance.off('ls2:updated', _onLive); super.dispose(); }

  Future<void> _loadThresholds() async {
    try {
      final r = await Api.instance.get('/api/ls2/settings');
      final t = ls2Map(r['thresholds'] ?? ls2Map(r['settings'])['thresholds']);
      if (t.isNotEmpty && mounted) {
        setState(() { for (final e in t.entries) { final n = ls2Num(e.value); if (n != null) _th[e.key] = n; } });
      }
    } catch (_) {/* Keep the defaults. */}
  }

  Future<void> _load() async {
    try {
      // Per-tire readings are requested explicitly; only this screen shows them.
      final d = await Api.instance.get('/api/ls2/vehicles?include=tires');
      if (mounted) setState(() { _items = ls2List(d['items']); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  bool _hot(Map<String, dynamic> v) => (ls2Num(v['maxTireTempC']) ?? -1) >= 75;
  bool _low(Map<String, dynamic> v) { final p = ls2Num(v['minTirePressurePsi']); return p != null && p < 90; }
  bool _faults(Map<String, dynamic> v) => (ls2Num(v['tireFaults']) ?? 0) > 0;

  late final _chips = <(String, String, String, Color, bool Function(Map<String, dynamic>))>[
    ('', 'الكل', 'All', T.navy, (_) => true),
    ('any', 'فيها مشكلة', 'Any problem', T.warn, (v) => _hot(v) || _low(v) || _faults(v)),
    ('hot', 'حرارة عالية', 'Hot', T.danger, _hot),
    ('low', 'ضغط منخفض', 'Low pressure', T.info, _low),
    ('faults', 'أعطال حساسات', 'Sensor faults', T.violet, _faults),
    ('ok', 'سليمة', 'Healthy', T.success, (v) => !_hot(v) && !_low(v) && !_faults(v)),
  ];

  Color _tempColor(dynamic t) {
    final n = ls2Num(t);
    if (n == null) return T.inkFaint;
    if (n >= (_th['tireTempCriticalC'] ?? 85)) return T.danger;
    if (n >= (_th['tireTempC'] ?? 75)) return T.warn;
    return T.success;
  }

  Color _pressColor(dynamic p) {
    final n = ls2Num(p);
    if (n == null || n <= 10) return T.inkFaint;
    if (n < (_th['tirePressureCriticalPsi'] ?? 60) || n > (_th['tirePressureMaxPsi'] ?? 150)) return T.danger;
    if (n < (_th['tirePressureMinPsi'] ?? 90)) return T.warn;
    return T.success;
  }

  List<Map<String, dynamic>> _flatten(List<Map<String, dynamic>> list) => [
        for (final v in list)
          for (final t in ls2List(v['tires']))
            {'plate': v['plate'] ?? v['name'], 'driver': v['driver'], 'axle': t['axle'], 'position': t['position'], 'tempC': t['tempC'], 'pressurePsi': t['pressurePsi'], 'fault': t['fault']},
      ];

  static final _tireCols = [
    ExportCol('اللوحة', 'Plate', (r) => r['plate'] ?? ''),
    ExportCol('السائق', 'Driver', (r) => r['driver'] ?? ''),
    ExportCol('المحور', 'Axle', (r) => r['axle'] ?? ''),
    ExportCol('الموقع', 'Position', (r) => r['position'] ?? ''),
    ExportCol('الحرارة °م', 'Temp °C', (r) => r['tempC'] ?? ''),
    ExportCol('الضغط psi', 'Pressure psi', (r) => r['pressurePsi'] ?? ''),
    ExportCol('عطل حساس', 'Sensor Fault', (r) => r['fault'] == true ? tr('نعم', 'Yes') : ''),
  ];
  static final _sumCols = [
    ExportCol('اللوحة', 'Plate', (r) => r['plate'] ?? r['name'] ?? ''),
    ExportCol('السائق', 'Driver', (r) => r['driver'] ?? ''),
    ExportCol('عدد الكاوتش', 'Tire Count', (r) => r['tireCount'] ?? ''),
    ExportCol('أقصى حرارة', 'Max Temp °C', (r) => r['maxTireTempC'] ?? ''),
    ExportCol('أقل حرارة', 'Min Temp °C', (r) => r['minTireTempC'] ?? ''),
    ExportCol('أقصى ضغط', 'Max Pressure psi', (r) => r['maxTirePressurePsi'] ?? ''),
    ExportCol('أقل ضغط', 'Min Pressure psi', (r) => r['minTirePressurePsi'] ?? ''),
    ExportCol('أعطال الحساسات', 'Sensor Faults', (r) => r['tireFaults'] ?? ''),
    ExportCol('ماركة الكاوتش', 'Tire Brand', (r) => r['tireBrand'] ?? ''),
  ];

  @override
  Widget build(BuildContext context) {
    final test = _chips.firstWhere((c) => c.$1 == _chip).$5;
    final q = _q.trim().toLowerCase();
    final rows = _items.where((v) => test(v) && (q.isEmpty || '${v['plate']} ${v['name']} ${v['driver']}'.toLowerCase().contains(q))).toList()
      ..sort((a, b) => (ls2Num(b['maxTireTempC']) ?? 0).compareTo(ls2Num(a['maxTireTempC']) ?? 0));
    return AppScaffold(
      title: Text(tr('الكاوتش', 'Tires')),
      actions: [
        IconButton(
          tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined),
          onPressed: () => ls2ExportMenu(context, fileName: 'ls2-tires', options: [
            ('كل الكاوتشات (سطر لكل فردة)', 'All tires (row per tire)', [(tr('الكاوتشات', 'Tires'), _tireCols, _flatten(_items))]),
            ('ملخص لكل عربية', 'Per-vehicle summary', [(tr('ملخص المركبات', 'Vehicles'), _sumCols, _items)]),
            ('العرض الحالي (المصفّى)', 'Current view (filtered)', [(tr('العرض الحالي', 'Filtered'), _tireCols, _flatten(rows))]),
          ]),
        ),
      ],
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
          child: SearchField(hint: tr('لوحة أو سائق…', 'Plate or driver…'), dense: true, suffixText: '${rows.length}/${_items.length}', onChanged: (v) => setState(() => _q = v)),
        ),
        SizedBox(
          height: 46,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(14, 6, 14, 0), children: [
            for (final c in _chips)
              Padding(
                padding: const EdgeInsetsDirectional.only(end: 6),
                child: FilterChip(
                  selected: _chip == c.$1,
                  onSelected: (_) => setState(() => _chip = c.$1),
                  label: Text('${tr(c.$2, c.$3)} (${_items.where(c.$5).length})'),
                  labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _chip == c.$1 ? Colors.white : c.$4),
                  selectedColor: c.$4, backgroundColor: c.$4.withValues(alpha: 0.1), checkmarkColor: Colors.white, side: BorderSide.none,
                ),
              ),
          ]),
        ),
        Expanded(
          child: _loading
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer()])
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.tire_repair_outlined, title: q.isNotEmpty ? tr('لا نتائج مطابقة للبحث', 'No matches') : tr('لا توجد بيانات', 'No data'))])
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
    final id = '${v['unitId']}';
    final open = _open.contains(id);
    return Pressable(
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => Ls2VehicleDetailScreen(vehicleId: id, plate: '${v['plate'] ?? v['name'] ?? ''}'))),
      child: AppCard(
        topAccent: _tempColor(v['maxTireTempC']),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text('${v['plate'] ?? v['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
            Text('${v['driver'] ?? '—'}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            IconButton(
              visualDensity: VisualDensity.compact,
              tooltip: tr('توزيع المحاور', 'Axle layout'),
              icon: Icon(open ? Icons.expand_less : Icons.expand_more),
              onPressed: () => setState(() => open ? _open.remove(id) : _open.add(id)),
            ),
          ]),
          Wrap(spacing: 6, runSpacing: 6, children: [
            Chip2('${tr('الكاوتش', 'Tires')}: ${v['tireCount'] ?? 0}', T.navy),
            if (v['maxTireTempC'] != null) Chip2('${tr('أقصى حرارة', 'Max temp')}: ${v['maxTireTempC']}°C', _tempColor(v['maxTireTempC']), icon: Icons.thermostat),
            if (v['minTirePressurePsi'] != null) Chip2('${tr('أقل ضغط', 'Min')}: ${v['minTirePressurePsi']} psi', _pressColor(v['minTirePressurePsi'])),
            if (v['maxTirePressurePsi'] != null) Chip2('${tr('أقصى ضغط', 'Max')}: ${v['maxTirePressurePsi']} psi', _pressColor(v['maxTirePressurePsi'])),
            if (_faults(v)) Chip2('${tr('أعطال', 'Faults')}: ${v['tireFaults']}', T.inkSoft, icon: Icons.warning_amber_rounded),
          ]),
          if (open) ...[const SizedBox(height: 8), _layout(ls2List(v['tires']))],
        ]),
      ),
    );
  }

  Widget _layout(List<Map<String, dynamic>> tires) {
    if (tires.isEmpty) return Text(tr('لا توجد بيانات كاوتش', 'No tire data'), style: const TextStyle(color: T.inkFaint, fontSize: 12));
    final axles = tires.map((t) => ls2Num(t['axle']) ?? 0).toSet().toList()..sort();
    return Column(children: [
      for (final ax in axles)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 58, child: Text('${tr('محور', 'Axle')} $ax', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.inkFaint))),
            Expanded(child: Wrap(spacing: 6, runSpacing: 6, children: [
              for (final t in (tires.where((t) => (ls2Num(t['axle']) ?? 0) == ax).toList()..sort((a, b) => (ls2Num(a['position']) ?? 0).compareTo(ls2Num(b['position']) ?? 0))))
                Container(
                  width: 82,
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  decoration: BoxDecoration(
                    color: (t['fault'] == true ? T.inkFaint : _tempColor(t['tempC'])).withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Column(children: [
                    Text('${tr('إطار', 'Tire')} ${t['position']}', style: const TextStyle(fontSize: 10, color: T.inkFaint)),
                    Text(t['fault'] == true ? tr('عطل', 'Fault') : (t['tempC'] != null ? '${t['tempC']}°C' : '—'),
                        style: TextStyle(fontWeight: FontWeight.w800, color: t['fault'] == true ? T.inkFaint : _tempColor(t['tempC']))),
                    Text(t['pressurePsi'] != null ? '${t['pressurePsi']} psi' : '—', style: const TextStyle(fontSize: 10.5)),
                  ]),
                ),
            ])),
          ]),
        ),
    ]);
  }
}

// Tire life, counterpart of /system/ls2/tires/[id]

const _actionAr = {
  'registered': 'تسجيل', 'mounted': 'تركيب', 'removed': 'إنزال', 'transferred': 'نقل',
  'to_repair': 'إلى التجديد', 'from_repair': 'عودة من التجديد', 'renewed': 'تجديد',
  'scrapped': 'سكراب', 'damaged': 'تالفة', 'sold': 'بيع', 'retired': 'خارج الخدمة', 'updated': 'تعديل',
};
const _endAr = {
  'removed': 'نزلت', 'transferred': 'نُقلت', 'to_repair': 'ذهبت للتجديد',
  'scrapped': 'سكراب', 'damaged': 'تلفت', 'sold': 'بيعت', 'retired': 'خرجت',
};

String _day(dynamic d) => d == null ? '—' : (DateTime.tryParse('$d')?.toUtc().toIso8601String().substring(0, 10) ?? '—');

/// The question is not where it is now but how long it lived, on what, and how far it ran. Mount periods come from the movement log, kilometers from the vehicle odometer at mount and dismount, and events on the vehicle while it was mounted are attributed to the tire.
class Ls2TireProfileScreen extends StatefulWidget {
  final String tireId;
  final String? serial;
  const Ls2TireProfileScreen({super.key, required this.tireId, this.serial});
  @override
  State<Ls2TireProfileScreen> createState() => _Ls2TireProfileScreenState();
}

class _Ls2TireProfileScreenState extends State<Ls2TireProfileScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
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
    try {
      final d = await Api.instance.get('/api/ls2/assets/tires/${widget.tireId}/profile');
      if (mounted) setState(() { _d = ls2Map(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  /// Vehicle page by unit number; a vehicle outside tracking opens its assets by plate.
  void _openVehicle(dynamic unitId, String plate) {
    Navigator.push(context, MaterialPageRoute(builder: (_) => unitId != null
        ? Ls2VehicleDetailScreen(vehicleId: '$unitId', plate: plate)
        : Ls2VehicleAssetsScreen(plate: plate)));
  }

  Future<void> _export() async {
    final d = _d!;
    final ti = ls2Map(d['tire']);
    final stints = ls2List(d['stints']).map((s) => <String, dynamic>{
          'plate': s['plate'] ?? '—', 'position': s['position'] ?? '—',
          'from': _day(s['from']), 'to': s['to'] != null ? _day(s['to']) : tr('حتى الآن', 'still on'),
          'days': s['days'] ?? '', 'km': s['km'] ?? '', 'odoStart': s['odoStart'] ?? '', 'odoEnd': s['odoEnd'] ?? '',
          'driver': s['driver'] ?? '', 'end': s['endReason'] != null ? (_endAr[s['endReason']] ?? s['endReason']) : '',
        }).toList();
    await exportExcel(context, fileName: 'tire-${ti['serial']}', sheets: [
      (tr('فترات التركيب', 'Stints'), [
        ExportCol('العربية', 'Vehicle', (r) => r['plate']),
        ExportCol('الموضع', 'Position', (r) => r['position']),
        ExportCol('من', 'From', (r) => r['from']),
        ExportCol('إلى', 'To', (r) => r['to']),
        ExportCol('الأيام', 'Days', (r) => r['days']),
        ExportCol('الكيلومترات', 'Km', (r) => r['km']),
        ExportCol('العدّاد عند التركيب', 'Odo at mount', (r) => r['odoStart']),
        ExportCol('العدّاد عند النزول', 'Odo at dismount', (r) => r['odoEnd']),
        ExportCol('السائق', 'Driver', (r) => r['driver']),
        ExportCol('سبب الخروج', 'End reason', (r) => r['end']),
      ], stints),
      (tr('ما جرى وهي عليها', 'While mounted'), [
        ExportCol('التاريخ', 'Date', (r) => _day(r['date'])),
        ExportCol('النوع', 'Kind', (r) => r['kind'] == 'repair' ? tr('إصلاح', 'Repair') : tr('صيانة', 'Service')),
        ExportCol('العربية', 'Vehicle', (r) => r['plate'] ?? ''),
        ExportCol('البند', 'Title', (r) => r['title'] ?? ''),
        ExportCol('التفصيل', 'Detail', (r) => r['detail'] ?? ''),
      ], ls2List(d['whileOn'])),
    ]);
  }

  Widget _stat(String label, String value, {Color color = T.ink}) => SizedBox(
        width: 150,
        child: AppCard(
          padding: const EdgeInsets.all(10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(fontSize: 11, color: T.inkFaint, fontWeight: FontWeight.w700)),
            const SizedBox(height: 3),
            Text(value, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: color)),
          ]),
        ),
      );

  Widget _section(String title, int? count, List<Widget> children) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
              if (count != null) Chip2('$count', T.inkSoft),
            ]),
            const SizedBox(height: 6),
            ...children,
          ]),
        ),
      );

  Widget _link(String plate, dynamic unitId) => InkWell(
        onTap: () => _openVehicle(unitId, plate),
        child: Text(plate, style: const TextStyle(fontWeight: FontWeight.w800, color: T.orange, decoration: TextDecoration.underline)),
      );

  @override
  Widget build(BuildContext context) {
    final d = _d;
    return AppScaffold(
      title: Text(d == null ? (widget.serial ?? tr('الفردة', 'Tire')) : '${ls2Map(d['tire'])['serial'] ?? ''}'),
      actions: [
        if (d != null) IconButton(tooltip: tr('سجلّ الفردة (Excel)', 'Tire log (Excel)'), icon: const Icon(Icons.file_download_outlined), onPressed: _export),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 100), SizedBox(height: 10), Shimmer()])
          : d == null
              ? (_error != null ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); }) : EmptyState(icon: Icons.tire_repair_outlined, title: tr('الفردة غير موجودة', 'Tire not found')))
              : RefreshIndicator(onRefresh: _load, child: _body(d)),
    );
  }

  Widget _body(Map<String, dynamic> d) {
    final ti = ls2Map(d['tire']);
    final st = tireStateOf(ti);
    final tot = ls2Map(d['totals']);
    final stints = ls2List(d['stints']);
    final whileOn = ls2List(d['whileOn']);
    final events = ls2List(d['events']);
    final inStore = tireStates.firstWhere((x) => x.key == st.key, orElse: () => tireStates[2]).inStore;
    return ListView(padding: const EdgeInsets.all(14), children: [
      AppCard(
        topAccent: st.color,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${ti['serial'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 20, fontFamily: 'monospace')),
          Text(
            [if ((ti['tireNumber'] ?? '').toString().isNotEmpty) '${tr('رقم', 'no.')} ${ti['tireNumber']}', ti['type'], ti['size']]
                .where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
            style: const TextStyle(fontSize: 12.5, color: T.inkSoft),
          ),
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, children: [
            Chip2(tr(st.ar, st.en), st.color),
            if ((ti['condition'] ?? '').toString().isNotEmpty)
              Chip2('${ti['condition'] == 'new' ? tr('جديدة', 'New') : tr('مستعملة', 'Used')}${ti['conditionPercent'] != null ? ' · ${ti['conditionPercent']}%' : ''}', T.inkSoft),
            if (ti['sensor'] == 'yes') Chip2(tr('بحسّاس', 'Sensor'), T.cyan, icon: Icons.sensors),
          ]),
          const SizedBox(height: 8),
          // Printed report with the company letterhead, from the same source.
          ReportButton(subject: 'tire', id: '${ti['_id'] ?? widget.tireId}', label: tr('تقرير PDF', 'PDF report')),
        ]),
      ),
      const SizedBox(height: 10),
      Wrap(spacing: 8, runSpacing: 8, children: [
        _stat(tr('عمرها', 'Age'), '${ls2Fmt(tot['ageDays'])} ${tr('يوم', 'd')}'),
        _stat(tr('عربيات ركبت عليها', 'Vehicles'), '${tot['vehicles'] ?? 0}'),
        _stat(tr('مرّات التركيب', 'Mounts'), '${tot['stints'] ?? 0}'),
        _stat(tr('إجمالي الكيلومترات', 'Total km'), ls2Fmt(tot['km']), color: T.orange),
        _stat(tr('أيام على العربيات', 'Days mounted'), ls2Fmt(tot['days'])),
        _stat(tr('صيانات وهي عليها', 'Services while on'), '${tot['services'] ?? 0}'),
        _stat(tr('إصلاحات وهي عليها', 'Repairs while on'), '${tot['repairs'] ?? 0}', color: T.danger),
      ]),
      const SizedBox(height: 10),
      _section(tr('أين هي الآن', 'Where it is now'), null, [
        if (ti['status'] == 'mounted')
          Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: 4, runSpacing: 4, children: [
            Text(tr('مركَّبة على', 'Mounted on')),
            if ((ti['plate'] ?? '').toString().isNotEmpty)
              _link('${ti['plate']}', ti['unitId'])
            else
              Text(ti['trailerNumber'] != null ? '${tr('تيدر', 'trailer')} ${ti['trailerNumber']}' : '—', style: const TextStyle(fontWeight: FontWeight.w800)),
            // A trailer tire travels with the trailer, so show which vehicle is towing it today.
            if ((ti['plate'] ?? '').toString().isEmpty && (ti['trailerOnPlate'] ?? '').toString().isNotEmpty) ...[
              Text(tr('— والتيدر على العربية', '— and the trailer is on'), style: const TextStyle(color: T.inkSoft)),
              _link('${ti['trailerOnPlate']}', ti['trailerOnUnitId']),
            ],
            if ((ti['plate'] ?? '').toString().isEmpty && (ti['trailerOnPlate'] ?? '').toString().isEmpty && ti['trailerNumber'] != null)
              Text(tr('— والتيدر غير مركَّب على عربية الآن', '— the trailer is not hitched to a vehicle'), style: const TextStyle(color: T.inkFaint)),
            if ((ti['positionLabel'] ?? '').toString().isNotEmpty)
              Text('— ${ti['positionLabel']}${(ti['section'] ?? '').toString().isNotEmpty ? ' · ${ti['section']}' : ''}', style: const TextStyle(color: T.inkSoft)),
            if (ti['isSpare'] == true) Chip2(tr('استبن', 'Spare'), T.warn),
          ])
        else
          Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: 6, children: [
            Text(tr('غير مركَّبة —', 'Not mounted —')),
            Chip2(tr(st.ar, st.en), st.color),
            if (inStore) Text(tr('محسوبة ضمن المخزن', 'counted in store'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
          ]),
        if ((ti['notes'] ?? '').toString().isNotEmpty)
          Padding(padding: const EdgeInsets.only(top: 6), child: Text('${ti['notes']}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft))),
      ]),
      _section(tr('على أيّ عربيات كانت، وكم مشت', 'Which vehicles, and how far'), stints.length, [
        Text(tr('الكيلومترات من عدّاد العربية عند التركيب والنزول', 'Km from the vehicle odometer at mount and dismount'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        if (stints.isEmpty) Padding(padding: const EdgeInsets.all(12), child: Text(tr('لم تُركَّب على عربيةٍ بعد', 'Never mounted yet'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
        for (final s in stints)
          Container(
            margin: const EdgeInsets.only(top: 8),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: s['current'] == true ? T.success.withValues(alpha: 0.06) : const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(10)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Wrap(spacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                if ((s['plate'] ?? '').toString().isNotEmpty)
                  _link('${s['plate']}', s['unitId'])
                else if (s['trailerNumber'] != null)
                  Text('${tr('تيدر', 'trailer')} ${s['trailerNumber']}${s['trailerOnPlate'] != null ? ' · ${tr('على', 'on')} ${s['trailerOnPlate']}' : ''}', style: const TextStyle(fontWeight: FontWeight.w800))
                else
                  const Text('—'),
                if (s['current'] == true && s['preSystem'] != true) Chip2(tr('الآن', 'now'), T.success),
                if (s['preSystem'] == true) Chip2(tr('قبل النظام', 'pre-system'), T.inkFaint),
                if ((s['position'] ?? '').toString().isNotEmpty) Text('${s['position']}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
              ]),
              const SizedBox(height: 4),
              Text(
                '${_day(s['from'])} → ${s['to'] != null ? _day(s['to']) : tr('حتى الآن', 'still on')}'
                '${s['days'] != null ? ' · ${ls2Fmt(s['days'])} ${tr('يوم', 'd')}' : ''}',
                style: const TextStyle(fontSize: 12),
              ),
              Wrap(spacing: 6, runSpacing: 4, children: [
                Text('${tr('كم', 'Km')}: ${s['km'] != null ? ls2Fmt(s['km']) : '—'}', style: const TextStyle(fontWeight: FontWeight.w900, color: T.orange)),
                if (s['odoStart'] != null || s['odoEnd'] != null)
                  Text('${ls2Fmt(s['odoStart'])} → ${ls2Fmt(s['odoEnd'])}', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                if ((s['driver'] ?? '').toString().isNotEmpty) Text('${s['driver']}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                if (s['endReason'] != null) Text('${tr('الخروج', 'End')}: ${_endAr[s['endReason']] ?? s['endReason']}', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
              ]),
            ]),
          ),
        if (tot['preSystem'] == true)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(tr('قبل النظام: هذه الفردة كانت مركَّبة قبل أن يبدأ النظام، فلا حدثَ لتركيبها ولا يُعرف عدّاد العربية يومها — ولذلك لا كيلومترات لها. والحسابُ يبدأ من أوّل حركةٍ تُسجَّل عليها.',
                'Pre-system: this tire was already mounted before the system started, so there is no odometer reading for that day and no km. Counting begins at its first recorded movement.'),
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          ),
        if (stints.any((s) => s['km'] == null && s['preSystem'] != true))
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(tr('الفترات الأخرى بلا كيلومترات: لا يوجد عدّاد مسجَّل للعربية في يوم التركيب أو النزول.', 'Other stints without km: no odometer reading for that vehicle on the mount or dismount day.'),
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          ),
      ]),
      _section(tr('صيانات وإصلاحات جرت والفردة مركَّبة', 'Services & repairs while it was mounted'), whileOn.length, [
        if (whileOn.isEmpty) Padding(padding: const EdgeInsets.all(12), child: Text(tr('لا صيانة ولا إصلاح جرى والفردة مركَّبة', 'Nothing happened while it was mounted'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
        for (final w in whileOn)
          ListTile(
            dense: true, contentPadding: EdgeInsets.zero,
            leading: Chip2(w['kind'] == 'repair' ? tr('إصلاح', 'Repair') : tr('صيانة', 'Service'), w['kind'] == 'repair' ? T.danger : T.info),
            title: Text('${w['title'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            subtitle: Text('${_day(w['date'])} · ${w['plate'] ?? '—'}${(w['detail'] ?? '').toString().isNotEmpty ? ' · ${w['detail']}' : ''}${(w['by'] ?? '').toString().isNotEmpty ? ' · ${w['by']}' : ''}', style: const TextStyle(fontSize: 11.5)),
          ),
      ]),
      _section(tr('كلّ ما حدث للفردة', 'Everything that happened'), events.length, [
        if (events.isEmpty) Padding(padding: const EdgeInsets.all(12), child: Text(tr('لا سجلّ حركة', 'No movement log'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
        for (final e in events)
          ListTile(
            dense: true, contentPadding: EdgeInsets.zero,
            title: Text('${_day(e['date'])} · ${Lang.instance.ar ? (_actionAr[e['action']] ?? e['action']) : e['action']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            subtitle: Text(
              [
                if ([e['fromPlate'], e['fromPosition']].any((x) => (x ?? '').toString().isNotEmpty)) '${tr('من', 'From')}: ${[e['fromPlate'], e['fromPosition']].where((x) => (x ?? '').toString().isNotEmpty).join(' — ')}',
                if ([e['toPlate'], e['toPosition']].any((x) => (x ?? '').toString().isNotEmpty)) '${tr('إلى', 'To')}: ${[e['toPlate'], e['toPosition']].where((x) => (x ?? '').toString().isNotEmpty).join(' — ')}',
                if (e['odometerKm'] != null) '${tr('العدّاد', 'Odo')}: ${ls2Fmt(e['odometerKm'])}',
                if ([e['reason'], e['notes']].any((x) => (x ?? '').toString().isNotEmpty)) [e['reason'], e['notes']].where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
                if ((e['performedByName'] ?? '').toString().isNotEmpty) '${e['performedByName']}',
              ].join('\n'),
              style: const TextStyle(fontSize: 11.5),
            ),
          ),
      ]),
    ]);
  }
}
