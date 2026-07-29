import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// ملفي — بطاقة الموظف الشخصية لكل مستخدم مرتبط بملف موظف: بياناته،
/// عقده النشط ورصيد إجازاته، آخر إجازاته، وعهده — عرض ذاتي من /api/hr/me/profile.
class MyProfileScreen extends StatefulWidget {
  const MyProfileScreen({super.key});
  @override
  State<MyProfileScreen> createState() => _MyProfileScreenState();
}

List<Map<String, dynamic>> _l(dynamic v) =>
    v is List ? List<Map<String, dynamic>>.from(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : const [];

String _d(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? (v ?? '—').toString() : '${d.day}/${d.month}/${d.year}';
}

class _MyProfileScreenState extends State<MyProfileScreen> {
  Map<String, dynamic>? _d0;
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/hr/me/profile');
      if (!mounted) return;
      setState(() { _d0 = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final emp = _d0?['employee'] is Map ? Map<String, dynamic>.from(_d0!['employee']) : null;
    final contract = _d0?['activeContract'] is Map ? Map<String, dynamic>.from(_d0!['activeContract']) : null;
    final balance = _d0?['balance'] is Map ? Map<String, dynamic>.from(_d0!['balance']) : {};
    final leaves = _l(_d0?['leaves']);
    final assets = _l(_d0?['assets']);

    return AppScaffold(
      title: Text(tr('ملفي', 'My Profile')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 130), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : emp == null
                  ? EmptyState(icon: Icons.badge_outlined, title: tr('حسابك غير مرتبط بملف موظف', 'Your account is not linked to an employee'))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(padding: const EdgeInsets.all(14), children: [
                        FadeSlideIn(
                          child: AppCard(
                            topAccent: T.navy,
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [
                                CircleAvatar(radius: 24, backgroundColor: T.navy.withValues(alpha: 0.1),
                                    child: Text((emp['arabicName'] ?? emp['firstName'] ?? '؟').toString().characters.first, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 20, color: T.navy))),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text((emp['arabicName'] ?? '${emp['firstName'] ?? ''} ${emp['lastName'] ?? ''}').toString().trim(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                                    if ((emp['jobTitle'] ?? '').toString().isNotEmpty) Text(emp['jobTitle'].toString(), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                                  ]),
                                ),
                              ]),
                              const SizedBox(height: 10),
                              Wrap(spacing: 6, runSpacing: 6, children: [
                                if ((emp['department'] ?? '').toString().isNotEmpty) Chip2(emp['department'].toString(), T.navy, icon: Icons.apartment_outlined),
                                if ((emp['employeeNumber'] ?? '').toString().isNotEmpty) Chip2('${tr('رقم', 'No.')} ${emp['employeeNumber']}', T.inkFaint),
                                if ((emp['mobileNumber'] ?? emp['phone'] ?? '').toString().isNotEmpty) Chip2((emp['mobileNumber'] ?? emp['phone']).toString(), T.cyan, icon: Icons.phone_outlined),
                                if ((emp['nationality'] ?? '').toString().isNotEmpty) Chip2(emp['nationality'].toString(), T.violet),
                              ]),
                            ]),
                          ),
                        ),
                        const SizedBox(height: 12),
                        // رصيد الإجازات + العقد
                        Row(children: [
                          Expanded(child: StatCard(label: tr('رصيد الإجازات', 'Leave balance'), value: ((balance['available'] ?? 0) as num), color: T.cyan, icon: Icons.beach_access_outlined)),
                          const SizedBox(width: 10),
                          Expanded(child: StatCard(label: tr('مأخوذة', 'Taken'), value: ((balance['taken'] ?? 0) as num), color: T.orange, icon: Icons.event_busy_outlined)),
                        ]),
                        if (contract != null) ...[
                          const SizedBox(height: 12),
                          FadeSlideIn(
                            child: AppCard(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(tr('العقد النشط', 'Active contract'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                                const SizedBox(height: 8),
                                Wrap(spacing: 6, runSpacing: 6, children: [
                                  Chip2(contract['type'] == 'unlimited' ? tr('غير محدد', 'Unlimited') : tr('محدد المدة', 'Fixed-term'), T.navy),
                                  Chip2('${_d(contract['startDate'])}${contract['endDate'] != null ? ' ← ${_d(contract['endDate'])}' : ''}', T.info, icon: Icons.event),
                                  if (contract['basicSalary'] != null) Chip2('${tr('الأساسي', 'Basic')}: ${contract['basicSalary']}', T.success),
                                  if (contract['annualLeaveDays'] != null) Chip2('${tr('إجازة سنوية', 'Annual')}: ${contract['annualLeaveDays']} ${tr('يوم', 'd')}', T.violet),
                                ]),
                              ]),
                            ),
                          ),
                        ],
                        if (assets.isNotEmpty) ...[
                          const SizedBox(height: 12),
                          Text('${tr('عهدي', 'My custody')} (${assets.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                          const SizedBox(height: 8),
                          ...assets.map((a) => Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: AppCard(
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                              child: Row(children: [
                                const Icon(Icons.devices_other_outlined, size: 18, color: T.navy),
                                const SizedBox(width: 10),
                                Expanded(child: Text((a['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                                if ((a['serialNumber'] ?? '').toString().isNotEmpty) Chip2(a['serialNumber'].toString(), T.inkFaint),
                              ]),
                            ),
                          )),
                        ],
                        if (leaves.isNotEmpty) ...[
                          const SizedBox(height: 12),
                          Text('${tr('آخر إجازاتي', 'Recent leaves')} (${leaves.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                          const SizedBox(height: 8),
                          ...leaves.take(8).map((l) {
                            final type = l['leaveType'] is Map ? (l['leaveType']['nameAr'] ?? l['leaveType']['nameEn'] ?? '') : '';
                            final st = {
                              'approved': (tr('مقبولة', 'Approved'), T.success),
                              'rejected': (tr('مرفوضة', 'Rejected'), T.danger),
                            }[l['status']] ?? (tr('قيد المراجعة', 'Pending'), T.warn);
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: AppCard(
                                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                                child: Row(children: [
                                  Expanded(
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Text(type.toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                                      Text('${_d(l['startDate'])} ← ${_d(l['endDate'])} · ${l['days'] ?? '—'} ${tr('يوم', 'd')}', style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                                    ]),
                                  ),
                                  Chip2(st.$1, st.$2),
                                ]),
                              ),
                            );
                          }),
                        ],
                        const SizedBox(height: 20),
                      ]),
                    ),
    );
  }
}
