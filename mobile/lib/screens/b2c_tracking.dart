import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/export_sheet.dart';
import '../ui/app_scaffold.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Media Go / light-transport tracking from the Express GPS units: live map with search and state filters, one unit's route for
/// any period with its analysis (distance, moving time, stops, speeding, per-day table), and the fleet distance ranking.
/// Same API as the web page `/system/b2c/tracking`.
const _base = '/api/b2c/tracking';

const _stateColor = {'moving': Color(0xFF16A34A), 'idling': Color(0xFFF59E0B), 'stopped': Color(0xFF2563EB), 'late': Color(0xFF94A3B8), 'offline': Color(0xFF475569)};
const _states = [('moving', 'يتحرّك', 'Moving'), ('idling', 'تشغيل بدون حركة', 'Idling'), ('stopped', 'متوقّف', 'Stopped'), ('late', 'تأخّر الإرسال', 'Late'), ('offline', 'لا يُرسِل', 'Offline')];
String _stateLabel(String s) { for (final x in _states) { if (x.$1 == s) return tr(x.$2, x.$3); } return s; }

String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
DateTime _riyadhNow() => DateTime.now().toUtc().add(const Duration(hours: 3));
String _local(String? iso, {bool date = true}) {
  if (iso == null || iso.isEmpty) return '—';
  final d = DateTime.parse(iso).toUtc().add(const Duration(hours: 3));
  final hm = '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  return date ? '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')} $hm' : hm;
}
String _hm(num min) => '${min ~/ 60}:${(min % 60).round().toString().padLeft(2, '0')}';
num _n(dynamic v) => v is num ? v : (num.tryParse('$v') ?? 0);
/// Every field known about a unit: vehicle (register), rider (B2C register) and device (last fix); same list as the web page.
List<(String, String)> _details(Map u) {
  final v = (u['vehicle'] as Map?) ?? const {};
  final r = (u['rider'] as Map?) ?? const {};
  final io = (u['io'] as Map?) ?? const {};
  final rows = <(String, Object?)>[
    (tr('اللوحة', 'Plate'), u['plate']),
    (tr('الماركة والطراز', 'Make / model'), v['brand']),
    (tr('اللون', 'Color'), v['color']),
    (tr('المدينة', 'City'), '${v['city'] ?? ''}'.isNotEmpty ? v['city'] : r['city']),
    (tr('القسم', 'Department'), v['department']),
    (tr('حالة الخدمة', 'Service status'), v['serviceStatus']),
    ('Media Go', u['mediaGo'] == true ? tr('نعم', 'Yes') : tr('لا', 'No')),
    (tr('الراكب', 'Rider'), r['name']),
    (tr('جوال الراكب', 'Rider phone'), r['phone']),
    (tr('رقم هوية الراكب', 'Rider ID'), r['idNumber']),
    (tr('المشروع', 'Project'), r['project']),
    (tr('حالة الراكب', 'Rider status'), r['workStatus']),
    (tr('اسم الجهاز', 'Device name'), u['name']),
    (tr('رقم الجهاز (IMEI)', 'Device IMEI'), u['imei']),
    (tr('الحالة الآن', 'State now'), _stateLabel('${u['state']}')),
    (tr('آخر إشارة', 'Last fix'), _local(u['at'] as String?)),
    (tr('السرعة الآن', 'Speed now'), '${_n(u['speed']).round()} ${tr('كم/س', 'km/h')}'),
    (tr('المحرّك', 'Ignition'), io['ignition'] == null ? null : io['ignition'] == true ? tr('يعمل', 'On') : tr('مطفأ', 'Off')),
    (tr('جهد المركبة', 'Vehicle voltage'), io['externalVoltage'] == null ? null : '${io['externalVoltage']} V'),
    (tr('جهد بطارية الجهاز', 'Device battery'), io['batteryVoltage'] == null ? null : '${io['batteryVoltage']} V'),
    (tr('الأقمار الصناعية', 'Satellites'), io['satellites']),
    (tr('عدّاد الكيلومترات', 'Odometer'), io['odometerKm'] == null ? null : '${_n(io['odometerKm']).toStringAsFixed(1)} ${tr('كم', 'km')}'),
    (tr('الموقع الأخير', 'Last position'), u['lat'] == null ? null : '${_n(u['lat']).toStringAsFixed(5)}, ${_n(u['lng']).toStringAsFixed(5)}'),
  ];
  return [for (final x in rows) if ('${x.$2 ?? ''}'.isNotEmpty) (x.$1, '${x.$2}')];
}

Widget _detailGrid(List<(String, String)> rows) => Wrap(spacing: 12, runSpacing: 8, children: [
      for (final x in rows)
        SizedBox(width: 150, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(x.$1, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
          Text(x.$2, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
        ])),
    ]);

const _kvCols = [ExportCol('البيان', 'Item', _k), ExportCol('القيمة', 'Value', _v)];
dynamic _k(Map<String, dynamic> r) => r['k'];
dynamic _v(Map<String, dynamic> r) => r['v'];
List<Map<String, dynamic>> _kv(List<(String, String)> rows) => [for (final x in rows) {'k': x.$1, 'v': x.$2}];

