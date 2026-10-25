import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../nav/sections.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// مراجعة الأعمال — أدواتٌ مشتركة بين القائمة وصفحة الاجتماع (BusinessReviewKit في الويب).

const brOpenStatuses = ['open', 'in_progress', 'blocked'];

/// مفاتيح الأقسام إنجليزيّةٌ من الخادم ('Software & IT') — لا تُطبع خامًا: تُترجم
/// من عناوين الأقسام نفسها في القائمة.
Map<String, (String, String)>? _deptLabels;
String brDept(BuildContext context, String? key) {
  if (key == null || key.isEmpty) return '—';
  _deptLabels ??= {
    for (final s in sectionsFor(Provider.of<AuthProvider>(context, listen: false))) s.key: (s.arTitle, s.enTitle),
  };
  final l = _deptLabels![key];
  return l == null ? key : tr(l.$1, l.$2);
}

Color brHex(String? s, [Color fb = T.inkFaint]) {
  if (s == null || !s.startsWith('#') || s.length != 7) return fb;
  return Color(int.parse('FF${s.substring(1)}', radix: 16));
}

String brDate(dynamic v) {
  final d = v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
  return d == null ? '—' : '${d.day}/${d.month}/${d.year}';
}

String brDateTime(dynamic v) {
  final d = v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
  if (d == null) return '—';
  return '${d.day}/${d.month}/${d.year} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

String brIsoDay(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// مفتاحٌ في أحد قواميس الخادم (/meta).
({String label, Color color}) brVocab(List? list, String? key) {
  for (final v in (list ?? [])) {
    if (v['key'] == key) {
      return (label: tr((v['ar'] ?? '').toString(), (v['en'] ?? '').toString()), color: brHex(v['color'] as String?));
    }
  }
  return (label: key ?? '—', color: T.inkFaint);
}

const brAttendance = [
  ('attended', 'حضر', 'Present', Color(0xFF16A34A)),
  ('absent', 'لم يحضر', 'Absent', Color(0xFFDC2626)),
  ('excused', 'اعتذر', 'Excused', Color(0xFFD97706)),
  ('invited', 'مدعو', 'Invited', Color(0xFF94A3B8)),
];

({String label, Color color}) brAttendanceOf(String? k) {
  for (final a in brAttendance) {
    if (a.$1 == (k ?? 'invited')) return (label: tr(a.$2, a.$3), color: a.$4);
  }
  return (label: k ?? '—', color: T.inkFaint);
}

/// موعد التسليم كما يُقرأ: متأخر / اليوم / باقي — dueLabel في الويب.
({String text, Color color}) brDue(dynamic due, String? status) {
  final d = due == null ? null : DateTime.tryParse(due.toString())?.toLocal();
  if (d == null) return (text: '—', color: T.inkFaint);
  if (status == 'done' || status == 'cancelled') return (text: brDate(due), color: T.inkFaint);
  final days = (d.difference(DateTime.now()).inHours / 24).ceil();
  if (days < 0) return (text: tr('متأخر ${-days} يوم', '${-days}d overdue'), color: T.danger);
  if (days == 0) return (text: tr('اليوم', 'Due today'), color: T.warn);
  return (text: tr('باقي $days يوم', '${days}d left'), color: days <= 2 ? T.warn : T.inkFaint);
}

String brErr(Object e) => e is ApiException ? e.message : e.toString();

void brSnack(BuildContext context, String msg) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
}

Future<bool> brConfirm(BuildContext context, String title, String message, {String? ok, bool danger = false}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
      content: Text(message, style: const TextStyle(fontSize: 12.5, height: 1.5)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: danger ? T.danger : T.orange),
          onPressed: () => Navigator.pop(c, true),
          child: Text(ok ?? tr('تأكيد', 'Confirm')),
        ),
      ],
    ),
  );
  return r == true;
}

