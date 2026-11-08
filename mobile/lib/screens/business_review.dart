import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'business_review_board.dart';
import 'business_review_kit.dart';
import 'business_review_meeting.dart';

/// Business review meetings, the mobile half. Same contract as the web (the business-review API) and the same visibility rule, enforced server-side: a department head gets the meetings they sat in and the actions they own; an ordinary employee gets ONLY the tasks delegated to them, and the tabs they don't qualify for simply never appear. The vocabularies (statuses, priorities, cadences) come from `/meta`, so a new status added on the server shows up here without an app release.

const _open = ['open', 'in_progress', 'blocked', 'postponed'];

Color _hex(String? s, [Color fb = T.inkFaint]) {
  if (s == null || !s.startsWith('#') || s.length != 7) return fb;
  return Color(int.parse('FF${s.substring(1)}', radix: 16));
}

String _date(dynamic v) {
  final d = v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
  return d == null ? '—' : '${d.day}/${d.month}/${d.year}';
}

String _dateTime(dynamic v) {
  final d = v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
  if (d == null) return '—';
  return '${d.day}/${d.month} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

/// Look a key up in one of the server's vocabularies.
({String label, Color color}) _vocab(List? list, String? key) {
  for (final v in (list ?? [])) {
    if (v['key'] == key) {
      return (label: tr(v['ar'] ?? '', v['en'] ?? ''), color: _hex(v['color'] as String?));
    }
  }
  return (label: key ?? '—', color: T.inkFaint);
}

class BusinessReviewScreen extends StatefulWidget {
  const BusinessReviewScreen({super.key});
  @override
  State<BusinessReviewScreen> createState() => _BusinessReviewScreenState();
}

class _BusinessReviewScreenState extends State<BusinessReviewScreen> {
  Map<String, dynamic>? _meta;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/business-review/meta');
      if (!mounted) return;
      setState(() { _meta = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return AppScaffold(
        title: Text(tr('مراجعة الأعمال', 'Business Review')),
        body: ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer()]),
      );
    }
    if (_error != null) {
      return AppScaffold(
        title: Text(tr('مراجعة الأعمال', 'Business Review')),
        body: ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); }),
      );
    }

    final me = Map<String, dynamic>.from(_meta?['me'] ?? {});
    final participant = me['isParticipant'] == true;
    final runner = me['canRunMeetings'] == true;

    // Tabs follow the tier — an employee only ever gets "my tasks".
    final tabs = <(String, Widget)>[
      // Meetings and department follow-up are one tab, as on the web (the board was merged into it).
      if (participant) (tr('الاجتماعات ومتابعة الأقسام', 'Meetings & departments'), BrDailyTab(meta: _meta!)),
      if (participant) (tr('بنودي', 'My actions'), _ActionsTab(meta: _meta!, mine: true)),
      if (runner) (tr('سجل المتابعة', 'Register'), _ActionsTab(meta: _meta!, mine: false)),
      (tr('مهامي', 'My tasks'), _TasksTab(meta: _meta!)),
    ];

    return DefaultTabController(
      length: tabs.length,
      child: AppScaffold(
        title: Text(tr('مراجعة الأعمال', 'Business Review')),
        appBarBottom: tabs.length > 1
            ? TabBar(isScrollable: true, tabAlignment: TabAlignment.start, labelColor: Colors.white, unselectedLabelColor: Colors.white70, indicatorColor: T.orange, indicatorWeight: 3, tabs: tabs.map((t) => Tab(text: t.$1)).toList())
            : null,
        body: TabBarView(children: tabs.map((t) => t.$2).toList()),
      ),
    );
  }
}

// Meetings
class _MeetingsTab extends StatefulWidget {
  final Map<String, dynamic> meta;
  const _MeetingsTab({required this.meta});
  @override
  State<_MeetingsTab> createState() => _MeetingsTabState();
}

/// Card buckets: the same bucket keys the server understands, in the web order.
const _buckets = [
  ('', 'كل الاجتماعات', 'All', 'total', T.navy),
  ('open', 'ما زالت مفتوحة', 'Still open', 'open', T.orange),
  ('completed', 'مكتملة', 'Completed', 'completed', Color(0xFF0F766E)),
  ('upcoming', 'قادمة', 'Upcoming', 'upcoming', T.info),
  ('cancelled', 'ملغاة', 'Cancelled', 'cancelled', T.inkFaint),
];

