import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// العمل عن بُعد — الإجازات، المهام، التقرير اليومي، الإعلانات، والمحادثات.
/// لا يبث هذا القسم أحداثًا لحظية، فالشاشات تعتمد السحب للتحديث
/// (والمحادثة تستطلع كل عشر ثوانٍ وهي مفتوحة).

const _leaveTypes = {
  'annual': ('سنوية', 'Annual'),
  'sick': ('مرضية', 'Sick'),
  'personal': ('شخصية', 'Personal'),
  'unpaid': ('بدون راتب', 'Unpaid'),
  'other': ('أخرى', 'Other'),
};

const _leaveStatuses = {
  'pending': ('قيد المراجعة', 'Pending', T.warn),
  'approved': ('مقبولة', 'Approved', T.success),
  'rejected': ('مرفوضة', 'Rejected', T.danger),
};

String _userName(dynamic u) =>
    u is Map ? '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim() : '—';

String _d(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? (v ?? '—').toString() : '${d.day}/${d.month}/${d.year}';
}

bool _isRemoteStaff(AuthProvider auth) => auth.role != 'remote_employee';

// ── الإجازات ────────────────────────────────────────────────────────────────
class RemoteLeavesScreen extends StatefulWidget {
  const RemoteLeavesScreen({super.key});
  @override
  State<RemoteLeavesScreen> createState() => _RemoteLeavesScreenState();
}

class _RemoteLeavesScreenState extends State<RemoteLeavesScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/remote/leave');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['leaves'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
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
    DateTime start = DateTime.now();
    DateTime end = DateTime.now();
    final reason = TextEditingController();
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) {
        Future<void> pick(bool isStart) async {
          final v = await showDatePicker(
            context: c,
            initialDate: isStart ? start : end,
            firstDate: DateTime.now().subtract(const Duration(days: 30)),
            lastDate: DateTime.now().add(const Duration(days: 365)),
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
                onChanged: (v) => setS(() => type = v ?? type),
              ),
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
                    try {
                      await Api.instance.post('/api/remote/leave', {
                        'type': type, 'startDate': fmt(start), 'endDate': fmt(end),
                        if (reason.text.trim().isNotEmpty) 'reason': reason.text.trim(),
                      });
                      if (c.mounted) Navigator.pop(c);
                      _load();
                    } catch (e) {
                      if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
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
                  child: _rows.isEmpty
                      ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.beach_access_outlined, title: tr('لا توجد طلبات إجازة', 'No leave requests'))])
                      : ListView.separated(
                          padding: const EdgeInsets.all(14),
                          itemCount: _rows.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (c, i) {
                            final r = _rows[i];
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
                                    Chip2('${_d(r['startDate'])} ← ${_d(r['endDate'])}', T.info, icon: Icons.event),
                                    Chip2('${r['days'] ?? '—'} ${tr('يوم', 'days')}', T.violet),
                                  ]),
                                  if ((r['reason'] ?? '').toString().isNotEmpty) ...[
                                    const SizedBox(height: 5),
                                    Text(r['reason'], style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                                  ],
                                  if (staff && r['status'] == 'pending') ...[
                                    const SizedBox(height: 6),
                                    Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                                      TextButton(onPressed: () => _review(r, 'rejected'), child: Text(tr('رفض', 'Reject'), style: const TextStyle(color: T.danger, fontWeight: FontWeight.w700, fontSize: 12.5))),
                                      const SizedBox(width: 4),
                                      FilledButton(
                                        style: FilledButton.styleFrom(backgroundColor: T.success, padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6)),
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

// ── المهام ──────────────────────────────────────────────────────────────────
class RemoteTasksScreen extends StatefulWidget {
  const RemoteTasksScreen({super.key});
  @override
  State<RemoteTasksScreen> createState() => _RemoteTasksScreenState();
}

class _RemoteTasksScreenState extends State<RemoteTasksScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/remote/tasks');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['tasks'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _toggle(Map<String, dynamic> r) async {
    try {
      await Api.instance.patch('/api/remote/tasks/${r['_id']}', {'done': !(r['done'] == true)});
      _load();
    } catch (e) {
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
                  child: _rows.isEmpty
                      ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.task_alt_outlined, title: tr('لا توجد مهام', 'No tasks'))])
                      : ListView.separated(
                          padding: const EdgeInsets.all(14),
                          itemCount: _rows.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (c, i) {
                            final r = _rows[i];
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
                                      ]),
                                    ]),
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

