import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import '../services/api.dart';
import '../services/lang.dart';
import 'ls2_track_map.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/tire_sensor_badge.dart';
import '../ui/widgets.dart';
import 'reports.dart';
import 'ls2_vehicle_assets.dart';
import 'jp.dart' show JpTaskPanel;
import '../ui/ht_custody_panel.dart';
import 'ls2_maintenance.dart';

/// Vehicle details (Location Solutions), five tabs as on the web: overview (live sensors + tires), maintenance (intervals + service log + deferred items), trips, distance and fuel, and alerts.
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

/// Sensor chip: shows the value; when missing (the sensor does not send or nothing arrives from Location Solutions) it is highlighted as a red warning instead of a silent dash.
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
  // A type picked on the overview's plan card, opened in the Maintenance tab.
  final ValueNotifier<String?> _jumpType = ValueNotifier(null);

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('ls2:updated', _onLive);
    Live.instance.on('ls2:store', _onLive);
    // Identity and documents come from the vehicle registry; edits there show here immediately.
    Live.instance.on('vreg:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('ls2:updated', _onLive);
    Live.instance.off('ls2:store', _onLive);
    Live.instance.off('vreg:updated', _onLive);
    _jumpType.dispose();
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
            tooltip: tr('التقرير الشامل (PDF)', 'Full report (PDF)'),
            icon: const Icon(Icons.assessment_outlined, color: Colors.white),
            // `u<unitId>` — the reporting engine accepts a unit id, a fleet id,
            // a folded plate key or a raw plate, so no caller has to re-derive it.
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ReportsScreen(
              subject: 'vehicle', entityId: 'u${widget.vehicleId}', entityName: widget.plate))),
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
                    _OverviewTab(vehicleId: widget.vehicleId, vehicle: _vehicle!, onRefresh: _load, jumpType: _jumpType),
                    _MaintenanceTab(vehicleId: widget.vehicleId, plate: widget.plate, jumpType: _jumpType),
                    _TripsTab(vehicleId: widget.vehicleId),
                    _DistanceFuelTab(vehicleId: widget.vehicleId),
                    _AlertsTab(alerts: _alerts, onRefresh: _load),
                  ]),
      ),
    );
  }
}

// Overview
class _OverviewTab extends StatelessWidget {
  final String vehicleId;
  final Map<String, dynamic> vehicle;
  final Future<void> Function() onRefresh;
  final ValueNotifier<String?> jumpType;
  const _OverviewTab({required this.vehicleId, required this.vehicle, required this.onRefresh, required this.jumpType});

