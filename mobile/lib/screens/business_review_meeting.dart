import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'business_review_kit.dart';

/// One whole meeting, /system/business-review/[id] on the web. Four tabs in the order things happen in a meeting: full record, agenda and attendance, minutes, executive items. What is allowed (`can`) is decided by the server per user.
class BusinessReviewMeetingScreen extends StatefulWidget {
  final String id;
  const BusinessReviewMeetingScreen({super.key, required this.id});
  @override
  State<BusinessReviewMeetingScreen> createState() => _BusinessReviewMeetingScreenState();
}

class _BusinessReviewMeetingScreenState extends State<BusinessReviewMeetingScreen> {
  Map<String, dynamic>? _meta;
  Map<String, dynamic>? _meeting;
  List<Map<String, dynamic>> _actions = [];
  Map<String, dynamic> _can = {};
  bool _loading = true;
  String? _error;
  bool _busy = false;
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
    super.dispose();
  }

  Future<void> _load() async {
    final my = ++_seq;
    try {
      final r = await Future.wait([
        Api.instance.get('/api/business-review/meta').catchError((_) => <String, dynamic>{}),
        Api.instance.get('/api/business-review/meetings/${widget.id}'),
      ]);
      if (!mounted || my != _seq) return;
      setState(() {
        if ((r[0] as Map).isNotEmpty) _meta = Map<String, dynamic>.from(r[0]);
        _meeting = Map<String, dynamic>.from(r[1]['meeting'] as Map);
        _actions = List<Map<String, dynamic>>.from(r[1]['actions'] ?? []);
        _can = Map<String, dynamic>.from(r[1]['can'] ?? {});
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && my == _seq) setState(() { _loading = false; _error = brErr(e); });
    }
  }

  Map<String, dynamic> get m => _meeting!;
  Map<String, dynamic> get meta => _meta ?? const {};

  Future<void> _put(Map<String, dynamic> body) async {
    try {
      final r = await Api.instance.put('/api/business-review/meetings/${m['_id']}', body);
      if (mounted && r is Map && r['meeting'] is Map) setState(() => _meeting = Map<String, dynamic>.from(r['meeting']));
    } catch (e) {
      if (mounted) brSnack(context, brErr(e));
    }
  }

  Future<void> _complete() async {
    final ok = await brConfirm(
      context,
      tr('إقفال هذا الاجتماع؟', 'Close this meeting?'),
      tr('تحديده كـ«اكتمل» يعني أن كل ما تُرتِّب على هذا الاجتماع قد أُنجِز. ويُرفَض إن بقي بند تنفيذي أو تكليف فرعي مفتوح.',
          'Marking it Completed says everything arising from this meeting is finished. It is refused if any action or delegated task is still open.'),
      ok: tr('إقفال', 'Close it'),
    );
    if (!ok) return;
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/business-review/meetings/${m['_id']}/complete', {'note': ''});
      if (mounted) brSnack(context, tr('تم إقفال الاجتماع', 'Meeting closed'));
      _load();
    } catch (e) {
      if (mounted) brSnack(context, brErr(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reopen() async {
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/business-review/meetings/${m['_id']}/reopen', {});
      if (mounted) brSnack(context, tr('تم إعادة الفتح', 'Reopened'));
      _load();
    } catch (e) {
      if (mounted) brSnack(context, brErr(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    final ok = await brConfirm(context, tr('حذف هذا الاجتماع؟', 'Delete this meeting?'),
        tr('سيتم حذف المحضر وكل البنود التنفيذية معه.', 'Its minutes and all its actions are deleted with it.'),
        ok: tr('حذف', 'Delete'), danger: true);
    if (!ok) return;
    try {
      await Api.instance.delete('/api/business-review/meetings/${m['_id']}');
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) brSnack(context, brErr(e));
    }
  }

  /// Official minutes PDF: generated on the server with the company letterhead, like the web.
  Future<void> _print() async {
    final day = brIsoDay(DateTime.now());
    try {
      final bytes = await Api.instance.getBytes('/api/reports/meeting/${Uri.encodeComponent(m['_id'].toString())}'
          '?from=$day&to=$day&lang=${Lang.instance.ar ? 'ar' : 'en'}&format=pdf');
      await Printing.layoutPdf(onLayout: (_) async => bytes, name: 'meeting-minutes');
    } catch (e) {
      if (mounted) brSnack(context, e is ApiException ? e.message : tr('تعذّر إصدار المحضر', 'Could not generate the minutes'));
    }
  }

  // Excel: the meeting as the screen shows it, one sheet per table (like the web)
  Future<void> _export() async {
    final scope = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.article_outlined), title: Text(tr('السجل الشامل', 'The whole record')), onTap: () => Navigator.pop(c, 'record')),
          ListTile(
            enabled: _actions.isNotEmpty,
            leading: const Icon(Icons.checklist_rounded),
            title: Text(tr('البنود التنفيذية والمتابعة', 'Actions & follow-up')),
            onTap: () => Navigator.pop(c, 'actions'),
          ),
        ]),
      ),
    );
    if (scope == null || !mounted) return;
    final aS = meta['actionStatuses'] as List?;
    final delegations = [for (final a in _actions) for (final d in List.from(a['delegations'] ?? [])) {...Map<String, dynamic>.from(d), 'parent': a['title']}];
    final updates = [for (final a in _actions) for (final u in List.from(a['updates'] ?? [])) {...Map<String, dynamic>.from(u), 'parent': a['title']}];
    final actionSheets = <(String, List<ExportCol>, List<Map<String, dynamic>>)>[
      (tr('البنود التنفيذية', 'Actions'), [
        ExportCol('البند', 'Action', (r) => r['title']),
        ExportCol('المكلَّف', 'Owner', (r) => r['assigneeName']),
        ExportCol('بطلب من', 'Requested by', (r) => r['raisedByName']),
        ExportCol('القسم', 'Department', (r) => r['department'] != null ? brDept(context, r['department']) : '—'),
        ExportCol('الحالة', 'Status', (r) => brVocab(aS, r['status']?.toString()).label),
        ExportCol('الأولوية', 'Priority', (r) => brVocab(meta['priorities'] as List?, r['priority']?.toString()).label),
        ExportCol('تاريخ الاستحقاق', 'Due', (r) => brDate(r['dueDate'])),
        ExportCol('متأخر', 'Overdue', (r) => r['isOverdue'] == true && brOpenStatuses.contains(r['status']) ? tr('نعم', 'Yes') : ''),
        ExportCol('نسبة الإنجاز %', 'Progress %', (r) => r['progress']),
        ExportCol('اكتمل في', 'Completed on', (r) => brDate(r['completedAt'])),
        ExportCol('الوصف', 'Description', (r) => r['description']),
      ], _actions),
      if (delegations.isNotEmpty)
        (tr('التكليفات الفرعية', 'Delegated tasks'), [
          ExportCol('البند الأصلي', 'Parent action', (r) => r['parent']),
          ExportCol('التكليف', 'Task', (r) => r['title']),
          ExportCol('المكلَّف', 'Assignee', (r) => r['assigneeName']),
          ExportCol('كلَّفه', 'Assigned by', (r) => r['assignedByName']),
          ExportCol('الحالة', 'Status', (r) => brVocab(aS, r['status']?.toString()).label),
          ExportCol('تاريخ الاستحقاق', 'Due', (r) => brDate(r['dueDate'])),
          ExportCol('نسبة الإنجاز %', 'Progress %', (r) => r['progress'] ?? 0),
        ], delegations),
      if (updates.isNotEmpty)
        (tr('متابعة البنود', 'Action updates'), [
          ExportCol('البند', 'Action', (r) => r['parent']),
          ExportCol('صاحب التحديث', 'By', (r) => r['byName']),
          ExportCol('تغيّر الحالة', 'Status change', (r) => r['statusTo'] != null ? '${brVocab(aS, r['statusFrom']?.toString()).label} → ${brVocab(aS, r['statusTo']?.toString()).label}' : '—'),
          ExportCol('الملاحظة', 'Note', (r) => r['text']),
          ExportCol('التاريخ', 'At', (r) => brDateTime(r['at'])),
        ], updates),
    ];
    final kv = [ExportCol('البند', 'Field', (r) => r['label']), ExportCol('القيمة', 'Value', (r) => r['value'])];
    final facts = <Map<String, dynamic>>[
      {'label': tr('الرقم المرجعي', 'Reference'), 'value': m['refNumber']},
      {'label': tr('عنوان الاجتماع', 'Title'), 'value': m['title']},
      {'label': tr('الدورة', 'Cadence'), 'value': brVocab(meta['cadences'] as List?, m['cadence']?.toString()).label},
      {'label': tr('الحالة', 'Status'), 'value': brVocab(meta['meetingStatuses'] as List?, m['status']?.toString()).label},
      {'label': tr('موعد الانعقاد', 'Scheduled for'), 'value': brDateTime(m['scheduledAt'])},
      {'label': tr('انعقد فعليًا', 'Actually held'), 'value': m['heldAt'] != null ? brDateTime(m['heldAt']) : tr('لم ينعقد بعد', 'Not yet')},
      {'label': tr('المدة', 'Duration'), 'value': m['durationMinutes'] != null ? '${m['durationMinutes']} ${tr('دقيقة', 'min')}' : '—'},
      {'label': tr('المكان', 'Location'), 'value': (m['location'] ?? '').toString().isEmpty ? '—' : m['location']},
      {'label': tr('كاتب المحضر', 'Minuted by'), 'value': m['scribeName'] ?? '—'},
      {'label': tr('أنشأه', 'Created by'), 'value': m['createdByName'] ?? '—'},
      {'label': tr('الأقسام', 'Departments'), 'value': List.from(m['departments'] ?? []).map((d) => brDept(context, d.toString())).join(' · ')},
      {'label': tr('وقت الإقفال', 'Closed at'), 'value': m['completedAt'] != null ? '${brDateTime(m['completedAt'])}${(m['completedByName'] ?? '').toString().isNotEmpty ? ' · ${m['completedByName']}' : ''}' : '—'},
      {'label': tr('الخلاصة', 'Summary'), 'value': (m['summary'] ?? '').toString().isEmpty ? '—' : m['summary']},
    ];
    final agenda = List<Map<String, dynamic>>.from(m['agenda'] ?? []);
    final minutes = List<Map<String, dynamic>>.from(m['minutes'] ?? []);
    final sheets = scope == 'actions'
        ? actionSheets
        : <(String, List<ExportCol>, List<Map<String, dynamic>>)>[
            (tr('بيانات الاجتماع', 'Meeting'), kv, facts),
            (tr('سجل الحضور', 'Attendance'), [
              ExportCol('الاسم', 'Name', (r) => r['name']),
              ExportCol('رئيس الاجتماع', 'Chair', (r) => r['isChair'] == true ? tr('نعم', 'Yes') : ''),
              ExportCol('القسم', 'Department', (r) => (r['department'] ?? '').toString().isNotEmpty ? r['department'] : brDept(context, r['role']?.toString())),
              ExportCol('الحضور', 'Attendance', (r) => brAttendanceOf(r['attendance']?.toString()).label),
              ExportCol('وقت التسجيل', 'Recorded at', (r) => r['attendanceAt'] != null ? brDateTime(r['attendanceAt']) : '—'),
              ExportCol('سجّله', 'Recorded by', (r) => r['attendanceByName']),
              ExportCol('سبب الاعتذار', 'Reason / note', (r) => r['excuseReason']),
            ], List<Map<String, dynamic>>.from(m['attendees'] ?? [])),
            if (agenda.isNotEmpty)
              (tr('جدول الأعمال', 'Agenda'), [
                ExportCol('#', '#', (r) => r['n']),
                ExportCol('البند', 'Item', (r) => r['title']),
                ExportCol('مُقدِّم البند', 'Presenter', (r) => r['presenterName']),
                ExportCol('القسم', 'Department', (r) => r['department'] != null ? brDept(context, r['department']) : '—'),
              ], [for (var i = 0; i < agenda.length; i++) {...agenda[i], 'n': i + 1}]),
            if (minutes.isNotEmpty)
              (tr('محضر الاجتماع', 'Minutes'), [
                ExportCol('الموضوع', 'Topic', (r) => r['heading']),
                ExportCol('القسم', 'Department', (r) => (r['department'] ?? '').toString().isNotEmpty ? brDept(context, r['department']) : '—'),
                ExportCol('ما نوقش وتقرَّر', 'What was discussed', (r) => r['body']),
              ], minutes),
            if (_actions.isNotEmpty) ...actionSheets,
          ];
    await exportExcel(context, fileName: 'meeting-${m['refNumber'] ?? widget.id}', sheets: sheets);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return AppScaffold(
        title: Text(tr('الاجتماع', 'Meeting')),
        body: ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer()]),
      );
    }
    if (_error != null || _meeting == null) {
      return AppScaffold(
        title: Text(tr('الاجتماع', 'Meeting')),
        body: ErrorRetry(message: _error ?? tr('تعذّر فتح هذا الاجتماع', 'Could not open this meeting'), onRetry: () { setState(() => _loading = true); _load(); }),
      );
    }
    final canEdit = _can['edit'] == true;
    final isExec = meta['me']?['isExecutive'] == true;
    final status = m['status']?.toString();
    final st = brVocab(meta['meetingStatuses'] as List?, status);
    return DefaultTabController(
      length: 4,
      child: AppScaffold(
        title: Text(m['title'].toString(), overflow: TextOverflow.ellipsis),
        actions: [
          IconButton(tooltip: tr('تصدير Excel', 'Export Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export),
          IconButton(tooltip: tr('طباعة المحضر', 'Print minutes'), icon: const Icon(Icons.print_outlined), onPressed: _print),
          if (canEdit)
            PopupMenuButton<String>(
              onSelected: (v) {
                if (v == 'close') _complete();
                if (v == 'reopen') _reopen();
                if (v == 'delete') _delete();
              },
              itemBuilder: (_) => [
                if (status != 'cancelled' && status != 'completed') PopupMenuItem(value: 'close', child: Text(tr('إقفال الاجتماع', 'Close meeting'))),
                if (status == 'completed') PopupMenuItem(value: 'reopen', child: Text(tr('إعادة فتح', 'Reopen'))),
                if (isExec) PopupMenuItem(value: 'delete', child: Text(tr('حذف الاجتماع', 'Delete meeting'), style: const TextStyle(color: T.danger))),
              ],
            ),
        ],
        appBarBottom: TabBar(
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          tabs: [
            Tab(text: tr('السجل الشامل', 'Full record')),
            Tab(text: tr('الأجندة والحضور', 'Agenda & attendees')),
            Tab(text: '${tr('المحضر', 'Minutes')} (${List.from(m['minutes'] ?? []).length})'),
            Tab(text: '${tr('البنود التنفيذية', 'Actions')} (${_actions.length})'),
          ],
        ),
        body: Column(children: [
          if (_busy) const LinearProgressIndicator(minHeight: 2),
          // Header: status, cycle, time and link; changing status is for whoever can edit.
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                if (canEdit)
                  PopupMenuButton<String>(
                    tooltip: tr('تغيير الحالة', 'Change status'),
                    onSelected: (v) => _put({'status': v}),
                    itemBuilder: (_) => [
                      for (final s in List<Map<String, dynamic>>.from(meta['meetingStatuses'] ?? []))
                        PopupMenuItem(value: s['key'].toString(), child: Text(tr((s['ar'] ?? '').toString(), (s['en'] ?? '').toString()))),
                    ],
                    child: Chip2('${st.label} ▾', st.color),
                  )
                else
                  Chip2(st.label, st.color),
                Chip2(brVocab(meta['cadences'] as List?, m['cadence']?.toString()).label, T.navy),
                Chip2(brDateTime(m['scheduledAt']), T.info, icon: Icons.event),
                if ((m['location'] ?? '').toString().isNotEmpty) Chip2(m['location'].toString(), T.inkSoft, icon: Icons.place_outlined),
                if ((m['meetingLink'] ?? '').toString().isNotEmpty)
                  InkWell(
                    onTap: () => launchUrl(Uri.parse(m['meetingLink'].toString()), mode: LaunchMode.externalApplication),
                    child: Chip2(tr('انضمام', 'Join'), T.orange, icon: Icons.videocam_outlined),
                  ),
              ]),
              const SizedBox(height: 4),
              Text('${m['refNumber'] ?? ''}${(m['scribeName'] ?? '').toString().isNotEmpty ? ' · ${tr('كاتب المحضر', 'Minuted by')}: ${m['scribeName']}' : ''}',
                  style: const TextStyle(fontSize: 11, color: T.inkFaint)),
              if (status == 'completed' && m['completedAt'] != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    '${tr('أُقفل', 'Closed')} ${brDateTime(m['completedAt'])}'
                    '${(m['completedByName'] ?? '').toString().isNotEmpty ? ' · ${m['completedByName']}' : ''}'
                    '${(m['completionNote'] ?? '').toString().isNotEmpty ? ' · ${m['completionNote']}' : ''}',
                    style: const TextStyle(fontSize: 11.5, color: Color(0xFF0F766E), fontWeight: FontWeight.w700),
                  ),
                ),
            ]),
          ),
          Expanded(
            child: TabBarView(children: [
              _RecordTab(meeting: m, meta: meta, actions: _actions, onPrint: _print, onRefresh: _load),
              _AgendaTab(meeting: m, canEdit: canEdit, onAttendance: (userId, attendance, reason) {
                final attendees = List<Map<String, dynamic>>.from(m['attendees'] ?? []).map((a) =>
                    a['user'] == userId ? {...a, 'attendance': attendance, 'excuseReason': reason} : a).toList();
                return _put({'attendees': attendees});
              }),
              _MinutesTab(key: ValueKey('min-${m['_id']}-${m['updatedAt']}'), meeting: m, meta: meta, canWrite: _can['writeMinutes'] == true,
                  onSaved: (mm) { setState(() => _meeting = mm); brSnack(context, tr('تم حفظ المحضر', 'Minutes saved')); }),
              _ActionsTab(meeting: m, meta: meta, actions: _actions, canRaise: _can['raiseActions'] == true, onChanged: _load),
            ]),
          ),
        ]),
      ),
    );
  }
}