class _MeetingsTabState extends State<_MeetingsTab> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _counts = {};
  Map<String, dynamic>? _dash;
  String _bucket = '';
  String _cadence = '';
  String _status = '';
  String _q = '';
  final _searchCtl = TextEditingController(); // Text stays equal to _q after loading.
  bool _loading = true;
  String? _error;
  int _seq = 0;

  void _onLive() => _load();

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('br:meeting', _onLive);
    Live.instance.on('br:action', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('br:meeting', _onLive);
    Live.instance.off('br:action', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final my = ++_seq;
    try {
      final q = [if (_cadence.isNotEmpty) 'cadence=$_cadence', if (_status.isNotEmpty) 'status=$_status', if (_bucket.isNotEmpty) 'bucket=$_bucket'];
      final r = await Future.wait([
        Api.instance.get('/api/business-review/meetings${q.isEmpty ? '' : '?${q.join('&')}'}'),
        Api.instance.get('/api/business-review/dashboard').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted || my != _seq) return;
      final d = r[0];
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['meetings'] ?? []);
        // Counters are computed over the whole scope, so they stay correct while a filter is active.
        if (d['counts'] != null) _counts = Map<String, dynamic>.from(d['counts'] as Map);
        _dash = (r[1] as Map).isEmpty ? _dash : Map<String, dynamic>.from(r[1]);
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted && my == _seq) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  void _openMeeting(dynamic id) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => BusinessReviewMeetingScreen(id: id.toString())));
    _load();
  }

  // Natural height (not fixed): with the Tajawal font and text scaling, 74 clipped the number and title.
  Widget _cards() => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
    child: IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (var i = 0; i < _buckets.length; i++) ...[
          if (i > 0) const SizedBox(width: 8),
          Builder(builder: (c) {
            final (key, ar, en, countKey, color) = _buckets[i];
            final active = _bucket == key;
            return Pressable(
              onTap: () { setState(() { _bucket = key; _status = ''; _loading = true; }); _load(); },
              child: Container(
                width: 108,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: active ? T.orange : T.line, width: active ? 1.6 : 1),
                ),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
                  Text('${_counts[countKey] ?? 0}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 21, color: color, height: 1.15)),
                  const SizedBox(height: 4),
                  Text(tr(ar, en), style: const TextStyle(fontSize: 11, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis),
                ]),
              ),
            );
          }),
        ],
      ]),
    ),
  );

  /// Cards for my meetings / my items / overdue / tasks / completion, the same dashboard as the web.
  Widget _tiles() {
    final mine = Map<String, dynamic>.from(_dash?['mine'] ?? {});
    if (mine.isEmpty) return const SizedBox.shrink();
    final mt = Map<String, dynamic>.from(mine['meetings'] ?? {});
    final ac = Map<String, dynamic>.from(mine['actions'] ?? {});
    final tk = Map<String, dynamic>.from(mine['tasks'] ?? {});
    final ov = _dash?['overview'] is Map ? Map<String, dynamic>.from(_dash!['overview']) : null;
    Widget tile(String label, String value, String sub, Color color, IconData icon) => Container(
          width: 140,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border(top: BorderSide(color: color, width: 3))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [Icon(icon, size: 14, color: color), const SizedBox(width: 4), Expanded(child: Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis))]),
            const SizedBox(height: 4),
            Text(value, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w900)),
            if (sub.isNotEmpty) Text(sub, style: const TextStyle(fontSize: 10, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis),
          ]),
        );
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
      child: IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        tile(tr('اجتماعاتي', 'My meetings'), '${mt['total'] ?? 0}', '${mt['upcoming'] ?? 0} ${tr('قادم', 'upcoming')} · ${mt['held'] ?? 0} ${tr('انعقد', 'held')}', const Color(0xFF6366F1), Icons.event_outlined),
        const SizedBox(width: 8),
        tile(tr('بنودي المفتوحة', 'My open actions'), '${ac['open'] ?? 0}', '${ac['done'] ?? 0} ${tr('منجز', 'completed')}', const Color(0xFF0EA5E9), Icons.checklist_rounded),
        const SizedBox(width: 8),
        tile(tr('المتأخر عليّ', 'My overdue'), '${ac['overdue'] ?? 0}', '', T.danger, Icons.warning_amber_outlined),
        const SizedBox(width: 8),
        tile(tr('مهام مُسندة إليّ', 'Tasks given to me'), '${tk['open'] ?? 0}', '${tk['overdue'] ?? 0} ${tr('متأخرة', 'overdue')}', T.orange, Icons.groups_outlined),
        const SizedBox(width: 8),
        ov != null
            ? tile(tr('نسبة الإنجاز العامة', 'Company completion'), '${ov['completionRate'] ?? 0}%', '${ov['open'] ?? 0} ${tr('مفتوح', 'open')} · ${ov['overdue'] ?? 0} ${tr('متأخر', 'overdue')}', T.success, Icons.check_circle_outline)
            : tile(tr('أنجزتها', 'My completed'), '${ac['done'] ?? 0}', '', T.success, Icons.check_circle_outline),
      ])),
    );
  }

  Widget _upcoming() {
    final up = List<Map<String, dynamic>>.from(_dash?['upcoming'] ?? []);
    if (up.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
      child: AppCard(
        padding: const EdgeInsets.all(10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(tr('اجتماعات قادمة', 'Coming up'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final m in up)
              ActionChip(
                label: Text('${m['title']} · ${_dateTime(m['scheduledAt'])}${(m['location'] ?? '').toString().isNotEmpty ? ' · ${m['location']}' : ''}', style: const TextStyle(fontSize: 11)),
                onPressed: () => _openMeeting(m['_id']),
              ),
          ]),
        ]),
      ),
    );
  }

  Widget _filters() {
    final cad = List<Map<String, dynamic>>.from(widget.meta['cadences'] ?? []);
    final sts = List<Map<String, dynamic>>.from(widget.meta['meetingStatuses'] ?? []);
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
      child: Column(children: [
        SearchField(
          controller: _searchCtl,
          dense: true,
          hint: tr('ابحث في الاجتماعات…', 'Search meetings…'),
          onChanged: (v) => setState(() => _q = v),
        ),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: _cadence,
              isExpanded: true,
              isDense: true,
              decoration: InputDecoration(labelText: tr('الدورة', 'Cadence'), isDense: true),
              items: [
                DropdownMenuItem(value: '', child: Text(tr('كل الدورات', 'All cadences'))),
                for (final c in cad) DropdownMenuItem(value: c['key'].toString(), child: Text(tr((c['ar'] ?? '').toString(), (c['en'] ?? '').toString()))),
              ],
              onChanged: (v) { setState(() { _cadence = v ?? ''; _loading = true; }); _load(); },
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: DropdownButtonFormField<String>(
              key: ValueKey('st-$_status-$_bucket'),
              initialValue: _status,
              isExpanded: true,
              isDense: true,
              decoration: InputDecoration(labelText: tr('الحالة', 'Status'), isDense: true),
              items: [
                DropdownMenuItem(value: '', child: Text(tr('كل الحالات', 'All statuses'))),
                for (final c in sts) DropdownMenuItem(value: c['key'].toString(), child: Text(tr((c['ar'] ?? '').toString(), (c['en'] ?? '').toString()))),
              ],
              onChanged: (v) { setState(() { _status = v ?? ''; if (_status.isNotEmpty) _bucket = ''; _loading = true; }); _load(); },
            ),
          ),
          if (_bucket.isNotEmpty || _status.isNotEmpty || _cadence.isNotEmpty)
            IconButton(
              tooltip: tr('إلغاء الفلترة', 'Clear'),
              icon: const Icon(Icons.filter_alt_off_outlined),
              onPressed: () { setState(() { _bucket = ''; _status = ''; _cadence = ''; _loading = true; }); _load(); },
            ),
        ]),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _rows.isEmpty && _dash == null) {
      return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer()]);
    }
    if (_error != null) return ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); });
    final s = _q.trim().toLowerCase();
    final rows = s.isEmpty ? _rows : _rows.where((m) => '${m['title']} ${m['refNumber']} ${m['location'] ?? ''}'.toLowerCase().contains(s)).toList();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 80), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
        _tiles(),
        _upcoming(),
        _cards(),
        _filters(),
        if (_loading) const Padding(padding: EdgeInsets.symmetric(horizontal: 14, vertical: 6), child: LinearProgressIndicator(minHeight: 2)),
        if (rows.isEmpty)
          Padding(padding: const EdgeInsets.only(top: 40), child: EmptyState(icon: Icons.event_note_outlined, title: s.isNotEmpty ? tr('لا نتائج مطابقة', 'No matches') : tr('لا توجد اجتماعات بعد.', 'No meetings yet.'))),
        for (final m in rows) _meetingCard(m),
      ]),
    );
  }

  Widget _meetingCard(Map<String, dynamic> m) {
    final st = _vocab(widget.meta['meetingStatuses'] as List?, m['status']?.toString());
    final actions = Map<String, dynamic>.from(m['actions'] ?? {});
    final depts = List.from(m['departments'] ?? []);
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
      child: Pressable(
        onTap: () => _openMeeting(m['_id']),
        child: AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(m['title'].toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
              Chip2(st.label, st.color),
            ]),
            const SizedBox(height: 6),
            Text('${m['refNumber']} · ${_dateTime(m['scheduledAt'])}${(m['location'] ?? '').toString().isNotEmpty ? ' · ${m['location']}' : ''}',
                style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
            const SizedBox(height: 8),
            Wrap(spacing: 6, runSpacing: 6, children: [
              Chip2(_vocab(widget.meta['cadences'] as List?, m['cadence']?.toString()).label, T.navy),
              Chip2('${(m['attendees'] as List?)?.length ?? 0} ${tr('حاضر', 'attendees')}', T.info, icon: Icons.groups_outlined),
              if ((actions['total'] ?? 0) > 0)
                Chip2('${tr('البنود', 'Actions')}: ${actions['total']}${(actions['open'] ?? 0) > 0 ? ' · ${actions['open']} ${tr('مفتوح', 'still open')}' : ''}',
                    (actions['open'] ?? 0) > 0 ? T.warn : T.success),
              for (final d in depts.take(5)) Chip2(brDept(context, d.toString()), T.inkFaint),
            ]),
          ]),
        ),
      ),
    );
  }
}

