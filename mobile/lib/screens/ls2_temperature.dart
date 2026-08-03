import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'ls2_vehicle_detail.dart';

/// حرارة الأسطول (LS2) — ترتيب المركبات حسب أعلى حرارة إطار/تبريد، مع تلوين
/// التجاوزات. مطابق لصفحة الويب /system/ls2/temperature (من /api/ls2/vehicles).
class Ls2TemperatureScreen extends StatefulWidget {
  const Ls2TemperatureScreen({super.key});
  @override
  State<Ls2TemperatureScreen> createState() => _Ls2TemperatureScreenState();
}

class _Ls2TemperatureScreenState extends State<Ls2TemperatureScreen> {
  List<Map<String, dynamic>> _vehicles = [];
  Map<String, dynamic> _thresholds = {};
  bool _loading = true;
  String? _error;
  String _q = '';
  String _sort = 'tire'; // tire | coolant
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('ls2:updated', _onLive);
  }

  @override
  void dispose() { Live.instance.off('ls2:updated', _onLive); super.dispose(); }

  Future<void> _load() async {
    try {
      final res = await Future.wait([
        Api.instance.get('/api/ls2/vehicles'),
        Api.instance.get('/api/ls2/settings').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        _vehicles = List<Map<String, dynamic>>.from(res[0]['vehicles'] ?? []);
        _thresholds = Map<String, dynamic>.from(res[1]['thresholds'] ?? {});
        _loading = false;
        _error = null;
      });
    } catch (e) { if (mounted) setState(() { _loading = false; _error = e.toString(); }); }
  }

  double? _n(dynamic v) => v == null ? null : (v is num ? v.toDouble() : double.tryParse(v.toString()));

  // عتبة من الإعدادات إن وُجدت، وإلا افتراضي معقول.
  double _thr(String key, double dflt) {
    final t = _thresholds[key];
    final n = _n(t is Map ? (t['warn'] ?? t['max'] ?? t['value']) : t);
    return n ?? dflt;
  }

  Color _tempColor(double? v, double warn, double danger) {
    if (v == null) return T.inkFaint;
    if (v >= danger) return T.danger;
    if (v >= warn) return T.warn;
    return T.success;
  }

  @override
  Widget build(BuildContext context) {
    final tireWarn = _thr('tireTempC', 75), tireDanger = _thr('tireTempMaxC', 85);
    final coolWarn = _thr('coolantC', 95), coolDanger = _thr('coolantMaxC', 105);
    String fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();
    final q = fold(_q.trim());
    var rows = _vehicles.where((v) => q.isEmpty || [v['plate'], v['name']].any((x) => fold((x ?? '').toString()).contains(q))).toList();
    rows.sort((a, b) {
      final ka = _sort == 'tire' ? _n(a['maxTireTempC']) : _n(a['coolantC']);
      final kb = _sort == 'tire' ? _n(b['maxTireTempC']) : _n(b['coolantC']);
      return (kb ?? -999).compareTo(ka ?? -999);
    });
    final tireHot = _vehicles.where((v) => (_n(v['maxTireTempC']) ?? 0) >= tireWarn).length;
    final coolHot = _vehicles.where((v) => (_n(v['coolantC']) ?? 0) >= coolWarn).length;

    return AppScaffold(
      title: Text(tr('حرارة الأسطول', 'Fleet Temperature')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
                    child: Row(children: [
                      Expanded(child: _stat(tr('إطارات ساخنة', 'Hot tires'), tireHot, T.danger, Icons.tire_repair_outlined)),
                      const SizedBox(width: 8),
                      Expanded(child: _stat(tr('تبريد مرتفع', 'Hot coolant'), coolHot, T.warn, Icons.thermostat_outlined)),
                    ]),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                    child: Row(children: [
                      Expanded(child: TextField(onChanged: (v) => setState(() => _q = v), decoration: InputDecoration(hintText: tr('ابحث بالمركبة…', 'Search vehicle…'), prefixIcon: const Icon(Icons.search), isDense: true))),
                      const SizedBox(width: 8),
                      ToggleButtons(
                        isSelected: [_sort == 'tire', _sort == 'coolant'],
                        onPressed: (i) => setState(() => _sort = i == 0 ? 'tire' : 'coolant'),
                        borderRadius: BorderRadius.circular(8),
                        constraints: const BoxConstraints(minHeight: 38, minWidth: 54),
                        children: [Text(tr('إطار', 'Tire')), Text(tr('تبريد', 'Cool'))],
                      ),
                    ]),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: rows.isEmpty
                          ? EmptyState(icon: Icons.thermostat_outlined, title: tr('لا توجد بيانات حرارة', 'No temperature data'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final v = rows[i];
                                final tire = _n(v['maxTireTempC']);
                                final cool = _n(v['coolantC']);
                                return Pressable(
                                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => Ls2VehicleDetailScreen(vehicleId: (v['_id'] ?? '').toString(), plate: (v['plate'] ?? '').toString()))),
                                  child: AppCard(
                                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                    child: Row(children: [
                                      Text('${i + 1}', style: const TextStyle(fontSize: 12, color: T.inkFaint, fontWeight: FontWeight.w700)),
                                      const SizedBox(width: 10),
                                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Text((v['plate'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                                        if ((v['name'] ?? '').toString().isNotEmpty) Text(v['name'].toString(), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                      ])),
                                      _tempBadge(tr('إطار', 'Tire'), tire, _tempColor(tire, tireWarn, tireDanger)),
                                      const SizedBox(width: 8),
                                      _tempBadge(tr('تبريد', 'Cool'), cool, _tempColor(cool, coolWarn, coolDanger)),
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

  Widget _stat(String label, int value, Color color, IconData icon) => AppCard(
        padding: const EdgeInsets.all(12),
        child: Row(children: [
          Container(padding: const EdgeInsets.all(7), decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)), child: Icon(icon, size: 18, color: color)),
          const SizedBox(width: 10),
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('$value', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: color, height: 1)),
            Text(label, style: const TextStyle(fontSize: 11, color: T.inkSoft, fontWeight: FontWeight.w600)),
          ]),
        ]),
      );

  Widget _tempBadge(String label, double? v, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(8), border: Border.all(color: color.withValues(alpha: 0.3))),
        child: Column(children: [
          Text(v == null ? '—' : '${v.toStringAsFixed(0)}°', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: color)),
          Text(label, style: TextStyle(fontSize: 9, color: color)),
        ]),
      );
}
