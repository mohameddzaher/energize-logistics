import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/flex_match.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'vehicle_corporate.dart' show vStateColor, vStateLabel;
import 'vehicle_registry.dart' show money, fmtDate, daysText, VehicleRegistryDetailScreen, VehicleRegistryListScreen;

/// سجلّات قسم المركبات — نظيرُ /system/vehicles/registry/records.
///
/// المُلّاك والمفوَّضون ومزوّدو التتبّع والأجهزة وشرائح الوقود — كلها مبنيّة من
/// المركبات نفسها (GET /api/vehicle-registry/registers). تبويب لكل سجلّ، شرائح
/// وبحث وفلاتر أعمدة على طريقة إكسل، وكل صفّ مدخل: عدد المركبات يفتحها مفلترة،
/// واللوحة تفتح ملف المركبة.

const _tabs = ['owners', 'authorizedPersons', 'gpsProviders', 'gpsDevices', 'gpsUnits', 'fuelCards'];

typedef _Chip = (String key, String ar, String en, Color color, bool Function(Map<String, dynamic>)? test);

String _s(dynamic v) => v == null ? '' : v.toString();
num _n(dynamic v) => v is num ? v : num.tryParse(_s(v)) ?? 0;

// ── أعمدةُ كلّ سجلّ وقارئُها — واحدٌ للعرض ولفلتر الأعمدة (COL_DEFS + GETTERS) ──
final Map<String, List<(String, String, String, dynamic Function(Map<String, dynamic>))>> _colDefs = {
  'gpsUnits': [
    ('serial', 'السيريال', 'Serial', (x) => x['value']),
    ('plate', 'اللوحة', 'Plate', (x) => x['plateNumber']),
    ('device', 'الجهاز', 'Device', (x) => x['deviceModel']),
    ('provider', 'المزوّد', 'Provider', (x) => x['provider']),
    ('deviceStatus', 'حالة الجهاز', 'Device status', (x) => x['deviceStatusAr']),
    ('expiry', 'ينتهي في', 'Expires', (x) => fmtDate(x['expiryDate'])),
    ('left', 'المتبقي', 'Left', (x) => x['state']),
  ],
  'fuelCards': [
    ('chip', 'رقم الشريحة', 'Chip', (x) => x['value']),
    ('plate', 'اللوحة', 'Plate', (x) => x['plateNumber']),
    ('onInvoice', 'اللوحة على الفاتورة', 'On invoice', (x) => x['plateOnInvoiceAr']),
    ('status', 'الحالة', 'Status', (x) => x['statusAr']),
    ('type', 'نوع الاستهلاك', 'Type', (x) => x['consumptionTypeAr']),
    ('limit', 'الحدّ', 'Limit', (x) => x['limitSar'] == null ? '' : _s(x['limitSar'])),
    ('sector', 'القطاع', 'Sector', (x) => x['sectorAr']),
  ],
  'default': [
    ('name', 'الاسم', 'Name', (x) => x['value']),
    ('details', 'تفاصيل', 'Details', (x) => [x['commercialRegistration'], x['iqamaNumber'], x['jobTitleAr']].where((e) => _s(e).isNotEmpty).join(' · ')),
    ('vehicles', 'المركبات', 'Vehicles', (x) => x['vehicles']),
    ('expired', 'منها منتهية', 'Expired', (x) => x['expired']),
  ],
};

class VehicleRecordsScreen extends StatefulWidget {
  const VehicleRecordsScreen({super.key});
  @override
  State<VehicleRecordsScreen> createState() => _VehicleRecordsScreenState();
}

