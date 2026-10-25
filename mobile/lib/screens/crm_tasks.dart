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
import 'crm_form.dart';
import '../ui/search_field.dart';

/// مهامّ العلاقات — نظيرُ /system/crm/tasks: «الكلّ / مهامّي»، الحالة، البحث
/// (كلّها على الخادم)، والدائرةُ بجانب المهمّة تُكملها أو تعيد فتحها بضغطةٍ
/// واحدة (PUT {status}). تعديلٌ وحذفٌ وتصدير Excel، وحيٌّ على `crm:task`.
class CrmTasksScreen extends StatefulWidget {
  const CrmTasksScreen({super.key});
  @override
  State<CrmTasksScreen> createState() => _CrmTasksScreenState();
}

String _user(dynamic u) => u is Map ? '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim() : '';
String _company(dynamic c) => c is Map ? '${(Lang.instance.ar && '${c['arabicName'] ?? ''}'.isNotEmpty) ? c['arabicName'] : (c['name'] ?? '')}' : '';
String _date(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? '' : '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

const _statusColor = {'todo': T.warn, 'in_progress': T.info, 'done': T.success, 'cancelled': T.inkFaint};
const _prioColor = {'low': T.inkSoft, 'medium': T.info, 'high': T.warn, 'urgent': T.danger};

class _CrmTasksScreenState extends State<CrmTasksScreen> {
  List<Map<String, dynamic>> _items = [];
  List<Map<String, dynamic>> _companies = [];
  Map<String, dynamic> _opts = const {};
  bool _loading = true;
  String? _error;
  String _scope = 'all';
  String _status = '';
  String _q = '';
  Timer? _debounce;
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () => _load();
    Live.instance.on('crm:task', _onLive);
    _load();
    Api.instance.get('/api/crm/options').then((o) { if (mounted) setState(() => _opts = Map<String, dynamic>.from(o)); }).catchError((_) {});
    Api.instance.get('/api/crm/companies').then((d) {
      if (mounted) setState(() => _companies = List<Map<String, dynamic>>.from((d['companies'] ?? const []).map((e) => Map<String, dynamic>.from(e))));
    }).catchError((_) {});
  }

  @override
  void dispose() {
    Live.instance.off('crm:task', _onLive);
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    final qs = [
      if (_q.trim().isNotEmpty) 'q=${Uri.encodeQueryComponent(_q.trim())}',
      if (_scope == 'mine') 'mine=true',
      if (_status.isNotEmpty) 'status=$_status',
    ].join('&');
    try {
      final d = await Api.instance.get('/api/crm/tasks?$qs');
      if (!mounted || mine != _seq) return;
      setState(() {
        _items = List<Map<String, dynamic>>.from((d['tasks'] ?? const []).map((e) => Map<String, dynamic>.from(e)));
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _msg(Object e) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));

  Future<void> _toggle(Map<String, dynamic> t) async {
    final status = t['status'] == 'done' ? 'todo' : 'done';
    setState(() => t['status'] = status); // تفاؤليّ كالويب
    try {
      await Api.instance.put('/api/crm/tasks/${t['_id']}', {'status': status});
    } catch (e) { if (mounted) _msg(e); }
    await _load();
  }

  Future<void> _remove(Map<String, dynamic> t) async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('تأكيد الحذف', 'Confirm delete')),
      content: Text('${t['title'] ?? ''}'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok != true) return;
    try { await Api.instance.delete('/api/crm/tasks/${t['_id']}'); await _load(); } catch (e) { if (mounted) _msg(e); }
  }

  Future<void> _edit([Map<String, dynamic>? t]) async {
    final me = context.read<AuthProvider>().user?['_id']?.toString() ?? '';
    final companies = <(String, String, String)>[
      for (final c in _companies) ('${c['_id']}', _company(c), _company(c)),
    ];
    await showCrmForm(
      context,
      title: t == null ? tr('إضافة مهمة', 'Add task') : tr('تعديل', 'Edit'),
      initial: t == null
          ? {'priority': 'medium', 'status': 'todo', 'assignedTo': me}
          : {
              ...t,
              'dueDate': _date(t['dueDate']),
              'company': t['company'] is Map ? '${t['company']['_id']}' : (t['company'] ?? ''),
              'assignedTo': t['assignedTo'] is Map ? '${t['assignedTo']['_id']}' : (t['assignedTo'] ?? ''),
            },
      fields: [
        const CrmField('title', 'عنوان المهمة', 'Task title', required: true),
        CrmField('company', 'الشركة', 'Company', kind: CrmFieldKind.select, options: companies),
        const CrmField('dueDate', 'تاريخ الاستحقاق', 'Due date', kind: CrmFieldKind.date),
        const CrmField('dueTime', 'وقت الاستحقاق (HH:MM)', 'Due time (HH:MM)', ltr: true),
        CrmField('priority', 'الأولوية', 'Priority', kind: CrmFieldKind.select, options: crmOpts(_opts['TASK_PRIORITIES'])),
        CrmField('status', 'الحالة', 'Status', kind: CrmFieldKind.select, options: crmOpts(_opts['TASK_STATUSES'])),
        CrmField('assignedTo', 'مسندة إلى', 'Assigned to', kind: CrmFieldKind.select, options: crmOwners(_opts['owners'])),
        const CrmField('description', 'الوصف', 'Description', kind: CrmFieldKind.multiline),
      ],
      onSave: (v) async {
        final body = <String, dynamic>{...v};
        for (final k in ['company', 'assignedTo', 'dueDate']) {
          if ((body[k] ?? '') == '') body[k] = null;
        }
        try {
          if (t == null) {
            body.removeWhere((k, x) => x == null);
            await Api.instance.post('/api/crm/tasks', body);
          } else {
            await Api.instance.put('/api/crm/tasks/${t['_id']}', body);
          }
          await _load();
          return null;
        } catch (e) { return e is ApiException ? e.message : e.toString(); }
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final statuses = crmOpts(_opts['TASK_STATUSES']);
    final prios = crmOpts(_opts['TASK_PRIORITIES']);
    return AppScaffold(
      title: Text(tr('مهام العلاقات', 'CRM Tasks')),
      actions: [
        ExportButton(
          fileName: 'crm-tasks',
          rows: () => _items,
          columns: [
            ExportCol('عنوان المهمة', 'Task title', (r) => r['title']),
            ExportCol('الشركة', 'Company', (r) => _company(r['company'])),
            ExportCol('مسندة إلى', 'Assigned to', (r) => _user(r['assignedTo'])),
            ExportCol('تاريخ الاستحقاق', 'Due date', (r) => _date(r['dueDate'])),
            ExportCol('الأولوية', 'Priority', (r) => r['priority']),
            ExportCol('الحالة', 'Status', (r) => r['status']),
          ],
        ),
      ],
      floatingActionButton: FloatingActionButton(
        backgroundColor: T.orange, onPressed: () => _edit(),
        child: const Icon(Icons.add, color: Colors.white),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
          child: Row(children: [
            SegmentedButton<String>(
              segments: [
                ButtonSegment(value: 'all', label: Text(tr('الكل', 'All'))),
                ButtonSegment(value: 'mine', label: Text(tr('مهامّي', 'My tasks'))),
              ],
              selected: {_scope},
              onSelectionChanged: (s) { setState(() => _scope = s.first); _load(); },
            ),
            const SizedBox(width: 8),
            Expanded(
              child: DropdownButtonFormField<String>(
                initialValue: _status, isExpanded: true,
                decoration: const InputDecoration(isDense: true),
                items: [
                  DropdownMenuItem(value: '', child: Text(tr('كل الحالات', 'All statuses'))),
                  for (final s in statuses) DropdownMenuItem(value: s.$1, child: Text(tr(s.$2, s.$3))),
                ],
                onChanged: (v) { setState(() => _status = v ?? ''); _load(); },
              ),
            ),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 4, 14, 4),
          child: SearchField(
            hint: tr('بحث…', 'Search…'), suffixText: '${_items.length}',
            onChanged: (v) {
              _q = v;
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 350), _load);
            },
          ),
        ),
        Expanded(
          child: _loading
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer()])
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: _items.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.task_alt_outlined, title: tr('لا توجد نتائج', 'No results'))])
                          : ListView.builder(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              padding: const EdgeInsets.fromLTRB(14, 4, 14, 90),
                              itemCount: _items.length,
                              itemBuilder: (c, i) {
                                final t = _items[i];
                                final done = t['status'] == 'done';
                                final due = DateTime.tryParse('${t['dueDate'] ?? ''}');
                                final overdue = !done && due != null && due.isBefore(DateTime.now());
                                return Padding(
                                  padding: const EdgeInsets.only(bottom: 8),
                                  child: AppCard(
                                    padding: const EdgeInsets.fromLTRB(4, 6, 4, 6),
                                    child: Row(children: [
                                      IconButton(
                                        tooltip: tr('تمّت', 'Mark done'),
                                        onPressed: () => _toggle(t),
                                        icon: Icon(done ? Icons.check_circle : Icons.radio_button_unchecked, color: done ? T.success : T.inkFaint),
                                      ),
                                      Expanded(
                                        child: InkWell(
                                          onTap: () => _edit(t),
                                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                            Text('${t['title'] ?? ''}', style: TextStyle(
                                              fontWeight: FontWeight.w700, fontSize: 13,
                                              color: done ? T.inkFaint : T.ink,
                                              decoration: done ? TextDecoration.lineThrough : null,
                                            )),
                                            Text([_company(t['company']), _user(t['assignedTo']), _date(t['dueDate'])].where((x) => x.isNotEmpty).join(' · '),
                                                style: const TextStyle(fontSize: 11.5, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis),
                                            const SizedBox(height: 4),
                                            Wrap(spacing: 4, runSpacing: 4, children: [
                                              if (overdue) Chip2(tr('متأخرة', 'Overdue'), T.danger),
                                              Chip2(crmOptLabel(prios, t['priority']), _prioColor[t['priority']] ?? T.inkSoft),
                                              Chip2(crmOptLabel(statuses, t['status']), _statusColor[t['status']] ?? T.inkSoft),
                                            ]),
                                          ]),
                                        ),
                                      ),
                                      IconButton(
                                        tooltip: tr('حذف', 'Delete'),
                                        onPressed: () => _remove(t),
                                        icon: const Icon(Icons.delete_outline, color: T.danger, size: 20),
                                      ),
                                    ]),
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
