import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// اجتماعات مراجعة الأعمال — the mobile half.
///
/// Same contract as the web (`/api/business-review/*`) and the same visibility
/// rule, enforced server-side: a department head gets the meetings they sat in
/// and the actions they own; an ordinary employee gets ONLY the tasks delegated
/// to them, and the tabs they don't qualify for simply never appear.
///
/// The vocabularies (statuses, priorities, cadences) come from `/meta`, so a new
/// status added on the server shows up here without an app release.

const _open = ['open', 'in_progress', 'blocked'];

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
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () { if (mounted) setState(() {}); };
    Live.instance.on('br:updated', _onLive);
    Live.instance.on('br:action', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('br:updated', _onLive);
    Live.instance.off('br:action', _onLive);
    super.dispose();
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
      if (participant) (tr('الاجتماعات', 'Meetings'), _MeetingsTab(meta: _meta!)),
      if (participant) (tr('بنودي', 'My actions'), _ActionsTab(meta: _meta!, mine: true)),
      if (runner) (tr('سجل المتابعة', 'Register'), _ActionsTab(meta: _meta!, mine: false)),
      (tr('مهامي', 'My tasks'), _TasksTab(meta: _meta!)),
    ];

    return DefaultTabController(
      length: tabs.length,
      child: AppScaffold(
        title: Text(tr('مراجعة الأعمال', 'Business Review')),
        appBarBottom: tabs.length > 1
            ? TabBar(isScrollable: true, tabAlignment: TabAlignment.start, tabs: tabs.map((t) => Tab(text: t.$1)).toList())
            : null,
        body: TabBarView(children: tabs.map((t) => t.$2).toList()),
      ),
    );
  }
}

// ── الاجتماعات ──────────────────────────────────────────────────────────────
class _MeetingsTab extends StatefulWidget {
  final Map<String, dynamic> meta;
  const _MeetingsTab({required this.meta});
  @override
  State<_MeetingsTab> createState() => _MeetingsTabState();
}

/// أوعية البطاقات — نفس مفاتيح الـ bucket اللي السيرفر بيفهمها، ونفس ترتيب الويب.
const _buckets = [
  ('', 'كل الاجتماعات', 'All', 'total', T.navy),
  ('open', 'لسه مفتوحة', 'Open', 'open', T.orange),
  ('completed', 'مكتملة', 'Completed', 'completed', Color(0xFF0F766E)),
  ('upcoming', 'قادمة', 'Upcoming', 'upcoming', T.info),
  ('cancelled', 'ملغاة', 'Cancelled', 'cancelled', T.inkFaint),
];