// Full record
class _RecordTab extends StatelessWidget {
  final Map<String, dynamic> meeting;
  final Map<String, dynamic> meta;
  final List<Map<String, dynamic>> actions;
  final VoidCallback onPrint;
  final Future<void> Function() onRefresh;
  const _RecordTab({required this.meeting, required this.meta, required this.actions, required this.onPrint, required this.onRefresh});

  Widget _h(String t) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(t, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
      );

  Widget _fact(String label, dynamic value) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 110, child: Text(label, style: const TextStyle(fontSize: 11, color: T.inkFaint))),
          Expanded(child: Text((value ?? '').toString().isEmpty ? '—' : value.toString(), style: const TextStyle(fontSize: 12.5))),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final m = meeting;
    final attendees = List<Map<String, dynamic>>.from(m['attendees'] ?? []);
    final agenda = List<Map<String, dynamic>>.from(m['agenda'] ?? []);
    final minutes = List<Map<String, dynamic>>.from(m['minutes'] ?? []);
    final open = actions.where((a) => brOpenStatuses.contains(a['status'])).length;
    final done = actions.where((a) => a['status'] == 'done').length;
    final overdue = actions.where((a) => a['isOverdue'] == true && brOpenStatuses.contains(a['status'])).length;
    final delegated = actions.fold<int>(0, (s, a) => s + List.from(a['delegations'] ?? []).length);
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _h(tr('بيانات الاجتماع', 'Meeting details')),
            _fact(tr('الرقم المرجعي', 'Reference'), m['refNumber']),
            _fact(tr('الدورة', 'Cadence'), brVocab(meta['cadences'] as List?, m['cadence']?.toString()).label),
            _fact(tr('الحالة', 'Status'), brVocab(meta['meetingStatuses'] as List?, m['status']?.toString()).label),
            _fact(tr('موعد الانعقاد', 'Scheduled for'), brDateTime(m['scheduledAt'])),
            _fact(tr('انعقد فعليًا', 'Actually held'), m['heldAt'] != null ? brDateTime(m['heldAt']) : tr('لم ينعقد بعد', 'Not yet')),
            _fact(tr('المدة', 'Duration'), m['durationMinutes'] != null ? '${m['durationMinutes']} ${tr('دقيقة', 'min')}' : '—'),
            _fact(tr('المكان', 'Location'), m['location']),
            _fact(tr('كاتب المحضر', 'Minuted by'), m['scribeName']),
            _fact(tr('أنشأه', 'Created by'), m['createdByName']),
            _fact(tr('الأقسام', 'Departments'), List.from(m['departments'] ?? []).map((d) => brDept(context, d.toString())).join(' · ')),
            if ((m['summary'] ?? '').toString().isNotEmpty) ...[
              const Divider(),
              Text(tr('الخلاصة', 'Summary'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
              Text(m['summary'].toString(), style: const TextStyle(fontSize: 12.5)),
            ],
          ]),
        ),
        const SizedBox(height: 12),
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _h(tr('سجل الحضور', 'Attendance')),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final a in brAttendance)
                Chip2('${tr(a.$2, a.$3)}: ${attendees.where((x) => (x['attendance'] ?? 'invited') == a.$1).length}', a.$4),
            ]),
            const SizedBox(height: 8),
            if (attendees.isEmpty) Text(tr('لم تتم دعوة أحد بعد.', 'Nobody invited yet.'), style: const TextStyle(color: T.inkFaint, fontSize: 12)),
            for (final a in attendees)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    if (a['isChair'] == true) const Padding(padding: EdgeInsetsDirectional.only(end: 4), child: Icon(Icons.workspace_premium, size: 15, color: T.orange)),
                    Expanded(child: Text('${a['name']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5))),
                    Chip2(brAttendanceOf(a['attendance']?.toString()).label, brAttendanceOf(a['attendance']?.toString()).color),
                  ]),
                  Text(
                    [
                      (a['department'] ?? '').toString().isNotEmpty ? a['department'] : brDept(context, a['role']?.toString()),
                      if (a['attendanceAt'] != null) brDateTime(a['attendanceAt']),
                      if ((a['attendanceByName'] ?? '').toString().isNotEmpty) '${tr('سجّله', 'by')} ${a['attendanceByName']}',
                      if ((a['excuseReason'] ?? '').toString().isNotEmpty) a['excuseReason'],
                    ].join(' · '),
                    style: const TextStyle(fontSize: 10.5, color: T.inkFaint),
                  ),
                ]),
              ),
          ]),
        ),
        const SizedBox(height: 12),
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _h(tr('جدول الأعمال', 'Agenda')),
            if (agenda.isEmpty) Text(tr('لم يُحدَّد جدول أعمال.', 'No agenda was set.'), style: const TextStyle(color: T.inkFaint, fontSize: 12)),
            for (var i = 0; i < agenda.length; i++) Text('${i + 1}. ${agenda[i]['title']}', style: const TextStyle(fontSize: 12.5)),
          ]),
        ),
        const SizedBox(height: 12),
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _h(tr('محضر الاجتماع', 'Minutes')),
            if (minutes.isEmpty) Text(tr('لم يُكتب المحضر بعد.', 'The minutes have not been written yet.'), style: const TextStyle(color: T.inkFaint, fontSize: 12)),
            for (final mm in minutes)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${mm['heading'] ?? ''}${(mm['department'] ?? '').toString().isNotEmpty ? '  ·  ${brDept(context, mm['department'])}' : ''}',
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
                  Text((mm['body'] ?? '').toString(), style: const TextStyle(fontSize: 12, color: T.inkSoft, height: 1.5)),
                ]),
              ),
          ]),
        ),
        const SizedBox(height: 12),
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _h(tr('البنود التنفيذية والمتابعة', 'Actions & follow-up')),
            Wrap(spacing: 6, runSpacing: 6, children: [
              Chip2('${tr('الإجمالي', 'Total')}: ${actions.length}', T.inkSoft),
              Chip2('${tr('مفتوح', 'Open')}: $open', T.info),
              Chip2('${tr('متأخر', 'Overdue')}: $overdue', T.danger),
              Chip2('${tr('منجز', 'Done')}: $done', T.success),
              if (delegated > 0) Chip2('${tr('تكليفات فرعية', 'Delegated tasks')}: $delegated', T.violet),
            ]),
            const SizedBox(height: 8),
            if (actions.isEmpty) Text(tr('لم تُسجَّل بنود تنفيذية لهذا الاجتماع.', 'No actions were recorded for this meeting.'), style: const TextStyle(color: T.inkFaint, fontSize: 12)),
            for (final a in actions) BrActionCard(action: a, meta: meta, onChanged: onRefresh, canUpdate: false),
          ]),
        ),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: onPrint,
          icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
          label: Text(tr('تحميل المحضر الرسمي (PDF)', 'Download the minutes (PDF)')),
          style: FilledButton.styleFrom(backgroundColor: T.orange),
        ),
        const SizedBox(height: 20),
      ]),
    );
  }
}

