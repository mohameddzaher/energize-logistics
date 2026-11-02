import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'ls2_common.dart';
import 'ls2_vehicle_detail.dart';

/// Fleet temperature (LS2): vehicles ranked by highest tire/coolant temperature, with over-threshold highlighting. Mirrors web /system/ls2/temperature (from /api/ls2/vehicles).
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
  // Search controller owned by the screen so a failed live refresh followed by a retry does not empty the field while the term still filters.
  final _searchCtl = TextEditingController();
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
  void dispose() { Live.instance.off('ls2:updated', _onLive); _searchCtl.dispose(); super.dispose(); }

  Future<void> _load() async {
    try {
      final res = await Future.wait([
        Api.instance.get('/api/ls2/vehicles'),
        Api.instance.get('/api/ls2/settings').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        // The endpoint returns `items`; reading `vehicles` gave an empty list with no error.
        _vehicles = List<Map<String, dynamic>>.from(res[0]['items'] ?? res[0]['vehicles'] ?? []);
        _thresholds = Map<String, dynamic>.from(res[1]['thresholds'] ?? {});
        _loading = false;
        _error = null;
      });
    } catch (e) { if (mounted) setState(() { _loading = false; _error = e.toString(); }); }
  }

  double? _n(dynamic v) => v == null ? null : (v is num ? v.toDouble() : double.tryParse(v.toString()));

  // Threshold from settings if present, otherwise a sensible default.
  double _thr(String key, double dflt) {
    final t = _thresholds[key];
    final n = _n(t is Map ? (t['warn'] ?? t['max'] ?? t['value']) : t);
    return n ?? dflt;
  }

  double _thrAny(List<String> keys, double dflt) {
    for (final k in keys) {
      if (_thresholds.containsKey(k)) return _thr(k, dflt);
    }
    return dflt;
  }

  static final _cols = [
    ExportCol('اللوحة', 'Plate', (r) => r['plate'] ?? r['name'] ?? ''),
    ExportCol('السائق', 'Driver', (r) => r['driver'] ?? ''),
    ExportCol('حرارة الموتور °م', 'Coolant °C', (r) => r['coolantC'] ?? ''),
    ExportCol('أقصى حرارة كاوتش', 'Max Tire Temp °C', (r) => r['maxTireTempC'] ?? ''),
    ExportCol('أقل حرارة كاوتش', 'Min Tire Temp °C', (r) => r['minTireTempC'] ?? ''),
    ExportCol('أقصى ضغط', 'Max Pressure psi', (r) => r['maxTirePressurePsi'] ?? ''),
    ExportCol('أقل ضغط', 'Min Pressure psi', (r) => r['minTirePressurePsi'] ?? ''),
    ExportCol('أعطال حساسات', 'Sensor Faults', (r) => r['tireFaults'] ?? ''),
    ExportCol('الحالة', 'Status', (r) { final st = ls2Status(r['status']); return tr(st.$1, st.$2); }),
  ];

  /// Shown: vehicles that reported a temperature reading (two sheets, as on the web). All: the whole fleet.
  Future<void> _export() {
    final tire = _vehicles.where((v) => v['maxTireTempC'] != null).toList()
      ..sort((a, b) => (_n(b['maxTireTempC']) ?? 0).compareTo(_n(a['maxTireTempC']) ?? 0));
    final engine = _vehicles.where((v) => v['coolantC'] != null).toList()
      ..sort((a, b) => (_n(b['coolantC']) ?? 0).compareTo(_n(a['coolantC']) ?? 0));
    return ls2ExportMenu(context, fileName: 'ls2-temperature', options: [
      ('المعروض حاليًا', 'Shown on screen', [(tr('حرارة الكاوتش', 'Tire temperature'), _cols, tire), (tr('حرارة الموتور', 'Engine coolant'), _cols, engine)]),
      ('الكل', 'All', [(tr('الحرارة', 'Temperature'), _cols, _vehicles)]),
    ]);
  }

  Color _tempColor(double? v, double warn, double danger) {
    if (v == null) return T.inkFaint;
    if (v >= danger) return T.danger;
    if (v >= warn) return T.warn;
    return T.success;
  }

  @override
  Widget build(BuildContext context) {
    // Threshold names as in the section settings, plus legacy names as fallback.
    final tireWarn = _thr('tireTempC', 75), tireDanger = _thrAny(['tireTempCriticalC', 'tireTempMaxC'], 85);
    final coolWarn = _thrAny(['coolantTempC', 'coolantC'], 100), coolDanger = _thrAny(['coolantTempCriticalC', 'coolantMaxC'], 110);
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
      actions: [IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export)],
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
                      Expanded(child: SearchField(controller: _searchCtl, hint: tr('ابحث بالمركبة…', 'Search vehicle…'), dense: true, onChanged: (v) => setState(() => _q = v))),
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
                          ? ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [EmptyState(icon: q.isNotEmpty ? Icons.search_off : Icons.thermostat_outlined, title: q.isNotEmpty ? tr('لا نتائج مطابقة للبحث', 'No matches') : tr('لا توجد بيانات حرارة', 'No temperature data'))])
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              padding: const EdgeInsets.all(14),
                              itemCount: rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final v = rows[i];
                                final tire = _n(v['maxTireTempC']);
                                final cool = _n(v['coolantC']);
                                return Pressable(
                                  // `/api/ls2/vehicles/:id` expects the unit number, not a Mongo id; with the id the file never opened from this screen.
                                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => Ls2VehicleDetailScreen(vehicleId: (v['unitId'] ?? v['_id'] ?? '').toString(), plate: (v['plate'] ?? '').toString()))),
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