  // Manual edit of tire brand/type (PATCH /meta); picked up live via ls2:updated.
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
              // Where is it now. "Moving" is the engine state; this is its position within company work (on the way to Jeddah, or unloaded and arrived in Riyadh) from live fleet-management loads (see utils/fleetWhereabouts). Needed before scheduling its overdue maintenance.
              if (_m(v['whereabouts']).isNotEmpty) ...[
                const SizedBox(height: 8),
                Builder(builder: (_) {
                  final w = _m(v['whereabouts']);
                  final phase = (w['phase'] ?? '').toString();
                  final color = {
                    'idle': T.success, 'unloaded': T.cyan, 'arrived': T.info,
                    'moving': T.violet, 'late': T.danger,
                  }[phase] ?? T.warn;
                  final eta = DateTime.tryParse((w['expectedArrival'] ?? '').toString())?.toLocal();
                  return Row(children: [
                    Icon(Icons.local_shipping_outlined, size: 15, color: color),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        [
                          tr((w['whereAr'] ?? '—').toString(), (w['whereEn'] ?? '—').toString()),
                          if (eta != null && phase != 'idle')
                            '${tr('متوقّع', 'ETA')} ${eta.day}/${eta.month} ${eta.hour.toString().padLeft(2, '0')}:${eta.minute.toString().padLeft(2, '0')}',
                          if ((w['waybillNumber'] ?? '').toString().isNotEmpty)
                            '${tr('بوليصة', 'Waybill')} ${w['waybillNumber']}',
                        ].join(' · '),
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: color),
                      ),
                    ),
                  ]);
                }),
              ],
              const SizedBox(height: 10),
              Wrap(spacing: 8, runSpacing: 8, children: [
                _sensor(tr('السرعة', 'Speed'), v['speed'], ' ${tr('كم/س', 'km/h')}', Icons.speed_outlined, T.navy),
                _sensor(tr('العداد', 'Odometer'), v['odometerKm'], ' ${tr('كم', 'km')}', Icons.straighten_outlined, T.violet),
                _sensor(tr('الوقود', 'Fuel'), v['fuelPct'], '%', Icons.local_gas_station_outlined, T.orange),
                _sensor(tr('التبريد', 'Coolant'), v['coolantC'], '°', Icons.thermostat_outlined, T.cyan),
                _sensor(tr('الوزن', 'Weight'), v['weightKg'], ' ${tr('كجم', 'kg')}', Icons.scale_outlined, T.info),
                _sensor(tr('ساعات المحرك', 'Engine hrs'), v['engineHours'], '', Icons.timelapse_outlined, T.inkFaint, digits: 1),
                Chip2('${tr('آخر إشارة', 'Last seen')}: ${_dt(v['lastMessageAt'])}', status == 'offline' ? T.danger : T.inkFaint, icon: Icons.schedule_outlined),
                // Tire sensor coverage, computed server-side as in the two fleet screens.
                if (v['tireSensors'] is Map)
                  TireSensorBadge(cov: _m(v['tireSensors']), plate: (v['plate'] ?? '').toString()),
              ]),
            ]),
          ),
        ),
        // General warning: vehicle offline, so all data may be stale.
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
                  final noData = temp == null && press == null; // Sensor is not sending
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
          // No tire data at all from Location Solutions: explicit warning.
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
          delayMs: 90,
          child: _PlanCard(
            unitId: int.tryParse(vehicleId) ?? 0,
            intervals: _l(maintenance['intervals']),
            onOpenType: (t) {
              jumpType.value = t;
              DefaultTabController.of(context).animateTo(1);
            },
          ),
        ),
        if (_m(v['position'])['lat'] != null && _m(v['position'])['lng'] != null) ...[
          const SizedBox(height: 12),
          FadeSlideIn(delayMs: 95, child: _LiveLocationCard(vehicle: v)),
        ],
        const SizedBox(height: 12),
        // Identity from the vehicle registry; the device values are shown as "per device"
        FadeSlideIn(delayMs: 100, child: _RegistryCard(registry: _m(v['registry']), conflicts: _m(v['conflicts']), profile: profile)),
        const SizedBox(height: 12),
        FadeSlideIn(
          delayMs: 120,
          child: AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(tr('بيانات المركبة — حسب الجهاز', 'Vehicle profile — per device'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
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
        if ('${v['_id'] ?? ''}'.isNotEmpty) ...[
          const SizedBox(height: 12),
          JpTaskPanel(section: 'ls2', kind: 'truck', refId: '${v['_id']}'),
        ],
        // Heavy-transport custody attributed to this truck, live with the ledger.
        if ('${v['unitId'] ?? ''}'.isNotEmpty) ...[
          const SizedBox(height: 12),
          HtCustodyPanel(vehicleUnitId: '${v['unitId']}'),
        ],
        const SizedBox(height: 20),
      ]),
    );
  }
}

/// Truck identity from the vehicle registry (VehicleMaster), like RegistryIdentityCard on the web: plate, make, model, year, chassis, sector and documents. The device year and chassis appear below as "per device", with a flag where they differ.
class _RegistryCard extends StatelessWidget {
  final Map<String, dynamic> registry;
  final Map<String, dynamic> conflicts;
  final Map<String, dynamic> profile;
  const _RegistryCard({required this.registry, required this.conflicts, required this.profile});

  static const _docs = [
    ('vehicleLicense', 'رخصة السير', 'Vehicle license'),
    ('inspection', 'الفحص الدوري', 'Inspection'),
    ('insurance', 'التأمين', 'Insurance'),
    ('operatingCard', 'بطاقة التشغيل', 'Operating card'),
    ('authorization', 'التفويض', 'Authorisation'),
  ];
  static const _states = {
    'expired': ('منتهي', 'Expired', T.danger),
    'critical': ('حرج', 'Critical', Color(0xFFEA580C)),
    'warning': ('تحذير', 'Warning', T.warn),
    'upcoming': ('قريب', 'Upcoming', Color(0xFF0EA5E9)),
    'valid': ('ساري', 'Valid', T.success),
    'missing': ('مطلوب — بلا تاريخ', 'Needed — no date', T.inkFaint),
    'not_applicable': ('غير مطلوب', 'Not applicable', T.inkSoft),
  };

