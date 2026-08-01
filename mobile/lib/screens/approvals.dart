import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../services/live.dart';

/// موافقات فريقي — leave requests from the manager's direct reports awaiting
/// their decision. Approve / reject with an optional note, same endpoint the
/// web review dialog calls.
class ApprovalsScreen extends StatefulWidget {
  const ApprovalsScreen({super.key});
  @override
  State<ApprovalsScreen> createState() => _ApprovalsScreenState();
}

class _ApprovalsScreenState extends State<ApprovalsScreen> {
  List<Map<String, dynamic>> _leaves = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('hr:leave', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('hr:leave', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/hr/team/leaves');
      if (!mounted) return;
      setState(() {
        _leaves = List<Map<String, dynamic>>.from(d['leaves'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _decide(Map<String, dynamic> l, String decision) async {
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(decision == 'approved' ? tr('اعتماد الطلب', 'Approve request') : tr('رفض الطلب', 'Reject request')),
        content: TextField(
          controller: note,
          decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: decision == 'approved' ? const Color(0xFF059669) : const Color(0xFFDC2626),
            ),
            onPressed: () => Navigator.pop(c, true),
            child: Text(decision == 'approved' ? tr('اعتماد', 'Approve') : tr('رفض', 'Reject')),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.patch('/api/hr/leaves/${l['_id']}/decision', {
        'decision': decision,
        'note': note.text,
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  String _d(String? v) {
    final d = v != null ? DateTime.tryParse(v) : null;
    return d == null ? '—' : '${d.day}/${d.month}/${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    final pending = _leaves.where((l) => l['status'] == 'pending_manager').toList();
    final past = _leaves.where((l) => l['status'] != 'pending_manager').toList();

    return AppScaffold(
      title: Text(tr('موافقات فريقي', 'Team Approvals')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 96), SizedBox(height: 10), Shimmer(height: 96), SizedBox(height: 10), Shimmer(height: 96),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: (pending.isEmpty && past.isEmpty)
                      ? ListView(children: [
                          const SizedBox(height: 80),
                          EmptyState(icon: Icons.verified_outlined, title: tr('لا توجد طلبات منتظرة لقرارك', 'Nothing awaiting your decision')),
                        ])
                      : ListView(
                          padding: const EdgeInsets.fromLTRB(14, 12, 14, 24),
                          children: [
                            ...pending.asMap().entries.map((e) => _card(e.value, actionable: true, i: e.key)),
                            if (past.isNotEmpty) ...[
                              const SizedBox(height: 12),
                              Text(tr('قرارات سابقة', 'Past decisions'), style: const TextStyle(fontWeight: FontWeight.w800, color: T.inkSoft, fontSize: 13)),
                              const SizedBox(height: 8),
                              ...past.take(15).map((l) => _card(l, actionable: false)),
                            ],
                          ],
                        ),
                ),
    );
  }

  Widget _card(Map<String, dynamic> l, {required bool actionable, int i = 0}) {
    final emp = l['employee'] is Map
        ? '${l['employee']['firstName'] ?? ''} ${l['employee']['lastName'] ?? ''}'.trim()
        : (l['requester'] is Map ? '${l['requester']['firstName'] ?? ''} ${l['requester']['lastName'] ?? ''}'.trim() : '—');
    final type = l['leaveType'] is Map ? (l['leaveType']['nameAr'] ?? l['leaveType']['nameEn'] ?? '') : '';
    final st = l['status'];
    final (String, String, Color) badge = st == 'approved'
        ? ('معتمدة', 'Approved', T.success)
        : st == 'rejected'
            ? ('مرفوضة', 'Rejected', T.danger)
            : st == 'pending_hr'
                ? ('عند الموارد البشرية', 'With HR', T.info)
                : ('—', '—', T.inkFaint);
    return FadeSlideIn(
      delayMs: (i * 20).clamp(0, 200),
      child: Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: AppCard(
          topAccent: actionable ? T.warn : null,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Expanded(child: Text(emp, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
                if (!actionable) Chip2(tr(badge.$1, badge.$2), badge.$3),
              ]),
              const SizedBox(height: 4),
              Text('$type · ${_d(l['startDate'])} ← ${_d(l['endDate'])} · ${l['days'] ?? '—'} ${tr('يوم', 'days')}',
                  style: const TextStyle(fontSize: 13, color: T.inkSoft)),
              if ((l['reason'] ?? '').toString().isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(l['reason'], style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                ),
              if (actionable) ...[
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(backgroundColor: T.success, minimumSize: const Size.fromHeight(42)),
                      onPressed: () => _decide(l, 'approved'),
                      icon: const Icon(Icons.check_rounded, size: 18),
                      label: Text(tr('اعتماد', 'Approve')),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(backgroundColor: T.danger, minimumSize: const Size.fromHeight(42)),
                      onPressed: () => _decide(l, 'rejected'),
                      icon: const Icon(Icons.close_rounded, size: 18),
                      label: Text(tr('رفض', 'Reject')),
                    ),
                  ),
                ]),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
