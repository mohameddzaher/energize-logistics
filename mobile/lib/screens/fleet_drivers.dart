import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// سائقو الأسطول — native list: working state, sponsorship, vehicle, search.
class FleetDriversScreen extends StatefulWidget {
  const FleetDriversScreen({super.key});
  @override
  State<FleetDriversScreen> createState() => _FleetDriversScreenState();
}

class _FleetDriversScreenState extends State<FleetDriversScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
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
      final d = await Api.instance.get('/api/fleet/drivers');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['drivers'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((r) {
      if (q.isEmpty) return true;
      final plate = r['vehicle'] is Map ? (r['vehicle']['plate'] ?? '') : '';
      return [r['name'], r['phone'], r['iqama'], plate].any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    final working = filtered.where((r) => r['working'] != false).length;

    return Scaffold(
      appBar: AppBar(title: Text(tr('سائقو الأسطول', 'Fleet Drivers'))),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer(),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(
                        hintText: tr('ابحث بالاسم أو الجوال أو اللوحة…', 'Search name, phone, plate…'),
                        prefixIcon: const Icon(Icons.search),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    child: Row(children: [
                      Chip2(tr('يعمل: $working', 'Working: $working'), T.success),
                      const SizedBox(width: 6),
                      Chip2(tr('متوقف: ${filtered.length - working}', 'Off: ${filtered.length - working}'), T.inkFaint),
                    ]),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? EmptyState(icon: Icons.badge_outlined, title: tr('لا يوجد سائقون مطابقون', 'No matching drivers'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final r = filtered[i];
                                final workingNow = r['working'] != false;
                                final plate = r['vehicle'] is Map ? (r['vehicle']['plate'] ?? '') : '';
                                return FadeSlideIn(
                                  delayMs: (i * 20).clamp(0, 200),
                                  child: AppCard(
                                    child: Row(children: [
                                      Container(
                                        width: 42, height: 42,
                                        decoration: BoxDecoration(
                                          color: (workingNow ? T.success : T.inkFaint).withValues(alpha: 0.12),
                                          borderRadius: BorderRadius.circular(12),
                                        ),
                                        child: Icon(Icons.person_outline, color: workingNow ? T.success : T.inkFaint, size: 21),
                                      ),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                          Text(r['name'] ?? '', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                                          Text(
                                            [if (plate.toString().isNotEmpty) plate, if ((r['phone'] ?? '').toString().isNotEmpty) r['phone']].join(' · '),
                                            style: const TextStyle(fontSize: 12, color: T.inkSoft),
                                            textDirection: TextDirection.ltr,
                                          ),
                                        ]),
                                      ),
                                      Chip2(
                                        workingNow ? tr('يعمل', 'Working') : tr('متوقف', 'Off'),
                                        workingNow ? T.success : T.inkFaint,
                                      ),
                                    ]),
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