// Schedule a meeting
class _NewMeetingScreen extends StatefulWidget {
  final Map<String, dynamic> meta;
  const _NewMeetingScreen({required this.meta});
  @override
  State<_NewMeetingScreen> createState() => _NewMeetingScreenState();
}

class _NewMeetingScreenState extends State<_NewMeetingScreen> {
  final _title = TextEditingController();
  final _location = TextEditingController();
  final _link = TextEditingController();
  final _duration = TextEditingController(text: '60');
  final _agenda = <TextEditingController>[TextEditingController()];
  String _cadence = 'weekly';
  DateTime _date = DateTime.now();
  TimeOfDay _time = const TimeOfDay(hour: 10, minute: 0);
  final Set<String> _departments = {};
  late List<String> _attendees;
  String _chair = '';
  String _peopleQ = '';
  final _peopleCtl = TextEditingController(); // Stays equal to _peopleQ if the field leaves the screen.
  bool _busy = false;

  @override
  void dispose() { _peopleCtl.dispose(); super.dispose(); }

  List<Map<String, dynamic>> get _participants => List<Map<String, dynamic>>.from(widget.meta['participants'] ?? []);

  @override
  void initState() {
    super.initState();
    // Management is present by default, since most items come from them (like the web).
    _attendees = _participants.where((p) => p['isExecutive'] == true).map((p) => p['_id'].toString()).toList();
    _chair = _attendees.isNotEmpty ? _attendees.first : '';
    final cads = List.from(widget.meta['cadences'] ?? []);
    if (cads.isNotEmpty && !cads.any((c) => c['key'] == _cadence)) _cadence = cads.first['key'].toString();
  }

