import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/lookup_field.dart';
import '../ui/theme.dart';
import '../ui/tire_states.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'ls2_common.dart';
import 'ls2_rims.dart';
import 'ls2_tires.dart';
import 'ls2_vehicle_assets.dart';

/// Fleet assets (tyres, trailers, flatbeds): the same operations as the web: register, remove to warehouse / renewal / damaged / scrap with a condition percentage, mount / move with the occupant's fate and a replacement, renewal result, and the event log.
class Ls2FleetAssetsScreen extends StatefulWidget {
  const Ls2FleetAssetsScreen({super.key});
  @override
  State<Ls2FleetAssetsScreen> createState() => _Ls2FleetAssetsScreenState();
}

List<Map<String, dynamic>> _l(dynamic v) =>
    v is List ? List<Map<String, dynamic>>.from(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : const [];

// All states live in ui/tire_states.dart, one definition read by the server, the screen and the mobile app. Only the grade remains here.

// Grade describes the tyre, not its place: new or used, nothing else. A third grade, "at_factory", used to describe a location, mixing place with tyre description.
const _conditions = {
  'new': ('جديد', 'New', T.success),
  'used': ('مستعمل', 'Used', T.info),
};

class _Ls2FleetAssetsScreenState extends State<Ls2FleetAssetsScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  String _q = '';
  String _qFlat = '';
  String _qTrail = '';
  String _filter = '';
  // Sensor matching: what is recorded in the workshop sheet against what Wialon actually sends.
  List<Map<String, dynamic>> _sensorRows = [];
  bool _sensorLoaded = false;
  bool _sensorRequested = false;
  String _qSensor = '';
  // Search controllers live at the screen level: tab switches and loading rebuild the fields, so the text survives while the word still filters.
  final _qCtl = TextEditingController();
  final _qFlatCtl = TextEditingController();
  final _qTrailCtl = TextEditingController();
  final _qSensorCtl = TextEditingController();
  final Set<String> _openSensor = {};
  // The rims tab owns its data; the header export asks it while that tab is open.
  final _rimsKey = GlobalKey<Ls2RimsTabState>();
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () { _load(); if (_sensorLoaded) _loadSensors(); };
    Live.instance.on('ls2:updated', _onLive);
    // Each flatbed's panel in the vehicle register; an edit there shows here immediately.
    Live.instance.on('vreg:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('ls2:updated', _onLive);
    Live.instance.off('vreg:updated', _onLive);
    for (final c in [_qCtl, _qFlatCtl, _qTrailCtl, _qSensorCtl]) { c.dispose(); }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/ls2/assets/overview');
      if (!mounted) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _loadSensors() async {
    try {
      final d = await Api.instance.get('/api/ls2/assets/sensor-check');
      if (mounted) setState(() { _sensorRows = _l(d['rows']); _sensorLoaded = true; });
    } catch (_) {
      if (mounted) setState(() => _sensorLoaded = true);
    }
  }

  /// Section admin rank, like isLs2Admin on the web (only they may import).
  bool _isAdmin(AuthProvider a) =>
      const ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'operations_manager', 'operations_team_leader', 'workshop_manager', 'location_manager', 'location_team_leader', 'vehicles_manager', 'vehicles_team_leader', 'data_manager', 'data_analyst', 'data_entry'].contains(a.role)
      || a.canEditSection('Location Solutions');

  // Import the workshop sheet (JSON): safe to repeat, a tyre found on another vehicle is recorded as a move.
  Future<void> _import() async {
    final ctrl = TextEditingController();
    Map<String, dynamic>? result;
    bool busy = false;
    await showModalBottomSheet(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setS) => Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('استيراد كشف الورشة (JSON)', 'Import workshop JSON'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
          const SizedBox(height: 6),
          Text(tr('ألصِق صيغة JSON نفسها المستخدَمة في الورشة: { "vehicles": [...] } و/أو { "flatbeds": [...] }. الاستيراد آمن للتكرار: الفردة التي تظهر على مركبة أخرى تُسجَّل كنقل بتاريخه، لا كتسجيل جديد.',
                  'Paste the workshop-collected JSON: { "vehicles": [...] } and/or { "flatbeds": [...] }. Idempotent: a serial appearing on another truck is recorded as a transfer, not a duplicate.'),
              style: const TextStyle(fontSize: 12, color: T.inkFaint)),
          const SizedBox(height: 10),
          TextField(
            controller: ctrl, maxLines: 10, minLines: 6, textDirection: TextDirection.ltr,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
            decoration: const InputDecoration(hintText: '{ "vehicles": [ { "vehicle_number": "2708", "trailer_number": "23", "tires": [ ... ] } ] }'),
          ),
          if (result != null)
            Container(
              margin: const EdgeInsets.only(top: 10),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: T.success.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
              child: Text(tr(
                'تم: ${result!['flatbeds']} سطحة · ${result!['trailers']} حركة تيدر · ${result!['tiresNew']} فردة جديدة · ${result!['tiresMoved']} نُقلت · ${result!['tiresUnchanged']} بدون تغيير',
                'Done: ${result!['flatbeds']} flatbeds · ${result!['trailers']} trailer moves · ${result!['tiresNew']} new tires · ${result!['tiresMoved']} moved · ${result!['tiresUnchanged']} unchanged'),
                style: const TextStyle(color: T.success, fontWeight: FontWeight.w700, fontSize: 12.5)),
            ),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: FilledButton(
              style: FilledButton.styleFrom(backgroundColor: T.orange),
              onPressed: busy ? null : () async {
                dynamic payload;
                try { payload = jsonDecode(ctrl.text); } catch (_) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('JSON غير صالح', 'Invalid JSON'))));
                  return;
                }
                setS(() => busy = true);
                try {
                  final r = await Api.instance.post('/api/ls2/assets/import', payload);
                  setS(() { result = _m(r['summary']); busy = false; });
                } catch (e) {
                  setS(() => busy = false);
                  if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
                }
              },
              child: Text(busy ? tr('جارٍ الاستيراد…', 'Importing…') : tr('استيراد', 'Import')),
            )),
            if (result != null) ...[
              const SizedBox(width: 8),
              Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(c), child: Text(tr('إغلاق وتحديث', 'Close & refresh')))),
            ],
          ]),
        ]),
      )),
    );
    _load();
  }

  Map<String, dynamic> _m(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

  // Excel: the current tab (after filter) or all assets in three sheets.
  static const _sensorLabels = {'yes': ('يوجد', 'Has sensor'), 'no': ('لا يوجد', 'No sensor'), 'unknown': ('غير محدد', 'Unknown')};
  List<ExportCol> get _flatbedCols => [
        ExportCol('الترقيم', 'No.', (r) => r['numbering'] ?? ''),
        ExportCol('اللوحة', 'Plate', (r) => r['plate'] ?? ''),
        ExportCol('الدفعة', 'Batch', (r) => r['batch'] ?? ''),
        ExportCol('الماركة', 'Brand', (r) => r['brand'] ?? ''),
        ExportCol('التيدر الحالي', 'Trailer', (r) => r['currentTrailerNumber'] ?? ''),
        ExportCol('السائق', 'Driver', (r) => r['driver'] ?? ''),
        ExportCol('العداد (كم)', 'Odometer (km)', (r) => r['odometerKm'] ?? ''),
        ExportCol('كاوتشات مسجّلة', 'Registered tires', (r) => r['tireCount'] ?? ''),
      ];
  List<ExportCol> get _trailerCols => [
        ExportCol('رقم التيدر', 'Trailer no.', (r) => r['trailerNumber'] ?? ''),
        ExportCol('مركّب على', 'On flatbed', (r) => r['currentPlate'] ?? tr('غير مركّب', 'unhitched')),
        ExportCol('الحالة', 'Status', (r) => r['status'] ?? ''),
        ExportCol('ملاحظات', 'Notes', (r) => r['notes'] ?? ''),
      ];
  List<ExportCol> get _tireCols => [
        ExportCol('رقم الفردة', 'Tire no.', (r) => r['tireNumber'] ?? ''),
        ExportCol('السيريال', 'Serial', (r) => r['serial'] ?? ''),
        ExportCol('النوع', 'Type', (r) => r['type'] ?? ''),
        ExportCol('المقاس', 'Size', (r) => r['size'] ?? ''),
        ExportCol('سينسور', 'Sensor', (r) { final x = _sensorLabels[r['sensor']]; return x == null ? (r['sensor'] ?? '') : tr(x.$1, x.$2); }),
        ExportCol('الدرجة', 'Grade', (r) => r['condition'] == 'new' ? tr('جديد', 'New') : tr('مستعمل', 'Used')),
        ExportCol('الحالة ٪', 'Cond. %', (r) => r['conditionPercent'] != null ? '${r['conditionPercent']}%' : ''),
        ExportCol('الحالة', 'Status', (r) { final st = tireStateOf(r); return tr(st.ar, st.en); }),
        ExportCol('السيارة', 'Vehicle', (r) => r['plate'] ?? ''),
        ExportCol('المكان الآن', 'Where now', _placeOf),
        ExportCol('التيدر', 'Trailer', (r) => tireStateKey(r) == 'mounted' && RegExp('تيدر|تريلة').hasMatch('${r['section'] ?? ''}') ? (r['trailerNumber'] ?? '') : ''),
        ExportCol('الموقع', 'Position', (r) => r['positionLabel'] ?? ''),
        ExportCol('القسم', 'Section', (r) => r['section'] ?? ''),
        ExportCol('استبن؟', 'Spare?', (r) => r['isSpare'] == true ? tr('نعم', 'Yes') : ''),
        ExportCol('ملاحظات', 'Notes', (r) => r['notes'] ?? ''),
      ];
  List<ExportCol> get _sensorCols => [
        ExportCol('اللوحة', 'Plate', (r) => r['plate'] ?? ''),
        ExportCol('السائق', 'Driver', (r) => r['driver'] ?? ''),
        ExportCol('كاوتشات مسجّلة', 'Registered tires', (r) => r['registeredTotal'] ?? ''),
        ExportCol('مسجّل بها سينسور', 'Registered w/ sensor', (r) => r['registeredWithSensor'] ?? ''),
        ExportCol('يرسل فعليًا (مباشر)', 'Actually reporting', (r) => r['liveReporting'] ?? ''),
        ExportCol('مطابقة؟', 'Match?', (r) => r['match'] == null ? tr('لا توجد بيانات حية', 'no live data') : r['match'] == true ? tr('متطابق', 'match') : tr('غير متطابق', 'MISMATCH')),
      ];

  Future<void> _export(int tab, List<Map<String, dynamic>> tiresShown) async {
    if (tab == 4) { await _rimsKey.currentState?.exportExcel(); return; }
    List<Map<String, dynamic>> rims = const [];
    try { rims = _l((await Api.instance.get('/api/ls2/assets/rims'))['rims']); } catch (_) {}
    if (!mounted) return;
    final flatbeds = _l(_d?['flatbeds']);
    final trailers = _l(_d?['trailers']);
    final current = switch (tab) {
      1 => (tr('السطحات', 'Flatbeds'), _flatbedCols, _filtered(flatbeds, _qFlat, (f) => [f['plate'], f['registryPlate'], f['numbering'], f['brand'], f['batch'], f['currentTrailerNumber'], f['driver']])),
      2 => (tr('التيدرات', 'Trailers'), _trailerCols, _filtered(trailers, _qTrail, (x) => [x['trailerNumber'], x['currentPlate'], x['status']])),
      3 => (tr('مطابقة السينسورات', 'Sensor check'), _sensorCols, _filtered(_sensorRows, _qSensor, (r) => [r['plate'], r['driver']])),
      _ => (tr('الكاوتشات', 'Tires'), _tireCols, tiresShown),
    };
    await ls2ExportMenu(context, fileName: 'ls2-assets', options: [
      ('التبويب الحالي (بعد الفلتر)', 'Current tab (filtered)', [current]),
      ('كل الأصول (4 شيتات)', 'All assets (4 sheets)', [
        (tr('السطحات', 'Flatbeds'), _flatbedCols, flatbeds),
        (tr('التيدرات', 'Trailers'), _trailerCols, trailers),
        (tr('الكاوتشات', 'Tires'), _tireCols, _l(_d?['tires'])),
        (tr('الجنوط', 'Rims'), Ls2RimsTabState.rimExportCols, rims),
      ]),
    ]);
  }

  List<Map<String, dynamic>> _filtered(List<Map<String, dynamic>> rows, String q, List<dynamic> Function(Map<String, dynamic>) fields) {
    final f = _fold(q.trim());
    if (f.isEmpty) return rows;
    return rows.where((r) => fields(r).any((x) => _fold((x ?? '').toString()).contains(f))).toList();
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  // Same rule as the backend: match the vehicle by plate digits only (a flatbed's plate often differs from the stored tyre's plate). Arabic-Indic digits are converted to Latin, then the digits are extracted.
  String _plateKey(String? p) {
    if (p == null) return '';
    const ar = '٠١٢٣٤٥٦٧٨٩';
    final west = p.split('').map((ch) { final i = ar.indexOf(ch); return i >= 0 ? '$i' : ch; }).join();
    final digits = RegExp(r'\d+').allMatches(west).map((m) => m.group(0)).join();
    return digits.isNotEmpty ? digits : west.trim().toUpperCase();
  }

  /// Operations that record a movement: each asks for the day it actually happened (the workshop often enters a job afterwards), shown in the movement log beside the recording time.
  static final _opPath = RegExp(r'/assets/(tires|trailers)/[^/]+/(move|retire|status|renewal-result)$');

  Future<String?> _pickOpDate() async {
    final now = DateTime.now().toUtc().add(const Duration(hours: 3));
    final today = DateTime(now.year, now.month, now.day);
    final d = await showDatePicker(
      context: context, initialDate: today, firstDate: DateTime(today.year - 2), lastDate: today,
      helpText: tr('تاريخ العملية الفعلي', 'Actual operation date'),
    );
    if (d == null) return null;
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }

  Future<void> _post(String path, Map<String, dynamic> body, String okMsg, {Future<bool> Function(Map<String, dynamic>)? onDisplaced, Map<String, dynamic>? tire}) async {
    if (_opPath.hasMatch(path) && body['date'] == null) {
      final date = await _pickOpDate();
      if (date == null) return;
      body = {...body, 'date': date};
    }
    try {
      await Api.instance.post(path, body);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(okMsg)));
      _load();
    } on ApiException catch (e) {
      // A position must not stay empty. The server says which position was left empty in the replacement chain: the one the tyre itself vacated, or the position of a tyre pulled from another vehicle (which was on position X). So we ask for a tyre for it and retry with the chain one step longer, until a warehouse tyre arrives. The rule lives once on the server, not copied here.
      if (e.status == 400 && tire != null && e.message.contains('لا يجوز أن يبقى فارغًا')) {
        final m = RegExp(r'كانت عليه (\S+)').firstMatch(e.message);
        final all = _l(_d?['tires']);
        final source = m == null
            ? tire
            : all.firstWhere((x) => (x['serial'] ?? '').toString() == m.group(1), orElse: () => tire);
        final chain = [
          ...[body['replacementTireId'], body['secondReplacementTireId']].where((x) => x != null).map((x) => x.toString()),
          ...((body['chain'] as List?) ?? const []).map((x) => x.toString()),
        ];
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
        }
        final picked = await _pickReplacement(source, alsoExclude: [(tire['_id'] ?? '').toString(), ...chain]);
        if (picked != null && picked.isNotEmpty) {
          await _post(path, {...body, 'chain': [...((body['chain'] as List?) ?? const []), picked['_id']]}, okMsg, onDisplaced: onDisplaced, tire: tire);
        }
        return;
      }
      // Position occupied: ask for the occupant's fate, then repeat the same request with displacedTo.
      if (e.status == 400 && onDisplaced != null && e.message.contains('مشغول')) {
        final retry = await onDisplaced(body);
        if (retry) return;
      }
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final tires = _l(_d?['tires']);
    final q = _fold(_q.trim());
    final filtered = tires.where((t) {
      if (_filter.isNotEmpty) {
        // Filter and card share one definition (ui/tire_states.dart), so the counter never shows a number the card does not open.
        if (_filter == 'unmounted') {
          if (tireStateKey(t) == 'mounted') return false;
        } else if (_filter == 'store') {
          if (!tireInStore(t)) return false;
        } else if (tireStateKey(t) != _filter) {
          return false;
        }
      }
      if (q.isEmpty) return true;
      return [t['serial'], t['tireNumber'], t['plate'], t['type'], t['size']]
          .any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    final filterCards = <(String, String, int, Color)>[
      ('', tr('الكل', 'All'), tires.length, T.navy),
      ('mounted', tr('مركّبة', 'Mounted'), tires.where((t) => tireStateKey(t) == 'mounted').length, T.success),
      ('unmounted', tr('غير مركّبة', 'Unmounted'), tires.where((t) => tireStateKey(t) != 'mounted').length, T.warn),
      // "In store" includes what is under it: new, used, under renewal, at the factory and scrap; everything we own that is not mounted.
      ('store', tr('في المخزن', 'In store'), tires.where(tireInStore).length, T.info),
      for (final st in tireStates.where((x) => x.key != 'mounted'))
        (st.key, tr(st.ar, st.en), tires.where((t) => tireStateKey(t) == st.key).length, st.color),
    ];

    final flatbeds = _l(_d?['flatbeds']);
    final trailers = _l(_d?['trailers']);

    final admin = _isAdmin(context.watch<AuthProvider>());
    return DefaultTabController(
      length: 5,
      child: Builder(builder: (tabCtx) => AppScaffold(
      title: Text(tr('أصول الأسطول', 'Fleet Assets')),
      actions: [
        if (admin) IconButton(tooltip: tr('استيراد JSON الورشة', 'Import workshop JSON'), icon: const Icon(Icons.upload_file_outlined), onPressed: _import),
        IconButton(
          tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined),
          onPressed: () => _export(DefaultTabController.of(tabCtx).index, filtered),
        ),
      ],
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _createTire,
        icon: const Icon(Icons.add),
        label: Text(tr('كاوتش جديد', 'New tire')),
      ),
      appBarBottom: TabBar(
        labelColor: Colors.white,
        unselectedLabelColor: Colors.white70,
        indicatorColor: T.orange,
        indicatorWeight: 3,
        labelStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5),
        isScrollable: true,
        tabs: [
          Tab(text: '${tr('الكاوتشات', 'Tires')} (${tires.length})'),
          Tab(text: '${tr('السطحات', 'Flatbeds')} (${flatbeds.length})'),
          Tab(text: '${tr('التيدرات', 'Trailers')} (${trailers.length})'),
          Tab(text: tr('مطابقة السينسورات', 'Sensor check')),
          Tab(text: tr('الجنوط', 'Rims')),
        ],
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : TabBarView(children: [
                Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: filterCards.map((f) {
                          final selected = _filter == f.$1;
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: selected,
                              onSelected: (_) => setState(() { _filter = selected ? '' : f.$1; _q = ''; _qCtl.clear(); }),
                              label: Text('${f.$2} (${f.$3})'),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : f.$4),
                              selectedColor: f.$4,
                              backgroundColor: f.$4.withValues(alpha: 0.1),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          );
                        }).toList(),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: SearchField(controller: _qCtl, hint: tr('ابحث بالسيريال أو اللوحة أو النوع…', 'Search…'), suffixText: '${filtered.length}', onChanged: (v) => setState(() => _q = v)),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.circle_outlined, title: tr('لا توجد كاوتشات مطابقة', 'No matches'))])
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final t = filtered[i];
                                final stDef = tireStateOf(t);
                                final st = (stDef.ar, stDef.en, stDef.color);
                                final cond = _conditions[t['condition']];
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: Pressable(
                                    onTap: () => _tireSheet(t),
                                    child: AppCard(
                                      topAccent: st.$3,
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Expanded(
                                            child: Text(
                                              '${(t['tireNumber'] ?? '').toString().isNotEmpty ? '${t['tireNumber']} · ' : ''}${t['serial'] ?? ''}',
                                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5),
                                            ),
                                          ),
                                          Chip2(tr(st.$1, st.$2), st.$3),
                                        ]),
                                        const SizedBox(height: 5),
                                        Wrap(spacing: 6, runSpacing: 6, children: [
                                          if (t['isSpare'] == true) Chip2(tr('استبن', 'Spare'), T.violet, icon: Icons.star_outline),
                                          if (cond != null) Chip2(tr(cond.$1, cond.$2), cond.$3),
                                          if (t['conditionPercent'] != null) Chip2('${t['conditionPercent']}%', T.orange),
                                          if ((t['plate'] ?? '').toString().isNotEmpty)
                                            Chip2('${t['plate']}${t['positionNumber'] != null ? ' · ${tr('موضع', 'pos')} ${t['positionNumber']}' : ''}', T.navy, icon: Icons.local_shipping_outlined),
                                          if ((t['type'] ?? '').toString().isNotEmpty) Chip2('${t['type']} ${t['size'] ?? ''}'.trim(), T.inkFaint),
                                          if (t['sensor'] == 'yes') Chip2(tr('حساس', 'Sensor'), T.cyan, icon: Icons.sensors),
                                        ]),
                                        // Where it is now in words, like the "current place" column on the web.
                                        Padding(
                                          padding: const EdgeInsets.only(top: 5),
                                          child: Text(_placeOf(t), style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: st.$3)),
                                        ),
                                        // Quick action: mount the available tyre directly on a truck.
                                        if (t['status'] == 'spare' || t['status'] == 'in_repair') ...[
                                          const SizedBox(height: 6),
                                          Align(
                                            alignment: AlignmentDirectional.centerEnd,
                                            child: FilledButton.tonalIcon(
                                              style: FilledButton.styleFrom(minimumSize: const Size(0, 34), padding: const EdgeInsets.symmetric(horizontal: 14)),
                                              onPressed: t['status'] == 'spare' ? () => _mount(t) : () => _renewalResult(t),
                                              icon: Icon(t['status'] == 'spare' ? Icons.add_to_photos_outlined : Icons.autorenew_rounded, size: 16),
                                              label: Text(t['status'] == 'spare' ? tr('تركيب على شاحنة', 'Mount on truck') : tr('نتيجة التجديد', 'Renewal result'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                                            ),
                                          ),
                                        ],
                                      ]),
                                    ),
                                  ),
                                );
                              },
                            ),
                    ),
                  ),
                ]),
                _flatbedsTab(flatbeds),
                _trailersTab(trailers),
                _sensorsTab(),
                Ls2RimsTab(key: _rimsKey, admin: admin, plates: [for (final f in flatbeds) if ('${f['plate'] ?? ''}'.isNotEmpty) '${f['plate']}']),
              ]),
      )),
    );
  }

  // Sensor matching tab. Wialon numbering (axle / tyre) differs from the workshop numbering (1 to 14), so counts are compared and both numberings are shown for manual matching.
  Widget _sensorsTab() {
    if (!_sensorLoaded) {
      if (!_sensorRequested) { _sensorRequested = true; _loadSensors(); }
      return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer()]);
    }
    final rows = _filtered(_sensorRows, _qSensor, (r) => [r['plate'], r['driver']]);
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
        child: Text(tr('مقارنة بين المسجَّل في كشف الورشة (يوجد / لا يوجد حسّاس) وبين ما يصل فعليًا من Wialon.', 'Registered sensor flags (workshop sheet) vs what Wialon actually reports.'),
            style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
        child: SearchField(controller: _qSensorCtl, hint: tr('لوحة أو سائق…', 'Plate or driver…'), dense: true, suffixText: '${rows.length}', onChanged: (v) => setState(() => _qSensor = v)),
      ),
      Expanded(
        child: RefreshIndicator(
          onRefresh: _loadSensors,
          child: rows.isEmpty
              ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.sensors_off_outlined, title: _qSensor.trim().isNotEmpty ? tr('لا نتائج مطابقة للبحث', 'No matches') : tr('لا توجد بيانات', 'No data'))])
              : ListView.separated(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.all(14),
                  itemCount: rows.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemBuilder: (c, i) {
                    final r = rows[i];
                    final plate = '${r['plate'] ?? ''}';
                    final open = _openSensor.contains(plate);
                    final match = r['match'];
                    final (label, color) = match == null
                        ? (tr('لا بيانات حية', 'No live data'), T.inkFaint)
                        : match == true ? (tr('متطابق', 'Match'), T.success) : (tr('غير متطابق', 'MISMATCH'), T.danger);
                    return Pressable(
                      onTap: () => setState(() => open ? _openSensor.remove(plate) : _openSensor.add(plate)),
                      child: AppCard(
                        topAccent: color,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Expanded(child: Text(plate, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                            Chip2(label, color),
                            Icon(open ? Icons.expand_less : Icons.expand_more, color: T.inkFaint),
                          ]),
                          if ((r['driver'] ?? '').toString().isNotEmpty) Text('${r['driver']}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                          const SizedBox(height: 6),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            Chip2('${tr('مسجّل', 'Registered')}: ${r['registeredTotal'] ?? 0}', T.navy),
                            Chip2('${tr('مسجّل بسينسور', 'With sensor')}: ${r['registeredWithSensor'] ?? 0}', T.cyan),
                            Chip2('${tr('يرسل فعليًا', 'Reporting')}: ${r['hasLive'] == true ? r['liveReporting'] ?? 0 : '—'}', T.violet),
                          ]),
                          if (open) ...[
                            const Divider(),
                            Text(tr('المسجّل بسينسور (كشف الورشة)', 'Registered with sensor (workshop)'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
                            if (_l(r['registeredSensorPositions']).isEmpty) const Text('—'),
                            for (final p in _l(r['registeredSensorPositions']))
                              Text('${(p['positionLabel'] ?? '').toString().isNotEmpty ? p['positionLabel'] : 'اطار ${p['positionNumber']}'} · ${p['section'] ?? ''} — ${p['serial'] ?? ''}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                            const SizedBox(height: 6),
                            Text(tr('ما يُرسِل فعليًا (Wialon)', 'Actually reporting (Wialon)'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
                            if (r['hasLive'] != true) Text(tr('العربية غير موجودة في Wialon', 'Vehicle not in Wialon'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                            if (r['hasLive'] == true && _l(r['livePositions']).isEmpty) const Text('—'),
                            for (final p in _l(r['livePositions']))
                              Text(tr('محور ${p['axle']} · إطار ${p['position']}', 'Axle ${p['axle']} · tire ${p['position']}'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                          ],
                        ]),
                      ),
                    );
                  },
                ),
        ),
      ),
    ]);
  }

  // Flatbeds tab.
  Widget _flatbedsTab(List<Map<String, dynamic>> flatbeds) {
    final q = _fold(_qFlat.trim());
    final list = flatbeds.where((f) {
      if (q.isEmpty) return true;
      return [f['plate'], f['registryPlate'], f['numbering'], f['brand'], f['batch'], f['currentTrailerNumber'], f['driver']]
          .any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
        child: SearchField(controller: _qFlatCtl, hint: tr('ابحث بلوحة السطحة أو الرقم أو النوع…', 'Search flatbeds…'), suffixText: '${list.length}', onChanged: (v) => setState(() => _qFlat = v)),
      ),
      Expanded(
        child: RefreshIndicator(
          onRefresh: _load,
          child: list.isEmpty
              ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.local_shipping_outlined, title: tr('لا توجد سطحات مطابقة', 'No matches'))])
              : ListView.separated(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.all(14),
                  itemCount: list.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemBuilder: (c, i) {
                    final f = list[i];
                    final plate = (f['plate'] ?? '').toString();
                    return FadeSlideIn(
                      delayMs: (i * 10).clamp(0, 120),
                      child: Pressable(
                        onTap: plate.isEmpty ? null : () => Navigator.push(context, MaterialPageRoute(builder: (_) => Ls2VehicleAssetsScreen(plate: plate))),
                        child: AppCard(
                          topAccent: T.navy,
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Expanded(child: Text('${tr('سطحة', 'Flatbed')} $plate${(f['registryPlate'] ?? '').toString().isNotEmpty ? ' · ${f['registryPlate']}' : ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                              if (f['numbering'] != null) Chip2('#${f['numbering']}', T.navy),
                              // The trailer under this head, chosen from the vehicle itself.
                              IconButton(
                                visualDensity: VisualDensity.compact,
                                onPressed: () => _hitchTruck(f),
                                icon: const Icon(Icons.rv_hookup_outlined, size: 19, color: T.orange),
                                tooltip: tr('تركيب / تغيير التيدر', 'Hitch / change trailer'),
                              ),
                              IconButton(
                                visualDensity: VisualDensity.compact,
                                onPressed: () => _editFlatbed(f),
                                icon: const Icon(Icons.edit_outlined, size: 18, color: T.inkSoft),
                                tooltip: tr('تعديل', 'Edit'),
                              ),
                            ]),
                            const SizedBox(height: 6),
                            Wrap(spacing: 6, runSpacing: 6, children: [
                              if ((f['brand'] ?? '').toString().isNotEmpty) Chip2('${f['brand']}', T.inkFaint, icon: Icons.factory_outlined),
                              if ((f['batch'] ?? '').toString().isNotEmpty) Chip2('${f['batch']}', T.violet),
                              // 14 is the full set: the colour shows at a glance who is missing tyres.
                              Chip2('${f['tireCount'] ?? 0}/14 ${tr('كاوتش', 'tires')}',
                                  (f['tireCount'] ?? 0) >= 14 ? T.success : (f['tireCount'] ?? 0) > 0 ? T.warn : T.inkFaint,
                                  icon: Icons.circle_outlined),
                              if ((f['currentTrailerNumber'] ?? '').toString().isNotEmpty) Chip2('${tr('تيدر', 'Trailer')} ${f['currentTrailerNumber']}', T.cyan, icon: Icons.rv_hookup_outlined),
                              if ((f['driver'] ?? '').toString().isNotEmpty) Chip2('${f['driver']}', T.info, icon: Icons.person_outline),
                              if (f['odometerKm'] != null) Chip2('${f['odometerKm']} ${tr('كم', 'km')}', T.inkFaint, icon: Icons.speed_outlined),
                            ]),
                            if (plate.isNotEmpty) ...[
                              const SizedBox(height: 6),
                              Align(alignment: AlignmentDirectional.centerEnd, child: Text(tr('اعرض الكاوتشات ←', 'View tires ←'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.navy))),
                            ],
                          ]),
                        ),
                      ),
                    );
                  },
                ),
        ),
      ),
    ]);
  }

  // Trailers tab.
  Widget _trailersTab(List<Map<String, dynamic>> trailers) {
    final q = _fold(_qTrail.trim());
    final list = trailers.where((t) {
      if (q.isEmpty) return true;
      return [t['trailerNumber'], t['currentPlate'], t['status']].any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();
    const statusMap = {
      'active': ('مركّب', 'Active', T.success),
      'spare': ('سبير', 'Spare', T.info),
      'retired': ('خارج الخدمة', 'Retired', T.inkFaint),
    };
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
        child: Row(children: [
          Expanded(
            child: SearchField(controller: _qTrailCtl, hint: tr('ابحث برقم التيدر أو السطحة…', 'Search trailers…'), suffixText: '${list.length}', onChanged: (v) => setState(() => _qTrail = v)),
          ),
          const SizedBox(width: 8),
          FilledButton.tonalIcon(
            style: FilledButton.styleFrom(minimumSize: const Size(0, 50)),
            onPressed: _createTrailer,
            icon: const Icon(Icons.add, size: 18),
            label: Text(tr('تيدر', 'Trailer'), style: const TextStyle(fontWeight: FontWeight.w700)),
          ),
        ]),
      ),
      Expanded(
        child: RefreshIndicator(
          onRefresh: _load,
          child: list.isEmpty
              ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.rv_hookup_outlined, title: tr('لا توجد تيدرات مطابقة', 'No matches'))])
              : ListView.separated(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.all(14),
                  itemCount: list.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemBuilder: (c, i) {
                    final t = list[i];
                    final st = statusMap[t['status']] ?? ('—', '—', T.inkFaint);
                    final plate = (t['currentPlate'] ?? '').toString();
                    return FadeSlideIn(
                      delayMs: (i * 10).clamp(0, 120),
                      child: Pressable(
                        // The trailer opens on its own tyres, with each tyre's actions.
                        onTap: () => _trailerTires(t),
                        child: AppCard(
                          topAccent: st.$3,
                          child: Row(children: [
                            Expanded(child: Text('${tr('تيدر', 'Trailer')} ${t['trailerNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                            if (plate.isNotEmpty) Chip2('${tr('على', 'on')} $plate', T.navy, icon: Icons.local_shipping_outlined),
                            const SizedBox(width: 6),
                            Chip2(tr(st.$1, st.$2), st.$3),
                            IconButton(
                              visualDensity: VisualDensity.compact,
                              onPressed: () => _moveTrailer(t),
                              icon: const Icon(Icons.swap_horiz_rounded, size: 19, color: T.info),
                              tooltip: tr('نقل / فكّ', 'Move / unhitch'),
                            ),
                          ]),
                        ),
                      ),
                    );
                  },
                ),
        ),
      ),
    ]);
  }

  // Register a new tyre.
  Future<void> _createTire() async {
    final serial = TextEditingController();
    final tireNumber = TextEditingController();
    final type = TextEditingController();
    final size = TextEditingController();
    final plate = TextEditingController();
    final position = TextEditingController();
    String sensor = 'unknown';
    bool isSpare = false;
    // The tyre number is generated by the server. The next number is shown for reading only and is not sent: the server assigns it on save after the last registered number, so a number typed by two people at once never repeats.
    try {
      final d = await Api.instance.get('/api/ls2/assets/tires/next-number');
      tireNumber.text = (d['tireNumber'] ?? '').toString();
    } catch (_) {/* The field stays "auto" and the server assigns the number. */}
    if (!mounted) return;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('تسجيل كاوتش جديد', 'Register new tire'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 12),
              TextField(controller: serial, decoration: InputDecoration(labelText: tr('السيريال *', 'Serial *'))),
              const SizedBox(height: 10),
              TextField(
                controller: tireNumber, readOnly: true, enabled: false,
                decoration: InputDecoration(
                  labelText: tr('رقم الكاوتش', 'Tire #'),
                  hintText: tr('تلقائي', 'Auto'),
                  helperText: tr('يُولَّد تلقائيًّا بعد آخر رقم.', 'Generated after the last number.'),
                ),
              ),
              const SizedBox(height: 10),
              // Brand and size come from the reference lists, and a typed value is accepted.
              Row(children: [
                Expanded(child: LookupField(type: 'ls2_tire_brand', controller: type, label: tr('النوع / الماركة', 'Type / brand'), hint: tr('اختر الماركة', 'Pick a brand'))),
                const SizedBox(width: 10),
                Expanded(child: LookupField(type: 'ls2_tire_size', controller: size, label: tr('المقاس', 'Size'), hint: tr('اختر المقاس', 'Pick a size'))),
              ]),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: sensor,
                decoration: InputDecoration(labelText: tr('حساس؟', 'Sensor?')),
                items: [
                  DropdownMenuItem(value: 'unknown', child: Text(tr('غير معروف', 'Unknown'))),
                  DropdownMenuItem(value: 'yes', child: Text(tr('نعم', 'Yes'))),
                  DropdownMenuItem(value: 'no', child: Text(tr('لا', 'No'))),
                ],
                onChanged: (v) => setS(() => sensor = v ?? sensor),
              ),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: TextField(controller: plate, onChanged: (_) => setS(() {}), decoration: InputDecoration(labelText: tr('لوحة الشاحنة (اختياري)', 'Truck plate (optional)')))),
                const SizedBox(width: 10),
                SizedBox(width: 110, child: TextField(controller: position, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('الموضع', 'Position')))),
              ]),
              if (plate.text.trim().isNotEmpty)
                CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  value: isSpare,
                  onChanged: (v) => setS(() => isSpare = v ?? false),
                  title: Text(tr('هذه الفردة هي الاستبن على العربية', "This is the truck's spare (استبن)"), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                ),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () async {
                    if (serial.text.trim().isEmpty) return;
                    try {
                      await Api.instance.post('/api/ls2/assets/tires', {
                        'serial': serial.text.trim(),
                        'type': type.text.trim(),
                        'size': size.text.trim(),
                        'sensor': sensor,
                        if (plate.text.trim().isNotEmpty) 'plate': plate.text.trim(),
                        if (position.text.trim().isNotEmpty) 'positionNumber': num.tryParse(position.text),
                        if (plate.text.trim().isNotEmpty && isSpare) 'isSpare': true,
                      });
                      if (c.mounted) Navigator.pop(c);
                      _load();
                    } catch (e) {
                      if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                    }
                  },
                  child: Text(tr('تسجيل', 'Register')),
                ),
              ),
            ]),
          ),
        ),
      )),
    );
  }

  // Tyre operations sheet.
  Future<void> _tireSheet(Map<String, dynamic> t) async {
    final status = (t['status'] ?? '').toString();
    await showModalBottomSheet(
      context: context,
      builder: (sheet) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${t['tireNumber'] ?? ''} ${t['serial'] ?? ''}'.trim(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 4),
            Text(
              '${tr(tireStateOf(t).ar, tireStateOf(t).en)}'
              '${(t['plate'] ?? '').toString().isNotEmpty ? ' · ${t['plate']}' : ''}',
              style: const TextStyle(fontSize: 12.5, color: T.inkSoft),
            ),
            const SizedBox(height: 14),
            Wrap(spacing: 8, runSpacing: 8, children: [
              // A tyre's life: which vehicles it was on, how far it ran, and everything that happened to it.
              _chip(sheet, Icons.timeline, tr('حياة الفردة', 'Tire life'), T.orange, () async {
                await Navigator.push(context, MaterialPageRoute(builder: (_) => Ls2TireProfileScreen(tireId: '${t['_id']}', serial: '${t['serial'] ?? ''}')));
              }),
              // Grade and condition %, as on the web edit form.
              _chip(sheet, Icons.tune, tr('الدرجة ونسبة الحالة', 'Grade & condition %'), T.info, () => _editCondition(t)),
              if (status == 'mounted')
                _chip(sheet, Icons.download_outlined, tr('فك من الشاحنة', 'Dismount'), T.warn, () => _dismount(t)),
              if (status == 'mounted')
                _chip(sheet, Icons.star_outline, t['isSpare'] == true ? tr('إلغاء الاستبن', 'Unset spare') : tr('تعليم كـ استبن', 'Mark as spare'), T.violet,
                    () async {
                  try {
                    await Api.instance.patch('/api/ls2/assets/tires/${t['_id']}', {'isSpare': !(t['isSpare'] == true)});
                    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم التحديث', 'Updated'))));
                    _load();
                  } catch (e) {
                    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
                  }
                }),
              if (status == 'mounted' && (t['plate'] ?? '').toString().isNotEmpty)
                _chip(sheet, Icons.local_shipping_outlined, tr('أصول المركبة', 'Vehicle assets'), T.navy,
                    () => Navigator.push(context, MaterialPageRoute(builder: (_) => Ls2VehicleAssetsScreen(plate: (t['plate'] ?? '').toString())))),
              if (status == 'spare' || status == 'mounted')
                _chip(sheet, Icons.local_shipping_outlined, status == 'mounted' ? tr('نقل لشاحنة أخرى', 'Transfer') : tr('تركيب على شاحنة', 'Mount'), T.success, () => _mount(t)),
              if (status == 'in_repair')
                _chip(sheet, Icons.autorenew_rounded, tr('نتيجة التجديد', 'Renewal result'), T.violet, () => _renewalResult(t)),
              // Move state: always available for any tyre (for example used-good to scrap/damaged, or scrap to warehouse).
              _chip(sheet, Icons.swap_horiz_rounded, tr('نقل الحالة', 'Change status'), T.info, () => _changeStatus(t)),
              if (status != 'scrap' && status != 'damaged' && status != 'retired' && status != 'sold')
                _chip(sheet, Icons.dangerous_outlined, tr('إتلاف/سكراب مباشرة', 'Retire'), T.danger, () => _retire(t)),
              // Sell the tyre (especially scrap, sold as scrap metal).
              if (status == 'scrap' || status == 'damaged')
                _chip(sheet, Icons.sell_outlined, tr('بيع كخردة', 'Sell as scrap'), T.success, () => _sell(t)),
            ]),
            const SizedBox(height: 6),
          ]),
        ),
      ),
    );
  }

  Widget _chip(BuildContext sheet, IconData icon, String label, Color color, Future<void> Function() run) =>
      ActionChip(
        avatar: Icon(icon, size: 17, color: color),
        label: Text(label, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: color)),
        backgroundColor: color.withValues(alpha: 0.08),
        side: BorderSide.none,
        onPressed: () { Navigator.pop(sheet); run(); },
      );

  // Remove: straight to the warehouse (with a condition percentage), renewal, damaged or scrap.
  Future<void> _editCondition(Map t) async {
    String grade = t['condition'] == 'new' ? 'new' : 'used';
    final pct = TextEditingController(text: t['conditionPercent'] != null ? '${t['conditionPercent']}' : '');
    final ok = await showDialog<bool>(context: context, builder: (c) => StatefulBuilder(builder: (c, set) => AlertDialog(
      title: Text(tr('الدرجة ونسبة الحالة', 'Grade & condition %')),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        DropdownButtonFormField<String>(
          initialValue: grade,
          decoration: InputDecoration(labelText: tr('الدرجة', 'Grade')),
          items: [
            DropdownMenuItem(value: 'new', child: Text(tr('جديد (من الشراء)', 'New (from purchase)'))),
            DropdownMenuItem(value: 'used', child: Text(tr('مستعمل (يشمل المجدَّد)', 'Used (incl. retreaded)'))),
          ],
          onChanged: (v) => set(() => grade = v ?? grade),
        ),
        const SizedBox(height: 10),
        TextField(controller: pct, keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: tr('نسبة الحالة %', 'Condition %'), hintText: tr('غير مقيَّمة', 'Not rated'))),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
      ],
    )));
    final text = pct.text.trim();
    pct.dispose();
    if (ok != true) return;
    final n = int.tryParse(text);
    try {
      await Api.instance.patch('/api/ls2/assets/tires/${t['_id']}', {'condition': grade, 'conditionPercent': text.isEmpty ? null : (n ?? 0).clamp(0, 100)});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم التحديث', 'Updated'))));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _dismount(Map<String, dynamic> t) async {
    // The spare is the only position allowed to stay empty, since the vehicle runs without it. Any other position must be filled, so a replacement is mandatory (or a mutual swap).
    final needsReplacement = t['status'] == 'mounted'
        && !(t['isSpare'] == true || (t['section'] ?? '').toString().contains('استبن'));
    String destination = 'store';
    // Starts from the tire's current rating (edited on the tire or set at its last dismount).
    final percent = TextEditingController(text: t['conditionPercent'] != null ? '${t['conditionPercent']}' : '');
    final reason = TextEditingController();
    Map<String, dynamic>? replacement;
    bool swap = false;
    final mounted = t['status'] == 'mounted' && (t['plate'] ?? '').toString().isNotEmpty;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('فك الكاوتش — إلى أين؟', 'Dismount — where to?'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: destination,
                decoration: InputDecoration(labelText: tr('وجهة الفردة', 'Destination')),
                items: [
                  DropdownMenuItem(value: 'store', child: Text(tr('المستودع (احتياطي)', 'Store (spare)'))),
                  DropdownMenuItem(value: 'repair', child: Text(tr('التجديد', 'Renewal'))),
                  DropdownMenuItem(value: 'damaged', child: Text(tr('تالف', 'Damaged'))),
                  DropdownMenuItem(value: 'scrap', child: Text(tr('سكراب مباشرة', 'Straight to scrap'))),
                ],
                onChanged: (v) => setS(() => destination = v ?? destination),
              ),
              if (destination == 'store') ...[
                const SizedBox(height: 10),
                TextField(controller: percent, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('حالته كم ٪؟', 'Condition %'))),
              ],
              const SizedBox(height: 10),
              TextField(controller: reason, decoration: InputDecoration(labelText: tr('السبب', 'Reason'))),
              // Replacement tyre mounted in its place: from the warehouse or pulled from another vehicle.
              if (mounted) ...[
                const SizedBox(height: 12),
                Text(
                    needsReplacement
                        ? tr('فردة بديلة تُركَّب مكانها (إلزامي)', 'Replacement in its place (required)')
                        : tr('فردة بديلة تُركَّب مكانها (اختياري — الاستبن)', 'Replacement (optional — spare slot)'),
                    style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 46)),
                  onPressed: () async {
                    final r = await _pickReplacement(t);
                    if (r != null) setS(() => replacement = r.isEmpty ? null : r);
                  },
                  icon: const Icon(Icons.swap_horiz_rounded, size: 17),
                  label: Text(
                    replacement == null ? tr('— دون بديل —', '— none —') : '${replacement!['serial']}${replacement!['status'] == 'mounted' ? ' · ${tr('من', 'from')} ${replacement!['plate']}' : ' · ${tr('مخزن', 'store')}'}',
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                  ),
                ),
                const SizedBox(height: 3),
                Text(tr('من المخزن، أو فردة مركّبة على مركبة أخرى (تُنقل تلقائيًا).', 'From store, or a tire on another truck (auto-transferred).'), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                if (needsReplacement && replacement == null)
                  Container(
                    margin: const EdgeInsets.only(top: 8),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    decoration: BoxDecoration(color: T.warn.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(10)),
                    child: Text(
                      tr('الموقع «${t['positionLabel'] ?? t['positionNumber'] ?? ''}» لا يجوز أن يبقى فارغًا — اختر فردة تُركَّب مكانها، أو نفّذ تبديلًا.',
                         'This position cannot be left empty — pick a replacement or swap.'),
                      style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: T.warn)),
                  ),
                // Mutual swap: this tyre is mounted in the replacement's place on its vehicle.
                if (replacement != null && replacement!['status'] == 'mounted') ...[
                  Container(
                    margin: const EdgeInsets.only(top: 8),
                    decoration: BoxDecoration(color: T.warn.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
                    child: CheckboxListTile(
                      dense: true,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                      value: swap,
                      onChanged: (v) => setS(() => swap = v ?? false),
                      title: Text(
                        tr('تبديل متبادل: هذه الفردة تُركَّب مكان ${replacement!['serial']} على المركبة ${replacement!['plate']} (بدل نزولها).',
                           "Two-way swap: this tire takes ${replacement!['serial']}'s slot on truck ${replacement!['plate']}."),
                        style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: T.warn),
                      ),
                    ),
                  ),
                  // Without a swap: the replacement vacated a position on its vehicle, and filling it is required after pressing "remove", until a warehouse tyre arrives.
                  if (!swap)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(tr('بعد التنفيذ سيُطلب منك فردةٌ تملأ مكان ${replacement!['serial']} على ${replacement!['plate']} — إلزامي.',
                          "You'll then be asked for a tire to fill ${replacement!['serial']}'s slot on ${replacement!['plate']} — required."),
                          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: T.warn)),
                    ),
                ],
              ],
              const SizedBox(height: 14),
              SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                      onPressed: (needsReplacement && replacement == null) ? null : () => Navigator.pop(c, true),
                      child: Text(swap
                          ? tr('تبديل الفردتين', 'Swap the tires')
                          : (needsReplacement && replacement == null)
                              ? tr('اختر الفردة البديلة أولًا', 'Choose the replacement first')
                              : tr('فك', 'Dismount')))),
            ]),
          ),
        ),
      )),
    );
    if (ok != true) return;
    final doSwap = swap && replacement != null && replacement!['status'] == 'mounted';
    await _post('/api/ls2/assets/tires/${t['_id']}/move', {
      'toPlate': null,
      'destination': doSwap ? 'swap' : destination,
      if (!doSwap && destination == 'store' && percent.text.trim().isNotEmpty) 'conditionPercent': num.tryParse(percent.text),
      if (reason.text.trim().isNotEmpty) 'reason': reason.text.trim(),
      if (replacement != null) 'replacementTireId': replacement!['_id'],
    }, doSwap ? tr('تم التبديل', 'Swapped') : tr('تم الفك', 'Dismounted'), tire: t);
  }

  // Truck plate picker from the available plates (quick search).
  Future<String?> _pickPlate(List<String> plates) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (c) {
        String q = '';
        return StatefulBuilder(builder: (c, setS) {
          final fq = _fold(q.trim());
          final list = plates.where((p) => fq.isEmpty || _fold(p).contains(fq)).toList();
          return SafeArea(
            child: Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
              child: SizedBox(
                height: MediaQuery.of(c).size.height * 0.7,
                child: Column(children: [
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: SearchField(autofocus: true, hint: tr('ابحث عن لوحة الشاحنة…', 'Search truck plate…'), onChanged: (v) => setS(() => q = v)),
                  ),
                  Expanded(
                    child: list.isEmpty
                        ? EmptyState(icon: Icons.local_shipping_outlined, title: q.trim().isNotEmpty ? tr('لا نتائج مطابقة للبحث', 'No matches') : tr('لا توجد شاحنات', 'No trucks'))
                        : ListView.builder(
                            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                            itemCount: list.length,
                            itemBuilder: (c, i) => ListTile(
                              leading: const Icon(Icons.local_shipping_outlined, color: T.navy),
                              title: Text(list[i], style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                              onTap: () => Navigator.pop(c, list[i]),
                            ),
                          ),
                  ),
                ]),
              ),
            ),
          );
        });
      },
    );
  }

  // Tyre picker: warehouse plus mounted on any vehicle (including the same vehicle = the spare), with specific tyres excluded. Order: warehouse, same vehicle, other vehicles.
  // Tyres of one trailer: those carrying its number while mounted, and those mounted in the trailer section on the truck that pulls it with no trailer number written (old records).
  Future<void> _trailerTires(Map<String, dynamic> trailer) async {
    final no = (trailer['trailerNumber'] ?? '').toString();
    final key = (trailer['currentPlateKey'] ?? '').toString();
    final list = _l(_d?['tires']).where((x) => x['status'] == 'mounted' && (
      (x['trailerNumber'] ?? '').toString() == no
      || ((x['trailerNumber'] ?? '').toString().isEmpty && key.isNotEmpty
          && (x['plateKey'] ?? '').toString() == key && RegExp('تيدر|تريلة').hasMatch((x['section'] ?? '').toString()))
    )).toList()
      ..sort((a, b) => ((a['positionNumber'] as num?) ?? 99).compareTo((b['positionNumber'] as num?) ?? 99));
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.75,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
              child: Text('${tr('كاوتشات التيدر', 'Trailer tires')} $no', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                '${(trailer['currentPlate'] ?? '').toString().isNotEmpty ? '${tr('على', 'on')} ${trailer['currentPlate']}' : tr('غير مركّب', 'unhitched')} · ${list.length} ${tr('فردة', 'tires')}',
                style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: list.isEmpty
                  ? EmptyState(icon: Icons.circle_outlined, title: tr('لا كاوتشات مسجّلة على هذا التيدر', 'No tires on this trailer'))
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(14, 4, 14, 14),
                      itemCount: list.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (_, i) {
                        final t = list[i];
                        return Pressable(
                          onTap: () { Navigator.pop(c); _tireSheet(t); },
                          child: AppCard(
                            child: Row(children: [
                              Expanded(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text('${t['serial'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                                  Text([t['positionLabel'], t['section']].where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
                                      style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                ]),
                              ),
                              if (t['conditionPercent'] != null) Chip2('${t['conditionPercent']}%', T.orange),
                              const Icon(Icons.chevron_left_rounded, color: T.inkFaint),
                            ]),
                          ),
                        );
                      },
                    ),
            ),
          ]),
        ),
      ),
    );
  }

  /// Where the tyre is now: mounted on which part, in which corner of the warehouse, or out of custody.
  String _placeOf(Map<String, dynamic> t) {
    final k = tireStateKey(t);
    final section = (t['section'] ?? '').toString();
    if (k == 'mounted') {
      final trailerNo = (t['trailerNumber'] ?? '').toString();
      // Mounted on no truck and no trailer: "on the spare slot" would hide that nobody knows which truck.
      if ((t['plate'] ?? '').toString().isEmpty && trailerNo.isEmpty) return tireLastSeenText(t['lastSeen']);
      String plate = (t['plate'] ?? '').toString();
      if (plate.isEmpty && trailerNo.isNotEmpty) {
        final tr0 = _l(_d?['trailers']).firstWhere((x) => (x['trailerNumber'] ?? '').toString() == trailerNo, orElse: () => <String, dynamic>{});
        plate = (tr0['currentPlate'] ?? '').toString();
      }
      final where = (t['isSpare'] == true || section.contains('استبن'))
          ? tr('الاستبن', 'the spare slot')
          : (RegExp('تيدر|تريلة').hasMatch(section) && trailerNo.isNotEmpty)
              ? tr('التيدر $trailerNo', 'trailer $trailerNo')
              : (section.isNotEmpty ? section : tr('العربية', 'the vehicle'));
      return '${tr('مركّبة — على', 'Mounted — on')} $where${plate.isNotEmpty ? ' · $plate' : ''}';
    }
    const place = {
      'new': ('في المستودع — جديدة', 'In store — new'),
      'used': ('في المستودع — مستعملة', 'In store — used'),
      'under_renewal': ('في المستودع — تحت التجديد', 'In store — under renewal'),
      'at_factory': ('في مصنع التجديد', 'At the retreading factory'),
      'scrap': ('في المستودع — سكراب', 'In store — scrap'),
      'damaged': ('تالفة — خارج العهدة', 'Damaged — written off'),
      'sold': ('مباعة — خارج العهدة', 'Sold — written off'),
    };
    final v = place[k] ?? place['used']!;
    return tr(v.$1, v.$2);
  }

  Future<Map<String, dynamic>?> _pickReplacement(Map<String, dynamic> source, {List<String> alsoExclude = const []}) {
    final all = _l(_d?['tires']);
    final excludeIds = {(source['_id'] ?? '').toString(), ...alsoExclude};
    final srcKey = (source['plateKey'] ?? source['plate'] ?? '').toString();
    int rank(Map<String, dynamic> x) => x['status'] == 'spare' ? 0 : ((x['plateKey'] ?? x['plate']).toString() == srcKey ? 1 : 2);
    final options = all.where((x) {
      if (excludeIds.contains((x['_id'] ?? '').toString())) return false;
      if (x['status'] == 'spare') return true;
      if (x['status'] == 'mounted' && (x['plate'] ?? '').toString().isNotEmpty) return true;
      return false;
    }).toList()
      ..sort((a, b) => rank(a) - rank(b));

    return showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (c) {
        String q = '';
        return StatefulBuilder(builder: (c, setS) {
          final fq = _fold(q.trim());
          final list = options.where((x) => fq.isEmpty || [x['serial'], x['tireNumber'], x['type'], x['plate']].any((v) => _fold((v ?? '').toString()).contains(fq))).toList();
          return SafeArea(
            child: Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
              child: SizedBox(
                height: MediaQuery.of(c).size.height * 0.72,
                child: Column(children: [
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: SearchField(autofocus: true, hint: tr('ابحث بالسيريال أو الرقم…', 'Search serial / number…'), onChanged: (v) => setS(() => q = v)),
                  ),
                  ListTile(
                    leading: const Icon(Icons.block, color: T.inkFaint),
                    title: Text(tr('— دون بديل —', '— none —')),
                    onTap: () => Navigator.pop(c, <String, dynamic>{}),
                  ),
                  const Divider(height: 1),
                  Expanded(
                    child: list.isEmpty
                        ? EmptyState(icon: Icons.tire_repair_outlined, title: q.trim().isNotEmpty ? tr('لا نتائج مطابقة للبحث', 'No matches') : tr('لا توجد فردات متاحة', 'No available tires'))
                        : ListView.builder(
                            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                            itemCount: list.length,
                            itemBuilder: (c, i) {
                              final x = list[i];
                              final inStore = x['status'] == 'spare';
                              final sameTruck = !inStore && (x['plateKey'] ?? x['plate']).toString() == srcKey;
                              final where = inStore
                                  ? tr('في المخزن', 'in store')
                                  : sameTruck
                                      ? '${tr('نفس المركبة', 'same truck')} · ${x['positionLabel'] ?? x['positionNumber'] ?? ''}'
                                      : '${tr('مركّبة على', 'on')} ${x['plate']} · ${x['positionLabel'] ?? x['positionNumber'] ?? ''}';
                              return ListTile(
                                leading: Icon(inStore ? Icons.inventory_2_outlined : Icons.local_shipping_outlined, color: inStore ? T.info : sameTruck ? T.success : T.warn, size: 20),
                                title: Row(children: [
                                  Flexible(child: Text('${x['serial']}${(x['tireNumber'] ?? '').toString().isNotEmpty ? ' · ${x['tireNumber']}' : ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5), overflow: TextOverflow.ellipsis)),
                                  if (x['isSpare'] == true) ...[const SizedBox(width: 6), Chip2(tr('استبن', 'Spare'), T.violet)],
                                ]),
                                subtitle: Text(
                                  '$where'
                                  '${(x['type'] ?? '').toString().isNotEmpty ? ' · ${x['type']}' : ''}'
                                  '${x['conditionPercent'] != null ? ' · ${x['conditionPercent']}%' : ''}',
                                  style: const TextStyle(fontSize: 11.5),
                                ),
                                onTap: () => Navigator.pop(c, x),
                              );
                            },
                          ),
                  ),
                ]),
              ),
            ),
          );
        });
      },
    );
  }

  // Mount / move: plate and position; if the position is occupied, ask the occupant's fate and repeat.
  Future<void> _mount(Map<String, dynamic> t) async {
    final plate = TextEditingController(text: (t['plate'] ?? '').toString());
    final position = TextEditingController(text: (t['positionNumber'] ?? '').toString());
    // All flatbeds (61) are selectable, not only those with registered tyres.
    final plates = (_l(_d?['flatbeds']).map((x) => (x['plate'] ?? '').toString()).where((p) => p.isNotEmpty).toSet().toList()..sort());
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 8, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${tr('تركيب', 'Mount')} ${t['serial'] ?? ''} ${tr('على شاحنة', 'on a truck')}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 46)),
              onPressed: () async {
                final p = await _pickPlate(plates);
                if (p != null) setS(() => plate.text = p);
              },
              icon: const Icon(Icons.local_shipping_outlined, size: 18),
              label: Text(plate.text.trim().isEmpty ? tr('اختر الشاحنة…', 'Choose truck…') : plate.text, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
            ),
            const SizedBox(height: 10),
            TextField(controller: plate, onChanged: (_) => setS(() {}), decoration: InputDecoration(labelText: tr('أو اكتب اللوحة *', 'Or type plate *'))),
            const SizedBox(height: 10),
            // Grid of positions 1 to 14 on the chosen truck: green empty = direct mount, red occupied = replacement (the old tyre's fate is asked). Tap a position to choose it.
            if (plate.text.trim().isNotEmpty)
              Builder(builder: (_) {
                final ptext = plate.text.trim();
                final flats = _l(_d?['flatbeds']);
                final fmatch = flats.firstWhere((x) => (x['plate'] ?? '').toString() == ptext, orElse: () => <String, dynamic>{});
                final toKey = (fmatch['plateKey'] ?? '').toString().isNotEmpty ? (fmatch['plateKey']).toString() : _plateKey(ptext);
                final mounted = _l(_d?['tires']).where((x) => x['status'] == 'mounted' && (x['plateKey'] ?? '').toString() == toKey && x['positionNumber'] != null).toList();
                final truckHasTires = mounted.isNotEmpty;
                Map<String, dynamic>? occAt(int n) {
                  for (final x in mounted) {
                    if ((x['positionNumber'] as num?)?.toInt() == n) return x;
                  }
                  return null;
                }
                final chosen = int.tryParse(position.text.trim());
                final chosenOcc = chosen == null ? null : occAt(chosen);
                return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  if (!truckHasTires)
                    Container(
                      width: double.infinity,
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(color: T.warn.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(10), border: Border.all(color: T.warn.withValues(alpha: 0.35))),
                      child: Text(tr('⚠ لا توجد كاوتشات مسجّلة لهذه الشاحنة بعد — كل المواقع ستظهر فارغة، تأكد قبل التركيب.', '⚠ No tires registered for this truck yet — every slot shows empty, verify before mounting.'), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.warn)),
                    ),
                  Text(tr('اختر الموضع (1–14):', 'Pick a position (1–14):'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkSoft)),
                  const SizedBox(height: 8),
                  Wrap(spacing: 8, runSpacing: 8, children: List.generate(14, (idx) {
                    final n = idx + 1;
                    final occ = occAt(n);
                    final selected = chosen == n;
                    final color = occ != null ? T.danger : T.success;
                    return GestureDetector(
                      onTap: () => setS(() => position.text = '$n'),
                      child: Container(
                        width: 76,
                        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
                        decoration: BoxDecoration(
                          color: color.withValues(alpha: selected ? 0.18 : 0.06),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: selected ? color : color.withValues(alpha: 0.35), width: selected ? 2 : 1),
                        ),
                        child: Column(children: [
                          Text('${occ != null ? '🔴' : '🟢'} $n', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: color)),
                          const SizedBox(height: 2),
                          Text(occ != null ? '${occ['serial']}' : tr('فارغ', 'empty'), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 9.5, color: occ != null ? T.danger : T.inkSoft)),
                        ]),
                      ),
                    );
                  })),
                  if (chosen != null) ...[
                    const SizedBox(height: 10),
                    chosenOcc != null
                        ? Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(color: T.danger.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10), border: Border.all(color: T.danger.withValues(alpha: 0.3))),
                            child: Text(tr('🔴 الموضع $chosen عليه الفردة ${chosenOcc['serial']} — استبدال: هيتطلب منك تحدد الفردة القديمة دي هتروح فين.', '🔴 Position $chosen holds ${chosenOcc['serial']} — replacement: you\'ll set where the old tire goes.'), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.danger)),
                          )
                        : Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(color: T.success.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10), border: Border.all(color: T.success.withValues(alpha: 0.3))),
                            child: Text(tr('🟢 الموضع $chosen فارغ — لا يوجد عليه كاوتش، تركيب مباشر.', '🟢 Position $chosen is empty — no tire here, clean mount.'), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.success)),
                          ),
                  ],
                ]);
              }),
            const SizedBox(height: 14),
            SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تركيب', 'Mount')))),
          ]),
        ),
      )),
    );
    if (ok != true || plate.text.trim().isEmpty) return;
    final body = {
      'toPlate': plate.text.trim(),
      if (position.text.trim().isNotEmpty) 'positionNumber': num.tryParse(position.text),
    };
    await _post('/api/ls2/assets/tires/${t['_id']}/move', body, tr('تم التركيب', 'Mounted'), tire: t, onDisplaced: (b) async {
      final fate = await showDialog<String>(
        context: context,
        builder: (c) => SimpleDialog(
          title: Text(tr('استبدال — الفردة القديمة هتروح فين؟', 'Replacement — where does the old tire go?')),
          children: [
            for (final o in [
              ('store', tr('سليمة → المستودع', 'Fine → store'), tr('صالحة، أُزيلت فقط — هنسجّل نسبتها', 'still good — we\'ll record its %')),
              ('repair', tr('في المصنع', 'At the factory'), tr('تروح مصنع التجديد — تعود صالحة أو سكراب', 'to the retreading factory — comes back usable or scrap')),
              ('scrap', tr('سكراب', 'Scrap'), tr('غير صالحة — تُخزّن حتى تُباع', 'unusable — kept to sell')),
              ('damaged', tr('تالفة', 'Damaged'), tr('انفجرت/تآكلت — لا وجود لها', 'blown/worn — gone')),
            ])
              SimpleDialogOption(
                onPressed: () => Navigator.pop(c, o.$1),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(o.$2, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                    Text(o.$3, style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                  ]),
                ),
              ),
          ],
        ),
      );
      if (fate == null) return false;
      // Complete the cycle: a good tyre goes to the warehouse, so record its condition percentage (read later by placement).
      num? pct;
      if (fate == 'store') pct = await _askPercent();
      await _post('/api/ls2/assets/tires/${t['_id']}/move',
          {...b, 'displacedTo': fate, if (pct != null) 'displacedConditionPercent': pct}, tr('تم التركيب', 'Mounted'), tire: t);
      return true;
    });
  }

  // Condition percentage when storing a good tyre; optional, can be skipped.
  Future<num?> _askPercent() {
    final ctrl = TextEditingController();
    return showDialog<num?>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حالة الفردة عند التخزين', 'Condition on storing')),
        content: TextField(
          controller: ctrl,
          keyboardType: TextInputType.number,
          autofocus: true,
          decoration: InputDecoration(labelText: tr('كام في المية؟ (0–100)', 'Percent? (0–100)'), suffixText: '%'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, null), child: Text(tr('تخطّي', 'Skip'))),
          FilledButton(onPressed: () => Navigator.pop(c, num.tryParse(ctrl.text.trim())), child: Text(tr('حفظ', 'Save'))),
        ],
      ),
    );
  }

  Future<void> _renewalResult(Map<String, dynamic> t) async {
    final result = await showDialog<String>(
      context: context,
      builder: (c) => SimpleDialog(
        title: Text(tr('نتيجة التجديد', 'Renewal result')),
        children: [
          SimpleDialogOption(onPressed: () => Navigator.pop(c, 'renewed'), child: Text(tr('نجح التجديد — إلى المستودع مستعملة صالحة', 'Renewed — back to store as usable'))),
          SimpleDialogOption(onPressed: () => Navigator.pop(c, 'scrap'), child: Text(tr('فشل — سكراب', 'Failed — scrap'))),
        ],
      ),
    );
    if (result == null) return;
    await _post('/api/ls2/assets/tires/${t['_id']}/renewal-result', {'result': result},
        result == 'renewed' ? tr('رجعت المستودع مستعملة صالحة', 'Back in store as usable') : tr('سُجّل سكراب', 'Scrapped'));
  }

  Future<void> _retire(Map<String, dynamic> t) async {
    final kind = await showDialog<String>(
      context: context,
      builder: (c) => SimpleDialog(
        title: Text(tr('إخراج الكاوتش', 'Retire tire')),
        children: [
          SimpleDialogOption(onPressed: () => Navigator.pop(c, 'damaged'), child: Text(tr('تالف', 'Damaged'))),
          SimpleDialogOption(onPressed: () => Navigator.pop(c, 'scrap'), child: Text(tr('سكراب', 'Scrap'))),
        ],
      ),
    );
    if (kind == null) return;
    await _post('/api/ls2/assets/tires/${t['_id']}/retire', {'kind': kind}, tr('تم التسجيل', 'Recorded'));
  }

  // Move state: any tyre to any state directly (removed automatically if mounted).
  Future<void> _changeStatus(Map<String, dynamic> t) async {
    const opts = [
      ('spare', 'في المخزن (سليمة)', 'In stock'),
      ('in_repair', 'في المصنع', 'At the factory'),
      ('scrap', 'سكراب', 'Scrap'),
      ('damaged', 'تالفة', 'Damaged'),
      ('retired', 'معدومة', 'Retired'),
      ('sold', 'مباعة', 'Sold'),
    ];
    final status = await showDialog<String>(
      context: context,
      builder: (c) => SimpleDialog(
        title: Text(tr('نقل الفردة إلى حالة', 'Move tire to status')),
        children: opts.where((o) => o.$1 != t['status']).map((o) => SimpleDialogOption(
          onPressed: () => Navigator.pop(c, o.$1),
          child: Text(tr(o.$2, o.$3)),
        )).toList(),
      ),
    );
    if (status == null) return;
    await _post('/api/ls2/assets/tires/${t['_id']}/status', {'status': status}, tr('تم النقل', 'Moved'));
  }

  // Sell the tyre (scrap/damaged sold as scrap); it leaves stock as sold.
  Future<void> _sell(Map<String, dynamic> t) async {
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('بيع الفردة كخردة', 'Sell tire as scrap')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text('${t['serial'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Text(tr('خطوة منفصلة عن وضعها سكراب — تُسجَّل الآن كمباعة وتخرج من المخزون.', 'A step after scrapping — records it sold and out of stock.'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft), textAlign: TextAlign.center),
          const SizedBox(height: 10),
          TextField(controller: reason, decoration: InputDecoration(labelText: tr('ملاحظة / السعر (اختياري)', 'Note / price (optional)'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.success), onPressed: () => Navigator.pop(c, true), child: Text(tr('تأكيد البيع', 'Confirm sale'))),
        ],
      ),
    );
    if (ok != true) return;
    await _post('/api/ls2/assets/tires/${t['_id']}/retire', {'kind': 'sold', if (reason.text.trim().isNotEmpty) 'notes': reason.text.trim()}, tr('سُجّلت كمباعة', 'Marked sold'));
  }

  // New trailer.
  Future<void> _createTrailer() async {
    final number = TextEditingController();
    final plate = TextEditingController();
    final notes = TextEditingController();
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('تسجيل تيدر جديد', 'Register new trailer'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            TextField(controller: number, decoration: InputDecoration(labelText: tr('رقم التيدر *', 'Trailer no. *'))),
            const SizedBox(height: 10),
            TextField(controller: plate, decoration: InputDecoration(labelText: tr('مركّب على سطحة (اختياري)', 'On flatbed (optional)'))),
            const SizedBox(height: 10),
            TextField(controller: notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
            const SizedBox(height: 14),
            SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save')))),
          ]),
        ),
      ),
    );
    if (ok != true || number.text.trim().isEmpty) return;
    await _post('/api/ls2/assets/trailers', {
      'trailerNumber': number.text.trim(),
      if (plate.text.trim().isNotEmpty) 'plate': plate.text.trim(),
      if (notes.text.trim().isNotEmpty) 'notes': notes.text.trim(),
    }, tr('تم تسجيل التيدر', 'Trailer registered'));
  }

  // Move a trailer to a flatbed (or remove it).
  Future<void> _moveTrailer(Map<String, dynamic> t) async {
    final plates = (_l(_d?['flatbeds']).map((x) => (x['plate'] ?? '').toString()).where((p) => p.isNotEmpty).toSet().toList()..sort());
    final plate = TextEditingController(text: (t['currentPlate'] ?? '').toString());
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 12, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${tr('نقل التيدر', 'Move trailer')} ${t['trailerNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 46)),
              onPressed: () async { final p = await _pickPlate(plates); if (p != null) setS(() => plate.text = p); },
              icon: const Icon(Icons.local_shipping_outlined, size: 18),
              label: Text(plate.text.trim().isEmpty ? tr('اختر السطحة…', 'Choose flatbed…') : plate.text, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
            ),
            const SizedBox(height: 10),
            TextField(controller: plate, onChanged: (_) => setS(() {}), decoration: InputDecoration(labelText: tr('أو اكتب لوحة السطحة', 'Or type flatbed plate'))),
            const SizedBox(height: 14),
            Row(children: [
              Expanded(child: OutlinedButton(onPressed: () { plate.text = ''; Navigator.pop(c, true); }, child: Text(tr('فكّ (غير مركّب)', 'Unhitch')))),
              const SizedBox(width: 10),
              Expanded(child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('نقل', 'Move')))),
            ]),
          ]),
        ),
      )),
    );
    if (ok != true) return;
    final to = plate.text.trim();
    // Does the receiving vehicle already have a trailer? Ask its fate, like the web; otherwise the server rejects the move.
    String? fate;
    if (to.isNotEmpty) {
      final target = _l(_d?['flatbeds']).where((x) => (x['plate'] ?? '').toString() == to).firstOrNull;
      final occ = (target?['currentTrailerNumber'] ?? '').toString();
      if (occ.isNotEmpty && occ != '${t['trailerNumber']}') {
        fate = await _askFate(occ, '${t['trailerNumber']}', (t['currentPlate'] ?? '').toString());
        if (fate == null) return;
      }
    }
    await _post('/api/ls2/assets/trailers/${t['_id']}/move', {'toPlate': to.isEmpty ? null : to, if (fate != null) 'displacedTo': fate},
        to.isEmpty ? tr('تم فكّ التيدر', 'Trailer unhitched') : tr('تم نقل التيدر', 'Trailer moved'));
  }

  /// Fate of the trailer on the receiving vehicle: it stands alone, or takes the incoming one's place on its vehicle (swap). A swap is invalid if the incoming one is standing with no vehicle.
  Future<String?> _askFate(String occupant, String incoming, String incomingPlate) {
    return showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('أين يذهب التيدر $occupant المركَّب على الشاحنة؟', 'Where does trailer $occupant go?')),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          OutlinedButton(onPressed: () => Navigator.pop(c, 'standing'),
              child: Text(tr('يقف لوحده بكاوتشه', 'Stands alone with its tires'))),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: incomingPlate.isEmpty ? null : () => Navigator.pop(c, 'swap'),
            child: Text(incomingPlate.isEmpty
                ? tr('التبديل غير متاح — التيدر $incoming واقف لوحده', 'Swap unavailable — trailer $incoming stands alone')
                : tr('تبديل: يروح على $incomingPlate مكان التيدر $incoming', 'Swap: goes to $incomingPlate in place of $incoming')),
          ),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel')))],
      ),
    );
  }

  /// From the vehicle's side: which trailer is on it. Same move (`/trailers/:id/move`): the chosen trailer is moved to it with its tyres, and the one that was on it is asked about its fate.
  Future<void> _hitchTruck(Map<String, dynamic> f) async {
    final plate = (f['plate'] ?? '').toString();
    final cur = (f['currentTrailerNumber'] ?? '').toString();
    final trailers = _l(_d?['trailers']).where((t) => '${t['trailerNumber']}' != cur).toList()
      ..sort((a, b) => ((a['currentPlate'] ?? '').toString().isEmpty ? 0 : 1) - ((b['currentPlate'] ?? '').toString().isEmpty ? 0 : 1));
    final picked = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (c) {
        String q = '';
        return StatefulBuilder(builder: (c, setS) {
          final fq = _fold(q.trim());
          final list = trailers.where((t) => fq.isEmpty || _fold('${t['trailerNumber']} ${t['currentPlate'] ?? ''}').contains(fq)).toList();
          return SafeArea(child: Padding(
            padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
            child: SizedBox(
              height: MediaQuery.of(c).size.height * 0.7,
              child: Column(children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(14, 14, 14, 4),
                  child: Text(cur.isEmpty
                      ? tr('تركيب تيدر على العربية $plate', 'Hitch a trailer to $plate')
                      : tr('العربية $plate عليها التيدر $cur — اختر التيدر الجديد', '$plate carries trailer $cur — choose the new one'),
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                ),
                Padding(
                  padding: const EdgeInsets.all(14),
                  child: SearchField(autofocus: true, hint: tr('ابحث برقم التيدر أو العربية…', 'Search trailer or truck…'), onChanged: (v) => setS(() => q = v)),
                ),
                if (cur.isNotEmpty) ListTile(
                  leading: const Icon(Icons.download_outlined, color: T.warn),
                  title: Text(tr('إنزال التيدر $cur فقط (يقف لوحده)', 'Just unhitch trailer $cur')),
                  onTap: () => Navigator.pop(c, <String, dynamic>{'_unhitch': true}),
                ),
                Expanded(child: ListView.builder(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  itemCount: list.length,
                  itemBuilder: (c, i) {
                    final t = list[i];
                    final on = (t['currentPlate'] ?? '').toString();
                    return ListTile(
                      leading: const Icon(Icons.rv_hookup_outlined, color: T.navy),
                      title: Text('${tr('تيدر', 'Trailer')} ${t['trailerNumber']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text(on.isEmpty ? tr('واقف لوحده', 'Standing alone') : tr('مركّب على $on', 'On $on')),
                      onTap: () => Navigator.pop(c, t),
                    );
                  },
                )),
              ]),
            ),
          ));
        });
      },
    );
    if (picked == null) return;
    if (picked['_unhitch'] == true) {
      final current = _l(_d?['trailers']).where((t) => '${t['trailerNumber']}' == cur).firstOrNull;
      if (current == null) return;
      await _post('/api/ls2/assets/trailers/${current['_id']}/move', {'toPlate': null, 'reason': tr('إنزال من العربية', 'Unhitched')},
          tr('تم إنزال التيدر', 'Trailer unhitched'));
      return;
    }
    String? fate;
    if (cur.isNotEmpty) {
      fate = await _askFate(cur, '${picked['trailerNumber']}', (picked['currentPlate'] ?? '').toString());
      if (fate == null) return;
    }
    await _post('/api/ls2/assets/trailers/${picked['_id']}/move', {'toPlate': plate, if (fate != null) 'displacedTo': fate},
        tr('تم تركيب التيدر ${picked['trailerNumber']} على $plate', 'Trailer ${picked['trailerNumber']} hitched to $plate'));
  }

  // Edit a flatbed (numbering, batch, brand, notes).
  Future<void> _editFlatbed(Map<String, dynamic> f) async {
    final numbering = TextEditingController(text: (f['numbering'] ?? '').toString());
    final batch = TextEditingController(text: (f['batch'] ?? '').toString());
    final brand = TextEditingController(text: (f['brand'] ?? '').toString());
    final notes = TextEditingController(text: (f['notes'] ?? '').toString());
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${tr('تعديل السطحة', 'Edit flatbed')} ${f['plate'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: TextField(controller: numbering, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('الترقيم', 'Numbering')))),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: batch, decoration: InputDecoration(labelText: tr('الدفعة', 'Batch')))),
            ]),
            const SizedBox(height: 10),
            TextField(controller: brand, decoration: InputDecoration(labelText: tr('الماركة', 'Brand'))),
            const SizedBox(height: 10),
            TextField(controller: notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
            const SizedBox(height: 14),
            SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save')))),
          ]),
        ),
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.patch('/api/ls2/assets/flatbeds/${f['_id']}', {
        if (numbering.text.trim().isNotEmpty) 'numbering': num.tryParse(numbering.text.trim()),
        'batch': batch.text.trim(),
        'brand': brand.text.trim(),
        'notes': notes.text.trim(),
      });
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم تعديل السطحة', 'Flatbed updated'))));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }
}

