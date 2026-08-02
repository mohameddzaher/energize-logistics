import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'vehicle_registry.dart';

// ══════════════════ لوحة التحليلات ══════════════════
class VehicleRegistryDashboardScreen extends StatefulWidget {
  const VehicleRegistryDashboardScreen({super.key});
  @override
  State<VehicleRegistryDashboardScreen> createState() => _VRDashState();
}

class _VRDashState extends State<VehicleRegistryDashboardScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;
  final List<String> _sectors = [];
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('vreg:updated', _onLive);
  }

  @override
  void dispose() { Live.instance.off('vreg:updated', _onLive); super.dispose(); }

  Future<void> _load() async {
    try {
      final p = <String>[];
      for (final s in _sectors) { p.add('sector=${Uri.encodeComponent(s)}'); }
      final d = await Api.instance.get('/api/vehicle-registry/dashboard${p.isEmpty ? '' : '?${p.join('&')}'}');
      if (!mounted) return;
      setState(() { _data = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) { if (mounted) setState(() { _loading = false; _error = e.toString(); }); }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('تحليلات المركبات', 'Vehicle Analytics')),
      actions: [
        IconButton(icon: const Icon(Icons.notifications_active_outlined), tooltip: tr('التنبيهات', 'Alerts'),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const VehicleRegistryAlertsScreen()))),
      ],
      body: _loading && _data == null
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 140), SizedBox(height: 10), Shimmer(height: 160)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(onRefresh: _load, child: _body()),
    );
  }

  Widget _body() {
    final d = _data!;
    final t = Map<String, dynamic>.from(d['totals'] ?? {});
    final buckets = Map<String, dynamic>.from(d['docBuckets'] ?? {});
    final sectors = List<Map<String, dynamic>>.from(d['bySector'] ?? []);
    return ListView(padding: const EdgeInsets.all(14), children: [
      // فلتر القطاع
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: sectors.map((s) {
          final key = (s['key'] ?? '').toString();
          final sel = _sectors.contains(key);
          return Padding(padding: const EdgeInsets.only(left: 6), child: FilterChip(
            selected: sel, label: Text('$key (${s['count']})'),
            labelStyle: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: sel ? Colors.white : T.navy),
            selectedColor: T.navy, backgroundColor: T.navy.withValues(alpha: 0.08), checkmarkColor: Colors.white, side: BorderSide.none,
            onSelected: (_) { setState(() { sel ? _sectors.remove(key) : _sectors.add(key); }); _load(); },
          ));
        }).toList()),
      ),
      const SizedBox(height: 12),
      GridView.count(
        crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
        childAspectRatio: 1.7, mainAxisSpacing: 8, crossAxisSpacing: 8,
        children: [
          _tile(tr('إجمالي المركبات', 'Vehicles'), '${t['vehicles'] ?? 0}', T.orange, Icons.directions_car_outlined, onTap: () => _openList()),
          _tile(tr('مستندات منتهية', 'Expired docs'), '${t['expiredTotal'] ?? 0}', T.danger, Icons.event_busy_outlined, onTap: () => _openAlerts()),
          _tile(tr('قرب الانتهاء', 'Expiring'), '${t['expiringTotal'] ?? 0}', T.warn, Icons.hourglass_bottom_outlined, onTap: () => _openAlerts()),
          _tile(tr('إجمالي الأقساط', 'Total premium'), money(t['totalPremium']), T.success, Icons.shield_outlined, onTap: () => _openList()),
          _tile(tr('متوسط القسط', 'Avg premium'), money(t['avgPremium']), T.navy, Icons.trending_up_rounded, onTap: () => _openList()),
          _tile(tr('حد الوقود', 'Fuel limit'), money(t['totalFuelLimit']), T.cyan, Icons.local_gas_station_outlined, onTap: () => _openList()),
          _tile(tr('شرائح نشطة', 'Active cards'), '${t['activeFuelCards'] ?? 0}', T.info, Icons.credit_card_outlined, onTap: () => _openList(filters: {'fuelCardStatus': 'نشط'}, label: tr('شريحة نشطة', 'Active card'))),
          _tile(tr('بدون تأمين', 'No insurance'), '${t['missingInsurance'] ?? 0}', T.warn, Icons.gpp_bad_outlined, onTap: () => _openList(filters: {'missingDoc': 'insurance'}, label: tr('بدون تأمين', 'No insurance'))),
          _tile(tr('عدد الماركات', 'Brands'), '${t['brands'] ?? 0}', T.violet, Icons.category_outlined, onTap: () => _openList()),
          _tile(tr('عدد المُلّاك', 'Owners'), '${t['owners'] ?? 0}', T.inkSoft, Icons.badge_outlined, onTap: () => _openList()),
        ],
      ),
      const SizedBox(height: 14),
      _section(tr('حالة المستندات حسب النوع', 'Document status by type')),
      ...docTypes.map((dt) {
        final b = Map<String, dynamic>.from(buckets[dt.$1] ?? {});
        final total = ['expired', 'critical', 'warning', 'valid', 'none'].fold<int>(0, (a, k) => a + ((b[k] ?? 0) as num).toInt());
        if (total == 0) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(tr(dt.$2, dt.$3), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                Text('${((b['expired'] ?? 0) as num).toInt() + ((b['critical'] ?? 0) as num).toInt() + ((b['warning'] ?? 0) as num).toInt()} ${tr('تنبيه', 'alerts')}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
              ]),
              const SizedBox(height: 6),
              ClipRRect(borderRadius: BorderRadius.circular(6), child: Row(children: ['expired', 'critical', 'warning', 'valid', 'none'].map((k) {
                final val = ((b[k] ?? 0) as num).toInt();
                if (val == 0) return const SizedBox.shrink();
                return Expanded(flex: val, child: Container(height: 10, color: statusColor(k)));
              }).toList())),
              const SizedBox(height: 6),
              Wrap(spacing: 10, runSpacing: 2, children: ['expired', 'critical', 'warning', 'valid'].map((k) {
                final val = ((b[k] ?? 0) as num).toInt();
                if (val == 0) return const SizedBox.shrink();
                return Row(mainAxisSize: MainAxisSize.min, children: [Container(width: 8, height: 8, decoration: BoxDecoration(color: statusColor(k), shape: BoxShape.circle)), const SizedBox(width: 3), Text('${statusLabel(k)}: $val', style: const TextStyle(fontSize: 10.5, color: T.inkSoft))]);
              }).toList()),
            ]),
          ),
        );
      }),
      const SizedBox(height: 8),
      _breakdown(tr('حسب القطاع', 'By sector'), sectors, field: 'sector'),
      _breakdown(tr('حسب نوع التسجيل', 'By registration type'), List<Map<String, dynamic>>.from(d['byRegistrationType'] ?? []), field: 'registrationType'),
      _breakdown(tr('أكثر الماركات', 'Top brands'), List<Map<String, dynamic>>.from(d['byBrand'] ?? []), max: 10, field: 'brand'),
      _breakdown(tr('أكبر المُلّاك', 'Top owners'), List<Map<String, dynamic>>.from(d['byOwner'] ?? []), max: 8, field: 'owner'),
      _breakdown(tr('شركات التأمين', 'Insurance companies'), List<Map<String, dynamic>>.from(d['byInsuranceCompany'] ?? []), field: 'insuranceCompany'),
      _breakdown(tr('حسب سنة الصنع', 'By model year'), List<Map<String, dynamic>>.from(d['byModelYear'] ?? []), max: 15, field: 'modelYear'),
      _breakdown(tr('حالة الفحص', 'Inspection status'), List<Map<String, dynamic>>.from(d['byInspectionStatus'] ?? []), field: 'inspectionStatus'),
      const SizedBox(height: 24),
    ]);
  }

  Widget _section(String t) => Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(t, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)));

  Widget _breakdown(String title, List<Map<String, dynamic>> rows, {int max = 20, String? field}) {
    if (rows.isEmpty) return const SizedBox.shrink();
    final shown = rows.take(max).toList();
    final top = shown.fold<int>(1, (m, r) => ((r['count'] ?? 0) as num).toInt() > m ? ((r['count'] ?? 0) as num).toInt() : m);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
          const SizedBox(height: 8),
          ...shown.map((r) {
            final val = ((r['count'] ?? 0) as num).toInt();
            final key = (r['key'] ?? '—').toString();
            final row = Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(children: [
                SizedBox(width: 120, child: Text(key, style: const TextStyle(fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis)),
                Expanded(child: Stack(children: [
                  Container(height: 14, decoration: BoxDecoration(color: T.navy.withValues(alpha: 0.06), borderRadius: BorderRadius.circular(5))),
                  FractionallySizedBox(widthFactor: (val / top).clamp(0.02, 1.0), child: Container(height: 14, decoration: BoxDecoration(color: T.orange.withValues(alpha: 0.85), borderRadius: BorderRadius.circular(5)))),
                ])),
                const SizedBox(width: 8),
                Text('$val', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
              ]),
            );
            if (field == null || key == '—') return row;
            return Pressable(onTap: () => _openList(filters: {field: key}, label: key), child: row);
          }),
        ]),
      ),
    );
  }

  void _openList({Map<String, String>? filters, String? label}) => Navigator.push(context,
      MaterialPageRoute(builder: (_) => VehicleRegistryListScreen(filters: filters, filterLabel: label)));
  void _openAlerts() => Navigator.push(context, MaterialPageRoute(builder: (_) => const VehicleRegistryAlertsScreen()));

  Widget _tile(String label, String value, Color color, IconData icon, {VoidCallback? onTap}) => Pressable(
        onTap: onTap,
        child: AppCard(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Container(padding: const EdgeInsets.all(6), decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)), child: Icon(icon, size: 16, color: color)),
              const Spacer(),
              if (onTap != null) Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, size: 15, color: T.inkFaint),
            ]),
            const SizedBox(height: 8),
            FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart, child: Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: color, height: 1))),
            const SizedBox(height: 2),
            Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
          ]),
        ),
      );
}

