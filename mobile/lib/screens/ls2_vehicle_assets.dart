import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// أصول المركبة — كل الكاوتشات المركّبة على مركبة بأماكنها (المحور/الموضع)،
/// مع السطحة/التيدر المركّبين وسجل أحداث الأصول — GET /api/ls2/assets/vehicle/:plate.
class Ls2VehicleAssetsScreen extends StatefulWidget {
  final String plate;
  const Ls2VehicleAssetsScreen({super.key, required this.plate});
  @override
  State<Ls2VehicleAssetsScreen> createState() => _Ls2VehicleAssetsScreenState();
}

List<Map<String, dynamic>> _l(dynamic v) =>
    v is List ? List<Map<String, dynamic>>.from(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : const [];

const _conditions = {
  'new': ('جديد', 'New', T.success),
  'used': ('مستعمل', 'Used', T.info),
  'renewed': ('مجدد', 'Renewed', T.violet),
};

String _d(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? '—' : '${d.day}/${d.month}/${d.year}';
}

class _Ls2VehicleAssetsScreenState extends State<Ls2VehicleAssetsScreen> {
  Map<String, dynamic>? _d0;
  Map<String, dynamic>? _hist;
  bool _loading = true;
  String? _error;
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
      final p = Uri.encodeComponent(widget.plate);
      // الأصول والخط الزمني مع بعض. الخط الزمني بيلم الكاوتش وقطع الغيار
      // والإصلاحات والصيانة في مكان واحد — نفس اللي على الموقع بالظبط.
      final results = await Future.wait([
        Api.instance.get('/api/ls2/assets/vehicle/$p'),
        Api.instance.get('/api/ls2/assets/vehicle/$p/history').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        _d0 = Map<String, dynamic>.from(results[0]);
        _hist = results[1] is Map ? Map<String, dynamic>.from(results[1]) : null;
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  // فلتر نوع الحركة في الخط الزمني — فاضي = الكل
  String _kind = '';
  static const _kinds = {
    'tire': ('كاوتش', 'Tires', T.orange),
    'part': ('قطع غيار', 'Parts', T.cyan),
    'repair': ('إصلاح', 'Repairs', T.danger),
    'service': ('صيانة', 'Service', T.success),
  };

  bool _isHead(dynamic section) => (section ?? '').toString().contains('راس') || (section ?? '').toString().toLowerCase().contains('head');

  @override
  Widget build(BuildContext context) {
    final tires = _l(_d0?['tires']);
    final flatbed = _d0?['flatbed'] is Map ? Map<String, dynamic>.from(_d0!['flatbed']) : null;
    final trailer = _d0?['trailer'] is Map ? Map<String, dynamic>.from(_d0!['trailer']) : null;
    final events = _l(_d0?['events']);
    final histAll = _l(_hist?['rows']);
    final hist = _kind.isEmpty ? histAll : histAll.where((r) => r['kind'] == _kind).toList();
    final histCounts = _hist?['counts'] is Map ? Map<String, dynamic>.from(_hist!['counts']) : <String, dynamic>{};
    final spares = tires.where((t) => t['isSpare'] == true).toList();
    final onWheels = tires.where((t) => t['isSpare'] != true).toList();
    final head = onWheels.where((t) => _isHead(t['section'])).toList();
    final trailerTires = onWheels.where((t) => !_isHead(t['section'])).toList();

    return AppScaffold(
      title: Text('${tr('أصول المركبة', 'Vehicle assets')} ${widget.plate}'),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer(height: 200)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    // ملخص
                    FadeSlideIn(
                      child: AppCard(
                        topAccent: T.navy,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            const Icon(Icons.local_shipping_outlined, size: 20, color: T.navy),
                            const SizedBox(width: 8),
                            Text(widget.plate, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                            const Spacer(),
                            Chip2('${tires.length} ${tr('كاوتش', 'tires')}', T.success),
                          ]),
                          const SizedBox(height: 8),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            if (flatbed != null) Chip2('${tr('سطحة', 'Flatbed')} ${flatbed['numbering'] ?? flatbed['batch'] ?? ''}', T.cyan, icon: Icons.dashboard_outlined),
                            if (trailer != null) Chip2('${tr('تيدر', 'Trailer')} ${trailer['trailerNumber'] ?? ''}', T.violet, icon: Icons.rv_hookup_outlined),
                            Chip2('${tr('الرأس', 'Head')}: ${head.length}', T.navy),
                            Chip2('${tr('التيدر', 'Trailer')}: ${trailerTires.length}', T.orange),
                            if (spares.isNotEmpty) Chip2('${tr('استبن', 'Spare')}: ${spares.length}', T.violet, icon: Icons.star_outline),
                          ]),
                        ]),
                      ),
                    ),
                    // كاوتشات الرأس
                    if (head.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      _sectionTitle(tr('كاوتشات الرأس', 'Head tires'), head.length),
                      const SizedBox(height: 6),
                      ...head.map(_tireRow),
                    ],
                    // كاوتشات التيدر
                    if (trailerTires.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      _sectionTitle(tr('كاوتشات التيدر', 'Trailer tires'), trailerTires.length),
                      const SizedBox(height: 6),
                      ...trailerTires.map(_tireRow),
                    ],
                    // الاستبن
                    if (spares.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      _sectionTitle(tr('الاستبن', 'Spare'), spares.length),
                      const SizedBox(height: 6),
                      ...spares.map(_tireRow),
                    ],
                    if (tires.isEmpty)
                      Padding(padding: const EdgeInsets.only(top: 30), child: EmptyState(icon: Icons.tire_repair_outlined, title: tr('لا توجد كاوتشات مسجّلة على هذه المركبة', 'No tires registered on this vehicle'))),
                    // الخط الزمني المدموج: كاوتش + قطع غيار + إصلاح + صيانة
                    if (histAll.isNotEmpty) ...[
                      const SizedBox(height: 14),
                      _sectionTitle(tr('تاريخ المركبة', 'Vehicle history'), histAll.length),
                      const SizedBox(height: 6),
                      SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(children: [
                          _kindChip('', tr('الكل', 'All'), histAll.length, T.navy),
                          ..._kinds.entries.where((e) => (histCounts[e.key] ?? 0) > 0).map(
                            (e) => _kindChip(e.key, tr(e.value.$1, e.value.$2), histCounts[e.key] ?? 0, e.value.$3)),
                        ]),
                      ),
                      const SizedBox(height: 8),
                      ...hist.take(60).map((r) {
                        final k = _kinds[r['kind']];
                        final c = k?.$3 ?? T.inkFaint;
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 6),
                          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Container(margin: const EdgeInsets.only(top: 4), width: 9, height: 9,
                                decoration: BoxDecoration(color: c, shape: BoxShape.circle)),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Row(children: [
                                  Expanded(child: Text('${r['title'] ?? ''}',
                                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5),
                                      maxLines: 1, overflow: TextOverflow.ellipsis)),
                                  const SizedBox(width: 6),
                                  Text(_d(r['date']), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                                ]),
                                if ((r['detail'] ?? '').toString().isNotEmpty)
                                  Text('${r['detail']}', style: const TextStyle(fontSize: 11.5), maxLines: 2, overflow: TextOverflow.ellipsis),
                                if ((r['notes'] ?? '').toString().isNotEmpty || (r['by'] ?? '').toString().isNotEmpty)
                                  Text([r['by'], r['notes']].where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
                                      style: const TextStyle(fontSize: 10.5, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis),
                              ]),
                            ),
                          ]),
                        );
                      }),
                    ] else if (events.isNotEmpty) ...[
                      const SizedBox(height: 14),
                      _sectionTitle(tr('سجل الأصول', 'Asset history'), events.length),
                    ],
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }

  Widget _kindChip(String k, String label, int n, Color c) => Padding(
        padding: const EdgeInsetsDirectional.only(end: 6),
        child: Pressable(
          onTap: () => setState(() => _kind = _kind == k ? '' : k),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: _kind == k ? c : c.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(9),
            ),
            child: Text('$label $n', style: TextStyle(
              fontSize: 11.5, fontWeight: FontWeight.w700,
              color: _kind == k ? Colors.white : c)),
          ),
        ),
      );

  Widget _sectionTitle(String t, int n) => Row(children: [
        Text(t, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(width: 6),
        Text('($n)', style: const TextStyle(fontSize: 13, color: T.inkFaint)),
      ]);

  Widget _tireRow(Map<String, dynamic> t) {
    final cond = _conditions[t['condition']];
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Pressable(
        onTap: () => _openTire(t),
        child: AppCard(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        child: Row(children: [
          Container(
            width: 44, height: 44,
            decoration: BoxDecoration(color: T.navy.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12)),
            child: Center(child: Text('${t['positionNumber'] ?? '?'}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: T.navy))),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${t['serial'] ?? ''}${(t['tireNumber'] ?? '').toString().isNotEmpty ? ' · ${tr('رقم', 'no.')} ${t['tireNumber']}' : ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
              const SizedBox(height: 3),
              Wrap(spacing: 6, runSpacing: 4, children: [
                if (t['isSpare'] == true) Chip2(tr('استبن', 'Spare'), T.violet, icon: Icons.star_outline),
                if ((t['positionLabel'] ?? '').toString().isNotEmpty) Chip2(t['positionLabel'].toString(), T.navy, icon: Icons.my_location_outlined),
                if (cond != null) Chip2(tr(cond.$1, cond.$2), cond.$3),
                if (t['conditionPercent'] != null) Chip2('${t['conditionPercent']}%', T.orange),
                if ((t['type'] ?? '').toString().isNotEmpty) Chip2('${t['type']} ${t['size'] ?? ''}'.trim(), T.inkFaint),
                if (t['sensor'] == 'yes') Chip2(tr('حساس', 'Sensor'), T.cyan, icon: Icons.sensors),
              ]),
            ]),
          ),
        ]),
        ),
      ),
    );
  }

  // تفاصيل فردة + تاريخها الكامل (عبر كل المركبات) + تعليم/إلغاء الاستبن.
  Future<void> _openTire(Map<String, dynamic> t) async {
    List<Map<String, dynamic>> events = [];
    try {
      final d = await Api.instance.get('/api/ls2/assets/events?refId=${t['_id']}&limit=200');
      events = _l(d['events']);
    } catch (_) {}
    if (!mounted) return;
    final cond = _conditions[t['condition']];
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.8,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 8),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text('${t['serial'] ?? ''}${(t['tireNumber'] ?? '').toString().isNotEmpty ? ' · ${tr('رقم', 'no.')} ${t['tireNumber']}' : ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
                  if (t['isSpare'] == true) Chip2(tr('استبن', 'Spare'), T.violet, icon: Icons.star_outline),
                ]),
                const SizedBox(height: 8),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  if ((t['positionLabel'] ?? '').toString().isNotEmpty) Chip2(t['positionLabel'].toString(), T.navy, icon: Icons.my_location_outlined),
                  if (cond != null) Chip2(tr(cond.$1, cond.$2), cond.$3),
                  if (t['conditionPercent'] != null) Chip2('${t['conditionPercent']}%', T.orange),
                  if ((t['type'] ?? '').toString().isNotEmpty) Chip2('${t['type']} ${t['size'] ?? ''}'.trim(), T.inkFaint),
                  Chip2(t['sensor'] == 'yes' ? tr('به حساس', 'Has sensor') : t['sensor'] == 'no' ? tr('بدون حساس', 'No sensor') : tr('الحساس غير معروف', 'Sensor unknown'),
                      t['sensor'] == 'yes' ? T.cyan : T.inkFaint, icon: Icons.sensors),
                ]),
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: () async {
                      try {
                        await Api.instance.patch('/api/ls2/assets/tires/${t['_id']}', {'isSpare': !(t['isSpare'] == true)});
                        t['isSpare'] = !(t['isSpare'] == true);
                        setS(() {});
                        _load();
                      } catch (e) {
                        if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                      }
                    },
                    icon: Icon(t['isSpare'] == true ? Icons.star : Icons.star_outline, size: 18, color: T.violet),
                    label: Text(t['isSpare'] == true ? tr('إلغاء تعليمها كاستبن', 'Unset as spare') : tr('تعليمها كـ استبن', 'Mark as the spare')),
                  ),
                ),
              ]),
            ),
            const Divider(height: 1),
            Padding(padding: const EdgeInsets.fromLTRB(18, 10, 18, 4), child: Text('${tr('تاريخ الفردة', 'Tire history')} (${events.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
            Expanded(
              child: events.isEmpty
                  ? EmptyState(icon: Icons.history, title: tr('لا يوجد سجل لهذه الفردة', 'No history for this tire'))
                  : ListView.builder(
                      padding: const EdgeInsets.fromLTRB(18, 4, 18, 12),
                      itemCount: events.length,
                      itemBuilder: (c, i) {
                        final e = events[i];
                        final act = {
                          'registered': (tr('تسجيل', 'Registered'), T.info),
                          'mounted': (tr('تركيب', 'Mounted'), T.success),
                          'transferred': (tr('نقل', 'Transferred'), T.navy),
                          'removed': (tr('إزالة', 'Removed'), T.warn),
                          'to_repair': (tr('للتجديد', 'To renewal'), T.warn),
                          'from_repair': (tr('من التجديد', 'From renewal'), T.info),
                          'renewed': (tr('تجديد', 'Renewed'), T.violet),
                          'scrapped': (tr('سكراب', 'Scrapped'), T.inkFaint),
                          'damaged': (tr('تلف', 'Damaged'), T.danger),
                          'updated': (tr('تعديل', 'Updated'), T.inkFaint),
                        }[e['action']] ?? ((e['action'] ?? '—').toString(), T.inkFaint);
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Column(children: [
                              Container(margin: const EdgeInsets.only(top: 4), width: 10, height: 10, decoration: BoxDecoration(color: act.$2, shape: BoxShape.circle)),
                              if (i < events.length - 1) Container(width: 2, height: 34, color: T.navy.withValues(alpha: 0.1)),
                            ]),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(
                                  '${act.$1}'
                                  '${(e['fromPlate'] ?? '').toString().isNotEmpty && e['action'] != 'mounted' && e['action'] != 'registered' ? ' · ${tr('من', 'from')} ${e['fromPlate']}' : ''}'
                                  '${(e['toPlate'] ?? '').toString().isNotEmpty ? ' → ${e['toPlate']}' : ''}',
                                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                                Text('${_d(e['date'])}${(e['performedByName'] ?? '').toString().isNotEmpty ? ' · ${e['performedByName']}' : ''}${(e['reason'] ?? '').toString().isNotEmpty ? ' · ${e['reason']}' : ''}',
                                    style: const TextStyle(fontSize: 11, color: T.inkFaint), maxLines: 2, overflow: TextOverflow.ellipsis),
                              ]),
                            ),
                          ]),
                        );
                      },
                    ),
            ),
          ]),
        ),
      )),
    );
  }
}
