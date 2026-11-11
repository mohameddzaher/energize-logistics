import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'remote_filters.dart';

/// Remote work: leaves, tasks, daily report, announcements and chats.
/// Live as on the web: "remote:task" refreshes tasks and "remote:message" appends the message to the open chat (with a slower polling fallback if the socket drops).

const _leaveTypes = {
  'annual': ('سنوية', 'Annual'),
  'sick': ('مرضية', 'Sick'),
  'emergency': ('طارئة', 'Emergency'),
  'personal': ('شخصية', 'Personal'),
  'unpaid': ('بدون راتب', 'Unpaid'),
  'other': ('أخرى', 'Other'),
};

const _leaveStatuses = {
  'pending': ('قيد المراجعة', 'Pending', T.warn),
  'approved': ('مقبولة', 'Approved', T.success),
  'rejected': ('مرفوضة', 'Rejected', T.danger),
};

String _userName(dynamic u) => remoteUserName(u);

/// Emergency and sick leave cannot be planned so they are exempt; others are requested 30 days ahead (the server enforces it).
const _noNoticeLeave = {'sick', 'emergency'};
const _leaveNoticeDays = 30;
DateTime _earliestLeaveStart(String type) {
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  return _noNoticeLeave.contains(type) ? today : today.add(const Duration(days: _leaveNoticeDays));
}

String _d(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? (v ?? '—').toString() : '${d.day}/${d.month}/${d.year}';
}

bool _isRemoteStaff(AuthProvider auth) => isRemoteStaff(auth);

// Leaves
class RemoteLeavesScreen extends StatefulWidget {
  const RemoteLeavesScreen({super.key});
  @override
  State<RemoteLeavesScreen> createState() => _RemoteLeavesScreenState();
}

