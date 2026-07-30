import 'package:flutter/material.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../services/live.dart';

/// لوحة مهام الشؤون الإدارية — the same four columns the web board shows,
/// as swipeable pages (a phone can't fit four columns side by side).
/// Move buttons, task details with the conversation thread, new-task sheet.
class TasksBoardScreen extends StatefulWidget {
  const TasksBoardScreen({super.key});
  @override
  State<TasksBoardScreen> createState() => _TasksBoardScreenState();
}

const _columns = [
  ('new', 'جديدة', 'New', Color(0xFF0284C7)),
  ('in_progress', 'قيد التنفيذ', 'In Progress', Color(0xFFD97706)),
  ('follow_up', 'قيد المتابعة', 'Follow-up', Color(0xFF7C3AED)),
  ('done', 'مكتملة', 'Done', Color(0xFF059669)),
];

const _priorities = [
  ('urgent', 'عاجلة', 'Urgent', Color(0xFFDC2626)),
  ('high', 'مرتفعة', 'High', Color(0xFFEA580C)),
  ('normal', 'عادية', 'Normal', Color(0xFF64748B)),
  ('low', 'منخفضة', 'Low', Color(0xFF94A3B8)),
];

class _TasksBoardScreenState extends State<TasksBoardScreen> {
  List<Map<String, dynamic>> _tasks = [];
  List<Map<String, dynamic>> _assignees = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    Api.instance.get('/api/admin-tasks/assignees').then((d) {
      if (mounted) setState(() => _assignees = List<Map<String, dynamic>>.from(d['users'] ?? []));
    }).catchError((_) {});
    _onLive = () => _load();
    Live.instance.on('admintasks:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('admintasks:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/admin-tasks');
      if (!mounted) return;
      setState(() {
        _tasks = List<Map<String, dynamic>>.from(d['tasks'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _patch(String id, Map<String, dynamic> body) async {
    try {
      await Api.instance.patch('/api/admin-tasks/$id', body);
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  void _openTask(Map<String, dynamic> t) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => _TaskSheet(task: t, assignees: _assignees, onPatch: _patch, onReload: _load),
    );
  }

  void _newTask() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => _NewTaskSheet(assignees: _assignees, onDone: _load),
    );
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: _columns.length,
      child: AppScaffold(
        title: Text(tr('لوحة المهام', 'Task Board')),
        appBarBottom: TabBar(
            indicatorColor: const Color(AppConfig.orange),
            labelColor: Colors.white,
            unselectedLabelColor: Colors.white60,
            tabs: _columns.map((c) {
              final n = _tasks.where((t) => t['status'] == c.$1).length;
              return Tab(text: '${tr(c.$2, c.$3)} ($n)');
            }).toList(),
        ),
        floatingActionButton: FloatingActionButton.extended(
          backgroundColor: const Color(AppConfig.navy),
          foregroundColor: Colors.white,
          onPressed: _newTask,
          icon: const Icon(Icons.add),
          label: Text(tr('مهمة جديدة', 'New Task')),
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Text(_error!, textAlign: TextAlign.center),
                      TextButton(onPressed: _load, child: Text(tr('إعادة المحاولة', 'Retry'))),
                    ]),
                  )
                : TabBarView(
                    children: _columns.map((col) {
                      final items = _tasks.where((t) => t['status'] == col.$1).toList();
                      if (items.isEmpty) {
                        return Center(child: Text(tr('لا توجد مهام هنا', 'No tasks here'), style: const TextStyle(color: Color(0xFF94A3B8))));
                      }
                      return RefreshIndicator(
                        onRefresh: _load,
                        child: ListView.separated(
                          padding: const EdgeInsets.all(14),
                          itemCount: items.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 10),
                          itemBuilder: (c, i) => _TaskCard(
                            task: items[i],
                            onTap: () => _openTask(items[i]),
                            onMove: (dir) {
                              final idx = _columns.indexWhere((x) => x.$1 == items[i]['status']);
                              final next = idx + dir;
                              if (next >= 0 && next < _columns.length) {
                                _patch(items[i]['_id'], {'status': _columns[next].$1});
                              }
                            },
                          ),
                        ),
                      );
                    }).toList(),
                  ),
      ),
    );
  }
}

