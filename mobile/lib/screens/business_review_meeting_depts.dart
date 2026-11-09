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
  /// Inside another scrolling page (the meetings tab): a plain column instead of its own list.
  final bool embedded;
  /// Heading of each department's part of the minutes.
  final String? minutesLabel;
  const BrMeetingDepartmentsTab({super.key, required this.meetingId, required this.meta, this.embedded = false, this.minutesLabel});
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

const _horizon = [('h48', 'خلال ٤٨ ساعة', 'Within 48h'), ('week', 'خلال أسبوع', 'Within a week'), ('later', 'لاحقًا', 'Later'), ('nodate', 'بلا موعد', 'No date')];

/// A company day; Friday is the weekend, so it moves to Saturday.
String _dayAfter(int n) {
  var d = DateTime.now().add(Duration(days: n));
  if (d.weekday == DateTime.friday) d = d.add(const Duration(days: 1));
  return brIsoDay(d);
}
String _next(int weekday) {
  final now = DateTime.now();
  var add = (weekday - now.weekday + 7) % 7;
  if (add == 0) add = 7;
  return brIsoDay(now.add(Duration(days: add)));
}
final _quickDates = <(String, String, String Function())>[
  ('غدًا', 'Tomorrow', () => _dayAfter(1)),
  ('بعد يومين', 'In 2 days', () => _dayAfter(2)),
  ('الأحد القادم', 'Next Sunday', () => _next(DateTime.sunday)),
  ('نهاية الأسبوع (الخميس)', 'End of week (Thu)', () => _next(DateTime.thursday)),
  ('بعد أسبوع', 'In a week', () => _dayAfter(7)),
  ('بعد أسبوعين', 'In 2 weeks', () => _dayAfter(14)),
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
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final q in _quickDates)
              ChoiceChip(label: Text('${tr(q.$1, q.$2)} · ${q.$3().split('-').reversed.join('/')}', style: const TextStyle(fontSize: 12)),
                  selected: newDue == q.$3(), onSelected: (_) => setS(() => newDue = q.$3())),
          ]),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () async {
              final d = await showDatePicker(context: c, initialDate: DateTime.now().add(const Duration(days: 1)), firstDate: DateTime.now(), lastDate: DateTime(2100));
              if (d != null) setS(() => newDue = brIsoDay(d));
            },
            icon: const Icon(Icons.event),
            label: Text(newDue.isEmpty ? tr('الموعد الجديد *', 'New date *') : newDue),
          ),
          const SizedBox(height: 8),
          TextField(controller: reason, decoration: InputDecoration(labelText: tr('سبب التأجيل (اختياري)', 'Reason (optional)'))),
          const SizedBox(height: 12),
          SizedBox(width: double.infinity, child: FilledButton(
            onPressed: () { if (newDue.isNotEmpty) Navigator.pop(c, true); },
            child: Text(tr('تسجيل التأجيل', 'Save postponement')),
          )),
        ]),
      )),
    );
    if (ok == true) _patch('${t['_id']}', {'status': 'postponed', 'newDueDate': newDue, 'postponeReason': reason.text.trim()}, tr('تم تأجيل البند', 'Postponed'));
  }

  /// Edit what the task is: title, details, owner, due date and priority. Shared owners get the same text, priority and date.
  Future<void> _edit(Map t) async {
    final people = List<Map<String, dynamic>>.from(widget.meta['participants'] ?? []);
    final prios = List<Map<String, dynamic>>.from(widget.meta['priorities'] ?? []);
    final title = TextEditingController(text: '${t['title'] ?? ''}');
    final desc = TextEditingController(text: '${t['description'] ?? ''}');
    String who = '${t['assignee'] is Map ? t['assignee']['_id'] : t['assignee'] ?? ''}';
    String due = t['dueDate'] == null ? '' : brIsoDay(DateTime.parse('${t['dueDate']}').toLocal());
    String prio = '${t['priority'] ?? 'medium'}';
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) {
        final whoName = people.where((p) => '${p['_id']}' == who).map((p) => '${p['name']}').firstOrNull ?? '${t['assigneeName'] ?? ''}';
        return Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('تعديل البند', 'Edit task'), style: const TextStyle(fontWeight: FontWeight.w900)),
            const SizedBox(height: 10),
            TextField(controller: title, decoration: InputDecoration(labelText: tr('نص البند *', 'Task *'))),
            const SizedBox(height: 8),
            TextField(controller: desc, maxLines: 3, decoration: InputDecoration(labelText: tr('التفاصيل', 'Details'))),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () async {
                final p = await brPickPerson(c, people, title: tr('المسؤول', 'Owner'));
                if (p != null) setS(() => who = '${p['_id']}');
              },
              icon: const Icon(Icons.person_outline), label: Text(whoName),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () async {
                final d = await showDatePicker(context: c, initialDate: DateTime.tryParse(due) ?? DateTime.now(), firstDate: DateTime(2020), lastDate: DateTime(2100));
                if (d != null) setS(() => due = brIsoDay(d));
              },
              icon: const Icon(Icons.event), label: Text(due.isEmpty ? tr('موعد التسليم', 'Due date') : due),
            ),
            if (prios.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(spacing: 6, children: [
                for (final pr in prios)
                  ChoiceChip(label: Text(tr('${pr['ar']}', '${pr['en']}'), style: const TextStyle(fontSize: 12)), selected: prio == '${pr['key']}', onSelected: (_) => setS(() => prio = '${pr['key']}')),
              ]),
            ],
            if (List.from(t['sharedWith'] ?? []).isNotEmpty)
              Padding(padding: const EdgeInsets.only(top: 6), child: Text(tr('النصُّ والتفاصيلُ والأولويّةُ والموعدُ تتغيّر عند كلّ المشتركين فيه.', 'Text, details, priority and date change for every owner sharing it.'), style: const TextStyle(fontSize: 11.5, color: T.info))),
            const SizedBox(height: 12),
            SizedBox(width: double.infinity, child: FilledButton(
              onPressed: () { if (title.text.trim().isNotEmpty) Navigator.pop(c, true); },
              child: Text(tr('حفظ التعديل', 'Save')),
            )),
          ]),
        );
      }),
    );
    if (ok == true) {
      _patch('${t['_id']}', {'title': title.text.trim(), 'description': desc.text.trim(), 'assignee': who, 'dueDate': due.isEmpty ? null : due, 'priority': prio}, tr('حُفظ تعديل البند', 'Saved'));
    }
  }

  /// Give the same task to another owner too; it appears in their department card and their own list.
  Future<void> _share(Map t) async {
    final people = List<Map<String, dynamic>>.from(widget.meta['participants'] ?? []);
    final owner = '${t['assignee'] is Map ? t['assignee']['_id'] : t['assignee'] ?? ''}';
    final taken = [owner, ...List<Map>.from(t['sharedWith'] ?? []).map((x) => '${x['assignee']}')];
    final p = await brPickPerson(context, people, exclude: taken, title: tr('إسناده لمسؤولٍ آخر أيضًا', 'Also assign to'));
    if (p == null) return;
    try {
      await Api.instance.post('/api/business-review/actions/${t['_id']}/share', {'assignee': '${p['_id']}'});
      if (mounted) brSnack(context, tr('أُسند البند إليه أيضًا وظهر في قسمه', 'Shared'));
      _load();
    } catch (e) {
      if (mounted) brSnack(context, brErr(e));
    }
  }

  Future<void> _update(Map t) async {
    final v = await brProgressSheet(context, widget.meta, '${t['title']}', '${t['status']}', (t['progress'] ?? 0) as num, expectedDate: t['expectedDate']);
    if (v != null) _patch('${t['_id']}', v, tr('تم تحديث البند', 'Updated'));
  }

  /// A new task for a department, or a follow-up on one task (same owner by default).
  Future<void> _newTask(String dept, {Map? followUpOf}) async {
    final people = List<Map<String, dynamic>>.from(widget.meta['participants'] ?? [])
      ..sort((a, b) => (b['section'] == dept ? 1 : 0) - (a['section'] == dept ? 1 : 0));
    // The department head: the CFO for finance, else the section's manager.
    final head = people.where((p) => p['section'] == dept && p['role'] == 'cfo').firstOrNull
        ?? people.where((p) => p['section'] == dept && '${p['role']}'.endsWith('_manager')).firstOrNull
        ?? people.where((p) => p['section'] == dept).firstOrNull;
    String who = followUpOf != null ? '${followUpOf['assignee']}' : '${head?['_id'] ?? ''}';
    // Other owners from any department: one task, a row per owner, each in its own department card.
    final also = <String>[];
    String nameOf(String id) {
      final p = people.where((x) => '${x['_id']}' == id).firstOrNull;
      return p == null ? id : '${p['name']}${'${p['section'] ?? ''}'.isNotEmpty ? ' — ${brDept(context, '${p['section']}')}' : ''}';
    }
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
            TextField(controller: title, decoration: InputDecoration(labelText: tr('نص البند *', 'Task *'))),
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
            const SizedBox(height: 8),
            Text(tr('وإسناده أيضًا إلى', 'Also assign to'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
            Wrap(spacing: 6, runSpacing: 4, children: [
              for (final id in also) InputChip(label: Text(nameOf(id), style: const TextStyle(fontSize: 12)), onDeleted: () => setS(() => also.remove(id))),
              ActionChip(
                avatar: const Icon(Icons.person_add_alt, size: 16),
                label: Text(tr('مسؤولٌ آخر (أيّ قسم)', 'Another owner (any department)'), style: const TextStyle(fontSize: 12)),
                onPressed: () async {
                  final p = await brPickPerson(c, people, exclude: [who, ...also], title: tr('وإسناده أيضًا إلى', 'Also assign to'));
                  if (p != null) setS(() => also.add('${p['_id']}'));
                },
              ),
            ]),
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
        'assignees': [who, ...also.where((x) => x != who)],
        if (due.isNotEmpty) 'dueDate': due,
        if (followUpOf != null) 'followUpOf': '${followUpOf['_id']}',
      });
      if (mounted) brSnack(context, tr('أُضيف البند', 'Task added'));
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

    final children = <Widget>[
        Wrap(spacing: 6, runSpacing: 6, children: [
          Chip2('${tr('كل البنود', 'All tasks')}: ${sum('total')}', T.navy),
          Chip2('${tr('تم', 'Done')}: ${sum('done')}', T.success),
          Chip2('${tr('مفتوحة', 'Open')}: $active', T.info),
          Chip2('${tr('متأخر', 'Overdue')}: ${sum('overdue')}', T.danger),
          Chip2('${tr('للنقاش اليوم', 'For discussion today')}: ${sum('agenda')}', T.orange),
        ]),
        const SizedBox(height: 6),
        Text(d['scope'] == 'series'
            ? tr('جميع البنود التي أُسندت في هذا الاجتماع منذ بدايته، موزّعة على الأقسام. اضغط على القسم لعرض بنوده.', 'Every task raised in this recurring meeting, by department. Tap a department to see its tasks.')
            : tr('بنود هذا الاجتماع موزّعة على الأقسام. اضغط على القسم لعرض بنوده.', 'This meeting’s tasks by department. Tap a department to see its tasks.'),
            style: const TextStyle(fontSize: 12, color: Color(0xFF334155))),
        const SizedBox(height: 10),
        for (final c in cards) _card(c, canEdit),
        if (cards.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(tr('لا توجد أقسام في هذا الاجتماع.', 'No departments in this meeting.')))),
    ];
    if (widget.embedded) return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children);
    return RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(12), children: children));
  }

  Widget _card(Map<String, dynamic> c, bool canEdit) {
    final key = '${c['key']}';
    final counts = Map<String, dynamic>.from(c['counts'] ?? {});
    final tasks = List<Map<String, dynamic>>.from(c['tasks'] ?? []);
    final open = _openDept == key;
    final f = _filter[key] ?? '';
    final chip = _chips.where((x) => x.$1 == f).firstOrNull;
    final shown = chip != null ? tasks.where((t) => chip.$5(t)).toList() : f.isNotEmpty ? tasks.where((t) => t['horizon'] == f).toList() : tasks;
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
                if (List.from(c['managers'] ?? []).isNotEmpty)
                  Text('${tr('المدير', 'Manager')}: ${List.from(c['managers']).join('، ')}', style: const TextStyle(fontSize: 12.5, color: Color(0xFF334155))),
                Text(((counts['agenda'] ?? 0) as num) > 0 ? '${tr('للنقاش اليوم', 'For discussion today')}: ${counts['agenda']}' : tr('لا بنود للنقاش اليوم', 'Nothing for discussion today'),
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: ((counts['agenda'] ?? 0) as num) > 0 ? T.orange : T.inkFaint)),
                Text('$total ${tr('بند', 'tasks')} · ${tr('تم', 'done')} $done (${(pct * 100).round()}%)'
                    '${((counts['today'] ?? 0) as num) > 0 ? ' · ${tr('أُسند في هذا الاجتماع', 'raised in this meeting')} ${counts['today']}' : ''}',
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
        Padding(
          padding: const EdgeInsets.fromLTRB(10, 0, 10, 10),
          child: Row(children: [
            for (final h in _horizon)
              Expanded(child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2),
                child: InkWell(
                  onTap: ((counts[h.$1] ?? 0) as num) == 0 ? null : () => setState(() { _filter[key] = f == h.$1 ? '' : h.$1; _openDept = key; }),
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: f == h.$1 ? T.orange : const Color(0xFFCBD5E1), width: f == h.$1 ? 2 : 1)),
                    child: Column(children: [
                      Text('${counts[h.$1] ?? 0}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: ((counts[h.$1] ?? 0) as num) > 0 ? (h.$1 == 'h48' ? T.orange : T.ink) : T.inkFaint)),
                      Text(tr(h.$2, h.$3), style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: Color(0xFF475569)), textAlign: TextAlign.center),
                    ]),
                  ),
                ),
              )),
          ]),
        ),
        if (c['inMinutes'] == true)
          Container(
            margin: const EdgeInsets.fromLTRB(10, 0, 10, 10),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: '${c['minutes'] ?? ''}'.isNotEmpty ? T.success.withValues(alpha: 0.06) : const Color(0xFFF8FAFC),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: '${c['minutes'] ?? ''}'.isNotEmpty ? T.success.withValues(alpha: 0.4) : const Color(0xFFE2E8F0)),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${widget.minutesLabel ?? tr('محضر القسم في هذا الاجتماع', 'This meeting’s minutes')}: ${'${c['minutes'] ?? ''}'.isNotEmpty ? tr('مكتوب', 'written') : tr('لم يُكتب بعد', 'not written yet')}',
                  style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w900, color: '${c['minutes'] ?? ''}'.isNotEmpty ? T.success : const Color(0xFF475569))),
              if ('${c['minutes'] ?? ''}'.isNotEmpty)
                Text('${c['minutes']}', maxLines: open ? null : 2, overflow: open ? null : TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5)),
            ]),
          ),
        if (open) ...[
          const Divider(height: 1),
          if (shown.isEmpty) Padding(padding: const EdgeInsets.all(16), child: Center(child: Text(tr('لا توجد بنود هنا.', 'No tasks here.'), style: const TextStyle(color: T.inkFaint)))),
          for (final t in shown) _task(t, key, canEdit),
          if (canEdit)
            Padding(
              padding: const EdgeInsets.all(8),
              child: TextButton.icon(onPressed: () => _newTask(key), icon: const Icon(Icons.add), label: Text(tr('إضافة بند لهذا القسم', 'New task for this department'))),
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
              if (List.from(t['sharedWith'] ?? []).isNotEmpty)
                _line(tr('مشترك مع', 'Shared with'), List<Map>.from(t['sharedWith']).map((x) =>
                    '${x['assigneeName']} (${brDept(context, '${x['department'] ?? ''}')} · ${brVocab(widget.meta['actionStatuses'] as List?, '${x['status']}').label} ${x['progress'] ?? 0}%)').join('، '), color: T.info),
              if ('${t['raisedByName'] ?? ''}'.isNotEmpty) _line(tr('بطلب من', 'Requested by'), '${t['raisedByName']}'),
              _line(tr('أُسند في', 'Raised in'), '${t['meetingRef']} · ${brDate(t['meetingDate'] ?? t['createdAt'])}${t['fromThisMeeting'] == true ? ' (${tr('هذا الاجتماع', 'this meeting')})' : ''}'),
              _line(tr('التسليم', 'Due'), brDate(t['dueDate']), color: overdue ? T.danger : null),
              if (t['completedAt'] != null) _line(tr('أُنجز في', 'Completed'), brDate(t['completedAt']), color: T.success),
              if (brDatesLine(t).isNotEmpty) Text(brDatesLine(t), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
              if ('${t['postponeReason'] ?? ''}'.isNotEmpty) _line(tr('سبب التأجيل', 'Postponed because'), '${t['postponeReason']}', color: T.warn),
              if (List.from(t['delegations'] ?? []).isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(tr('موزّع على الفريق', 'Handed to the team'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w900)),
                for (final x in List<Map<String, dynamic>>.from(t['delegations']))
                  Text('• ${x['assigneeName']} — ${x['title']} · ${brVocab(widget.meta['actionStatuses'] as List?, '${x['status']}').label} ${x['progress'] ?? 0}%',
                      style: const TextStyle(fontSize: 12.5, color: Color(0xFF334155))),
              ],
              if (t['followUpOf'] != null) _line(tr('متابعة لـ', 'Follow-up of'), '${t['followUpOf']['title']}', color: T.violet),
              if (List.from(t['followUps'] ?? []).isNotEmpty)
                _line(tr('بنود متابعة', 'Follow-ups'), List.from(t['followUps']).map((x) => '${x['title']} (${brVocab(widget.meta['actionStatuses'] as List?, '${x['status']}').label})').join('، '), color: T.violet),
              if (canEdit) ...[
                const SizedBox(height: 8),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  if (!done) FilledButton.icon(style: FilledButton.styleFrom(backgroundColor: T.success),
                      onPressed: () => _patch('${t['_id']}', {'status': 'done', 'progress': 100}, tr('سُجّل البند منجزًا', 'Marked done')),
                      icon: const Icon(Icons.check, size: 16), label: Text(tr('تم الإنجاز', 'Mark done'))),
                  if (!done) FilledButton.icon(style: FilledButton.styleFrom(backgroundColor: T.warn),
                      onPressed: () => _postpone(t), icon: const Icon(Icons.pause, size: 16), label: Text(tr('تأجيل', 'Postpone'))),
                  OutlinedButton.icon(onPressed: () => _update(t), icon: const Icon(Icons.trending_up, size: 16), label: Text(tr('تحديث الحالة', 'Update status'))),
                  OutlinedButton.icon(onPressed: () => _newTask(dept, followUpOf: t), icon: const Icon(Icons.add, size: 16), label: Text(tr('إضافة بند متابعة', 'Follow-up task'))),
                  OutlinedButton.icon(onPressed: () => _edit(t), icon: const Icon(Icons.edit_outlined, size: 16), label: Text(tr('تعديل البند', 'Edit task'))),
                  OutlinedButton.icon(onPressed: () => _share(t), icon: const Icon(Icons.group_add_outlined, size: 16), label: Text(tr('إسناده لمسؤولٍ آخر أيضًا', 'Also assign to…'))),
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