class _RemoteLeavesScreenState extends State<RemoteLeavesScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  // Supervisor filters as on the web: employee and status (server-side).
  String _userId = '';
  String _status = '';
  int _seq = 0;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    final my = ++_seq;
    try {
      final q = [if (_status.isNotEmpty) 'status=$_status', if (_userId.isNotEmpty) 'userId=$_userId'];
      final d = await Api.instance.get('/api/remote/leave${q.isEmpty ? '' : '?${q.join('&')}'}');
      if (!mounted || my != _seq) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['leaves'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && my == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _review(Map<String, dynamic> r, String status) async {
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(status == 'approved' ? tr('قبول الإجازة', 'Approve leave') : tr('رفض الإجازة', 'Reject leave')),
        content: TextField(controller: note, decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)'))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: status == 'approved' ? T.success : T.danger),
            onPressed: () => Navigator.pop(c, true),
            child: Text(status == 'approved' ? tr('قبول', 'Approve') : tr('رفض', 'Reject')),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.patch('/api/remote/leave/${r['_id']}',
          {'status': status, if (note.text.trim().isNotEmpty) 'reviewNote': note.text.trim()});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _create() async {
    String type = 'annual';
    DateTime start = _earliestLeaveStart(type);
    DateTime end = start;
    final reason = TextEditingController();
    String err = '';
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) {
        Future<void> pick(bool isStart) async {
          final v = await showDatePicker(
            context: c,
            initialDate: isStart ? start : end,
            firstDate: isStart ? DateTime.now().subtract(const Duration(days: 365)) : start,
            lastDate: DateTime.now().add(const Duration(days: 730)),
          );
          if (v != null) setS(() { if (isStart) { start = v; if (end.isBefore(v)) end = v; } else { end = v; } });
        }
        String fmt(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('طلب إجازة', 'Request leave'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: type,
                decoration: InputDecoration(labelText: tr('النوع', 'Type')),
                items: _leaveTypes.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
                onChanged: (v) => setS(() {
                  type = v ?? type;
                  // A planned type must not inherit a date that breaks the rule.
                  final min = _earliestLeaveStart(type);
                  final n = DateTime.now();
                  if (!start.isBefore(DateTime(n.year, n.month, n.day)) && start.isBefore(min)) { start = min; end = min; }
                }),
              ),
              const SizedBox(height: 4),
              Text(
                _noNoticeLeave.contains(type)
                    ? tr('إجازة طارئة/مرضية — معفاة من الإخطار المسبق.', 'Emergency / sick leave — exempt from advance notice.')
                    : tr('تُقدَّم قبل موعدها بـ $_leaveNoticeDays يومًا على الأقل — أقرب بداية ${fmt(_earliestLeaveStart(type))}.',
                        'Must be requested at least $_leaveNoticeDays days ahead — earliest start ${fmt(_earliestLeaveStart(type))}.'),
                style: TextStyle(fontSize: 11.5, color: _noNoticeLeave.contains(type) ? T.success : T.warn),
              ),
              if (err.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(err, style: const TextStyle(fontSize: 12, color: T.danger)),
              ],
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: OutlinedButton.icon(onPressed: () => pick(true), icon: const Icon(Icons.event, size: 17), label: Text('${tr('من', 'From')} ${fmt(start)}', style: const TextStyle(fontSize: 12.5)))),
                const SizedBox(width: 10),
                Expanded(child: OutlinedButton.icon(onPressed: () => pick(false), icon: const Icon(Icons.event, size: 17), label: Text('${tr('إلى', 'To')} ${fmt(end)}', style: const TextStyle(fontSize: 12.5)))),
              ]),
              const SizedBox(height: 10),
              TextField(controller: reason, decoration: InputDecoration(labelText: tr('السبب', 'Reason'))),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () async {
                    if (end.isBefore(start)) { setS(() => err = tr('تاريخ النهاية قبل البداية', 'End date is before start date')); return; }
                    final min = _earliestLeaveStart(type);
                    final now = DateTime.now();
                    // A past start records a leave already taken; only an upcoming date inside the notice window is refused.
                    if (!start.isBefore(DateTime(now.year, now.month, now.day)) && start.isBefore(min)) {
                      setS(() => err = tr('يجب تقديم هذا الطلب قبل موعد بدايته بـ $_leaveNoticeDays يومًا على الأقل (أقرب بداية ${fmt(min)}). الطارئة والمرضية معفاة.',
                          'This request must be filed at least $_leaveNoticeDays days before it starts (earliest ${fmt(min)}). Emergency and sick leave are exempt.'));
                      return;
                    }
                    try {
                      await Api.instance.post('/api/remote/leave', {
                        'type': type, 'startDate': fmt(start), 'endDate': fmt(end),
                        if (reason.text.trim().isNotEmpty) 'reason': reason.text.trim(),
                      });
                      if (c.mounted) Navigator.pop(c);
                      _load();
                    } catch (e) {
                      setS(() => err = e.toString());
                    }
                  },
                  child: Text(tr('إرسال الطلب', 'Submit')),
                ),
              ),
            ]),
          ),
        );
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final staff = _isRemoteStaff(auth);
    return AppScaffold(
      title: Text(tr('إجازات العمل عن بُعد', 'Remote Leaves')),
      floatingActionButton: staff
          ? null
          : FloatingActionButton.extended(onPressed: _create, icon: const Icon(Icons.add), label: Text(tr('طلب إجازة', 'Request'))),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                          padding: EdgeInsets.fromLTRB(14, 14, 14, staff ? 24 : 90),
                          itemCount: _rows.length + 1,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (c, i) {
                            if (i == 0) {
                              return Column(children: [
                                if (staff)
                                  RemoteFilterBar(
                                    userId: _userId,
                                    withDates: false,
                                    onChanged: (u, _, __) { setState(() { _userId = u; _loading = true; }); _load(); },
                                    extra: DropdownButtonFormField<String>(
                                      initialValue: _status,
                                      isExpanded: true,
                                      decoration: InputDecoration(labelText: tr('الحالة', 'Status'), isDense: true),
                                      items: [
                                        DropdownMenuItem(value: '', child: Text(tr('الكل', 'All'))),
                                        ..._leaveStatuses.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))),
                                      ],
                                      onChanged: (v) { setState(() { _status = v ?? ''; _loading = true; }); _load(); },
                                    ),
                                  ),
                                if (_rows.isEmpty) ...[const SizedBox(height: 60), EmptyState(icon: Icons.beach_access_outlined, title: tr('لا توجد طلبات إجازة', 'No leave requests'))],
                              ]);
                            }
                            final r = _rows[i - 1];
                            final st = _leaveStatuses[r['status']] ?? ('—', '—', T.inkFaint);
                            final ty = _leaveTypes[r['type']] ?? ('—', '—');
                            return FadeSlideIn(
                              delayMs: (i * 15).clamp(0, 150),
                              child: AppCard(
                                topAccent: st.$3,
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    Expanded(child: Text(staff ? _userName(r['user']) : tr(ty.$1, ty.$2), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                    Chip2(tr(st.$1, st.$2), st.$3),
                                  ]),
                                  const SizedBox(height: 5),
                                  Wrap(spacing: 6, runSpacing: 6, children: [
                                    if (staff) Chip2(tr(ty.$1, ty.$2), T.navy),
                                    Chip2('${r['startDate']}' == '${r['endDate']}' ? '${tr('يوم واحد فقط:', 'One day only:')} ${_d(r['startDate'])}' : '${tr('من', 'From')} ${_d(r['startDate'])} ${tr('إلى', 'to')} ${_d(r['endDate'])}', T.info, icon: Icons.event),
                                    Chip2('${r['days'] ?? '—'} ${tr('يوم', 'days')}', T.violet),
                                  ]),
                                  if ((r['reason'] ?? '').toString().isNotEmpty) ...[
                                    const SizedBox(height: 5),
                                    Text(r['reason'], style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                                  ],
                                  if (r['status'] != 'pending' && r['reviewedBy'] is Map) ...[
                                    const SizedBox(height: 4),
                                    Text('${tr('بواسطة', 'By')} ${_userName(r['reviewedBy'])}${(r['reviewNote'] ?? '').toString().isNotEmpty ? ' — ${r['reviewNote']}' : ''}',
                                        style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                                  ],
                                  if (staff && r['status'] == 'pending') ...[
                                    const SizedBox(height: 6),
                                    Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                                      TextButton(onPressed: () => _review(r, 'rejected'), child: Text(tr('رفض', 'Reject'), style: const TextStyle(color: T.danger, fontWeight: FontWeight.w700, fontSize: 12.5))),
                                      const SizedBox(width: 4),
                                      FilledButton(
                                        style: FilledButton.styleFrom(backgroundColor: T.success, minimumSize: const Size(0, 36), padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6)),
                                        onPressed: () => _review(r, 'approved'),
                                        child: Text(tr('قبول', 'Approve'), style: const TextStyle(fontSize: 12.5)),
                                      ),
                                    ]),
                                  ],
                                ]),
                              ),
                            );
                          },
                        ),
                ),
    );
  }
}