/// اختيار شخص بالبحث — PersonSelect في الويب.
Future<Map<String, dynamic>?> brPickPerson(BuildContext context, List<Map<String, dynamic>> people,
    {List<String> exclude = const [], String? title}) {
  var q = '';
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    builder: (c) => StatefulBuilder(builder: (c, setS) {
      final list = people.where((p) {
        if (exclude.contains(p['_id'])) return false;
        final s = q.trim().toLowerCase();
        return s.isEmpty || '${p['name']} ${p['department'] ?? ''} ${p['jobTitle'] ?? ''} ${p['role'] ?? ''}'.toLowerCase().contains(s);
      }).toList();
      return SafeArea(
        child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.7,
          child: Column(children: [
            Padding(
              padding: EdgeInsets.fromLTRB(14, 14, 14, 8 + MediaQuery.of(c).viewInsets.bottom * 0),
              child: TextField(
                autofocus: true,
                decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: title ?? tr('ابحث بالاسم أو القسم…', 'Search by name or department…'), isDense: true),
                onChanged: (v) => setS(() => q = v),
              ),
            ),
            Expanded(
              child: ListView.builder(
                itemCount: list.length,
                itemBuilder: (_, i) {
                  final p = list[i];
                  return ListTile(
                    dense: true,
                    title: Text((p['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text([p['department'], p['jobTitle']].where((x) => x != null && '$x'.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11)),
                    trailing: p['isExecutive'] == true ? Chip2(tr('الإدارة', 'Board'), T.orange) : null,
                    onTap: () => Navigator.pop(c, p),
                  );
                },
              ),
            ),
          ]),
        ),
      );
    }),
  );
}

/// تحديث الحالة والنسبة مع ملاحظة — ProgressForm في الويب.
Future<Map<String, dynamic>?> brProgressSheet(BuildContext context, Map<String, dynamic> meta, String title, String status, num progress) {
  var st = status;
  var pr = progress.toDouble();
  final note = TextEditingController();
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    builder: (c) => StatefulBuilder(
      builder: (c, setS) => Padding(
        padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            initialValue: st,
            decoration: InputDecoration(labelText: tr('الحالة', 'Status')),
            items: List<Map<String, dynamic>>.from(meta['actionStatuses'] ?? [])
                .map((s) => DropdownMenuItem(value: s['key'].toString(), child: Text(tr((s['ar'] ?? '').toString(), (s['en'] ?? '').toString()))))
                .toList(),
            onChanged: (v) => setS(() { st = v ?? st; if (st == 'done') pr = 100; }),
          ),
          const SizedBox(height: 14),
          Text('${tr('نسبة الإنجاز', 'Progress')}: ${pr.round()}%', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
          Slider(value: pr, min: 0, max: 100, divisions: 20, activeColor: T.orange, label: '${pr.round()}%', onChanged: (v) => setS(() => pr = v)),
          TextField(controller: note, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)'))),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: () => Navigator.pop(c, {'status': st, 'progress': pr.round(), 'note': note.text}),
              child: Text(tr('حفظ التحديث', 'Save update')),
            ),
          ),
        ]),
      ),
    ),
  );
}