class _MeetingsTabState extends State<_MeetingsTab> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _counts = {};
  String _bucket = '';
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/business-review/meetings${_bucket.isEmpty ? '' : '?bucket=$_bucket'}');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['meetings'] ?? []);
        // العدّادات محسوبة على النطاق كله، فهي بتفضل صحيحة وانت واقف على فلتر.
        if (d['counts'] != null) _counts = Map<String, dynamic>.from(d['counts'] as Map);
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  /// إقفال الاجتماع — «اكتمل». السيرفر بيرفض لو لسه فيه شغل مفتوح، وبيقول كام.
  Future<void> _complete(Map<String, dynamic> m) async {
    final go = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('إقفال الاجتماع؟', 'Close meeting?'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
      content: Text(
        tr('تحديده كـ«اكتمل» معناه إن كل حاجة اترتّبت على الاجتماع خلصت. هيترفض لو لسه فيه بند أو تكليف مفتوح.',
           'Completed means everything arising from this meeting is finished. Refused if any action or task is still open.'),
        style: const TextStyle(fontSize: 12.5, height: 1.5)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: const Color(0xFF0F766E)),
          onPressed: () => Navigator.pop(c, true), child: Text(tr('إقفال', 'Close'))),
      ],
    ));
    if (go != true) return;
    try {
      await Api.instance.post('/api/business-review/meetings/${m['_id']}/complete', {});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم إقفال الاجتماع', 'Closed'))));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
    }
  }

  Widget _cards() => SizedBox(
    height: 74,
    child: ListView.separated(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
      itemCount: _buckets.length,
      separatorBuilder: (_, __) => const SizedBox(width: 8),
      itemBuilder: (c, i) {
        final (key, ar, en, countKey, color) = _buckets[i];
        final active = _bucket == key;
        return Pressable(
          onTap: () { setState(() { _bucket = key; _loading = true; }); _load(); },
          child: Container(
            width: 108,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: active ? T.orange : T.line, width: active ? 1.6 : 1),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
              Text('${_counts[countKey] ?? 0}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 21, color: color, height: 1)),
              const SizedBox(height: 4),
              Text(tr(ar, en), style: const TextStyle(fontSize: 11, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis),
            ]),
          ),
        );
      },
    ),
  );

  /// The formal minutes as a PDF — rendered SERVER-side on the company
  /// letterhead, so what prints from the phone is byte-for-byte what prints
  /// from the website. The backend refuses it for anyone who wasn't in the room.
  Future<void> _printMinutes(String meetingId) async {
    final n = DateTime.now();
    final day = '${n.year}-${n.month.toString().padLeft(2, '0')}-${n.day.toString().padLeft(2, '0')}';
    try {
      final bytes = await Api.instance.getBytes(
        '/api/reports/meeting/${Uri.encodeComponent(meetingId)}'
        '?from=$day&to=$day&lang=${Lang.instance.ar ? 'ar' : 'en'}&format=pdf',
      );
      await Printing.layoutPdf(onLayout: (_) async => bytes, name: 'meeting-minutes');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e is ApiException ? e.message : tr('تعذّر إصدار المحضر', 'Could not generate the minutes')),
        ));
      }
    }
  }

  Future<void> _open(Map<String, dynamic> m) async {
    Map<String, dynamic>? d;
    try {
      d = Map<String, dynamic>.from(await Api.instance.get('/api/business-review/meetings/${m['_id']}'));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e is ApiException ? e.message : tr('تعذّر فتح الاجتماع', 'Could not open the meeting')),
        ));
      }
      return;
    }
    if (!mounted) return;
    final meeting = Map<String, dynamic>.from(d['meeting'] as Map);
    final actions = List<Map<String, dynamic>>.from(d['actions'] ?? []);
    final minutes = List<Map<String, dynamic>>.from(meeting['minutes'] ?? []);
    final attendees = List<Map<String, dynamic>>.from(meeting['attendees'] ?? []);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.88,
          child: ListView(padding: const EdgeInsets.all(18), children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(
                child: Text(meeting['title'].toString(),
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
              ),
              IconButton(
                onPressed: () => _printMinutes(meeting['_id'].toString()),
                icon: const Icon(Icons.print_outlined, size: 20),
                color: T.orange,
                tooltip: tr('طباعة المحضر', 'Print minutes'),
              ),
              if (widget.meta['me']?['canRunMeetings'] == true
                  && meeting['status'] != 'completed' && meeting['status'] != 'cancelled')
                IconButton(
                  onPressed: () { Navigator.pop(c); _complete(meeting); },
                  icon: const Icon(Icons.lock_outline, size: 20),
                  color: const Color(0xFF0F766E),
                  tooltip: tr('إقفال الاجتماع', 'Close meeting'),
                ),
            ]),
            const SizedBox(height: 4),
            Text('${meeting['refNumber']} · ${_dateTime(meeting['scheduledAt'])}',
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            const SizedBox(height: 10),
            if (meeting['status'] == 'completed' && (meeting['completedAt'] ?? '').toString().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(color: const Color(0xFFF0FDFA), borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: const Color(0xFF99F6E4))),
                  child: Text(
                    '${tr('أُقفل', 'Closed')} ${_dateTime(meeting['completedAt'])}'
                    '${(meeting['completedByName'] ?? '').toString().isEmpty ? '' : ' · ${meeting['completedByName']}'}',
                    style: const TextStyle(fontSize: 11.5, color: Color(0xFF0F766E), fontWeight: FontWeight.w700)),
                ),
              ),
            Wrap(spacing: 6, runSpacing: 6, children: [
              Chip2(_vocab(widget.meta['meetingStatuses'] as List?, meeting['status']?.toString()).label,
                  _vocab(widget.meta['meetingStatuses'] as List?, meeting['status']?.toString()).color),
              Chip2(_vocab(widget.meta['cadences'] as List?, meeting['cadence']?.toString()).label, T.navy),
              if ((meeting['location'] ?? '').toString().isNotEmpty)
                Chip2(meeting['location'].toString(), T.info, icon: Icons.place_outlined),
            ]),

            if (attendees.isNotEmpty) ...[
              const SizedBox(height: 18),
              Text(tr('الحاضرون', 'Attendees'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              const SizedBox(height: 6),
              Wrap(spacing: 6, runSpacing: 6, children: attendees.map((a) {
                final att = a['attendance']?.toString();
                final color = att == 'attended' ? T.success : att == 'absent' ? T.danger : att == 'excused' ? T.warn : T.inkFaint;
                return Chip2('${a['name']}', color, icon: a['isChair'] == true ? Icons.star_rounded : null);
              }).toList()),
            ],

            if (minutes.isNotEmpty) ...[
              const SizedBox(height: 18),
              Text(tr('محضر الاجتماع', 'Minutes'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              const SizedBox(height: 6),
              ...minutes.map((mm) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(mm['heading']?.toString() ?? '', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
                  if ((mm['body'] ?? '').toString().isNotEmpty)
                    Text(mm['body'].toString(), style: const TextStyle(fontSize: 12, color: T.inkSoft, height: 1.5)),
                ]),
              )),
            ],

            if (actions.isNotEmpty) ...[
              const SizedBox(height: 18),
              Text(tr('البنود التنفيذية', 'Actions'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              const SizedBox(height: 6),
              ...actions.map((a) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: AppCard(
                  padding: const EdgeInsets.all(12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text(a['title'].toString(),
                          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5))),
                      Chip2(_vocab(widget.meta['actionStatuses'] as List?, a['status']?.toString()).label,
                          _vocab(widget.meta['actionStatuses'] as List?, a['status']?.toString()).color),
                    ]),
                    const SizedBox(height: 4),
                    Text('${tr('المكلَّف', 'Owner')}: ${a['assigneeName']} · ${tr('التسليم', 'Due')}: ${_date(a['dueDate'])}',
                        style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                  ]),
                ),
              )),
            ],

            const SizedBox(height: 22),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: () => _printMinutes(meeting['_id'].toString()),
                icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
                label: Text(tr('تحميل المحضر الرسمي (PDF)', 'Download the minutes (PDF)')),
                style: FilledButton.styleFrom(backgroundColor: T.orange),
              ),
            ),
            const SizedBox(height: 8),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer()]);
    }
    if (_error != null) return ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); });
    if (_rows.isEmpty) {
      return Column(children: [
        _cards(),
        Expanded(child: ListView(children: [
          Padding(padding: const EdgeInsets.only(top: 40),
              child: EmptyState(icon: Icons.event_note_outlined, title: tr('لا توجد اجتماعات', 'No meetings'))),
        ])),
      ]);
    }
    return Column(children: [
      _cards(),
      Expanded(child: RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 20),
        itemCount: _rows.length,
        itemBuilder: (c, i) {
          final m = _rows[i];
          final st = _vocab(widget.meta['meetingStatuses'] as List?, m['status']?.toString());
          final actions = Map<String, dynamic>.from(m['actions'] ?? {});
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Pressable(
              onTap: () => _open(m),
              child: AppCard(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(m['title'].toString(),
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                    Chip2(st.label, st.color),
                  ]),
                  const SizedBox(height: 6),
                  Text('${m['refNumber']} · ${_dateTime(m['scheduledAt'])}',
                      style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                  const SizedBox(height: 8),
                  Wrap(spacing: 6, runSpacing: 6, children: [
                    Chip2(_vocab(widget.meta['cadences'] as List?, m['cadence']?.toString()).label, T.navy),
                    Chip2('${(m['attendees'] as List?)?.length ?? 0} ${tr('حاضر', 'attendees')}', T.info, icon: Icons.groups_outlined),
                    if ((actions['total'] ?? 0) > 0)
                      Chip2('${actions['open']}/${actions['total']} ${tr('بند مفتوح', 'open')}',
                          (actions['open'] ?? 0) > 0 ? T.warn : T.success),
                  ]),
                ]),
              ),
            ),
          );
        },
      ),
    )),
    ]);
  }
}