// Tasks
class RemoteTasksScreen extends StatefulWidget {
  const RemoteTasksScreen({super.key});
  @override
  State<RemoteTasksScreen> createState() => _RemoteTasksScreenState();
}

class _RemoteTasksScreenState extends State<RemoteTasksScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _userId = '';
  int _seq = 0;

  void _onLive() => _load();

  @override
  void initState() {
    super.initState();
    _load();
    // The employee gets a live pulse when a task is assigned, as on the web.
    Live.instance.on('remote:task', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('remote:task', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final my = ++_seq;
    try {
      final d = await Api.instance.get('/api/remote/tasks${_userId.isEmpty ? '' : '?userId=$_userId'}');
      if (!mounted || my != _seq) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['tasks'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && my == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _toggle(Map<String, dynamic> r) async {
    // Optimistic as on the web; reloads on failure.
    final next = !(r['done'] == true);
    setState(() => r['done'] = next);
    try {
      await Api.instance.patch('/api/remote/tasks/${r['_id']}', {'done': next});
    } catch (e) {
      _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _create() async {
    List<Map<String, dynamic>> emps = [];
    try {
      final d = await Api.instance.get('/api/remote/employees');
      emps = List<Map<String, dynamic>>.from(d['employees'] ?? []);
    } catch (_) {}
    if (!mounted) return;
    Map<String, dynamic>? emp;
    final title = TextEditingController();
    final description = TextEditingController();
    DateTime? due;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('مهمة جديدة', 'New task'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            DropdownButtonFormField<Map<String, dynamic>>(
              initialValue: emp,
              decoration: InputDecoration(labelText: tr('الموظف *', 'Employee *')),
              items: emps.map((e) => DropdownMenuItem(value: e, child: Text(_userName(e)))).toList(),
              onChanged: (v) => setS(() => emp = v),
            ),
            const SizedBox(height: 10),
            TextField(controller: title, decoration: InputDecoration(labelText: tr('العنوان *', 'Title *'))),
            const SizedBox(height: 10),
            TextField(controller: description, decoration: InputDecoration(labelText: tr('التفاصيل', 'Details'))),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: () async {
                final v = await showDatePicker(context: c, initialDate: DateTime.now(), firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 365)));
                if (v != null) setS(() => due = v);
              },
              icon: const Icon(Icons.event, size: 17),
              label: Text(due == null ? tr('موعد التسليم', 'Due date') : '${due!.day}/${due!.month}/${due!.year}'),
            ),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () async {
                  if (emp == null || title.text.trim().isEmpty) return;
                  try {
                    await Api.instance.post('/api/remote/tasks', {
                      'user': emp!['_id'], 'title': title.text.trim(),
                      if (description.text.trim().isNotEmpty) 'description': description.text.trim(),
                      if (due != null) 'dueDate': '${due!.year}-${due!.month.toString().padLeft(2, '0')}-${due!.day.toString().padLeft(2, '0')}',
                    });
                    if (c.mounted) Navigator.pop(c);
                    _load();
                  } catch (e) {
                    if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                  }
                },
                child: Text(tr('إسناد المهمة', 'Assign')),
              ),
            ),
          ]),
        ),
      )),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final staff = _isRemoteStaff(auth);
    return AppScaffold(
      title: Text(tr('مهام العمل عن بُعد', 'Remote Tasks')),
      floatingActionButton: staff
          ? FloatingActionButton.extended(onPressed: _create, icon: const Icon(Icons.add), label: Text(tr('مهمة', 'Task')))
          : null,
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                          padding: EdgeInsets.fromLTRB(14, 14, 14, staff ? 90 : 24),
                          itemCount: _rows.length + 1,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (c, i) {
                            if (i == 0) {
                              return Column(children: [
                                if (staff)
                                  RemoteFilterBar(
                                    userId: _userId,
                                    withDates: false,
                                    onChanged: (u, _, __) { setState(() { _userId = u; _loading = true; }); _load(); },
                                  ),
                                if (_rows.isEmpty) ...[const SizedBox(height: 60), EmptyState(icon: Icons.task_alt_outlined, title: tr('لا توجد مهام', 'No tasks'))],
                              ]);
                            }
                            final r = _rows[i - 1];
                            final done = r['done'] == true;
                            return FadeSlideIn(
                              delayMs: (i * 15).clamp(0, 150),
                              child: AppCard(
                                topAccent: done ? T.success : T.warn,
                                child: Row(children: [
                                  Checkbox(value: done, onChanged: (_) => _toggle(r)),
                                  Expanded(
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Text((r['title'] ?? '').toString(),
                                          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14, decoration: done ? TextDecoration.lineThrough : null)),
                                      if ((r['description'] ?? '').toString().isNotEmpty)
                                        Text(r['description'], style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                                      const SizedBox(height: 4),
                                      Wrap(spacing: 6, children: [
                                        if (staff && r['user'] != null) Chip2(_userName(r['user']), T.navy, icon: Icons.person_outline),
                                        if (r['dueDate'] != null) Chip2(_d(r['dueDate']), T.info, icon: Icons.event),
                                        if (r['assignedBy'] is Map) Chip2('${tr('بواسطة', 'By')}: ${_userName(r['assignedBy'])}', T.inkFaint),
                                      ]),
                                    ]),
                                  ),
                                  if (staff)
                                    IconButton(
                                      icon: const Icon(Icons.delete_outline, size: 19, color: T.danger),
                                      onPressed: () async {
                                        setState(() => _rows.remove(r));
                                        try { await Api.instance.delete('/api/remote/tasks/${r['_id']}'); }
                                        catch (e) { _load(); if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
                                      },
                                    ),
                                ]),
                              ),
                            );
                          },
                        ),
                ),
    );
  }
}

