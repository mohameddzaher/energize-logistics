import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/hr_quick.dart';
import 'hr_employee_profile.dart';
import 'hr_inbox.dart';
import 'hr_master.dart';
import 'hr_ops.dart';

/// HR dashboard: native headline numbers, department split and expiring-documents list, from the same endpoint as the web dashboard.
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
    // A master edit, employee file edit or driver card edit from vehicles arrives here immediately.
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
  Map<String, dynamic>? _dept;
  Map<String, String> _filters = {};
  int _seq = 0;

  // Every number opens the rows behind it, carrying the dashboard filter.
  // "Identity" is the general group showing the employee's basic data (as on the web).
  void _open(String group, [Map<String, String> q = const {}]) => Navigator.push(context, MaterialPageRoute(
      builder: (_) => HrMasterGroupScreen(group: group, initial: {..._filters, ...q})));
  void _drill(Map<String, String> q) => _open('identity', q);
  /// Expiries under the current filter and the window the number was counted with (`alert.warnDays`).
  void _openExpiring([String? state]) {
    final wd = ((_m?['alert'] as Map?) ?? const {})['warnDays'];
    Navigator.push(context, MaterialPageRoute(builder: (_) => HrExpiringScreen(initial: {
      ..._filters, if (wd != null) 'withinDays': '$wd', if (state != null) 'state': state,
    })));
  }
  void _push(Widget w) => Navigator.push(context, MaterialPageRoute(builder: (_) => w));

  /// "Working" in its two halves: working and on leave, like the detail line on the web.
  void _dutyHalf(String half) {
    final dd = ((((_m?['totals'] as Map?) ?? const {})['onDutyDetail'] as Map?)?[half] as Map?) ?? const {};
    showModalBottomSheet(context: context, builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      ListTile(title: Text(half == 'sponsored' ? tr('على الكفالة', 'Sponsored') : tr('فريلانسر', 'Freelance'), style: const TextStyle(fontWeight: FontWeight.w800))),
      ListTile(leading: const Icon(Icons.work_outline, color: T.success), title: Text(tr('يعمل', 'Working')), trailing: Text('${dd['working'] ?? 0}'),
          onTap: () { Navigator.pop(c); _drill({'employment': 'working', 'engagement': half}); }),
      ListTile(leading: const Icon(Icons.beach_access_outlined, color: T.info), title: Text(tr('إجازة', 'On leave')), trailing: Text('${dd['leave'] ?? 0}'),
          onTap: () { Navigator.pop(c); _drill({'employment': 'leave', 'engagement': half}); }),
    ])));
  }

  /// Card with its number and two halves beneath: sponsored by us and freelancer (derived from the commercial registration number).
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
    final mine = ++_seq;
    try {
      // The dashboard filter (department, city, work status, project, nationality) is sent with both requests so every employee number is computed under it, like the web. See ui/hr_quick.dart.
      final q = [for (final e in _filters.entries) if (e.value.isNotEmpty) '${e.key}=${Uri.encodeComponent(e.value)}'].join('&');
      final qs = q.isEmpty ? '' : '?$q';
      final d = await Api.instance.get('/api/hr/dashboard$qs');
      // Dashboard cards with their two halves (sponsored by us, freelancer), from the same HR overview.
      Map<String, dynamic>? m;
      try { m = Map<String, dynamic>.from(await Api.instance.get('/api/hr/master/overview$qs') as Map); } catch (_) {}
      // Department analysis reads the same filter, so two numbers never come from two sets.
      Map<String, dynamic>? dep;
      try { dep = Map<String, dynamic>.from(await Api.instance.get('/api/hr/master/by-department$qs') as Map); } catch (_) {}
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d); _m = m; _dept = dep ?? _dept; _loading = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  /// Navigation bar between master pages, like MasterNav: the number is expired plus near-expiry.
  Widget _masterNav() {
    final groups = List<Map<String, dynamic>>.from(_m?['groups'] ?? const []);
    final scope = Map<String, dynamic>.from((_m?['expiryScope'] as Map?) ?? const {});
    final exp = ((_m?['totals'] as Map?) ?? const {})['expiringSoon'] ?? 0;
    Widget chip(String label, VoidCallback onTap, {int? count, IconData? icon}) => Padding(
          padding: const EdgeInsetsDirectional.only(end: 6),
          child: ActionChip(
            avatar: icon == null ? null : Icon(icon, size: 16, color: T.navy),
            label: Text(count == null ? label : '$label  $count', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: (count ?? 0) > 0 ? T.danger : T.ink)),
            onPressed: onTap,
          ),
        );
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(children: [
        chip(tr('الانتهاءات', 'Expiries'), () => _openExpiring(), count: (exp as num).toInt(), icon: Icons.event_busy_outlined),
        chip(tr('الماستر', 'Master grid'), () => _push(const HrMasterGridScreen()), icon: Icons.grid_on_outlined),
        for (final g in groups)
          chip(Lang.instance.ar ? '${g['ar']}' : '${g['en']}', () {
            final n = g['needsAttention'];
            Navigator.push(context, MaterialPageRoute(builder: (_) => HrMasterGroupScreen(group: '${g['key']}',
                initial: (n is num && n > 0) ? {'state': 'attention', for (final e in scope.entries) e.key: '${e.value}'} : const {})));
          }, count: g['needsAttention'] is num ? (g['needsAttention'] as num).toInt() : null),
        chip(tr('العهد', 'Custody'), () => _push(const HrCustodyScreen()), icon: Icons.devices_other_outlined),
        chip(tr('الإعدادات', 'Settings'), () => _push(const HrSettingsScreen()), icon: Icons.settings_outlined),
      ]),
    );
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
                      // Quick filtering: every number below is computed under it.
                      AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(tr('فلترة اللوحة — كل الأرقام تتعدّل حسب اختيارك', 'Filter — every number follows your choice'),
                            style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.inkFaint)),
                        const SizedBox(height: 6),
                        HrQuickFilters(value: _filters, onChanged: (v) { setState(() => _filters = v); _load(); }),
                      ])),
                      const SizedBox(height: 8),
                      _masterNav(),
                      const SizedBox(height: 10),
                      Row(children: [
                        Expanded(child: FadeSlideIn(child: Pressable(onTap: () => _open('identity'), child: StatCard(label: tr('إجمالي الموظفين', 'Employees'), value: mt?['employees'] ?? s['totalEmployees'] ?? 0, color: T.navy, icon: Icons.groups_outlined)))),
                        const SizedBox(width: 10),
                        Expanded(child: FadeSlideIn(delayMs: 60, child: Pressable(onTap: () => _drill({'employment': 'working'}), child: StatCard(label: tr('على رأس العمل', 'Active'), value: s['activeEmployees'] ?? 0, color: T.success, icon: Icons.task_alt_outlined)))),
                      ]),
                      const SizedBox(height: 10),
                      Row(children: [
                        Expanded(child: FadeSlideIn(delayMs: 120, child: StatCard(label: tr('في إجازة', 'On leave'), value: s['onLeaveCount'] ?? 0, color: T.info, icon: Icons.beach_access_outlined))),
                        const SizedBox(width: 10),
                        Expanded(child: FadeSlideIn(delayMs: 160, child: Pressable(onTap: () => _push(const HrLeavesScreen()), child: StatCard(label: tr('إجازات قيد المراجعة', 'Pending leaves'), value: s['pendingLeaves'] ?? 0, color: T.warn, icon: Icons.hourglass_top_outlined)))),
                        const SizedBox(width: 10),
                        Expanded(child: FadeSlideIn(delayMs: 200, child: Pressable(onTap: () => _push(const HrRequestsScreen()), child: StatCard(label: tr('طلبات مفتوحة', 'Open requests'), value: s['openRequests'] ?? 0, color: T.violet, icon: Icons.mark_email_unread_outlined)))),
                      ]),
                      const SizedBox(height: 10),
                      Row(children: [
                        Expanded(child: FadeSlideIn(delayMs: 240, child: Pressable(onTap: () => _openExpiring('expired'), child: StatCard(label: tr('مستندات منتهية', 'Expired docs'), value: s['expiredDocsCount'] ?? 0, color: T.danger, icon: Icons.error_outline)))),
                        const SizedBox(width: 10),
                        Expanded(child: FadeSlideIn(delayMs: 280, child: Pressable(onTap: () => _push(const HrCustodyScreen()), child: StatCard(label: tr('عهد بعهدة الموظفين', 'Assigned assets'), value: s['assignedAssets'] ?? 0, color: T.cyan, icon: Icons.devices_other_outlined)))),
                      ]),
                      // Web cards with their two halves: sponsored by us and freelancer.
                      if (mt != null) ...[
                        const SizedBox(height: 10),
                        _halfCard(tr('يعمل', 'Working'), mt['active'], mt, 'active', T.success,
                            onTap: () => _drill({'employment': 'working'}), onHalf: _dutyHalf),
                        const SizedBox(height: 8),
                        _halfCard(tr('لا يعمل — داخل النظام', 'Not working — in system'), mt['noKind'], mt, 'noKind', T.inkSoft,
                            sub: tr('بلا حالة محدّدة · ينتظر الخروج من النظام', 'no status set · awaiting system exit'),
                            onTap: () => _drill({'employment': 'nokind'}), onHalf: (k) => _drill({'employment': 'nokind', 'engagement': k})),
                        const SizedBox(height: 8),
                        _halfCard(tr('لا يعمل — انتظار نقل الكفالة', 'Not working — awaiting transfer'), mt['transfer'], mt, 'transfer', T.warn,
                            onTap: () => _open('iqama', {'employment': 'transfer'}), onHalf: (k) => _open('iqama', {'employment': 'transfer', 'engagement': k})),
                        const SizedBox(height: 8),
                        _halfCard(tr('لا يعمل — خروج نهائي', 'Not working — final exit'), mt['finalExit'], mt, 'finalExit', T.danger,
                            onTap: () => _drill({'employment': 'final_exit'}), onHalf: (k) => _drill({'employment': 'final_exit', 'engagement': k})),
                        const SizedBox(height: 8),
                        _halfCard(tr('لا يعمل — نهاية خدمة (سعودي)', 'Not working — end of service (Saudi)'), mt['saudiEnd'], mt, 'saudiEnd', T.violet,
                            onTap: () => _drill({'employment': 'saudi_end'}), onHalf: (k) => _drill({'employment': 'saudi_end', 'engagement': k})),
                        const SizedBox(height: 8),
                        _halfCard(tr('شركة شقيقة', 'Sister company'), mt['sister'], mt, 'sister', T.cyan,
                            onTap: () => _drill({'employment': 'sister'}), onHalf: (k) => _drill({'employment': 'sister', 'engagement': k})),
                        // The five parts sum to the total employees; stated explicitly.
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text(tr('المجموع ${((mt['active'] ?? 0) as num) + ((mt['noKind'] ?? 0) as num) + ((mt['transfer'] ?? 0) as num) + ((mt['finalExit'] ?? 0) as num) + ((mt['saudiEnd'] ?? 0) as num) + ((mt['sister'] ?? 0) as num)} = إجمالي الموظفين ${mt['employees'] ?? 0}',
                              'Sum = total employees ${mt['employees'] ?? 0}'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                        ),
                        const Divider(height: 20),
                        // The archive is not here; it has its own page in the HR section.
                        _halfCard(tr('خانات مطلوبة', 'Required fields'), mt['required'], mt, 'required', T.danger,
                            onTap: () => _open('required', {'status': 'required'}), onHalf: (k) => _open('required', {'status': 'required', 'engagement': k})),
                        const SizedBox(height: 8),
                        _halfCard(tr('مستندات منتهية أو قريبة الانتهاء', 'Expired or expiring documents'), mt['expiringSoon'], mt, 'expiringSoon', const Color(0xFFEA580C),
                            onTap: () => _openExpiring()),
                        if (mt['expiringStates'] is Map)
                          Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Wrap(spacing: 6, children: [
                              for (final k in const ['expired', 'critical', 'warning'])
                                ActionChip(
                                  label: Text('${hrStateLabel(k)} ${(mt['expiringStates'] as Map)[k] ?? 0}', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: hrStateColor(k))),
                                  onPressed: () => _openExpiring(k),
                                ),
                            ]),
                          ),
                        const SizedBox(height: 8),
                        _halfCard(tr('مسجّل بالتأمينات', 'GOSI registered'), mt['gosiRegistered'], mt, 'gosiRegistered', T.info,
                            onTap: () => _open('socialInsurance', {'field': 'gosiNumber', 'status': 'filled'}),
                            onHalf: (k) => _open('socialInsurance', {'field': 'gosiNumber', 'status': 'filled', 'engagement': k})),
                        const SizedBox(height: 8),
                        _halfCard(tr('خارج المملكة', 'Outside kingdom'), mt['outsideKingdom'], mt, 'outsideKingdom', T.inkSoft,
                            onTap: () => _drill({'outsideKingdom': '1'}), onHalf: (k) => _drill({'outsideKingdom': '1', 'engagement': k})),
                        const SizedBox(height: 8),
                        Pressable(onTap: () => _drill({'engagement': 'freelance'}),
                            child: StatCard(label: tr('فريلانسر', 'Freelancers'), value: mt['freelancers'] ?? 0, color: T.ink, icon: Icons.work_outline)),
                      ],
                      // Contracts needing attention, matching the web dashboard.
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
                      // Department analysis: which departments are worst.
                      if (_dept != null && (_dept!['departments'] as List? ?? const []).isNotEmpty) ...[
                        const SizedBox(height: 14),
                        HrDeptAnalysis(
                          data: _dept!,
                          active: _filters['department'] ?? '',
                          onOpen: _drill,
                          onFilter: (dept) {
                            // A second tap on the same department lifts the restriction.
                            setState(() { if (_filters['department'] == dept) { _filters.remove('department'); } else { _filters = {..._filters, 'department': dept}; } });
                            _load();
                          },
                        ),
                      ],
                      // Start here: the most incomplete data.
                      if ((_m?['topRequired'] as List? ?? const []).isNotEmpty) ...[
                        const SizedBox(height: 12),
                        AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('ابدأ من هنا — أكثر البيانات نقصًا', 'Start here — most missing'), style: const TextStyle(fontWeight: FontWeight.w800)),
                          const SizedBox(height: 8),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            for (final f in List<Map<String, dynamic>>.from(_m!['topRequired']))
                              ActionChip(
                                backgroundColor: T.danger.withValues(alpha: 0.06),
                                label: Text('${f['required']} · ${Lang.instance.ar ? f['ar'] : f['en']} (${f['groupAr'] ?? ''})', style: const TextStyle(fontSize: 11.5, color: T.danger, fontWeight: FontWeight.w700)),
                                onPressed: () => _open('${f['groupKey']}', {'field': '${f['key']}', 'status': 'required'}),
                              ),
                          ]),
                        ])),
                      ],
                      // Documents and their expiry dates; each group's states open their rows.
                      if ((_m?['groups'] as List? ?? const []).any((g) => (g as Map)['document'] == true)) ...[
                        const SizedBox(height: 12),
                        AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('المستندات ومواعيد انتهائها', 'Documents and their expiry'), style: const TextStyle(fontWeight: FontWeight.w800)),
                          for (final g in List<Map<String, dynamic>>.from(_m!['groups']).where((g) => g['document'] == true))
                            Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                InkWell(onTap: () => _open('${g['key']}'), child: Text(Lang.instance.ar ? '${g['ar']}' : '${g['en']}', style: const TextStyle(fontWeight: FontWeight.w700, color: T.navy))),
                                Wrap(spacing: 6, runSpacing: 4, children: [
                                  for (final k in const ['expired', 'critical', 'warning', 'valid', 'missing'])
                                    if ((((g['states'] as Map?) ?? const {})[k] ?? 0) as num > 0)
                                      ActionChip(
                                        visualDensity: VisualDensity.compact,
                                        label: Text('${hrStateLabel(k)} ${(g['states'] as Map)[k]}', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: hrStateColor(k))),
                                        onPressed: () => _open('${g['key']}', {
                                          for (final e in ((_m?['expiryScope'] as Map?) ?? const {}).entries) '${e.key}': '${e.value}',
                                          'state': k,
                                        }),
                                      ),
                                ]),
                              ]),
                            ),
                        ])),
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
