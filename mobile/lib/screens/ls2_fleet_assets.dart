import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/tire_states.dart';
import '../ui/widgets.dart';
import 'ls2_vehicle_assets.dart';

/// أصول الأسطول (الكاوتشات والتريلات والسطحات) — نفس عمليات الويب:
/// تسجيل، فك إلى المستودع/التجديد/التالف/السكراب مع نسبة الحالة، تركيب/نقل
/// مع مصير القاطن وتركيب بديل، نتيجة التجديد، وسجل الأحداث.
class Ls2FleetAssetsScreen extends StatefulWidget {
  const Ls2FleetAssetsScreen({super.key});
  @override
  State<Ls2FleetAssetsScreen> createState() => _Ls2FleetAssetsScreenState();
}

List<Map<String, dynamic>> _l(dynamic v) =>
    v is List ? List<Map<String, dynamic>>.from(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : const [];

// الحالات كلُّها في ui/tire_states.dart — تعريفٌ واحد يقرأ منه الخادم والشاشة
// والجوّال. وما بقي هنا هو الدرجة وحدها.

// الدرجة وصفٌ للفردة لا لمكانها: جديدةٌ أو مستعملة، لا ثالث. وكانت هنا درجةٌ
// ثالثة «at_factory» تصف **مكانًا**، فاختلط وصفُ المكان بوصف الفردة.
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
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('ls2:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('ls2:updated', _onLive);
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

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  // نفس قاعدة الباك: نطابق العربية بأرقام اللوحة فقط (لأن لوحة السطحة كثيرًا ما
  // تختلف عن لوحة الفردة المخزّنة). أرقام عربية → إنجليزية ثم استخراج الأرقام.
  String _plateKey(String? p) {
    if (p == null) return '';
    const ar = '٠١٢٣٤٥٦٧٨٩';
    final west = p.split('').map((ch) { final i = ar.indexOf(ch); return i >= 0 ? '$i' : ch; }).join();
    final digits = RegExp(r'\d+').allMatches(west).map((m) => m.group(0)).join();
    return digits.isNotEmpty ? digits : west.trim().toUpperCase();
  }

  Future<void> _post(String path, Map<String, dynamic> body, String okMsg, {Future<bool> Function(Map<String, dynamic>)? onDisplaced}) async {
    try {
      await Api.instance.post(path, body);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(okMsg)));
      _load();
    } on ApiException catch (e) {
      // «الموقع مشغول» — نسأل عن مصير القاطن ثم نعيد الطلب نفسه + displacedTo.
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
        // الفلترُ والبطاقةُ من تعريفٍ واحد (ui/tire_states.dart): فلا يقول
        // العدّاد رقمًا وتفتح البطاقةُ غيره.
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
      // «في المخزن» شاملةٌ لِما تحتها: الجديد والمستعمل وتحت التجديد وفي المصنع
      // والسكراب — كلُّ ما هو عندنا وغيرُ مركَّب.
      ('store', tr('في المخزن', 'In store'), tires.where(tireInStore).length, T.info),
      for (final st in tireStates.where((x) => x.key != 'mounted'))
        (st.key, tr(st.ar, st.en), tires.where((t) => tireStateKey(t) == st.key).length, st.color),
    ];

    final flatbeds = _l(_d?['flatbeds']);
    final trailers = _l(_d?['trailers']);

    return DefaultTabController(
      length: 3,
      child: AppScaffold(
      title: Text(tr('أصول الأسطول', 'Fleet Assets')),
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
        tabs: [
          Tab(text: '${tr('الكاوتشات', 'Tires')} (${tires.length})'),
          Tab(text: '${tr('السطحات', 'Flatbeds')} (${flatbeds.length})'),
          Tab(text: '${tr('التيدرات', 'Trailers')} (${trailers.length})'),
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
                              onSelected: (_) => setState(() { _filter = selected ? '' : f.$1; _q = ''; }),
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
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث بالسيريال أو اللوحة أو النوع…', 'Search…'), prefixIcon: const Icon(Icons.search), suffixText: '${filtered.length}'),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.circle_outlined, title: tr('لا توجد كاوتشات مطابقة', 'No matches'))])
                          : ListView.separated(
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
                                        // إجراء سريع: تركيب الفردة المتاحة على شاحنة مباشرة.
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
              ]),
      ),
    );
  }

  // ── تبويب السطحات ──
  Widget _flatbedsTab(List<Map<String, dynamic>> flatbeds) {
    final q = _fold(_qFlat.trim());
    final list = flatbeds.where((f) {
      if (q.isEmpty) return true;
      return [f['plate'], f['numbering'], f['brand'], f['batch'], f['currentTrailerNumber'], f['driver']]
          .any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
        child: TextField(
          onChanged: (v) => setState(() => _qFlat = v),
          decoration: InputDecoration(hintText: tr('ابحث بلوحة السطحة أو الرقم أو النوع…', 'Search flatbeds…'), prefixIcon: const Icon(Icons.search), suffixText: '${list.length}'),
        ),
      ),
      Expanded(
        child: RefreshIndicator(
          onRefresh: _load,
          child: list.isEmpty
              ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.local_shipping_outlined, title: tr('لا توجد سطحات مطابقة', 'No matches'))])
              : ListView.separated(
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
                              Expanded(child: Text('${tr('سطحة', 'Flatbed')} $plate', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                              if (f['numbering'] != null) Chip2('#${f['numbering']}', T.navy),
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
                              // ١٤ هو الطقم الكامل — اللون بيقول على طول مين ناقص
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

  // ── تبويب التيدرات ──
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
            child: TextField(
              onChanged: (v) => setState(() => _qTrail = v),
              decoration: InputDecoration(hintText: tr('ابحث برقم التيدر أو السطحة…', 'Search trailers…'), prefixIcon: const Icon(Icons.search), suffixText: '${list.length}'),
            ),
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
                        onTap: plate.isEmpty ? null : () => Navigator.push(context, MaterialPageRoute(builder: (_) => Ls2VehicleAssetsScreen(plate: plate))),
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

  // ── تسجيل كاوتش جديد ──
  Future<void> _createTire() async {
    final serial = TextEditingController();
    final tireNumber = TextEditingController();
    final type = TextEditingController();
    final size = TextEditingController();
    final plate = TextEditingController();
    final position = TextEditingController();
    String sensor = 'unknown';
    bool isSpare = false;
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
              Row(children: [
                Expanded(child: TextField(controller: serial, decoration: InputDecoration(labelText: tr('السيريال *', 'Serial *')))),
                const SizedBox(width: 10),
                Expanded(child: TextField(controller: tireNumber, decoration: InputDecoration(labelText: tr('رقم الكاوتش', 'Tire #')))),
              ]),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: TextField(controller: type, decoration: InputDecoration(labelText: tr('النوع', 'Type')))),
                const SizedBox(width: 10),
                Expanded(child: TextField(controller: size, decoration: InputDecoration(labelText: tr('المقاس', 'Size')))),
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
                        'tireNumber': tireNumber.text.trim(),
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

  // ── ورقة عمليات الكاوتش ──
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
              // نقل الحالة — متاح دائمًا لكل الكاوتش (مثلًا: مستعمل صالح ← سكراب/تالف، أو سكراب ← مخزن).
              _chip(sheet, Icons.swap_horiz_rounded, tr('نقل الحالة', 'Change status'), T.info, () => _changeStatus(t)),
              if (status != 'scrap' && status != 'damaged' && status != 'retired' && status != 'sold')
                _chip(sheet, Icons.dangerous_outlined, tr('إتلاف/سكراب مباشرة', 'Retire'), T.danger, () => _retire(t)),
              // بيع الفردة (خاصة السكراب — تُباع كخردة).
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

  // فك: إلى المستودع (بنسبة حالة) أو التجديد أو التالف أو السكراب مباشرة.
  Future<void> _dismount(Map<String, dynamic> t) async {
    // الاستبن هو الموقع الوحيد اللي مسموح يفضل فاضي — العربية بتمشي من غيره.
    // أي موقع تاني لازم يتملي، فالبديل إجباري (أو تبديل متبادل).
    final needsReplacement = t['status'] == 'mounted'
        && !(t['isSpare'] == true || (t['section'] ?? '').toString().contains('استبن'));
    String destination = 'store';
    final percent = TextEditingController();
    final reason = TextEditingController();
    Map<String, dynamic>? replacement;
    Map<String, dynamic>? secondReplacement;
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
              // فردة بديلة تُركَّب مكانها — من المخزن أو مسحوبة من مركبة أخرى.
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
                // تبديل متبادل: هذه الفردة تُركَّب مكان البديلة على عربيتها.
                if (replacement != null && replacement!['status'] == 'mounted') ...[
                  Container(
                    margin: const EdgeInsets.only(top: 8),
                    decoration: BoxDecoration(color: T.warn.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
                    child: CheckboxListTile(
                      dense: true,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                      value: swap,
                      onChanged: (v) => setS(() { swap = v ?? false; if (swap) secondReplacement = null; }),
                      title: Text(
                        tr('تبديل متبادل: هذه الفردة تُركَّب مكان ${replacement!['serial']} على المركبة ${replacement!['plate']} (بدل نزولها).',
                           "Two-way swap: this tire takes ${replacement!['serial']}'s slot on truck ${replacement!['plate']}."),
                        style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: T.warn),
                      ),
                    ),
                  ),
                  // بدون تبديل: اختر فردة تملأ مكان البديلة على عربيتها (مخزن أو عربية ثالثة).
                  if (!swap) ...[
                    const SizedBox(height: 8),
                    Text(tr('يملأ مكان ${replacement!['serial']} على ${replacement!['plate']} (اختياري):', "Fills ${replacement!['serial']}'s slot on ${replacement!['plate']} (optional):"),
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 5),
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 44)),
                      onPressed: () async {
                        final r = await _pickReplacement(t,
                            alsoExclude: [(replacement!['_id'] ?? '').toString()],
                            excludePlateKey: (replacement!['plateKey'] ?? replacement!['plate'] ?? '').toString());
                        if (r != null) setS(() => secondReplacement = r.isEmpty ? null : r);
                      },
                      icon: const Icon(Icons.add_circle_outline, size: 16),
                      label: Text(
                        secondReplacement == null ? tr('— دون —', '— none —') : '${secondReplacement!['serial']}${secondReplacement!['status'] == 'mounted' ? ' · ${tr('من', 'from')} ${secondReplacement!['plate']}' : ' · ${tr('مخزن', 'store')}'}',
                        style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
                      ),
                    ),
                    Text(tr('من المخزن أو من عربية ثالثة.', 'From store, or a third truck.'), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                  ],
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
      if (!doSwap && secondReplacement != null) 'secondReplacementTireId': secondReplacement!['_id'],
    }, doSwap ? tr('تم التبديل', 'Swapped') : tr('تم الفك', 'Dismounted'));
  }

  // منتقي لوحة شاحنة من اللوحات المتاحة (بحث سريع).
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
                    child: TextField(autofocus: true, onChanged: (v) => setS(() => q = v),
                        decoration: InputDecoration(hintText: tr('ابحث عن لوحة الشاحنة…', 'Search truck plate…'), prefixIcon: const Icon(Icons.search))),
                  ),
                  Expanded(
                    child: list.isEmpty
                        ? EmptyState(icon: Icons.local_shipping_outlined, title: tr('لا توجد شاحنات', 'No trucks'))
                        : ListView.builder(
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

  // منتقي فردة: المخزن + المركّبة على أي مركبة (بما فيها نفس المركبة = الاستبن)،
  // مع استثناء فردات محددة. الترتيب: مخزن ← نفس المركبة ← مركبات أخرى.
  Future<Map<String, dynamic>?> _pickReplacement(Map<String, dynamic> source, {List<String> alsoExclude = const [], String? excludePlateKey}) {
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
                    child: TextField(autofocus: true, onChanged: (v) => setS(() => q = v),
                        decoration: InputDecoration(hintText: tr('ابحث بالسيريال أو الرقم…', 'Search serial / number…'), prefixIcon: const Icon(Icons.search))),
                  ),
                  ListTile(
                    leading: const Icon(Icons.block, color: T.inkFaint),
                    title: Text(tr('— دون بديل —', '— none —')),
                    onTap: () => Navigator.pop(c, <String, dynamic>{}),
                  ),
                  const Divider(height: 1),
                  Expanded(
                    child: list.isEmpty
                        ? EmptyState(icon: Icons.tire_repair_outlined, title: tr('لا توجد فردات متاحة', 'No available tires'))
                        : ListView.builder(
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

  // تركيب/نقل: لوحة + موضع؛ لو الموضع مشغول يسأل عن مصير القاطن ويعيد.
  Future<void> _mount(Map<String, dynamic> t) async {
    final plate = TextEditingController(text: (t['plate'] ?? '').toString());
    final position = TextEditingController(text: (t['positionNumber'] ?? '').toString());
    // كل السطحات (61) متاحة للاختيار — مش بس اللي عليها كاوتشات مسجّلة.
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
            // شبكة المواضع 1..14 على الشاحنة المختارة: 🟢 فاضي = تركيب مباشر،
            // 🔴 عليه فردة = استبدال (هيتطلب مصير الفردة القديمة). اضغط الموضع لاختياره.
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
    await _post('/api/ls2/assets/tires/${t['_id']}/move', body, tr('تم التركيب', 'Mounted'), onDisplaced: (b) async {
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
      // نكمّل السايكل: سليمة للمخزن → نسجّل نسبة الحالة (يقرأها التسكين لاحقًا).
      num? pct;
      if (fate == 'store') pct = await _askPercent();
      await _post('/api/ls2/assets/tires/${t['_id']}/move',
          {...b, 'displacedTo': fate, if (pct != null) 'displacedConditionPercent': pct}, tr('تم التركيب', 'Mounted'));
      return true;
    });
  }

  // كام في المية عند تخزين فردة سليمة — اختياري (يقدر يتخطّاها).
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

  // نقل الحالة — أي كاوتش لأي حالة مباشرة (يُفَك تلقائيًا لو كان مركّبًا).
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

  // بيع الفردة (السكراب/التالف يُباع كخردة) — تخرج من المخزون كمباعة.
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

  // ── تيدر جديد ──
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

  // ── نقل تيدر إلى سطحة (أو فكّه) ──
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
    await _post('/api/ls2/assets/trailers/${t['_id']}/move', {'toPlate': plate.text.trim().isEmpty ? null : plate.text.trim()},
        plate.text.trim().isEmpty ? tr('تم فكّ التيدر', 'Trailer unhitched') : tr('تم نقل التيدر', 'Trailer moved'));
  }

  // ── تعديل سطحة (ترقيم/دفعة/ماركة/ملاحظات) ──
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