// Daily report
class RemoteReportScreen extends StatefulWidget {
  const RemoteReportScreen({super.key});
  @override
  State<RemoteReportScreen> createState() => _RemoteReportScreenState();
}

class _RemoteReportScreenState extends State<RemoteReportScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  final _body = TextEditingController();
  String _todayDate = '';
  bool _hasToday = false;
  bool _saving = false;
  String _saved = '';
  // Supervisor filters as on the web: employee and from/to (server-side).
  String _userId = '';
  String? _from, _to;
  int _seq = 0;

  @override
  void initState() { super.initState(); _load(); }

  @override
  void dispose() { _body.dispose(); super.dispose(); }

  Future<void> _load() async {
    final my = ++_seq;
    try {
      final staff = _isRemoteStaff(context.read<AuthProvider>());
      final q = [
        if (staff && _userId.isNotEmpty) 'userId=$_userId',
        if (staff && _from != null) 'from=$_from',
        if (staff && _to != null) 'to=$_to',
      ];
      final results = await Future.wait([
        Api.instance.get('/api/remote/reports${q.isEmpty ? '' : '?${q.join('&')}'}'),
        if (!staff) Api.instance.get('/api/remote/reports/today'),
      ]);
      if (!mounted || my != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(results[0]['reports'] ?? []);
        if (!staff) {
          final t = results[1];
          _todayDate = (t['today'] ?? '').toString();
          // Today's report opens for editing as on the web: the text is filled in and saved again.
          if (t['report'] is Map) { _hasToday = true; _body.text = (t['report']['body'] ?? '').toString(); }
        }
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && my == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _submit() async {
    if (_body.text.trim().isEmpty || _saving) return;
    setState(() { _saving = true; _saved = ''; });
    try {
      await Api.instance.post('/api/remote/reports', {'body': _body.text});
      if (mounted) setState(() => _saved = '${tr('تم حفظ التقرير', 'Report saved')} ✓');
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final staff = _isRemoteStaff(auth);
    return AppScaffold(
      title: Text(staff ? tr('تقارير الفريق اليومية', 'Team daily reports') : tr('التقرير اليومي', 'Daily Report')),
      body: _loading && _rows.isEmpty && !staff
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    if (staff)
                      RemoteFilterBar(
                        userId: _userId, from: _from, to: _to,
                        onChanged: (u, f, t) { setState(() { _userId = u; _from = f; _to = t; _loading = true; }); _load(); },
                      ),
                    if (!staff)
                      FadeSlideIn(
                        child: AppCard(
                          topAccent: _hasToday ? T.success : T.orange,
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${tr('تقرير اليوم', "Today's report")} ($_todayDate)', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const SizedBox(height: 8),
                            TextField(controller: _body, maxLines: 6, decoration: InputDecoration(hintText: tr('اكتب ما أنجزته اليوم…', 'Write what you did today…'))),
                            const SizedBox(height: 10),
                            Row(children: [
                              Expanded(child: Text(_saved, style: const TextStyle(color: T.success, fontSize: 12.5))),
                              FilledButton.icon(
                                style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
                                onPressed: _saving ? null : _submit,
                                icon: _saving ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send_rounded, size: 17),
                                label: Text(tr('حفظ وإرسال', 'Save & submit')),
                              ),
                            ]),
                          ]),
                        ),
                      ),
                    const SizedBox(height: 14),
                    if (!staff) ...[
                      Text(tr('تقاريري السابقة', 'My previous reports'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                      const SizedBox(height: 8),
                    ],
                    if (_loading) ...const [Shimmer(), SizedBox(height: 10), Shimmer()]
                    else if (_rows.isEmpty) EmptyState(icon: Icons.description_outlined, title: tr('لا توجد تقارير', 'No reports'))
                    else ..._rows.map((r) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            if (staff) Expanded(child: Text(_userName(r['user']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                            if (!staff) const Spacer(),
                            Chip2(_d(r['date'] ?? r['createdAt']), T.navy, icon: Icons.event),
                          ]),
                          const SizedBox(height: 5),
                          Text((r['body'] ?? '').toString(), style: const TextStyle(fontSize: 12.5)),
                        ]),
                      ),
                    )),
                  ]),
                ),
    );
  }
}