  Future<void> _submit() async {
    if (_title.text.trim().isEmpty) { brSnack(context, tr('العنوان مطلوب', 'A title is required')); return; }
    if (_attendees.isEmpty) { brSnack(context, tr('أضف حاضرًا واحدًا على الأقل', 'Invite at least one person')); return; }
    setState(() => _busy = true);
    try {
      final at = DateTime(_date.year, _date.month, _date.day, _time.hour, _time.minute);
      final r = await Api.instance.post('/api/business-review/meetings', {
        'title': _title.text.trim(),
        'cadence': _cadence,
        'scheduledAt': at.toUtc().toIso8601String(),
        'durationMinutes': int.tryParse(_duration.text) ?? 60,
        'location': _location.text,
        'meetingLink': _link.text,
        'departments': _departments.toList(),
        'attendees': _attendees.map((id) => {'user': id, 'isChair': id == _chair}).toList(),
        'agenda': [
          for (final a in _agenda.where((a) => a.text.trim().isNotEmpty).toList().asMap().entries) {'title': a.value.text.trim(), 'order': a.key},
        ],
      });
      if (mounted) Navigator.pop(context, (r['meeting']?['_id'] ?? '').toString());
    } catch (e) {
      if (mounted) brSnack(context, e is ApiException ? e.message : tr('تعذّر إنشاء الاجتماع', 'Could not create the meeting'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _peopleQ.trim().toLowerCase();
    final people = _participants.where((p) =>
        _attendees.contains(p['_id']) || q.isEmpty || '${p['name']} ${p['department'] ?? ''} ${p['jobTitle'] ?? ''} ${p['role']}'.toLowerCase().contains(q)).toList();
    return AppScaffold(
      title: Text(tr('جدولة اجتماع مراجعة', 'Schedule a review meeting')),
      body: ListView(padding: const EdgeInsets.all(14), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
        TextField(controller: _title, decoration: InputDecoration(labelText: tr('عنوان الاجتماع *', 'Title *'), hintText: tr('مثال: اجتماع مراجعة الأعمال الأسبوعي', 'e.g. Weekly business review'))),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: _cadence,
              decoration: InputDecoration(labelText: tr('الدورة', 'Cadence'), isDense: true),
              items: [for (final c in List<Map<String, dynamic>>.from(widget.meta['cadences'] ?? [])) DropdownMenuItem(value: c['key'].toString(), child: Text(tr((c['ar'] ?? '').toString(), (c['en'] ?? '').toString())))],
              onChanged: (v) => setState(() => _cadence = v ?? _cadence),
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(width: 100, child: TextField(controller: _duration, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('المدة (دقيقة)', 'Minutes'), isDense: true))),
        ]),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () async {
                final v = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime(2020), lastDate: DateTime.now().add(const Duration(days: 730)));
                if (v != null) setState(() => _date = v);
              },
              icon: const Icon(Icons.event, size: 17),
              label: Text(brIsoDay(_date)),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () async {
                final v = await showTimePicker(context: context, initialTime: _time);
                if (v != null) setState(() => _time = v);
              },
              icon: const Icon(Icons.schedule, size: 17),
              label: Text('${_time.hour.toString().padLeft(2, '0')}:${_time.minute.toString().padLeft(2, '0')}'),
            ),
          ),
        ]),
        const SizedBox(height: 10),
        TextField(controller: _location, decoration: InputDecoration(labelText: tr('المكان', 'Location'), isDense: true)),
        const SizedBox(height: 8),
        TextField(controller: _link, keyboardType: TextInputType.url, decoration: InputDecoration(labelText: tr('رابط الاجتماع', 'Meeting link'), isDense: true)),
        const SizedBox(height: 14),
        Text(tr('الأقسام المشمولة', 'Departments covered'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final d in List<String>.from((widget.meta['departments'] ?? []).map((e) => e.toString())))
            FilterChip(
              label: Text(brDept(context, d), style: const TextStyle(fontSize: 11.5)),
              selected: _departments.contains(d),
              onSelected: (v) => setState(() => v ? _departments.add(d) : _departments.remove(d)),
            ),
        ]),
        const SizedBox(height: 14),
        Text('${tr('الحاضرون *', 'Attendees *')} — ${tr('مديرو الأقسام والإدارة', 'department heads and the board')}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        SearchField(
          controller: _peopleCtl,
          dense: true,
          hint: tr('ابحث بالاسم أو القسم أو المسمى…', 'Search by name, department or role…'),
          onChanged: (v) => setState(() => _peopleQ = v),
        ),
        const SizedBox(height: 6),
        if (_participants.isEmpty) Text(tr('لا يوجد مديرو أقسام.', 'No department heads found.'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
        for (final p in people)
          CheckboxListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _attendees.contains(p['_id']),
            onChanged: (v) => setState(() {
              if (v == true) { _attendees.add(p['_id'].toString()); } else { _attendees.remove(p['_id']); if (_chair == p['_id']) _chair = ''; }
            }),
            title: Row(children: [
              Flexible(child: Text('${p['name']}', style: const TextStyle(fontSize: 13))),
              if (p['isExecutive'] == true) Padding(padding: const EdgeInsetsDirectional.only(start: 6), child: Text(tr('الإدارة', 'Board'), style: const TextStyle(fontSize: 10, color: T.orange))),
            ]),
            subtitle: Text((p['department'] ?? '').toString().isNotEmpty ? p['department'].toString() : brDept(context, p['role']?.toString()), style: const TextStyle(fontSize: 11)),
            secondary: _attendees.contains(p['_id'])
                ? ChoiceChip(
                    label: Text(tr('رئيس الاجتماع', 'Chair'), style: const TextStyle(fontSize: 10.5)),
                    selected: _chair == p['_id'],
                    onSelected: (_) => setState(() => _chair = _chair == p['_id'] ? '' : p['_id'].toString()),
                  )
                : null,
          ),
        const SizedBox(height: 14),
        Text(tr('جدول الأعمال', 'Agenda'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        for (var i = 0; i < _agenda.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(children: [
              Expanded(child: TextField(controller: _agenda[i], decoration: InputDecoration(hintText: '${tr('بند', 'Item')} ${i + 1}', isDense: true))),
              if (_agenda.length > 1) IconButton(icon: const Icon(Icons.close, size: 18, color: T.danger), onPressed: () => setState(() => _agenda.removeAt(i))),
            ]),
          ),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton(onPressed: () => setState(() => _agenda.add(TextEditingController())), child: Text('+ ${tr('إضافة بند', 'Add item')}')),
        ),
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: _busy ? null : _submit,
          icon: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.add),
          label: Text(tr('جدولة', 'Schedule')),
        ),
        const SizedBox(height: 30),
      ]),
    );
  }
}

