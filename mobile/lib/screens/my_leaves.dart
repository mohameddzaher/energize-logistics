import 'package:flutter/material.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../services/live.dart';

/// إجازاتي — the self-service leave page: balance cards, request history and
/// a new-request sheet. Same endpoints the web uses (/api/hr/me/leaves).
class MyLeavesScreen extends StatefulWidget {
  const MyLeavesScreen({super.key});
  @override
  State<MyLeavesScreen> createState() => _MyLeavesScreenState();
}

const _leaveStatus = {
  'pending_manager': ('عند المدير', 'With manager', Color(0xFFD97706)),
  'pending_hr': ('عند الموارد البشرية', 'With HR', Color(0xFF2563EB)),
  'approved': ('مقبولة', 'Approved', Color(0xFF059669)),
  'rejected': ('مرفوضة', 'Rejected', Color(0xFFDC2626)),
  'cancelled': ('ملغاة', 'Cancelled', Color(0xFF64748B)),
};

class _MyLeavesScreenState extends State<MyLeavesScreen> {
  List<Map<String, dynamic>> _leaves = [];
  List<Map<String, dynamic>> _types = [];
  Map<String, dynamic>? _balance;
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    Api.instance.get('/api/hr/leave-types').then((d) {
      if (mounted) setState(() => _types = List<Map<String, dynamic>>.from(d['leaveTypes'] ?? []));
    }).catchError((_) {});
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
      final d = await Api.instance.get('/api/hr/me/leaves');
      if (!mounted) return;
      setState(() {
        _leaves = List<Map<String, dynamic>>.from(d['leaves'] ?? []);
        _balance = d['balance'] as Map<String, dynamic>?;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _newRequest() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => _NewLeaveSheet(types: _types, onDone: _load),
    );
  }

  String _d(String? v) {
    final d = v != null ? DateTime.tryParse(v) : null;
    return d == null ? '—' : '${d.day}/${d.month}/${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('إجازاتي', 'My Leaves')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: const Color(AppConfig.navy),
        foregroundColor: Colors.white,
        onPressed: _newRequest,
        icon: const Icon(Icons.add),
        label: Text(tr('طلب إجازة', 'Request leave')),
      ),
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
                      if (_balance != null)
                        Row(
                          children: [
                            _stat(tr('الاستحقاق', 'Entitled'), _balance!['entitlement']),
                            _stat(tr('المتراكم', 'Accrued'), _balance!['accrued']),
                            _stat(tr('المستخدم', 'Taken'), _balance!['taken']),
                            _stat(tr('المتاح', 'Available'), _balance!['available'], highlight: true),
                          ],
                        ),
                      const SizedBox(height: 14),
                      if (_leaves.isEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 60),
                          child: Center(child: Text(tr('لا توجد طلبات إجازة بعد', 'No leave requests yet'), style: const TextStyle(color: Color(0xFF94A3B8)))),
                        ),
                      ..._leaves.map((l) {
                        final st = _leaveStatus[l['status']] ?? ('—', '—', const Color(0xFF64748B));
                        final type = l['leaveType'] is Map ? (l['leaveType']['nameAr'] ?? l['leaveType']['nameEn'] ?? '') : '';
                        final canCancel = l['status'] == 'pending_manager' || l['status'] == 'pending_hr';
                        return Container(
                          margin: const EdgeInsets.only(bottom: 10),
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: const Color(0xFFE2E8F0)),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(child: Text(type.toString(), style: const TextStyle(fontWeight: FontWeight.bold))),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                    decoration: BoxDecoration(color: st.$3.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
                                    child: Text(tr(st.$1, st.$2), style: TextStyle(color: st.$3, fontSize: 12, fontWeight: FontWeight.bold)),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 6),
                              Text('${_d(l['startDate'])} ← ${_d(l['endDate'])} · ${l['days'] ?? '—'} ${tr('يوم', 'days')}',
                                  style: const TextStyle(fontSize: 13, color: Color(0xFF64748B))),
                              if ((l['reason'] ?? '').toString().isNotEmpty)
                                Text(l['reason'], style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
                              if (canCancel)
                                Align(
                                  alignment: Alignment.centerLeft,
                                  child: TextButton(
                                    onPressed: () async {
                                      try {
                                        await Api.instance.patch('/api/hr/me/leaves/${l['_id']}/cancel');
                                        _load();
                                      } catch (e) {
                                        if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
                                      }
                                    },
                                    child: Text(tr('إلغاء الطلب', 'Cancel request'), style: const TextStyle(color: Color(0xFFDC2626), fontSize: 12)),
                                  ),
                                ),
                            ],
                          ),
                        );
                      }),
                      const SizedBox(height: 70),
                    ],
                  ),
                ),
    );
  }

  Widget _stat(String label, dynamic value, {bool highlight = false}) => Expanded(
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 3),
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: highlight ? const Color(AppConfig.navy) : Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Column(
            children: [
              Text('${value ?? 0}',
                  style: TextStyle(
                    fontSize: 18, fontWeight: FontWeight.bold,
                    color: highlight ? Colors.white : const Color(0xFF0F172A),
                  )),
              Text(label, style: TextStyle(fontSize: 10, color: highlight ? Colors.white70 : const Color(0xFF64748B))),
            ],
          ),
        ),
      );
}

