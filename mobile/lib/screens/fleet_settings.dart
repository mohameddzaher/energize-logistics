import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// إعدادات إدارة الأسطول — نفس صفحة الويب: مبلغ بونص الجمعة، الهدف الشهري
/// الافتراضي للسيارة، وتعديل هدف كل سيارة على حدة. القوائم المرجعية (أنواع
/// الإيجار/الدفع/الحمولة) تُدار من صفحة البيانات المرجعية على الويب.
class FleetSettingsScreen extends StatefulWidget {
  const FleetSettingsScreen({super.key});
  @override
  State<FleetSettingsScreen> createState() => _FleetSettingsScreenState();
}

class _FleetSettingsScreenState extends State<FleetSettingsScreen> {
  bool _loading = true;
  String? _error;
  bool _savingCfg = false;
  final _fridayBonus = TextEditingController();
  final _defaultTarget = TextEditingController();
  List<Map<String, dynamic>> _vehicles = [];
  final Map<String, TextEditingController> _targets = {};
  final Set<String> _savingVeh = {};
  String _q = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    // إعادة تحميل بثّية لا تُعيد ملء الحقول — كي لا نمسح تعديلًا جاريًا للمستخدم.
    _onLive = () => _load(hydrate: false);
    Live.instance.on('fleet:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('fleet:updated', _onLive);
    _fridayBonus.dispose();
    _defaultTarget.dispose();
    for (final c in _targets.values) { c.dispose(); }
    super.dispose();
  }

  Future<void> _load({bool hydrate = true}) async {
    try {
      final results = await Future.wait([
        Api.instance.get('/api/fleet/config'),
        Api.instance.get('/api/fleet/vehicles'),
      ]);
      if (!mounted) return;
      final cfg = Map<String, dynamic>.from(results[0]['config'] ?? {});
      final veh = List<Map<String, dynamic>>.from(results[1]['vehicles'] ?? []);
      if (hydrate) {
        // التحميل الأول: نبني كل الحقول من الخادم.
        for (final c in _targets.values) { c.dispose(); }
        _targets.clear();
        for (final v in veh) {
          final id = (v['_id'] ?? '').toString();
          _targets[id] = TextEditingController(text: (v['monthlyTarget'] ?? '').toString());
        }
      } else {
        // بثّ حي: نضيف فقط متحكمات لسيارات جديدة، ونُبقي القيم الجاري تعديلها.
        for (final v in veh) {
          final id = (v['_id'] ?? '').toString();
          _targets.putIfAbsent(id, () => TextEditingController(text: (v['monthlyTarget'] ?? '').toString()));
        }
      }
      setState(() {
        if (hydrate) {
          _fridayBonus.text = (cfg['fridayBonusAmount'] ?? '').toString();
          _defaultTarget.text = (cfg['defaultMonthlyTarget'] ?? '').toString();
        }
        _vehicles = veh;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _saveConfig() async {
    setState(() => _savingCfg = true);
    try {
      await Api.instance.put('/api/fleet/config', {
        'fridayBonusAmount': num.tryParse(_fridayBonus.text.trim()) ?? 0,
        'defaultMonthlyTarget': num.tryParse(_defaultTarget.text.trim()) ?? 0,
      });
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم حفظ الإعدادات', 'Settings saved'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _savingCfg = false);
    }
  }

  Future<void> _saveVehicle(String id) async {
    setState(() => _savingVeh.add(id));
    try {
      await Api.instance.put('/api/fleet/vehicles/$id', {
        'monthlyTarget': num.tryParse(_targets[id]?.text.trim() ?? '') ?? 0,
      });
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم حفظ الهدف', 'Target saved'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _savingVeh.remove(id));
    }
  }

  String _fold(String s) => s
      .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final vehicles = q.isEmpty
        ? _vehicles
        : _vehicles.where((v) => [v['plate'], v['name'], v['supervisorName']]
            .any((x) => _fold((x ?? '').toString()).contains(q))).toList();

    return AppScaffold(
      title: Text(tr('إعدادات الأسطول', 'Fleet Settings')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 160), SizedBox(height: 10), Shimmer(height: 60), SizedBox(height: 10), Shimmer(height: 80),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(14),
                    children: [
                      AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('الإعدادات العامة', 'General settings'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                          const SizedBox(height: 12),
                          TextField(controller: _fridayBonus, keyboardType: TextInputType.number,
                              decoration: InputDecoration(labelText: tr('مبلغ بونص الجمعة', 'Friday bonus amount'), helperText: tr('يُضاف لمصروف السائق عند التفعيل يوم الجمعة', 'Added to driver expense when enabled on Friday'))),
                          const SizedBox(height: 12),
                          TextField(controller: _defaultTarget, keyboardType: TextInputType.number,
                              decoration: InputDecoration(labelText: tr('الهدف الشهري الافتراضي للسيارة', 'Default monthly target per vehicle'))),
                          const SizedBox(height: 12),
                          FilledButton.icon(
                            icon: const Icon(Icons.save_outlined, size: 18),
                            onPressed: _savingCfg ? null : _saveConfig,
                            label: Text(tr('حفظ الإعدادات', 'Save settings')),
                          ),
                        ]),
                      ),
                      const SizedBox(height: 16),
                      Text(tr('الهدف الشهري لكل سيارة', 'Monthly target per vehicle'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                      const SizedBox(height: 8),
                      TextField(
                        onChanged: (v) => setState(() => _q = v),
                        decoration: InputDecoration(hintText: tr('ابحث باللوحة أو المشرف…', 'Search plate, supervisor…'), prefixIcon: const Icon(Icons.search)),
                      ),
                      const SizedBox(height: 8),
                      ...vehicles.map((v) {
                        final id = (v['_id'] ?? '').toString();
                        final saving = _savingVeh.contains(id);
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: AppCard(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            child: Row(children: [
                              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text((v['plate'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w800)),
                                if ((v['supervisorName'] ?? '').toString().isNotEmpty)
                                  Text(v['supervisorName'].toString(), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                              ])),
                              const SizedBox(width: 8),
                              SizedBox(
                                width: 100,
                                child: TextField(
                                  controller: _targets[id],
                                  keyboardType: TextInputType.number,
                                  textAlign: TextAlign.center,
                                  decoration: InputDecoration(labelText: tr('الهدف', 'Target'), isDense: true, contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12)),
                                ),
                              ),
                              IconButton(
                                onPressed: saving ? null : () => _saveVehicle(id),
                                icon: saving
                                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                                    : const Icon(Icons.check_circle_outline, color: T.success),
                              ),
                            ]),
                          ),
                        );
                      }),
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
    );
  }
}