// Items (mine or the full register)
class _ActionsTab extends StatefulWidget {
  final Map<String, dynamic> meta;
  /// true → my own actions; false → the whole register (board/secretariat).
  final bool mine;
  const _ActionsTab({required this.meta, required this.mine});
  @override
  State<_ActionsTab> createState() => _ActionsTabState();
}

class _ActionsTabState extends State<_ActionsTab> {
  List<Map<String, dynamic>> _rows = [];
  // My items also list parts of a colleague's task handed to me, counted with mine.
  List<Map<String, dynamic>> _handed = [];
  Map<String, dynamic> _summary = {};
  List<Map<String, dynamic>> _byPerson = [];
  bool _loading = true;
  String? _error;
  // My items: open/overdue/done/all, like the web.
  String _filter = 'open';
  // Register: status and assignee on the server; search and "overdue only" in memory.
  String _status = '';
  String _assignee = '';
  String _q = '';
  final _searchCtl = TextEditingController(); // Text stays equal to _q after loading.
  bool _onlyOverdue = false;
  int _seq = 0;

  void _onLive() => _load();

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('br:action', _onLive);
    Live.instance.on('br:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('br:action', _onLive);
    Live.instance.off('br:updated', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  String _registerQs({bool all = false}) {
    if (all) return '';
    final q = [if (_status.isNotEmpty) 'status=$_status', if (_assignee.isNotEmpty) 'assignee=$_assignee'];
    return q.isEmpty ? '' : '?${q.join('&')}';
  }

  Future<void> _load() async {
    final my = ++_seq;
    try {
      final path = widget.mine ? '/api/business-review/my-actions' : '/api/business-review/actions${_registerQs()}';
      final d = await Api.instance.get(path);
      final h = widget.mine ? await Api.instance.get('/api/business-review/my-tasks').then<dynamic>((v) => v, onError: (_) => null) : null;
      if (!mounted || my != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['actions'] ?? []);
        _summary = Map<String, dynamic>.from(d['summary'] ?? {});
        _handed = h == null ? [] : List<Map<String, dynamic>>.from(h['assignments'] ?? []);
        if (h != null) {
          final hs = Map<String, dynamic>.from(h['summary'] ?? {});
          for (final k in ['total', 'open', 'overdue', 'done']) {
            _summary[k] = ((_summary[k] ?? 0) as num) + ((hs[k] ?? 0) as num);
          }
        }
        _byPerson = List<Map<String, dynamic>>.from(d['byPerson'] ?? []);
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted && my == _seq) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  List<Map<String, dynamic>> get _shownHanded {
    if (!widget.mine) return const [];
    return _handed.where((a) => switch (_filter) {
      'all' => true,
      'done' => a['status'] == 'done',
      'overdue' => a['isOverdue'] == true && _open.contains(a['status']),
      _ => _open.contains(a['status']),
    }).toList();
  }

  List<Map<String, dynamic>> get _shown {
    var list = _rows;
    if (widget.mine) {
      if (_filter == 'done') return list.where((a) => a['status'] == 'done').toList();
      if (_filter == 'overdue') return list.where((a) => a['isOverdue'] == true && _open.contains(a['status'])).toList();
      if (_filter == 'open') return list.where((a) => _open.contains(a['status'])).toList();
      return list;
    }
    if (_onlyOverdue) list = list.where((a) => a['isOverdue'] == true && _open.contains(a['status'])).toList();
    final s = _q.trim().toLowerCase();
    if (s.isNotEmpty) list = list.where((a) => '${a['title']} ${a['assigneeName']} ${a['meetingRef']} ${a['department'] ?? ''}'.toLowerCase().contains(s)).toList();
    return list;
  }

  List<ExportCol> get _exportCols => [
        ExportCol('الاجتماع', 'Meeting', (r) => r['meetingRef']),
        ExportCol('البند', 'Action', (r) => r['title']),
        ExportCol('المكلَّف', 'Owner', (r) => r['assigneeName']),
        ExportCol('بطلب من', 'Requested by', (r) => r['raisedByName']),
        ExportCol('القسم', 'Department', (r) => r['department']),
        ExportCol('موعد التسليم', 'Due', (r) => _date(r['dueDate'])),
        ExportCol('الحالة', 'Status', (r) => _vocab(widget.meta['actionStatuses'] as List?, r['status']?.toString()).label),
        ExportCol('الإنجاز %', 'Progress %', (r) => r['progress']),
        ExportCol('متأخر', 'Overdue', (r) => r['isOverdue'] == true ? tr('نعم', 'Yes') : tr('لا', 'No')),
        ExportCol('موزّع على', 'Delegated to', (r) => List.from(r['delegations'] ?? []).map((d) => d['assigneeName']).join(' | ')),
      ];

  /// Like the web: "shown" under the filter, or "all" via a fresh call with no filters.
  Future<void> _export() async {
    final filtered = _q.trim().isNotEmpty || _status.isNotEmpty || _assignee.isNotEmpty || _onlyOverdue;
    var scope = 'shown';
    if (filtered) {
      final s = await showModalBottomSheet<String>(
        context: context,
        builder: (c) => SafeArea(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            ListTile(leading: const Icon(Icons.filter_alt_outlined), title: Text(tr('المعروض', 'Shown')), onTap: () => Navigator.pop(c, 'shown')),
            ListTile(leading: const Icon(Icons.select_all), title: Text(tr('الكل', 'All')), onTap: () => Navigator.pop(c, 'all')),
          ]),
        ),
      );
      if (s == null) return;
      scope = s;
    }
    var rows = _shown;
    if (scope == 'all') {
      try {
        final d = await Api.instance.get('/api/business-review/actions');
        rows = List<Map<String, dynamic>>.from(d['actions'] ?? []);
      } catch (e) {
        if (mounted) brSnack(context, brErr(e));
        return;
      }
    }
    if (!mounted) return;
    await exportExcel(context, fileName: 'business-review-actions', sheets: [(tr('سجل المتابعة', 'Action register'), _exportCols, rows)]);
  }

  Widget _registerFilters() {
    final sts = List<Map<String, dynamic>>.from(widget.meta['actionStatuses'] ?? []);
    final parts = List<Map<String, dynamic>>.from(widget.meta['participants'] ?? []);
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
      child: Column(children: [
        Row(children: [
          Expanded(
            child: SearchField(
              controller: _searchCtl,
              dense: true,
              hint: tr('ابحث في البنود…', 'Search actions…'),
              onChanged: (v) => setState(() => _q = v),
            ),
          ),
          IconButton(tooltip: tr('تصدير Excel', 'Export Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: _status,
              isExpanded: true,
              isDense: true,
              decoration: InputDecoration(labelText: tr('الحالة', 'Status'), isDense: true),
              items: [
                DropdownMenuItem(value: '', child: Text(tr('كل الحالات', 'All statuses'))),
                for (final s in sts) DropdownMenuItem(value: s['key'].toString(), child: Text(tr((s['ar'] ?? '').toString(), (s['en'] ?? '').toString()))),
              ],
              onChanged: (v) { setState(() { _status = v ?? ''; _loading = true; }); _load(); },
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: DropdownButtonFormField<String>(
              key: ValueKey('as-$_assignee'),
              initialValue: parts.any((p) => p['_id'] == _assignee) ? _assignee : '',
              isExpanded: true,
              isDense: true,
              decoration: InputDecoration(labelText: tr('المكلَّف', 'Owner'), isDense: true),
              items: [
                DropdownMenuItem(value: '', child: Text(tr('كل المكلَّفين', 'Everyone'))),
                for (final p in parts) DropdownMenuItem(value: p['_id'].toString(), child: Text('${p['name']}', overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) { setState(() { _assignee = v ?? ''; _loading = true; }); _load(); },
            ),
          ),
        ]),
        Row(children: [
          FilterChip(label: Text(tr('المتأخر فقط', 'Overdue only')), selected: _onlyOverdue, onSelected: (v) => setState(() => _onlyOverdue = v)),
          const Spacer(),
          if (_byPerson.isNotEmpty)
            TextButton.icon(
              onPressed: _showByPerson,
              icon: const Icon(Icons.groups_outlined, size: 18),
              label: Text(tr('التوزيع حسب المكلَّف', 'Load by person'), style: const TextStyle(fontSize: 12)),
            ),
        ]),
      ]),
    );
  }

  /// Who owes what: the web's side panel; tapping filters by assignee.
  void _showByPerson() {
    showModalBottomSheet(
      context: context,
      builder: (c) => SafeArea(
        child: ListView(shrinkWrap: true, padding: const EdgeInsets.all(12), children: [
          Text(tr('التوزيع حسب المكلَّف', 'Load by person'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
          const SizedBox(height: 6),
          for (final p in _byPerson)
            ListTile(
              dense: true,
              selected: _assignee == p['assignee'],
              title: Text('${p['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: (p['overdue'] ?? 0) > 0 ? Text('${p['overdue']} ${tr('متأخر', 'overdue')}', style: const TextStyle(color: T.danger, fontSize: 11)) : null,
              trailing: Text('${p['open']}/${p['total']}'),
              onTap: () {
                Navigator.pop(c);
                setState(() { _assignee = _assignee == p['assignee'] ? '' : p['assignee'].toString(); _loading = true; });
                _load();
              },
            ),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _rows.isEmpty && _summary.isEmpty) {
      return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer()]);
    }
    if (_error != null) return ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); });

    final rows = _shown;
    final meId = (widget.meta['me']?['_id'] ?? '').toString();
    final runner = widget.meta['me']?['canRunMeetings'] == true;
    final chips = [
      ('open', tr('مفتوحة', 'Open'), _summary['open'] ?? 0),
      ('overdue', tr('متأخرة', 'Overdue'), _summary['overdue'] ?? 0),
      ('done', tr('منجزة', 'Completed'), _summary['done'] ?? 0),
      ('all', tr('الكل', 'All'), _summary['total'] ?? 0),
    ];

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 80), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
          child: Row(children: [
            Expanded(child: StatCard(label: tr('مفتوحة', 'Open'), value: (_summary['open'] ?? 0) as num, color: T.info, icon: Icons.pending_actions_outlined)),
            const SizedBox(width: 8),
            Expanded(child: StatCard(label: tr('متأخرة', 'Overdue'), value: (_summary['overdue'] ?? 0) as num, color: T.danger, icon: Icons.warning_amber_outlined)),
            const SizedBox(width: 8),
            Expanded(child: StatCard(label: tr('منجزة', 'Done'), value: (_summary['done'] ?? 0) as num, color: T.success, icon: Icons.check_circle_outline)),
          ]),
        ),
        if (!widget.mine && _summary['completionRate'] != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Text('${tr('إجمالي البنود', 'Total actions')}: ${_summary['total'] ?? 0} · ${tr('نسبة الإنجاز', 'Completion rate')}: ${_summary['completionRate']}%',
                style: const TextStyle(fontSize: 12, color: T.inkSoft, fontWeight: FontWeight.w700)),
          ),
        if (widget.mine)
          SizedBox(
            height: 44,
            child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 14), children: [
              for (final c in chips)
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: 6),
                  child: ChoiceChip(label: Text('${c.$2} (${c.$3})'), selected: _filter == c.$1, onSelected: (_) => setState(() => _filter = c.$1)),
                ),
            ]),
          )
        else
          _registerFilters(),
        if (_loading) const Padding(padding: EdgeInsets.symmetric(horizontal: 14, vertical: 4), child: LinearProgressIndicator(minHeight: 2)),
        if (rows.isEmpty && _shownHanded.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 50),
            child: EmptyState(
              icon: Icons.task_alt_outlined,
              title: widget.mine && _filter == 'open' ? tr('لا يوجد شيء مفتوح — كل شيء منجز.', 'Nothing open — you are clear.') : tr('لا توجد بنود مطابقة.', 'No actions match.'),
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
          child: Column(children: [
            for (final a in rows)
              BrActionCard(
                key: ValueKey(a['_id']),
                action: a,
                meta: widget.meta,
                showMeeting: true,
                onChanged: _load,
                // My items: update and delegate. Register: update and delegate (owner or manager) and delete.
                canDelegate: widget.mine || a['assignee'] == meId || runner,
                canDelete: !widget.mine,
              ),
            if (_shownHanded.isNotEmpty) ...[
              Align(alignment: AlignmentDirectional.centerStart, child: Padding(
                padding: const EdgeInsets.only(top: 10, bottom: 6),
                child: Text(tr('مهام موزّعة عليّ من زميل', 'Handed to me by a colleague'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
              )),
              for (final a in _shownHanded)
                _WorkCard(key: ValueKey('h-${a['_id']}'), row: a, meta: widget.meta, isAction: false,
                    subtitle: '${tr('من', 'From')}: ${a['assignedByName']}', onSaved: _load),
            ],
          ]),
        ),
      ]),
    );
  }
}