// ── التقرير اليومي ──────────────────────────────────────────────────────────
class RemoteReportScreen extends StatefulWidget {
  const RemoteReportScreen({super.key});
  @override
  State<RemoteReportScreen> createState() => _RemoteReportScreenState();
}

class _RemoteReportScreenState extends State<RemoteReportScreen> {
  Map<String, dynamic>? _today;
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  final _body = TextEditingController();

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final auth = context.read<AuthProvider>();
      final results = await Future.wait([
        if (!_isRemoteStaff(auth)) Api.instance.get('/api/remote/reports/today').catchError((_) => <String, dynamic>{}),
        Api.instance.get('/api/remote/reports'),
      ]);
      if (!mounted) return;
      setState(() {
        _today = results.length > 1 ? results[0]['report'] as Map<String, dynamic>? : null;
        _rows = List<Map<String, dynamic>>.from(results.last['reports'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _submit() async {
    if (_body.text.trim().isEmpty) return;
    try {
      await Api.instance.post('/api/remote/reports', {'body': _body.text.trim()});
      _body.clear();
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final staff = _isRemoteStaff(auth);
    return AppScaffold(
      title: Text(tr('التقرير اليومي', 'Daily Report')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    if (!staff)
                      FadeSlideIn(
                        child: AppCard(
                          topAccent: _today != null ? T.success : T.orange,
                          child: _today != null
                              ? Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text(tr('تقرير اليوم مُرسل ✔', "Today's report sent ✔"), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: T.success)),
                                  const SizedBox(height: 6),
                                  Text((_today!['body'] ?? '').toString(), style: const TextStyle(fontSize: 13)),
                                ])
                              : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text(tr('ماذا أنجزت اليوم؟', 'What did you do today?'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                                  const SizedBox(height: 8),
                                  TextField(controller: _body, maxLines: 4, decoration: InputDecoration(hintText: tr('اكتب تقريرك…', 'Write your report…'))),
                                  const SizedBox(height: 10),
                                  SizedBox(width: double.infinity, child: FilledButton(onPressed: _submit, child: Text(tr('إرسال التقرير', 'Submit')))),
                                ]),
                        ),
                      ),
                    const SizedBox(height: 14),
                    Text(tr('التقارير السابقة', 'Previous reports'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 8),
                    if (_rows.isEmpty) EmptyState(icon: Icons.description_outlined, title: tr('لا توجد تقارير بعد', 'No reports yet')),
                    ..._rows.take(40).map((r) => Padding(
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

// ── الإعلانات ───────────────────────────────────────────────────────────────
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

  Future<void> _create() async {
    final title = TextEditingController();
    final body = TextEditingController();
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('إعلان جديد', 'New announcement'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
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
                  try {
                    await Api.instance.post('/api/remote/announcements', {'title': title.text.trim(), 'body': body.text.trim()});
                    if (c.mounted) Navigator.pop(c);
                    _load();
                  } catch (e) {
                    if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                  }
                },
                child: Text(tr('نشر', 'Publish')),
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
                          padding: const EdgeInsets.all(14),
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

// ── المحادثات ───────────────────────────────────────────────────────────────
/// موظف عن بُعد → محادثته المباشرة؛ المشرفون → قائمة محادثات ثم المحادثة.
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

  @override
  void initState() { super.initState(); _load(); }

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
    _poll = Timer.periodic(const Duration(seconds: 10), (_) => _load(silent: true));
  }

  @override
  void dispose() {
    _poll?.cancel();
    _scroll.dispose();
    super.dispose();
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
      await Api.instance.post(_path, {'body': text});
      _load();
    } catch (e) {
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