  String _s(dynamic v) => (v ?? '').toString();

  Widget _line(String label, String value, {String? device, bool warn = false}) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text('$label: ', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
            Expanded(child: Text(value.isEmpty ? '—' : value, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: warn ? T.warn : T.ink))),
          ]),
          if ((device ?? '').isNotEmpty)
            Text('${tr('حسب الجهاز', 'per device')}: $device', style: TextStyle(fontSize: 11, color: warn ? T.warn : T.inkFaint)),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    if (registry.isEmpty) {
      return AppCard(
        child: Text(tr('هذه الوحدة غير مربوطة بمركبةٍ في سجلّ المركبات — لوحتُها لا تطابق أيّ لوحةٍ هناك.', 'This unit is not linked to a vehicle in the registry.'),
            style: const TextStyle(fontSize: 12, color: T.inkSoft)),
      );
    }
    final yc = conflicts['year'] is Map ? Map<String, dynamic>.from(conflicts['year']) : null;
    final vc = conflicts['vin'] is Map ? Map<String, dynamic>.from(conflicts['vin']) : null;
    final partial = vc?['partial'] == true;
    final docs = registry['docs'] is Map ? Map<String, dynamic>.from(registry['docs']) : <String, dynamic>{};
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.storage_rounded, size: 16, color: T.navy),
          const SizedBox(width: 6),
          Expanded(child: Text(tr('من سجلّ المركبات', 'From the vehicle registry'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
          if (yc != null || (vc != null && !partial)) Chip2(tr('تعارض', 'Mismatch'), T.warn, icon: Icons.warning_amber_rounded),
        ]),
        const SizedBox(height: 6),
        _line(tr('اللوحة', 'Plate'), _s(registry['plateNumber'])),
        _line(tr('الماركة والطراز', 'Brand & model'), [registry['brand'], registry['model']].where((x) => _s(x).isNotEmpty).join(' · '), device: _s(profile['brand'])),
        _line(tr('سنة الصنع', 'Model year'), _s(registry['modelYear']),
            device: _s(profile['modelYear']).isEmpty ? null : '${profile['modelYear']}${yc != null ? tr(' — يخالف السجلّ', ' — differs') : ''}', warn: yc != null),
        _line(tr('رقم الشاسيه', 'Chassis no.'), _s(registry['chassisNumber']),
            device: _s(profile['vin']).isEmpty ? null : '${profile['vin']}${vc != null ? (partial ? tr(' — جزئيّ', ' — partial') : tr(' — يخالف السجلّ', ' — differs')) : ''}', warn: vc != null && !partial),
        _line(tr('القطاع', 'Sector'), _s(registry['sector'])),
        if (_s(registry['authorizedPerson']).isNotEmpty) _line(tr('المفوَّض', 'Authorised person'), _s(registry['authorizedPerson'])),
        const SizedBox(height: 4),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final d in _docs)
            if (docs[d.$1] is Map)
              Builder(builder: (_) {
                final doc = Map<String, dynamic>.from(docs[d.$1]);
                final st = _states[_s(doc['state'])] ?? (_s(doc['state']), _s(doc['state']), T.inkFaint);
                final date = _s(doc['expiryDate']);
                return Chip2('${tr(d.$2, d.$3)}: ${date.length >= 10 ? date.substring(0, 10) : tr(st.$1, st.$2)}', st.$3);
              }),
        ]),
      ]),
    );
  }
}

// Maintenance
class _MaintenanceTab extends StatefulWidget {
  final String vehicleId;
  final String plate;
  final ValueNotifier<String?> jumpType;
  const _MaintenanceTab({required this.vehicleId, required this.plate, required this.jumpType});
  @override
  State<_MaintenanceTab> createState() => _MaintenanceTabState();
}

