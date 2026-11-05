import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/stat_grid.dart';
import '../ui/widgets.dart';
import 'package:provider/provider.dart';
import '../services/auth.dart';
import 'reference_data.dart' show LookupValuesScreen;
import 'vehicle_corporate.dart' show VehicleCorporatePoliciesScreen;
import 'vehicle_documents.dart';
import 'vehicle_driver_cards.dart' show VehicleDriverCardsScreen;
import 'vehicle_expiring.dart';
import 'vehicle_registry.dart';

// Analytics dashboard
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
      // Sector filter
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
      _tileGrid([
          _tile(tr('إجمالي المركبات', 'Vehicles'), '${t['vehicles'] ?? 0}', T.orange, Icons.directions_car_outlined, onTap: () => _openList()),
          _tile(tr('مستندات منتهية', 'Expired docs'), '${t['expiredTotal'] ?? 0}', T.danger, Icons.event_busy_outlined, onTap: () => _openAlerts()),
          _tile(tr('قرب الانتهاء', 'Expiring'), '${t['expiringTotal'] ?? 0}', T.warn, Icons.hourglass_bottom_outlined, onTap: () => _openAlerts()),
          _tile(tr('مزوّدة بـ GPS', 'With GPS'), '${t['withGps'] ?? 0}', T.success, Icons.gps_fixed_outlined, onTap: () => _openList(filters: {'hasGps': '1'}, label: tr('مزوّدة بـ GPS', 'With GPS'))),
          _tile(tr('بدون GPS', 'Without GPS'), '${((t['vehicles'] ?? 0) as num).toInt() - ((t['withGps'] ?? 0) as num).toInt()}', T.inkSoft, Icons.gps_off_outlined, onTap: () => _openList(filters: {'missingDoc': 'gps'}, label: tr('بدون GPS', 'Without GPS'))),
          _tile(tr('شرائح نشطة', 'Active cards'), '${t['activeFuelCards'] ?? 0}', T.info, Icons.credit_card_outlined, onTap: () => _openList(filters: {'fuelCardStatus': 'نشط'}, label: tr('شريحة نشطة', 'Active card'))),
          _tile(tr('بدون تأمين', 'No insurance'), '${t['missingInsurance'] ?? 0}', T.warn, Icons.gpp_bad_outlined, onTap: () => _openList(filters: {'missingDoc': 'insurance'}, label: tr('بدون تأمين', 'No insurance'))),
          _tile(tr('بدون بطاقة تشغيل', 'No op. card'), '${t['missingOperatingCard'] ?? 0}', T.warn, Icons.badge_outlined, onTap: () => _openList(filters: {'missingDoc': 'operatingCard'}, label: tr('بدون بطاقة تشغيل', 'No op. card'))),
          _tile(tr('عدد الماركات', 'Brands'), '${t['brands'] ?? 0}', T.violet, Icons.category_outlined, onTap: () => _openList()),
          _tile(tr('عدد المُلّاك', 'Owners'), '${t['owners'] ?? 0}', T.inkSoft, Icons.badge_outlined, onTap: () => _openList()),
      ]),
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

  // Cards in equal-height rows that grow with the text (no fixed ratio that clips content).
  Widget _tileGrid(List<Widget> tiles) => StatGrid(spacing: 8, minTileWidth: 140, minColumns: 2, maxColumns: 5, children: tiles);

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
            Text(label, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
          ]),
        ),
      );
}

// Expiries and renewal
// The internal name stays (the list and the overview open it), while the screen itself became the twin of the web page; see vehicle_expiring.dart.
class VehicleRegistryAlertsScreen extends StatelessWidget {
  final String? doc, state;
  const VehicleRegistryAlertsScreen({super.key, this.doc, this.state});
  @override
  Widget build(BuildContext context) => VehicleExpiringScreen(doc: doc, state: state);
}

// Section settings
// Two tabs as on web: reference lists (the section's dropdown lists) and alert thresholds.
const _settingsDocs = [
  ('insurance', 'تأمين المركبات', 'Vehicle insurance'),
  ('operatingCard', 'بطاقات التشغيل', 'Operating cards'),
  ('vehicleLicense', 'رخص السير', 'Vehicle licences'),
  ('inspection', 'الفحص الدوري', 'Periodic inspection'),
  ('authorization', 'التفاويض', 'Authorisations'),
  ('gps', 'أجهزة التتبّع GPS', 'GPS devices'),
  ('driverCard', 'بطاقات السائقين', 'Driver cards'),
  ('corporatePolicy', 'وثائق تأمين الشركة', 'Corporate policies'),
];
const _bands = [
  ('expired', 'منتهٍ', 'Expired', Color(0xFFB91C1C)),
  ('critical', 'حرج', 'Critical', Color(0xFFC2410C)),
  ('warning', 'تحذير', 'Warning', Color(0xFFB45309)),
  ('upcoming', 'قريب', 'Soon', Color(0xFF0369A1)),
  ('valid', 'ساري', 'Valid', Color(0xFF047857)),
];

