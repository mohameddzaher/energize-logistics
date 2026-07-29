import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'ls2_vehicles.dart';
import 'ls2_alerts.dart';

/// لوحة لوكيشن سوليوشن — حالة الأسطول الحية، التنبيهات، الصيانة المستحقة،
/// الحرارة، ومسافات الفترة — نفس أقسام لوحة الويب.
class Ls2DashboardScreen extends StatefulWidget {
  const Ls2DashboardScreen({super.key});
  @override
  State<Ls2DashboardScreen> createState() => _Ls2DashboardScreenState();
}

class _Ls2DashboardScreenState extends State<Ls2DashboardScreen> {
  Map<String, dynamic>? _d;
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
      final d = await Api.instance.get('/api/ls2/dashboard');
      if (!mounted) return;
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

  // سطر «التفاصيل ←» أسفل الكارت — يوضّح إنه قابل للضغط.
  Widget _more() => Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Row(mainAxisAlignment: MainAxisAlignment.end, children: [
          Text(tr('التفاصيل', 'Details'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.navy)),
          Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, size: 18, color: T.navy),
        ]),
      );

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
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 100), SizedBox(height: 10), Shimmer(height: 100), SizedBox(height: 10), Shimmer(height: 160)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    // ── حالة الأسطول ──
                    FadeSlideIn(
                      child: Pressable(
                        onTap: () => _open(const Ls2VehiclesScreen()),
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
                    // ── التنبيهات ──
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
                    // ── الصيانة ──
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
                    // ── الحرارة ──
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
                    // ── مسافات الفترة ──
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
