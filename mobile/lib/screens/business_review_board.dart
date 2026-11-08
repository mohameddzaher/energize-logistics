import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'business_review_kit.dart';
import 'business_review_meeting.dart';

/// Department board: tasks of every department with dates and status; /system/business-review/board on the web.
class BrBoardTab extends StatefulWidget {
  final Map<String, dynamic> meta;
  const BrBoardTab({super.key, required this.meta});
  @override
  State<BrBoardTab> createState() => _BrBoardTabState();
}

const _periods = [('today', 'اليوم', 'Today'), ('week', '٧ أيام', '7 days'), ('month', 'هذا الشهر', 'Month'), ('all', 'الكل', 'All')];
const _groups = [
  ('', 'الكل', 'All'), ('overdue', 'متأخر', 'Overdue'), ('in_progress', 'قيد التنفيذ', 'In progress'), ('open', 'لم يبدأ', 'Not started'),
  ('postponed', 'مؤجَّل', 'Postponed'), ('blocked', 'متعثر', 'Blocked'), ('done', 'تم إنجازه', 'Done'),
];
const _weekdays = [(0, 'الأحد', 'Sun'), (1, 'الإثنين', 'Mon'), (2, 'الثلاثاء', 'Tue'), (3, 'الأربعاء', 'Wed'), (4, 'الخميس', 'Thu'), (5, 'الجمعة', 'Fri'), (6, 'السبت', 'Sat')];

class _BrBoardTabState extends State<BrBoardTab> {
  Map<String, dynamic>? _d;
  String? _error;
  String _period = 'month';
  String _dept = '';
  String _group = '';
  Timer? _tick;
  static const _events = ['br:action', 'br:assignment', 'br:meeting', 'br:series'];

  void _soon([dynamic _]) {
    _tick?.cancel();
    _tick = Timer(const Duration(milliseconds: 400), _load);
  }

  @override
  void initState() {
    super.initState();
    for (final e in _events) { Live.instance.on(e, _soon); }
    _load();
  }

  @override
  void dispose() {
    for (final e in _events) { Live.instance.off(e, _soon); }
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/business-review/board?period=$_period');
      if (!mounted) return;
      setState(() { _d = Map<String, dynamic>.from(d); _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : '$e');
    }
  }

  String _dl(String k) => k == 'Unassigned' ? tr('بدون قسم', 'No department') : brDept(context, k);

  bool _inGroup(Map r) => _group.isEmpty ? true : _group == 'overdue' ? r['overdue'] == true : r['status'] == _group;