class _MaintenanceTabState extends State<_MaintenanceTab> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  // Ledger entries of this truck (all sources, cancelled records included for display only).
  List<Map<String, dynamic>> _entries = [];
  // Types whose card is open; nothing is open until a tile is tapped.
  final Set<String> _open = {};
  late final void Function(dynamic) _onLive;
  late final void Function() _onStore;
  final Map<String, GlobalKey> _cardKeys = {for (final t in kMaintTypes) t.$1: GlobalKey()};

  // Opens the type picked on the overview and scrolls to its card once it is built.
  void _onJump() {
    final t = widget.jumpType.value;
    if (t == null) return;
    widget.jumpType.value = null;
    setState(() => _open.add(t));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ctx = _cardKeys[t]?.currentContext;
      if (ctx != null) Scrollable.ensureVisible(ctx, duration: const Duration(milliseconds: 300), alignment: 0.05);
    });
  }

  @override
  void initState() {
    super.initState();
    widget.jumpType.addListener(_onJump);
    if (widget.jumpType.value != null) WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) _onJump(); });
    _load();
    // The poller's pulse carries `vehicles`; only real writes reload.
    _onLive = (d) { if (d is! Map || d['vehicles'] == null) _load(); };
    Live.instance.onData('ls2:updated', _onLive);
    _onStore = () => _load();
    Live.instance.on('ls2:store', _onStore);
  }

  @override
  void dispose() {
    widget.jumpType.removeListener(_onJump);
    Live.instance.offData('ls2:updated', _onLive);
    Live.instance.off('ls2:store', _onStore);
    super.dispose();
  }

  Future<void> _addRecord(String type) async {
    final vehicle = _m(_d?['vehicle']);
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => MaintenanceRecordSheet(unitId: int.tryParse(widget.vehicleId) ?? 0, type: type, odometer: _numOrNull(vehicle['odometerKm'])),
    );
    if (saved == true) _load();
  }

  Future<void> _load() async {
    try {
      final res = await Future.wait([
        Api.instance.get('/api/ls2/vehicles/${widget.vehicleId}/maintenance'),
        loadMaintenanceEntries(unitId: int.tryParse(widget.vehicleId), includeCancelled: true),
      ]);
      if (!mounted) return;
      setState(() {
        _d = Map<String, dynamic>.from(res[0] as Map);
        _entries = res[1] as List<Map<String, dynamic>>;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  // Log a service: follows the selected interval; the checklist comes from the settings templates.
  Future<void> _registerService(Map<String, dynamic> interval) async {
    final vehicle = _m(_d?['vehicle']);
    final checklists = _m(_d?['checklists']);
    final name = (interval['name'] ?? '').toString();
    final numMatch = RegExp(r'^\s*(\d+)').firstMatch(name);
    final key = numMatch?.group(1) ?? name;
    final template = _l(checklists[key] ?? checklists[name]);

    final odometer = TextEditingController(text: _fmt(vehicle['odometerKm']));
    final notes = TextEditingController();
    // status per checklist row: done | deferred | na
    final rowStatus = <int, String>{for (var i = 0; i < template.length; i++) i: 'done'};
    final rowDefer = <int, TextEditingController>{for (var i = 0; i < template.length; i++) i: TextEditingController(text: '$kMinDeferKm')};
    // Spare parts from the heavy store.
    final parts = <PartLine>[];

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
              Expanded(
                child: ListView(children: [
              TextField(controller: odometer, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('العداد (كم) *', 'Odometer (km) *'))),
              const SizedBox(height: 10),
              TextField(controller: notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
              const SizedBox(height: 12),
              Text(tr('قطع الغيار (من مخزن النقل الثقيل)', 'Spare parts (heavy store)'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14.5, color: T.ink)),
              const SizedBox(height: 6),
              StorePartsEditor(lines: parts, onChanged: () => setS(() {})),
              const SizedBox(height: 12),
              if (template.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(tr('قائمة الفحص', 'Checklist'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14.5, color: T.ink)),
                Text(tr('التأجيل مسموح فقط لمسافة ${_fmt(kMinDeferKm)} كم أو أكثر.', 'Deferral needs at least $kMinDeferKm km.'), style: const TextStyle(fontSize: 12, color: T.inkSoft, fontWeight: FontWeight.w600)),
                const SizedBox(height: 6),
                ...List.generate(template.length, (i) {
                      final row = template[i];
                      final label = (row['labelAr'] ?? row['label'] ?? '').toString();
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(label, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: T.ink)),
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
                                  onChanged: (_) => setS(() {}),
                                  decoration: InputDecoration(
                                    labelText: tr('+كم', '+km'), isDense: true,
                                    errorText: (num.tryParse(rowDefer[i]!.text) ?? 0) < kMinDeferKm ? '≥$kMinDeferKm' : null,
                                  ),
                                ),
                              ),
                            ],
                          ]),
                        ]),
                      );
                }),
              ],
                ]),
              ),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () async {
                    final shortDefer = [for (var i = 0; i < template.length; i++) i]
                        .any((i) => rowStatus[i] == 'deferred' && (num.tryParse(rowDefer[i]!.text) ?? 0) < kMinDeferKm);
                    final problem = partsProblem(parts) ??
                        (shortDefer ? tr('التأجيل مسموح فقط لمسافة $kMinDeferKm كم أو أكثر', 'Deferral needs at least $kMinDeferKm km') : null);
                    if (problem != null) {
                      ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(problem)));
                      return;
                    }
                    try {
                      await Api.instance.post('/api/ls2/vehicles/${widget.vehicleId}/register-service', {
                        'intervalId': interval['id'],
                        'odometerKm': num.tryParse(odometer.text),
                        if (notes.text.trim().isNotEmpty) 'notes': notes.text.trim(),
                        'parts': [for (final p in parts) {'item': p.item['_id'], 'quantity': p.quantity}],
                        if (template.isNotEmpty)
                          'checklist': [
                            for (var i = 0; i < template.length; i++)
                              {
                                'label': (template[i]['label'] ?? template[i]['labelAr'] ?? '').toString(),
                                'labelAr': (template[i]['labelAr'] ?? '').toString(),
                                'status': rowStatus[i],
                                if (rowStatus[i] == 'deferred') 'deferKm': num.tryParse(rowDefer[i]!.text) ?? kMinDeferKm,
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
    final addKm = TextEditingController(text: '$kMinDeferKm');
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
            TextField(controller: addKm, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('تمديد (كم)', 'Extend (km)'), helperText: tr('الحدّ الأدنى $kMinDeferKm كم', 'Minimum $kMinDeferKm km'))),
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
        if (action == 'defer') 'addKm': num.tryParse(addKm.text) ?? kMinDeferKm,
        if (note.text.trim().isNotEmpty) 'note': note.text.trim(),
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Widget _intervalCard(Map<String, dynamic> iv) {
    final level = (iv['statusLevel'] ?? 'ok').toString();
    final color = level == 'overdue' ? T.danger : level == 'due' ? T.warn : T.success;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        topAccent: color,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text((iv['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
            Chip2(level == 'overdue' ? tr('متأخرة', 'Overdue') : level == 'due' ? tr('مستحقة', 'Due') : tr('سليمة', 'OK'), color),
          ]),
          const SizedBox(height: 5),
          Wrap(spacing: 6, runSpacing: 6, children: [
            if (iv['remainingKm'] != null) Chip2('${tr('المتبقي', 'Remaining')}: ${_fmt(iv['remainingKm'])} ${tr('كم', 'km')}', color),
            if (iv['nextServiceKm'] != null) Chip2('${tr('عند', 'At')}: ${_fmt(iv['nextServiceKm'])} ${tr('كم', 'km')}', T.navy),
            if (iv['lastServiceAt'] != null) Chip2('${tr('آخر خدمة', 'Last')}: ${_dt(iv['lastServiceAt']).split(' ').first}', T.inkFaint),
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
  }

  Widget _deferralCard(Map<String, dynamic> d) => Padding(
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
            FilledButton.tonal(onPressed: () => _resolveDeferral(d), child: Text(tr('إنهاء', 'Resolve'), style: const TextStyle(fontSize: 12))),
          ]),
        ),
      );

  /// One type's own card: its full history, plus the interval plan for periodic and «سجل جديد» for the others.
  Widget _typeCard(String type, List<Map<String, dynamic>> intervals, List<Map<String, dynamic>> deferrals) {
    final color = maintTypeColor(type);
    final rows = _entries.where((e) => e['type'] == type).toList();
    return Padding(
      key: _cardKeys[type],
      padding: const EdgeInsets.only(top: 12),
      child: AppCard(
        topAccent: color,
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(kMaintIcons[type], color: color, size: 20),
            const SizedBox(width: 6),
            Expanded(child: Text(maintTypeLabel(type), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15))),
            if (type != 'periodic')
              FilledButton.icon(
                onPressed: () => _addRecord(type),
                style: FilledButton.styleFrom(visualDensity: VisualDensity.compact),
                icon: const Icon(Icons.add, size: 17),
                label: Text(tr('سجل جديد', 'New record'), style: const TextStyle(fontSize: 12.5)),
              ),
            IconButton(
              visualDensity: VisualDensity.compact, tooltip: tr('إغلاق', 'Close'),
              onPressed: () => setState(() => _open.remove(type)), icon: const Icon(Icons.close, size: 18, color: T.inkFaint),
            ),
          ]),
          if (type == 'periodic') ...[
            const SizedBox(height: 8),
            Text(tr('فواصل الخدمة', 'Service intervals'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
            const SizedBox(height: 6),
            if (intervals.isEmpty) Text(tr('لا توجد فواصل خدمة لهذه المركبة', 'No service intervals for this vehicle'), style: const TextStyle(color: T.inkFaint, fontSize: 12)),
            ...intervals.map(_intervalCard),
            if (deferrals.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(tr('مهام مؤجلة', 'Deferred tasks'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
              const SizedBox(height: 6),
              ...deferrals.map(_deferralCard),
            ],
          ],
          const SizedBox(height: 8),
          Text('${tr('السجل الكامل', 'Full history')} (${rows.where((e) => e['cancelled'] != true).length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
          const SizedBox(height: 6),
          if (rows.isEmpty) Text(tr('لا توجد سجلات من هذا النوع لهذه المركبة.', 'No entries of this type for this vehicle.'), style: const TextStyle(color: T.inkFaint, fontSize: 12)),
          for (final e in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: MaintenanceEntryCard(e: e, onCancel: () async { if (await cancelMaintenanceRecord(context, e)) _load(); }),
            ),
        ]),
      ),
    );
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
    final summary = maintenanceTypeSummary(_entries);

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        Text(tr('سجلات الصيانة حسب النوع', 'Maintenance by type'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
        const SizedBox(height: 8),
        MaintenanceTypeGrid(
          summary: summary, open: _open,
          onToggle: (t) => setState(() => _open.contains(t) ? _open.remove(t) : _open.add(t)),
        ),
        if (deferrals.isNotEmpty && !_open.contains('periodic')) ...[
          const SizedBox(height: 8),
          Chip2('${deferrals.length} ${tr('مهمة مؤجلة — في الصيانة الدورية', 'deferred tasks — under periodic')}', T.warn, icon: Icons.schedule),
        ],
        for (final t in kMaintTypes)
          if (_open.contains(t.$1)) _typeCard(t.$1, intervals, deferrals),
        const SizedBox(height: 20),
      ]),
    );
  }
}

// Trips
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

// Distance and fuel
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
        Api.instance.get('/api/ls2/vehicles/${widget.vehicleId}/mileage').catchError((_) => <String, dynamic>{}),
        Api.instance.get('/api/ls2/vehicles/${widget.vehicleId}/fuel').catchError((_) => <String, dynamic>{}),
        Api.instance.get('/api/ls2/vehicles/${widget.vehicleId}/history').catchError((_) => <String, dynamic>{}),
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

// Alerts
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


/// Live position on a map that fills the card width; height follows the width (220 to 420).
class _LiveLocationCard extends StatelessWidget {
  final Map<String, dynamic> vehicle;
  const _LiveLocationCard({required this.vehicle});

  @override
  Widget build(BuildContext context) {
    final pos = _m(vehicle['position']);
    final point = LatLng(_numOrNull(pos['lat'])!.toDouble(), _numOrNull(pos['lng'])!.toDouble());
    return Container(
      decoration: BoxDecoration(color: T.card, borderRadius: BorderRadius.circular(16), border: Border.all(color: T.line), boxShadow: T.softShadow),
      clipBehavior: Clip.antiAlias,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
          child: Row(children: [
            const Icon(Icons.my_location, size: 18, color: T.orange),
            const SizedBox(width: 6),
            Expanded(child: Text(tr('الموقع المباشر', 'Live location'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
            Text(_dt(vehicle['lastMessageAt']), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          ]),
        ),
        LayoutBuilder(builder: (c, box) {
          final h = (box.maxWidth * 0.6).clamp(220.0, 420.0);
          return SizedBox(
            width: box.maxWidth, height: h,
            child: FlutterMap(
              // A new key per position recentres the map when the truck moves.
              key: ValueKey('${point.latitude},${point.longitude}'),
              options: MapOptions(initialCenter: point, initialZoom: 13),
              children: [
                TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'com.energize.energizeMobile'),
                MarkerLayer(markers: [
                  Marker(point: point, width: 40, height: 40, child: const Icon(Icons.local_shipping, color: T.orange, size: 32)),
                ]),
              ],
            ),
          );
        }),
      ]),
    );
  }
}

/// Service plan on the overview: the periodic intervals, then one summary row per other maintenance type.
class _PlanCard extends StatefulWidget {
  final int unitId;
  final List<Map<String, dynamic>> intervals;
  final void Function(String type) onOpenType;
  const _PlanCard({required this.unitId, required this.intervals, required this.onOpenType});
  @override
  State<_PlanCard> createState() => _PlanCardState();
}

class _PlanCardState extends State<_PlanCard> {
  List<Map<String, dynamic>> _entries = [];
  late final void Function(dynamic) _onLive;
  late final void Function() _onStore;

  @override
  void initState() {
    super.initState();
    _load();
    // The poller's pulse carries `vehicles`; only real writes reload.
    _onLive = (d) { if (d is! Map || d['vehicles'] == null) _load(); };
    _onStore = () => _load();
    Live.instance.onData('ls2:updated', _onLive);
    Live.instance.on('ls2:store', _onStore);
  }

  @override
  void dispose() {
    Live.instance.offData('ls2:updated', _onLive);
    Live.instance.off('ls2:store', _onStore);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final rows = await loadMaintenanceEntries(unitId: widget.unitId);
      if (mounted) setState(() => _entries = rows);
    } catch (_) { /* keep the last figures */ }
  }

  @override
  Widget build(BuildContext context) {
    final summary = maintenanceTypeSummary(_entries);
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(tr('خطة الصيانة', 'Service plan'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
        const SizedBox(height: 6),
        if (widget.intervals.isEmpty) Text(tr('لا توجد فواصل خدمة', 'No service intervals'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
        for (final iv in widget.intervals)
          Padding(
            padding: const EdgeInsets.only(bottom: 5),
            child: Row(children: [
              Expanded(child: Text('${iv['name'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700))),
              Builder(builder: (_) {
                final level = '${iv['statusLevel'] ?? 'ok'}';
                final rem = _numOrNull(iv['remainingKm']);
                final color = level == 'overdue' ? T.danger : level == 'due' ? T.warn : T.success;
                return Chip2(rem == null ? '—' : rem < 0 ? '−${_fmt(rem.abs())} ${tr('كم متأخرة', 'km over')}' : '${_fmt(rem)} ${tr('كم متبقية', 'km left')}', color);
              }),
            ]),
          ),
        const Divider(height: 18),
        for (final t in kMaintTypes.where((t) => t.$1 != 'periodic'))
          InkWell(
            onTap: () => widget.onOpenType(t.$1),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(children: [
                Icon(kMaintIcons[t.$1], size: 18, color: t.$4),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${tr(t.$2, t.$3)} · ${summary[t.$1]!.$1} ${tr('سجل', 'entries')}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
                    Builder(builder: (_) {
                      final latest = _entries.firstWhere((e) => e['type'] == t.$1 && e['cancelled'] != true, orElse: () => const {});
                      final last = summary[t.$1]!.$2;
                      return Text(
                        last.isEmpty ? tr('لا توجد سجلات', 'No entries') : '${tr('آخرها', 'Latest')} $last${'${latest['title'] ?? ''}'.isNotEmpty ? ' · ${latest['title']}' : ''}',
                        maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: T.inkSoft),
                      );
                    }),
                  ]),
                ),
                Text('${_fmt(summary[t.$1]!.$3)} ${tr('ر.س', 'SAR')}', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w900, color: t.$4)),
                const Icon(Icons.chevron_right, size: 18, color: T.inkFaint),
              ]),
            ),
          ),
      ]),
    );
  }
}
