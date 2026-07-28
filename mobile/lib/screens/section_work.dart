import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// «مهامي» و«الشكاوى» لكل قسم — the mobile twin of the web's SectionWork:
/// one screen, mounted per section, full CRUD + assignment + status, live on
/// the same 'section:work' event. Opens ~40 web pages at once.
class SectionWorkScreen extends StatefulWidget {
  final String section;      // 'fleet', 'contracts', …
  final bool complaints;     // false → tasks, true → complaints
  const SectionWorkScreen({super.key, required this.section, this.complaints = false});

  @override
  State<SectionWorkScreen> createState() => _SectionWorkScreenState();
}

const _taskStatuses = {
  'todo': ('جديدة', 'To do', T.inkFaint),
  'in_progress': ('قيد التنفيذ', 'In progress', T.info),
  'done': ('منجزة', 'Done', T.success),
  'cancelled': ('ملغاة', 'Cancelled', T.danger),
};
const _complaintStatuses = {
  'open': ('مفتوحة', 'Open', T.warn),
  'in_progress': ('قيد المعالجة', 'In progress', T.info),
  'resolved': ('محلولة', 'Resolved', T.success),
  'closed': ('مغلقة', 'Closed', T.inkFaint),
};
const _priorities = {
  'high': ('مرتفعة', 'High', T.danger),
  'medium': ('متوسطة', 'Medium', T.warn),
  'low': ('منخفضة', 'Low', T.inkFaint),
};

class _SectionWorkScreenState extends State<SectionWorkScreen> {
  List<Map<String, dynamic>> _rows = [];
  List<Map<String, dynamic>> _assignees = [];
  bool _loading = true;
  String? _error;
  String _status = '';
  late final void Function() _onLive;

  String get _ep => widget.complaints ? 'complaints' : 'tasks';
  String get _titleField => widget.complaints ? 'subject' : 'title';
  Map<String, (String, String, Color)> get _statuses => widget.complaints ? _complaintStatuses : _taskStatuses;

  @override
  void initState() {
    super.initState();
    _load();
    Api.instance.get('/api/section-work/assignees').then((d) {
      if (mounted) setState(() => _assignees = List<Map<String, dynamic>>.from(d['users'] ?? []));
    }).catchError((_) {});
    _onLive = () => _load();
    Live.instance.on('section:work', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('section:work', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final qs = _status.isEmpty ? '' : '&status=$_status';
      final d = await Api.instance.get('/api/section-work/$_ep?section=${widget.section}$qs');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['items'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _delete(Map<String, dynamic> row) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('تأكيد الحذف', 'Confirm delete')),
        content: Text(tr('هل تريد الحذف نهائيًا؟', 'Delete permanently?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/section-work/$_ep/${row['_id']}');
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  void _openForm({Map<String, dynamic>? row}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => _WorkForm(
        section: widget.section,
        complaints: widget.complaints,
        assignees: _assignees,
        row: row,
        onDone: _load,
        onDelete: row == null ? null : () { Navigator.pop(c); _delete(row); },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.complaints ? tr('الشكاوى', 'Complaints') : tr('مهامي', 'My Tasks');
    return AppScaffold(
      title: Text(title),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: T.navy,
        foregroundColor: Colors.white,
        onPressed: () => _openForm(),
        icon: const Icon(Icons.add),
        label: Text(widget.complaints ? tr('شكوى جديدة', 'New complaint') : tr('مهمة جديدة', 'New task')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 44), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer(),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: _statuses.entries.map((e) {
                          final selected = _status == e.key;
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: selected,
                              onSelected: (_) { setState(() { _status = selected ? '' : e.key; _loading = true; }); _load(); },
                              label: Text(tr(e.value.$1, e.value.$2)),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : e.value.$3),
                              selectedColor: e.value.$3,
                              backgroundColor: e.value.$3.withValues(alpha: 0.1),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          );
                        }).toList(),
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? EmptyState(
                              icon: widget.complaints ? Icons.report_outlined : Icons.checklist_rounded,
                              title: widget.complaints ? tr('لا توجد شكاوى', 'No complaints') : tr('لا توجد مهام', 'No tasks'))
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(14, 8, 14, 90),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final r = _rows[i];
                                final st = _statuses[r['status']] ?? ('—', '—', T.inkFaint);
                                final pr = _priorities[r['priority']] ?? _priorities['medium']!;
                                final assignee = r['assignedTo'] is Map
                                    ? '${r['assignedTo']['firstName'] ?? ''} ${r['assignedTo']['lastName'] ?? ''}'.trim()
                                    : '';
                                return FadeSlideIn(
                                  delayMs: (i * 20).clamp(0, 200),
                                  child: Pressable(
                                    onTap: () => _openForm(row: r),
                                    child: AppCard(
                                      topAccent: st.$3,
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Expanded(child: Text((r[_titleField] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                          Chip2(tr(st.$1, st.$2), st.$3),
                                        ]),
                                        if ((r['description'] ?? '').toString().isNotEmpty) ...[
                                          const SizedBox(height: 4),
                                          Text(r['description'], style: const TextStyle(fontSize: 12.5, color: T.inkSoft), maxLines: 2, overflow: TextOverflow.ellipsis),
                                        ],
                                        const SizedBox(height: 8),
                                        Wrap(spacing: 6, runSpacing: 6, children: [
                                          if (r['priority'] != null && r['priority'] != 'medium') Chip2(tr(pr.$1, pr.$2), pr.$3, icon: Icons.flag_outlined),
                                          if (assignee.isNotEmpty) Chip2(assignee, T.navy, icon: Icons.person_outline),
                                          if ((r['resolution'] ?? '').toString().isNotEmpty) Chip2(tr('الحل مسجل', 'Resolution added'), T.success, icon: Icons.check_circle_outline),
                                        ]),
                                      ]),
                                    ),
                                  ),
                                );
                              },
                            ),
                    ),
                  ),
                ]),
    );
  }
}