  Future<void> _report(Map r) async {
    final v = await brProgressSheet(context, widget.meta, '${r['title']}', '${r['status']}', (r['progress'] ?? 0) as num, expectedDate: r['expectedDate']);
    if (v == null) return;
    try {
      await Api.instance.patch('/api/business-review/actions/${r['_id']}', v);
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : '$e')));
    }
  }

  /// Give the task to another department head as well.
  Future<void> _share(Map r) async {
    final taken = {'${r['assignee']}', ...List.from(r['sharedWith'] ?? []).map((x) => '${x['assignee']}')};
    final heads = List<Map<String, dynamic>>.from(widget.meta['participants'] ?? [])
        .where((p) => '${p['role']}'.endsWith('_manager') && !taken.contains('${p['_id']}')).toList();
    final p = await brPickPerson(context, heads);
    if (p == null) return;
    try {
      await Api.instance.post('/api/business-review/actions/${r['_id']}/share', {'assignee': p['_id']});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : '$e')));
    }
  }

  Widget _kpi(String label, num v, Color c, String g) {
    final on = _group == g;
    return InkWell(
      onTap: () => setState(() => _group = on ? '' : g),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(color: T.card, borderRadius: BorderRadius.circular(12), border: Border.all(color: on ? T.orange : T.line, width: on ? 2 : 1)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontSize: 11, color: T.inkSoft, fontWeight: FontWeight.w600), maxLines: 1, overflow: TextOverflow.ellipsis),
          Text('$v', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: v == 0 ? T.inkFaint : c)),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) return ErrorRetry(message: _error!, onRetry: _load);
    final d = _d;
    if (d == null) return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer()]);
    final t = Map<String, dynamic>.from(d['totals'] ?? {});
    final depts = List<Map<String, dynamic>>.from(d['departments'] ?? []);
    final today = List<Map<String, dynamic>>.from(d['today'] ?? []);
    final shown = depts.where((x) => _dept.isEmpty || x['key'] == _dept).toList();
    final statuses = widget.meta['actionStatuses'] as List?;

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          for (final p in _periods)
            ChoiceChip(label: Text(tr(p.$2, p.$3)), selected: _period == p.$1, onSelected: (_) { setState(() => _period = p.$1); _load(); }),
          ActionChip(avatar: const Icon(Icons.repeat, size: 16), label: Text(tr('الاجتماعات الدورية', 'Recurring')),
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => BrSeriesScreen(meta: widget.meta)))),
        ]),
        const SizedBox(height: 10),
        for (final m in today)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: T.orange.withValues(alpha: 0.06), borderRadius: BorderRadius.circular(14), border: Border.all(color: T.orange.withValues(alpha: 0.35))),
            child: Row(children: [
              const Icon(Icons.event_note, color: T.orange),
              const SizedBox(width: 10),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(tr('اجتماع اليوم', 'Today’s meeting'), style: const TextStyle(fontSize: 11, color: T.orange, fontWeight: FontWeight.w800)),
                Text('${m['title']}', style: const TextStyle(fontWeight: FontWeight.w800), maxLines: 2, overflow: TextOverflow.ellipsis),
                Text('${brDateTime(m['scheduledAt']).split(' ').last} · ${tr('المحضر', 'Minutes')}: ${m['minutesWritten']}/${m['minutesTotal']}',
                    style: const TextStyle(fontSize: 11, color: T.inkSoft)),
              ])),
              FilledButton(
                onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => BusinessReviewMeetingScreen(id: '${m['_id']}'))),
                child: Text(tr('المحضر', 'Minutes')),
              ),
            ]),
          ),
        GridView.count(
          crossAxisCount: 3, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 8, crossAxisSpacing: 8, childAspectRatio: 1.6,
          children: [
            _kpi(tr('كل البنود', 'All'), (t['total'] ?? 0) as num, T.ink, ''),
            _kpi(tr('تم إنجازه', 'Done'), (t['done'] ?? 0) as num, T.success, 'done'),
            _kpi(tr('قيد التنفيذ', 'In progress'), (t['in_progress'] ?? 0) as num, T.info, 'in_progress'),
            _kpi(tr('لم يبدأ', 'Not started'), (t['open'] ?? 0) as num, T.inkSoft, 'open'),
            _kpi(tr('مؤجَّل', 'Postponed'), (t['postponed'] ?? 0) as num, T.warn, 'postponed'),
            _kpi(tr('متأخر', 'Overdue'), (t['overdue'] ?? 0) as num, T.danger, 'overdue'),
          ],
        ),
        const SizedBox(height: 8),
        Text('${tr('نسبة الإنجاز', 'Completion')}: ${t['completionRate'] ?? 0}%', style: const TextStyle(fontWeight: FontWeight.w800, color: T.success)),
        const SizedBox(height: 10),
        for (final g in depts)
          InkWell(
            onTap: () => setState(() => _dept = _dept == g['key'] ? '' : '${g['key']}'),
            child: Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: T.card, borderRadius: BorderRadius.circular(14), border: Border.all(color: _dept == g['key'] ? T.orange : T.line, width: _dept == g['key'] ? 2 : 1)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text(_dl('${g['key']}'), style: const TextStyle(fontWeight: FontWeight.w900))),
                  Text('${g['completionRate']}%', style: const TextStyle(fontWeight: FontWeight.w900, color: T.success)),
                ]),
                if (List.from(g['heads'] ?? []).isNotEmpty) Text(List.from(g['heads']).join('، '), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                const SizedBox(height: 6),
                ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(value: ((g['completionRate'] ?? 0) as num) / 100, minHeight: 5, backgroundColor: T.line, valueColor: const AlwaysStoppedAnimation(T.success))),
                const SizedBox(height: 6),
                Builder(builder: (_) {
                  final c = Map<String, dynamic>.from(g['counts'] ?? {});
                  return Wrap(spacing: 5, runSpacing: 4, children: [
                    Chip2('${tr('بنود', 'Tasks')} ${c['total']}', T.navy),
                    if ((c['done'] ?? 0) > 0) Chip2('${tr('منجز', 'Done')} ${c['done']}', T.success),
                    if ((c['in_progress'] ?? 0) > 0) Chip2('${tr('قيد التنفيذ', 'In progress')} ${c['in_progress']}', T.info),
                    if ((c['open'] ?? 0) > 0) Chip2('${tr('لم يبدأ', 'Not started')} ${c['open']}', T.inkSoft),
                    if ((c['postponed'] ?? 0) > 0) Chip2('${tr('مؤجَّل', 'Postponed')} ${c['postponed']}', T.warn),
                    if ((c['blocked'] ?? 0) > 0) Chip2('${tr('متعثر', 'Blocked')} ${c['blocked']}', T.danger),
                    if ((c['overdue'] ?? 0) > 0) Chip2('${tr('متأخر', 'Overdue')} ${c['overdue']}', T.danger),
                  ]);
                }),
              ]),
            ),
          ),
        const SizedBox(height: 6),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(children: [
            for (final g in _groups)
              Padding(padding: const EdgeInsetsDirectional.only(end: 6),
                  child: ChoiceChip(label: Text(tr(g.$2, g.$3)), selected: _group == g.$1, onSelected: (_) => setState(() => _group = g.$1))),
          ]),
        ),
        const SizedBox(height: 8),
        for (final g in shown) ...[
          Builder(builder: (_) {
            final rows = List<Map<String, dynamic>>.from(g['items'] ?? []).where(_inGroup).toList();
            if (rows.isEmpty) return const SizedBox.shrink();
            return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Padding(padding: const EdgeInsets.only(top: 8, bottom: 6),
                  child: Text('${_dl('${g['key']}')} (${rows.length})', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15))),
              for (final r in rows) _item(r, statuses),
            ]);
          }),
        ],
        if (depts.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(tr('لا توجد بنود في هذه الفترة بعد.', 'No tasks in this period yet.')))),
      ]),
    );
  }

  Widget _item(Map<String, dynamic> r, List? statuses) {
    final st = brVocab(statuses, '${r['status']}');
    final late = r['overdue'] == true;
    final progress = ((r['progress'] ?? 0) as num).toDouble();
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: late ? T.danger.withValues(alpha: 0.04) : T.card, borderRadius: BorderRadius.circular(12), border: Border.all(color: late ? T.danger.withValues(alpha: 0.4) : T.line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Text('${r['title']}', style: const TextStyle(fontWeight: FontWeight.w800))),
          Chip2(st.label, st.color),
          if (late) ...[const SizedBox(width: 4), Chip2(tr('متأخر', 'Late'), T.danger)],
        ]),
        Text('${r['assigneeName'] ?? ''} · ${r['meetingRef'] ?? ''}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        if (brSharedLine(r, widget.meta).isNotEmpty) Text(brSharedLine(r, widget.meta), style: const TextStyle(fontSize: 11, color: T.violet)),
        const SizedBox(height: 4),
        Wrap(spacing: 10, runSpacing: 2, children: [
          Text('${tr('البداية', 'Start')}: ${brDate(r['startDate'])}', style: const TextStyle(fontSize: 11.5)),
          Text('${tr('التسليم', 'Due')}: ${brDate(r['dueDate'])}', style: TextStyle(fontSize: 11.5, color: late ? T.danger : T.ink, fontWeight: late ? FontWeight.w800 : FontWeight.w500)),
          if (r['durationDays'] != null) Text('${tr('المدة', 'Duration')}: ${r['durationDays']} ${tr('يوم', 'd')}', style: const TextStyle(fontSize: 11.5)),
          if (r['status'] == 'done') Text('${tr('أُنجز', 'Done')}: ${brDate(r['completedAt'])}', style: const TextStyle(fontSize: 11.5, color: T.success))
          else if (r['expectedDate'] != null) Text('${tr('متوقَّع', 'Expected')}: ${brDate(r['expectedDate'])}', style: const TextStyle(fontSize: 11.5, color: T.info)),
          if (r['originalDueDate'] != null) Text('${tr('كان', 'Was')}: ${brDate(r['originalDueDate'])}', style: const TextStyle(fontSize: 11.5, color: T.warn)),
        ]),
        if (r['status'] == 'postponed' && '${r['postponeReason'] ?? ''}'.isNotEmpty)
          Text('${tr('سبب التأجيل', 'Reason')}: ${r['postponeReason']}', style: const TextStyle(fontSize: 11.5, color: T.warn)),
        const SizedBox(height: 6),
        ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(value: progress / 100, minHeight: 5, backgroundColor: T.line, valueColor: AlwaysStoppedAnimation(st.color))),
        Row(children: [
          Text('${progress.round()}%', style: const TextStyle(fontSize: 11, color: T.inkSoft)),
          const Spacer(),
          TextButton(
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => BusinessReviewMeetingScreen(id: '${r['meeting']}'))),
            child: Text(tr('الاجتماع', 'Meeting')),
          ),
          if (_d?['canRunMeetings'] == true) IconButton(tooltip: tr('مشاركة مع مدير قسم آخر', 'Share with another head'), icon: const Icon(Icons.group_add_outlined), onPressed: () => _share(r)),
          if (r['mine'] == true) FilledButton.tonal(onPressed: () => _report(r), child: Text(tr('تحديث الحالة', 'Update'))),
        ]),
      ]),
    );
  }
}