// ── البنود (مِلكي أو السجل الكامل) ──────────────────────────────────────────
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
  Map<String, dynamic> _summary = {};
  bool _loading = true;
  String? _error;
  bool _openOnly = true;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final path = widget.mine ? '/api/business-review/my-actions' : '/api/business-review/actions';
      final d = await Api.instance.get(path);
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['actions'] ?? []);
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
                    child: EmptyState(icon: Icons.task_alt_outlined, title: tr('لا توجد بنود', 'Nothing here'))),
              ])
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView.builder(
                  padding: const EdgeInsets.fromLTRB(14, 8, 14, 20),
                  itemCount: rows.length,
                  itemBuilder: (c, i) => _WorkCard(
                    row: rows[i], meta: widget.meta, isAction: true,
                    subtitle: widget.mine
                        ? '${rows[i]['meetingRef']} · ${tr('بطلب من', 'From')} ${rows[i]['raisedByName'] ?? '—'}'
                        : '${tr('المكلَّف', 'Owner')}: ${rows[i]['assigneeName']}',
                    onSaved: _load,
                  ),
                ),
              ),
      ),
    ]);
  }
}

// ── مهامي (الموظف) ──────────────────────────────────────────────────────────
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

  @override
  void initState() { super.initState(); _load(); }

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
  const _WorkCard({required this.row, required this.meta, required this.isAction,
    required this.subtitle, required this.onSaved});

  bool get _overdue => row['isOverdue'] == true && _open.contains(row['status']);

  void _report(BuildContext context) {
    var status = row['status']?.toString() ?? 'open';
    var progress = ((row['progress'] ?? 0) as num).toDouble();
    final note = TextEditingController();
    var busy = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(
        builder: (c, setSheet) => Padding(
          padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(row['title'].toString(), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              initialValue: status,
              decoration: InputDecoration(labelText: tr('الحالة', 'Status')),
              items: List<Map<String, dynamic>>.from(meta['actionStatuses'] ?? [])
                  .map((s) => DropdownMenuItem(value: s['key'].toString(),
                      child: Text(tr(s['ar'] ?? '', s['en'] ?? '')))).toList(),
              onChanged: (v) => setSheet(() => status = v ?? status),
            ),
            const SizedBox(height: 14),
            Text('${tr('نسبة الإنجاز', 'Progress')}: ${progress.round()}%',
                style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
            Slider(
              value: progress, min: 0, max: 100, divisions: 20,
              activeColor: T.orange, label: '${progress.round()}%',
              onChanged: (v) => setSheet(() => progress = v),
            ),
            TextField(controller: note, maxLines: 2,
                decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)'))),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: busy ? null : () async {
                  setSheet(() => busy = true);
                  final path = isAction
                      ? '/api/business-review/actions/${row['_id']}'
                      : '/api/business-review/assignments/${row['_id']}';
                  try {
                    await Api.instance.patch(path, {
                      'status': status, 'progress': progress.round(), 'note': note.text,
                    });
                    if (c.mounted) Navigator.pop(c);
                    await onSaved();
                  } catch (e) {
                    setSheet(() => busy = false);
                    if (c.mounted) {
                      ScaffoldMessenger.of(c).showSnackBar(SnackBar(
                        content: Text(e is ApiException ? e.message : tr('تعذّر الحفظ', 'Could not save')),
                      ));
                    }
                  }
                },
                child: busy
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : Text(tr('حفظ التحديث', 'Save update')),
              ),
            ),
          ]),
        ),
      ),
    );
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