class _VehicleRecordsScreenState extends State<VehicleRecordsScreen> {
  Map<String, dynamic> _registers = {};
  Map<String, dynamic> _totals = {};
  bool _loading = true;
  String? _error;
  String _tab = 'owners';
  String _q = '';
  String _filter = '';
  final _qCtl = TextEditingController();
  // فلاتر الأعمدة: مفتاح العمود ← القيم المختارة (فارغ = «(فارغ)»)
  Map<String, Set<String>> _colFilters = {};
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('vreg:updated', _onLive);
  }

  @override
  void dispose() { Live.instance.off('vreg:updated', _onLive); _qCtl.dispose(); super.dispose(); }

  Future<void> _load() async {
    final my = ++_seq;
    try {
      final d = await Api.instance.get('/api/vehicle-registry/registers');
      if (!mounted || my != _seq) return;
      setState(() {
        _registers = Map<String, dynamic>.from(d['registers'] ?? {});
        _totals = Map<String, dynamic>.from(d['totals'] ?? {});
        _loading = false; _error = null;
      });
    } catch (e) {
      if (!mounted || my != _seq) return;
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Map<String, dynamic> _reg(String k) => _registers[k] is Map ? Map<String, dynamic>.from(_registers[k]) : {};
  List<Map<String, dynamic>> get _rows =>
      ((_reg(_tab)['items'] as List?) ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  List<(String, String, String, dynamic Function(Map<String, dynamic>))> get _cols => _colDefs[_tab] ?? _colDefs['default']!;

  // الشرائح تختلف باختلاف السجلّ — لكل سؤاله.
  List<_Chip> get _chips {
    final all = <_Chip>[('', 'الكل', 'All', T.navy, null)];
    if (_tab == 'gpsUnits') {
      return [
        ...all,
        ('expired', 'اشتراكه منتهٍ', 'Subscription expired', T.danger, (x) => x['state'] == 'expired'),
        ('critical', 'حرج', 'Critical', const Color(0xFFEA580C), (x) => x['state'] == 'critical'),
        ('warning', 'تحذير', 'Warning', const Color(0xFFD97706), (x) => x['state'] == 'warning'),
        ('upcoming', 'قريب', 'Upcoming', const Color(0xFF0EA5E9), (x) => x['state'] == 'upcoming'),
        ('valid', 'ساري', 'Valid', T.success, (x) => x['state'] == 'valid'),
        ('stolen', 'الجهاز مسروق', 'Device stolen', T.violet, (x) => _s(x['deviceStatusAr']).contains('مسروق')),
      ];
    }
    if (_tab == 'fuelCards') {
      return [
        ...all,
        ('active', 'نشطة', 'Active', T.success, (x) => _s(x['statusAr']).contains('نشط') && !_s(x['statusAr']).contains('غير')),
        ('inactive', 'غير نشطة', 'Inactive', T.warn, (x) => RegExp('غير نشط|موقوف').hasMatch(_s(x['statusAr']))),
        ('noLimit', 'بلا حدّ استهلاك', 'No limit', T.inkSoft, (x) => x['limitSar'] == null),
      ];
    }
    return [
      ...all,
      ('many', 'أكثر من ٥ مركبات', 'More than 5 vehicles', T.info, (x) => _n(x['vehicles']) > 5),
      ('withExpired', 'عليها مركبات منتهية', 'Has expired vehicles', T.danger, (x) => _n(x['expired']) > 0),
      ('one', 'مركبة واحدة', 'Single vehicle', T.inkSoft, (x) => _n(x['vehicles']) == 1),
    ];
  }

  // البحث يمرّ على كلّ قيمةٍ نصّيّة/رقميّة في الصفّ (عدا filter وvehicleId)
  List<Map<String, dynamic>> _searched(List<Map<String, dynamic>> rows) {
    final q = flexFold(_q.trim());
    if (q.isEmpty) return rows;
    return rows.where((x) => x.entries
        .where((e) => e.key != 'filter' && e.key != 'vehicleId')
        .expand((e) => e.value is List ? e.value as List : [e.value])
        .where((v) => v is String || v is num)
        .any((v) => flexFold(v).contains(q))).toList();
  }

  List<Map<String, dynamic>> _applyCols(List<Map<String, dynamic>> rows) {
    if (_colFilters.isEmpty) return rows;
    final getters = {for (final c in _cols) c.$1: c.$4};
    return rows.where((r) => _colFilters.entries.every((f) {
          final g = getters[f.key];
          return g == null || f.value.contains(_s(g(r)));
        })).toList();
  }

  void _setTab(String k) => setState(() { _tab = k; _filter = ''; _q = ''; _qCtl.clear(); _colFilters = {}; });

  void _openVehicles(Map<String, dynamic> x) {
    final f = x['filter'] is Map ? (x['filter'] as Map).map((k, v) => MapEntry(k.toString(), _s(v))) : <String, String>{};
    Navigator.push(context, MaterialPageRoute(builder: (_) => VehicleRegistryListScreen(filters: f, filterLabel: _s(x['value']))));
  }

  void _openVehicle(Map<String, dynamic> x) {
    if (_s(x['vehicleId']).isEmpty) return;
    Navigator.push(context, MaterialPageRoute(builder: (_) => VehicleRegistryDetailScreen(id: _s(x['vehicleId']), plate: _s(x['plateNumber']))));
  }

  // ── التصدير: «المعروض» و«الكلّ» — نفس أعمدة الويب ──────────────────────
  List<ExportCol> get _exportCols => _tab == 'gpsUnits'
      ? [
          ExportCol('السيريال', 'Serial', (r) => r['value']),
          ExportCol('اللوحة', 'Plate', (r) => r['plateNumber']),
          ExportCol('الجهاز', 'Device', (r) => r['deviceModel']),
          ExportCol('المزوّد', 'Provider', (r) => r['provider']),
          ExportCol('ينتهي في', 'Expires', (r) => fmtDate(r['expiryDate'])),
        ]
      : _tab == 'fuelCards'
          ? [
              ExportCol('رقم الشريحة', 'Chip', (r) => r['value']),
              ExportCol('اللوحة', 'Plate', (r) => r['plateNumber']),
              ExportCol('اللوحة على الفاتورة', 'Plate on invoice', (r) => r['plateOnInvoiceAr']),
              ExportCol('الحالة', 'Status', (r) => r['statusAr']),
              ExportCol('الحدّ', 'Limit', (r) => r['limitSar']),
            ]
          : [
              ExportCol('الاسم', 'Name', (r) => r['value']),
              ExportCol('المركبات', 'Vehicles', (r) => r['vehicles']),
              ExportCol('منها منتهية', 'Expired', (r) => r['expired']),
            ];

  Future<void> _export(List<Map<String, dynamic>> shown, List<Map<String, dynamic>> all) async {
    final which = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(leading: const Icon(Icons.filter_alt_outlined), title: Text(tr('تصدير المعروض', 'Export shown')), trailing: Text('${shown.length}'), onTap: () => Navigator.pop(c, 'shown')),
        ListTile(leading: const Icon(Icons.select_all), title: Text(tr('تصدير الكلّ', 'Export everything')), trailing: Text('${all.length}'), onTap: () => Navigator.pop(c, 'all')),
      ])),
    );
    if (which == null || !mounted) return;
    final rows = which == 'shown' ? shown : all;
    if (rows.isEmpty) { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('لا صفوف للتصدير', 'Nothing to export')))); return; }
    final name = _s(_reg(_tab)['ar']).isEmpty ? _tab : _s(_reg(_tab)['ar']);
    await exportExcel(context, fileName: 'vehicle-$_tab', sheets: [(name, _exportCols, rows)]);
  }

  // ── فلتر الأعمدة: عمودٌ ← قيمه بأعدادها محسوبة على المعروض قبل فلاتر الأعمدة ──
  Future<void> _columnFilters(List<Map<String, dynamic>> base) async {
    final r = await showModalBottomSheet<Map<String, Set<String>>>(
      context: context, isScrollControlled: true, useSafeArea: true,
      builder: (_) => _ColumnFilterSheet(cols: _cols, rows: base, value: _colFilters),
    );
    if (r != null && mounted) setState(() => _colFilters = r);
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    final chips = _chips;
    final searched = _searched(rows);
    final active = chips.firstWhere((c) => c.$1 == _filter, orElse: () => chips.first);
    final chipShown = active.$5 == null ? searched : searched.where(active.$5!).toList();
    final shown = _applyCols(chipShown);

    return AppScaffold(
      title: Text(tr('سجلّات القسم', 'Registers')),
      actions: [
        IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined),
            onPressed: _loading ? null : () => _export(shown, rows)),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  // التبويبات بأعدادها
                  SizedBox(
                    height: 48,
                    child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(12, 8, 12, 4), children: [
                      for (final k in _tabs)
                        Padding(
                          padding: const EdgeInsetsDirectional.only(end: 6),
                          child: ChoiceChip(
                            label: Text('${tr(_s(_reg(k)['ar']), _s(_reg(k)['en']))}  ${_totals[k] ?? 0}'),
                            selected: _tab == k,
                            selectedColor: T.navy,
                            labelStyle: TextStyle(color: _tab == k ? Colors.white : T.ink, fontWeight: FontWeight.w700, fontSize: 12.5),
                            showCheckmark: false,
                            onSelected: (_) => _setTab(k),
                          ),
                        ),
                    ]),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 6, 14, 4),
                    child: Row(children: [
                      Expanded(child: SearchField(controller: _qCtl, onChanged: (v) => setState(() => _q = v),
                          hint: tr('بحث…', 'Search…'))),
                      const SizedBox(width: 8),
                      Badge(
                        isLabelVisible: _colFilters.isNotEmpty,
                        label: Text('${_colFilters.length}'),
                        child: IconButton.filled(
                          style: IconButton.styleFrom(backgroundColor: _colFilters.isEmpty ? T.navy : T.orange),
                          tooltip: tr('فلاتر الأعمدة', 'Column filters'),
                          icon: const Icon(Icons.view_column_outlined),
                          onPressed: () => _columnFilters(chipShown),
                        ),
                      ),
                    ]),
                  ),
                  SizedBox(
                    height: 44,
                    child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4), children: [
                      for (final c in chips)
                        Padding(
                          padding: const EdgeInsetsDirectional.only(end: 6),
                          child: FilterChip(
                            label: Text('${tr(c.$2, c.$3)} ${c.$5 == null ? searched.length : searched.where(c.$5!).length}'),
                            selected: _filter == c.$1,
                            selectedColor: c.$4.withValues(alpha: 0.15),
                            labelStyle: TextStyle(color: _filter == c.$1 ? c.$4 : T.inkSoft, fontWeight: FontWeight.w700, fontSize: 12),
                            showCheckmark: false,
                            onSelected: (_) => setState(() => _filter = c.$1),
                          ),
                        ),
                    ]),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    child: Row(children: [
                      Text(tr('${shown.length} من ${rows.length}', '${shown.length} of ${rows.length}'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                      const Spacer(),
                      if (_colFilters.isNotEmpty)
                        TextButton.icon(onPressed: () => setState(() => _colFilters = {}), icon: const Icon(Icons.filter_alt_off_outlined, size: 16),
                            label: Text(tr('مسح فلاتر الأعمدة (${_colFilters.length})', 'Clear column filters (${_colFilters.length})'), style: const TextStyle(fontSize: 12))),
                    ]),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: shown.isEmpty
                          ? ListView(children: [EmptyState(icon: Icons.inventory_2_outlined, title: tr('لا نتائج', 'No results'))])
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              padding: const EdgeInsets.fromLTRB(14, 6, 14, 14),
                              itemCount: shown.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (_, i) => _tile(shown[i]),
                            ),
                    ),
                  ),
                ]),
    );
  }

  Widget _kv(String l, String v, {bool ltr = false}) => Padding(
        padding: const EdgeInsets.only(top: 3),
        child: Row(children: [
          Text('$l: ', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          Expanded(child: Text(v.isEmpty ? '—' : v, textDirection: ltr ? TextDirection.ltr : null, textAlign: TextAlign.start,
              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
        ]),
      );

  Widget _plate(Map<String, dynamic> x) => InkWell(
        onTap: () => _openVehicle(x),
        child: Text(_s(x['plateNumber']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: T.navy, decoration: TextDecoration.underline)),
      );

  Widget _tile(Map<String, dynamic> x) {
    if (_tab == 'gpsUnits') {
      final st = _s(x['state']);
      return AppCard(
        topAccent: vStateColor(st),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(_s(x['value']), style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w700, fontSize: 13))),
            Chip2(x['daysRemaining'] == null ? vStateLabel(st) : daysText(x['daysRemaining']), vStateColor(st)),
          ]),
          const SizedBox(height: 4),
          _plate(x),
          _kv(tr('الجهاز', 'Device'), _s(x['deviceModel'])),
          _kv(tr('المزوّد', 'Provider'), _s(x['provider'])),
          _kv(tr('حالة الجهاز', 'Device status'), _s(x['deviceStatusAr'])),
          _kv(tr('ينتهي في', 'Expires'), fmtDate(x['expiryDate'])),
        ]),
      );
    }
    if (_tab == 'fuelCards') {
      return AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(_s(x['value']), style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w700, fontSize: 13))),
            if (_s(x['statusAr']).isNotEmpty) Chip2(_s(x['statusAr']), T.inkSoft),
          ]),
          const SizedBox(height: 4),
          _plate(x),
          _kv(tr('اللوحة على الفاتورة', 'On invoice'), _s(x['plateOnInvoiceAr']), ltr: true),
          _kv(tr('نوع الاستهلاك', 'Type'), _s(x['consumptionTypeAr'])),
          _kv(tr('الحدّ', 'Limit'), x['limitSar'] != null ? money(x['limitSar']) : ''),
          _kv(tr('القطاع', 'Sector'), _s(x['sectorAr'])),
        ]),
      );
    }
    final details = [x['commercialRegistration'], x['iqamaNumber'], x['jobTitleAr'],
      ...((x['devices'] as List?) ?? []), ...((x['providers'] as List?) ?? [])].where((e) => _s(e).isNotEmpty).join(' · ');
    final expired = _n(x['expired']);
    return AppCard(
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(_s(x['value']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
          if (details.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 3), child: Text(details, style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
        ])),
        const SizedBox(width: 8),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          // عددُ المركبات يفتحها مفلترةً على هذا الصفّ
          ActionChip(
            label: Text('${x['vehicles'] ?? 0} ${tr('مركبة', 'vehicles')}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12, color: Color(0xFF075985))),
            backgroundColor: const Color(0xFFF0F9FF),
            side: const BorderSide(color: Color(0xFFBAE6FD)),
            onPressed: () => _openVehicles(x),
          ),
          if (expired > 0) Chip2(tr('$expired منتهية', '$expired expired'), T.danger),
        ]),
      ]),
    );
  }
}