/// Recurring meetings: list, open/create today's meeting, and (for the secretariat) create and edit.
class BrSeriesScreen extends StatefulWidget {
  final Map<String, dynamic> meta;
  const BrSeriesScreen({super.key, required this.meta});
  @override
  State<BrSeriesScreen> createState() => _BrSeriesScreenState();
}

class _BrSeriesScreenState extends State<BrSeriesScreen> {
  List<Map<String, dynamic>>? _list;
  bool _canEdit = false;
  void _onLive([dynamic _]) => _load();

  @override
  void initState() {
    super.initState();
    Live.instance.on('br:series', _onLive);
    _load();
  }

  @override
  void dispose() {
    Live.instance.off('br:series', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/business-review/series');
      if (!mounted) return;
      setState(() { _list = List<Map<String, dynamic>>.from(d['series'] ?? []); _canEdit = d['canEdit'] == true; });
    } catch (_) { if (mounted) setState(() => _list = []); }
  }

  Future<void> _openDay(Map s) async {
    try {
      final d = await Api.instance.post('/api/business-review/series/${s['_id']}/day', {'day': brIsoDay(DateTime.now())});
      if (!mounted) return;
      await Navigator.push(context, MaterialPageRoute(builder: (_) => BusinessReviewMeetingScreen(id: '${d['meeting']['_id']}')));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : '$e')));
    }
  }

  Future<void> _delete(Map s) async {
    final ok = await brConfirm(context, tr('إيقاف هذا الاجتماع الدوري؟', 'Stop this schedule?'), tr('الاجتماعات السابقة ومحاضرها تبقى كما هي.', 'Past meetings and minutes stay.'),
        ok: tr('إيقاف', 'Stop'), danger: true);
    if (!ok) return;
    try { await Api.instance.delete('/api/business-review/series/${s['_id']}'); _load(); } catch (_) {}
  }

  Future<void> _edit([Map<String, dynamic>? s]) async {
    final saved = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => _SeriesForm(meta: widget.meta, series: s)));
    if (saved == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(tr('الاجتماعات الدورية', 'Recurring meetings'))),
      floatingActionButton: _canEdit ? FloatingActionButton.extended(onPressed: () => _edit(), icon: const Icon(Icons.add), label: Text(tr('اجتماع دوري جديد', 'New'))) : null,
      body: _list == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(padding: const EdgeInsets.all(14), children: [
              Text(tr('الاجتماع الدوري يُنشئ اجتماعه كل يوم مجدول تلقائيًّا، بمحضر مقسوم على الأقسام وبنود تنفيذية خاصة به.',
                  'A recurring meeting creates its own meeting every scheduled day, with minutes split by department.'), style: const TextStyle(color: T.inkSoft, fontSize: 12.5)),
              const SizedBox(height: 10),
              for (final s in _list!)
                AppCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${s['title']}${s['active'] == false ? ' (${tr('موقوف', 'paused')})' : ''}', style: const TextStyle(fontWeight: FontWeight.w900)),
                    Text('${s['time']} · ${_weekdays.where((w) => List.from(s['weekdays'] ?? []).contains(w.$1)).map((w) => tr(w.$2, w.$3)).join('، ')}',
                        style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                    Text(List.from(s['departments'] ?? []).map((x) => brDept(context, '$x')).join('، '), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                    const SizedBox(height: 6),
                    Wrap(spacing: 6, children: [
                      FilledButton(onPressed: () => _openDay(s), child: Text(s['today'] != null ? tr('فتح اجتماع اليوم', 'Open today') : tr('إنشاء اجتماع اليوم', 'Create today'))),
                      if (_canEdit) OutlinedButton(onPressed: () => _edit(s), child: Text(tr('تعديل', 'Edit'))),
                      if (_canEdit) IconButton(onPressed: () => _delete(s), icon: const Icon(Icons.delete_outline, color: T.danger)),
                    ]),
                  ]),
                ),
              if (_list!.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(tr('لا توجد اجتماعات دورية بعد.', 'No recurring meetings yet.')))),
            ]),
    );
  }
}