// Announcements
class RemoteAnnouncementsScreen extends StatefulWidget {
  const RemoteAnnouncementsScreen({super.key});
  @override
  State<RemoteAnnouncementsScreen> createState() => _RemoteAnnouncementsScreenState();
}

class _RemoteAnnouncementsScreenState extends State<RemoteAnnouncementsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/remote/announcements');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['announcements'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _create() => _sheet();

  /// Announcement: publish and edit in one form.
  /// Editing notifies nobody: deleting and republishing used to send the team a second notification for the same news, read as new news.
  Future<void> _sheet({Map<String, dynamic>? existing}) async {
    final title = TextEditingController(text: (existing?['title'] ?? '').toString());
    final body = TextEditingController(text: (existing?['body'] ?? '').toString());
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(existing == null ? tr('إعلان جديد', 'New announcement') : tr('تعديل الإعلان', 'Edit announcement'),
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            TextField(controller: title, decoration: InputDecoration(labelText: tr('العنوان *', 'Title *'))),
            const SizedBox(height: 10),
            TextField(controller: body, maxLines: 4, decoration: InputDecoration(labelText: tr('النص *', 'Body *'))),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () async {
                  if (title.text.trim().isEmpty || body.text.trim().isEmpty) return;
                  final payload = {'title': title.text.trim(), 'body': body.text.trim()};
                  try {
                    if (existing == null) {
                      await Api.instance.post('/api/remote/announcements', payload);
                    } else {
                      await Api.instance.put('/api/remote/announcements/${existing['_id']}', payload);
                    }
                    if (c.mounted) Navigator.pop(c);
                    _load();
                  } catch (e) {
                    if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                  }
                },
                child: Text(existing == null ? tr('نشر', 'Publish') : tr('حفظ', 'Save')),
              ),
            ),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final staff = _isRemoteStaff(auth);
    return AppScaffold(
      title: Text(tr('الإعلانات', 'Announcements')),
      floatingActionButton: staff
          ? FloatingActionButton.extended(onPressed: _create, icon: const Icon(Icons.campaign_outlined), label: Text(tr('إعلان', 'New')))
          : null,
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _rows.isEmpty
                      ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.campaign_outlined, title: tr('لا توجد إعلانات', 'No announcements'))])
                      : ListView.separated(
                          padding: EdgeInsets.fromLTRB(14, 14, 14, staff ? 90 : 24),
                          itemCount: _rows.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (c, i) {
                            final r = _rows[i];
                            return FadeSlideIn(
                              delayMs: (i * 15).clamp(0, 150),
                              child: AppCard(
                                topAccent: T.orange,
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    Expanded(child: Text((r['title'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                    Chip2(_d(r['createdAt']), T.inkFaint, icon: Icons.schedule_outlined),
                                    if (staff)
                                      IconButton(
                                        visualDensity: VisualDensity.compact,
                                        tooltip: tr('تعديل', 'Edit'),
                                        icon: const Icon(Icons.edit_outlined, size: 18, color: T.inkSoft),
                                        onPressed: () => _sheet(existing: r),
                                      ),
                                    if (staff)
                                      IconButton(
                                        icon: const Icon(Icons.delete_outline, size: 19, color: T.danger),
                                        onPressed: () async {
                                          try {
                                            await Api.instance.delete('/api/remote/announcements/${r['_id']}');
                                            _load();
                                          } catch (e) {
                                            if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
                                          }
                                        },
                                      ),
                                  ]),
                                  const SizedBox(height: 4),
                                  Text((r['body'] ?? '').toString(), style: const TextStyle(fontSize: 13)),
                                ]),
                              ),
                            );
                          },
                        ),
                ),
    );
  }
}

