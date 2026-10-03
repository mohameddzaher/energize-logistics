import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// لوحة إدارة الأسطول — the vehicle cards board, native: every truck a card
/// colored by its computed state (late/arrived/moving/preparing/idle),
/// grouped by supervisor, with the same live updates as the web board.
class FleetBoardScreen extends StatefulWidget {
  const FleetBoardScreen({super.key});
  @override
  State<FleetBoardScreen> createState() => _FleetBoardScreenState();
}

const _states = {
  'late': ('متأخرة عن الوصول', 'Late', T.danger),
  'arrived': ('وصلت موقع التنزيل', 'Arrived', T.success),
  // فرّغت: أُرسل سندُها فخلت من حمولتها — تُجهَّز لما بعدها ولا تُستعجَل.
  'unloaded': ('فرّغت', 'Unloaded', T.cyan),
  'moving': ('في الطريق', 'On the road', T.warn),
  'preparing': ('تحميل / تجهيز', 'Loading', T.info),
  'idle': ('بدون حمولة', 'Idle', T.inkFaint),
};

/// ما يُعَدُّ في الشرائح — «بدون حمولة» حالةُ بطاقةٍ لا رقمٌ يُتابَع.
const _counted = ['late', 'moving', 'arrived', 'unloaded', 'preparing'];