// My tasks (employee)
class _TasksTab extends StatefulWidget {
  final Map<String, dynamic> meta;
  const _TasksTab({required this.meta});
  @override
  State<_TasksTab> createState() => _TasksTabState();
}

class _TasksTabState extends State<_TasksTab> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _summary = {};
  bool _loading = true;
  String? _error;
  bool _openOnly = true;

  void _onLive() => _load();

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('br:assignment', _onLive);
    Live.instance.on('br:action', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('br:assignment', _onLive);
    Live.instance.off('br:action', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/business-review/my-tasks');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['assignments'] ?? []);
        _summary = Map<String, dynamic>.from(d['summary'] ?? {});
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer()]);
    }
    if (_error != null) return ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); });

    final rows = _openOnly ? _rows.where((a) => _open.contains(a['status'])).toList() : _rows;

    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
        child: Row(children: [
          Expanded(child: StatCard(label: tr('مفتوحة', 'Open'), value: (_summary['open'] ?? 0) as num, color: T.info, icon: Icons.pending_actions_outlined)),
          const SizedBox(width: 8),
          Expanded(child: StatCard(label: tr('متأخرة', 'Overdue'), value: (_summary['overdue'] ?? 0) as num, color: T.danger, icon: Icons.warning_amber_outlined)),
          const SizedBox(width: 8),
          Expanded(child: StatCard(label: tr('منجزة', 'Done'), value: (_summary['done'] ?? 0) as num, color: T.success, icon: Icons.check_circle_outline)),
        ]),
      ),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14),
        child: Row(children: [
          FilterChip(
            label: Text(tr('المفتوحة فقط', 'Open only')),
            selected: _openOnly,
            onSelected: (v) => setState(() => _openOnly = v),
          ),
        ]),
      ),
      Expanded(
        child: rows.isEmpty
            ? ListView(children: [
                Padding(padding: const EdgeInsets.only(top: 50),
                    child: EmptyState(icon: Icons.checklist_rounded, title: tr('لا توجد مهام', 'No tasks'))),
              ])
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView.builder(
                  padding: const EdgeInsets.fromLTRB(14, 8, 14, 20),
                  itemCount: rows.length,
                  itemBuilder: (c, i) => _WorkCard(
                    row: rows[i], meta: widget.meta, isAction: false,
                    subtitle: '${tr('من', 'From')}: ${rows[i]['assignedByName']}',
                    onSaved: _load,
                  ),
                ),
              ),
      ),
    ]);
  }
}