// ══════════════════ التنبيهات ══════════════════
class VehicleRegistryAlertsScreen extends StatefulWidget {
  const VehicleRegistryAlertsScreen({super.key});
  @override
  State<VehicleRegistryAlertsScreen> createState() => _VRAlertsState();
}

class _VRAlertsState extends State<VehicleRegistryAlertsScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;
  String _doc = '', _status = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('vreg:updated', _onLive);
  }

  @override
  void dispose() { Live.instance.off('vreg:updated', _onLive); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/vehicle-registry/alerts');
      if (!mounted) return;
      setState(() { _data = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) { if (mounted) setState(() { _loading = false; _error = e.toString(); }); }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final all = List<Map<String, dynamic>>.from(d?['items'] ?? []);
    final items = all.where((i) => (_doc.isEmpty || i['docType'] == _doc) && (_status.isEmpty || i['status'] == _status)).toList();
    final bs = Map<String, dynamic>.from(d?['byStatus'] ?? {});
    final byDoc = Map<String, dynamic>.from(d?['byDoc'] ?? {});
    return AppScaffold(
      title: Text(tr('تنبيهات المركبات', 'Vehicle Alerts')),
      actions: [IconButton(icon: const Icon(Icons.settings_outlined), onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const VehicleRegistrySettingsScreen())))],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(height: 60)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    Row(children: ['expired', 'critical', 'warning'].map((s) {
                      final sel = _status == s;
                      return Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 3), child: Pressable(
                        onTap: () => setState(() => _status = sel ? '' : s),
                        child: AppCard(
                          topAccent: sel ? statusColor(s) : null,
                          padding: const EdgeInsets.all(12),
                          child: Column(children: [
                            Text('${bs[s] ?? 0}', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: statusColor(s))),
                            Text(statusLabel(s), style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, color: T.inkSoft)),
                          ]),
                        ),
                      )));
                    }).toList()),
                    const SizedBox(height: 10),
                    SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
                      Padding(padding: const EdgeInsets.only(left: 6), child: FilterChip(selected: _doc.isEmpty, label: Text(tr('الكل', 'All')), onSelected: (_) => setState(() => _doc = ''), labelStyle: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: _doc.isEmpty ? Colors.white : T.navy), selectedColor: T.navy, backgroundColor: T.navy.withValues(alpha: 0.08), side: BorderSide.none, checkmarkColor: Colors.white)),
                      ...docTypes.where((dt) => byDoc[dt.$1] != null).map((dt) {
                        final sel = _doc == dt.$1;
                        return Padding(padding: const EdgeInsets.only(left: 6), child: FilterChip(selected: sel, label: Text('${tr(dt.$2, dt.$3)} (${byDoc[dt.$1]})'), onSelected: (_) => setState(() => _doc = sel ? '' : dt.$1), labelStyle: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: sel ? Colors.white : T.navy), selectedColor: T.navy, backgroundColor: T.navy.withValues(alpha: 0.08), side: BorderSide.none, checkmarkColor: Colors.white));
                      }),
                    ])),
                    const SizedBox(height: 10),
                    if (items.isEmpty)
                      EmptyState(icon: Icons.check_circle_outline, title: tr('لا توجد تنبيهات', 'No alerts'))
                    else
                      ...items.map((i) => Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: Pressable(
                              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => VehicleRegistryDetailScreen(id: (i['vehicleId'] ?? '').toString(), plate: (i['plateNumber'] ?? '').toString()))),
                              child: AppCard(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                child: Row(children: [
                                  Container(width: 10, height: 10, decoration: BoxDecoration(color: statusColor((i['status'] ?? '').toString()), shape: BoxShape.circle)),
                                  const SizedBox(width: 10),
                                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text('${i['plateNumber'] ?? ''} · ${i['brandAr'] ?? ''} ${i['modelAr'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                                    Text('${docLabel((i['docType'] ?? '').toString())} · ${i['sectorAr'] ?? ''}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                  ])),
                                  Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                    Text(daysText(i['daysRemaining']), style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5, color: statusColor((i['status'] ?? '').toString()))),
                                    Text(fmtDate(i['expiryDate']), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                                  ]),
                                ]),
                              ),
                            ),
                          )),
                    const SizedBox(height: 24),
                  ]),
                ),
    );
  }
}

