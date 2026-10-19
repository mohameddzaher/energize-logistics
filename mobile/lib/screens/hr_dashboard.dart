import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'hr_employee_profile.dart';
import 'hr_archive.dart';

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
    // تعديلُ الماستر أو ملفّ الموظّف أو بطاقةِ السائق من المركبات يصل هنا فورًا.
    Live.instance.on('hr:master', _onLive);
    Live.instance.on('hr:employee', _onLive);
  }

  void _onLive() => _load();

  @override
  void dispose() {
    Live.instance.off('hr:master', _onLive);
    Live.instance.off('hr:employee', _onLive);
    super.dispose();
  }

  Map<String, dynamic>? _m;

  /// كارتٌ برقمه، وتحته نصفاه: على الكفالة · فريلانسر (من «رقم السجل التجاري»).
  Widget _halfCard(String label, dynamic value, Map<String, dynamic> mt, String key, Color c,
      {String? sub, VoidCallback? onTap, void Function(String)? onHalf}) {
    final h = ((mt['halves'] as Map?)?[key] as Map?) ?? const {};
    Widget half(String k, String name) => Expanded(child: InkWell(
          onTap: onHalf == null ? null : () => onHalf(k),
          borderRadius: BorderRadius.circular(8),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
            decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(8)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(name, style: const TextStyle(fontSize: 10, color: T.inkFaint)),
              Text('${h[k] ?? 0}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: T.ink)),
            ]),
          ),
        ));
    return Pressable(
      onTap: onTap,
      child: AppCard(
        topAccent: c,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text('${value ?? 0}', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: c)),
            const SizedBox(width: 8),
            Expanded(child: Text(label, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.inkSoft))),
          ]),
          if (sub != null) Text(sub, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          const SizedBox(height: 6),
          Row(children: [half('sponsored', tr('على الكفالة', 'Sponsored')), const SizedBox(width: 6), half('freelance', tr('فريلانسر', 'Freelance'))]),
        ]),
      ),
    );
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/hr/dashboard');
      // كروتُ اللوحة بنصفيها (على الكفالة · فريلانسر) — من نظرة الموارد البشريّة نفسِها.
      Map<String, dynamic>? m;
      try { m = Map<String, dynamic>.from(await Api.instance.get('/api/hr/master/overview') as Map); } catch (_) {}
      if (!mounted) return;
      setState(() { _d = Map<String, dynamic>.from(d); _m = m; _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _d?['summary'] as Map<String, dynamic>?;
    final mt = (_m?['totals'] as Map?)?.cast<String, dynamic>();
    final byDept = List<Map<String, dynamic>>.from(_d?['byDepartment'] ?? []);
    final docs = List<Map<String, dynamic>>.from(_d?['expiringDocs'] ?? []);

    return AppScaffold(
      title: Text(tr('لوحة الموارد البشرية', 'HR Dashboard')),
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
                      // ── كروتُ الموقع بنصفيها: على الكفالة · فريلانسر ──
                      if (mt != null) ...[
                        const SizedBox(height: 10),
                        _halfCard(tr('يعمل', 'Working'), mt['active'], mt, 'active', T.success, onHalf: (k) {
                          final dd = ((mt['onDutyDetail'] as Map?)?[k] as Map?) ?? const {};
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(
                            '${k == 'sponsored' ? tr('على الكفالة', 'Sponsored') : tr('فريلانسر', 'Freelance')}: ${tr('يعمل', 'working')} ${dd['working'] ?? 0} · ${tr('إجازة', 'on leave')} ${dd['leave'] ?? 0}')));
                        }),
                        const SizedBox(height: 8),
                        _halfCard(tr('شركة شقيقة', 'Sister company'), mt['sister'], mt, 'sister', T.cyan),
                        const SizedBox(height: 8),
                        _halfCard(tr('لا يعمل — داخل النظام', 'Not working — in system'), mt['notActive'], mt, 'notActive', T.inkSoft,
                            sub: tr('ينتظر الخروج من النظام', 'awaiting system exit')),
                        const SizedBox(height: 8),
                        _halfCard(tr('لا يعمل — انتظار نقل الكفالة', 'Not working — awaiting transfer'), mt['transfer'], mt, 'transfer', T.warn),
                        const SizedBox(height: 8),
                        _halfCard(tr('لا يعمل — خروج نهائي', 'Not working — final exit'), mt['finalExit'], mt, 'finalExit', T.danger,
                            sub: ((mt['noKind'] ?? 0) as num) > 0 ? tr('و${mt['noKind']} بلا حالة', '+${mt['noKind']} with no status') : null),
                        const SizedBox(height: 8),
                        _halfCard(tr('الأرشيف', 'Archive'), mt['archived'], mt, 'archived', T.inkFaint,
                            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const HrArchiveScreen()))),
                      ],
                      // ── العقود التي تحتاج انتباهًا — مطابقٌ للوحة الموقع ──
                      if (((s['noContractCount'] ?? 0) as num) > 0 || ((s['lapsedContractsCount'] ?? 0) as num) > 0) ...[
                        const SizedBox(height: 10),
                        Row(children: [
                          Expanded(child: Pressable(
                            onTap: () => _showContractList(context, tr('موظفون بلا عقد مسجَّل', 'Employees with no contract'), List.from(_d?['noContract'] ?? const [])),
                            child: StatCard(label: tr('بلا عقد مسجَّل', 'No contract'), value: s['noContractCount'] ?? 0, color: T.danger, icon: Icons.description_outlined),
                          )),
                          const SizedBox(width: 10),
                          Expanded(child: Pressable(
                            onTap: () => _showContractList(context, tr('عقود منتهية لم تُجدَّد', 'Expired contracts, not renewed'), List.from(_d?['lapsedContracts'] ?? const [])),
                            child: StatCard(label: tr('عقود منتهية لم تُجدَّد', 'Expired, not renewed'), value: s['lapsedContractsCount'] ?? 0, color: T.warn, icon: Icons.event_busy_outlined),
                          )),
                        ]),
                      ],
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
                                      Text('${(Lang.instance.ar ? d['docAr'] : d['docEn']) ?? d['docType'] ?? ''} · ${bothDates(d['expiry'], ar: Lang.instance.ar, empty: '')}',
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

void _showContractList(BuildContext context, String title, List rows) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (c) => DraggableScrollableSheet(
      expand: false, initialChildSize: 0.7, maxChildSize: 0.92,
      builder: (c, scroll) => Column(children: [
        Padding(padding: const EdgeInsets.fromLTRB(16, 16, 16, 8), child: Row(children: [
          Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
          Chip2('${rows.length}', T.navy),
        ])),
        Expanded(child: ListView.separated(
          controller: scroll,
          padding: const EdgeInsets.fromLTRB(14, 0, 14, 20),
          itemCount: rows.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (c, i) {
            final e = Map<String, dynamic>.from(rows[i] as Map);
            final end = (e['endDate'] ?? '').toString();
            return ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: Text((e['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
              subtitle: Text([e['employeeNumber'], e['department'], e['jobTitle']].where((x) => x != null && x.toString().isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5)),
              trailing: end.length >= 10 ? Text(end.substring(0, 10).split('-').reversed.join('/'), style: const TextStyle(color: T.danger, fontWeight: FontWeight.w700, fontSize: 12)) : const Icon(Icons.chevron_left, size: 18),
              onTap: () => Navigator.push(c, MaterialPageRoute(builder: (_) => HrEmployeeProfileScreen(employeeId: e['_id'].toString()))),
            );
          },
        )),
      ]),
    ),
  );
}
