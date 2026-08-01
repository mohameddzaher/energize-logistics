import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import 'ls2_track_map.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'ls2_vehicle_assets.dart';

/// تفاصيل المركبة (لوكيشن سوليوشن) — خمس تبويبات كما في الويب:
/// نظرة عامة (حساسات حية + إطارات)، الصيانة (فواصل + تسجيل خدمة + مؤجلات)،
/// الرحلات، المسافة والوقود، والتنبيهات.
class Ls2VehicleDetailScreen extends StatefulWidget {
  final String vehicleId;
  final String plate;
  const Ls2VehicleDetailScreen({super.key, required this.vehicleId, required this.plate});
  @override
  State<Ls2VehicleDetailScreen> createState() => _Ls2VehicleDetailScreenState();
}

num? _numOrNull(dynamic v) => v is num ? v : num.tryParse(v?.toString() ?? '');
String _fmt(dynamic v, {int digits = 0, String suffix = ''}) {
  final n = _numOrNull(v);
  return n == null ? '—' : '${n.toStringAsFixed(digits)}$suffix';
}

String _dt(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? '—' : '${d.day}/${d.month}/${d.year} ${d.hour}:${d.minute.toString().padLeft(2, '0')}';
}

List<Map<String, dynamic>> _l(dynamic v) =>
    v is List ? List<Map<String, dynamic>>.from(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : const [];

Map<String, dynamic> _m(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : {};

/// شريحة حساس: تعرض القيمة، وإن غابت (السينسور لا يرسل / لا تصل من لوكيشن
/// سوليوشن) تُبرز كتحذير أحمر بدل «—» صامتة.
Widget _sensor(String label, dynamic value, String unit, IconData icon, Color okColor, {int digits = 0}) {
  final n = _numOrNull(value);
  if (n == null) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: T.danger.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: T.danger.withValues(alpha: 0.45)),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.warning_amber_rounded, size: 13, color: T.danger),
        const SizedBox(width: 4),
        Text('$label: ${tr('لا تصل بيانات', 'no data')}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: T.danger)),
      ]),
    );
  }
  return Chip2('$label: ${n.toStringAsFixed(digits)}$unit', okColor, icon: icon);
}

class _Ls2VehicleDetailScreenState extends State<Ls2VehicleDetailScreen> {
  Map<String, dynamic>? _vehicle;
  List<Map<String, dynamic>> _alerts = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('ls2:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('ls2:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/ls2/vehicles/${widget.vehicleId}');
      if (!mounted) return;
      setState(() {
        _vehicle = _m(d['vehicle']);
        _alerts = _l(d['alerts']);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final tabs = [
      (tr('نظرة عامة', 'Overview'), Icons.dashboard_outlined),
      (tr('الصيانة', 'Maintenance'), Icons.build_outlined),
      (tr('الرحلات', 'Trips'), Icons.route_outlined),
      (tr('المسافة والوقود', 'Distance & fuel'), Icons.local_gas_station_outlined),
      (tr('التنبيهات', 'Alerts'), Icons.notifications_outlined),
    ];
    return DefaultTabController(
      length: tabs.length,
      child: AppScaffold(
        title: Text(widget.plate),
        actions: [
          IconButton(
            tooltip: tr('المسار على الخريطة', 'Track on map'),
            icon: const Icon(Icons.map_outlined, color: Colors.white),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => Ls2TrackMapScreen(
              vehicleId: int.tryParse(widget.vehicleId) ?? 0, plate: widget.plate))),
          ),
          IconButton(
            tooltip: tr('أصول المركبة (الكاوتشات)', 'Vehicle assets (tires)'),
            icon: const Icon(Icons.tire_repair_outlined, color: Colors.white),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => Ls2VehicleAssetsScreen(plate: widget.plate))),
          ),
        ],
        appBarBottom: TabBar(
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          tabs: tabs.map((t) => Tab(text: t.$1)).toList(),
        ),
        body: _loading
            ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 130), SizedBox(height: 10), Shimmer(height: 130), SizedBox(height: 10), Shimmer()])
            : _error != null
                ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                : TabBarView(children: [
                    _OverviewTab(vehicleId: widget.vehicleId, vehicle: _vehicle!, onRefresh: _load),
                    _MaintenanceTab(vehicleId: widget.vehicleId, plate: widget.plate),
                    _TripsTab(vehicleId: widget.vehicleId),
                    _DistanceFuelTab(vehicleId: widget.vehicleId),
                    _AlertsTab(alerts: _alerts, onRefresh: _load),
                  ]),
      ),
    );
  }
}