/// A full-width titled block with optional tools (exports) in its header.
class _Section extends StatelessWidget {
  final String title;
  final Widget child;
  final List<Widget> tools;
  final Color? color;
  const _Section(this.title, this.child, {this.tools = const [], this.color});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: AppCard(
          padding: const EdgeInsets.fromLTRB(12, 6, 6, 12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [Expanded(child: Text(title, style: TextStyle(fontWeight: FontWeight.w900, color: color))), ...tools]),
            const Divider(height: 10),
            Padding(padding: const EdgeInsetsDirectional.only(end: 6), child: child),
          ]),
        ),
      );
}

Color _speedColor(num s, num limit) => s > limit ? T.danger : s > limit * 0.75 ? const Color(0xFFF97316) : s > 3 ? const Color(0xFF16A34A) : T.inkFaint;

class B2cTrackingScreen extends StatefulWidget {
  const B2cTrackingScreen({super.key});
  @override
  State<B2cTrackingScreen> createState() => _B2cTrackingScreenState();
}

class _B2cTrackingScreenState extends State<B2cTrackingScreen> {
  final _map = MapController();
  List<Map<String, dynamic>> _units = [];
  Map<String, dynamic> _counts = {};
  bool _loading = true;
  String? _error;
  String _q = '';
  final Set<String> _filter = {};
  String? _selected;
  Timer? _timer;
  bool _fitted = false;
  int _tab = 0;

  String _liveAt = '';

  @override
  void initState() {
    super.initState();
    _load();
    // Live: the server pushes changed positions to the `tracking` room; a slow reload keeps rider/vehicle links current.
    _join();
    Live.instance.on('tracking:rejoin', _join);
    Live.instance.onData('tracking:positions', _onPositions);
    // A vehicle flagged / unflagged Media Go or a rider / device link changed: reload the list and the distances at once.
    Live.instance.on('tracking:links', _onLinks);
    _timer = Timer.periodic(const Duration(seconds: 120), (_) => _load());
  }

  void _join() => Live.instance.emit('join:tracking');
  int _linksAt = 0;
  void _onLinks() { _load(); if (mounted) setState(() => _linksAt = DateTime.now().millisecondsSinceEpoch); }