// Agenda and attendance
class _AgendaTab extends StatelessWidget {
  final Map<String, dynamic> meeting;
  final bool canEdit;
  final Future<void> Function(String userId, String attendance, String reason) onAttendance;
  const _AgendaTab({required this.meeting, required this.canEdit, required this.onAttendance});

  Future<void> _reason(BuildContext context, Map<String, dynamic> a, String mark) async {
    final c = TextEditingController(text: (a['excuseReason'] ?? '').toString());
    final r = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(brAttendanceOf(mark).label),
        content: TextField(controller: c, autofocus: true, decoration: InputDecoration(hintText: tr('سبب الغياب أو الاعتذار…', 'Reason for the absence…'))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, null), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(d, c.text), child: Text(tr('حفظ', 'Save'))),
        ],
      ),
    );
    if (r == null) return;
    await onAttendance(a['user'].toString(), mark, r);
  }

  @override
  Widget build(BuildContext context) {
    final attendees = List<Map<String, dynamic>>.from(meeting['attendees'] ?? []);
    final agenda = List<Map<String, dynamic>>.from(meeting['agenda'] ?? []);
    return ListView(padding: const EdgeInsets.all(14), children: [
      Text(tr('الحاضرون', 'Attendees'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
      const SizedBox(height: 8),
      for (final a in attendees)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: AppCard(
            padding: const EdgeInsets.all(10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                if (a['isChair'] == true) const Padding(padding: EdgeInsetsDirectional.only(end: 4), child: Icon(Icons.workspace_premium, size: 15, color: T.orange)),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${a['name']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                    Text((a['department'] ?? '').toString().isNotEmpty ? a['department'].toString() : brDept(context, a['role']?.toString()),
                        style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                  ]),
                ),
                if (!canEdit) Chip2(brAttendanceOf(a['attendance']?.toString()).label, brAttendanceOf(a['attendance']?.toString()).color),
              ]),
              if (canEdit) ...[
                const SizedBox(height: 6),
                Wrap(spacing: 6, children: [
                  for (final mk in brAttendance.where((x) => x.$1 != 'invited'))
                    ChoiceChip(
                      label: Text(tr(mk.$2, mk.$3), style: const TextStyle(fontSize: 11.5)),
                      selected: a['attendance'] == mk.$1,
                      selectedColor: mk.$4.withValues(alpha: 0.18),
                      onSelected: (_) {
                        // Absence or apology asks for a reason so the "why" is not lost from the record.
                        if (mk.$1 == 'attended') {
                          onAttendance(a['user'].toString(), 'attended', '');
                        } else {
                          _reason(context, a, mk.$1);
                        }
                      },
                    ),
                ]),
              ],
              if (a['attendanceAt'] != null)
                Text('${brAttendanceOf(a['attendance']?.toString()).label} · ${brDateTime(a['attendanceAt'])}'
                    '${(a['attendanceByName'] ?? '').toString().isNotEmpty ? ' · ${tr('سجّله', 'by')} ${a['attendanceByName']}' : ''}',
                    style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
              if ((a['excuseReason'] ?? '').toString().isNotEmpty)
                Container(
                  margin: const EdgeInsets.only(top: 4),
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(6)),
                  child: Text(a['excuseReason'].toString(), style: const TextStyle(fontSize: 11.5)),
                ),
            ]),
          ),
        ),
      const SizedBox(height: 10),
      Text(tr('جدول الأعمال', 'Agenda'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
      const SizedBox(height: 8),
      if (agenda.isEmpty) Text(tr('لم يتم تحديد جدول أعمال.', 'No agenda was set.'), style: const TextStyle(color: T.inkFaint, fontSize: 12)),
      for (var i = 0; i < agenda.length; i++)
        ListTile(
          dense: true,
          contentPadding: EdgeInsets.zero,
          leading: CircleAvatar(radius: 12, backgroundColor: T.orange.withValues(alpha: 0.12), child: Text('${i + 1}', style: const TextStyle(fontSize: 11, color: T.orange, fontWeight: FontWeight.w800))),
          title: Text('${agenda[i]['title']}', style: const TextStyle(fontSize: 13)),
          subtitle: (agenda[i]['presenterName'] ?? agenda[i]['department']) == null
              ? null
              : Text([agenda[i]['presenterName'], if (agenda[i]['department'] != null) brDept(context, agenda[i]['department'])].where((x) => x != null && '$x'.isNotEmpty).join(' · '),
                  style: const TextStyle(fontSize: 11)),
        ),
      if ((meeting['summary'] ?? '').toString().isNotEmpty) ...[
        const Divider(),
        Text(tr('الخلاصة', 'Summary'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        Text(meeting['summary'].toString(), style: const TextStyle(fontSize: 12.5)),
      ],
    ]);
  }
}