// ── نظرة عامة ────────────────────────────────────────────────────────────────
class _OverviewTab extends StatelessWidget {
  final String vehicleId;
  final Map<String, dynamic> vehicle;
  final Future<void> Function() onRefresh;
  const _OverviewTab({required this.vehicleId, required this.vehicle, required this.onRefresh});

  // تعديل ماركة/نوع الكاوتش يدويًا (PATCH /meta) — يسمع فورًا عبر ls2:updated.
  Future<void> _editTireBrand(BuildContext context) async {
    final ctrl = TextEditingController(text: (vehicle['tireBrand'] ?? '').toString());
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('ماركة / نوع الكاوتش', 'Tire brand / type')),
        content: TextField(controller: ctrl, autofocus: true, decoration: InputDecoration(labelText: tr('مثال: Bridgestone', 'e.g. Bridgestone'))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.patch('/api/ls2/vehicles/$vehicleId/meta', {'tireBrand': ctrl.text.trim()});
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم الحفظ', 'Saved'))));
      await onRefresh();
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = vehicle;
    final status = (v['status'] ?? '').toString();
    final statusMeta = {
      'moving': ('متحركة', 'Moving', T.success),
      'idle': ('متوقفة مؤقتًا', 'Idle', T.warn),
      'stopped': ('واقفة', 'Stopped', T.info),
      'offline': ('غير متصلة', 'Offline', T.inkFaint),
    }[status] ?? ('—', '—', T.inkFaint);
    final tires = _l(v['tires']);
    final profile = _m(v['profile']);
    final maintenance = _m(v['maintenance']);

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        FadeSlideIn(
          child: AppCard(
            topAccent: statusMeta.$3,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text('${v['plate'] ?? ''} · ${v['driver'] ?? tr('بلا سائق', 'No driver')}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
                Chip2(tr(statusMeta.$1, statusMeta.$2), statusMeta.$3),
              ]),
              const SizedBox(height: 10),
              Wrap(spacing: 8, runSpacing: 8, children: [
                _sensor(tr('السرعة', 'Speed'), v['speed'], ' ${tr('كم/س', 'km/h')}', Icons.speed_outlined, T.navy),
                _sensor(tr('العداد', 'Odometer'), v['odometerKm'], ' ${tr('كم', 'km')}', Icons.straighten_outlined, T.violet),
                _sensor(tr('الوقود', 'Fuel'), v['fuelPct'], '%', Icons.local_gas_station_outlined, T.orange),
                _sensor(tr('التبريد', 'Coolant'), v['coolantC'], '°', Icons.thermostat_outlined, T.cyan),
                _sensor(tr('الوزن', 'Weight'), v['weightKg'], ' ${tr('كجم', 'kg')}', Icons.scale_outlined, T.info),
                _sensor(tr('ساعات المحرك', 'Engine hrs'), v['engineHours'], '', Icons.timelapse_outlined, T.inkFaint, digits: 1),
                Chip2('${tr('آخر إشارة', 'Last seen')}: ${_dt(v['lastMessageAt'])}', status == 'offline' ? T.danger : T.inkFaint, icon: Icons.schedule_outlined),
              ]),
            ]),
          ),
        ),
        // تحذير عام: المركبة غير متصلة → كل البيانات قد تكون قديمة.
        if (status == 'offline')
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(11),
              decoration: BoxDecoration(color: T.danger.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12), border: Border.all(color: T.danger.withValues(alpha: 0.4))),
              child: Row(children: [
                const Icon(Icons.wifi_off_rounded, size: 18, color: T.danger),
                const SizedBox(width: 8),
                Expanded(child: Text(tr('المركبة غير متصلة بلوكيشن سوليوشن — البيانات المعروضة قد تكون قديمة.', 'Vehicle offline from Location Solutions — readings may be stale.'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.danger))),
              ]),
            ),
          ),
        if (tires.isNotEmpty) ...[
          const SizedBox(height: 12),
          FadeSlideIn(
            delayMs: 40,
            child: AppCard(
              topAccent: T.orange,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${tr('الإطارات', 'Tires')} (${tires.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                const SizedBox(height: 10),
                Wrap(spacing: 8, runSpacing: 8, children: tires.map((t) {
                  final temp = _numOrNull(t['tempC']);
                  final press = _numOrNull(t['pressurePsi']);
                  final noData = temp == null && press == null; // الحساس لا يرسل
                  final hot = temp != null && temp >= 75;
                  final fault = t['fault'] == true;
                  final color = (fault || noData) ? T.danger : hot ? T.orange : T.success;
                  return Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: color.withValues(alpha: 0.35)),
                    ),
                    child: Column(children: [
                      Row(mainAxisSize: MainAxisSize.min, children: [
                        if (noData) const Padding(padding: EdgeInsets.only(right: 3), child: Icon(Icons.warning_amber_rounded, size: 11, color: T.danger)),
                        Text('${t['axle'] ?? '?'}-${t['position'] ?? '?'}', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: color)),
                      ]),
                      noData
                          ? Text(tr('لا تصل بيانات', 'no data'), style: const TextStyle(fontSize: 9.5, fontWeight: FontWeight.w700, color: T.danger))
                          : Text('${temp == null ? '⚠' : '${temp.toStringAsFixed(0)}°'} · ${press == null ? '⚠' : '${press.toStringAsFixed(0)} psi'}',
                              style: TextStyle(fontSize: 10.5, color: (temp == null || press == null) ? T.danger : T.inkSoft, fontWeight: (temp == null || press == null) ? FontWeight.w700 : FontWeight.w400)),
                    ]),
                  );
                }).toList()),
              ]),
            ),
          ),
        ] else ...[
          // لا توجد أي بيانات كاوتشات من لوكيشن سوليوشن — تحذير صريح.
          const SizedBox(height: 12),
          FadeSlideIn(
            delayMs: 40,
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(13),
              decoration: BoxDecoration(color: T.danger.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(14), border: Border.all(color: T.danger.withValues(alpha: 0.4))),
              child: Row(children: [
                const Icon(Icons.tire_repair_outlined, size: 20, color: T.danger),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(tr('لا تصل بيانات حساسات الكاوتشات', 'No tire-sensor data'), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: T.danger)),
                    Text(tr('لا تُرسل هذه المركبة حرارة أو ضغط الكاوتشات من لوكيشن سوليوشن.', 'This vehicle sends no tire temperature/pressure from Location Solutions.'), style: const TextStyle(fontSize: 11.5, color: T.danger)),
                  ]),
                ),
              ]),
            ),
          ),
        ],
        const SizedBox(height: 12),
        FadeSlideIn(
          delayMs: 80,
          child: AppCard(
            topAccent: maintenance['statusLevel'] == 'overdue' ? T.danger : maintenance['statusLevel'] == 'due' ? T.warn : T.success,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('حالة الصيانة', 'Maintenance status'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [
                if (maintenance['kmToService'] != null)
                  Chip2('${tr('للخدمة القادمة', 'To service')}: ${_fmt(maintenance['kmToService'])} ${tr('كم', 'km')}',
                      maintenance['statusLevel'] == 'overdue' ? T.danger : T.warn),
                if ((maintenance['nextServiceName'] ?? '').toString().isNotEmpty)
                  Chip2((maintenance['nextServiceName'] ?? '').toString(), T.navy),
                Chip2('${tr('متأخرة', 'Overdue')}: ${_fmt(maintenance['overdueCount'])}', T.danger),
                Chip2('${tr('مستحقة', 'Due')}: ${_fmt(maintenance['dueCount'])}', T.warn),
              ]),
            ]),
          ),
        ),
        const SizedBox(height: 12),
        FadeSlideIn(
          delayMs: 120,
          child: AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(tr('بيانات المركبة', 'Vehicle profile'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                TextButton.icon(
                  onPressed: () => _editTireBrand(context),
                  icon: const Icon(Icons.edit_outlined, size: 15),
                  label: Text(tr('ماركة الكاوتش', 'Tire brand'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                  style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8), minimumSize: const Size(0, 32)),
                ),
              ]),
              const SizedBox(height: 4),
              ...[
                (tr('الماركة', 'Brand'), profile['brand']),
                (tr('الموديل', 'Model year'), profile['modelYear']),
                (tr('النوع', 'Type'), profile['vehicleType']),
                (tr('رقم الهيكل', 'VIN'), profile['vin']),
                (tr('لوحة التسجيل', 'Registration'), profile['registrationPlate']),
                (tr('شريحة الاتصال', 'SIM'), profile['simIccid']),
                (tr('ماركة الكاوتش', 'Tire brand'), vehicle['tireBrand']),
              ].where((x) => (x.$2 ?? '').toString().isNotEmpty).map((x) => Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Row(children: [
                      Text('${x.$1}: ', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                      Expanded(child: Text(x.$2.toString(), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700))),
                    ]),
                  )),
              if ((vehicle['tireBrand'] ?? '').toString().isEmpty && profile.isEmpty)
                Text(tr('اضغط «ماركة الكاوتش» لإضافتها.', 'Tap "Tire brand" to add it.'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            ]),
          ),
        ),
        const SizedBox(height: 20),
      ]),
    );
  }
}