class VehicleRegistrySettingsScreen extends StatefulWidget {
  const VehicleRegistrySettingsScreen({super.key});
  @override
  State<VehicleRegistrySettingsScreen> createState() => _VRSettingsState();
}

class _VRSettingsState extends State<VehicleRegistrySettingsScreen> {
  int _tab = 0;
  Map<String, Map<String, dynamic>> _alerts = {};
  Map<String, dynamic> _counts = {};
  List<Map<String, dynamic>> _types = [];
  bool _loading = true, _saving = false;
  String? _error;
  final _ctl = <String, TextEditingController>{};

  @override
  void initState() { super.initState(); _load(); }

  @override
  void dispose() { for (final c in _ctl.values) { c.dispose(); } super.dispose(); }

  Future<void> _load() async {
    try {
      final r = await Future.wait([Api.instance.get('/api/vehicle-registry/settings'), Api.instance.get('/api/lookups/types')]);
      if (!mounted) return;
      final d = r[0];
      final alerts = Map<String, dynamic>.from(d['config']?['alerts'] ?? {});
      setState(() {
        _alerts = {
          for (final x in _settingsDocs)
            x.$1: Map<String, dynamic>.from((alerts[x.$1] as Map?) ?? {'enabled': false, 'soonDays': 90, 'warnDays': 30, 'criticalDays': 7}),
        };
        for (final x in _settingsDocs) {
          for (final f in ['soonDays', 'warnDays', 'criticalDays']) {
            (_ctl['${x.$1}.$f'] ??= TextEditingController()).text = '${_alerts[x.$1]![f] ?? ''}';
          }
        }
        _counts = Map<String, dynamic>.from(d['counts'] ?? {});
        // The section's lists only, plus the section's JP task types list.
        _types = List<Map<String, dynamic>>.from(r[1]['types'] ?? [])
            .where((t) => t['module'] == 'vehicles' || t['type'] == 'jp_task_vehicles').toList();
        _loading = false; _error = null;
      });
    } catch (e) { if (mounted) setState(() { _loading = false; _error = e.toString(); }); }
  }

  int _n(dynamic v) => v is num ? v.toInt() : int.tryParse('$v') ?? 0;
  bool _bad(Map c) => c['enabled'] == true && (_n(c['criticalDays']) > _n(c['warnDays']) || _n(c['warnDays']) > _n(c['soonDays']));