class _FleetBoardScreenState extends State<FleetBoardScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;
  String _filter = '';
  String _city = '';
  String _q = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('fleet:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('fleet:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/fleet/board');
      if (!mounted) return;
      setState(() { _data = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    String fold(String x) => x
        .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();
    final q = fold(_q.trim());
    final cards = List<Map<String, dynamic>>.from(_data?['cards'] ?? [])
        .where((c) => _city.isEmpty || ((c['trip'] as Map?)?['toCity'] ?? '') == _city)
        .where((c) {
          if (_filter == 'maintOverdue') return (c['maintenance'] as Map?)?['status'] == 'overdue';
          if (_filter == 'maintDue') return (c['maintenance'] as Map?)?['status'] == 'due';
          return _filter.isEmpty || c['state'] == _filter;
        })
        .where((c) {
          if (q.isEmpty) return true;
          final trip = c['trip'] as Map<String, dynamic>?;
          return [
            c['plate'], c['name'], c['supervisorName'], c['liveCity'],
            trip?['customerName'], trip?['toCity'], trip?['waybillNumber'],
            ...List<Map<String, dynamic>>.from(c['drivers'] ?? []).map((d) => d['name']),
          ].any((x) => fold((x ?? '').toString()).contains(q));
        })
        .toList();

    // Group by supervisor, keeping insertion order.
    final groups = <String, List<Map<String, dynamic>>>{};
    for (final c in cards) {
      final k = (c['supervisorName'] ?? '').toString().isEmpty ? tr('بدون مشرف', 'No supervisor') : c['supervisorName'].toString();
      groups.putIfAbsent(k, () => []).add(c);
    }

    // ── والأرقامُ تُقاس على الوجهة المختارة ─────────────────────────────────
    // مَن ضغط «الدمام» يريد أرقامَ الدمام لا أرقامَ الأسطول كلِّه. والحالةُ لا
    // تدخل في العَدّ: الشريحةُ هي التي تختار الحالة، فلو قاست نفسَها بها
    // لصفّرت أخواتِها.
    final all = List<Map<String, dynamic>>.from(_data?['cards'] ?? [])
        .where((c) => _city.isEmpty || ((c['trip'] as Map?)?['toCity'] ?? '') == _city)
        .toList();
    int countOf(String s) => all.where((c) => c['state'] == s).length;
    /// كم من حالةٍ ما صيانتُها متأخّرة، وأيُّ صيانة.
    (int, String) maintOf(String st) {
      final od = all.where((c) => c['state'] == st && (c['maintenance'] as Map?)?['status'] == 'overdue').toList();
      final names = <String, int>{};
      for (final c in od) {
        final n = ((c['maintenance'] as Map?)?['nextServiceName'] ?? '').toString().trim();
        final k = n.isEmpty ? tr('صيانة دوريّة', 'Scheduled service') : n;
        names[k] = (names[k] ?? 0) + 1;
      }
      final top = names.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
      return (od.length, top.isEmpty ? '' : top.first.key);
    }
    final dests = List<Map<String, dynamic>>.from((_data?['summary'] ?? {})['byDestination'] ?? []);
    final total = ((_data?['summary'] ?? {})['total'] ?? 0).toString();

    return AppScaffold(
      title: Text(_loading ? tr('لوحة الأسطول', 'Fleet Board') : '${tr('لوحة الأسطول', 'Fleet Board')} · $total'),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 60), SizedBox(height: 10), Shimmer(height: 120),
              SizedBox(height: 10), Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 120),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(14),
                    children: [
                      // بحث شامل: لوحة/سائق/عميل/مدينة/بوليصة/مشرف.
                      TextField(
                        onChanged: (v) => setState(() => _q = v),
                        decoration: InputDecoration(
                          hintText: tr('ابحث باللوحة أو السائق أو العميل أو الوجهة…', 'Search plate, driver, customer, city…'),
                          prefixIcon: const Icon(Icons.search),
                        ),
                      ),
                      const SizedBox(height: 10),
                      // State filter chips — tap to focus, tap again to clear.
                      SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: _counted.map((key) {
                            final e = (key: key, value: _states[key]!);
                            final selected = _filter == e.key;
                            final n = countOf(e.key);
                            final m = maintOf(e.key);
                            return Padding(
                              padding: const EdgeInsets.only(left: 6),
                              child: FilterChip(
                                selected: selected,
                                onSelected: (_) => setState(() => _filter = selected ? '' : e.key),
                                label: Text('${tr(e.value.$1, e.value.$2)} ($n)'
                                    '${m.$1 > 0 ? ' · ${tr('صيانة', 'svc')} ${m.$1}${m.$2.isEmpty ? '' : ' ${m.$2}'}' : ''}'),
                                labelStyle: TextStyle(
                                  fontSize: 12, fontWeight: FontWeight.w700,
                                  color: selected ? Colors.white : e.value.$3,
                                ),
                                selectedColor: e.value.$3,
                                backgroundColor: e.value.$3.withValues(alpha: 0.1),
                                checkmarkColor: Colors.white,
                                side: BorderSide.none,
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                              ),
                            );
                          }).toList()
                            ..addAll([
                              for (final m in const [('maintOverdue', 'overdue', 'صيانة متأخرة', 'Service overdue'), ('maintDue', 'due', 'صيانة قريبة', 'Service due')])
                                Padding(
                                  padding: const EdgeInsets.only(left: 6),
                                  child: FilterChip(
                                    selected: _filter == m.$1,
                                    onSelected: (_) => setState(() => _filter = _filter == m.$1 ? '' : m.$1),
                                    label: Text('${tr(m.$3, m.$4)} (${all.where((c) => (c['maintenance'] as Map?)?['status'] == m.$2).length})'),
                                    labelStyle: TextStyle(
                                      fontSize: 12, fontWeight: FontWeight.w700,
                                      color: _filter == m.$1 ? Colors.white : (m.$2 == 'overdue' ? T.danger : T.warn),
                                    ),
                                    selectedColor: m.$2 == 'overdue' ? T.danger : T.warn,
                                    backgroundColor: (m.$2 == 'overdue' ? T.danger : T.warn).withValues(alpha: 0.1),
                                    checkmarkColor: Colors.white,
                                    side: BorderSide.none,
                                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                                  ),
                                ),
                            ]),
                        ),
                      ),
                      // ── الوجهاتُ الآن: شريحةٌ تحكم الأرقام فوقها ──────────
                      if (dests.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(children: [
                            const Icon(Icons.place_outlined, size: 16, color: T.orange),
                            const SizedBox(width: 4),
                            for (final d in dests)
                              Padding(
                                padding: const EdgeInsets.only(left: 6),
                                child: FilterChip(
                                  selected: _city == d['city'],
                                  onSelected: (_) => setState(() => _city = _city == d['city'] ? '' : (d['city'] ?? '').toString()),
                                  label: Text('${d['city']} ${d['n']}'),
                                  labelStyle: TextStyle(
                                    fontSize: 12, fontWeight: FontWeight.w700,
                                    color: _city == d['city'] ? Colors.white : T.navy,
                                  ),
                                  selectedColor: T.orange,
                                  backgroundColor: T.navy.withValues(alpha: 0.08),
                                  checkmarkColor: Colors.white,
                                  side: BorderSide.none,
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                                ),
                              ),
                          ]),
                        ),
                        if (_city.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text(
                              tr('الأرقام أعلاه لـ${all.length} سيارة متوجهة إلى $_city', 'The counts above cover ${all.length} trucks bound for $_city'),
                              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: T.orange),
                            ),
                          ),
                      ],
                      const SizedBox(height: 12),
                      if (cards.isEmpty)
                        EmptyState(icon: Icons.local_shipping_outlined, title: tr('لا توجد سيارات مطابقة', 'No matching vehicles')),
                      ...groups.entries.map((g) => Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Padding(
                                padding: const EdgeInsets.symmetric(vertical: 8),
                                child: Row(children: [
                                  const Icon(Icons.person_pin_circle_outlined, size: 18, color: T.navy),
                                  const SizedBox(width: 5),
                                  Text(g.key, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                                  const SizedBox(width: 6),
                                  Chip2(tr('${g.value.length} سيارة', '${g.value.length} vehicles'), T.navy),
                                ]),
                              ),
                              ...g.value.asMap().entries.map((e) => FadeSlideIn(
                                    delayMs: (e.key * 40).clamp(0, 400),
                                    child: _VehicleCard(card: e.value),
                                  )),
                            ],
                          )),
                    ],
                  ),
                ),
    );
  }
}