// ── الصيانة ─────────────────────────────────────────────────────────────────
class _MaintenanceTab extends StatefulWidget {
  final String vehicleId;
  final String plate;
  const _MaintenanceTab({required this.vehicleId, required this.plate});
  @override
  State<_MaintenanceTab> createState() => _MaintenanceTabState();
}

class _MaintenanceTabState extends State<_MaintenanceTab> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/ls2/vehicles/${widget.vehicleId}/maintenance');
      if (!mounted) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  // تسجيل خدمة — يتبع الفاصل المختار، وقائمة الفحص من قوالب الإعدادات.
  Future<void> _registerService(Map<String, dynamic> interval) async {
    final vehicle = _m(_d?['vehicle']);
    final checklists = _m(_d?['checklists']);
    final name = (interval['name'] ?? '').toString();
    final numMatch = RegExp(r'^\s*(\d+)').firstMatch(name);
    final key = numMatch?.group(1) ?? name;
    final template = _l(checklists[key] ?? checklists[name]);

    final odometer = TextEditingController(text: _fmt(vehicle['odometerKm']));
    final cost = TextEditingController();
    final notes = TextEditingController();
    // status per checklist row: done | deferred | na
    final rowStatus = <int, String>{for (var i = 0; i < template.length; i++) i: 'done'};
    final rowDefer = <int, TextEditingController>{for (var i = 0; i < template.length; i++) i: TextEditingController(text: '1000')};

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SizedBox(
            height: MediaQuery.of(c).size.height * 0.78,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${tr('تسجيل خدمة', 'Register service')} — $name', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 12),
              Row(children: [
                Expanded(child: TextField(controller: odometer, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('العداد (كم) *', 'Odometer (km) *')))),
                const SizedBox(width: 10),
                Expanded(child: TextField(controller: cost, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('التكلفة', 'Cost')))),
              ]),
              const SizedBox(height: 10),
              TextField(controller: notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
              if (template.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(tr('قائمة الفحص', 'Checklist'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                const SizedBox(height: 6),
                Expanded(
                  child: ListView.builder(
                    itemCount: template.length,
                    itemBuilder: (c, i) {
                      final row = template[i];
                      final label = (row['labelAr'] ?? row['label'] ?? '').toString();
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(label, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                          Row(children: [
                            Expanded(
                              child: SegmentedButton<String>(
                                style: const ButtonStyle(visualDensity: VisualDensity.compact),
                                segments: [
                                  ButtonSegment(value: 'done', label: Text(tr('تم', 'Done'), style: const TextStyle(fontSize: 11))),
                                  ButtonSegment(value: 'deferred', label: Text(tr('تأجيل', 'Defer'), style: const TextStyle(fontSize: 11))),
                                  ButtonSegment(value: 'na', label: Text(tr('لا ينطبق', 'N/A'), style: const TextStyle(fontSize: 11))),
                                ],
                                selected: {rowStatus[i]!},
                                onSelectionChanged: (s) => setS(() => rowStatus[i] = s.first),
                              ),
                            ),
                            if (rowStatus[i] == 'deferred') ...[
                              const SizedBox(width: 6),
                              SizedBox(
                                width: 84,
                                child: TextField(
                                  controller: rowDefer[i],
                                  keyboardType: TextInputType.number,
                                  decoration: InputDecoration(labelText: tr('+كم', '+km'), isDense: true),
                                ),
                              ),
                            ],
                          ]),
                        ]),
                      );
                    },
                  ),
                ),
              ] else
                const Spacer(),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () async {
                    try {
                      await Api.instance.post('/api/ls2/vehicles/${widget.vehicleId}/register-service', {
                        'intervalId': interval['id'],
                        'odometerKm': num.tryParse(odometer.text),
                        if (cost.text.trim().isNotEmpty) 'cost': num.tryParse(cost.text),
                        if (notes.text.trim().isNotEmpty) 'notes': notes.text.trim(),
                        if (template.isNotEmpty)
                          'checklist': [
                            for (var i = 0; i < template.length; i++)
                              {
                                'label': (template[i]['label'] ?? template[i]['labelAr'] ?? '').toString(),
                                'labelAr': (template[i]['labelAr'] ?? '').toString(),
                                'status': rowStatus[i],
                                if (rowStatus[i] == 'deferred') 'deferKm': num.tryParse(rowDefer[i]!.text) ?? 1000,
                              }
                          ],
                      });
                      if (c.mounted) Navigator.pop(c);
                      _load();
                    } catch (e) {
                      if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                    }
                  },
                  child: Text(tr('تسجيل الخدمة', 'Register')),
                ),
              ),
            ]),
          ),
        ),
      )),
    );
  }

  Future<void> _resolveDeferral(Map<String, dynamic> d) async {
    String action = 'done';
    final addKm = TextEditingController(text: '1000');
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c, setS) => AlertDialog(
        title: Text((d['labelAr'] ?? d['label'] ?? '').toString(), style: const TextStyle(fontSize: 15)),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          SegmentedButton<String>(
            segments: [
              ButtonSegment(value: 'done', label: Text(tr('أُنجز', 'Done'))),
              ButtonSegment(value: 'defer', label: Text(tr('تأجيل', 'Defer'))),
              ButtonSegment(value: 'skip', label: Text(tr('إلغاء', 'Skip'))),
            ],
            selected: {action},
            onSelectionChanged: (s) => setS(() => action = s.first),
          ),
          if (action == 'defer') ...[
            const SizedBox(height: 10),
            TextField(controller: addKm, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('تمديد (كم)', 'Extend (km)'))),
          ],
          const SizedBox(height: 10),
          TextField(controller: note, decoration: InputDecoration(labelText: tr('ملاحظة', 'Note'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('رجوع', 'Back'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تأكيد', 'Confirm'))),
        ],
      )),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/ls2/vehicles/${widget.vehicleId}/resolve-deferral', {
        'logId': d['logId'],
        'label': d['label'],
        'action': action,
        if (action == 'defer') 'addKm': num.tryParse(addKm.text) ?? 1000,
        if (note.text.trim().isNotEmpty) 'note': note.text.trim(),
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()]);
    }
    if (_error != null) {
      return ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); });
    }
    final vehicle = _m(_d?['vehicle']);
    final intervals = _l(_m(vehicle['maintenance'])['intervals']);
    final deferrals = _l(_d?['deferrals']);
    final history = _l(_d?['history']);

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        Text(tr('فواصل الخدمة', 'Service intervals'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 8),
        ...intervals.map((iv) {
          final level = (iv['statusLevel'] ?? 'ok').toString();
          final color = level == 'overdue' ? T.danger : level == 'due' ? T.warn : T.success;
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: AppCard(
              topAccent: color,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text((iv['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                  Chip2(
                    level == 'overdue' ? tr('متأخرة', 'Overdue') : level == 'due' ? tr('مستحقة', 'Due') : tr('سليمة', 'OK'),
                    color,
                  ),
                ]),
                const SizedBox(height: 5),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  if (iv['remainingKm'] != null) Chip2('${tr('المتبقي', 'Remaining')}: ${_fmt(iv['remainingKm'])} ${tr('كم', 'km')}', color),
                  if (iv['nextServiceKm'] != null) Chip2('${tr('عند', 'At')}: ${_fmt(iv['nextServiceKm'])} ${tr('كم', 'km')}', T.navy),
                  if (iv['serviceCount'] != null) Chip2('${tr('مرات الخدمة', 'Services')}: ${_fmt(iv['serviceCount'])}', T.inkFaint),
                ]),
                const SizedBox(height: 6),
                Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: TextButton.icon(
                    onPressed: () => _registerService(iv),
                    icon: const Icon(Icons.build_circle_outlined, size: 17),
                    label: Text(tr('تسجيل خدمة', 'Register service'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                  ),
                ),
              ]),
            ),
          );
        }),
        if (deferrals.isNotEmpty) ...[
          const SizedBox(height: 10),
          Text(tr('مهام مؤجلة', 'Deferred tasks'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 8),
          ...deferrals.map((d) => Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: AppCard(
              topAccent: T.warn,
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text((d['labelAr'] ?? d['label'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                    Text(
                      '${tr('يستحق عند', 'Due at')} ${_fmt(d['dueAtOdometerKm'])} ${tr('كم', 'km')}'
                      '${d['remainingKm'] != null ? ' · ${tr('باقي', 'left')} ${_fmt(d['remainingKm'])}' : ''}'
                      '${d['estimatedDueDate'] != null ? ' · ≈${d['estimatedDueDate']}' : ''}',
                      style: const TextStyle(fontSize: 11.5, color: T.inkSoft),
                    ),
                  ]),
                ),
                FilledButton.tonal(
                  onPressed: () => _resolveDeferral(d),
                  child: Text(tr('إنهاء', 'Resolve'), style: const TextStyle(fontSize: 12)),
                ),
              ]),
            ),
          )),
        ],
        if (history.isNotEmpty) ...[
          const SizedBox(height: 10),
          Text(tr('سجل الخدمات', 'Service history'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 8),
          ...history.take(15).map((h) => Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: AppCard(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text((h['intervalName'] ?? h['serviceType'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                    Text('${_dt(h['serviceDate'])} · ${_fmt(h['odometerKm'])} ${tr('كم', 'km')}${(h['performedByName'] ?? '').toString().isNotEmpty ? ' · ${h['performedByName']}' : ''}',
                        style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                  ]),
                ),
                if (h['cost'] != null) Chip2('${_fmt(h['cost'])} ${tr('ر.س', 'SAR')}', T.violet),
              ]),
            ),
          )),
        ],
        const SizedBox(height: 20),
      ]),
    );
  }
}

