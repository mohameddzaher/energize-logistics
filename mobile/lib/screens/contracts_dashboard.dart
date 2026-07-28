import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// لوحة إدارة العقود — native: the contracted base, distributions and the
/// missing-documents alerts, computed live by the same endpoint the web uses.
class ContractsDashboardScreen extends StatefulWidget {
  const ContractsDashboardScreen({super.key});
  @override
  State<ContractsDashboardScreen> createState() => _ContractsDashboardScreenState();
}

class _ContractsDashboardScreenState extends State<ContractsDashboardScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('contracts:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('contracts:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/contracts/dashboard');
      if (!mounted) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = _d?['vendors'] as Map<String, dynamic>?;
    return AppScaffold(
      title: Text(tr('لوحة إدارة العقود', 'Contracts Dashboard')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 92), SizedBox(height: 10), Shimmer(height: 180), SizedBox(height: 10), Shimmer(height: 180),
            ])
          : _error != null || v == null
              ? ErrorRetry(message: _error ?? '—', onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(14),
                    children: [
                      Row(children: [
                        Expanded(child: FadeSlideIn(child: StatCard(label: tr('موردون موقّعون', 'Signed vendors'), value: v['signed'] ?? 0, color: T.success, icon: Icons.verified_outlined))),
                        const SizedBox(width: 10),
                        Expanded(child: FadeSlideIn(delayMs: 60, child: StatCard(label: tr('الأسطول المتعاقد', 'Contracted fleet'), value: v['signedFleet'] ?? 0, color: T.cyan, icon: Icons.local_shipping_outlined))),
                      ]),
                      const SizedBox(height: 10),
                      Row(children: [
                        Expanded(child: FadeSlideIn(delayMs: 120, child: StatCard(label: tr('إجمالي الموردين', 'All vendors'), value: v['total'] ?? 0, color: T.navy, icon: Icons.business_outlined))),
                        const SizedBox(width: 10),
                        Expanded(child: FadeSlideIn(delayMs: 180, child: StatCard(label: tr('مستندات ناقصة', 'Missing docs'), value: (v['missingDocs'] as List?)?.length ?? 0, color: T.danger, icon: Icons.warning_amber_outlined))),
                      ]),
                      const SizedBox(height: 16),
                      _barsCard(tr('التوزيع الجغرافي للعقود', 'Signed by headquarters'), Icons.location_on_outlined,
                          List<Map<String, dynamic>>.from(v['byHq'] ?? []).take(8).toList(), T.cyan),
                      const SizedBox(height: 12),
                      _barsCard(tr('توزيع العقود على المناديب', 'Signed by rep'), Icons.support_agent_outlined,
                          List<Map<String, dynamic>>.from(v['byRep'] ?? []).take(8).toList(), T.violet),
                      const SizedBox(height: 12),
                      // Missing docs alerts
                      AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            const Icon(Icons.warning_amber_outlined, size: 18, color: T.danger),
                            const SizedBox(width: 6),
                            Text(tr('موقّعون بمستندات ناقصة', 'Signed with missing documents'), style: const TextStyle(fontWeight: FontWeight.w800)),
                          ]),
                          const SizedBox(height: 10),
                          if ((v['missingDocs'] as List?)?.isEmpty ?? true)
                            Text(tr('كل الملفات المستندية مكتملة ✅', 'All document files complete ✅'), style: const TextStyle(color: T.inkSoft, fontSize: 13)),
                          ...List<Map<String, dynamic>>.from(v['missingDocs'] ?? []).take(8).map((m) => Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: T.danger.withValues(alpha: 0.05),
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(color: T.danger.withValues(alpha: 0.15)),
                                  ),
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text(m['name'] ?? '', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                                    Text(
                                      '${(m['missingDocuments'] ?? '').toString().isNotEmpty ? m['missingDocuments'] : tr('مستندات غير مستلمة', 'documents pending')}'
                                      '${(m['energizeRep'] ?? '').toString().isNotEmpty ? ' — ${tr('المندوب', 'rep')}: ${m['energizeRep']}' : ''}',
                                      style: const TextStyle(fontSize: 12, color: T.inkSoft),
                                    ),
                                  ]),
                                ),
                              )),
                        ]),
                      ),
                    ],
                  ),
                ),
    );
  }

  Widget _barsCard(String title, IconData icon, List<Map<String, dynamic>> rows, Color color) {
    final max = rows.fold<num>(1, (m, r) => (r['count'] ?? 0) > m ? r['count'] : m);
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 6),
          Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
        ]),
        const SizedBox(height: 12),
        ...rows.map((r) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(children: [
                SizedBox(width: 90, child: Text(r['name'] ?? '—', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis)),
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: LinearProgressIndicator(
                      value: (r['count'] ?? 0) / max,
                      minHeight: 12,
                      backgroundColor: const Color(0xFFF1F5F9),
                      valueColor: AlwaysStoppedAnimation(color),
                    ),
                  ),
                ),
                SizedBox(width: 34, child: Text('${r['count'] ?? 0}', textAlign: TextAlign.end, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800))),
              ]),
            )),
      ]),
    );
  }
}