// Chats. A remote employee goes to their direct chat; supervisors get a chat list, then the chat.
class RemoteChatEntryScreen extends StatelessWidget {
  const RemoteChatEntryScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    if (!_isRemoteStaff(auth)) return const RemoteChatScreen();
    return const _RemoteThreadsScreen();
  }
}

class _RemoteThreadsScreen extends StatefulWidget {
  const _RemoteThreadsScreen();
  @override
  State<_RemoteThreadsScreen> createState() => _RemoteThreadsScreenState();
}

class _RemoteThreadsScreenState extends State<_RemoteThreadsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;

  void _onMsg(dynamic _) => _load();

  @override
  void initState() {
    super.initState();
    _load();
    // An incoming message updates the list (last message and unread) live.
    Live.instance.onData('remote:message', _onMsg);
  }

  @override
  void dispose() {
    Live.instance.offData('remote:message', _onMsg);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/remote/chat/threads');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['threads'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('المحادثات', 'Conversations')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _rows.isEmpty
                      ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.chat_outlined, title: tr('لا توجد محادثات', 'No conversations'))])
                      : ListView.separated(
                          padding: const EdgeInsets.all(14),
                          itemCount: _rows.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (c, i) {
                            final t = _rows[i];
                            final emp = t['employee'] as Map<String, dynamic>? ?? {};
                            final unread = (t['unread'] ?? 0) as num;
                            return FadeSlideIn(
                              delayMs: (i * 15).clamp(0, 150),
                              child: Pressable(
                                onTap: () async {
                                  await Navigator.push(context, MaterialPageRoute(
                                    builder: (_) => RemoteChatScreen(employeeId: (emp['_id'] ?? '').toString(), title: _userName(emp)),
                                  ));
                                  _load();
                                },
                                child: AppCard(
                                  topAccent: unread > 0 ? T.orange : null,
                                  child: Row(children: [
                                    CircleAvatar(radius: 18, backgroundColor: T.navy.withValues(alpha: 0.1), child: const Icon(Icons.person_outline, color: T.navy, size: 20)),
                                    const SizedBox(width: 10),
                                    Expanded(
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Text(_userName(emp), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                                        if (t['lastMessage'] != null)
                                          Text((t['lastMessage']['body'] ?? '').toString(), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                                      ]),
                                    ),
                                    if (unread > 0)
                                      CircleAvatar(radius: 11, backgroundColor: T.orange, child: Text('$unread', style: const TextStyle(fontSize: 11, color: Colors.white, fontWeight: FontWeight.w800))),
                                  ]),
                                ),
                              ),
                            );
                          },
                        ),
                ),
    );
  }
}

