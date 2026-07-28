import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// لوحة الموارد البشرية — native: the headline numbers, department split and
/// the expiring-documents list, from the same endpoint the web dashboard uses.
class HrDashboardScreen extends StatefulWidget {
  const HrDashboardScreen({super.key});
  @override
  State<HrDashboardScreen> createState() => _HrDashboardScreenState();
}

class _HrDashboardScreenState extends State<HrDashboardScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/hr/dashboard');
      if (!mounted) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _d?['summary'] as Map<String, dynamic>?;
    final byDept = List<Map<String, dynamic>>.from(_d?['byDepartment'] ?? []);
    final docs = List<Map<String, dynamic>>.from(_d?['expiringDocs'] ?? []);

    return Scaffold(
      appBar: AppBar(title: Text(tr('لوحة الموارد البشرية', 'HR Dashboard'))),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 92), SizedBox(height: 10), Shimmer(height: 92), SizedBox(height: 10), Shimmer(height: 220),
            ])
          : _error != null || s == null
              ? ErrorRetry(message: _error ?? '—', onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(14),
                    children: [
                      Row(children: [
                        Expanded(child: FadeSlideIn(child: StatCard(label: tr('إجمالي الموظفين', 'Employees'), value: s['totalEmployees'] ?? 0, color: T.navy, icon: Icons.groups_outlined))),
                        const SizedBox(width: 10),
                        Expanded(child: FadeSlideIn(delayMs: 60, child: StatCard(label: tr('على رأس العمل', 'Active'), value: s['activeEmployees'] ?? 0, color: T.success, icon: Icons.task_alt_outlined))),
                      ]),
                      const SizedBox(height: 10),
                      Row(children: [
                        Expanded(child: FadeSlideIn(delayMs: 120, child: StatCard(label: tr('في إجازة', 'On leave'), value: s['onLeaveCount'] ?? 0, color: T.info, icon: Icons.beach_access_outlined))),
                        const SizedBox(width: 10),
                        Expanded(child: FadeSlideIn(delayMs: 160, child: StatCard(label: tr('إجازات قيد المراجعة', 'Pending leaves'), value: s['pendingLeaves'] ?? 0, color: T.warn, icon: Icons.hourglass_top_outlined))),
                        const SizedBox(width: 10),
                        Expanded(child: FadeSlideIn(delayMs: 200, child: StatCard(label: tr('طلبات مفتوحة', 'Open requests'), value: s['openRequests'] ?? 0, color: T.violet, icon: Icons.mark_email_unread_outlined))),
                      ]),
                      const SizedBox(height: 10),
                      Row(children: [
                        Expanded(child: FadeSlideIn(delayMs: 240, child: StatCard(label: tr('مستندات منتهية', 'Expired docs'), value: s['expiredDocsCount'] ?? 0, color: T.danger, icon: Icons.error_outline))),
                        const SizedBox(width: 10),
                        Expanded(child: FadeSlideIn(delayMs: 280, child: StatCard(label: tr('عهد بعهدة الموظفين', 'Assigned assets'), value: s['assignedAssets'] ?? 0, color: T.cyan, icon: Icons.devices_other_outlined))),
                      ]),
                      const SizedBox(height: 14),
                      // By department
                      FadeSlideIn(
                        delayMs: 320,
                        child: AppCard(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(tr('حسب القسم', 'By department'), style: const TextStyle(fontWeight: FontWeight.w800)),
                            const SizedBox(height: 12),
                            ...byDept.take(8).map((r) {
                              final max = byDept.fold<num>(1, (m, x) => (x['count'] ?? 0) > m ? x['count'] : m);
                              return Padding(
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
                                        valueColor: const AlwaysStoppedAnimation(T.navy),
                                      ),
                                    ),
                                  ),
                                  SizedBox(width: 40, child: Text('${r['count'] ?? 0}', textAlign: TextAlign.end, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800))),
                                ]),
                              );
                            }),
                          ]),
                        ),
                      ),
                      const SizedBox(height: 12),
                      // Expiring docs
                      FadeSlideIn(
                        delayMs: 380,
                        child: AppCard(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              const Icon(Icons.warning_amber_outlined, size: 18, color: T.warn),
                              const SizedBox(width: 6),
                              Text(tr('مستندات قاربت على الانتهاء', 'Expiring documents'), style: const TextStyle(fontWeight: FontWeight.w800)),
                              const Spacer(),
                              Chip2('${docs.length}', T.warn),
                            ]),
                            const SizedBox(height: 10),
                            ...docs.take(20).map((d) {
                              final expired = d['expired'] == true;
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 7),
                                child: Row(children: [
                                  Expanded(
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Text(d['employeeName'] ?? '', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis),
                                      Text('${d['docTypeLabel'] ?? d['docType'] ?? ''} · ${(d['expiry'] ?? '').toString().split('T').first}',
                                          style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                    ]),
                                  ),
                                  Chip2(expired ? tr('منتهية', 'Expired') : tr('قريبة', 'Soon'), expired ? T.danger : T.warn),
                                ]),
                              );
                            }),
                          ]),
                        ),
                      ),
                    ],
                  ),
                ),
    );
  }
}
