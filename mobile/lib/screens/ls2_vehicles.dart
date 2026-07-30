import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'ls2_vehicle_detail.dart';

/// مركبات لوكيشن سوليوشن — native: the live GPS fleet with maintenance state,
/// odometer, driver and search; maintenance chips filter the list.
class Ls2VehiclesScreen extends StatefulWidget {
  const Ls2VehiclesScreen({super.key});
  @override
  State<Ls2VehiclesScreen> createState() => _Ls2VehiclesScreenState();
}

class _Ls2VehiclesScreenState extends State<Ls2VehiclesScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _maint = '';
  Timer? _debounce;
  final _qCtrl = TextEditingController();
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
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final params = <String>[];
      if (_qCtrl.text.trim().isNotEmpty) params.add('q=${Uri.encodeComponent(_qCtrl.text.trim())}');
      if (_maint.isNotEmpty) params.add('maintenance=$_maint');
      final d = await Api.instance.get('/api/ls2/vehicles${params.isEmpty ? '' : '?${params.join('&')}'}');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['items'] ?? d['vehicles'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _onSearch(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () { setState(() => _loading = true); _load(); });
  }

  String _fmtKm(dynamic v) => v == null ? '—' : '${(v as num).round().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',')} ${tr('كم', 'km')}';

  @override
  Widget build(BuildContext context) {
    final overdue = _rows.where((v) => v['maintenanceStatus'] == 'overdue').length;
    final due = _rows.where((v) => v['maintenanceStatus'] == 'due').length;

    return AppScaffold(
      title: Text(tr('مركبات لوكيشن سوليوشن', 'LS Fleet')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
          child: TextField(
            controller: _qCtrl,
            onChanged: _onSearch,
            decoration: InputDecoration(
              hintText: tr('ابحث باللوحة أو السائق…', 'Search plate or driver…'),
              prefixIcon: const Icon(Icons.search),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
          child: Row(children: [
            FilterChip(
              selected: _maint == 'overdue',
              onSelected: (_) { setState(() { _maint = _maint == 'overdue' ? '' : 'overdue'; _loading = true; }); _load(); },
              label: Text(tr('صيانة متأخرة ($overdue)', 'Overdue ($overdue)')),
              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _maint == 'overdue' ? Colors.white : T.danger),
              selectedColor: T.danger,
              backgroundColor: T.danger.withValues(alpha: 0.1),
              checkmarkColor: Colors.white,
              side: BorderSide.none,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            ),
            const SizedBox(width: 6),
            FilterChip(
              selected: _maint == 'due',
              onSelected: (_) { setState(() { _maint = _maint == 'due' ? '' : 'due'; _loading = true; }); _load(); },
              label: Text(tr('صيانة قريبة ($due)', 'Due soon ($due)')),
              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _maint == 'due' ? Colors.white : T.warn),
              selectedColor: T.warn,
              backgroundColor: T.warn.withValues(alpha: 0.1),
              checkmarkColor: Colors.white,
              side: BorderSide.none,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            ),
          ]),
        ),
        Expanded(
          child: _loading
              ? ListView(padding: const EdgeInsets.all(14), children: const [
                  Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer(),
                ])
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? EmptyState(icon: Icons.local_shipping_outlined, title: tr('لا توجد مركبات مطابقة', 'No matching vehicles'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final v = _rows[i];
                                final maint = v['maintenanceStatus'] ?? 'ok';
                                final color = maint == 'overdue' ? T.danger : maint == 'due' ? T.warn : T.success;
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  child: Pressable(
                                    onTap: () => Navigator.push(c, MaterialPageRoute(
                                        builder: (_) => Ls2VehicleDetailScreen(
                                            vehicleId: (v['_id'] ?? '').toString(),
                                            plate: (v['plate'] ?? v['name'] ?? '').toString()))),
                                    child: AppCard(
                                    topAccent: color,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Text(v['name'] ?? v['plate'] ?? '', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                                        const SizedBox(width: 6),
                                        if (v['status'] == 'offline') const Icon(Icons.wifi_off_rounded, size: 15, color: T.danger),
                                        const Spacer(),
                                        Chip2(
                                          maint == 'overdue' ? tr('صيانة متأخرة', 'Overdue') : maint == 'due' ? tr('صيانة قريبة', 'Due soon') : tr('سليمة', 'OK'),
                                          color,
                                        ),
                                      ]),
                                      const SizedBox(height: 8),
                                      Wrap(spacing: 6, runSpacing: 6, children: [
                                        if (v['status'] == 'offline') Chip2(tr('غير متصلة', 'Offline'), T.danger, icon: Icons.wifi_off_rounded),
                                        if ((v['driver'] ?? '').toString().isNotEmpty) Chip2(v['driver'], T.inkSoft, icon: Icons.person_outline),
                                        Chip2('${tr('العداد', 'Odo')}: ${_fmtKm(v['odometerKm'])}', T.navy, icon: Icons.speed_outlined),
                                        if (v['kmToService'] != null)
                                          Chip2('${tr('للصيانة', 'To service')}: ${_fmtKm(v['kmToService'])}', color, icon: Icons.build_outlined),
                                        if ((v['nextServiceName'] ?? '').toString().isNotEmpty)
                                          Chip2(v['nextServiceName'], T.violet, icon: Icons.handyman_outlined),
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