class RemoteChatScreen extends StatefulWidget {
  final String? employeeId;
  final String? title;
  const RemoteChatScreen({super.key, this.employeeId, this.title});
  @override
  State<RemoteChatScreen> createState() => _RemoteChatScreenState();
}

class _RemoteChatScreenState extends State<RemoteChatScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  final _msg = TextEditingController();
  final _scroll = ScrollController();
  Timer? _poll;

  String get _path => widget.employeeId == null ? '/api/remote/chat' : '/api/remote/chat/${widget.employeeId}';

  @override
  void initState() {
    super.initState();
    _load();
    // Socket first, as on the web; slow polling is the fallback if the connection drops.
    Live.instance.onData('remote:message', _onIncoming);
    _poll = Timer.periodic(const Duration(seconds: 45), (_) => _load(silent: true));
  }

  @override
  void dispose() {
    Live.instance.offData('remote:message', _onIncoming);
    _poll?.cancel();
    _scroll.dispose();
    super.dispose();
  }

  /// {employee, message}: the supervisor appends it if it belongs to the open chat, the employee always.
  void _onIncoming(dynamic payload) {
    if (!mounted || payload is! Map) return;
    final emp = (payload['employee'] ?? '').toString();
    if (widget.employeeId != null && emp != widget.employeeId) return;
    final m = payload['message'];
    if (m is! Map) { _load(silent: true); return; }
    _append(Map<String, dynamic>.from(m));
  }

  void _append(Map<String, dynamic> m) {
    if (_rows.any((x) => x['_id'] != null && x['_id'] == m['_id'])) return;
    setState(() => _rows = [..._rows, m]);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  Future<void> _load({bool silent = false}) async {
    try {
      final d = await Api.instance.get(_path);
      if (!mounted) return;
      final rows = List<Map<String, dynamic>>.from(d['messages'] ?? []);
      final grew = rows.length > _rows.length;
      setState(() { _rows = rows; _loading = false; _error = null; });
      if (grew) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
        });
      }
    } catch (e) {
      if (mounted && !silent) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _send() async {
    final text = _msg.text.trim();
    if (text.isEmpty) return;
    _msg.clear();
    try {
      final d = await Api.instance.post(_path, {'body': text});
      if (!mounted) return;
      if (d is Map && d['message'] is Map) {
        _append(Map<String, dynamic>.from(d['message']));
      } else {
        _load();
      }
    } catch (e) {
      _msg.text = text;
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final myId = (auth.user?['_id'] ?? '').toString();
    return AppScaffold(
      title: Text(widget.title ?? tr('محادثة الفريق', 'Team Chat')),
      body: Column(children: [
        Expanded(
          child: _loading
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : _rows.isEmpty
                      ? Center(child: EmptyState(icon: Icons.chat_bubble_outline, title: tr('ابدأ المحادثة 👋', 'Say hello 👋')))
                      : ListView.builder(
                          controller: _scroll,
                          padding: const EdgeInsets.all(14),
                          itemCount: _rows.length,
                          itemBuilder: (c, i) {
                            final m = _rows[i];
                            final sender = m['sender'] as Map<String, dynamic>? ?? {};
                            final mine = (sender['_id'] ?? '').toString() == myId;
                            final at = DateTime.tryParse((m['createdAt'] ?? '').toString())?.toLocal();
                            return Align(
                              alignment: mine ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart,
                              child: Container(
                                margin: const EdgeInsets.only(bottom: 8),
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
                                decoration: BoxDecoration(
                                  color: mine ? T.navy : Colors.white,
                                  borderRadius: BorderRadius.circular(14),
                                  boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 6, offset: const Offset(0, 2))],
                                ),
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                                  if (!mine)
                                    Text(_userName(sender), style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: T.orange)),
                                  Text((m['body'] ?? '').toString(), style: TextStyle(fontSize: 13.5, color: mine ? Colors.white : T.ink)),
                                  if (at != null)
                                    Text('${at.hour}:${at.minute.toString().padLeft(2, '0')}',
                                        style: TextStyle(fontSize: 9.5, color: mine ? Colors.white70 : T.inkFaint)),
                                ]),
                              ),
                            );
                          },
                        ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
            child: Row(children: [
              Expanded(
                child: TextField(
                  controller: _msg,
                  onSubmitted: (_) => _send(),
                  textInputAction: TextInputAction.send,
                  decoration: InputDecoration(hintText: tr('اكتب رسالة…', 'Type a message…')),
                ),
              ),
              const SizedBox(width: 8),
              FloatingActionButton.small(onPressed: _send, child: const Icon(Icons.send_rounded, size: 19)),
            ]),
          ),
        ),
      ]),
    );
  }
}