/// Where a tyre on no truck and no trailer went last, from its recorded move.
String tireLastSeenText(dynamic s) {
  if (s is! Map) return tr('مركّبة بدون عربية ولا تيدر — لا توجد حركة مسجّلة', 'Mounted on no vehicle or trailer — no recorded move');
  final day = (s['date'] ?? '').toString().length >= 10 ? s['date'].toString().substring(0, 10) : '';
  final from = (s['fromPlate'] ?? '').toString();
  final trl = (s['trailerNumber'] ?? '').toString();
  final on = (s['trailerOnPlate'] ?? '').toString();
  if (trl.isNotEmpty) {
    return tr('آخر حركة: نزلت${from.isNotEmpty ? ' من $from' : ''} مع تيدر $trl يوم $day${on.isNotEmpty ? ' — والتيدر الآن على $on' : ' — والتيدر واقف'}',
        'Last move: left${from.isNotEmpty ? ' $from' : ''} with trailer $trl on $day${on.isNotEmpty ? ' — the trailer is now on $on' : ' — the trailer is parked'}');
  }
  return tr('آخر حركة: ${from.isNotEmpty ? 'نزلت من $from ' : ''}يوم $day', 'Last move: ${from.isNotEmpty ? 'left $from ' : ''}on $day');
}