class _SeriesForm extends StatefulWidget {
  final Map<String, dynamic> meta;
  final Map<String, dynamic>? series;
  const _SeriesForm({required this.meta, this.series});
  @override
  State<_SeriesForm> createState() => _SeriesFormState();
}

class _SeriesFormState extends State<_SeriesForm> {
  late final TextEditingController _title;
  late final TextEditingController _location;
  String _time = '09:00';
  List<int> _days = [0, 1, 2, 3, 4];
  List<String> _depts = [];
  List<String> _people = [];
  bool _busy = false;
  String _q = '';

  List<Map<String, dynamic>> get _participants => List<Map<String, dynamic>>.from(widget.meta['participants'] ?? []);

  @override
  void initState() {
    super.initState();
    final s = widget.series;
    _title = TextEditingController(text: s?['title']?.toString() ?? tr('الاجتماع اليومي', 'Daily meeting'));
    _location = TextEditingController(text: s?['location']?.toString() ?? '');
    if (s != null) {
      _time = '${s['time'] ?? '09:00'}';
      _days = List<int>.from((s['weekdays'] as List? ?? []).map((e) => (e as num).toInt()));
      _depts = List<String>.from((s['departments'] as List? ?? []).map((e) => '$e'));
      _people = List<String>.from((s['attendees'] as List? ?? []).map((e) => '$e'));
    } else {
      _people = _participants.where((p) => p['isExecutive'] == true).map((p) => '${p['_id']}').toList();
    }
  }

