import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/vehicle_month_log.dart';

/// سجلّات السيارات — الشهرُ كلُّه لكلّ سيّارة، ثمّ السجلُّ الكامل لمن تُختار.
///
/// السؤال الذي لم تكن له شاشة: «ماذا جرى لهذه السيّارة الشهر الماضي؟» — كانت
/// إجابتُه مبعثرةً في متابعات ستّ شحنات، ولا موضعَ يجمعها.
class FleetVehicleLogsScreen extends StatefulWidget {
  const FleetVehicleLogsScreen({super.key});
  @override
  State<FleetVehicleLogsScreen> createState() => _FleetVehicleLogsScreenState();
}

const _editRoles = {
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'operations_manager', 'operations_staff', 'moderator',
  'fleet_manager', 'fleet_supervisor',
};

class _FleetVehicleLogsScreenState extends State<FleetVehicleLogsScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  String _month = monthKeyNow();
  String _plate = '';
  String _search = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  String _shift(String mk, int by) {
    final p = mk.split('-');
    final d = DateTime.utc(int.parse(p[0]), int.parse(p[1]) + by, 1);
    return '${d.year}-${d.month.toString().padLeft(2, '0')}';
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/fleet/vehicle-logs/summary?month=$_month');
      if (!mounted) return;
      setState(() { _d = Map<String, dynamic>.from(d as Map); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  num _n(dynamic v) => v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  String _money(dynamic v) => _n(v).toStringAsFixed(0)
      .replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');

  @override
  Widget build(BuildContext context) {
    final canEdit = _editRoles.contains(context.watch<AuthProvider>().role);
    final rows = List<Map<String, dynamic>>.from(
        (_d?['rows'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)))
      .where((r) {
        if (_search.trim().isEmpty) return true;
        final s = _search.trim().toLowerCase();
        return ['plate', 'name', 'supervisorName', 'trailerType']
            .any((k) => (r[k] ?? '').toString().toLowerCase().contains(s));
      }).toList();
    final closed = _d?['closed'] == true;

    return AppScaffold(
      title: Text(tr('سجلّات السيارات', 'Vehicle Logs')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 220)])
          : _error != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!)))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    AppCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          IconButton(
                            icon: const Icon(Icons.chevron_right, color: T.navy),
                            onPressed: () { setState(() { _month = _shift(_month, -1); _loading = true; }); _load(); },
                          ),
                          Expanded(
                            child: Center(
                              child: Text(_month, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.chevron_left, color: T.navy),
                            onPressed: () { setState(() { _month = _shift(_month, 1); _loading = true; }); _load(); },
                          ),
                        ]),
                        if (closed)
                          Row(children: [
                            const Icon(Icons.lock_outline, size: 14, color: T.inkFaint),
                            const SizedBox(width: 4),
                            Text(tr('هذا الشهر مقفل — للقراءة فقط', 'This month is closed — read only'),
                                style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                          ]),
                        const SizedBox(height: 8),
                        TextField(
                          onChanged: (v) => setState(() => _search = v),
                          decoration: InputDecoration(
                            isDense: true,
                            prefixIcon: const Icon(Icons.search, size: 18),
                            hintText: tr('ابحث بلوحة أو مشرف', 'Search plate or supervisor'),
                          ),
                        ),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    ...rows.map((r) {
                      final plate = (r['plate'] ?? '').toString();
                      final selected = plate == _plate;
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(16),
                          onTap: () => setState(() => _plate = selected ? '' : plate),
                          child: AppCard(
                          topAccent: selected ? T.orange : null,
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Expanded(
                                child: Text(plate, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                              ),
                              if (_n(r['breakdowns']) > 0) Chip2('${r['breakdowns']} ${tr('عطل', 'brk')}', T.danger),
                              const SizedBox(width: 6),
                              Chip2('${r['loads']} ${tr('حمولة', 'loads')}', T.navy),
                            ]),
                            const SizedBox(height: 6),
                            Wrap(spacing: 12, runSpacing: 2, children: [
                              Text('${tr('الدخل', 'Income')} ${_money(r['income'])}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                              Text('${tr('الصافي', 'Net')} ${_money(r['net'])}',
                                  style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: _n(r['net']) >= 0 ? T.success : T.danger)),
                              if ((r['supervisorName'] ?? '').toString().isNotEmpty)
                                Text('${r['supervisorName']}', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                            ]),
                          ]),
                          ),
                        ),
                      );
                    }),
                    if (rows.isEmpty)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 30),
                        child: Center(child: Text(tr('لا سيارات في هذه الفترة.', 'No vehicles in this period.'),
                            style: const TextStyle(color: T.inkFaint))),
                      ),
                    if (_plate.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      VehicleMonthLog(vehicle: _plate, month: _month, canEdit: canEdit),
                    ],
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }
}
