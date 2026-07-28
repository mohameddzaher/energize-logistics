import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// سائقو لوكيشن سوليوشن — كيلومترات الفترة لكل سائق، مركبته الحالية،
/// وتفاصيل السائق (مركباته وتاريخ تنقلاته).
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

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/ls2/drivers');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['items'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  Future<void> _openDriver(Map<String, dynamic> row) async {
    Map<String, dynamic>? d;
    try {
      d = Map<String, dynamic>.from(await Api.instance.get('/api/ls2/drivers/${Uri.encodeComponent((row['driver'] ?? '').toString())}'));
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
    final filtered = _rows.where((r) => q.isEmpty || _fold((r['driver'] ?? '').toString()).contains(q)).toList();

    return AppScaffold(
      title: Text(tr('السائقون (تتبع)', 'Drivers (telemetry)')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث عن السائق…', 'Search driver…'), prefixIcon: const Icon(Icons.search), suffixText: '${filtered.length}'),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.badge_outlined, title: tr('لا يوجد سائقون', 'No drivers'))])
                          : ListView.separated(
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