  @override
  void dispose() { _title.dispose(); _location.dispose(); super.dispose(); }

  void _toggleDept(String d) {
    setState(() {
      if (_depts.contains(d)) { _depts.remove(d); return; }
      _depts.add(d);
      // Choosing a department invites its head.
      for (final p in _participants) {
        if (p['section'] == d && '${p['role']}'.endsWith('_manager') && !_people.contains('${p['_id']}')) _people.add('${p['_id']}');
      }
    });
  }

  Future<void> _save() async {
    if (_title.text.trim().isEmpty || _depts.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('اكتب الاسم واختر الأقسام', 'Name it and pick departments'))));
      return;
    }
    setState(() => _busy = true);
    final body = {'title': _title.text.trim(), 'time': _time, 'weekdays': _days, 'departments': _depts, 'attendees': _people, 'location': _location.text.trim(), 'durationMinutes': 30};
    try {
      if (widget.series == null) {
        await Api.instance.post('/api/business-review/series', body);
      } else {
        await Api.instance.put('/api/business-review/series/${widget.series!['_id']}', body);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : '$e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final depts = List<String>.from((widget.meta['departments'] as List? ?? []).map((e) => '$e'));
    final people = _participants.where((p) => '${p['name']} ${p['role']}'.toLowerCase().contains(_q.toLowerCase())).toList();
    return Scaffold(
      appBar: AppBar(title: Text(widget.series == null ? tr('اجتماع دوري جديد', 'New recurring meeting') : tr('تعديل الاجتماع الدوري', 'Edit recurring meeting'))),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        TextField(controller: _title, decoration: InputDecoration(labelText: tr('اسم الاجتماع', 'Name'))),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          onPressed: () async {
            final parts = _time.split(':');
            final t = await showTimePicker(context: context, initialTime: TimeOfDay(hour: int.tryParse(parts[0]) ?? 9, minute: int.tryParse(parts[1]) ?? 0));
            if (t != null) setState(() => _time = '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}');
          },
          icon: const Icon(Icons.schedule),
          label: Text('${tr('الوقت', 'Time')}: $_time'),
        ),
        const SizedBox(height: 10),
        Text(tr('الأيام', 'Days'), style: const TextStyle(fontWeight: FontWeight.w800)),
        Wrap(spacing: 6, children: [
          for (final w in _weekdays)
            FilterChip(label: Text(tr(w.$2, w.$3)), selected: _days.contains(w.$1),
                onSelected: (v) => setState(() => v ? _days.add(w.$1) : _days.remove(w.$1))),
        ]),
        const SizedBox(height: 10),
        Text(tr('الأقسام (لكل قسم جزء خاص في المحضر)', 'Departments (one minutes section each)'), style: const TextStyle(fontWeight: FontWeight.w800)),
        Wrap(spacing: 6, runSpacing: 4, children: [
          for (final d in depts) FilterChip(label: Text(brDept(context, d)), selected: _depts.contains(d), onSelected: (_) => _toggleDept(d)),
        ]),
        const SizedBox(height: 10),
        Text('${tr('المدعوون', 'Attendees')} (${_people.length})', style: const TextStyle(fontWeight: FontWeight.w800)),
        TextField(decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: tr('بحث…', 'Search…')), onChanged: (v) => setState(() => _q = v.trim())),
        for (final p in people)
          CheckboxListTile(
            dense: true, contentPadding: EdgeInsets.zero,
            value: _people.contains('${p['_id']}'),
            onChanged: (v) => setState(() => v == true ? _people.add('${p['_id']}') : _people.remove('${p['_id']}')),
            title: Text('${p['name']}'),
            subtitle: Text('${(p['jobTitle'] ?? '').toString().isNotEmpty ? p['jobTitle'] : p['role']}'),
          ),
        TextField(controller: _location, decoration: InputDecoration(labelText: tr('المكان', 'Location'))),
        const SizedBox(height: 14),
        FilledButton(onPressed: _busy ? null : _save, child: Text(tr('حفظ', 'Save'))),
      ]),
    );
  }
}

