import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'business_review_kit.dart';

/// A meeting's departments as cards (the web's BrMeetingDepartments): each department's tasks with counts by state;
/// a task opens in place with its detail, and the administration marks it done, postpones it, updates it, or raises a
/// follow-up or a new task for the department.
class BrMeetingDepartmentsTab extends StatefulWidget {
  final String meetingId;
  final Map<String, dynamic> meta;
  const BrMeetingDepartmentsTab({super.key, required this.meetingId, required this.meta});
  @override
  State<BrMeetingDepartmentsTab> createState() => _BrMeetingDepartmentsTabState();
}

// key, ar, en, color, test
final _chips = <(String, String, String, Color, bool Function(Map))>[
  ('overdue', 'متأخر', 'Overdue', T.danger, (t) => t['overdue'] == true),
  ('in_progress', 'قيد التنفيذ', 'In progress', T.info, (t) => t['status'] == 'in_progress'),
  ('open', 'لم يبدأ', 'Not started', T.inkSoft, (t) => t['status'] == 'open'),
  ('postponed', 'مؤجَّل', 'Postponed', T.warn, (t) => t['status'] == 'postponed'),
  ('blocked', 'متعثر', 'Blocked', const Color(0xFFE11D48), (t) => t['status'] == 'blocked'),
  ('done', 'تم', 'Done', T.success, (t) => t['status'] == 'done'),
];

class _BrMeetingDepartmentsTabState extends State<BrMeetingDepartmentsTab> {
  Map<String, dynamic>? _d;
  String? _error;
  String _openDept = '';
  final Map<String, String> _filter = {};
  String _openTask = '';
  Timer? _tick;

  void _soon([dynamic _]) { _tick?.cancel(); _tick = Timer(const Duration(milliseconds: 400), _load); }

  @override
  void initState() {
    super.initState();
    Live.instance.on('br:action', _soon);
    Live.instance.on('br:meeting', _soon);
    _load();
  }

  @override
  void dispose() {
    Live.instance.off('br:action', _soon);
    Live.instance.off('br:meeting', _soon);
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await Api.instance.get('/api/business-review/meetings/${widget.meetingId}/departments');
      if (mounted) setState(() { _d = Map<String, dynamic>.from(r); _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = brErr(e));
    }
  }

  Future<void> _patch(String id, Map<String, dynamic> body, String ok) async {
    try {
      await Api.instance.patch('/api/business-review/actions/$id', body);
      if (mounted) brSnack(context, ok);
      _load();
    } catch (e) {
      if (mounted) brSnack(context, brErr(e));
    }
  }