// Meeting minutes
class _MinutesTab extends StatefulWidget {
  final Map<String, dynamic> meeting;
  final Map<String, dynamic> meta;
  final bool canWrite;
  final void Function(Map<String, dynamic>) onSaved;
  const _MinutesTab({super.key, required this.meeting, required this.meta, required this.canWrite, required this.onSaved});
  @override
  State<_MinutesTab> createState() => _MinutesTabState();
}

class _MinutesTabState extends State<_MinutesTab> {
  late final TextEditingController _summary;
  final List<(TextEditingController, TextEditingController, String)> _rows = [];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _summary = TextEditingController(text: (widget.meeting['summary'] ?? '').toString());
    final mins = List<Map<String, dynamic>>.from(widget.meeting['minutes'] ?? []);
    for (final mm in mins) {
      _rows.add((TextEditingController(text: (mm['heading'] ?? '').toString()), TextEditingController(text: (mm['body'] ?? '').toString()), (mm['department'] ?? '').toString()));
    }
    if (_rows.isEmpty && widget.canWrite) _rows.add((TextEditingController(), TextEditingController(), ''));
  }

  @override
  void dispose() {
    _summary.dispose();
    for (final r in _rows) { r.$1.dispose(); r.$2.dispose(); }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      final r = await Api.instance.put('/api/business-review/meetings/${widget.meeting['_id']}/minutes', {
        'summary': _summary.text,
        'minutes': _rows
            .where((x) => x.$1.text.trim().isNotEmpty || x.$2.text.trim().isNotEmpty)
            .map((x) => {'heading': x.$1.text, 'body': x.$2.text, 'department': x.$3})
            .toList(),
      });
      if (mounted && r is Map && r['meeting'] is Map) widget.onSaved(Map<String, dynamic>.from(r['meeting']));
    } catch (e) {
      if (mounted) brSnack(context, brErr(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.meeting;
    if (!widget.canWrite) {
      final mins = List<Map<String, dynamic>>.from(m['minutes'] ?? []);
      return ListView(padding: const EdgeInsets.all(14), children: [
        if ((m['summary'] ?? '').toString().isNotEmpty) ...[
          Text(tr('الخلاصة', 'Summary'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          Text(m['summary'].toString(), style: const TextStyle(fontSize: 13)),
          const Divider(),
        ],
        if (mins.isEmpty) EmptyState(icon: Icons.description_outlined, title: tr('لم يُكتب المحضر بعد.', 'The minutes have not been written yet.')),
        for (final mm in mins)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${mm['heading'] ?? ''}${(mm['department'] ?? '').toString().isNotEmpty ? '  ·  ${brDept(context, mm['department'])}' : ''}',
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
              Text((mm['body'] ?? '').toString(), style: const TextStyle(fontSize: 12.5, color: T.inkSoft, height: 1.5)),
            ]),
          ),
      ]);
    }
    final depts = List<String>.from((widget.meta['departments'] ?? []).map((e) => e.toString()));
    return ListView(padding: const EdgeInsets.all(14), children: [
      Row(children: [
        Expanded(child: Text(tr('كتابة المحضر', 'Write the minutes'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14))),
        FilledButton.icon(
          onPressed: _busy ? null : _save,
          icon: _busy ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.save_outlined, size: 17),
          label: Text(tr('حفظ المحضر', 'Save minutes')),
        ),
      ]),
      const SizedBox(height: 10),
      TextField(controller: _summary, maxLines: 2, decoration: InputDecoration(labelText: tr('الخلاصة', 'Summary'), hintText: tr('سطر أو سطران عن موضوع هذا الاجتماع', 'One or two lines on what this round was about'))),
      const SizedBox(height: 10),
      for (var i = 0; i < _rows.length; i++)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: AppCard(
            padding: const EdgeInsets.all(10),
            child: Column(children: [
              Row(children: [
                Expanded(child: TextField(controller: _rows[i].$1, decoration: InputDecoration(labelText: tr('الموضوع', 'Topic'), isDense: true))),
                if (_rows.length > 1)
                  IconButton(icon: const Icon(Icons.close, color: T.danger, size: 18), onPressed: () => setState(() => _rows.removeAt(i))),
              ]),
              const SizedBox(height: 6),
              DropdownButtonFormField<String>(
                initialValue: depts.contains(_rows[i].$3) ? _rows[i].$3 : '',
                isExpanded: true,
                decoration: InputDecoration(labelText: tr('القسم', 'Department'), isDense: true),
                items: [
                  DropdownMenuItem(value: '', child: Text(tr('القسم…', 'Department…'))),
                  for (final d in depts) DropdownMenuItem(value: d, child: Text(brDept(context, d))),
                ],
                onChanged: (v) => setState(() => _rows[i] = (_rows[i].$1, _rows[i].$2, v ?? '')),
              ),
              const SizedBox(height: 6),
              TextField(controller: _rows[i].$2, maxLines: 4, decoration: InputDecoration(hintText: tr('ما تمت مناقشته والقرارات…', 'What was discussed and decided…'))),
            ]),
          ),
        ),
      TextButton(onPressed: () => setState(() => _rows.add((TextEditingController(), TextEditingController(), ''))), child: Text('+ ${tr('إضافة موضوع', 'Add a topic')}')),
      Text(tr('المحضر يسجّل النقاش. أي شيء مطلوب تنفيذه يُسجَّل في «البنود التنفيذية» ليكون له مكلَّف وموعد تسليم.',
              'Minutes record the discussion. Anything somebody must DO belongs in Actions, where it gets an owner and a due date.'),
          style: const TextStyle(fontSize: 11, color: T.inkFaint)),
      const SizedBox(height: 20),
    ]);
  }
}

