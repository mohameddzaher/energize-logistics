import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'ls2_vehicles.dart';
import 'ls2_alerts.dart';
import 'ls2_common.dart';
import 'ls2_live.dart';

/// Location Solutions dashboard: live fleet status, alerts, due maintenance, temperature and period distances, the same sections as the web dashboard.
class Ls2DashboardScreen extends StatefulWidget {
  const Ls2DashboardScreen({super.key});
  @override
  State<Ls2DashboardScreen> createState() => _Ls2DashboardScreenState();
}

class _Ls2DashboardScreenState extends State<Ls2DashboardScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  DateTimeRange _range = ls2ThisMonthToDate();
  int _seq = 0;
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
    final seq = ++_seq;
    try {
      final d = await Api.instance.get('/api/ls2/dashboard?from=${ls2Ymd(_range.start)}&to=${ls2Ymd(_range.end)}');
      if (!mounted || seq != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  num _n(dynamic v) => v is num ? v : 0;
  Map<String, dynamic> _m(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : {};
  List<Map<String, dynamic>> _l(dynamic v) =>
      v is List ? List<Map<String, dynamic>>.from(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : const [];

  void _open(Widget screen) => Navigator.push(context, MaterialPageRoute(builder: (_) => screen));

  // "Details" line under the card: shows it is tappable.
  Widget _more() => Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Row(mainAxisAlignment: MainAxisAlignment.end, children: [
          Text(tr('التفاصيل', 'Details'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.navy)),
          Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, size: 18, color: T.navy),
        ]),
      );

  /// One file mirroring every panel on the screen; the same export sheets as the web.
  Future<void> _export() async {
    final d = _d;
    if (d == null) return;
    final fleet = _m(d['fleet']);
    final sc = _m(fleet['statusCounts']);
    final alerts = _m(d['alerts']);
    final sev = _m(alerts['bySeverity']);
    final maint = _m(d['maintenance']);
    final temp = _m(d['temperature']);
    final dist = _m(d['distance']);
    final kv = [ExportCol('المؤشر', 'Metric', (r) => r['metric']), ExportCol('القيمة', 'Value', (r) => r['value'] ?? '')];
    List<ExportCol> veh(List<ExportCol> extra) => [ExportCol('اللوحة', 'Plate', (r) => r['plate'] ?? r['unitId'] ?? ''), ExportCol('السائق', 'Driver', (r) => r['driver'] ?? ''), ...extra];
    final summary = [
      {'metric': tr('إجمالي المركبات', 'Total vehicles'), 'value': fleet['total']},
      {'metric': tr('متصلة', 'Online'), 'value': fleet['online']},
      for (final k in ['moving', 'idle', 'stopped', 'offline']) {'metric': tr(ls2Status(k).$1, ls2Status(k).$2), 'value': sc[k] ?? 0},
      {'metric': tr('تنبيهات مفتوحة', 'Open alerts'), 'value': alerts['totalOpen']},
      {'metric': tr('مركبات عليها تنبيهات', 'Vehicles with alerts'), 'value': alerts['vehiclesWithAlerts']},
      for (final k in ['critical', 'warning', 'info']) {'metric': '${tr('تنبيهات', 'Alerts')} — ${tr(ls2Severity(k).$1, ls2Severity(k).$2)}', 'value': sev[k] ?? 0},
      {'metric': tr('صيانة متأخرة', 'Service overdue'), 'value': maint['overdueCount']},
      {'metric': tr('صيانة قريبة', 'Service due'), 'value': maint['dueCount']},
      {'metric': '${tr('متوسط حرارة الكاوتش', 'Avg tire temp')} (°C)', 'value': temp['avgTireTempC'] ?? ''},
      {'metric': '${tr('أقصى حرارة كاوتش', 'Max tire temp')} (°C)', 'value': temp['maxTireTempC'] ?? ''},
      {'metric': '${tr('متوسط حرارة الموتور', 'Avg engine temp')} (°C)', 'value': temp['avgCoolantC'] ?? ''},
      {'metric': '${tr('أقصى حرارة موتور', 'Max engine temp')} (°C)', 'value': temp['maxCoolantC'] ?? ''},
      {'metric': tr('كاوتش ساخن', 'Hot tires'), 'value': temp['hotTires']},
      {'metric': tr('موتور ساخن', 'Hot engines'), 'value': temp['hotEngines']},
      {'metric': '${tr('إجمالي المسافة', 'Total distance')} (${tr('كم', 'km')}) · ${dist['from'] ?? ls2Ymd(_range.start)} → ${dist['to'] ?? ls2Ymd(_range.end)}', 'value': dist['totalKm'] ?? 0},
      {'metric': tr('مركبات تحركت', 'Vehicles moved'), 'value': dist['movedVehicles'] ?? 0},
      {'metric': '${tr('متوسط المركبة', 'Avg per vehicle')} (${tr('كم', 'km')})', 'value': dist['avgKm'] ?? 0},
    ];
    final byType = _m(alerts['byType']).entries.map((e) => {'type': ls2AlertType(e.key), 'count': e.value}).toList()
      ..sort((a, b) => (ls2Num(b['count']) ?? 0).compareTo(ls2Num(a['count']) ?? 0));
    await exportExcel(context, fileName: 'ls2-dashboard', sheets: [
      (tr('الملخص', 'Summary'), kv, summary),
      (tr('التنبيهات حسب النوع', 'Alerts by type'), [ExportCol('النوع', 'Type', (r) => r['type']), ExportCol('العدد', 'Count', (r) => r['count'])], byType),
      (tr('الأعلى مسافة', 'Top distance'), veh([ExportCol('المسافة (كم)', 'Distance (km)', (r) => r['km'] ?? '')]), _l(dist['topMovers'])),
      (tr('الأسخن كواتش', 'Hottest tires'), veh([ExportCol('الحرارة °C', 'Temp °C', (r) => r['value'] ?? '')]), _l(temp['topHotTires'])),
      (tr('الأقرب للصيانة', 'Nearest to service'), veh([
        ExportCol('العداد كم', 'Odometer km', (r) => r['odometerKm'] ?? ''),
        ExportCol('المتبقي للصيانة كم', 'Km to service', (r) => r['kmToService'] ?? ''),
        ExportCol('الحالة', 'Status', (r) => tr(ls2Maint(r['statusLevel']).$1, ls2Maint(r['statusLevel']).$2)),
      ]), _l(maint['nearest'])),
      (tr('أحدث التنبيهات', 'Latest alerts'), [
        ExportCol('اللوحة', 'Plate', (r) => r['plate'] ?? r['unitId'] ?? ''),
        ExportCol('النوع', 'Type', (r) => ls2AlertType(r['type'])),
        ExportCol('الخطورة', 'Severity', (r) => tr(ls2Severity(r['severity']).$1, ls2Severity(r['severity']).$2)),
        const ExportCol('الرسالة', 'Message', ls2AlertMessage),
        ExportCol('آخر رصد', 'Last seen', (r) => ls2DateTime(r['lastSeenAt'])),
      ], _l(alerts['latest'])),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final fleet = _m(_d?['fleet']);
    final statusCounts = _m(fleet['statusCounts']);
    final alerts = _m(_d?['alerts']);
    final bySeverity = _m(alerts['bySeverity']);
    final maintenance = _m(_d?['maintenance']);
    final temperature = _m(_d?['temperature']);
    final distance = _m(_d?['distance']);

    return AppScaffold(
      title: Text(tr('لوحة لوكيشن سوليوشن', 'LS2 Dashboard')),
      actions: [IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export)],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 100), SizedBox(height: 10), Shimmer(height: 100), SizedBox(height: 10), Shimmer(height: 160)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    // The period drives the distances panel, like RangePicker on the web.
                    Ls2RangeBar(value: _range, onChanged: (r) { setState(() => _range = r); _load(); }),
                    const SizedBox(height: 10),
                    // Fleet status (opens the live fleet, like the web).
                    FadeSlideIn(
                      child: Pressable(
                        onTap: () => _open(const Ls2LiveScreen()),
                        child: AppCard(
                          topAccent: T.navy,
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(tr('حالة الأسطول الآن', 'Fleet status'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const SizedBox(height: 10),
                            Wrap(spacing: 8, runSpacing: 8, children: [
                              Chip2('${tr('الإجمالي', 'Total')}: ${_n(fleet['total'])}', T.navy, icon: Icons.local_shipping_outlined),
                              Chip2('${tr('متصلة', 'Online')}: ${_n(fleet['online'])}', T.success, icon: Icons.wifi),
                              Chip2('${tr('متحركة', 'Moving')}: ${_n(statusCounts['moving'])}', T.success),
                              Chip2('${tr('متوقفة مؤقتًا', 'Idle')}: ${_n(statusCounts['idle'])}', T.warn),
                              Chip2('${tr('واقفة', 'Stopped')}: ${_n(statusCounts['stopped'])}', T.info),
                              Chip2('${tr('غير متصلة', 'Offline')}: ${_n(statusCounts['offline'])}', T.inkFaint),
                            ]),
                            _more(),
                          ]),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // Alerts.
                    FadeSlideIn(
                      delayMs: 40,
                      child: Pressable(
                        onTap: () => _open(const Ls2AlertsScreen()),
                        child: AppCard(
                        topAccent: _n(bySeverity['critical']) > 0 ? T.danger : T.warn,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Text(tr('التنبيهات المفتوحة', 'Open alerts'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const Spacer(),
                            Chip2('${_n(alerts['totalOpen'])}', T.danger),
                          ]),
                          const SizedBox(height: 8),
                          Wrap(spacing: 8, runSpacing: 8, children: [
                            Chip2('${tr('حرجة', 'Critical')}: ${_n(bySeverity['critical'])}', T.danger),
                            Chip2('${tr('تحذير', 'Warning')}: ${_n(bySeverity['warning'])}', T.warn),
                            Chip2('${tr('معلومة', 'Info')}: ${_n(bySeverity['info'])}', T.info),
                            Chip2('${tr('مركبات متأثرة', 'Vehicles')}: ${_n(alerts['vehiclesWithAlerts'])}', T.navy),
                          ]),
                          ..._l(alerts['latest']).take(5).map((a) => Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Row(children: [
                              Icon(Icons.circle, size: 8, color: a['severity'] == 'critical' ? T.danger : a['severity'] == 'warning' ? T.warn : T.info),
                              const SizedBox(width: 8),
                              Expanded(child: Text('${a['plate'] ?? ''} — ${a['message'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5))),
                            ]),
                          )),
                          _more(),
                        ]),
                      ),
                    )),
                    const SizedBox(height: 12),
                    // Maintenance.
                    FadeSlideIn(
                      delayMs: 80,
                      child: Pressable(
                        onTap: () => _open(const Ls2VehiclesScreen()),
                        child: AppCard(
                        topAccent: _n(maintenance['overdueCount']) > 0 ? T.danger : T.success,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('الصيانة', 'Maintenance'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 8),
                          Wrap(spacing: 8, runSpacing: 8, children: [
                            Chip2('${tr('متأخرة', 'Overdue')}: ${_n(maintenance['overdueCount'])}', T.danger, icon: Icons.build_outlined),
                            Chip2('${tr('مستحقة قريبًا', 'Due soon')}: ${_n(maintenance['dueCount'])}', T.warn, icon: Icons.schedule_outlined),
                          ]),
                          ..._l(maintenance['nearest']).take(6).map((v) => Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Row(children: [
                              Expanded(child: Text('${v['plate'] ?? ''} · ${v['driver'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700))),
                              Chip2(
                                v['kmToService'] == null ? '—' : '${_n(v['kmToService']).round()} ${tr('كم', 'km')}',
                                v['statusLevel'] == 'overdue' ? T.danger : v['statusLevel'] == 'due' ? T.warn : T.success,
                              ),
                            ]),
                          )),
                          _more(),
                        ]),
                      ),
                    )),
                    const SizedBox(height: 12),
                    // Temperature.
                    FadeSlideIn(
                      delayMs: 120,
                      child: AppCard(
                        topAccent: T.orange,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('حرارة الإطارات والمحرك', 'Temperatures'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 8),
                          if (temperature['avgTireTempC'] == null && temperature['avgCoolantC'] == null)
                            Row(children: [
                              const Icon(Icons.warning_amber_rounded, size: 15, color: T.danger),
                              const SizedBox(width: 6),
                              Expanded(child: Text(tr('لا تصل بيانات حرارة من لوكيشن سوليوشن حاليًا', 'No temperature data from Location Solutions'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.danger))),
                            ])
                          else
                            Wrap(spacing: 8, runSpacing: 8, children: [
                              if (temperature['avgTireTempC'] != null) Chip2('${tr('متوسط الإطار', 'Avg tire')}: ${_n(temperature['avgTireTempC']).toStringAsFixed(1)}°', T.info),
                              if (temperature['maxTireTempC'] != null) Chip2('${tr('أقصى إطار', 'Max tire')}: ${_n(temperature['maxTireTempC']).toStringAsFixed(1)}°', T.danger),
                              if (temperature['avgCoolantC'] != null) Chip2('${tr('متوسط التبريد', 'Avg coolant')}: ${_n(temperature['avgCoolantC']).toStringAsFixed(1)}°', T.cyan),
                              Chip2('${tr('إطارات ساخنة', 'Hot tires')}: ${_n(temperature['hotTires'])}', T.orange),
                              Chip2('${tr('محركات ساخنة', 'Hot engines')}: ${_n(temperature['hotEngines'])}', T.danger),
                            ]),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // Period distances.
                    FadeSlideIn(
                      delayMs: 160,
                      child: AppCard(
                        topAccent: T.violet,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${tr('المسافات', 'Distance')} (${distance['from'] ?? ''} ← ${distance['to'] ?? ''})',
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 8),
                          Wrap(spacing: 8, runSpacing: 8, children: [
                            Chip2('${tr('إجمالي', 'Total')}: ${_n(distance['totalKm']).round()} ${tr('كم', 'km')}', T.violet),
                            Chip2('${tr('تحركت', 'Moved')}: ${_n(distance['movedVehicles'])}', T.success),
                            Chip2('${tr('متوسط', 'Avg')}: ${_n(distance['avgKm']).round()} ${tr('كم', 'km')}', T.info),
                          ]),
                          ..._l(distance['topMovers']).take(6).map((v) => Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Row(children: [
                              Expanded(child: Text('${v['plate'] ?? ''} · ${v['driver'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700))),
                              Chip2('${_n(v['km']).round()} ${tr('كم', 'km')}', T.violet),
                            ]),
                          )),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }
}