  Future<void> _postpone(Map t) async {
    String newDue = '';
    final reason = TextEditingController();
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${tr('تأجيل', 'Postpone')}: ${t['title']}', style: const TextStyle(fontWeight: FontWeight.w900)),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () async {
              final d = await showDatePicker(context: c, initialDate: DateTime.now().add(const Duration(days: 1)), firstDate: DateTime.now(), lastDate: DateTime(2100));
              if (d != null) setS(() => newDue = brIsoDay(d));
            },
            icon: const Icon(Icons.event),
            label: Text(newDue.isEmpty ? tr('الموعد الجديد *', 'New date *') : newDue),
          ),
          const SizedBox(height: 8),
          TextField(controller: reason, decoration: InputDecoration(labelText: tr('السبب *', 'Reason *'))),
          const SizedBox(height: 12),
          SizedBox(width: double.infinity, child: FilledButton(
            onPressed: () { if (newDue.isNotEmpty && reason.text.trim().isNotEmpty) Navigator.pop(c, true); },
            child: Text(tr('حفظ', 'Save')),
          )),
        ]),
      )),
    );
    if (ok == true) _patch('${t['_id']}', {'status': 'postponed', 'newDueDate': newDue, 'postponeReason': reason.text.trim()}, tr('اتأجّل', 'Postponed'));
  }

  Future<void> _update(Map t) async {
    final v = await brProgressSheet(context, widget.meta, '${t['title']}', '${t['status']}', (t['progress'] ?? 0) as num, expectedDate: t['expectedDate']);
    if (v != null) _patch('${t['_id']}', v, tr('اتحدّث', 'Updated'));
  }

  /// A new task for a department, or a follow-up on one task (same owner by default).
  Future<void> _newTask(String dept, {Map? followUpOf}) async {
    final people = List<Map<String, dynamic>>.from(widget.meta['participants'] ?? [])
      ..sort((a, b) => (b['section'] == dept ? 1 : 0) - (a['section'] == dept ? 1 : 0));
    final head = people.where((p) => p['section'] == dept && '${p['role']}'.endsWith('_manager')).firstOrNull
        ?? people.where((p) => p['section'] == dept).firstOrNull;
    String who = followUpOf != null ? '${followUpOf['assignee']}' : '${head?['_id'] ?? ''}';
    String due = '';
    final title = TextEditingController();
    final desc = TextEditingController();
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) {
        final whoName = people.where((p) => '${p['_id']}' == who).map((p) => '${p['name']}').firstOrNull ?? tr('اختر المسؤول', 'Pick the owner');
        return Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(followUpOf != null ? '${tr('بند متابعة على', 'Follow-up on')}: ${followUpOf['title']}' : '${tr('بند جديد لقسم', 'New task for')} ${brDept(context, dept)}',
                style: const TextStyle(fontWeight: FontWeight.w900)),
            const SizedBox(height: 10),
            TextField(controller: title, decoration: InputDecoration(labelText: tr('المطلوب *', 'What needs doing *'))),
            const SizedBox(height: 8),
            TextField(controller: desc, maxLines: 2, decoration: InputDecoration(labelText: tr('تفاصيل (اختياري)', 'Details (optional)'))),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () async {
                final p = await brPickPerson(c, people, title: tr('المسؤول', 'Owner'));
                if (p != null) setS(() => who = '${p['_id']}');
              },
              icon: const Icon(Icons.person_outline),
              label: Text(whoName),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () async {
                final d = await showDatePicker(context: c, initialDate: DateTime.now().add(const Duration(days: 1)), firstDate: DateTime(2020), lastDate: DateTime(2100));
                if (d != null) setS(() => due = brIsoDay(d));
              },
              icon: const Icon(Icons.event),
              label: Text(due.isEmpty ? tr('موعد التسليم', 'Due date') : due),
            ),
            const SizedBox(height: 12),
            SizedBox(width: double.infinity, child: FilledButton(
              onPressed: () { if (title.text.trim().isNotEmpty && who.isNotEmpty) Navigator.pop(c, true); },
              child: Text(tr('إضافة', 'Add')),
            )),
          ]),
        );
      }),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/business-review/meetings/${widget.meetingId}/actions', {
        'title': title.text.trim(), 'description': desc.text.trim(), 'assignee': who, 'department': dept,
        if (due.isNotEmpty) 'dueDate': due,
        if (followUpOf != null) 'followUpOf': '${followUpOf['_id']}',
      });
      if (mounted) brSnack(context, tr('اتضاف البند', 'Task added'));
      _load();
    } catch (e) {
      if (mounted) brSnack(context, brErr(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) return ErrorRetry(message: _error!, onRetry: _load);
    final d = _d;
    if (d == null) return const Center(child: CircularProgressIndicator());
    final cards = List<Map<String, dynamic>>.from(d['departments'] ?? []);
    final canEdit = d['canEdit'] == true;
    int sum(String k) => cards.fold(0, (a, c) => a + ((c['counts']?[k] ?? 0) as num).toInt());
    final active = sum('in_progress') + sum('open') + sum('blocked') + sum('postponed');

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(12), children: [
        Wrap(spacing: 6, runSpacing: 6, children: [
          Chip2('${tr('كل البنود', 'All tasks')}: ${sum('total')}', T.navy),
          Chip2('${tr('تم', 'Done')}: ${sum('done')}', T.success),
          Chip2('${tr('لسه شغالة', 'Still open')}: $active', T.info),
          Chip2('${tr('متأخر', 'Overdue')}: ${sum('overdue')}', T.danger),
        ]),
        const SizedBox(height: 10),
        for (final c in cards) _card(c, canEdit),
        if (cards.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(tr('مفيش أقسام في الاجتماع ده.', 'No departments in this meeting.')))),
      ]),
    );
  }

  Widget _card(Map<String, dynamic> c, bool canEdit) {
    final key = '${c['key']}';
    final counts = Map<String, dynamic>.from(c['counts'] ?? {});
    final tasks = List<Map<String, dynamic>>.from(c['tasks'] ?? []);
    final open = _openDept == key;
    final f = _filter[key] ?? '';
    final chip = _chips.where((x) => x.$1 == f).firstOrNull;
    final shown = chip == null ? tasks : tasks.where((t) => chip.$5(t)).toList();
    final total = (counts['total'] ?? 0) as num;
    final done = (counts['done'] ?? 0) as num;
    final pct = total == 0 ? 0.0 : done / total;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(color: T.card, borderRadius: BorderRadius.circular(14),
          border: Border.all(color: ((counts['overdue'] ?? 0) as num) > 0 ? T.danger : const Color(0xFFCBD5E1), width: 1.5)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        InkWell(
          onTap: () => setState(() { _openDept = open ? '' : key; _openTask = ''; }),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 6),
            child: Row(children: [
              const Icon(Icons.layers_outlined, color: T.orange),
              const SizedBox(width: 8),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(key == 'Unassigned' ? tr('بدون قسم', 'No department') : brDept(context, key), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16.5)),
                Text('$total ${tr('بند', 'tasks')} · ${tr('تم', 'done')} $done (${(pct * 100).round()}%)'
                    '${((counts['today'] ?? 0) as num) > 0 ? ' · ${tr('اتاخد النهارده', 'raised today')} ${counts['today']}' : ''}',
                    style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Color(0xFF334155))),
              ])),
              Icon(open ? Icons.expand_less : Icons.expand_more, color: T.inkFaint),
            ]),
          ),
        ),
        Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: LinearProgressIndicator(value: pct, minHeight: 5, color: T.success, backgroundColor: T.line)),
        Padding(
          padding: const EdgeInsets.all(10),
          child: Wrap(spacing: 6, runSpacing: 6, children: [
            for (final x in _chips) _countChip(x, (counts[x.$1] ?? 0) as num, f == x.$1, () => setState(() { _filter[key] = f == x.$1 ? '' : x.$1; _openDept = key; })),
          ]),
        ),
        if (open) ...[
          const Divider(height: 1),
          if (shown.isEmpty) Padding(padding: const EdgeInsets.all(16), child: Center(child: Text(tr('مفيش بنود هنا.', 'No tasks here.'), style: const TextStyle(color: T.inkFaint)))),
          for (final t in shown) _task(t, key, canEdit),
          if (canEdit)
            Padding(
              padding: const EdgeInsets.all(8),
              child: TextButton.icon(onPressed: () => _newTask(key), icon: const Icon(Icons.add), label: Text(tr('بند جديد للقسم ده', 'New task for this department'))),
            ),
        ],
      ]),
    );
  }

  Widget _task(Map<String, dynamic> t, String dept, bool canEdit) {
    final open = _openTask == '${t['_id']}';
    final st = brVocab(widget.meta['actionStatuses'] as List?, '${t['status']}');
    final done = t['status'] == 'done';
    final overdue = t['overdue'] == true;
    return Container(
      color: open ? T.orange.withValues(alpha: 0.04) : null,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        InkWell(
          onTap: () => setState(() => _openTask = open ? '' : '${t['_id']}'),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${t['title']}', style: TextStyle(fontWeight: FontWeight.w800, decoration: done ? TextDecoration.lineThrough : null, color: done ? T.inkFaint : T.ink)),
              const SizedBox(height: 4),
              Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                Text('${t['assigneeName']}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                Text('· ${brDate(t['dueDate'])}', style: TextStyle(fontSize: 12, color: overdue ? T.danger : T.inkFaint, fontWeight: overdue ? FontWeight.w800 : null)),
                if (overdue) Chip2(tr('متأخر', 'Overdue'), T.danger),
                Chip2(st.label, st.color),
                Text('${t['progress'] ?? 0}%', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
              ]),
            ]),
          ),
        ),
        if (open)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if ('${t['description'] ?? ''}'.isNotEmpty)
                Container(
                  width: double.infinity, padding: const EdgeInsets.all(8), margin: const EdgeInsets.only(bottom: 6),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8), border: Border.all(color: T.line)),
                  child: Text('${t['description']}', style: const TextStyle(fontSize: 13)),
                ),
              _line(tr('المسؤول', 'Owner'), '${t['assigneeName']}'),
              if ('${t['raisedByName'] ?? ''}'.isNotEmpty) _line(tr('طلبه', 'Requested by'), '${t['raisedByName']}'),
              _line(tr('اتاخد في', 'Raised in'), '${t['meetingRef']} · ${brDate(t['meetingDate'] ?? t['createdAt'])}${t['fromThisMeeting'] == true ? ' (${tr('الاجتماع ده', 'this meeting')})' : ''}'),
              _line(tr('التسليم', 'Due'), brDate(t['dueDate']), color: overdue ? T.danger : null),
              if (t['completedAt'] != null) _line(tr('اتنفّذ', 'Completed'), brDate(t['completedAt']), color: T.success),
              if (brDatesLine(t).isNotEmpty) Text(brDatesLine(t), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
              if ('${t['postponeReason'] ?? ''}'.isNotEmpty) _line(tr('سبب التأجيل', 'Postponed because'), '${t['postponeReason']}', color: T.warn),
              if (t['followUpOf'] != null) _line(tr('متابعة لـ', 'Follow-up of'), '${t['followUpOf']['title']}', color: T.violet),
              if (List.from(t['followUps'] ?? []).isNotEmpty)
                _line(tr('بنود متابعة', 'Follow-ups'), List.from(t['followUps']).map((x) => '${x['title']} (${brVocab(widget.meta['actionStatuses'] as List?, '${x['status']}').label})').join('، '), color: T.violet),
              if (canEdit) ...[
                const SizedBox(height: 8),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  if (!done) FilledButton.icon(style: FilledButton.styleFrom(backgroundColor: T.success),
                      onPressed: () => _patch('${t['_id']}', {'status': 'done', 'progress': 100}, tr('اتسجّل إنه تم', 'Marked done')),
                      icon: const Icon(Icons.check, size: 16), label: Text(tr('تم', 'Done'))),
                  if (!done) FilledButton.icon(style: FilledButton.styleFrom(backgroundColor: T.warn),
                      onPressed: () => _postpone(t), icon: const Icon(Icons.pause, size: 16), label: Text(tr('تأجيل', 'Postpone'))),
                  OutlinedButton.icon(onPressed: () => _update(t), icon: const Icon(Icons.trending_up, size: 16), label: Text(tr('تحديث الحالة', 'Update status'))),
                  OutlinedButton.icon(onPressed: () => _newTask(dept, followUpOf: t), icon: const Icon(Icons.add, size: 16), label: Text(tr('بند متابعة عليه', 'Follow-up task'))),
                ]),
              ],
              BrUpdateLog(updates: List.from(t['updates'] ?? []).reversed.toList(), meta: widget.meta),
            ]),
          ),
        const Divider(height: 1),
      ]),
    );
  }

  /// Solid colour with white text when there is something to count; grey but readable at zero.
  Widget _countChip((String, String, String, Color, bool Function(Map)) x, num n, bool on, VoidCallback onTap) {
    final has = n > 0;
    return InkWell(
      onTap: has ? onTap : null,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: has ? x.$4 : const Color(0xFFF1F5F9),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: on ? T.orange : (has ? x.$4 : const Color(0xFFE2E8F0)), width: on ? 2.5 : 1),
        ),
        child: Text('${tr(x.$2, x.$3)}  ${n.toInt()}',
            style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w900, color: has ? Colors.white : const Color(0xFF475569))),
      ),
    );
  }

  Widget _line(String k, String v, {Color? color}) => Padding(
    padding: const EdgeInsets.only(bottom: 3),
    child: Text.rich(TextSpan(children: [
      TextSpan(text: '$k: ', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
      TextSpan(text: v, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: color ?? T.ink)),
    ])),
  );
}
