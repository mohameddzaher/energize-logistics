import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// إعدادات LS2 — عتبات الحساسات (حرارة الإطار/التبريد، الضغط، الوقود، السرعة،
/// البطارية…) قابلة للتعديل، مطابقة لصفحة الويب /system/ls2/settings.
class Ls2SettingsScreen extends StatefulWidget {
  const Ls2SettingsScreen({super.key});
  @override
  State<Ls2SettingsScreen> createState() => _Ls2SettingsScreenState();
}

// عنوان عربي/إنجليزي + وحدة لكل عتبة معروفة.
const Map<String, (String, String, String)> _labels = {
  'tireTempC': ('حرارة الإطار — تنبيه', 'Tire temp — warn', '°C'),
  'tireTempCriticalC': ('حرارة الإطار — حرج', 'Tire temp — critical', '°C'),
  'tirePressureMinPsi': ('ضغط الإطار — منخفض', 'Tire pressure — low', 'psi'),
  'tirePressureCriticalPsi': ('ضغط الإطار — حرج', 'Tire pressure — critical', 'psi'),
  'tirePressureMaxPsi': ('ضغط الإطار — مرتفع', 'Tire pressure — high', 'psi'),
  'tirePressureImbalancePsi': ('فرق ضغط المحور', 'Axle imbalance', 'psi'),
  'coolantTempC': ('حرارة التبريد — تنبيه', 'Coolant — warn', '°C'),
  'coolantTempCriticalC': ('حرارة التبريد — حرج', 'Coolant — critical', '°C'),
  'rpmMax': ('أقصى دوران المحرك', 'Max RPM', 'rpm'),
  'fuelLowPct': ('وقود منخفض', 'Low fuel', '%'),
  'fuelCriticalPct': ('وقود حرج', 'Critical fuel', '%'),
  'weightMaxKg': ('أقصى وزن', 'Max weight', 'kg'),
  'speedMaxKmh': ('أقصى سرعة — تنبيه', 'Max speed — warn', 'km/h'),
  'speedCriticalKmh': ('أقصى سرعة — حرج', 'Max speed — critical', 'km/h'),
  'batteryLowV': ('جهد البطارية — منخفض', 'Battery — low', 'V'),
  'batteryCriticalV': ('جهد البطارية — حرج', 'Battery — critical', 'V'),
  'offlineMinutes': ('اعتبار غير متصل بعد', 'Offline after', 'min'),
  'idleMinutes': ('تباطؤ زائد بعد', 'Excessive idle after', 'min'),
};

class _Ls2SettingsScreenState extends State<Ls2SettingsScreen> {
  final Map<String, TextEditingController> _ctrls = {};
  List<String> _keys = [];
  bool _loading = true, _saving = false;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  @override
  void dispose() { for (final c in _ctrls.values) { c.dispose(); } super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/ls2/settings');
      if (!mounted) return;
      final thr = Map<String, dynamic>.from(d['thresholds'] ?? {});
      // نرتّب المفاتيح المعروفة أولًا ثم أي مفاتيح إضافية.
      final ordered = [..._labels.keys.where(thr.containsKey), ...thr.keys.where((k) => !_labels.containsKey(k))];
      for (final c in _ctrls.values) { c.dispose(); }
      _ctrls.clear();
      for (final k in ordered) { _ctrls[k] = TextEditingController(text: (thr[k] ?? '').toString()); }
      setState(() { _keys = ordered; _loading = false; _error = null; });
    } catch (e) { if (mounted) setState(() { _loading = false; _error = e.toString(); }); }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final thresholds = <String, dynamic>{};
      _ctrls.forEach((k, c) { thresholds[k] = num.tryParse(c.text.trim()) ?? 0; });
      await Api.instance.put('/api/ls2/settings', {'thresholds': thresholds});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم حفظ العتبات', 'Thresholds saved'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally { if (mounted) setState(() => _saving = false); }
  }

  String _label(String k) => _labels.containsKey(k) ? (Lang.instance.ar ? _labels[k]!.$1 : _labels[k]!.$2) : k;
  String _unit(String k) => _labels[k]?.$3 ?? '';

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('إعدادات LS2 — العتبات', 'LS2 Settings — Thresholds')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 54), SizedBox(height: 10), Shimmer(height: 54), SizedBox(height: 10), Shimmer(height: 54)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : ListView(padding: const EdgeInsets.all(14), children: [
                  Text(tr('عتبات تنبيهات الحساسات — تُطبَّق على كل المركبات', 'Sensor alert thresholds — apply to all vehicles'), style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
                  const SizedBox(height: 10),
                  ..._keys.map((k) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: AppCard(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          child: Row(children: [
                            Expanded(child: Text(_label(k), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13))),
                            SizedBox(width: 90, child: TextField(
                              controller: _ctrls[k],
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              textAlign: TextAlign.center,
                              decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.symmetric(vertical: 10, horizontal: 8)),
                            )),
                            const SizedBox(width: 6),
                            SizedBox(width: 34, child: Text(_unit(k), style: const TextStyle(fontSize: 11, color: T.inkFaint))),
                          ]),
                        ),
                      )),
                  const SizedBox(height: 14),
                  FilledButton.icon(icon: const Icon(Icons.save_outlined, size: 18), onPressed: _saving ? null : _save, label: Text(tr('حفظ العتبات', 'Save thresholds'))),
                  const SizedBox(height: 24),
                ]),
    );
  }
}