// Executive items
class _ActionsTab extends StatelessWidget {
  final Map<String, dynamic> meeting;
  final Map<String, dynamic> meta;
  final List<Map<String, dynamic>> actions;
  final bool canRaise;
  final Future<void> Function() onChanged;
  const _ActionsTab({required this.meeting, required this.meta, required this.actions, required this.canRaise, required this.onChanged});

  Future<void> _add(BuildContext context) async {
    // An item falls on one of the attendees...
    final owners = List<Map<String, dynamic>>.from(meeting['attendees'] ?? [])
        .map((a) => {'_id': a['user'], 'name': a['name'], 'role': a['role'], 'department': a['department']})
        .toList();
    // ...but whoever requested it may not have attended: attendees plus management.
    final requesters = [
      ...owners,
      ...List<Map<String, dynamic>>.from(meta['participants'] ?? [])
          .where((p) => p['isExecutive'] == true && !owners.any((o) => o['_id'] == p['_id'])),
    ];
    final title = TextEditingController();
    final desc = TextEditingController();
    Map<String, dynamic>? assignee, raisedBy;
    String due = '';
    var start = brIsoDay(DateTime.tryParse('${meeting['scheduledAt'] ?? ''}')?.toLocal() ?? DateTime.now());
    String priority = 'high';
    final depts = List<String>.from((meeting['departments'] ?? []).map((e) => e.toString()));
    String department = depts.isNotEmpty ? depts.first : '';
    var busy = false;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('بند تنفيذي جديد', 'New action'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
              const SizedBox(height: 10),
              TextField(controller: title, decoration: InputDecoration(labelText: tr('ما المطلوب تنفيذه؟ *', 'What must be done? *'))),
              const SizedBox(height: 8),
              TextField(controller: desc, maxLines: 2, decoration: InputDecoration(labelText: tr('تفاصيل (اختياري)', 'Detail (optional)'))),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () async { final p = await brPickPerson(c, owners); if (p != null) setS(() => assignee = p); },
                icon: const Icon(Icons.person_outline, size: 18),
                label: Text(assignee == null ? tr('المكلَّف * — اختر من الحاضرين…', 'Owner * — pick an attendee…') : '${tr('المكلَّف', 'Owner')}: ${assignee!['name']}'),
              ),
              OutlinedButton.icon(
                onPressed: () async { final p = await brPickPerson(c, requesters); if (p != null) setS(() => raisedBy = p); },
                icon: const Icon(Icons.record_voice_over_outlined, size: 18),
                label: Text(raisedBy == null ? tr('بطلب من…', 'Requested by…') : '${tr('بطلب من', 'Requested by')}: ${raisedBy!['name']}'),
              ),
              OutlinedButton.icon(
                onPressed: () async {
                  final v = await showDatePicker(context: c, initialDate: DateTime.tryParse(start) ?? DateTime.now(), firstDate: DateTime.now().subtract(const Duration(days: 365)), lastDate: DateTime.now().add(const Duration(days: 730)));
                  if (v != null) setS(() => start = brIsoDay(v));
                },
                icon: const Icon(Icons.play_circle_outline, size: 16),
                label: Text('${tr('تاريخ البداية', 'Start date')}: $start'),
              ),
              Row(children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () async {
                      final v = await showDatePicker(context: c, initialDate: DateTime.now(), firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 730)));
                      if (v != null) setS(() => due = brIsoDay(v));
                    },
                    icon: const Icon(Icons.event, size: 16),
                    label: Text(due.isEmpty ? tr('موعد التسليم', 'Due date') : due),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: priority,
                    isDense: true,
                    decoration: InputDecoration(labelText: tr('الأولوية', 'Priority'), isDense: true),
                    items: List<Map<String, dynamic>>.from(meta['priorities'] ?? [])
                        .map((p) => DropdownMenuItem(value: p['key'].toString(), child: Text(tr((p['ar'] ?? '').toString(), (p['en'] ?? '').toString()))))
                        .toList(),
                    onChanged: (v) => setS(() => priority = v ?? priority),
                  ),
                ),
              ]),
              if (depts.isNotEmpty) ...[
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: department,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: tr('القسم', 'Department'), isDense: true),
                  items: [for (final d in depts) DropdownMenuItem(value: d, child: Text(brDept(context, d)))],
                  onChanged: (v) => setS(() => department = v ?? department),
                ),
              ],
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: busy
                      ? null
                      : () async {
                          if (title.text.trim().isEmpty || assignee == null) {
                            brSnack(c, tr('عنوان البند والمكلَّف مطلوبان', 'A title and an owner are required'));
                            return;
                          }
                          setS(() => busy = true);
                          try {
                            await Api.instance.post('/api/business-review/meetings/${meeting['_id']}/actions', {
                              'title': title.text.trim(),
                              'description': desc.text,
                              'assignee': assignee!['_id'],
                              'raisedBy': raisedBy?['_id'] ?? '',
                              'department': department,
                              'startDate': start,
                              'dueDate': due,
                              'priority': priority,
                            });
                            if (c.mounted) Navigator.pop(c);
                            await onChanged();
                          } catch (e) {
                            setS(() => busy = false);
                            if (c.mounted) brSnack(c, brErr(e));
                          }
                        },
                  child: Text(tr('إضافة البند', 'Add action')),
                ),
              ),
            ]),
          ),
        ),
      )),
    );
  }

  @override
  Widget build(BuildContext context) {
    final me = Map<String, dynamic>.from(meta['me'] ?? {});
    return RefreshIndicator(
      onRefresh: onChanged,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        if (canRaise)
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: FilledButton.icon(
              onPressed: () => _add(context),
              icon: const Icon(Icons.add, size: 18),
              label: Text(tr('تسجيل بند تنفيذي', 'Record an action')),
            ),
          ),
        const SizedBox(height: 10),
        if (actions.isEmpty) EmptyState(icon: Icons.checklist_rounded, title: tr('لم تُسجَّل بنود تنفيذية لهذا الاجتماع.', 'No actions were recorded for this meeting.')),
        for (final a in actions)
          BrActionCard(
            action: a,
            meta: meta,
            onChanged: onChanged,
            // Update is for the owner or whoever manages meetings, like the server.
            canUpdate: a['assignee'] == me['_id'] || me['canRunMeetings'] == true,
            canDelegate: a['assignee'] == me['_id'] || me['canRunMeetings'] == true,
            canDelete: canRaise,
          ),
      ]),
    );
  }
}