  void _onPositions(dynamic d) {
    if (!mounted || d is! Map) return;
    final by = {for (final u in (d['units'] as List? ?? const [])) if (u is Map) '${u['imei']}': Map<String, dynamic>.from(u)};
    if (by.isEmpty) return;
    setState(() {
      _units = [for (final u in _units) by.containsKey('${u['imei']}') ? {...u, ...by['${u['imei']}']!, 'vehicle': u['vehicle'], 'rider': u['rider']} : u];
      _liveAt = '${d['at'] ?? ''}';
    });
    final sel = _units.where((u) => '${u['imei']}' == _selected).firstOrNull;
    if (sel != null && by.containsKey(_selected) && sel['lat'] != null) {
      try { _map.move(LatLng(_n(sel['lat']).toDouble(), _n(sel['lng']).toDouble()), _map.camera.zoom); } catch (_) {}
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    Live.instance.emit('leave:tracking');
    Live.instance.off('tracking:rejoin', _join);
    Live.instance.offData('tracking:positions', _onPositions);
    Live.instance.off('tracking:links', _onLinks);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('$_base/units');
      if (!mounted) return;
      setState(() {
        _units = List<Map<String, dynamic>>.from(d['units'] ?? []);
        _counts = Map<String, dynamic>.from(d['counts'] ?? {});
        _loading = false; _error = null;
      });
      if (!_fitted) {
        final pts = _units.where((u) => u['lat'] != null && u['state'] != 'offline').map((u) => LatLng(_n(u['lat']).toDouble(), _n(u['lng']).toDouble())).toList();
        if (pts.length > 1) {
          _fitted = true;
          WidgetsBinding.instance.addPostFrameCallback((_) { try { _map.fitCamera(CameraFit.bounds(bounds: LatLngBounds.fromPoints(pts), padding: const EdgeInsets.all(40))); } catch (_) {} });
        }
      }
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ة', 'ه').replaceAll('ى', 'ي').replaceAll(RegExp(r'\s+'), '').toLowerCase();
  List<Map<String, dynamic>> get _shown {
    final k = _fold(_q.trim());
    final order = ['moving', 'idling', 'stopped', 'late', 'offline'];
    final l = _units.where((u) {
      if (_filter.isNotEmpty && !_filter.contains(u['state'])) return false;
      if (k.isEmpty) return true;
      final r = (u['rider'] as Map?) ?? const {};
      final v = (u['vehicle'] as Map?) ?? const {};
      return _fold('${u['name']} ${u['plate']} ${r['name'] ?? ''} ${r['project'] ?? ''} ${v['city'] ?? ''} ${u['imei']}').contains(k);
    }).toList();
    l.sort((a, b) => order.indexOf('${a['state']}').compareTo(order.indexOf('${b['state']}')));
    return l;
  }

  void _pick(Map<String, dynamic> u) {
    setState(() => _selected = '${u['imei']}');
    if (u['lat'] != null) _map.move(LatLng(_n(u['lat']).toDouble(), _n(u['lng']).toDouble()), 15);
  }

  Widget _unitCard(Map<String, dynamic> u) {
    final r = (u['rider'] as Map?) ?? const {};
    final v = (u['vehicle'] as Map?) ?? const {};
    final io = (u['io'] as Map?) ?? const {};
    final color = _stateColor[u['state']] ?? T.inkFaint;
    return AppCard(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Row(children: [
          Expanded(child: Text('${u['plate']}${u['mediaGo'] == true ? '  · MEDIA GO' : ''}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15))),
          IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.close, size: 18), onPressed: () => setState(() => _selected = null)),
        ]),
        Text([r['name'], r['project'], v['city'] ?? r['city']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ').ifEmpty(tr('لا راكب مربوط', 'No rider linked')), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
        const SizedBox(height: 6),
        Wrap(spacing: 6, runSpacing: 6, children: [
          Chip2(_stateLabel('${u['state']}'), color),
          Chip2('${_n(u['speed']).round()} ${tr('كم/س', 'km/h')}', T.navy),
          Chip2('${tr('آخر إشارة', 'Last fix')} ${_local(u['at'])}', T.inkSoft),
          if (io['ignition'] != null) Chip2(io['ignition'] == true ? tr('المحرّك يعمل', 'Ignition on') : tr('المحرّك مطفأ', 'Ignition off'), io['ignition'] == true ? T.success : T.inkFaint),
          if (io['externalVoltage'] != null) Chip2('${io['externalVoltage']} V', T.inkSoft),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: T.orange),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => B2cRouteScreen(imei: '${u['imei']}', plate: '${u['plate']}'))),
            icon: const Icon(Icons.route, size: 18), label: Text(tr('خط السير والتحليل', 'Route & analysis')),
          )),
          const SizedBox(width: 8),
          if (u['lat'] != null)
            OutlinedButton(onPressed: () => launchUrl(Uri.parse('https://www.google.com/maps?q=${u['lat']},${u['lng']}'), mode: LaunchMode.externalApplication), child: const Text('Google Maps')),
        ]),
        if ('${r['phone'] ?? ''}'.isNotEmpty)
          TextButton.icon(onPressed: () => launchUrl(Uri.parse('tel:${r['phone']}')), icon: const Icon(Icons.call, size: 16), label: Text('${r['phone']}')),
        ExpansionTile(
          dense: true, tilePadding: EdgeInsets.zero, childrenPadding: const EdgeInsets.only(bottom: 6),
          title: Text(tr('التفاصيل الكاملة', 'Full details'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
          children: [ConstrainedBox(constraints: const BoxConstraints(maxHeight: 220), child: SingleChildScrollView(child: _detailGrid(_details(u))))],
        ),
      ]),
    );
  }

  Widget _mapView() {
    final shown = _shown;
    final sel = _units.where((u) => '${u['imei']}' == _selected).firstOrNull;
    return Stack(children: [
      FlutterMap(
        mapController: _map,
        options: const MapOptions(initialCenter: LatLng(21.5, 39.2), initialZoom: 10),
        children: [
          TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'com.energize.energizeMobile'),
          MarkerLayer(markers: [
            for (final u in shown.where((u) => u['lat'] != null))
              Marker(
                point: LatLng(_n(u['lat']).toDouble(), _n(u['lng']).toDouble()),
                width: '${u['imei']}' == _selected ? 34 : 24, height: '${u['imei']}' == _selected ? 34 : 24,
                child: GestureDetector(
                  onTap: () => _pick(u),
                  child: Transform.rotate(
                    angle: _n(u['angle']) * 3.14159 / 180,
                    child: Container(
                      decoration: BoxDecoration(color: _stateColor[u['state']] ?? T.inkFaint, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 2.5), boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 3)]),
                      child: const Icon(Icons.navigation, size: 13, color: Colors.white),
                    ),
                  ),
                ),
              ),
          ]),
        ],
      ),
      if (sel != null) Positioned(left: 10, right: 10, bottom: 10, child: _unitCard(sel)),
    ]);
  }

  Widget _listView() {
    final shown = _shown;
    return ListView.separated(
      itemCount: shown.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (_, i) {
        final u = shown[i];
        final r = (u['rider'] as Map?) ?? const {};
        final v = (u['vehicle'] as Map?) ?? const {};
        return ListTile(
          dense: true,
          leading: CircleAvatar(radius: 7, backgroundColor: _stateColor[u['state']] ?? T.inkFaint),
          title: Text('${u['plate']}${u['mediaGo'] == true ? '  · MG' : ''}', style: const TextStyle(fontWeight: FontWeight.w800)),
          subtitle: Text([r['name'], r['project'], v['city']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ').ifEmpty(_stateLabel('${u['state']}')), maxLines: 1, overflow: TextOverflow.ellipsis),
          trailing: Text(u['state'] == 'moving' ? '${_n(u['speed']).round()} ${tr('كم/س', 'km/h')}' : _local(u['at']), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
          onTap: () { setState(() => _tab = 0); _pick(u); },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('متابعة مركبات Media Go', 'Media Go Tracking')),
      actions: [
        if (_liveAt.isNotEmpty)
          Center(child: Padding(padding: const EdgeInsetsDirectional.only(end: 4), child: Text('● ${tr('لايف', 'Live')} ${_local(_liveAt, date: false)}', style: const TextStyle(fontSize: 11.5, color: T.success, fontWeight: FontWeight.w800)))),
        IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
      ],
      body: Column(children: [
        SizedBox(
          height: 46,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(10, 8, 10, 4), children: [
            Padding(padding: const EdgeInsetsDirectional.only(end: 6), child: FilterChip(
              label: Text('${tr('الكل', 'All')} ${_counts['total'] ?? ''}'), selected: _filter.isEmpty, onSelected: (_) => setState(_filter.clear))),
            for (final s in _states)
              Padding(padding: const EdgeInsetsDirectional.only(end: 6), child: FilterChip(
                avatar: CircleAvatar(radius: 5, backgroundColor: _stateColor[s.$1]),
                label: Text('${tr(s.$2, s.$3)} ${_counts[s.$1] ?? ''}'), selected: _filter.contains(s.$1),
                onSelected: (on) => setState(() => on ? _filter.add(s.$1) : _filter.remove(s.$1)))),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(10, 2, 10, 6),
          child: SearchField(dense: true, hint: tr('لوحة، راكب، مشروع، مدينة…', 'Plate, rider, project, city…'), onChanged: (v) => setState(() => _q = v)),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: SegmentedButton<int>(
            segments: [
              ButtonSegment(value: 0, icon: const Icon(Icons.map_outlined, size: 16), label: Text(tr('الخريطة', 'Map'))),
              ButtonSegment(value: 1, icon: const Icon(Icons.list, size: 16), label: Text('${tr('القائمة', 'List')} (${_shown.length})')),
              ButtonSegment(value: 2, icon: const Icon(Icons.bar_chart, size: 16), label: Text(tr('المسافات', 'Distances'))),
            ],
            selected: {_tab}, onSelectionChanged: (s) => setState(() => _tab = s.first),
          ),
        ),
        const SizedBox(height: 6),
        Expanded(
          child: _loading
              ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const CircularProgressIndicator(), const SizedBox(height: 10),
                  Text(tr('جارٍ الاتصال بمزوّد التتبّع… قد يستغرق أول تحميل حتى 30 ثانية', 'Contacting the tracking provider… up to 30 s the first time'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                ]))
              : _error != null && _units.isEmpty
                  ? ErrorRetry(message: _error!, onRetry: _load)
                  : _tab == 0 ? _mapView() : _tab == 1 ? _listView() : _FleetDistances(key: ValueKey(_linksAt), q: _q),
        ),
      ]),
    );
  }
}

extension on String { String ifEmpty(String other) => isEmpty ? other : this; }

/// Period picker shared by the route and the distances: quick ranges plus a custom date range.
class _Period extends StatelessWidget {
  final String from, to;
  final void Function(String, String) onChange;
  const _Period({required this.from, required this.to, required this.onChange});
  @override
  Widget build(BuildContext context) {
    final now = _riyadhNow();
    final today = _ymd(now);
    final y = _ymd(now.subtract(const Duration(days: 1)));
    final w = _ymd(now.subtract(const Duration(days: 6)));
    final ms = '${today.substring(0, 7)}-01';
    final pm = DateTime(now.year, now.month - 1, 1);
    final pmEnd = _ymd(DateTime(now.year, now.month, 0));
    final opts = [(tr('اليوم', 'Today'), today, today), (tr('أمس', 'Yesterday'), y, y), (tr('آخر 7 أيام', '7 days'), w, today), (tr('هذا الشهر', 'This month'), ms, today), (tr('الشهر الماضي', 'Last month'), _ymd(pm), pmEnd)];
    return SizedBox(
      height: 42,
      child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4), children: [
        for (final o in opts)
          Padding(padding: const EdgeInsetsDirectional.only(end: 6), child: ChoiceChip(label: Text(o.$1), selected: from == o.$2 && to == o.$3, onSelected: (_) => onChange(o.$2, o.$3))),
        Padding(padding: const EdgeInsetsDirectional.only(end: 6), child: ActionChip(
          avatar: const Icon(Icons.today, size: 16),
          label: Text(tr('يوم محدّد', 'A day')),
          onPressed: () async {
            final d = await showDatePicker(context: context, initialDate: DateTime.parse(to), firstDate: DateTime(2024), lastDate: DateTime.now());
            if (d != null) onChange(_ymd(d), _ymd(d));
          },
        )),
        Padding(padding: const EdgeInsetsDirectional.only(end: 6), child: ActionChip(
          avatar: const Icon(Icons.calendar_month, size: 16),
          label: Text(tr('شهر محدّد', 'A month')),
          onPressed: () async {
            final d = await showDatePicker(context: context, initialDate: DateTime.parse(from), firstDate: DateTime(2024), lastDate: DateTime.now(),
                helpText: tr('اختر أي يوم في الشهر', 'Pick any day in the month'), initialDatePickerMode: DatePickerMode.year);
            if (d == null) return;
            final end = DateTime(d.year, d.month + 1, 0);
            final today = DateTime.now();
            onChange(_ymd(DateTime(d.year, d.month, 1)), _ymd(end.isAfter(today) ? today : end));
          },
        )),
        ActionChip(
          avatar: const Icon(Icons.date_range, size: 16),
          label: Text(from == to ? from : '$from → $to'),
          onPressed: () async {
            final r = await showDateRangePicker(context: context, firstDate: DateTime(2024), lastDate: DateTime.now(),
                initialDateRange: DateTimeRange(start: DateTime.parse(from), end: DateTime.parse(to)));
            if (r != null) onChange(_ymd(r.start), _ymd(r.end));
          },
        ),
      ]),
    );
  }
}

final _distCols = [
  ExportCol('اللوحة', 'Plate', (r) => r['plate']), ExportCol('الراكب', 'Rider', (r) => r['rider']), ExportCol('المشروع', 'Project', (r) => r['project']),
  ExportCol('المدينة', 'City', (r) => r['city']), ExportCol('كم', 'km', (r) => r['km']), ExportCol('الحالة', 'State', (r) => _stateLabel('${r['state']}')),
];

class _FleetDistances extends StatefulWidget {
  final String q;
  const _FleetDistances({super.key, required this.q});
  @override
  State<_FleetDistances> createState() => _FleetDistancesState();
}

class _FleetDistancesState extends State<_FleetDistances> {
  late String _from = _ymd(_riyadhNow());
  late String _to = _from;
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  int _seq = 0;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    final s = ++_seq;
    setState(() { _loading = true; _error = null; });
    try {
      final d = await Api.instance.get('$_base/summary?from=$_from&to=$_to');
      if (!mounted || s != _seq) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['rows'] ?? []); _loading = false; });
    } catch (e) {
      if (mounted && s == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final k = widget.q.trim().toLowerCase();
    final rows = _rows.where((r) => (k.isEmpty || '${r['plate']} ${r['rider']} ${r['project']} ${r['city']}'.toLowerCase().contains(k))).toList();
    final total = rows.fold<num>(0, (a, r) => a + _n(r['km']));
    final moved = rows.where((r) => _n(r['km']) >= 1).length;
    return Column(children: [
      _Period(from: _from, to: _to, onChange: (f, t) { setState(() { _from = f; _to = t; }); _load(); }),
      if (_loading) const Expanded(child: Center(child: CircularProgressIndicator()))
      else if (_error != null) Expanded(child: ErrorRetry(message: _error!, onRetry: _load))
      else Expanded(child: ListView(padding: const EdgeInsets.all(10), children: [
        Align(alignment: AlignmentDirectional.centerEnd, child: TextButton.icon(
          icon: const Icon(Icons.file_download_outlined, size: 18), label: Text(tr('تصدير الصفحة كاملة', 'Export whole page')),
          onPressed: () => exportExcel(context, fileName: 'tracking-distance-$_from-$_to', sheets: [
            (tr('الملخّص', 'Summary'), _kvCols, _kv([
              (tr('الفترة', 'Period'), _from == _to ? _from : '$_from → $_to'), (tr('عدد المركبات', 'Vehicles'), '${rows.length}'),
              (tr('إجمالي الكيلومترات', 'Total km'), total.toStringAsFixed(1)), (tr('تحرّكت', 'Moved'), '$moved'), (tr('لم تتحرّك', 'Did not move'), '${rows.length - moved}'),
              (tr('متوسط كم للمتحرّكة', 'Avg km (moved)'), moved > 0 ? (total / moved).toStringAsFixed(1) : '0'),
            ])),
            (tr('المسافات', 'Distances'), _distCols, rows),
          ]),
        )),
        Row(children: [
          Expanded(child: _Stat(tr('إجمالي الكيلومترات', 'Total km'), total.toStringAsFixed(1), T.orange)),
          const SizedBox(width: 6),
          Expanded(child: _Stat(tr('تحرّكت', 'Moved'), '$moved', T.success)),
          const SizedBox(width: 6),
          Expanded(child: _Stat(tr('لم تتحرّك', 'Idle'), '${rows.length - moved}', T.inkSoft)),
        ]),
        const SizedBox(height: 8),
        for (var i = 0; i < rows.length; i++)
          Card(
            margin: const EdgeInsets.only(bottom: 6),
            child: ListTile(
              dense: true,
              leading: Text('${i + 1}', style: const TextStyle(color: T.inkFaint)),
              title: Text('${rows[i]['plate']}${rows[i]['mediaGo'] == true ? '  · MG' : ''}', style: const TextStyle(fontWeight: FontWeight.w800)),
              subtitle: Text([rows[i]['rider'], rows[i]['project'], rows[i]['city']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · '), maxLines: 1, overflow: TextOverflow.ellipsis),
              trailing: Text(rows[i]['km'] == null ? '—' : '${_n(rows[i]['km']).toStringAsFixed(1)} ${tr('كم', 'km')}', style: const TextStyle(fontWeight: FontWeight.w900, color: T.orange)),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => B2cRouteScreen(imei: '${rows[i]['imei']}', plate: '${rows[i]['plate']}', from: _from, to: _to))),
            ),
          ),
      ])),
    ]);
  }
}

