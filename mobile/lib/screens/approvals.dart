import 'package:flutter/material.dart';
import '../services/api.dart';
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
        title: Text(decision == 'approve' ? 'اعتماد الطلب' : 'رفض الطلب'),
        content: TextField(
          controller: note,
          decoration: const InputDecoration(labelText: 'ملاحظة (اختياري)'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إلغاء')),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: decision == 'approve' ? const Color(0xFF059669) : const Color(0xFFDC2626),
            ),
            onPressed: () => Navigator.pop(c, true),
            child: Text(decision == 'approve' ? 'اعتماد' : 'رفض'),
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

    return Scaffold(
      appBar: AppBar(title: const Text('موافقات فريقي')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(_error!, textAlign: TextAlign.center),
                  TextButton(onPressed: _load, child: const Text('إعادة المحاولة')),
                ]))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(14),
                    children: [
                      if (pending.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 40),
                          child: Center(child: Text('لا توجد طلبات منتظرة لقرارك ✅', style: TextStyle(color: Color(0xFF64748B)))),
                        ),
                      ...pending.map((l) => _card(l, actionable: true)),
                      if (past.isNotEmpty) ...[
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 10),
                          child: Text('قرارات سابقة', style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF64748B))),
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
          Text('$type · ${_d(l['startDate'])} ← ${_d(l['endDate'])} · ${l['days'] ?? '—'} يوم',
              style: const TextStyle(fontSize: 13, color: Color(0xFF64748B))),
          if ((l['reason'] ?? '').toString().isNotEmpty)
            Text(l['reason'], style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
          if (actionable) ...[
            const SizedBox(height: 10),
            Row(children: [
              Expanded(
                child: FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: const Color(0xFF059669), minimumSize: const Size.fromHeight(40)),
                  onPressed: () => _decide(l, 'approve'),
                  child: const Text('اعتماد'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: const Color(0xFFDC2626), minimumSize: const Size.fromHeight(40)),
                  onPressed: () => _decide(l, 'reject'),
                  child: const Text('رفض'),
                ),
              ),
            ]),
          ] else
            Text(
              l['status'] == 'approved' ? '✔ معتمدة' : l['status'] == 'rejected' ? '✖ مرفوضة' : l['status'] == 'pending_hr' ? 'عند الموارد البشرية' : '—',
              style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
            ),
        ],
      ),
    );
  }
}