  Future<void> _save() async {
    if (_alerts.values.any(_bad)) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('راجع العتبات المعلَّمة بالأحمر: حرج ≤ تحذير ≤ قريب', 'Fix the rows in red: critical ≤ warning ≤ soon'))));
      return;
    }
    setState(() => _saving = true);
    try {
      await Api.instance.put('/api/vehicle-registry/settings', {'alerts': _alerts});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('حُفظت الإعدادات', 'Settings saved'))));
      await _load();
    } catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
    finally { if (mounted) setState(() => _saving = false); }
  }

  void _openPage(String key) {
    Widget? w = switch (key) {
      'insurance' => VehicleDocumentsScreen(family: vehicleInsuranceFamily),
      'operatingCard' => VehicleDocumentsScreen(family: vehicleOperatingCardFamily),
      'vehicleLicense' => VehicleDocumentsScreen(family: vehicleLicenceFamily),
      'inspection' => VehicleDocumentsScreen(family: vehicleInspectionFamily),
      'authorization' => VehicleDocumentsScreen(family: vehicleAuthorizationFamily),
      'gps' => VehicleDocumentsScreen(family: vehicleGpsFamily),
      'driverCard' => const VehicleDriverCardsScreen(),
      'corporatePolicy' => const VehicleCorporatePoliciesScreen(),
      _ => null,
    };
    if (w != null) Navigator.push(context, MaterialPageRoute(builder: (_) => w));
  }

  Widget _lists() => _types.isEmpty
      ? EmptyState(icon: Icons.list_alt_outlined, title: tr('لا قوائم', 'No lists'))
      : ListView(padding: const EdgeInsets.all(14), children: _types.map((t) {
          final name = (Lang.instance.ar ? t['nameAr'] : t['nameEn'])?.toString() ?? (t['type'] ?? '').toString();
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Pressable(
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => LookupValuesScreen(
                  type: (t['type'] ?? '').toString(), title: name, canManage: t['canManage'] == true))),
              child: AppCard(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                child: Row(children: [
                  const Icon(Icons.list_alt_outlined, color: T.navy, size: 20),
                  const SizedBox(width: 10),
                  Expanded(child: Text(name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5))),
                  if (t['canManage'] != true) const Icon(Icons.lock_outline, size: 15, color: T.inkFaint),
                  Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, color: T.inkFaint),
                ]),
              ),
            ),
          );
        }).toList());

  Widget _alertsTab(bool canEdit) => ListView(padding: const EdgeInsets.all(14), children: [
        Text(tr('كلُّ رقمٍ عددُ أيّامٍ قبل الانتهاء، وكلُّ صفٍّ يُغيّر شرائحَ صفحته الثلاث: «حرج» و«تحذير» و«قريب». و«الوضع الآن» يقول ما تقوله هذه الأرقامُ على بياناتك في هذه اللحظة، فالصفرُ فيه صفرٌ حقيقيّ لا إعدادٌ لم يُحفَظ.',
                'Each number is days before expiry, and each row drives its page’s three bands — critical, warning and soon. “Right now” shows what these numbers say about your data at this moment.'),
            style: const TextStyle(fontSize: 12, color: T.inkFaint, height: 1.5)),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFFE2E8F0))),
          child: Text(tr('القاعدة: حرج ≤ تحذير ≤ قريب. مثال: حرج 7، تحذير 30، قريب 90.', 'Rule: critical ≤ warning ≤ soon. Example: 7, 30, 90.'), style: const TextStyle(fontSize: 12)),
        ),
        const SizedBox(height: 10),
        ..._settingsDocs.map((d) {
          final c = _alerts[d.$1]!;
          final on = c['enabled'] == true;
          final bad = _bad(c);
          final counts = Map<String, dynamic>.from((_counts[d.$1] as Map?) ?? {});
          Widget num(String f, String ar, String en) => Expanded(child: TextField(
                controller: _ctl['${d.$1}.$f'],
                enabled: canEdit && on,
                keyboardType: TextInputType.number,
                textAlign: TextAlign.center,
                decoration: InputDecoration(isDense: true, labelText: tr(ar, en)),
                onChanged: (v) => setState(() => c[f] = int.tryParse(v) ?? 0),
              ));
          final crit = _n(c['criticalDays']), warn = _n(c['warnDays']), soon = _n(c['soonDays']);
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: AppCard(
              topAccent: bad ? T.danger : null,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text(tr(d.$2, d.$3), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                  TextButton(onPressed: () => _openPage(d.$1), child: Text(tr('الصفحة ↗', 'page ↗'), style: const TextStyle(fontSize: 11.5))),
                  Switch(value: on, onChanged: !canEdit ? null : (v) => setState(() => c['enabled'] = v)),
                ]),
                if (bad) Text(tr('حرج ≤ تحذير ≤ قريب', 'critical ≤ warning ≤ soon'), style: const TextStyle(fontSize: 11, color: T.danger)),
                const SizedBox(height: 6),
                Row(children: [
                  num('soonDays', 'قريب (يوم)', 'Soon (days)'),
                  const SizedBox(width: 8),
                  num('warnDays', 'تحذير (يوم)', 'Warning (days)'),
                  const SizedBox(width: 8),
                  num('criticalDays', 'حرج (يوم)', 'Critical (days)'),
                ]),
                const SizedBox(height: 8),
                // The effective range is written out explicitly, not three numbers whose range is computed in the header.
                Text('${tr('حرج', 'Crit')} ≤$crit · ${tr('تحذير', 'Warn')}${warn > crit ? ' ${crit + 1}–$warn' : ' — ${tr('معطَّلة', 'off')}'} · '
                    '${tr('قريب', 'Soon')}${soon > warn ? ' ${warn + 1}–$soon' : ' — ${tr('معطَّلة', 'off')}'}',
                    style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                const SizedBox(height: 6),
                Wrap(spacing: 5, runSpacing: 5, children: [
                  ..._bands.where((b) => _n(counts[b.$1]) > 0).map((b) => Chip2('${tr(b.$2, b.$3)} ${counts[b.$1]}', b.$4)),
                  if (!_bands.any((b) => _n(counts[b.$1]) > 0)) Text(tr('لا بيانات بتاريخ', 'no dated records'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                ]),
              ]),
            ),
          );
        }),
        if (canEdit) ...[
          const SizedBox(height: 8),
          FilledButton.icon(icon: const Icon(Icons.save_outlined, size: 18), onPressed: _saving ? null : _save, label: Text(tr('حفظ', 'Save'))),
        ],
        const SizedBox(height: 24),
      ]);

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canEdit = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'vehicles_manager'].contains(auth.role) || auth.canEditSection('Vehicles');
    return AppScaffold(
      title: Text(tr('إعدادات قسم المركبات', 'Vehicles settings')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(height: 70)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: SegmentedButton<int>(
                      segments: [
                        ButtonSegment(value: 0, icon: const Icon(Icons.sell_outlined, size: 18), label: Text(tr('القوائم المرجعية', 'Reference lists'))),
                        ButtonSegment(value: 1, icon: const Icon(Icons.notifications_active_outlined, size: 18), label: Text(tr('عتبات التنبيه', 'Alert thresholds'))),
                      ],
                      selected: {_tab},
                      showSelectedIcon: false,
                      onSelectionChanged: (x) => setState(() => _tab = x.first),
                    ),
                  ),
                  Expanded(child: _tab == 0 ? _lists() : _alertsTab(canEdit)),
                ]),
    );
  }
}