/// The daily meeting: today's meeting per department (minutes, tasks), attendance and past days; /system/business-review/daily on the web.
class BrDailyTab extends StatefulWidget {
  final Map<String, dynamic> meta;
  const BrDailyTab({super.key, required this.meta});
  @override
  State<BrDailyTab> createState() => _BrDailyTabState();
}

class _BrDailyTabState extends State<BrDailyTab> {
  Map<String, dynamic>? _d;
  String? _error;
  Timer? _tick;
  static const _events = ['br:meeting', 'br:action', 'br:series'];
  void _soon([dynamic _]) { _tick?.cancel(); _tick = Timer(const Duration(milliseconds: 400), _load); }

  @override
  void initState() { super.initState(); for (final e in _events) { Live.instance.on(e, _soon); } _load(); }
  @override
  void dispose() { for (final e in _events) { Live.instance.off(e, _soon); } _tick?.cancel(); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/business-review/daily');
      if (mounted) setState(() { _d = Map<String, dynamic>.from(d); _error = null; });
    } catch (e) { if (mounted) setState(() => _error = e is ApiException ? e.message : '$e'); }
  }

  void _open(String id) => Navigator.push(context, MaterialPageRoute(builder: (_) => BusinessReviewMeetingScreen(id: id))).then((_) => _load());

  Future<void> _createToday() async {
    try {
      final d = await Api.instance.post('/api/business-review/series/${_d!['series']['_id']}/day', {'day': _d!['todayKey']});
      _open('${d['meeting']['_id']}');
    } catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : '$e'))); }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) return ErrorRetry(message: _error!, onRetry: _load);
    final d = _d;
    if (d == null) return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 80), SizedBox(height: 10), Shimmer()]);
    final s = d['series'] as Map?;
    final today = d['today'] as Map?;
    final days = List<Map<String, dynamic>>.from(d['days'] ?? []);
    final statuses = widget.meta['actionStatuses'] as List?;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        Row(children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${s?['title'] ?? tr('الاجتماع اليومي', 'Daily meeting')}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
            if (s != null)
              Text('${s['time']} · ${_weekdays.where((w) => List.from(s['weekdays'] ?? []).contains(w.$1)).map((w) => tr(w.$2, w.$3)).join('، ')} · ${List.from(s['attendees'] ?? []).length} ${tr('مدعو', 'attendees')}',
                  style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
          ])),
          if (d['canEdit'] == true)
            IconButton(icon: const Icon(Icons.tune), tooltip: tr('إعدادات الاجتماع', 'Settings'),
                onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => BrSeriesScreen(meta: widget.meta))).then((_) => _load())),
        ]),
        const SizedBox(height: 10),
        if (s == null) Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(tr('لم يُجدول اجتماع يومي بعد.', 'No daily meeting yet.')))),
        if (s != null && today == null)
          AppCard(child: Column(children: [
            Text(d['scheduledToday'] == true ? tr('اجتماع اليوم يُجهَّز الآن.', 'Today’s meeting is being prepared.') : tr('لا اجتماع اليوم — ليس من أيام الاجتماع.', 'No meeting today.'),
                style: const TextStyle(fontWeight: FontWeight.w700)),
            if (d['canEdit'] == true) ...[const SizedBox(height: 8), FilledButton(onPressed: _createToday, child: Text(tr('إنشاء اجتماع اليوم', 'Hold a meeting today')))],
          ])),
        if (today != null) ...[
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: T.orange.withValues(alpha: 0.06), borderRadius: BorderRadius.circular(14), border: Border.all(color: T.orange.withValues(alpha: 0.35))),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${tr('اجتماع اليوم', 'Today')} · ${today['refNumber']}', style: const TextStyle(fontSize: 11, color: T.orange, fontWeight: FontWeight.w800)),
              Text(brDateTime(today['scheduledAt']), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
              const SizedBox(height: 6),
              Wrap(spacing: 6, runSpacing: 4, children: [
                Chip2('${tr('المحضر', 'Minutes')} ${today['minutesWritten']}/${today['minutesTotal']}', T.navy),
                Chip2('${tr('البنود', 'Tasks')} ${today['tasks']}', T.navy),
                Chip2('${tr('حضر', 'Present')} ${today['attendance']['attended']}/${today['attendance']['invited']}', T.success),
                if ((today['attendance']['excused'] ?? 0) > 0) Chip2('${tr('اعتذر', 'Excused')} ${today['attendance']['excused']}', T.warn),
                if ((today['attendance']['absent'] ?? 0) > 0) Chip2('${tr('غاب', 'Absent')} ${today['attendance']['absent']}', T.danger),
              ]),
              const SizedBox(height: 8),
              SizedBox(width: double.infinity, child: FilledButton.icon(onPressed: () => _open('${today['_id']}'), icon: const Icon(Icons.description_outlined), label: Text(tr('فتح محضر اليوم', 'Open today’s minutes')))),
            ]),
          ),
          const SizedBox(height: 10),
          for (final dep in List<Map<String, dynamic>>.from(today['departments'] ?? []))
            Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: '${dep['minutes']}'.isNotEmpty ? T.success.withValues(alpha: 0.04) : T.card, borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: '${dep['minutes']}'.isNotEmpty ? T.success.withValues(alpha: 0.35) : T.line)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text(dep['key'] == 'Unassigned' ? tr('بدون قسم', 'No department') : brDept(context, '${dep['key']}'), style: const TextStyle(fontWeight: FontWeight.w900))),
                  Text('${dep['minutes']}'.isNotEmpty ? tr('✓ تم التسجيل', '✓ Reported') : tr('بانتظار التسجيل', 'Waiting'),
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: '${dep['minutes']}'.isNotEmpty ? T.success : T.inkFaint)),
                ]),
                if ('${dep['minutes']}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${dep['minutes']}', maxLines: 4, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5))),
                for (final a in List<Map<String, dynamic>>.from(dep['tasks'] ?? []))
                  Padding(padding: const EdgeInsets.only(top: 4), child: Row(children: [
                    const Icon(Icons.checklist, size: 14, color: T.inkFaint),
                    const SizedBox(width: 4),
                    Expanded(child: Text('${a['title']}', style: const TextStyle(fontSize: 12), overflow: TextOverflow.ellipsis)),
                    Chip2(brVocab(statuses, '${a['status']}').label, brVocab(statuses, '${a['status']}').color),
                  ])),
              ]),
            ),
          Text(tr('الحضور', 'Attendance'), style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Wrap(spacing: 5, runSpacing: 4, children: [
            for (final a in List<Map<String, dynamic>>.from(today['attendees'] ?? []))
              Chip2('${a['name']} · ${{'attended': tr('حضر', 'Present'), 'absent': tr('غاب', 'Absent'), 'excused': tr('اعتذر', 'Excused')}[a['attendance']] ?? tr('مدعو', 'Invited')}',
                  a['attendance'] == 'attended' ? T.success : a['attendance'] == 'absent' ? T.danger : a['attendance'] == 'excused' ? T.warn : T.inkFaint),
          ]),
        ],
        const SizedBox(height: 14),
        if (s != null) Text(tr('الأيام السابقة', 'Previous days'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
        for (final m in days)
          Card(child: ListTile(
            onTap: () => _open('${m['_id']}'),
            title: Text(brDate(m['scheduledAt']), style: const TextStyle(fontWeight: FontWeight.w800)),
            subtitle: Text('${tr('المحضر', 'Minutes')} ${m['minutesWritten']}/${m['minutesTotal']} · ${tr('البنود', 'Tasks')} ${m['tasks']} · ${tr('حضر', 'Present')} ${m['attendance']['attended']}/${m['attendance']['invited']}'),
            trailing: const Icon(Icons.chevron_left),
          )),
        if (s != null && days.isEmpty) Padding(padding: const EdgeInsets.all(16), child: Center(child: Text(tr('لا أيام سابقة بعد.', 'No previous days yet.'), style: const TextStyle(color: T.inkFaint)))),
      ]),
    );
  }
}
