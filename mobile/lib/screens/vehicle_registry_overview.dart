import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/filter_sheet.dart';
import '../ui/hr_quick.dart' show HrQuickFilters;
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'vehicle_documents.dart'
    show VehicleDocumentsScreen, DocFamily, vehicleInsuranceFamily, vehicleOperatingCardFamily, vehicleAuthorizationFamily,
        vehicleGpsFamily, vehicleLicenceFamily, vehicleInspectionFamily;
import 'vehicle_driver_cards.dart';
import 'vehicle_registry.dart' show VehicleRegistryListScreen;
import 'vehicle_claims.dart' show VehicleClaimsScreen;
import 'vehicle_corporate.dart' show VehicleCorporatePoliciesScreen;
import 'vehicle_registry_dash.dart' show VehicleRegistryAlertsScreen, VehicleRegistrySettingsScreen;

/// Vehicles overview (mirrors /system/vehicles/registry/overview).
/// The filter is the source of every figure: cards and analytics are re-read from it. Each chip carries its own server filter (item.filter), and opens the register with it plus the active filter, so the displayed figure never differs from the rows it opens.

// States as web displays them (STATE_META/stateMeta in lib/vehicleRegistry)
const _stateMeta = {
  'expired': ('منتهي', 'Expired', Color(0xFFDC2626)),
  'due': ('قارب على الانتهاء', 'Due soon', Color(0xFFF59E0B)),
  'valid': ('ساري', 'Valid', Color(0xFF16A34A)),
  'critical': ('حرج', 'Critical', Color(0xFFEA580C)),
  'warning': ('تحذير', 'Warning', Color(0xFFF59E0B)),
  'upcoming': ('قريب', 'Upcoming', Color(0xFF0EA5E9)),
  'missing': ('مطلوب — بلا تاريخ', 'Needed — no date', Color(0xFF94A3B8)),
  'not_applicable': ('غير مطلوب', 'Not applicable', Color(0xFF64748B)),
};

/// Never empty whatever the key, like stateMeta on web.
(String, String, Color) stateMetaOf(String? s) {
  final k = (s == null || s.isEmpty) ? 'valid' : s;
  return _stateMeta[k] ?? (k, k, const Color(0xFF64748B));
}

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse('${v ?? ''}') ?? 0;
  final neg = n < 0;
  final s = n.abs().round().toString();
  final b = StringBuffer();
  for (int i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 == 0) b.write(','); b.write(s[i]); }
  return '${neg ? '-' : ''}$b';
}

String _fmtDate(dynamic d) { final s = '${d ?? ''}'; return s.isEmpty ? '—' : s.split('T').first; }

String _daysText(dynamic n) {
  if (n == null) return '—';
  final v = (n is num) ? n.toInt() : int.tryParse('$n') ?? 0;
  if (v < 0) return tr('انتهى منذ ${-v} يوم', 'expired ${-v}d ago');
  if (v == 0) return tr('ينتهي اليوم', 'expires today');
  if (v == 1) return tr('باقي يوم واحد', '1 day left');
  return tr('باقي $v يوم', '$v days left');
}

const _docIcon = {
  'insurance': Icons.shield_outlined,
  'operatingCard': Icons.credit_card_outlined,
  'vehicleLicense': Icons.description_outlined,
  'inspection': Icons.build_outlined,
  'gps': Icons.satellite_alt_outlined,
  'authorization': Icons.vpn_key_outlined,
  // The driver card is the seventh card: a paper on a person, not on a vehicle.
  'driverCard': Icons.badge_outlined,
};

DocFamily? _familyOf(String key) => switch (key) {
      'insurance' => vehicleInsuranceFamily,
      'operatingCard' => vehicleOperatingCardFamily,
      'vehicleLicense' => vehicleLicenceFamily,
      'inspection' => vehicleInspectionFamily,
      'gps' => vehicleGpsFamily,
      'authorization' => vehicleAuthorizationFamily,
      _ => null,
    };