class _Stat extends StatelessWidget {
  final String label, value;
  final Color color;
  const _Stat(this.label, this.value, this.color);
  @override
  Widget build(BuildContext context) => AppCard(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontSize: 11, color: T.inkSoft, fontWeight: FontWeight.w600)),
          const SizedBox(height: 2),
          Text(value, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: color)),
        ]),
      );
}

/// One unit's route for a period: speed-coloured line, stops, speeding points, playback and the analysis below.
class B2cRouteScreen extends StatefulWidget {
  final String imei, plate;
  final String? from, to;
  /// API mount: the B2C page, or the vehicles section when opened from a vehicle profile.
  final String base;
  const B2cRouteScreen({super.key, required this.imei, required this.plate, this.from, this.to, this.base = _base});
  @override
  State<B2cRouteScreen> createState() => _B2cRouteScreenState();
}

class _B2cRouteScreenState extends State<B2cRouteScreen> {
  final _map = MapController();
  late String _from = widget.from ?? _ymd(_riyadhNow());
  late String _to = widget.to ?? _from;
  List<List<num>> _pts = [];
  Map<String, dynamic>? _st;
  Map<String, dynamic>? _unit;
  bool _loading = true;
  String? _error;
  double _play = 0;
  int _seq = 0;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    final s = ++_seq;
    setState(() { _loading = true; _error = null; });
    try {
      final d = await Api.instance.get('${widget.base}/units/${widget.imei}/history?from=$_from&to=$_to');
      if (!mounted || s != _seq) return;
      final pts = [for (final p in (d['points'] as List? ?? const [])) [for (final x in (p as List)) _n(x)]];
      setState(() { _pts = pts; _st = Map<String, dynamic>.from(d['stats'] ?? {}); _unit = d['unit'] is Map ? Map<String, dynamic>.from(d['unit']) : null; _loading = false; _play = 0; });
      if (pts.length > 1) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          try { _map.fitCamera(CameraFit.bounds(bounds: LatLngBounds.fromPoints([for (final p in pts) LatLng(p[1].toDouble(), p[2].toDouble())]), padding: const EdgeInsets.all(30))); } catch (_) {}
        });
      }
    } catch (e) {
      if (mounted && s == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  List<Polyline> _lines(num limit) {
    final out = <Polyline>[];
    if (_pts.length < 2) return out;
    var band = _speedColor(_pts[0][3], limit);
    var seg = <LatLng>[LatLng(_pts[0][1].toDouble(), _pts[0][2].toDouble())];
    for (var i = 1; i < _pts.length; i++) {
      final p = _pts[i];
      final c = _speedColor(p[3], limit);
      seg.add(LatLng(p[1].toDouble(), p[2].toDouble()));
      if (c != band || i == _pts.length - 1) { out.add(Polyline(points: seg, strokeWidth: 4, color: band)); band = c; seg = [LatLng(p[1].toDouble(), p[2].toDouble())]; }
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final st = _st;
    final limit = _n(st?['speedLimit'] ?? 80);
    final stops = List<Map<String, dynamic>>.from(st?['stops'] ?? const []);
    final speeding = List<Map<String, dynamic>>.from(st?['speeding'] ?? const []);
    final days = List<Map<String, dynamic>>.from(st?['days'] ?? const []);
    final playIdx = _pts.isEmpty ? null : _play.round().clamp(0, _pts.length - 1);
    return AppScaffold(
      title: Text('${tr('خط سير', 'Route')} ${widget.plate}'),
      actions: [
        if (st != null)
          IconButton(
            tooltip: tr('تصدير الصفحة كاملة', 'Export whole page'),
            icon: const Icon(Icons.file_download_outlined),
            onPressed: () => exportExcel(context, fileName: 'route-${widget.plate}-$_from-$_to', sheets: [
              (tr('الملخّص', 'Summary'), _kvCols, _kv([...(_unit == null ? <(String, String)>[] : _details(_unit!)), ..._statRows(st)])),
              (tr('الأيام', 'Days'), _dayCols, days),
              (tr('التوقفات', 'Stops'), _stopCols, _stopRows(stops)),
              (tr('تجاوز السرعة', 'Speeding'), _speedCols, speeding),
            ]),
          ),
      ],
      body: Column(children: [
        _Period(from: _from, to: _to, onChange: (f, t) {
          final days = DateTime.parse(t).difference(DateTime.parse(f)).inDays;
          if (days > 31) { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أقصى فترة 31 يومًا', 'Max 31 days')))); return; }
          setState(() { _from = f; _to = t; }); _load();
        }),
        if (_loading) const Expanded(child: Center(child: CircularProgressIndicator()))
        else if (_error != null) Expanded(child: ErrorRetry(message: _error!, onRetry: _load))
        else Expanded(child: ListView(children: [
          SizedBox(
            height: 330,
            child: FlutterMap(
              mapController: _map,
              options: MapOptions(initialCenter: _pts.isNotEmpty ? LatLng(_pts[0][1].toDouble(), _pts[0][2].toDouble()) : const LatLng(21.5, 39.2), initialZoom: 12),
              children: [
                TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'com.energize.energizeMobile'),
                PolylineLayer(polylines: _lines(limit)),
                MarkerLayer(markers: [
                  for (var i = 0; i < stops.length; i++)
                    Marker(point: LatLng(_n(stops[i]['lat']).toDouble(), _n(stops[i]['lng']).toDouble()), width: 30, height: 18,
                        child: Container(alignment: Alignment.center, decoration: BoxDecoration(color: T.ink, borderRadius: BorderRadius.circular(8), border: Border.all(color: Colors.white, width: 1.5)),
                            child: Text('P${i + 1}', style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w800)))),
                  for (final s in speeding)
                    Marker(point: LatLng(_n(s['lat']).toDouble(), _n(s['lng']).toDouble()), width: 10, height: 10,
                        child: Container(decoration: const BoxDecoration(color: T.danger, shape: BoxShape.circle))),
                  if (_pts.isNotEmpty)
                    Marker(point: LatLng(_pts.first[1].toDouble(), _pts.first[2].toDouble()), width: 18, height: 18, child: const Icon(Icons.trip_origin, color: T.success, size: 18)),
                  if (_pts.length > 1)
                    Marker(point: LatLng(_pts.last[1].toDouble(), _pts.last[2].toDouble()), width: 28, height: 28, child: const Icon(Icons.location_on, color: T.danger, size: 26)),
                  if (playIdx != null && _play > 0)
                    Marker(point: LatLng(_pts[playIdx][1].toDouble(), _pts[playIdx][2].toDouble()), width: 20, height: 20,
                        child: Container(decoration: BoxDecoration(color: T.orange, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3)))),
                ]),
              ],
            ),
          ),
          if (_pts.length > 1)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10),
              child: Row(children: [
                Expanded(child: Slider(value: _play, min: 0, max: (_pts.length - 1).toDouble(), activeColor: T.orange, onChanged: (v) => setState(() => _play = v))),
                Text(playIdx == null ? '' : '${_local(DateTime.fromMillisecondsSinceEpoch(_pts[playIdx][0].toInt()).toUtc().toIso8601String())} · ${_pts[playIdx][3].round()}', style: const TextStyle(fontSize: 11)),
              ]),
            ),
          if (st != null) Padding(
            padding: const EdgeInsets.all(10),
            // Each block takes the full width, one under another, with its own title and export.
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (_pts.length < 2) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(tr('لا حركة مسجّلة في هذه الفترة', 'No movement in this period'), style: const TextStyle(color: T.inkSoft))),
              _Section(tr('ملخّص الفترة', 'Period summary'), Column(children: [
                for (final x in [
                  (tr('المسافة', 'Distance'), '${_n(st['km']).toStringAsFixed(1)} ${tr('كم', 'km')}', T.orange),
                  (tr('وقت الحركة', 'Moving'), _hm(_n(st['movingMinutes'])), T.success),
                  (tr('تشغيل بدون حركة', 'Idling'), _hm(_n(st['idleMinutes'])), T.warn),
                  (tr('التوقّفات (5 د+)', 'Stops (5 min+)'), '${st['stopsCount']} · ${_hm(_n(st['stoppedMinutes']))}', T.info),
                  (tr('أعلى سرعة · متوسط الحركة', 'Max · avg moving'), '${st['maxSpeed']} · ${st['avgMovingSpeed']} ${tr('كم/س', 'km/h')}', T.ink),
                  ('${tr('تجاوز', 'Over')} $limit ${tr('كم/س', 'km/h')}', '${st['speedingCount']}', _n(st['speedingCount']) > 0 ? T.danger : T.ink),
                  (tr('أيّام بحركة', 'Days moving'), '${days.where((d) => _n(d['km']) >= 1).length} ${tr('من', 'of')} ${days.length}', T.ink),
                ])
                  Padding(padding: const EdgeInsets.only(bottom: 6), child: _Stat(x.$1, x.$2, x.$3)),
              ]), tools: [
                IconButton(visualDensity: VisualDensity.compact, tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined, size: 20),
                    onPressed: () => exportExcel(context, fileName: 'route-summary-${widget.plate}-$_from-$_to', sheets: [(tr('الملخّص', 'Summary'), _kvCols, _kv(_statRows(st)))])),
              ]),
              if (_unit != null)
                _Section(tr('بيانات المركبة والراكب والجهاز', 'Vehicle, rider and device'), _detailGrid(_details(_unit!)), tools: [
                  IconButton(visualDensity: VisualDensity.compact, tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined, size: 20),
                      onPressed: () => exportExcel(context, fileName: 'vehicle-${widget.plate}', sheets: [(tr('البيانات', 'Details'), _kvCols, _kv(_details(_unit!)))])),
                ]),
              if (days.isNotEmpty)
                _Section(tr('الأيام — اضغط يومًا لفتحه', 'Days — tap one to open it'), Builder(builder: (_) {
                  final mx = days.fold<num>(1, (a, d) => _n(d['km']) > a ? _n(d['km']) : a);
                  return Column(children: [
                    for (final d in days)
                      InkWell(
                        onTap: () { setState(() { _from = '${d['day']}'; _to = '${d['day']}'; }); _load(); },
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 3),
                          child: Row(children: [
                            SizedBox(width: 46, child: Text('${d['day']}'.substring(5), style: const TextStyle(fontSize: 11.5))),
                            Expanded(child: ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(value: _n(d['km']) / mx, minHeight: 12, color: T.orange, backgroundColor: T.canvas))),
                            SizedBox(width: 92, child: Text('${_n(d['km']).toStringAsFixed(1)} · ${_hm(_n(d['movingMin']))}', textAlign: TextAlign.end, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700))),
                          ]),
                        ),
                      ),
                  ]);
                }), tools: [ExportButton(fileName: 'days-${widget.plate}-$_from-$_to', sheetName: tr('الأيام', 'Days'), columns: _dayCols, rows: () => days)]),
              _Section('${tr('التوقّفات', 'Stops')} (${st['stopsCount']})', stops.isEmpty
                  ? Text(tr('لا توقّفات 5 دقائق فأكثر', 'No stops of 5 min+'), style: const TextStyle(color: T.inkSoft))
                  : Column(children: [
                      for (var i = 0; i < stops.length; i++)
                        ListTile(
                          dense: true, contentPadding: EdgeInsets.zero,
                          title: Text('P${i + 1} · ${_local(stops[i]['from'])} – ${_local(stops[i]['to'], date: false)}'),
                          trailing: Text(_hm(_n(stops[i]['minutes'])), style: const TextStyle(fontWeight: FontWeight.w800, color: T.info)),
                          onTap: () => _map.move(LatLng(_n(stops[i]['lat']).toDouble(), _n(stops[i]['lng']).toDouble()), 17),
                        ),
                    ]), tools: [ExportButton(fileName: 'stops-${widget.plate}-$_from-$_to', sheetName: tr('التوقفات', 'Stops'), columns: _stopCols, rows: () => _stopRows(stops))]),
              _Section('${tr('تجاوزات السرعة', 'Speeding')} (${st['speedingCount']})', speeding.isEmpty
                  ? Text(tr('لا تجاوزات', 'No speeding'), style: const TextStyle(color: T.inkSoft))
                  : Column(children: [
                      for (final s in speeding)
                        ListTile(
                          dense: true, contentPadding: EdgeInsets.zero,
                          title: Text('${_local(s['at'])} · ${s['seconds']} ${tr('ث', 's')}'),
                          trailing: Text('${s['maxSpeed']} ${tr('كم/س', 'km/h')}', style: const TextStyle(fontWeight: FontWeight.w800, color: T.danger)),
                          onTap: () => _map.move(LatLng(_n(s['lat']).toDouble(), _n(s['lng']).toDouble()), 16),
                        ),
                    ]), color: T.danger, tools: [ExportButton(fileName: 'speeding-${widget.plate}-$_from-$_to', sheetName: tr('تجاوز السرعة', 'Speeding'), columns: _speedCols, rows: () => speeding)]),
            ]),
          ),
        ])),
      ]),
    );
  }
}

