import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/report_button.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'ls2_common.dart';

/// Location Solutions drivers: kilometres per driver for the period, his current vehicle, and driver details (his vehicles and movement history).
class Ls2DriversScreen extends StatefulWidget {
  const Ls2DriversScreen({super.key});
  @override
  State<Ls2DriversScreen> createState() => _Ls2DriversScreenState();
}

class _Ls2DriversScreenState extends State<Ls2DriversScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  // The search controller lives at the screen level: a period change reloads, so the field is not left empty while the word still filters.
  final _searchCtl = TextEditingController();
  String _chip = '';
  DateTimeRange _range = ls2ThisMonthToDate();
  int _seq = 0;
  late final void Function(dynamic) _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    // The telemetry pulse (carries `vehicles`) repeats every minute and changes nothing here.
    _onLive = (d) { if (!(d is Map && d.containsKey('vehicles'))) _load(); };
    Live.instance.onData('ls2:updated', _onLive);
  }

  @override
  void dispose() { Live.instance.offData('ls2:updated', _onLive); _searchCtl.dispose(); super.dispose(); }

  String get _from => ls2Ymd(_range.start);
  String get _to => ls2Ymd(_range.end);

  Future<void> _load() async {
    final seq = ++_seq;
    try {
      final d = await Api.instance.get('/api/ls2/drivers?from=$_from&to=$_to');
      if (!mounted || seq != _seq) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['items'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && seq == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  static final _chips = <(String, String, String, Color, bool Function(Map<String, dynamic>))>[
    ('', 'الكل', 'All', T.navy, (_) => true),
    ('onVehicle', 'على مركبة حاليًا', 'On a vehicle now', T.success, (d) => d['currentVehicle'] != null),
    ('noVehicle', 'من غير عربية', 'No vehicle', T.warn, (d) => d['currentVehicle'] == null),
    ('multi', 'اتنقل بين أكتر من عربية', 'Moved between vehicles', T.violet, (d) => (ls2Num(d['vehicleCount']) ?? 0) > 1),
    ('idle', 'بلا مسافة خلال الفترة', 'No distance', T.inkFaint, (d) => !((ls2Num(d['km']) ?? 0) > 0)),
  ];

  static final _cols = [
    ExportCol('السائق', 'Driver', (r) => r['driver'] ?? ''),
    ExportCol('المسافة في الفترة (كم)', 'Distance in period (km)', (r) => (ls2Num(r['km']) ?? 0).round()),
    ExportCol('أيام نشطة', 'Active days', (r) => r['activeDays'] ?? 0),
    ExportCol('عدد المركبات', 'Trucks driven', (r) => r['vehicleCount'] ?? 0),
    ExportCol('المركبة الحالية', 'Current truck', (r) => r['currentVehicle'] is Map ? (r['currentVehicle']['plate'] ?? '—') : '—'),
    ExportCol('المركبات (كم لكل مركبة)', 'Trucks (km each)', (r) {
      final s = ls2List(r['vehicles']).map((x) => '${x['plate'] ?? x['unitId']}: ${(ls2Num(x['km']) ?? 0).round()}').join(' | ');
      return s.isEmpty ? '—' : s;
    }),
  ];

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  Future<void> _openDriver(Map<String, dynamic> row) async {
    Map<String, dynamic>? d;
    try {
      d = Map<String, dynamic>.from(await Api.instance.get('/api/ls2/drivers/${Uri.encodeComponent((row['driver'] ?? '').toString())}?from=$_from&to=$_to'));
    } catch (_) {}
    if (!mounted) return;
    final history = List<Map<String, dynamic>>.from((d?['history'] ?? []) as List);
    final vehicles = List<Map<String, dynamic>>.from((d?['vehicles'] ?? row['vehicles'] ?? []) as List);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.72,
          child: ListView(padding: const EdgeInsets.all(18), children: [
            Text((row['driver'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            Text('$_from → $_to', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            const SizedBox(height: 6),
            Align(alignment: AlignmentDirectional.centerStart, child: ReportButton(subject: 'driver', id: (row['driver'] ?? '').toString(), label: tr('تقرير السائق PDF', 'Driver report PDF'))),
            const SizedBox(height: 8),
            Wrap(spacing: 6, runSpacing: 6, children: [
              Chip2('${((d?['km'] ?? row['km'] ?? 0) as num).round()} ${tr('كم', 'km')}', T.violet),
              Chip2('${tr('أيام نشطة', 'Active days')}: ${d?['activeDays'] ?? row['activeDays'] ?? 0}', T.info),
              if ((d?['currentVehicle'] ?? row['currentVehicle']) != null)
                Chip2('${tr('حاليًا', 'Now')}: ${(d?['currentVehicle'] ?? row['currentVehicle'])['plate'] ?? ''}', T.success, icon: Icons.local_shipping_outlined),
            ]),
            if (vehicles.isNotEmpty) ...[
              const SizedBox(height: 14),
              Text(tr('مركبات الفترة', 'Vehicles this period'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              const SizedBox(height: 6),
              ...vehicles.map((v) => Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(children: [
                  Expanded(child: Text((v['plate'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                  Chip2('${((v['km'] ?? 0) as num).round()} ${tr('كم', 'km')}', T.navy),
                ]),
              )),
            ],
            if (history.isNotEmpty) ...[
              const SizedBox(height: 14),
              Text(tr('تاريخ التنقلات', 'Assignment history'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              const SizedBox(height: 6),
              ...history.take(20).map((h) {
                final from = DateTime.tryParse((h['from'] ?? '').toString())?.toLocal();
                final to = DateTime.tryParse((h['to'] ?? '').toString())?.toLocal();
                return Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(children: [
                    const Icon(Icons.swap_horiz_rounded, size: 15, color: T.inkFaint),
                    const SizedBox(width: 8),
                    Expanded(child: Text((h['plate'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5))),
                    Text(
                      '${from != null ? '${from.day}/${from.month}/${from.year}' : '—'} ← ${to != null ? '${to.day}/${to.month}/${to.year}' : tr('الآن', 'now')}',
                      style: const TextStyle(fontSize: 11, color: T.inkSoft),
                    ),
                  ]),
                );
              }),
            ],
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final test = _chips.firstWhere((c) => c.$1 == _chip).$5;
    final filtered = _rows.where((r) => test(r) && (q.isEmpty || [r['driver'], ls2Map(r['currentVehicle'])['plate'], ...ls2List(r['vehicles']).map((v) => v['plate'])]
        .any((x) => _fold((x ?? '').toString()).contains(q)))).toList();
    final totalKm = filtered.fold<num>(0, (a, r) => a + (ls2Num(r['km']) ?? 0));

    return AppScaffold(
      title: Text(tr('السائقون (تتبع)', 'Drivers (telemetry)')),
      actions: [
        IconButton(
          tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined),
          onPressed: () => ls2ExportMenu(context, fileName: 'ls2-drivers', options: [
            ('كل السواقين', 'All drivers', [('$_from → $_to', _cols, _rows)]),
            ('النتائج الحالية (بعد الفلتر)', 'Current filtered results', [('$_from → $_to', _cols, filtered)]),
          ]),
        ),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  const SizedBox(height: 8),
                  Ls2RangeBar(value: _range, onChanged: (r) { setState(() { _range = r; _loading = true; }); _load(); }),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: SearchField(controller: _searchCtl, hint: tr('ابحث عن السائق…', 'Search driver…'), suffixText: '${filtered.length} · ${ls2Km(totalKm)}', onChanged: (v) => setState(() => _q = v)),
                  ),
                  SizedBox(
                    height: 42,
                    child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 14), children: [
                      for (final c in _chips)
                        Padding(
                          padding: const EdgeInsetsDirectional.only(end: 6),
                          child: FilterChip(
                            selected: _chip == c.$1,
                            onSelected: (_) => setState(() => _chip = c.$1),
                            label: Text('${tr(c.$2, c.$3)} (${_rows.where(c.$5).length})'),
                            labelStyle: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: _chip == c.$1 ? Colors.white : c.$4),
                            selectedColor: c.$4, backgroundColor: c.$4.withValues(alpha: 0.1), checkmarkColor: Colors.white, side: BorderSide.none,
                          ),
                        ),
                    ]),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: q.isNotEmpty ? Icons.search_off : Icons.badge_outlined, title: q.isNotEmpty ? tr('لا نتائج مطابقة للبحث', 'No matches') : tr('لا يوجد سائقون', 'No drivers'))])
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final r = filtered[i];
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: Pressable(
                                    onTap: () => _openDriver(r),
                                    child: AppCard(
                                      child: Row(children: [
                                        CircleAvatar(radius: 16, backgroundColor: T.navy.withValues(alpha: 0.1), child: const Icon(Icons.person_outline, size: 18, color: T.navy)),
                                        const SizedBox(width: 10),
                                        Expanded(
                                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                            Text((r['driver'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                                            Text(
                                              r['currentVehicle'] is Map ? '${tr('حاليًا', 'Now')}: ${r['currentVehicle']['plate'] ?? ''}' : tr('بلا مركبة حالية', 'No current vehicle'),
                                              style: const TextStyle(fontSize: 11.5, color: T.inkSoft),
                                            ),
                                          ]),
                                        ),
                                        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                          Text('${((r['km'] ?? 0) as num).round()}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
                                          Text(tr('كم', 'km'), style: const TextStyle(fontSize: 10, color: T.inkFaint)),
                                        ]),
                                      ]),
                                    ),
                                  ),
                                );
                              },
                            ),
                    ),
                  ),
                ]),
    );
  }
}