const _quickKeys = [
  ('sector', 'القطاع', 'Sector'),
  ('department', 'الإدارة / المشروع', 'Department'),
  ('registrationType', 'نوع التسجيل', 'Registration type'),
  ('brand', 'الماركة', 'Brand'),
  ('city', 'المدينة', 'City'),
  ('ownerCompany', 'الشركة المالكة', 'Owner company'),
  ('serviceStatus', 'حالة التشغيل', 'Service status'),
  ('authState', 'التفويض', 'Authorisation'),
  ('documentHealth', 'صحّة المستندات', 'Document health'),
  ('accidentBand', 'الحوادث', 'Accidents'),
];

const _toggles = [
  ('missing', '1', 'ينقصها بيانات', 'Missing data'),
  ('logistiGaps', '1', 'ينقصها شرط لوجستي', 'Logisti gaps'),
  ('logistiGaps', '0', 'مستوفية شروط لوجستي', 'Logisti complete'),
  ('hasGps', '1', 'عليها جهاز تتبّع', 'With GPS'),
  ('hasGps', '0', 'بلا جهاز تتبّع', 'Without GPS'),
];

class VehicleRegistryOverviewScreen extends StatefulWidget {
  final Map<String, String>? filters;
  const VehicleRegistryOverviewScreen({super.key, this.filters});
  @override
  State<VehicleRegistryOverviewScreen> createState() => _VehicleRegistryOverviewScreenState();
}