/// توزيع البند على الفريق — DelegateForm في الويب: صفٌّ لكل موظف.
Future<List<Map<String, dynamic>>?> brDelegateSheet(BuildContext context, Map<String, dynamic> meta, List<Map<String, dynamic>> people, dynamic defaultDue) {
  final due = defaultDue == null ? '' : (DateTime.tryParse(defaultDue.toString()) == null ? '' : brIsoDay(DateTime.parse(defaultDue.toString()).toLocal()));
  Map<String, dynamic> blank() => {'assignee': '', 'assigneeName': '', 'title': TextEditingController(), 'instructions': TextEditingController(), 'dueDate': due, 'priority': 'medium'};
  final rows = [blank()];
  final priorities = List<Map<String, dynamic>>.from(meta['priorities'] ?? []);
  return showModalBottomSheet<List<Map<String, dynamic>>>(
    context: context,
    isScrollControlled: true,
    builder: (c) => StatefulBuilder(builder: (c, setS) {
      final valid = rows.where((r) => (r['assignee'] as String).isNotEmpty && (r['title'] as TextEditingController).text.trim().isNotEmpty).toList();
      return SafeArea(
        child: Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
          child: SizedBox(
            height: MediaQuery.of(c).size.height * 0.8,
            child: Column(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
                child: Row(children: [
                  const Icon(Icons.groups_outlined, color: T.orange),
                  const SizedBox(width: 6),
                  Expanded(child: Text(tr('توزيع المهمة على الفريق', 'Delegate to your team'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15))),
                ]),
              ),
              Expanded(
                child: ListView(padding: const EdgeInsets.symmetric(horizontal: 14), children: [
                  for (var i = 0; i < rows.length; i++)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: AppCard(
                        padding: const EdgeInsets.all(10),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          OutlinedButton.icon(
                            onPressed: () async {
                              final taken = [for (var j = 0; j < rows.length; j++) if (j != i && (rows[j]['assignee'] as String).isNotEmpty) rows[j]['assignee'] as String];
                              final p = await brPickPerson(c, people, exclude: taken);
                              if (p != null) setS(() { rows[i]['assignee'] = p['_id']; rows[i]['assigneeName'] = p['name']; });
                            },
                            icon: const Icon(Icons.person_search_outlined, size: 18),
                            label: Text((rows[i]['assigneeName'] as String).isEmpty ? tr('اختر موظفًا…', 'Pick a team member…') : rows[i]['assigneeName'] as String),
                          ),
                          const SizedBox(height: 8),
                          Row(children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed: () async {
                                  final cur = DateTime.tryParse(rows[i]['dueDate'] as String) ?? DateTime.now();
                                  final v = await showDatePicker(context: c, initialDate: cur, firstDate: DateTime(2020), lastDate: DateTime.now().add(const Duration(days: 730)));
                                  if (v != null) setS(() => rows[i]['dueDate'] = brIsoDay(v));
                                },
                                icon: const Icon(Icons.event, size: 16),
                                label: Text((rows[i]['dueDate'] as String).isEmpty ? tr('موعد التسليم', 'Due date') : rows[i]['dueDate'] as String, style: const TextStyle(fontSize: 12)),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: DropdownButtonFormField<String>(
                                initialValue: priorities.any((p) => p['key'] == rows[i]['priority']) ? rows[i]['priority'] as String : null,
                                isDense: true,
                                decoration: InputDecoration(labelText: tr('الأولوية', 'Priority'), isDense: true),
                                items: priorities.map((p) => DropdownMenuItem(value: p['key'].toString(), child: Text(tr((p['ar'] ?? '').toString(), (p['en'] ?? '').toString())))).toList(),
                                onChanged: (v) => setS(() => rows[i]['priority'] = v ?? 'medium'),
                              ),
                            ),
                          ]),
                          const SizedBox(height: 8),
                          TextField(
                            controller: rows[i]['title'] as TextEditingController,
                            onChanged: (_) => setS(() {}),
                            decoration: InputDecoration(labelText: tr('ما المطلوب من هذا الموظف تحديدًا؟ *', 'What exactly should this person do? *'), isDense: true),
                          ),
                          const SizedBox(height: 6),
                          TextField(
                            controller: rows[i]['instructions'] as TextEditingController,
                            maxLines: 2,
                            decoration: InputDecoration(labelText: tr('تعليمات (اختياري)', 'Instructions (optional)'), isDense: true),
                          ),
                          if (rows.length > 1)
                            TextButton.icon(
                              onPressed: () => setS(() => rows.removeAt(i)),
                              icon: const Icon(Icons.delete_outline, size: 16, color: T.danger),
                              label: Text(tr('حذف', 'Remove'), style: const TextStyle(color: T.danger, fontSize: 12)),
                            ),
                        ]),
                      ),
                    ),
                  TextButton(onPressed: () => setS(() => rows.add(blank())), child: Text('+ ${tr('موظف آخر', 'Another person')}')),
                ]),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 6, 14, 14),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: valid.isEmpty
                        ? null
                        : () => Navigator.pop(c, valid.map((r) => {
                              'assignee': r['assignee'],
                              'title': (r['title'] as TextEditingController).text.trim(),
                              'instructions': (r['instructions'] as TextEditingController).text,
                              'dueDate': r['dueDate'],
                              'priority': r['priority'],
                            }).toList()),
                    icon: const Icon(Icons.send_rounded, size: 17),
                    label: Text(tr('إسناد إلى ${valid.length}', 'Assign to ${valid.length}')),
                  ),
                ),
              ),
            ]),
          ),
        ),
      );
    }),
  );
}