// ── الرحلات ─────────────────────────────────────────────────────────────────
class _TripsTab extends StatefulWidget {
  final String vehicleId;
  const _TripsTab({required this.vehicleId});
  @override
  State<_TripsTab> createState() => _TripsTabState();
}

class _TripsTabState extends State<_TripsTab> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  DateTime _from = DateTime.now();
  DateTime _to = DateTime.now();

  String _key(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/ls2/vehicles/${widget.vehicleId}/trips?from=${_key(_from)}&to=${_key(_to)}');
      if (!mounted) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _hm(dynamic sec) {
    final s = _numOrNull(sec);
    if (s == null) return '—';
    final h = s ~/ 3600, m = (s % 3600) ~/ 60;
    return '${h}h ${m}m';
  }

  @override
  Widget build(BuildContext context) {
    final trips = _l(_d?['trips']);
    final summary = _m(_d?['summary']);
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
        child: Row(children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () async {
                final range = await showDateRangePicker(
                  context: context,
                  firstDate: DateTime.now().subtract(const Duration(days: 90)),
                  lastDate: DateTime.now(),
                  initialDateRange: DateTimeRange(start: _from, end: _to),
                );
                if (range != null) { setState(() { _from = range.start; _to = range.end; _loading = true; }); _load(); }
              },
              icon: const Icon(Icons.date_range, size: 17),
              label: Text('${_key(_from)} ← ${_key(_to)}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
            ),
          ),
        ]),
      ),
      if (summary.isNotEmpty)
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
          child: Wrap(spacing: 8, runSpacing: 8, children: [
            Chip2('${tr('رحلات', 'Trips')}: ${_fmt(summary['tripCount'])}', T.navy),
            Chip2('${_fmt(summary['totalKm'], digits: 1)} ${tr('كم', 'km')}', T.violet),
            Chip2('${tr('قيادة', 'Driving')}: ${_hm(summary['totalDriveSec'])}', T.info),
            Chip2('${tr('أقصى سرعة', 'Max')}: ${_fmt(summary['maxSpeed'])}', T.danger),
          ]),
        ),
      Expanded(
        child: _loading
            ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
            : _error != null
                ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                : RefreshIndicator(
                    onRefresh: _load,
                    child: trips.isEmpty
                        ? ListView(children: [const SizedBox(height: 60), EmptyState(icon: Icons.route_outlined, title: tr('لا توجد رحلات في هذه الفترة', 'No trips'))])
                        : ListView.separated(
                            padding: const EdgeInsets.all(14),
                            itemCount: trips.length,
                            separatorBuilder: (_, __) => const SizedBox(height: 8),
                            itemBuilder: (c, i) {
                              final t = trips[i];
                              return AppCard(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    const Icon(Icons.trip_origin, size: 14, color: T.success),
                                    const SizedBox(width: 6),
                                    Expanded(child: Text((t['beginLocation'] ?? '—').toString(), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600))),
                                  ]),
                                  Row(children: [
                                    const Icon(Icons.location_on_outlined, size: 14, color: T.danger),
                                    const SizedBox(width: 6),
                                    Expanded(child: Text((t['endLocation'] ?? '—').toString(), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600))),
                                  ]),
                                  const SizedBox(height: 6),
                                  Wrap(spacing: 6, runSpacing: 6, children: [
                                    Chip2('${_fmt(t['km'], digits: 1)} ${tr('كم', 'km')}', T.violet),
                                    Chip2(_hm(t['durationSec']), T.info),
                                    if (t['maxSpeed'] != null) Chip2('${tr('أقصى', 'Max')}: ${_fmt(t['maxSpeed'])}', T.danger),
                                  ]),
                                ]),
                              );
                            },
                          ),
                  ),
      ),
    ]);
  }
}

