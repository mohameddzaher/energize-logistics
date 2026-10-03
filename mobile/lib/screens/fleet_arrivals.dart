import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// المتوقع للوصول — نظيرةُ `/system/fleet/arrivals`.
///
/// ── السؤالُ الذي تجيب عنه ───────────────────────────────────────────────────
/// «مَن يصل السبتَ في جدّة؟ وأيُّ السيارات ستكون فاضيةً وقتَها؟» — جوابان في
/// شاشةٍ واحدة، فمن لا تكفيه الواصلةُ يُكمل من الفاضية بلا تنقّل.
///
/// وبطاقاتُ الأرقام تُضغَط: كلُّ بطاقةٍ تُفرِد جدولَها وتُخفي ما سواه — وكانت
/// في الويب أرقامًا لا تؤدّي إلى شيء، و«مشغولة» بلا جدولٍ أصلًا.
class FleetArrivalsScreen extends StatefulWidget {
  const FleetArrivalsScreen({super.key});
  @override
  State<FleetArrivalsScreen> createState() => _FleetArrivalsScreenState();
}

class _FleetArrivalsScreenState extends State<FleetArrivalsScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;
  String _preset = 'next_7';
  String _city = '';
  String _focus = '';
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
      final qs = StringBuffer('preset=$_preset');
      if (_city.isNotEmpty) qs.write('&toCity=${Uri.encodeQueryComponent(_city)}');
      final d = await Api.instance.get('/api/fleet/arrivals?$qs');
      if (!mounted) return;
      setState(() { _data = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  List<Map<String, dynamic>> _list(String key) =>
      List<Map<String, dynamic>>.from((_data?[key] ?? []) as List);

  String _d(dynamic v) {
    final t = DateTime.tryParse((v ?? '').toString());
    if (t == null) return '—';
    final l = t.toLocal();
    return '${l.day}/${l.month} ${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final sum = Map<String, dynamic>.from(_data?['summary'] ?? {});
    final cities = List<Map<String, dynamic>>.from(_data?['byCity'] ?? []);

    Widget card(String key, String ar, String en, Color color, IconData icon) {
      final on = _focus == key && key.isNotEmpty;
      return Expanded(
        child: Padding(
          padding: const EdgeInsets.only(left: 6),
          child: GestureDetector(
            onTap: () => setState(() => _focus = _focus == key ? '' : key),
            child: Opacity(
              opacity: (_focus.isEmpty || on) ? 1 : 0.55,
              child: StatCard(label: tr(ar, en), value: (sum[key.isEmpty ? 'vehicles' : key] ?? 0) as num, color: color, icon: icon),
            ),
          ),
        ),
      );
    }

    Widget section(String key, String ar, String en, List<Map<String, dynamic>> rows, Widget Function(Map<String, dynamic>) row) {
      if (_focus.isNotEmpty && _focus != key) return const SizedBox.shrink();
      return Padding(
        padding: const EdgeInsets.only(top: 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text(tr(ar, en), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
            const SizedBox(width: 6),
            Chip2('${rows.length}', T.navy),
          ]),
          const SizedBox(height: 8),
          if (rows.isEmpty)
            Text(tr('لا شيء', 'Nothing'), style: const TextStyle(fontSize: 12, color: T.inkFaint))
          else
            ...rows.map(row),
        ]),
      );
    }

    return AppScaffold(
      title: Text(tr('المتوقع للوصول', 'Expected arrivals')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 70), SizedBox(height: 10), Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 120),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(children: [
                        for (final p in const [('today', 'اليوم', 'Today'), ('tomorrow', 'غدًا', 'Tomorrow'), ('next_7', '٧ أيام', '7 days'), ('next_30', '٣٠ يومًا', '30 days'), ('all', 'الكل', 'All')])
                          Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: _preset == p.$1,
                              onSelected: (_) => setState(() { _preset = p.$1; _loading = true; _load(); }),
                              label: Text(tr(p.$2, p.$3)),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _preset == p.$1 ? Colors.white : T.navy),
                              selectedColor: T.orange,
                              backgroundColor: T.navy.withValues(alpha: 0.08),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          ),
                      ]),
                    ),
                    const SizedBox(height: 10),
                    Row(children: [
                      card('arriving', 'متوقع وصولها', 'Arriving', T.orange, Icons.schedule_outlined),
                      card('noEta', 'بلا موعد', 'No ETA', T.warn, Icons.help_outline),
                    ]),
                    const SizedBox(height: 6),
                    Row(children: [
                      card('idle', 'فاضية', 'Idle', T.inkSoft, Icons.local_parking_outlined),
                      card('busy', 'مشغولة', 'Busy', T.success, Icons.local_shipping_outlined),
                    ]),
                    if (_focus.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(tr('يُعرَض جدولٌ واحد — اضغط البطاقةَ ثانيةً لعرض الكل.', 'One table shown — tap again to show all.'),
                            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: T.orange)),
                      ),
                    if (cities.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(children: [
                          const Icon(Icons.place_outlined, size: 16, color: T.orange),
                          const SizedBox(width: 4),
                          for (final c in cities)
                            Padding(
                              padding: const EdgeInsets.only(left: 6),
                              child: FilterChip(
                                selected: _city == c['city'],
                                onSelected: (_) => setState(() {
                                  _city = _city == c['city'] ? '' : (c['city'] ?? '').toString();
                                  _loading = true;
                                  _load();
                                }),
                                label: Text('${c['city']} ${c['n']}'),
                                labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _city == c['city'] ? Colors.white : T.navy),
                                selectedColor: T.orange,
                                backgroundColor: T.navy.withValues(alpha: 0.08),
                                checkmarkColor: Colors.white,
                                side: BorderSide.none,
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                              ),
                            ),
                        ]),
                      ),
                    ],

                    section('arriving', 'العربيات المتوقع وصولها', 'Trucks arriving', _list('arriving'), (s) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: AppCard(
                        topAccent: T.orange,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Text('${tr('بوليصة', 'WB')} ${s['waybillNumber']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const Spacer(),
                            Text((s['vehiclePlate'] ?? '').toString(), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                          ]),
                          const SizedBox(height: 4),
                          Text('${s['customerName'] ?? ''} · ${s['fromCity'] ?? ''} ← ${s['toCity'] ?? ''}', style: const TextStyle(fontSize: 12.5)),
                          const SizedBox(height: 4),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            Chip2('${tr('الوصول', 'ETA')} ${_d(s['expectedArrival'])}', T.navy, icon: Icons.schedule_outlined),
                            if ((s['driverName'] ?? '').toString().isNotEmpty) Chip2(s['driverName'].toString(), T.inkSoft, icon: Icons.person_outline),
                          ]),
                        ]),
                      ),
                    )),

                    section('noEta', 'سائرة بلا موعد وصول', 'On the road with no ETA', _list('noEta'), (s) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: AppCard(
                        topAccent: T.warn,
                        child: Text('${tr('بوليصة', 'WB')} ${s['waybillNumber']} · ${s['customerName'] ?? ''} · ${s['fromCity'] ?? ''} ← ${s['toCity'] ?? ''}',
                            style: const TextStyle(fontSize: 12.5)),
                      ),
                    )),

                    section('idle', 'السيارات الفاضية — بدون حمولة', 'Idle vehicles', _list('idle'), (v) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text((v['plate'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 4),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            if ((v['trailerType'] ?? '').toString().isNotEmpty) Chip2(v['trailerType'].toString(), T.navy),
                            if ((v['supervisorName'] ?? '').toString().isNotEmpty) Chip2(v['supervisorName'].toString(), T.inkSoft, icon: Icons.person_pin_circle_outlined),
                            if (List.from(v['drivers'] ?? []).isEmpty)
                              Chip2(tr('بدون سائق', 'No driver'), T.danger)
                            else
                              Chip2(List<Map<String, dynamic>>.from(v['drivers']).map((d) => d['name']).join(' · '), T.inkSoft, icon: Icons.badge_outlined),
                          ]),
                        ]),
                      ),
                    )),

                    section('busy', 'السيارات المشغولة — وعلى أي حمولة', 'Busy vehicles', _list('busyList'), (v) {
                      final t = (v['trip'] as Map?) ?? const {};
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: AppCard(
                          topAccent: T.success,
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Text((v['plate'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                              const Spacer(),
                              if (t['waybillNumber'] != null) Text('${tr('بوليصة', 'WB')} ${t['waybillNumber']}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                            ]),
                            if (t.isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Text('${t['customerName'] ?? ''} · ${t['fromCity'] ?? ''} ← ${t['toCity'] ?? ''}', style: const TextStyle(fontSize: 12.5)),
                              const SizedBox(height: 4),
                              Chip2('${tr('الوصول', 'ETA')} ${_d(t['expectedArrival'])}', T.navy, icon: Icons.schedule_outlined),
                            ],
                          ]),
                        ),
                      );
                    }),
                  ]),
                ),
    );
  }
}