/// سجلّ تحديثات البند — UpdateLog في الويب (آخر ثمانية).
class BrUpdateLog extends StatelessWidget {
  final List updates;
  final Map<String, dynamic> meta;
  const BrUpdateLog({super.key, required this.updates, required this.meta});
  @override
  Widget build(BuildContext context) {
    if (updates.isEmpty) return const SizedBox.shrink();
    final list = updates.reversed.take(8).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      for (final u in list)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.chat_bubble_outline, size: 12, color: T.inkFaint),
            const SizedBox(width: 5),
            Expanded(
              child: Text.rich(TextSpan(children: [
                TextSpan(text: '${u['byName'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                if (u['statusTo'] != null)
                  TextSpan(text: ' · ${brVocab(meta['actionStatuses'] as List?, u['statusFrom']?.toString()).label} → ${brVocab(meta['actionStatuses'] as List?, u['statusTo']?.toString()).label}', style: const TextStyle(color: T.inkFaint)),
                if ((u['text'] ?? '').toString().isNotEmpty) TextSpan(text: '\n${u['text']}'),
              ]), style: const TextStyle(fontSize: 11)),
            ),
            Text(brDateTime(u['at']), style: const TextStyle(fontSize: 10, color: T.inkFaint)),
          ]),
        ),
    ]);
  }
}

/// بندٌ تنفيذيّ واحد — ActionCard في الويب: تحديث، توزيع، حذف حسب ما يُمرَّر.
class BrActionCard extends StatefulWidget {
  final Map<String, dynamic> action;
  final Map<String, dynamic> meta;
  final bool showMeeting;
  final bool canDelegate;
  final bool canDelete;
  final bool canUpdate;
  final Future<void> Function() onChanged;
  const BrActionCard({
    super.key,
    required this.action,
    required this.meta,
    required this.onChanged,
    this.showMeeting = false,
    this.canDelegate = false,
    this.canDelete = false,
    this.canUpdate = true,
  });
  @override
  State<BrActionCard> createState() => _BrActionCardState();
}

class _BrActionCardState extends State<BrActionCard> {
  bool _open = false;
  bool _busy = false;

  Map<String, dynamic> get a => widget.action;