class _VehicleCard extends StatelessWidget {
  final Map<String, dynamic> card;
  const _VehicleCard({required this.card});

  @override
  Widget build(BuildContext context) {
    final st = _states[card['state']] ?? _states['idle']!;
    final trip = card['trip'] as Map<String, dynamic>?;
    final maint = card['maintenance'] as Map<String, dynamic>?;
    final drivers = List<Map<String, dynamic>>.from(card['drivers'] ?? []);
    // الخادمُ يقول `due` لا `due_soon` — وكانت الشارةُ لا تظهر للقريبة أصلًا.
    final maintDue = maint != null && (maint['status'] == 'overdue' || maint['status'] == 'due');

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      child: AppCard(
        topAccent: st.$3,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Text(card['plate'] ?? '', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(width: 8),
              if ((card['trailerType'] ?? '').toString().isNotEmpty)
                Text(card['trailerType'], style: const TextStyle(fontSize: 12, color: T.inkSoft)),
              const Spacer(),
              Chip2(tr(st.$1, st.$2), st.$3),
            ]),
            if (trip != null) ...[
              const SizedBox(height: 8),
              Row(children: [
                const Icon(Icons.route_outlined, size: 15, color: T.inkSoft),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    '${tr('بوليصة', 'Waybill')} ${trip['waybillNumber']} — ${trip['fromCity'] ?? ''} ← ${trip['toCity'] ?? ''}'
                    '${(trip['customerName'] ?? '').toString().isNotEmpty ? ' · ${trip['customerName']}' : ''}',
                    style: const TextStyle(fontSize: 13, color: T.ink, fontWeight: FontWeight.w600),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ]),
            ],
            const SizedBox(height: 8),
            Wrap(spacing: 6, runSpacing: 6, children: [
              if ((card['liveCity'] ?? '') != null && (card['liveCity'] ?? '').toString().isNotEmpty)
                Chip2('${tr('الآن في', 'Now in')} ${card['liveCity']}', T.cyan, icon: Icons.location_on_outlined),
              if (card['atDestination'] == true)
                Chip2(tr('دخلت نطاق الوجهة', 'Entered destination zone'), T.success, icon: Icons.flag_outlined),
              if (drivers.isNotEmpty)
                Chip2(drivers.map((d) => d['name']).join(' · '), T.inkSoft, icon: Icons.person_outline),
              if (maintDue)
                Chip2(
                  '${((maint['nextServiceName'] ?? '').toString().trim().isEmpty ? tr('صيانة', 'Service') : maint['nextServiceName'])} '
                      '${maint['status'] == 'overdue' ? tr('متأخرة', 'overdue') : tr('قريبة', 'due')}',
                  maint['status'] == 'overdue' ? T.danger : T.warn,
                  icon: Icons.build_outlined,
                ),
            ]),
          ],
        ),
      ),
    );
  }
}
