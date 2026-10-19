import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'hr_employee_profile.dart';

/// الأرشيف — مطابقٌ لصفحة الموقع `/system/hr/archive`.
///
/// مَن انتهت خدمتُه وخرج من النظام، والفريلانسرُ الذي انتهت خدمتُه. لا يظهرون في
/// أيّ شاشةٍ أو رقمٍ آخر. والأرشفةُ لا تمحو: الضغطُ يفتح الملفّ كاملًا.
class HrArchiveScreen extends StatefulWidget {
  const HrArchiveScreen({super.key});
  @override
  State<HrArchiveScreen> createState() => _HrArchiveScreenState();
}

class _HrArchiveScreenState extends State<HrArchiveScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  String _q = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('hr:employee', _onLive);
    Live.instance.on('hr:master', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('hr:employee', _onLive);
    Live.instance.off('hr:master', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/hr/archive');
      if (mounted) setState(() { _d = Map<String, dynamic>.from(d as Map); _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  String _eng(dynamic k) => k == 'sponsored' ? tr('على الكفالة', 'Sponsored') : k == 'freelance' ? tr('فريلانسر', 'Freelance') : k == 'trainee' ? tr('متدرب', 'Trainee') : '—';

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final all = d == null ? const <Map<String, dynamic>>[] : [for (final x in (d['items'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)];
    final q = _q.trim();
    final items = q.isEmpty ? all : all.where((e) => '${e['name']} ${e['employeeNumber'] ?? ''} ${e['iqamaNumber'] ?? ''} ${e['nationalId'] ?? ''}'.contains(q)).toList();
    final c = (d?['counts'] as Map?) ?? const {};
    return AppScaffold(
      title: Text(tr('الأرشيف', 'Archive')),
      body: d == null
          ? (_error != null ? ErrorRetry(message: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(14), children: [
                Row(children: [
                  Expanded(child: StatCard(label: tr('في الأرشيف', 'Archived'), value: c['total'] ?? 0, color: T.inkSoft, icon: Icons.archive_outlined)),
                  const SizedBox(width: 8),
                  Expanded(child: StatCard(label: tr('على الكفالة', 'Sponsored'), value: c['sponsored'] ?? 0, color: T.navy, icon: Icons.verified_user_outlined)),
                  const SizedBox(width: 8),
                  Expanded(child: StatCard(label: tr('فريلانسر', 'Freelance'), value: c['freelance'] ?? 0, color: T.violet, icon: Icons.work_outline)),
                ]),
                const SizedBox(height: 10),
                TextField(
                  onChanged: (v) => setState(() => _q = v),
                  decoration: InputDecoration(isDense: true, prefixIcon: const Icon(Icons.search), hintText: tr('الاسم، الرقم الوظيفي، رقم الهوية…', 'Name, emp. no., ID…')),
                ),
                const SizedBox(height: 10),
                if (items.isEmpty) EmptyState(icon: Icons.archive_outlined, title: tr('الأرشيف فارغ', 'The archive is empty')),
                for (final e in items)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Pressable(
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => HrEmployeeProfileScreen(employeeId: '${e['_id']}'))),
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${e['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 2),
                          Text([
                            e['employeeNumber'], e['iqamaNumber'] ?? e['nationalId'], _eng(e['engagement']), e['department'],
                            if ('${e['terminatedAt'] ?? ''}'.length >= 10) '${tr('انتهت', 'ended')} ${'${e['terminatedAt']}'.substring(0, 10).split('-').reversed.join('/')}',
                          ].where((x) => x != null && '$x'.isNotEmpty && '$x' != '—').join(' · '),
                              style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                        ]),
                      ),
                    ),
                  ),
              ]),
            ),
    );
  }
}