// ══════════════════ الإعدادات ══════════════════
class VehicleRegistrySettingsScreen extends StatefulWidget {
  const VehicleRegistrySettingsScreen({super.key});
  @override
  State<VehicleRegistrySettingsScreen> createState() => _VRSettingsState();
}

class _VRSettingsState extends State<VehicleRegistrySettingsScreen> {
  Map<String, dynamic> _alerts = {};
  bool _loading = true, _saving = false;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/vehicle-registry/settings');
      if (!mounted) return;
      setState(() { _alerts = Map<String, dynamic>.from(d['config']?['alerts'] ?? {}); _loading = false; _error = null; });
    } catch (e) { if (mounted) setState(() { _loading = false; _error = e.toString(); }); }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await Api.instance.put('/api/vehicle-registry/settings', {'alerts': _alerts});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم حفظ الإعدادات', 'Settings saved'))));
    } catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
    finally { if (mounted) setState(() => _saving = false); }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('إعدادات التنبيهات', 'Alert Settings')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(height: 70)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : ListView(padding: const EdgeInsets.all(14), children: [
                  Text(tr('حدّد لكل مستند متى يبدأ التنبيه قبل انتهائه', 'Set how early each document warns'), style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
                  const SizedBox(height: 10),
                  ...docTypes.map((dt) {
                    final a = Map<String, dynamic>.from(_alerts[dt.$1] ?? {'enabled': true, 'warnDays': 60});
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: AppCard(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        child: Row(children: [
                          Expanded(child: Text(tr(dt.$2, dt.$3), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5))),
                          SizedBox(width: 64, child: TextField(
                            enabled: a['enabled'] == true,
                            controller: TextEditingController(text: (a['warnDays'] ?? 60).toString()),
                            keyboardType: TextInputType.number, textAlign: TextAlign.center,
                            decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.symmetric(vertical: 10, horizontal: 6)),
                            onChanged: (v) { _alerts[dt.$1] = {...a, 'warnDays': int.tryParse(v) ?? 0}; },
                          )),
                          const SizedBox(width: 4),
                          Text(tr('يوم', 'd'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                          const SizedBox(width: 6),
                          Switch(value: a['enabled'] == true, onChanged: (v) => setState(() => _alerts[dt.$1] = {...a, 'enabled': v})),
                        ]),
                      ),
                    );
                  }),
                  const SizedBox(height: 6),
                  Text(tr('مثال: التأمين 60 يوم = تظهر تنبيهاته قبل الانتهاء بشهرين.', 'e.g. Insurance 60d = alerts start two months before expiry.'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                  const SizedBox(height: 14),
                  FilledButton.icon(icon: const Icon(Icons.save_outlined, size: 18), onPressed: _saving ? null : _save, label: Text(tr('حفظ الإعدادات', 'Save settings'))),
                  const SizedBox(height: 24),
                ]),
    );
  }
}
