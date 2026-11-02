import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'hr_employee_profile.dart';
import '../ui/search_field.dart';

/// Archive: matches the web page `/system/hr/archive`.
/// Staff whose service ended and who left the system, plus freelancers whose service ended. They appear in no other screen or count. Archiving erases nothing: tapping opens the full file.
class HrArchiveScreen extends StatefulWidget {
  const HrArchiveScreen({super.key});
  @override
  State<HrArchiveScreen> createState() => _HrArchiveScreenState();
}

class _HrArchiveScreenState extends State<HrArchiveScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  String _q = '';
  // The field sits in a list that collapses on scroll; text lives in a controller so it survives.
  final _searchCtl = TextEditingController();
  // Search runs on the server (`q=`) like the web; an older response never overwrites a newer one.
  int _seq = 0;
  Timer? _debounce;
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
    _debounce?.cancel();
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final q = _q.trim();
      final d = await Api.instance.get('/api/hr/archive${q.isEmpty ? '' : '?q=${Uri.encodeQueryComponent(q)}'}');
      if (mounted && mine == _seq) setState(() { _d = Map<String, dynamic>.from(d as Map); _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e.toString());
    }
  }

  /// Restore to the system: corrects an exit recorded by mistake. Freelancers cannot be restored from here (same as the web).
  Future<void> _returnBack(Map<String, dynamic> r) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('إعادة إلى النظام؟', 'Return to the system?')),
        content: Text(tr('يعود ${r['name'] ?? ''} داخل النظام ويخرج من الأرشيف — لتصحيح خروجٍ سُجِّل خطأً.', 'For correcting an exit recorded by mistake.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('إعادة', 'Return'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/hr/employees/${r['_id']}/return-system', {});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أُعيد إلى النظام', 'Returned'))));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
    }
  }

  String _fmt(dynamic v) => '${v ?? ''}'.length >= 10 ? '$v'.substring(0, 10).split('-').reversed.join('/') : '—';

  String _eng(dynamic k) => k == 'sponsored' ? tr('على الكفالة', 'Sponsored') : k == 'freelance' ? tr('فريلانسر', 'Freelance') : k == 'trainee' ? tr('متدرب', 'Trainee') : '—';

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final items = d == null ? const <Map<String, dynamic>>[] : [for (final x in (d['items'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)];
    final c = (d?['counts'] as Map?) ?? const {};
    return AppScaffold(
      title: Text(tr('الأرشيف', 'Archive')),
      actions: [
        // Same export columns as the web.
        ExportButton(
          fileName: 'hr-archive',
          sheetName: tr('الأرشيف', 'Archive'),
          rows: () => items,
          columns: [
            ExportCol('الرقم الوظيفي', 'Emp. no.', (r) => r['employeeNumber'] ?? ''),
            ExportCol('الموظف', 'Employee', (r) => r['name'] ?? ''),
            ExportCol('رقم الهوية / الإقامة', 'ID / Iqama', (r) => '${r['iqamaNumber'] ?? ''}'.isNotEmpty ? r['iqamaNumber'] : (r['nationalId'] ?? '—')),
            ExportCol('النوع', 'Type', (r) => _eng(r['engagement'])),
            ExportCol('القسم', 'Department', (r) => '${r['department'] ?? ''}'.isEmpty ? '—' : r['department']),
            ExportCol('تاريخ انتهاء الخدمة', 'Service ended', (r) => _fmt(r['terminatedAt'])),
            ExportCol('السبب', 'Reason', (r) => '${r['terminationReason'] ?? ''}'.isEmpty ? '—' : r['terminationReason']),
          ],
        ),
      ],
      body: d == null
          ? (_error != null ? ErrorRetry(message: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(14), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                Row(children: [
                  Expanded(child: StatCard(label: tr('في الأرشيف', 'Archived'), value: c['total'] ?? 0, color: T.inkSoft, icon: Icons.archive_outlined)),
                  const SizedBox(width: 8),
                  Expanded(child: StatCard(label: tr('على الكفالة', 'Sponsored'), value: c['sponsored'] ?? 0, color: T.navy, icon: Icons.verified_user_outlined)),
                  const SizedBox(width: 8),
                  Expanded(child: StatCard(label: tr('فريلانسر', 'Freelance'), value: c['freelance'] ?? 0, color: T.violet, icon: Icons.work_outline)),
                ]),
                const SizedBox(height: 10),
                SearchField(
                  controller: _searchCtl, dense: true,
                  onChanged: (v) {
                    _q = v;
                    _debounce?.cancel();
                    _debounce = Timer(const Duration(milliseconds: 350), _load);
                  },
                  hint: tr('الاسم، الرقم الوظيفي، رقم الهوية…', 'Name, emp. no., ID…'),
                ),
                const SizedBox(height: 10),
                if (items.isEmpty) EmptyState(icon: Icons.archive_outlined, title: _q.trim().isNotEmpty ? tr('لا نتائج', 'No matches') : tr('الأرشيف فارغ', 'The archive is empty')),
                for (final e in items)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Pressable(
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => HrEmployeeProfileScreen(employeeId: '${e['_id']}'))),
                      child: AppCard(
                        child: Row(children: [
                          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${e['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 2),
                          Text([
                            e['employeeNumber'], e['iqamaNumber'] ?? e['nationalId'], _eng(e['engagement']), e['department'],
                            if ('${e['terminatedAt'] ?? ''}'.length >= 10) '${tr('انتهت', 'ended')} ${'${e['terminatedAt']}'.substring(0, 10).split('-').reversed.join('/')}',
                          ].where((x) => x != null && '$x'.isNotEmpty && '$x' != '—').join(' · '),
                              style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                          if ('${e['terminationReason'] ?? ''}'.isNotEmpty)
                            Text('${e['terminationReason']}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                          ])),
                          if (e['engagement'] != 'freelance')
                            IconButton(
                              tooltip: tr('إعادة إلى النظام', 'Return to the system'),
                              icon: const Icon(Icons.undo_rounded, color: T.orange),
                              onPressed: () => _returnBack(e),
                            ),
                        ]),
                      ),
                    ),
                  ),
              ]),
            ),
    );
  }
}