final _dayCols = [
  ExportCol('اليوم', 'Day', (r) => r['day']), ExportCol('كم', 'km', (r) => r['km']), ExportCol('وقت الحركة', 'Moving', (r) => _hm(_n(r['movingMin']))),
  ExportCol('أعلى سرعة', 'Max speed', (r) => r['maxSpeed']), ExportCol('أول حركة', 'First move', (r) => _local(r['firstMove'] as String?, date: false)), ExportCol('آخر حركة', 'Last move', (r) => _local(r['lastMove'] as String?, date: false)),
];
final _stopCols = [
  ExportCol('#', '#', (r) => r['n']), ExportCol('من', 'From', (r) => _local(r['from'] as String?)), ExportCol('إلى', 'To', (r) => _local(r['to'] as String?)),
  ExportCol('الدقائق', 'Minutes', (r) => r['minutes']), ExportCol('الموقع', 'Location', (r) => 'https://www.google.com/maps?q=${r['lat']},${r['lng']}'),
];
final _speedCols = [
  ExportCol('الوقت', 'Time', (r) => _local(r['at'] as String?)), ExportCol('السرعة', 'Speed', (r) => r['maxSpeed']), ExportCol('ثوانٍ', 'Seconds', (r) => r['seconds']),
  ExportCol('الموقع', 'Location', (r) => 'https://www.google.com/maps?q=${r['lat']},${r['lng']}'),
];
List<Map<String, dynamic>> _stopRows(List<Map<String, dynamic>> stops) => [for (var i = 0; i < stops.length; i++) {...stops[i], 'n': 'P${i + 1}'}];
List<(String, String)> _statRows(Map<String, dynamic> st) {
  final days = List<Map>.from(st['days'] ?? const []);
  return [
    (tr('المسافة', 'Distance'), '${_n(st['km']).toStringAsFixed(1)} ${tr('كم', 'km')}'),
    (tr('متوسط اليوم', 'Per day'), days.isEmpty ? '—' : '${(_n(st['km']) / days.length).toStringAsFixed(1)} ${tr('كم', 'km')}'),
    (tr('وقت الحركة', 'Moving time'), _hm(_n(st['movingMinutes']))),
    (tr('تشغيل بدون حركة', 'Idling'), _hm(_n(st['idleMinutes']))),
    (tr('التوقّفات (5 د+)', 'Stops (5 min+)'), '${st['stopsCount']}'),
    (tr('مجموع التوقّف', 'Stopped time'), _hm(_n(st['stoppedMinutes']))),
    (tr('أعلى سرعة', 'Max speed'), '${st['maxSpeed']} ${tr('كم/س', 'km/h')}'),
    (tr('متوسط سرعة الحركة', 'Avg moving speed'), '${st['avgMovingSpeed']} ${tr('كم/س', 'km/h')}'),
    ('${tr('تجاوزات السرعة فوق', 'Speeding over')} ${st['speedLimit']}', '${st['speedingCount']}'),
    (tr('أيّام بحركة', 'Days moving'), '${days.where((d) => _n(d['km']) >= 1).length} ${tr('من', 'of')} ${days.length}'),
    (tr('أول / آخر إشارة', 'First / last fix'), '${_local(st['first'] as String?)} — ${_local(st['last'] as String?)}'),
  ];
}