// ── المسافة والوقود ─────────────────────────────────────────────────────────
class _DistanceFuelTab extends StatefulWidget {
  final String vehicleId;
  const _DistanceFuelTab({required this.vehicleId});
  @override
  State<_DistanceFuelTab> createState() => _DistanceFuelTabState();
}

class _DistanceFuelTabState extends State<_DistanceFuelTab> {
  Map<String, dynamic>? _mileage;
  Map<String, dynamic>? _fuel;
  List<Map<String, dynamic>> _series = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        Api.instance.get('/api/ls2/vehicles/${widget.vehicleId}/mileage'),
        Api.instance.get('/api/ls2/vehicles/${widget.vehicleId}/fuel').catchError((_) => <String, dynamic>{}),
        Api.instance.get('/api/ls2/vehicles/${widget.vehicleId}/history'),
      ]);
      if (!mounted) return;
      setState(() {
        _mileage = Map<String, dynamic>.from(results[0]);
        _fuel = Map<String, dynamic>.from(results[1]);
        _series = _l(results[2]['series']);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 110), SizedBox(height: 10), Shimmer(height: 110), SizedBox(height: 10), Shimmer(height: 200)]);
    }
    if (_error != null) {
      return ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); });
    }
    final maxKm = _series.fold<num>(1, (m, r) => (_numOrNull(r['km']) ?? 0) > m ? _numOrNull(r['km'])! : m);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        FadeSlideIn(
          child: AppCard(
            topAccent: T.violet,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${tr('المسافة', 'Distance')} (${_mileage?['from'] ?? ''} ← ${_mileage?['to'] ?? ''})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [
                Chip2('${_fmt(_mileage?['km'], digits: 1)} ${tr('كم', 'km')}', T.violet),
                Chip2('${tr('أيام نشطة', 'Active days')}: ${_fmt(_mileage?['activeDays'])}', T.info),
                if (_mileage?['odoStart'] != null) Chip2('${tr('من عداد', 'From')}: ${_fmt(_mileage?['odoStart'])}', T.inkFaint),
                if (_mileage?['odoEnd'] != null) Chip2('${tr('إلى عداد', 'To')}: ${_fmt(_mileage?['odoEnd'])}', T.inkFaint),
              ]),
            ]),
          ),
        ),
        const SizedBox(height: 12),
        FadeSlideIn(
          delayMs: 40,
          child: AppCard(
            topAccent: T.orange,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('الوقود (CAN)', 'Fuel (CAN)'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              const SizedBox(height: 8),
              _fuel?['fuelL'] == null
                  ? Text(tr('لا تتوفر بيانات وقود لهذه المركبة', 'No CAN fuel data for this vehicle'), style: const TextStyle(fontSize: 12.5, color: T.inkSoft))
                  : Wrap(spacing: 8, runSpacing: 8, children: [
                      Chip2('${tr('استهلاك', 'Used')}: ${_fmt(_fuel?['fuelL'], digits: 1)} ${tr('لتر', 'L')}', T.orange),
                      if (_fuel?['efficiencyKmL'] != null) Chip2('${_fmt(_fuel?['efficiencyKmL'], digits: 2)} ${tr('كم/لتر', 'km/L')}', T.success),
                      if (_fuel?['distanceKm'] != null) Chip2('${_fmt(_fuel?['distanceKm'], digits: 1)} ${tr('كم', 'km')}', T.violet),
                    ]),
            ]),
          ),
        ),
        const SizedBox(height: 12),
        if (_series.isNotEmpty)
          FadeSlideIn(
            delayMs: 80,
            child: AppCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(tr('المسافة اليومية', 'Daily distance'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                const SizedBox(height: 10),
                ..._series.reversed.take(14).map((r) {
                  final km = _numOrNull(r['km']) ?? 0;
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Row(children: [
                      SizedBox(width: 74, child: Text((r['date'] ?? '').toString().substring(5), style: const TextStyle(fontSize: 11, color: T.inkSoft))),
                      Expanded(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: LinearProgressIndicator(
                            value: (km / maxKm).clamp(0.02, 1).toDouble(),
                            minHeight: 12,
                            backgroundColor: T.navy.withValues(alpha: 0.06),
                            color: T.navy,
                          ),
                        ),
                      ),
                      SizedBox(width: 58, child: Text(' ${km.round()}', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700))),
                    ]),
                  );
                }),
              ]),
            ),
          ),
        const SizedBox(height: 20),
      ]),
    );
  }
}

// ── التنبيهات ───────────────────────────────────────────────────────────────
class _AlertsTab extends StatelessWidget {
  final List<Map<String, dynamic>> alerts;
  final Future<void> Function() onRefresh;
  const _AlertsTab({required this.alerts, required this.onRefresh});

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: alerts.isEmpty
          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.notifications_off_outlined, title: tr('لا توجد تنبيهات 👌', 'No alerts 👌'))])
          : ListView.separated(
              padding: const EdgeInsets.all(14),
              itemCount: alerts.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (c, i) {
                final a = alerts[i];
                final color = a['severity'] == 'critical' ? T.danger : a['severity'] == 'warning' ? T.warn : T.info;
                return AppCard(
                  topAccent: color,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text((a['message'] ?? a['type'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                      Chip2((a['status'] ?? '').toString() == 'open' ? tr('مفتوح', 'Open') : tr('مغلق', 'Closed'), color),
                    ]),
                    const SizedBox(height: 4),
                    Text(_dt(a['lastSeenAt']), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                  ]),
                );
              },
            ),
    );
  }
}