class _TaskCard extends StatelessWidget {
  final Map<String, dynamic> task;
  final VoidCallback onTap;
  final void Function(int dir) onMove;
  const _TaskCard({required this.task, required this.onTap, required this.onMove});

  @override
  Widget build(BuildContext context) {
    final p = _priorities.firstWhere((x) => x.$1 == task['priority'], orElse: () => _priorities[2]);
    final due = task['dueDate'] != null ? DateTime.tryParse(task['dueDate']) : null;
    final overdue = due != null && task['status'] != 'done' && due.isBefore(DateTime.now());
    final comments = (task['comments'] as List?)?.length ?? 0;
    final isFirst = task['status'] == 'new';
    final isLast = task['status'] == 'done';

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: const Border(top: BorderSide(color: Color(AppConfig.navy), width: 4)),
          boxShadow: const [BoxShadow(color: Color(0x11000000), blurRadius: 6, offset: Offset(0, 2))],
        ),
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(task['title'] ?? '', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                if (task['priority'] != 'normal')
                  _chip(tr(p.$2, p.$3), p.$4),
                if (due != null)
                  _chip(
                    '${overdue ? tr('متأخرة · ', 'Overdue · ') : ''}${due.day}/${due.month} ${due.hour}:${due.minute.toString().padLeft(2, '0')}',
                    overdue ? const Color(0xFFDC2626) : const Color(0xFF64748B),
                  ),
                if (comments > 0) _chip('💬 $comments', const Color(0xFF64748B)),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: Text(
                    task['assigneeName']?.toString().isNotEmpty == true ? task['assigneeName'] : tr('دون مسؤول', 'Unassigned'),
                    style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (!isFirst)
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.arrow_forward_ios, size: 16, color: Color(0xFF94A3B8)),
                    tooltip: tr('إرجاع خطوة', 'Move back'),
                    onPressed: () => onMove(-1),
                  ),
                if (!isLast)
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    icon: Icon(
                      task['status'] == 'follow_up' ? Icons.check_circle : Icons.arrow_back_ios,
                      size: task['status'] == 'follow_up' ? 20 : 16,
                      color: const Color(0xFF059669),
                    ),
                    tooltip: tr('الخطوة التالية', 'Next step'),
                    onPressed: () => onMove(1),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _chip(String label, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(label, style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w600)),
      );
}

/// Task details: everything editable + the conversation.
class _TaskSheet extends StatefulWidget {
  final Map<String, dynamic> task;
  final List<Map<String, dynamic>> assignees;
  final Future<void> Function(String id, Map<String, dynamic> body) onPatch;
  final Future<void> Function() onReload;
  const _TaskSheet({required this.task, required this.assignees, required this.onPatch, required this.onReload});

  @override
  State<_TaskSheet> createState() => _TaskSheetState();
}

