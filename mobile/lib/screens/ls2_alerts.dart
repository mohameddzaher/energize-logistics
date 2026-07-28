import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// تنبيهات لوكيشن سوليوشن — the telemetry alerts feed with severity/type
/// filters, live over ls2:updated.
class Ls2AlertsScreen extends StatefulWidget {
  const Ls2AlertsScreen({super.key});
  @override
  State<Ls2AlertsScreen> createState() => _Ls2AlertsScreenState();
}

const _severities = {
  'critical': ('حرجة', 'Critical', T.danger),
  'warning': ('تحذير', 'Warning', T.warn),
  'info': ('معلومة', 'Info', T.info),
};

class _Ls2AlertsScreenState extends State<Ls2AlertsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _severity = '';
  String _status = 'open';
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
      final params = ['status=$_status', if (_severity.isNotEmpty) 'severity=$_severity'];
      final d = await Api.instance.get('/api/ls2/alerts?${params.join('&')}');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['items'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _dt(dynamic v) {
    final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
    return d == null ? '—' : '${d.day}/${d.month} ${d.hour}:${d.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('تنبيهات المركبات', 'Fleet Alerts')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              FilterChip(
                selected: _status == 'open',
                onSelected: (_) { setState(() { _status = _status == 'open' ? 'all' : 'open'; _loading = true; }); _load(); },
                label: Text(tr('المفتوحة فقط', 'Open only')),
                labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _status == 'open' ? Colors.white : T.navy),
                selectedColor: T.navy,
                backgroundColor: T.navy.withValues(alpha: 0.08),
                checkmarkColor: Colors.white,
                side: BorderSide.none,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
              ),
              const SizedBox(width: 6),
              ..._severities.entries.map((e) {
                final selected = _severity == e.key;
                return Padding(
                  padding: const EdgeInsets.only(left: 6),
                  child: FilterChip(
                    selected: selected,
                    onSelected: (_) { setState(() { _severity = selected ? '' : e.key; _loading = true; }); _load(); },
                    label: Text(tr(e.value.$1, e.value.$2)),
                    labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : e.value.$3),
                    selectedColor: e.value.$3,
                    backgroundColor: e.value.$3.withValues(alpha: 0.1),
                    checkmarkColor: Colors.white,
                    side: BorderSide.none,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                  ),
                );
              }),
            ]),
          ),
        ),
        Expanded(
          child: _loading
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.notifications_off_outlined, title: tr('لا توجد تنبيهات 👌', 'No alerts 👌'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final a = _rows[i];
                                final sev = _severities[a['severity']] ?? _severities['info']!;
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  child: AppCard(
                                    topAccent: sev.$3,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text((a['title'] ?? a['type'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                        Chip2(tr(sev.$1, sev.$2), sev.$3),
                                      ]),
                                      if ((a['message'] ?? '').toString().isNotEmpty) ...[
                                        const SizedBox(height: 4),
                                        Text(a['message'], style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                                      ],
                                      const SizedBox(height: 6),
                                      Wrap(spacing: 6, runSpacing: 6, children: [
                                        if ((a['plate'] ?? a['vehicleName'] ?? '').toString().isNotEmpty)
                                          Chip2((a['plate'] ?? a['vehicleName']).toString(), T.navy, icon: Icons.local_shipping_outlined),
                                        Chip2(_dt(a['createdAt'] ?? a['at']), T.inkFaint, icon: Icons.schedule_outlined),
                                      ]),
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