class _VehicleRegistryOverviewScreenState extends State<VehicleRegistryOverviewScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  bool _refreshing = false;
  String? _error;
  late Map<String, String> _filters = {...?widget.filters};
  // A stale response does not overwrite a newer one; see useLatestRequest on web.
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () { if (mounted) _load(); };
    // The rider, authorization and employee status are also written from B2C and HR.
    for (final e in const ['vreg:updated', 'lt:updated', 'hr:employee']) { Live.instance.on(e, _onLive); }
    _load();
  }

  @override
  void dispose() {
    for (final e in const ['vreg:updated', 'lt:updated', 'hr:employee']) { Live.instance.off(e, _onLive); }
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    if (mounted) setState(() => _refreshing = true);
    try {
      final q = [for (final e in _filters.entries) if (e.value.isNotEmpty) '${e.key}=${Uri.encodeQueryComponent(e.value)}'];
      final d = await Api.instance.get('/api/vehicle-registry/overview${q.isEmpty ? '' : '?${q.join('&')}'}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d); _error = null; });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      if (_d == null) {
        setState(() => _error = e.toString());
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
    if (!mounted || mine != _seq) return;
    setState(() { _loading = false; _refreshing = false; });
  }

  void _setFilters(Map<String, String> f) { setState(() => _filters = f); _load(); }

  /// Opens the register with the server filter plus the active filter.
  void _openList(Map<String, String> filter, String label) {
    final f = <String, String>{..._filters, ...filter}..removeWhere((k, v) => v.isEmpty);
    Navigator.push(context, MaterialPageRoute(builder: (_) => VehicleRegistryListScreen(filters: f, filterLabel: label)));
  }

  /// Web opens the expiries page on the document and its state; the phone opens the document family screen.
  void _go(Widget w) => Navigator.push(context, MaterialPageRoute(builder: (_) => w));

  void _openDoc(String key, {String state = ''}) {
    if (key == 'driverCard') {
      // Card chips under their own names; 'not required' has no chip so it opens unfiltered.
      const known = ['expired', 'critical', 'warning', 'upcoming', 'valid'];
      Navigator.push(context, MaterialPageRoute(builder: (_) => VehicleDriverCardsScreen(initialState: known.contains(state) ? state : '')));
      return;
    }
    // As on web (openExpiring): the expiries screen on the document and its state. 'Not required' has no row there, so the document family page opens for it.
    final fam = _familyOf(key);
    if (state == 'not_applicable' && fam != null) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => VehicleDocumentsScreen(family: fam)));
      return;
    }
    const known = ['expired', 'critical', 'warning', 'upcoming', 'valid'];
    Navigator.push(context, MaterialPageRoute(builder: (_) => VehicleRegistryAlertsScreen(doc: key, state: known.contains(state) ? state : null)));
  }

  Future<void> _openFilterSheet() async {
    final r = await showFilterSheet(
      context: context,
      optionsUrl: '/api/vehicle-registry/filters',
      value: _filters,
      extraLabels: {
        'missing': tr('ينقصها بيانات', 'Missing data'),
        'logistiGaps': tr('نواقص لوجستي', 'Logisti gaps'),
        'hasGps': tr('التتبّع', 'GPS'),
        'expiryDoc': tr('المستند', 'Document'),
        'missingDocDate': tr('بلا تاريخ', 'No date'),
        'yearFrom': tr('سنة الصنع من', 'Year from'),
        'yearTo': tr('سنة الصنع إلى', 'Year to'),
        'expiryFrom': tr('الانتهاء من', 'Expiry from'),
        'expiryTo': tr('الانتهاء إلى', 'Expiry to'),
      },
    );
    if (r != null && mounted) _setFilters(r);
  }

  Widget _big(String label, dynamic value, Color accent, {VoidCallback? onTap}) {
    return SizedBox(
      width: (MediaQuery.of(context).size.width - 28 - 8) / 2,
      child: Pressable(
        onTap: onTap,
        child: AppCard(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${value ?? 0}', style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800, color: accent, height: 1)),
            const SizedBox(height: 6),
            Row(children: [
              Expanded(child: Text(label, style: const TextStyle(fontSize: 11, color: T.inkFaint, height: 1.2))),
              if (onTap != null) const Icon(Icons.chevron_left, size: 14, color: T.inkFaint),
            ]),
          ]),
        ),
      ),
    );
  }

  Widget _section(String title, List<Widget> children, {String? hint}) => Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Text(title, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: T.ink)),
            if (hint != null) ...[const SizedBox(width: 6), Expanded(child: Text(hint, style: const TextStyle(fontSize: 11, color: T.inkFaint)))],
          ]),
          const SizedBox(height: 8),
          ...children,
        ]),
      );

  // Document card: the computed states, then one line for what has no date
  Widget _docCard(Map doc) {
    final key = '${doc['key']}';
    final s = Map<String, dynamic>.from(doc['states'] ?? {});
    int n(String k) => (s[k] as num?)?.toInt() ?? 0;
    // Zero is not shown, except 'valid'.
    final rows = [for (final k in const ['expired', 'critical', 'warning', 'upcoming', 'valid']) if (n(k) > 0 || k == 'valid') (k, n(k))];
    final missing = n('missing');
    final notRequired = n('not_applicable');
    final need = (doc['needsAttention'] as num?)?.toInt() ?? 0;
    final alert = doc['alert'] is Map ? doc['alert'] as Map : const {};
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Icon(_docIcon[key] ?? Icons.description_outlined, size: 18, color: T.orange),
            const SizedBox(width: 6),
            Expanded(child: Text(tr('${doc['ar'] ?? key}', '${doc['en'] ?? key}'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
            if (need > 0)
              InkWell(onTap: () => _openDoc(key), child: Chip2('$need', T.danger, icon: Icons.warning_amber_rounded)),
          ]),
          const SizedBox(height: 10),
          GridView.count(
            crossAxisCount: 3,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 6,
            crossAxisSpacing: 6,
            childAspectRatio: 1.7,
            children: [
              for (final r in rows)
                Builder(builder: (_) {
                  final m = stateMetaOf(r.$1);
                  return InkWell(
                    onTap: () => _openDoc(key, state: r.$1),
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      decoration: BoxDecoration(border: Border.all(color: T.line), borderRadius: BorderRadius.circular(10)),
                      alignment: Alignment.center,
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        Text('${r.$2}', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: m.$3)),
                        Text(tr(m.$1, m.$2), style: const TextStyle(fontSize: 10, color: T.inkFaint), textAlign: TextAlign.center, maxLines: 2),
                      ]),
                    ),
                  );
                }),
            ],
          ),
          if (missing > 0 || notRequired > 0)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(children: [
                InkWell(
                  onTap: () => _openList({'missingDocDate': key}, '${tr('بلا تاريخ', 'No date')} · ${tr('${doc['ar'] ?? key}', '${doc['en'] ?? key}')}'),
                  child: Text('${tr('بلا تاريخ', 'No date')}: $missing', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                ),
                const Spacer(),
                InkWell(
                  onTap: () => _openDoc(key, state: 'not_applicable'),
                  child: Text('${tr('لا ينطبق', 'N/A')}: $notRequired', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                ),
              ]),
            ),
          const Divider(height: 18),
          Row(children: [
            Text('${tr('تنبيه قبل', 'Alert')} ${alert['warnDays'] ?? 30} ${tr('يوم', 'days')}${alert['enabled'] == false ? ' · ${tr('موقوف', 'off')}' : ''}',
                style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
            const Spacer(),
            if (doc['nearestDays'] != null) Text('${tr('أقرب انتهاء', 'Next')}: ${doc['nearestDays']} ${tr('يوم', 'd')}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
          ]),
        ]),
      ),
    );
  }

  // Analysis card: horizontal chips with width proportional to the count
  Widget _analyticCard(Map a, int total) {
    final items = List<Map>.from(a['items'] ?? []);
    final max = items.fold<int>(1, (m, i) => ((i['count'] as num?)?.toInt() ?? 0) > m ? (i['count'] as num).toInt() : m);
    final colors = a['kind'] == 'horizon'
        ? const [Color(0xFFDC2626), Color(0xFFEA580C), Color(0xFFF59E0B), Color(0xFF0EA5E9), Color(0xFF16A34A), Color(0xFF94A3B8)]
        : const [Color(0xFF12325C), Color(0xFF2A5490), Color(0xFF3D6AA8), Color(0xFF5480BF), Color(0xFF7B9DD1)];
    bool isOn(Map f) => f.isNotEmpty && f.entries.every((e) => _filters['${e.key}'] == '${e.value}');
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text(tr('${a['ar'] ?? ''}', '${a['en'] ?? ''}'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13))),
            Text('$total', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
          ]),
          const SizedBox(height: 8),
          for (int i = 0; i < items.length; i++)
            Builder(builder: (_) {
              final it = items[i];
              final c = (it['count'] as num?)?.toInt() ?? 0;
              final f = it['filter'] is Map ? Map<String, dynamic>.from(it['filter'] as Map) : <String, dynamic>{};
              final on = isOn(f);
              final label = tr('${it['label'] ?? ''}', '${it['labelEn'] ?? it['label'] ?? ''}');
              return Opacity(
                opacity: c > 0 ? 1 : 0.4,
                child: InkWell(
                  onTap: c > 0 ? () => _openList({for (final e in f.entries) e.key: '${e.value}'}, '${tr('${a['ar'] ?? ''}', '${a['en'] ?? ''}')}: $label') : null,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Row(children: [
                        Expanded(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 11.5, fontWeight: on ? FontWeight.w800 : FontWeight.w500, color: on ? T.navy : T.inkSoft))),
                        Text('$c', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800)),
                        if (total > 0) Text('  ${(c * 100 / total).round()}%', style: const TextStyle(fontSize: 10, color: T.inkFaint)),
                      ]),
                      const SizedBox(height: 3),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: LinearProgressIndicator(value: c / max, minHeight: 6, backgroundColor: const Color(0xFFF1F5F9), color: colors[i % colors.length]),
                      ),
                    ]),
                  ),
                ),
              );
            }),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    return AppScaffold(
      title: Text(tr('نظرة شاملة على المركبات', 'Vehicles Overview')),
      actions: [
        IconButton(
          tooltip: tr('الانتهاءات', 'Expiries'),
          icon: const Icon(Icons.event_available_outlined),
          onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const VehicleRegistryAlertsScreen())),
        ),
        IconButton(
          tooltip: tr('إعدادات التنبيه', 'Alerts'),
          icon: const Icon(Icons.settings_outlined),
          onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const VehicleRegistrySettingsScreen())),
        ),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : (d == null)
              ? ErrorRetry(message: _error ?? tr('تعذّر التحميل', 'Could not load'), onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(onRefresh: _load, child: _body(d)),
    );
  }

  Widget _body(Map<String, dynamic> d) {
    final t = Map<String, dynamic>.from(d['totals'] ?? {});
    final claims = Map<String, dynamic>.from(d['claims'] ?? {});
    final docs = List<Map>.from(d['documents'] ?? []);
    final corporate = List<Map>.from(d['corporate'] ?? []);
    final analytics = List<Map>.from(d['analytics'] ?? []);
    final total = (t['vehicles'] as num?)?.toInt() ?? 0;
    final nActive = _filters.values.where((v) => v.isNotEmpty).length;
    return ListView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 30), children: [
      if (_refreshing) const LinearProgressIndicator(minHeight: 2),
      // Quick filters: the important columns only
      AppCard(
        padding: const EdgeInsets.all(10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('فلترة اللوحة — كل الأرقام تتعدّل حسب اختيارك', 'Filter the dashboard — every number follows your choice'), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: T.inkFaint)),
          const SizedBox(height: 6),
          HrQuickFilters(value: _filters, onChanged: _setFilters, optionsUrl: '/api/vehicle-registry/filters', keys: _quickKeys),
        ]),
      ),
      const SizedBox(height: 8),
      // Full filtering with all columns, plus the five chips
      AppCard(
        padding: const EdgeInsets.all(10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: nActive > 0 ? T.orange : T.navy, minimumSize: const Size(0, 44)),
              onPressed: _openFilterSheet,
              icon: const Icon(Icons.tune, size: 18),
              label: Text(nActive > 0 ? '${tr('التصفية', 'Filter')} ($nActive)' : tr('التصفية', 'Filter')),
            ),
            const SizedBox(width: 10),
            Expanded(child: Text('${tr('المركبات المطابقة', 'Matching vehicles')}: $total', textAlign: TextAlign.end, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkSoft))),
          ]),
          if (nActive > 0) ...[
            const SizedBox(height: 6),
            Wrap(spacing: 4, runSpacing: 4, children: [
              for (final e in _filters.entries)
                if (e.value.isNotEmpty)
                  InputChip(
                    label: Text('${e.key}: ${e.value}', style: const TextStyle(fontSize: 11)),
                    visualDensity: VisualDensity.compact,
                    onDeleted: () => _setFilters({..._filters}..remove(e.key)),
                  ),
              TextButton(onPressed: () => _setFilters({}), child: Text(tr('مسح الكل', 'Clear all'))),
            ]),
          ],
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final x in _toggles)
              ChoiceChip(
                label: Text(tr(x.$3, x.$4), style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: _filters[x.$1] == x.$2 ? Colors.white : T.inkSoft)),
                selected: _filters[x.$1] == x.$2,
                selectedColor: T.navy,
                showCheckmark: false,
                onSelected: (_) {
                  final n = {..._filters};
                  if (n[x.$1] == x.$2) { n.remove(x.$1); } else { n[x.$1] = x.$2; }
                  _setFilters(n);
                },
              ),
          ]),
        ]),
      ),
      const SizedBox(height: 12),
      // 1. Big numbers
      Wrap(spacing: 8, runSpacing: 8, children: [
        _big(tr('إجمالي المركبات', 'Vehicles'), t['vehicles'], T.orange, onTap: () => _openList({}, tr('إجمالي المركبات', 'Vehicles'))),
        _big(tr('يحتاج متابعة', 'Needs attention'), t['needsAttention'], T.danger,
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const VehicleRegistryAlertsScreen()))),
        _big(tr('أقساط التأمين (ر.س)', 'Premiums (SAR)'), _money(t['insuredPremiumSar']), const Color(0xFF16A34A)),
        _big(tr('عليها جهاز تتبّع', 'With GPS'), t['withGps'], const Color(0xFF0EA5E9), onTap: () => _openList({'hasGps': '1'}, tr('عليها جهاز تتبّع', 'With GPS'))),
        _big(tr('شرائح وقود نشطة', 'Active fuel cards'), t['activeFuelCards'], const Color(0xFF8B5CF6)),
        _big(tr('مركبات لها حوادث', 'With accidents'), t['withAccidents'], const Color(0xFFEA580C), onTap: () => _go(const VehicleClaimsScreen())),
        _big(tr('ينقصها بيانات', 'Missing data'), t['withMissing'], T.violet, onTap: () => _openList({'missing': '1'}, tr('ينقصها بيانات', 'Missing data'))),
      ]),
      // 2. Documents
      _section(tr('المستندات ومواعيد انتهائها', 'Documents and their expiry'), [for (final doc in docs) _docCard(doc)]),
      // 3. Company documents: their expiry stops all work
      if (corporate.isNotEmpty)
        _section(tr('وثائق التأمين على مستوى الشركة', 'Company-level policies'), [
          for (final p in corporate)
            Builder(builder: (_) {
              final m = stateMetaOf('${p['state'] ?? ''}');
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Pressable(onTap: () => _go(const VehicleCorporatePoliciesScreen()), child: AppCard(
                  topAccent: p['state'] == 'valid' ? null : m.$3,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${p['scopeAr'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                          Text('${p['companyAr'] ?? ''} · ${_fmtDate(p['expiryDate'])}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                        ]),
                      ),
                      Chip2(tr(m.$1, m.$2), m.$3),
                    ]),
                    const SizedBox(height: 6),
                    Text(_daysText(p['days']), style: TextStyle(fontSize: 12, color: m.$3)),
                    if ((p['premiumSar'] as num? ?? 0) != 0)
                      Text('${tr('القسط', 'Premium')}: ${_money(p['premiumSar'])} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                  ]),
                )),
              );
            }),
        ]),
      // 4. Accidents and claims
      _section(tr('الحوادث والمطالبات التأمينية', 'Accidents & insurance claims'), [
        Wrap(spacing: 8, runSpacing: 8, children: [
          _big(tr('إجمالي الحوادث', 'Total'), claims['total'], T.ink, onTap: () => _go(const VehicleClaimsScreen())),
          _big(tr('مطالبات مفتوحة', 'Open claims'), claims['open'], const Color(0xFFF59E0B), onTap: () => _go(const VehicleClaimsScreen(initialStatus: 'pending'))),
          _big(tr('الخطأ علينا', 'Our fault'), claims['ourFault'], T.danger, onTap: () => _go(const VehicleClaimsScreen(initialFault: 'ours'))),
          _big(tr('المبلغ المقدَّر (ر.س)', 'Estimated (SAR)'), _money(claims['estimatedSar']), const Color(0xFF0EA5E9), onTap: () => _go(const VehicleClaimsScreen())),
          _big(tr('متوقع استرداده (ر.س)', 'Expected recovery'), _money(claims['expectedRecoverySar']), const Color(0xFF16A34A), onTap: () => _go(const VehicleClaimsScreen())),
        ]),
      ]),
      // Analytics: each chip opens what is in it
      if (analytics.isNotEmpty)
        _section(tr('التحليلات', 'Analytics'), [for (final a in analytics) _analyticCard(a, total)],
            hint: tr('اضغط أيّ شريحة لعرض ما فيها', 'Tap any band to see what is in it')),
    ]);
  }
}
