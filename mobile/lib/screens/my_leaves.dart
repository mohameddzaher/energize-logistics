import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
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
        backgroundColor: T.navy,
        foregroundColor: Colors.white,
        onPressed: _newRequest,
        icon: const Icon(Icons.add),
        label: Text(tr('طلب إجازة', 'Request leave')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 70), SizedBox(height: 14), Shimmer(height: 84), SizedBox(height: 10), Shimmer(height: 84),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(14, 14, 14, 90),
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
                          padding: const EdgeInsets.only(top: 50),
                          child: EmptyState(icon: Icons.beach_access_outlined, title: tr('لا توجد طلبات إجازة بعد', 'No leave requests yet')),
                        ),
                      ..._leaves.asMap().entries.map((e) {
                        final l = e.value;
                        final st = _leaveStatus[l['status']] ?? ('—', '—', T.inkFaint);
                        final type = l['leaveType'] is Map ? (l['leaveType']['nameAr'] ?? l['leaveType']['nameEn'] ?? '') : '';
                        final canCancel = l['status'] == 'pending_manager' || l['status'] == 'pending_hr';
                        return FadeSlideIn(
                          delayMs: (e.key * 20).clamp(0, 200),
                          child: Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: AppCard(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(child: Text(type.toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                      Chip2(tr(st.$1, st.$2), st.$3),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  Text('${_d(l['startDate'])} ← ${_d(l['endDate'])} · ${l['days'] ?? '—'} ${tr('يوم', 'days')}',
                                      style: const TextStyle(fontSize: 13, color: T.inkSoft)),
                                  if ((l['reason'] ?? '').toString().isNotEmpty)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 2),
                                      child: Text(l['reason'], style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                                    ),
                                  if (canCancel)
                                    Align(
                                      alignment: AlignmentDirectional.centerStart,
                                      child: TextButton.icon(
                                        onPressed: () async {
                                          try {
                                            await Api.instance.patch('/api/hr/me/leaves/${l['_id']}/cancel');
                                            _load();
                                          } catch (e) {
                                            if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
                                          }
                                        },
                                        icon: const Icon(Icons.close_rounded, size: 15, color: T.danger),
                                        label: Text(tr('إلغاء الطلب', 'Cancel request'), style: const TextStyle(color: T.danger, fontSize: 12)),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          ),
                        );
                      }),
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
            color: highlight ? T.navy : Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: highlight ? T.navy : const Color(0xFFE2E8F0)),
          ),
          child: Column(
            children: [
              Text('${value ?? 0}',
                  style: TextStyle(
                    fontSize: 18, fontWeight: FontWeight.w800,
                    color: highlight ? Colors.white : T.ink,
                  )),
              Text(label, style: TextStyle(fontSize: 10, color: highlight ? Colors.white70 : T.inkSoft)),
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

  /// سياسة الإخطار المسبق — planned leave must be requested a month ahead; the
  /// kinds you cannot plan (مرضية/طارئة) carry requiresAdvanceNotice:false and
  /// may start today. The backend enforces this; the sheet just refuses to let
  /// the employee pick a date that would be rejected.
  Map<String, dynamic>? get _chosen {
    for (final t in widget.types) {
      if (t['_id'].toString() == _type) return t;
    }
    return null;
  }

  bool get _needsNotice => (_chosen?['requiresAdvanceNotice'] ?? true) != false;
  int get _noticeDays => _needsNotice ? ((_chosen?['minAdvanceDays'] ?? 30) as num).toInt() : 0;
  DateTime get _minStart {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    return _needsNotice ? today.add(Duration(days: _noticeDays)) : today;
  }

  bool get _noticeViolated => _start != null && _start!.isBefore(_minStart);

  Future<void> _save() async {
    if (_type.isEmpty || _start == null || _end == null || _busy) return;
    if (_noticeViolated) {
      final min = _minStart;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr(
        'يجب تقديم هذا الطلب قبل موعد بدايته بـ $_noticeDays يومًا على الأقل — أقرب بداية ${min.day}/${min.month}/${min.year}. الطارئة والمرضية معفاة.',
        'This leave needs $_noticeDays days\' notice — earliest start ${min.day}/${min.month}/${min.year}. Emergency and sick leave are exempt.',
      ))));
      return;
    }
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

  Future<DateTime?> _pick(DateTime? initial) {
    final min = _minStart;
    final seed = (initial != null && !initial.isBefore(min)) ? initial : min;
    return showDatePicker(
      context: context,
      initialDate: seed,
      // The picker cannot even offer an illegal date — the rule is enforced by
      // the calendar, not by an error message after the fact.
      firstDate: min,
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
  }

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
            onChanged: (v) => setState(() {
              _type = v ?? '';
              // Switching to a type with a longer notice must clear a date that
              // is now illegal rather than silently keeping it.
              if (_start != null && _start!.isBefore(_minStart)) { _start = null; _end = null; }
            }),
          ),
          if (_type.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: _needsNotice ? const Color(0xFFFEF3C7) : const Color(0xFFD1FAE5),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(children: [
                Icon(_needsNotice ? Icons.schedule_rounded : Icons.verified_outlined,
                    size: 16, color: _needsNotice ? const Color(0xFF92400E) : const Color(0xFF065F46)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _needsNotice
                        ? tr('تحتاج إخطارًا مسبقًا $_noticeDays يومًا — أقرب بداية ${_minStart.day}/${_minStart.month}/${_minStart.year}.',
                            'Needs $_noticeDays days\' notice — earliest start ${_minStart.day}/${_minStart.month}/${_minStart.year}.')
                        : tr('إجازة طارئة/مرضية — معفاة من الإخطار المسبق.',
                            'Emergency / sick leave — exempt from advance notice.'),
                    style: TextStyle(fontSize: 11.5, color: _needsNotice ? const Color(0xFF92400E) : const Color(0xFF065F46)),
                  ),
                ),
              ]),
            ),
          ],
          const SizedBox(height: 10),
          Row(children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _type.isEmpty ? null : () async { final d = await _pick(_start); if (d != null) setState(() { _start = d; if (_end != null && _end!.isBefore(d)) _end = d; }); },
                child: Text('${tr('من', 'From')}: ${fmt(_start)}'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton(
                onPressed: _type.isEmpty || _start == null ? null : () async { final d = await _pick(_end ?? _start); if (d != null) setState(() => _end = d); },
                child: Text('${tr('إلى', 'To')}: ${fmt(_end)}'),
              ),
            ),
          ]),
          const SizedBox(height: 10),
          TextField(controller: _reason, decoration: InputDecoration(labelText: tr('السبب', 'Reason'))),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: _busy || _type.isEmpty || _start == null || _end == null || _noticeViolated ? null : _save,
            child: _busy
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Text(tr('إرسال الطلب', 'Submit')),
          ),
        ],
      ),
    );
  }
}