  Future<void> _run(Future<void> Function() fn, String okAr, String okEn) async {
    setState(() => _busy = true);
    try {
      await fn();
      if (mounted) brSnack(context, tr(okAr, okEn));
      await widget.onChanged();
    } catch (e) {
      if (mounted) brSnack(context, brErr(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _update() async {
    final v = await brProgressSheet(context, widget.meta, a['title'].toString(), (a['status'] ?? 'open').toString(), (a['progress'] ?? 0) as num);
    if (v == null) return;
    await _run(() => Api.instance.patch('/api/business-review/actions/${a['_id']}', v), 'تم التحديث', 'Updated');
  }

  Future<void> _delegate() async {
    final meId = (widget.meta['me']?['_id'] ?? '').toString();
    final people = List<Map<String, dynamic>>.from(widget.meta['people'] ?? []).where((p) => p['_id'] != meId).toList();
    final rows = await brDelegateSheet(context, widget.meta, people, a['dueDate']);
    if (rows == null || rows.isEmpty) return;
    await _run(() => Api.instance.post('/api/business-review/actions/${a['_id']}/delegate', {'assignments': rows}), 'تم التوزيع', 'Delegated');
  }

  Future<void> _delete() async {
    final ok = await brConfirm(context, tr('حذف هذا البند؟', 'Delete this action?'), tr('سيتم حذف التكليفات الفرعية معه.', 'Its delegated tasks are removed too.'),
        ok: tr('حذف', 'Delete'), danger: true);
    if (!ok) return;
    await _run(() => Api.instance.delete('/api/business-review/actions/${a['_id']}'), 'تم الحذف', 'Deleted');
  }

  @override
  Widget build(BuildContext context) {
    final meta = widget.meta;
    final st = brVocab(meta['actionStatuses'] as List?, a['status']?.toString());
    final pr = brVocab(meta['priorities'] as List?, a['priority']?.toString());
    final overdue = a['isOverdue'] == true && brOpenStatuses.contains(a['status']);
    final progress = ((a['progress'] ?? 0) as num).toDouble();
    final due = brDue(a['dueDate'], a['status']?.toString());
    final delegations = List<Map<String, dynamic>>.from(a['delegations'] ?? []);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(
        topAccent: overdue ? T.danger : null,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          InkWell(
            onTap: () => setState(() => _open = !_open),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(_open ? Icons.expand_more : Icons.chevron_right, size: 18, color: T.inkFaint),
              Expanded(child: Text(a['title'].toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
              Chip2(st.label, st.color),
            ]),
          ),
          const SizedBox(height: 5),
          Text(
            '${tr('المكلَّف', 'Owner')}: ${a['assigneeName'] ?? '—'}'
            '${(a['raisedByName'] ?? '').toString().isNotEmpty ? ' · ${tr('بطلب من', 'Requested by')}: ${a['raisedByName']}' : ''}'
            '${widget.showMeeting && a['meetingRef'] != null ? ' · ${a['meetingRef']}' : ''}',
            style: const TextStyle(fontSize: 11, color: T.inkFaint),
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(value: (progress / 100).clamp(0.0, 1.0), minHeight: 5, backgroundColor: T.line, valueColor: AlwaysStoppedAnimation(st.color)),
          ),
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, children: [
            Chip2(pr.label, pr.color),
            Chip2(due.text, due.color, icon: overdue ? Icons.warning_amber_outlined : Icons.event_outlined),
            Chip2('${progress.round()}%', T.navy),
            for (final d in delegations)
              Chip2('${d['assigneeName']} · ${brVocab(meta['actionStatuses'] as List?, d['status']?.toString()).label}${d['isOverdue'] == true && brOpenStatuses.contains(d['status']) ? ' ⚠' : ''}', T.violet, icon: Icons.groups_outlined),
          ]),
          if (_open) ...[
            const Divider(height: 18),
            if ((a['description'] ?? '').toString().isNotEmpty)
              Padding(padding: const EdgeInsets.only(bottom: 6), child: Text(a['description'].toString(), style: const TextStyle(fontSize: 12))),
            Text(
              '${(a['meetingTitle'] ?? '').toString().isNotEmpty ? '${tr('من اجتماع', 'From')}: ${a['meetingTitle']} · ' : ''}'
              '${tr('أُنشئ', 'Created')}: ${brDate(a['createdAt'])}'
              '${a['completedAt'] != null ? ' · ${tr('اكتمل', 'Completed')}: ${brDate(a['completedAt'])}' : ''}',
              style: const TextStyle(fontSize: 11, color: T.inkFaint),
            ),
            if (delegations.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(tr('التكليفات الفرعية', 'Delegated work'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
              for (final d in delegations)
                Container(
                  margin: const EdgeInsets.only(top: 5),
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(8), border: Border.all(color: T.line)),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text('${d['assigneeName']}', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700))),
                      Chip2(brVocab(meta['actionStatuses'] as List?, d['status']?.toString()).label, brVocab(meta['actionStatuses'] as List?, d['status']?.toString()).color),
                      const SizedBox(width: 4),
                      Chip2(brDue(d['dueDate'], d['status']?.toString()).text, brDue(d['dueDate'], d['status']?.toString()).color),
                    ]),
                    if ((d['title'] ?? '').toString().isNotEmpty) Text('${d['title']}', style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                  ]),
                ),
            ],
            const SizedBox(height: 6),
            BrUpdateLog(updates: List.from(a['updates'] ?? []), meta: meta),
          ],
          if (widget.canUpdate || widget.canDelegate || widget.canDelete) ...[
            const SizedBox(height: 8),
            if (_busy)
              const LinearProgressIndicator(minHeight: 2)
            else
              Wrap(spacing: 6, runSpacing: 6, children: [
                if (widget.canUpdate)
                  OutlinedButton.icon(onPressed: _update, icon: const Icon(Icons.schedule, size: 16), label: Text(tr('تحديث الحالة', 'Report progress'), style: const TextStyle(fontSize: 12))),
                if (widget.canDelegate)
                  OutlinedButton.icon(onPressed: _delegate, icon: const Icon(Icons.groups_outlined, size: 16), label: Text(tr('توزيع على الفريق', 'Delegate'), style: const TextStyle(fontSize: 12))),
                if (widget.canDelete)
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(foregroundColor: T.danger),
                    onPressed: _delete,
                    icon: const Icon(Icons.delete_outline, size: 16),
                    label: Text(tr('حذف', 'Delete'), style: const TextStyle(fontSize: 12)),
                  ),
              ]),
          ],
        ]),
      ),
    );
  }
}