class _TaskSheetState extends State<_TaskSheet> {
  late Map<String, dynamic> t;
  final _comment = TextEditingController();
  late final TextEditingController _title;
  late final TextEditingController _desc;
  late String _priority;
  DateTime? _due;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    t = Map<String, dynamic>.from(widget.task);
    _title = TextEditingController(text: (t['title'] ?? '').toString());
    _desc = TextEditingController(text: (t['description'] ?? '').toString());
    _priority = (t['priority'] ?? 'normal').toString();
    _due = t['dueDate'] != null ? DateTime.tryParse(t['dueDate'].toString())?.toLocal() : null;
  }

  Future<void> _saveEdits() async {
    if (_title.text.trim().isEmpty || _busy) return;
    setState(() => _busy = true);
    try {
      await widget.onPatch(t['_id'], {
        'title': _title.text,
        'description': _desc.text,
        'priority': _priority,
        'dueDate': _due?.toUtc().toIso8601String(),
      });
      if (mounted) Navigator.pop(context);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف المهمة', 'Delete task')),
        content: Text(tr('هل تريد حذف هذه المهمة نهائيًا؟', 'Delete this task permanently?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFFDC2626)),
            onPressed: () => Navigator.pop(c, true),
            child: Text(tr('حذف', 'Delete')),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/admin-tasks/${t['_id']}');
      widget.onReload();
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _sendComment() async {
    if (_comment.text.trim().isEmpty || _busy) return;
    setState(() => _busy = true);
    try {
      final d = await Api.instance.post('/api/admin-tasks/${t['_id']}/comments', {'text': _comment.text});
      _comment.clear();
      setState(() => t = Map<String, dynamic>.from(d['task']));
      widget.onReload();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final comments = List<Map<String, dynamic>>.from(t['comments'] ?? []);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.75,
        maxChildSize: 0.95,
        builder: (c, scroll) => ListView(
          controller: scroll,
          padding: const EdgeInsets.all(18),
          children: [
            Row(children: [
              Expanded(child: Text(tr('تفاصيل المهمة', 'Task details'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold))),
              IconButton(
                icon: const Icon(Icons.delete_outline, color: Color(0xFFDC2626)),
                tooltip: tr('حذف المهمة', 'Delete'),
                onPressed: _delete,
              ),
            ]),
            const SizedBox(height: 6),
            TextField(controller: _title, decoration: InputDecoration(labelText: tr('عنوان المهمة *', 'Title *'))),
            const SizedBox(height: 10),
            TextField(controller: _desc, maxLines: 2, decoration: InputDecoration(labelText: tr('التفاصيل', 'Details'))),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: _priority,
                  decoration: InputDecoration(labelText: tr('الأولوية', 'Priority')),
                  items: _priorities.map((p) => DropdownMenuItem(value: p.$1, child: Text(tr(p.$2, p.$3)))).toList(),
                  onChanged: (v) => setState(() => _priority = v ?? _priority),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(0, 54)),
                  onPressed: () async {
                    final d = await showDatePicker(
                      context: context,
                      initialDate: _due ?? DateTime.now(),
                      firstDate: DateTime(2024),
                      lastDate: DateTime(2030),
                    );
                    if (d != null) setState(() => _due = d);
                  },
                  icon: const Icon(Icons.event_outlined, size: 18),
                  label: Text(_due == null ? tr('تاريخ الاستحقاق', 'Due date') : '${_due!.year}-${_due!.month.toString().padLeft(2, '0')}-${_due!.day.toString().padLeft(2, '0')}', style: const TextStyle(fontSize: 12.5)),
                ),
              ),
            ]),
            const SizedBox(height: 10),
            FilledButton.tonal(
              onPressed: _busy ? null : _saveEdits,
              child: Text(tr('حفظ التعديلات', 'Save changes')),
            ),
            const SizedBox(height: 14),
            // الحالة
            DropdownButtonFormField<String>(
              initialValue: t['status'],
              decoration: InputDecoration(labelText: tr('الحالة', 'Status')),
              items: _columns.map((c) => DropdownMenuItem(value: c.$1, child: Text(tr(c.$2, c.$3)))).toList(),
              onChanged: (v) {
                if (v != null) {
                  setState(() => t['status'] = v);
                  widget.onPatch(t['_id'], {'status': v});
                }
              },
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: (t['assignee'] ?? '') == '' ? '' : t['assignee'].toString(),
              decoration: InputDecoration(labelText: tr('المسؤول عن التنفيذ', 'Assignee')),
              items: [
                DropdownMenuItem(value: '', child: Text(tr('دون مسؤول', 'Unassigned'))),
                ...widget.assignees.map((a) => DropdownMenuItem(value: a['_id'].toString(), child: Text(a['name'] ?? ''))),
              ],
              onChanged: (v) {
                setState(() => t['assignee'] = v);
                widget.onPatch(t['_id'], {'assignee': (v ?? '').isEmpty ? null : v});
              },
            ),
            const SizedBox(height: 18),
            Text(tr('المحادثة والمتابعة', 'Conversation'), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
            const SizedBox(height: 8),
            if (comments.isEmpty)
              Text(tr('لا توجد تعليقات بعد — ابدأ الحوار.', 'No comments yet.'), style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
            ...comments.map((c) => Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: const Color(0xFFF1F5F9)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(c['byName'] ?? '', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                      const SizedBox(height: 2),
                      Text(c['text'] ?? '', style: const TextStyle(fontSize: 14)),
                    ],
                  ),
                )),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _comment,
                    decoration: InputDecoration(hintText: tr('اكتب تعليقًا أو متابعة…', 'Write a comment…')),
                    onSubmitted: (_) => _sendComment(),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  style: IconButton.styleFrom(backgroundColor: const Color(AppConfig.navy)),
                  onPressed: _busy ? null : _sendComment,
                  icon: const Icon(Icons.send, color: Colors.white),
                ),
              ],
            ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
  }
}