// ══════════════════ فلتر الأعمدة (طريقة إكسل) ══════════════════
class _ColumnFilterSheet extends StatefulWidget {
  final List<(String, String, String, dynamic Function(Map<String, dynamic>))> cols;
  final List<Map<String, dynamic>> rows;
  final Map<String, Set<String>> value;
  const _ColumnFilterSheet({required this.cols, required this.rows, required this.value});
  @override
  State<_ColumnFilterSheet> createState() => _ColumnFilterSheetState();
}

class _ColumnFilterSheetState extends State<_ColumnFilterSheet> {
  late final Map<String, Set<String>> _v = {for (final e in widget.value.entries) e.key: {...e.value}};
  String? _open;
  String _q = '';

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      expand: false, initialChildSize: 0.75, maxChildSize: 0.95,
      builder: (_, sc) {
        if (_open == null) {
          return Column(children: [
            Padding(padding: const EdgeInsets.all(14), child: Row(children: [
              Expanded(child: Text(tr('فلاتر الأعمدة', 'Column filters'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
              if (_v.isNotEmpty) TextButton(onPressed: () => setState(_v.clear), child: Text(tr('مسح الكل', 'Clear all'))),
            ])),
            Expanded(child: ListView(controller: sc, children: [
              for (final c in widget.cols)
                ListTile(
                  title: Text(tr(c.$2, c.$3)),
                  subtitle: _v[c.$1] == null ? null : Text(tr('${_v[c.$1]!.length} قيمة مختارة', '${_v[c.$1]!.length} selected'), style: const TextStyle(color: T.orange)),
                  trailing: const Icon(Icons.chevron_left),
                  onTap: () => setState(() { _open = c.$1; _q = ''; }),
                ),
            ])),
            SafeArea(top: false, child: Padding(padding: const EdgeInsets.all(12), child: SizedBox(width: double.infinity,
                child: FilledButton(onPressed: () => Navigator.pop(context, _v), child: Text(tr('تطبيق', 'Apply')))))),
          ]);
        }
        final col = widget.cols.firstWhere((c) => c.$1 == _open);
        final counts = <String, int>{};
        for (final r in widget.rows) {
          final v = col.$4(r);
          final s = v == null ? '' : v.toString();
          counts[s] = (counts[s] ?? 0) + 1;
        }
        final q = flexFold(_q.trim());
        final values = counts.keys.where((k) => q.isEmpty || flexFold(k).contains(q)).toList()..sort();
        final sel = _v[_open!] ?? <String>{};
        String label(String k) => k.isEmpty ? tr('(فارغ)', '(Blank)') : (_open == 'left' ? vStateLabel(k) : k);
        void toggle(String k) => setState(() {
              final s = {...sel};
              s.contains(k) ? s.remove(k) : s.add(k);
              if (s.isEmpty) { _v.remove(_open); } else { _v[_open!] = s; }
            });
        return Column(children: [
          Padding(padding: const EdgeInsets.fromLTRB(4, 8, 14, 0), child: Row(children: [
            IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => setState(() => _open = null)),
            Expanded(child: Text(tr(col.$2, col.$3), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
            if (sel.isNotEmpty) TextButton(onPressed: () => setState(() => _v.remove(_open)), child: Text(tr('مسح', 'Clear'))),
          ])),
          Padding(padding: const EdgeInsets.symmetric(horizontal: 14), child: SearchField(
            onChanged: (v) => setState(() => _q = v),
            hint: tr('بحث…', 'Search…'))),
          Expanded(child: ListView(controller: sc, keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
            if (values.isEmpty && q.isNotEmpty)
              Padding(padding: const EdgeInsets.all(18), child: Text(tr('لا نتائج مطابقة', 'No matches'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
            for (final k in values)
              CheckboxListTile(
                dense: true, value: sel.contains(k), activeColor: T.orange,
                title: Text(label(k)), secondary: Text('${counts[k]}', style: const TextStyle(color: T.inkFaint)),
                onChanged: (_) => toggle(k),
              ),
          ])),
          SafeArea(top: false, child: Padding(padding: const EdgeInsets.all(12), child: SizedBox(width: double.infinity,
              child: FilledButton(onPressed: () => Navigator.pop(context, _v), child: Text(tr('تطبيق', 'Apply')))))),
        ]);
      },
    );
  }
}