// Remote-work dashboard: summary (work days/hours/leaves/pending requests) + a per-employee table (for supervisors).
class RemoteDashboardScreen extends StatefulWidget {
  const RemoteDashboardScreen({super.key});
  @override
  State<RemoteDashboardScreen> createState() => _RemoteDashboardScreenState();
}

class _RemoteDashboardScreenState extends State<RemoteDashboardScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  // Supervisor filters as on the web: employee (or the whole team) and from/to.
  String _userId = '';
  String? _from, _to;
  int _seq = 0;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    final my = ++_seq;
    try {
      final q = [if (_userId.isNotEmpty) 'userId=$_userId', if (_from != null) 'from=$_from', if (_to != null) 'to=$_to'];
      final d = await Api.instance.get('/api/remote/dashboard${q.isEmpty ? '' : '?${q.join('&')}'}');
      if (!mounted || my != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && my == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Widget _stat(String ar, String en, dynamic v, IconData icon, Color color) => Expanded(
        child: AppCard(
          topAccent: color,
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [Icon(icon, size: 16, color: color), const SizedBox(width: 5), Expanded(child: Text(tr(ar, en), style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis))]),
            const SizedBox(height: 6),
            Text('${v ?? 0}', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w900)),
          ]),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final s = _d?['summary'] is Map ? Map<String, dynamic>.from(_d!['summary']) : {};
    final per = List<Map<String, dynamic>>.from(_d?['perEmployee'] ?? []);
    final staff = _isRemoteStaff(context.watch<AuthProvider>());
    return AppScaffold(
      title: Text(staff ? tr('لوحة الفريق', 'Team dashboard') : tr('لوحتي', 'My dashboard')),
      // Rows are totals for the selected period, so one export of what is displayed, as on the web.
      actions: [
        if (staff && per.isNotEmpty)
          ExportButton(
            fileName: 'remote-dashboard',
            sheetName: tr('لكل موظف', 'Per employee'),
            columns: [
              ExportCol('الموظف', 'Employee', (r) => r['name']),
              ExportCol('أيام العمل', 'Days worked', (r) => r['daysWorked']),
              ExportCol('الساعات', 'Hours', (r) => fmtDuration(r['totalMinutes'])),
              ExportCol('أيام الإجازات', 'Leave days', (r) => r['leaveDays']),
            ],
            rows: () => per,
          ),
      ],
      body: _loading && _d == null
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 160)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    if (staff) ...[
                      RemoteFilterBar(
                        userId: _userId, from: _from, to: _to,
                        allLabelAr: 'الفريق كلّه', allLabelEn: 'Whole team',
                        onChanged: (u, f, t) { setState(() { _userId = u; _from = f; _to = t; _loading = true; }); _load(); },
                      ),
                      const SizedBox(height: 10),
                    ],
                    if (_loading) const LinearProgressIndicator(minHeight: 2),
                    Row(children: [
                      _stat('أيام العمل', 'Days worked', s['daysWorked'], Icons.event_available_outlined, T.success),
                      const SizedBox(width: 10),
                      _stat('الساعات', 'Hours', fmtDuration(s['totalMinutes']), Icons.schedule_outlined, T.info),
                    ]),
                    const SizedBox(height: 10),
                    Row(children: [
                      _stat('أيام الإجازات', 'Leave days', s['leaveDays'], Icons.beach_access_outlined, T.warn),
                      const SizedBox(width: 10),
                      _stat('طلبات معلّقة', 'Pending leaves', s['pendingLeaves'], Icons.pending_actions_outlined, T.danger),
                    ]),
                    if (staff && per.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Text(tr('لكل موظف', 'Per employee'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                      const SizedBox(height: 8),
                      ...per.asMap().entries.map((e) {
                        final u = e.value;
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: AppCard(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            child: Row(children: [
                              CircleAvatar(radius: 15, backgroundColor: T.navy.withValues(alpha: 0.1), child: Text('${e.key + 1}', style: const TextStyle(color: T.navy, fontWeight: FontWeight.w800, fontSize: 12))),
                              const SizedBox(width: 10),
                              Expanded(child: Text((u['name'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                              Wrap(spacing: 6, children: [
                                Chip2('${u['daysWorked'] ?? 0} ${tr('يوم', 'd')}', T.success),
                                Chip2(fmtDuration(u['totalMinutes']), T.info),
                                Chip2('${u['leaveDays'] ?? 0} ${tr('إجازة', 'leave')}', T.warn),
                              ]),
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