/// One action or delegated task, with the sheet that reports progress on it.
class _WorkCard extends StatelessWidget {
  final Map<String, dynamic> row;
  final Map<String, dynamic> meta;
  final bool isAction;
  final String subtitle;
  final Future<void> Function() onSaved;
  const _WorkCard({super.key, required this.row, required this.meta, required this.isAction,
    required this.subtitle, required this.onSaved});

  bool get _overdue => row['isOverdue'] == true && _open.contains(row['status']);

  Future<void> _report(BuildContext context) async {
    final v = await brProgressSheet(context, meta, row['title'].toString(), row['status']?.toString() ?? 'open', (row['progress'] ?? 0) as num, expectedDate: row['expectedDate']);
    if (v == null) return;
    final path = isAction ? '/api/business-review/actions/${row['_id']}' : '/api/business-review/assignments/${row['_id']}';
    try {
      await Api.instance.patch(path, v);
      await onSaved();
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر الحفظ', 'Could not save'))));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final st = _vocab(meta['actionStatuses'] as List?, row['status']?.toString());
    final pr = _vocab(meta['priorities'] as List?, row['priority']?.toString());
    final progress = ((row['progress'] ?? 0) as num).toDouble();
    final delegations = List<Map<String, dynamic>>.from(row['delegations'] ?? []);

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Pressable(
        onTap: () => _report(context),
        child: AppCard(
          topAccent: _overdue ? T.danger : null,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(row['title'].toString(),
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
              Chip2(st.label, st.color),
            ]),
            const SizedBox(height: 5),
            Text(subtitle, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: (progress / 100).clamp(0.0, 1.0), minHeight: 5,
                backgroundColor: T.line, valueColor: AlwaysStoppedAnimation(st.color),
              ),
            ),
            const SizedBox(height: 8),
            Wrap(spacing: 6, runSpacing: 6, children: [
              Chip2(pr.label, pr.color),
              Chip2('${tr('التسليم', 'Due')}: ${_date(row['dueDate'])}', _overdue ? T.danger : T.info,
                  icon: _overdue ? Icons.warning_amber_outlined : Icons.event_outlined),
              Chip2('${progress.round()}%', T.navy),
              if (delegations.isNotEmpty)
                Chip2('${delegations.length} ${tr('تكليف فرعي', 'delegated')}', T.violet, icon: Icons.groups_outlined),
            ]),
          ]),
        ),
      ),
    );
  }
}
