import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// حالةُ المركبات — أرقامُ شاحناتنا الحيّة في قسمِ من يقودها.
///
/// الكاوتشُ وحرارتُه وحرارةُ الماء والصيانةُ والتنبيهات، لشاحناتنا وحدَها ومن
/// أجهزتها مباشرةً. وكانت في قسمٍ آخر لا يفتحه مشرفُ الأسطول ولا يملكه، فيُسأل
/// عنها بالهاتف.
///
/// والمشرفُ لا يرى إلّا سياراته: الخادمُ يحصر النطاق، فيفتح الشاشةَ فيجد عشرًا
/// لا سبعًا وخمسين.
class FleetHealthScreen extends StatefulWidget {
  const FleetHealthScreen({super.key});
  @override
  State<FleetHealthScreen> createState() => _FleetHealthScreenState();
}

class _FleetHealthScreenState extends State<FleetHealthScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _totals = {};
  bool _loading = true;
  String? _error;
  String _q = '';
  String _filter = '';
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _load();
    // الأرقامُ تتغيّر مع كلّ نبضةٍ من الجهاز، والشاشةُ تُترَك مفتوحة.
    _tick = Timer.periodic(const Duration(seconds: 30), (_) => _load(background: true));
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _load({bool background = false}) async {
    try {
      final d = await Api.instance.get('/api/fleet/health');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['vehicles'] ?? []);
        _totals = Map<String, dynamic>.from(d['totals'] ?? {});
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && !background) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s
      .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  num? _num(dynamic v) => v == null ? null : (v is num ? v : num.tryParse('$v'));
  String _n0(dynamic v) {
    final n = _num(v);
    return n == null ? '—' : n.round().toString();
  }

  /// ألوانُ قراءةٍ لا إنذار: التنبيهُ يصنعه محرّكُ لوكيشن سوليوشن، وهذه تجعل
  /// الرقمَ الشاذّ يُرى قبل أن يُقرأ.
  Color _coolantTone(dynamic v) {
    final n = _num(v);
    if (n == null) return T.inkFaint;
    if (n >= 100) return T.danger;
    if (n >= 92) return T.warn;
    return T.ink;
  }

  Color _tireTempTone(dynamic v) {
    final n = _num(v);
    if (n == null) return T.inkFaint;
    if (n >= 80) return T.danger;
    if (n >= 70) return T.warn;
    return T.ink;
  }

  Color _pressureTone(dynamic v) {
    final n = _num(v);
    if (n == null) return T.inkFaint;
    if (n < 80) return T.danger;
    if (n < 95) return T.warn;
    return T.ink;
  }

  List<Map<String, dynamic>> get _shown {
    final q = _fold(_q.trim());
    return _rows.where((r) {
      final drivers = List<Map<String, dynamic>>.from(r['drivers'] ?? [])
          .map((d) => (d['name'] ?? '').toString()).join(' ');
      if (q.isNotEmpty && !_fold('${r['plate']} ${r['name']} $drivers ${r['supervisorName']}').contains(q)) return false;
      final maint = (r['maintenance'] as Map?)?['status'];
      final tires = Map<String, dynamic>.from(r['tires'] ?? {});
      switch (_filter) {
        case 'alerts': return (r['alertCount'] ?? 0) != 0;
        case 'maintenance': return maint == 'due' || maint == 'overdue';
        case 'tires': return (_num(tires['faults']) ?? 0) > 0;
        case 'untracked': return r['tracked'] != true;
        default: return true;
      }
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('حالة المركبات', 'Vehicle health')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(
                        hintText: tr('ابحث باللوحة أو السائق…', 'Plate or driver…'),
                        prefixIcon: const Icon(Icons.search),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(children: [
                        for (final f in [
                          ('', tr('الكل', 'All'), _totals['total'], T.navy),
                          ('alerts', tr('تنبيهات', 'Alerts'), _totals['withAlerts'], T.danger),
                          ('maintenance', tr('صيانة', 'Service'), (_num(_totals['maintenanceOverdue']) ?? 0) + (_num(_totals['maintenanceDue']) ?? 0), T.warn),
                          ('tires', tr('كاوتش', 'Tyres'), _totals['tireFaults'], T.orange),
                          ('untracked', tr('بلا جهاز', 'No tracker'), _totals['untracked'], T.inkFaint),
                        ])
                          Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: _filter == f.$1,
                              onSelected: (_) => setState(() => _filter = _filter == f.$1 ? '' : f.$1),
                              label: Text('${f.$2} ${_n0(f.$3)}'),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _filter == f.$1 ? Colors.white : f.$4),
                              selectedColor: f.$4,
                              backgroundColor: f.$4.withValues(alpha: 0.1),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          ),
                      ]),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: _shown.isEmpty
                          ? EmptyState(icon: Icons.local_shipping_outlined, title: tr('لا شاحنات مطابقة', 'No matches'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _shown.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) => _card(_shown[i], i),
                            ),
                    ),
                  ),
                ]),
    );
  }

  Widget _card(Map<String, dynamic> r, int i) {
    final tires = Map<String, dynamic>.from(r['tires'] ?? {});
    final maint = (r['maintenance'] as Map?) ?? const {};
    final alerts = List<Map<String, dynamic>>.from(r['alerts'] ?? []);
    final critical = alerts.any((a) => a['severity'] == 'critical');
    final drivers = List<Map<String, dynamic>>.from(r['drivers'] ?? [])
        .map((d) => (d['name'] ?? '').toString()).where((x) => x.isNotEmpty).join('، ');

    return FadeSlideIn(
      delayMs: (i * 15).clamp(0, 150),
      child: AppCard(
        topAccent: critical ? T.danger : alerts.isNotEmpty ? T.warn : T.navy,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text('${r['plate']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
            const SizedBox(width: 8),
            // الشاحنةُ بلا جهازٍ تُقال ولا تُخفى: إخفاؤها يجعل الشاشةَ تبدو تامّةً
            // وهي ناقصة.
            if (r['tracked'] != true)
              Chip2(tr('بلا جهاز', 'No tracker'), T.warn)
            else if (r['stale'] == true)
              Chip2(tr('قراءة قديمة', 'Stale'), T.inkFaint)
            else if (r['moving'] == true)
              Chip2(tr('يتحرك ${_n0(r['speed'])} كم/س', 'Moving ${_n0(r['speed'])} km/h'), T.success)
            else
              Chip2(tr('متوقف', 'Stopped'), T.inkFaint),
            const Spacer(),
            if (alerts.isNotEmpty) Chip2('${alerts.length}', critical ? T.danger : T.warn, icon: Icons.warning_amber_rounded),
          ]),
          if (drivers.isNotEmpty) ...[
            const SizedBox(height: 3),
            Text(drivers, style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
          ],
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 6, children: [
            _metric(Icons.thermostat_outlined, tr('حرارة الماء', 'Coolant'),
                r['coolantC'] == null ? '—' : '${_n0(r['coolantC'])}°', _coolantTone(r['coolantC'])),
            _metric(Icons.tire_repair_outlined, tr('حرارة الكاوتش', 'Tyre temp'),
                tires['maxTempC'] == null ? '—' : '${_n0(tires['maxTempC'])}°', _tireTempTone(tires['maxTempC'])),
            _metric(Icons.speed_outlined, tr('أقل ضغط', 'Min psi'),
                tires['minPressurePsi'] == null ? '—' : _n0(tires['minPressurePsi']), _pressureTone(tires['minPressurePsi'])),
            _metric(Icons.local_gas_station_outlined, tr('الوقود', 'Fuel'),
                r['fuelPct'] == null ? '—' : '${_n0(r['fuelPct'])}%', T.ink),
            if (maint.isNotEmpty)
              _metric(Icons.build_outlined, tr('الصيانة', 'Service'),
                  maint['status'] == 'overdue'
                      ? tr('متأخرة', 'Overdue')
                      : maint['status'] == 'due'
                          ? tr('قريبة', 'Due')
                          : tr('سليمة', 'OK'),
                  maint['status'] == 'overdue' ? T.danger : maint['status'] == 'due' ? T.warn : T.success),
          ]),
          if ((_num(tires['faults']) ?? 0) > 0) ...[
            const SizedBox(height: 6),
            Text(tr('${_n0(tires['faults'])} عطل في حسّاسات الكاوتش', '${_n0(tires['faults'])} tyre sensor faults'),
                style: const TextStyle(fontSize: 12, color: T.danger, fontWeight: FontWeight.w700)),
          ],
          if (alerts.isNotEmpty) ...[
            const SizedBox(height: 8),
            ...alerts.take(3).map((a) => Padding(
                  padding: const EdgeInsets.only(top: 3),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Icon(Icons.circle, size: 7, color: a['severity'] == 'critical' ? T.danger : T.warn),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text('${a['message'] ?? a['type'] ?? ''}',
                          style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                    ),
                  ]),
                )),
            if (alerts.length > 3)
              Padding(
                padding: const EdgeInsets.only(top: 3),
                child: Text(tr('و${alerts.length - 3} غيرها', '+${alerts.length - 3} more'),
                    style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
              ),
          ],
        ]),
      ),
    );
  }

  Widget _metric(IconData icon, String label, String value, Color tone) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
        decoration: BoxDecoration(
          color: tone.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 14, color: tone),
          const SizedBox(width: 5),
          Text('$label ', style: const TextStyle(fontSize: 11, color: T.inkSoft)),
          Text(value, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: tone)),
        ]),
      );
}