/// New task: title + details + assignee + priority + due date/time.
class _NewTaskSheet extends StatefulWidget {
  final List<Map<String, dynamic>> assignees;
  final Future<void> Function() onDone;
  const _NewTaskSheet({required this.assignees, required this.onDone});

  @override
  State<_NewTaskSheet> createState() => _NewTaskSheetState();
}

class _NewTaskSheetState extends State<_NewTaskSheet> {
  final _title = TextEditingController();
  final _desc = TextEditingController();
  String _assignee = '';
  String _priority = 'normal';
  DateTime _due = DateTime.now().copyWith(hour: 17, minute: 0);
  bool _busy = false;

  Future<void> _save() async {
    if (_title.text.trim().isEmpty || _busy) return;
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/admin-tasks', {
        'title': _title.text,
        'description': _desc.text,
        'assignee': _assignee.isEmpty ? null : _assignee,
        'priority': _priority,
        'dueDate': _due.toUtc().toIso8601String(),
      });
      widget.onDone();
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(context).viewInsets.bottom + 18),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(tr('مهمة جديدة', 'New Task'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 14),
          TextField(controller: _title, decoration: InputDecoration(labelText: tr('عنوان المهمة *', 'Title *'))),
          const SizedBox(height: 10),
          TextField(controller: _desc, maxLines: 2, decoration: InputDecoration(labelText: tr('التفاصيل', 'Details'))),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: _assignee,
            decoration: InputDecoration(labelText: tr('المسؤول عن التنفيذ', 'Assignee')),
            items: [
              DropdownMenuItem(value: '', child: Text(tr('دون مسؤول', 'Unassigned'))),
              ...widget.assignees.map((a) => DropdownMenuItem(value: a['_id'].toString(), child: Text(a['name'] ?? ''))),
            ],
            onChanged: (v) => setState(() => _assignee = v ?? ''),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: _priority,
            decoration: InputDecoration(labelText: tr('الأولوية', 'Priority')),
            items: _priorities.map((p) => DropdownMenuItem(value: p.$1, child: Text(tr(p.$2, p.$3)))).toList(),
            onChanged: (v) => setState(() => _priority = v ?? 'normal'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            icon: const Icon(Icons.calendar_month),
            label: Text('${tr('الاستحقاق', 'Due')}: ${_due.day}/${_due.month}/${_due.year} — ${_due.hour}:${_due.minute.toString().padLeft(2, '0')}'),
            onPressed: () async {
              final d = await showDatePicker(
                context: context,
                initialDate: _due,
                firstDate: DateTime.now().subtract(const Duration(days: 1)),
                lastDate: DateTime.now().add(const Duration(days: 365)),
              );
              if (d == null || !context.mounted) return;
              final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_due));
              setState(() => _due = DateTime(d.year, d.month, d.day, t?.hour ?? 17, t?.minute ?? 0));
            },
          ),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: _busy
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Text(tr('إضافة المهمة', 'Add Task')),
          ),
        ],
      ),
    );
  }
}
