import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
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
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(_error!, textAlign: TextAlign.center),
                  TextButton(onPressed: _load, child: Text(tr('إعادة المحاولة', 'Retry'))),
                ]))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(14),
                    children: [
                      if (pending.isEmpty)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 40),
                          child: Center(child: Text(tr('لا توجد طلبات منتظرة لقرارك ✅', 'Nothing awaiting your decision ✅'), style: const TextStyle(color: Color(0xFF64748B)))),
                        ),
                      ...pending.map((l) => _card(l, actionable: true)),
                      if (past.isNotEmpty) ...[
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          child: Text(tr('قرارات سابقة', 'Past decisions'), style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF64748B))),
                        ),
                        ...past.take(15).map((l) => _card(l, actionable: false)),
                      ],
                    ],
                  ),
                ),
    );
  }

  Widget _card(Map<String, dynamic> l, {required bool actionable}) {
    final emp = l['employee'] is Map
        ? '${l['employee']['firstName'] ?? ''} ${l['employee']['lastName'] ?? ''}'.trim()
        : (l['requester'] is Map ? '${l['requester']['firstName'] ?? ''} ${l['requester']['lastName'] ?? ''}'.trim() : '—');
    final type = l['leaveType'] is Map ? (l['leaveType']['nameAr'] ?? l['leaveType']['nameEn'] ?? '') : '';
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: actionable ? const Color(0xFFFDBA74) : const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(emp, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          const SizedBox(height: 4),
          Text('$type · ${_d(l['startDate'])} ← ${_d(l['endDate'])} · ${l['days'] ?? '—'} ${tr('يوم', 'days')}',
              style: const TextStyle(fontSize: 13, color: Color(0xFF64748B))),
          if ((l['reason'] ?? '').toString().isNotEmpty)
            Text(l['reason'], style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
          if (actionable) ...[
            const SizedBox(height: 10),
            Row(children: [
              Expanded(
                child: FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: const Color(0xFF059669), minimumSize: const Size.fromHeight(40)),
                  onPressed: () => _decide(l, 'approved'),
                  child: Text(tr('اعتماد', 'Approve')),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: const Color(0xFFDC2626), minimumSize: const Size.fromHeight(40)),
                  onPressed: () => _decide(l, 'rejected'),
                  child: Text(tr('رفض', 'Reject')),
                ),
              ),
            ]),
          ] else
            Text(
              l['status'] == 'approved' ? tr('✔ معتمدة', '✔ Approved') : l['status'] == 'rejected' ? tr('✖ مرفوضة', '✖ Rejected') : l['status'] == 'pending_hr' ? tr('عند الموارد البشرية', 'With HR') : '—',
              style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
            ),
        ],
      ),
    );
  }
}