class _NewLeaveSheet extends StatefulWidget {
  final List<Map<String, dynamic>> types;
  final Future<void> Function() onDone;
  const _NewLeaveSheet({required this.types, required this.onDone});
  @override
  State<_NewLeaveSheet> createState() => _NewLeaveSheetState();
}

class _NewLeaveSheetState extends State<_NewLeaveSheet> {
  String _type = '';
  DateTime? _start;
  DateTime? _end;
  final _reason = TextEditingController();
  bool _busy = false;

  Future<void> _save() async {
    if (_type.isEmpty || _start == null || _end == null || _busy) return;
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/hr/me/leaves', {
        'leaveType': _type,
        'startDate': _start!.toIso8601String().substring(0, 10),
        'endDate': _end!.toIso8601String().substring(0, 10),
        'reason': _reason.text,
      });
      widget.onDone();
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<DateTime?> _pick(DateTime? initial) => showDatePicker(
        context: context,
        initialDate: initial ?? DateTime.now(),
        firstDate: DateTime.now().subtract(const Duration(days: 30)),
        lastDate: DateTime.now().add(const Duration(days: 365)),
      );

  @override
  Widget build(BuildContext context) {
    String fmt(DateTime? d) => d == null ? tr('اختر التاريخ', 'Pick date') : '${d.day}/${d.month}/${d.year}';
    return Padding(
      padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(context).viewInsets.bottom + 18),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(tr('طلب إجازة جديد', 'New leave request'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            initialValue: _type.isEmpty ? null : _type,
            decoration: InputDecoration(labelText: tr('نوع الإجازة *', 'Leave type *')),
            items: widget.types
                .map((t) => DropdownMenuItem(value: t['_id'].toString(), child: Text(t['nameAr'] ?? t['nameEn'] ?? '')))
                .toList(),
            onChanged: (v) => setState(() => _type = v ?? ''),
          ),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () async { final d = await _pick(_start); if (d != null) setState(() => _start = d); },
                child: Text('${tr('من', 'From')}: ${fmt(_start)}'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton(
                onPressed: () async { final d = await _pick(_end ?? _start); if (d != null) setState(() => _end = d); },
                child: Text('${tr('إلى', 'To')}: ${fmt(_end)}'),
              ),
            ),
          ]),
          const SizedBox(height: 10),
          TextField(controller: _reason, decoration: InputDecoration(labelText: tr('السبب', 'Reason'))),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: _busy || _type.isEmpty || _start == null || _end == null ? null : _save,
            child: _busy
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Text(tr('إرسال الطلب', 'Submit')),
          ),
        ],
      ),
    );
  }
}