class _WorkForm extends StatefulWidget {
  final String section;
  final bool complaints;
  final List<Map<String, dynamic>> assignees;
  final Map<String, dynamic>? row;
  final Future<void> Function() onDone;
  final VoidCallback? onDelete;
  const _WorkForm({required this.section, required this.complaints, required this.assignees, this.row, required this.onDone, this.onDelete});

  @override
  State<_WorkForm> createState() => _WorkFormState();
}

class _WorkFormState extends State<_WorkForm> {
  late final TextEditingController _title;
  late final TextEditingController _desc;
  late final TextEditingController _resolution;
  String _priority = 'medium';
  String _statusVal = '';
  String _assignee = '';
  bool _busy = false;

  String get _ep => widget.complaints ? 'complaints' : 'tasks';
  String get _titleField => widget.complaints ? 'subject' : 'title';
  Map<String, (String, String, Color)> get _statuses => widget.complaints ? _complaintStatuses : _taskStatuses;

  @override
  void initState() {
    super.initState();
    final r = widget.row;
    _title = TextEditingController(text: (r?[_titleField] ?? '').toString());
    _desc = TextEditingController(text: (r?['description'] ?? '').toString());
    _resolution = TextEditingController(text: (r?['resolution'] ?? '').toString());
    _priority = (r?['priority'] ?? 'medium').toString();
    _statusVal = (r?['status'] ?? _statuses.keys.first).toString();
    final a = r?['assignedTo'];
    _assignee = a is Map ? (a['_id'] ?? '').toString() : (a ?? '').toString();
  }

  Future<void> _save() async {
    if (_title.text.trim().isEmpty || _busy) return;
    setState(() => _busy = true);
    try {
      final body = {
        'section': widget.section,
        _titleField: _title.text,
        'description': _desc.text,
        'priority': _priority,
        'status': _statusVal,
        if (_assignee.isNotEmpty) 'assignedTo': _assignee,
        if (widget.complaints) 'resolution': _resolution.text,
      };
      if (widget.row != null) {
        await Api.instance.patch('/api/section-work/$_ep/${widget.row!['_id']}', body);
      } else {
        await Api.instance.post('/api/section-work/$_ep', body);
      }
      await widget.onDone();
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isEdit = widget.row != null;
    return Padding(
      padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(context).viewInsets.bottom + 18),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
              child: Text(
                isEdit
                    ? (widget.complaints ? tr('تعديل الشكوى', 'Edit complaint') : tr('تعديل المهمة', 'Edit task'))
                    : (widget.complaints ? tr('شكوى جديدة', 'New complaint') : tr('مهمة جديدة', 'New task')),
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
              ),
            ),
            if (widget.onDelete != null)
              IconButton(icon: const Icon(Icons.delete_outline, color: T.danger), onPressed: widget.onDelete),
          ]),
          const SizedBox(height: 10),
          TextField(controller: _title, decoration: InputDecoration(labelText: widget.complaints ? tr('الموضوع *', 'Subject *') : tr('العنوان *', 'Title *'))),
          const SizedBox(height: 10),
          TextField(controller: _desc, maxLines: 3, decoration: InputDecoration(labelText: tr('التفاصيل', 'Details'))),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: _priority,
            decoration: InputDecoration(labelText: tr('الأولوية', 'Priority')),
            items: _priorities.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
            onChanged: (v) => setState(() => _priority = v ?? 'medium'),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: _statusVal,
            decoration: InputDecoration(labelText: tr('الحالة', 'Status')),
            items: _statuses.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
            onChanged: (v) => setState(() => _statusVal = v ?? _statusVal),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: _assignee.isEmpty ? null : _assignee,
            decoration: InputDecoration(labelText: tr('إسناد إلى', 'Assign to')),
            items: widget.assignees
                .map((a) => DropdownMenuItem(
                    value: (a['_id'] ?? '').toString(),
                    child: Text('${a['firstName'] ?? ''} ${a['lastName'] ?? ''}'.trim())))
                .toList(),
            onChanged: (v) => setState(() => _assignee = v ?? ''),
          ),
          if (widget.complaints) ...[
            const SizedBox(height: 10),
            TextField(controller: _resolution, maxLines: 2, decoration: InputDecoration(labelText: tr('الحل / الإجراء', 'Resolution'))),
          ],
          const SizedBox(height: 14),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: _busy
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Text(isEdit ? tr('حفظ التعديلات', 'Save changes') : tr('إضافة', 'Add')),
          ),
        ]),
      ),
    );
  }
}
