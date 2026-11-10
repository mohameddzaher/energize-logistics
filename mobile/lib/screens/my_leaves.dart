import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../services/live.dart';
import '../ui/file_upload.dart';
import '../ui/leave_chain.dart';
import '../ui/export_sheet.dart';
import 'hr_leave_pdf.dart';

/// My leaves: the self-service leave page with balance cards, request history and a new-request sheet. Same endpoints as the web (/api/hr/me/leaves).
class MyLeavesScreen extends StatefulWidget {
  const MyLeavesScreen({super.key});
  @override
  State<MyLeavesScreen> createState() => _MyLeavesScreenState();
}

class _MyLeavesScreenState extends State<MyLeavesScreen> {
  List<Map<String, dynamic>> _leaves = [];
  List<Map<String, dynamic>> _types = [];
  Map<String, dynamic>? _balance;
  bool _loading = true;
  String? _error;
  // "My team's requests" tab for managers, as on the web
  bool _hasTeam = false;
  List<Map<String, dynamic>> _team = [];
  // People this manager may file leave for (backend utils/leaveTeam); a filed request starts at HR.
  List<Map<String, dynamic>> _members = [];
  Map<String, dynamic> _memberBalances = {};
  int _tab = 0;
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    Api.instance.get('/api/hr/me/team').then((d) {
      if (mounted) setState(() => _hasTeam = (d as Map)['hasTeam'] == true);
      if (_hasTeam) _loadMembers();
    }).catchError((_) {});
    Api.instance.get('/api/hr/leave-types').then((d) {
      if (mounted) setState(() => _types = List<Map<String, dynamic>>.from(d['leaveTypes'] ?? []));
    }).catchError((_) {});
    _onLive = () => _load();
    Live.instance.on('hr:leave', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('hr:leave', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/hr/me/leaves');
      List<Map<String, dynamic>> team = _team;
      try { team = List<Map<String, dynamic>>.from((await Api.instance.get('/api/hr/team/leaves'))['leaves'] ?? []); } catch (_) {}
      if (!mounted || mine != _seq) return;
      setState(() {
        _team = team;
        _leaves = List<Map<String, dynamic>>.from(d['leaves'] ?? []);
        _balance = d['balance'] as Map<String, dynamic>?;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _loadMembers() async {
    try {
      final d = await Api.instance.get('/api/hr/team/leave-members');
      if (mounted) {
        setState(() {
          _members = List<Map<String, dynamic>>.from(((d as Map)['members'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
          _memberBalances = d['balanceDetails'] is Map ? Map<String, dynamic>.from(d['balanceDetails'] as Map) : {};
        });
      }
    } catch (_) { /* no team */ }
  }

  void _fileForTeam() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => _NewLeaveSheet(types: _types, onDone: _load, members: _members, balances: _memberBalances),
    );
  }

  String _empName(dynamic e) => e is Map ? '${e['arabicName'] ?? ''}'.trim().isNotEmpty ? '${e['arabicName']}' : '${e['firstName'] ?? ''} ${e['lastName'] ?? ''}'.trim() : '';
  bool _filedByMe(Map l) {
    final f = l['filedBy'];
    final id = f is Map ? f['_id'] : f;
    return id != null && '$id' == '${context.read<AuthProvider>().user?['_id'] ?? context.read<AuthProvider>().user?['id'] ?? ''}';
  }

  void _newRequest([Map<String, dynamic>? editing]) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => _NewLeaveSheet(types: _types, onDone: _load, editing: editing),
    );
  }

  /// While pending and untouched by any decision, the request belongs to its owner: editable or deletable (as on the web).
  bool _editable(Map<String, dynamic> l) => leaveIsUntouched(l);

  Future<bool> _ask(String m) async => await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          content: Text(m),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
            FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تأكيد', 'Confirm'))),
          ],
        ),
      ) == true;

  Future<void> _remove(Map<String, dynamic> l) async {
    if (!await _ask(tr('حذف هذا الطلب نهائيًّا؟ لن يظهر لأحد.', 'Delete this request permanently? Nobody will see it.'))) return;
    try { await Api.instance.delete('/api/hr/me/leaves/${l['_id']}'); _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  String _typeName(dynamic t) => t is Map ? '${(Lang.instance.ar ? t['nameAr'] : t['nameEn']) ?? t['nameAr'] ?? ''}' : '';
  // Stages are shown to process viewers only (seesLeaveProcess); the employee reads «قيد المراجعة».
  bool get _full => seesLeaveProcess(context.read<AuthProvider>().user);
  String _statusName(dynamic s, {bool own = false}) { final st = leaveStatusFor(s, own: own, full: _full, canAct: !own && s == 'pending_manager'); return tr(st.$1, st.$2); }
  String _userName(dynamic u) => u is Map ? '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim() : '';

  // Web export columns: type, start and end in both calendars, days, status.
  List<ExportCol> _cols({bool team = false}) => [
        if (team) ExportCol('الموظف', 'Employee', (r) => _empName(r['employee']).isNotEmpty ? _empName(r['employee']) : _userName(r['requester'])),
        ExportCol('النوع', 'Type', (r) => _typeName(r['leaveType'])),
        ExportCol('تاريخ البداية الميلادي', 'Start date (Gregorian)', (r) => gregDay(r['startDate'])),
        ExportCol('تاريخ البداية الهجري', 'Start date (Hijri)', (r) => hijriDay(r['startDate'])),
        ExportCol('تاريخ النهاية الميلادي', 'End date (Gregorian)', (r) => gregDay(r['endDate'])),
        ExportCol('تاريخ النهاية الهجري', 'End date (Hijri)', (r) => hijriDay(r['endDate'])),
        ExportCol('الأيام', 'Days', (r) => r['days'] ?? ''),
        ExportCol('الحالة', 'Status', (r) => _statusName(r['status'], own: !team)),
      ];

  /// Review a subordinate's request at the manager's stage: PATCH decision {decision, note}.
  Future<void> _review(Map<String, dynamic> l) async {
    final note = TextEditingController();
    final d = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('مراجعة طلب الفريق', 'Review team request')),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${tr('الموظف', 'Employee')}: ${_empName(l['employee']).isNotEmpty ? _empName(l['employee']) : _userName(l['requester'])}'),
          Text('${tr('النوع', 'Type')}: ${_typeName(l['leaveType'])}'),
          Text('${tr('من', 'From')} ${_d(l['startDate'])} ${tr('إلى', 'to')} ${_d(l['endDate'])} · ${l['days'] ?? '—'} ${tr('يوم', 'days')}'),
          if ('${l['reason'] ?? ''}'.isNotEmpty) Text('${l['reason']}', style: const TextStyle(color: T.inkSoft)),
          const SizedBox(height: 8),
          TextField(controller: note, decoration: InputDecoration(labelText: tr('ملاحظة', 'Note'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, 'rejected'), child: Text(tr('رفض', 'Reject'), style: const TextStyle(color: T.danger))),
          FilledButton(onPressed: () => Navigator.pop(c, 'approved'), child: Text(tr('موافقة', 'Approve'))),
        ],
      ),
    );
    if (d == null) return;
    try { await Api.instance.patch('/api/hr/leaves/${l['_id']}/decision', {'decision': d, 'note': note.text.trim()}); _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  Widget _teamList() {
    final file = _members.isEmpty ? const SizedBox.shrink() : Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: SizedBox(width: double.infinity, child: FilledButton.icon(
        onPressed: _fileForTeam,
        icon: const Icon(Icons.add_rounded, size: 18),
        label: Text(tr('تقديم إجازة لأحد فريقي (${_members.length})', 'File leave for my team (${_members.length})')),
      )),
    );
    if (_team.isEmpty) return Column(children: [file, EmptyState(icon: Icons.groups_outlined, title: tr('لا توجد طلبات من فريقك', 'No requests from your team'))]);
    return Column(children: [
      file,
      for (final l in _team)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(_empName(l['employee']).isNotEmpty ? _empName(l['employee']) : _userName(l['requester']), style: const TextStyle(fontWeight: FontWeight.w800))),
              Chip2(_statusName(l['status'], own: _filedByMe(l)), leaveStatusFor(l['status'], own: _filedByMe(l), full: _full, canAct: l['status'] == 'pending_manager').$3),
            ]),
            Text('${_typeName(l['leaveType'])} · ${tr('من', 'From')} ${_d(l['startDate'])} ${tr('إلى', 'to')} ${_d(l['endDate'])} · ${l['days'] ?? '—'} ${tr('يوم', 'days')}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
            const SizedBox(height: 4),
            LeaveDeductionBadge(leave: l, full: _full),
            Wrap(alignment: WrapAlignment.end, spacing: 4, children: [
              if (l['status'] == 'pending_manager')
                TextButton(onPressed: () => _review(l), child: Text(tr('مراجعة', 'Review'))),
              TextButton(onPressed: () => downloadLeaveSheet(context, '${l['_id']}'), child: const Text('PDF')),
              // The manager who filed it answers questions on it and may withdraw it.
              if (_filedByMe(l) && l['status'] == 'info_requested')
                TextButton(onPressed: () => _reply(l), child: Text(tr('الردّ على الاستفسار', 'Reply'))),
              if (_filedByMe(l) && leaveIsOpen(l['status']))
                TextButton(
                  onPressed: () async {
                    if (!await _ask(tr('إلغاء هذا الطلب؟', 'Cancel this request?'))) return;
                    try { await Api.instance.patch('/api/hr/me/leaves/${l['_id']}/cancel'); _load(); }
                    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
                  },
                  child: Text(tr('إلغاء الطلب', 'Cancel'), style: const TextStyle(color: T.danger)),
                ),
            ]),
          ])),
        ),
    ]);
  }

  /// Reply to an inquiry, optionally with the amended request (type, dates, reason).
  /// The server sends an unchanged request back to whoever asked and restarts the review for an amended one; the employee is told only that it is under review again.
  Future<void> _reply(Map<String, dynamic> l) async {
    final body = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (c) => _ReplyDialog(leave: l, types: _types, full: seesLeaveProcess(context.read<AuthProvider>().user)),
    );
    if (body == null) return;
    try {
      await Api.instance.post('/api/hr/me/leaves/${l['_id']}/reply', body);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(tr('أُرسل ردّك — طلبك قيد المراجعة من جديد.', 'Your reply was sent — your request is under review again.')),
        ));
      }
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  String _d(String? v) {
    final d = v != null ? DateTime.tryParse(v) : null;
    return d == null ? '—' : '${d.day}/${d.month}/${d.year}${hijriDay(v).isEmpty ? '' : ' · ${hijriDay(v)} ${tr('هـ', 'AH')}'}';
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('إجازاتي', 'My Leaves')),
      actions: [
        IconButton(
          tooltip: tr('تصدير Excel', 'Export to Excel'),
          icon: const Icon(Icons.file_download_outlined),
          onPressed: () {
            final team = _tab == 1;
            final rows = team ? _team : _leaves;
            if (rows.isEmpty) return;
            exportExcel(context, fileName: team ? 'team-leaves' : 'my-leaves',
                sheets: [(team ? tr('طلبات فريقي', 'My team') : tr('إجازاتي', 'My Leaves'), _cols(team: team), rows)]);
          },
        ),
      ],
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: T.navy,
        foregroundColor: Colors.white,
        onPressed: _newRequest,
        icon: const Icon(Icons.add),
        label: Text(tr('طلب إجازة', 'Request leave')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 70), SizedBox(height: 14), Shimmer(height: 84), SizedBox(height: 10), Shimmer(height: 84),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(14, 14, 14, 90),
                    children: [
                      if (_balance != null)
                        Row(
                          children: [
                            _stat(tr('الاستحقاق', 'Entitled'), _balance!['entitlement']),
                            _stat(tr('المتراكم', 'Accrued'), _balance!['accrued']),
                            _stat(tr('المستخدم', 'Taken'), _balance!['taken']),
                            _stat(tr('المتاح', 'Available'), _balance!['available'], highlight: true),
                          ],
                        ),
                      const SizedBox(height: 14),
                      if (_hasTeam)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: SegmentedButton<int>(
                            segments: [
                              ButtonSegment(value: 0, label: Text(tr('طلباتي', 'Mine'))),
                              ButtonSegment(value: 1, label: Text('${tr('طلبات فريقي', 'My team')}${_team.where((l) => l['status'] == 'pending_manager').isEmpty ? '' : ' (${_team.where((l) => l['status'] == 'pending_manager').length})'}')),
                            ],
                            selected: {_tab},
                            onSelectionChanged: (v) => setState(() => _tab = v.first),
                          ),
                        ),
                      if (_tab == 1) _teamList(),
                      if (_tab == 0 && _leaves.isEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 50),
                          child: EmptyState(icon: Icons.beach_access_outlined, title: tr('لا توجد طلبات إجازة بعد', 'No leave requests yet')),
                        ),
                      if (_tab == 0) ..._leaves.asMap().entries.map((e) {
                        final l = e.value;
                        final st = leaveStatusOwn(l['status'], full: _full);
                        final type = l['leaveType'] is Map ? (l['leaveType']['nameAr'] ?? l['leaveType']['nameEn'] ?? '') : '';
                        final canCancel = leaveIsOpen(l['status']);
                        return FadeSlideIn(
                          delayMs: (e.key * 20).clamp(0, 200),
                          child: Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: AppCard(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(child: Text(type.toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                      Chip2(tr(st.$1, st.$2), st.$3),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  Text('${tr('من', 'From')} ${_d(l['startDate'])} ${tr('إلى', 'to')} ${_d(l['endDate'])} · ${l['days'] ?? '—'} ${tr('يوم', 'days')}',
                                      style: const TextStyle(fontSize: 13, color: T.inkSoft)),
                                  if ((l['reason'] ?? '').toString().isNotEmpty)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 2),
                                      child: Text(l['reason'], style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                                    ),
                                  // Request attachments and its two decisions; loadable any time, so what was attached once is not requested again.
                                  ...[
                                    ...List<Map<String, dynamic>>.from((l['attachments'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map))),
                                    ...List<Map<String, dynamic>>.from(((l['managerDecision'] is Map ? l['managerDecision']['attachments'] : null) as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map))),
                                    ...List<Map<String, dynamic>>.from(((l['hrDecision'] is Map ? l['hrDecision']['attachments'] : null) as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map))),
                                  ].map((a) => Padding(
                                    padding: const EdgeInsets.only(top: 4),
                                    child: Row(children: [
                                      const Icon(Icons.description_outlined, size: 15, color: T.navy),
                                      const SizedBox(width: 6),
                                      Expanded(child: Text('${a['title'] ?? a['fileName'] ?? ''}',
                                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600), maxLines: 1, overflow: TextOverflow.ellipsis)),
                                      IconButton(
                                        visualDensity: VisualDensity.compact,
                                        icon: const Icon(Icons.download_rounded, size: 16, color: T.navy),
                                        tooltip: tr('فتح/تنزيل', 'Open / download'),
                                        onPressed: () {
                                          final u = (a['fileUrl'] ?? '').toString();
                                          if (u.isEmpty) return;
                                          launchUrl(Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u'), mode: LaunchMode.externalApplication);
                                        },
                                      ),
                                    ]),
                                  )),
                                  const SizedBox(height: 8),
                                  LeaveChainBar(leave: l, full: _full),
                                  const SizedBox(height: 4),
                                  LeaveDeductionBadge(leave: l, full: _full),
                                  const SizedBox(height: 8),
                                  LeaveThread(leave: l, full: _full),
                                  // A stage asked instead of rejecting: the request returns to its owner to reply, add proof or amend it.
                                  if (l['status'] == 'info_requested')
                                    SizedBox(
                                      width: double.infinity,
                                      child: FilledButton.icon(
                                        style: FilledButton.styleFrom(
                                          backgroundColor: const Color(0xFFEA580C),
                                          minimumSize: const Size.fromHeight(42),
                                        ),
                                        onPressed: () => _reply(l),
                                        icon: const Icon(Icons.reply_rounded, size: 18),
                                        label: Text(tr('الردّ على الاستفسار', 'Reply to the question')),
                                      ),
                                    ),
                                  if (_editable(l))
                                    Row(children: [
                                      TextButton.icon(
                                        onPressed: () => _newRequest(l),
                                        icon: const Icon(Icons.edit_outlined, size: 15),
                                        label: Text(tr('تعديل', 'Edit'), style: const TextStyle(fontSize: 12)),
                                      ),
                                      TextButton.icon(
                                        onPressed: () => _remove(l),
                                        icon: const Icon(Icons.delete_outline, size: 15, color: T.danger),
                                        label: Text(tr('حذف', 'Delete'), style: const TextStyle(color: T.danger, fontSize: 12)),
                                      ),
                                    ]),
                                  Align(
                                    alignment: AlignmentDirectional.centerStart,
                                    child: TextButton.icon(
                                      onPressed: () => downloadLeaveSheet(context, '${l['_id']}'),
                                      icon: const Icon(Icons.picture_as_pdf_outlined, size: 15),
                                      label: Text(tr('ورقة الإجازة PDF', 'Leave sheet PDF'), style: const TextStyle(fontSize: 12)),
                                    ),
                                  ),
                                  if (canCancel)
                                    Align(
                                      alignment: AlignmentDirectional.centerStart,
                                      child: TextButton.icon(
                                        onPressed: () async {
                                          if (!await _ask(tr('إلغاء هذا الطلب؟', 'Cancel this request?'))) return;
                                          try {
                                            await Api.instance.patch('/api/hr/me/leaves/${l['_id']}/cancel');
                                            _load();
                                          } catch (e) {
                                            if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
                                          }
                                        },
                                        icon: const Icon(Icons.close_rounded, size: 15, color: T.danger),
                                        label: Text(tr('إلغاء الطلب', 'Cancel request'), style: const TextStyle(color: T.danger, fontSize: 12)),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          ),
                        );
                      }),
                    ],
                  ),
                ),
    );
  }

  Widget _stat(String label, dynamic value, {bool highlight = false}) => Expanded(
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 3),
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: highlight ? T.navy : Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: highlight ? T.navy : const Color(0xFFE2E8F0)),
          ),
          child: Column(
            children: [
              Text('${value ?? 0}',
                  style: TextStyle(
                    fontSize: 18, fontWeight: FontWeight.w800,
                    color: highlight ? Colors.white : T.ink,
                  )),
              Text(label, style: TextStyle(fontSize: 10, color: highlight ? Colors.white70 : T.inkSoft)),
            ],
          ),
        ),
      );
}

class _NewLeaveSheet extends StatefulWidget {
  final List<Map<String, dynamic>> types;
  final Future<void> Function() onDone;
  /// Existing request being edited (PUT /api/hr/me/leaves/:id); otherwise a new request.
  final Map<String, dynamic>? editing;
  /// Set when a manager files for his team (POST /api/hr/team/leaves): an employee picker is shown.
  final List<Map<String, dynamic>>? members;
  /// The team's balances by employee id (GET /api/hr/team/leave-members balanceDetails), shown once one is picked.
  final Map<String, dynamic> balances;
  const _NewLeaveSheet({required this.types, required this.onDone, this.editing, this.members, this.balances = const {}});
  @override
  State<_NewLeaveSheet> createState() => _NewLeaveSheetState();
}

class _NewLeaveSheetState extends State<_NewLeaveSheet> {
  String _type = '';
  String? _employee;
  DateTime? _start;
  DateTime? _end;
  final _reason = TextEditingController();
  bool _busy = false;
  // Request proof. A sick leave needs a report; it used to be sent over WhatsApp and got lost, then asked for two months later. It now lives with the request and is read from the employee file afterwards.
  final List<PickedFile> _files = [];
  // Saved request attachments: removed ones are sent in removeAttachments (as on the web).
  List<Map<String, dynamic>> _kept = [];

  @override
  void initState() {
    super.initState();
    final l = widget.editing;
    if (l != null) {
      _type = '${l['leaveType'] is Map ? l['leaveType']['_id'] : l['leaveType'] ?? ''}';
      _start = DateTime.tryParse('${l['startDate'] ?? ''}');
      _end = DateTime.tryParse('${l['endDate'] ?? ''}');
      _reason.text = '${l['reason'] ?? ''}';
      _kept = [for (final a in (l['attachments'] as List? ?? const [])) Map<String, dynamic>.from(a as Map)];
    }
  }

  /// Advance-notice policy: planned leave must be requested a month ahead; kinds you cannot plan (sick/emergency) carry requiresAdvanceNotice:false and may start today. The backend enforces this; the sheet just refuses dates that would be rejected.
  Map<String, dynamic>? get _chosen {
    for (final t in widget.types) {
      if (t['_id'].toString() == _type) return t;
    }
    return null;
  }

  bool get _needsNotice => (_chosen?['requiresAdvanceNotice'] ?? true) != false;
  int get _noticeDays => _needsNotice ? ((_chosen?['minAdvanceDays'] ?? 30) as num).toInt() : 0;
  DateTime get _minStart {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    return _needsNotice ? today.add(Duration(days: _noticeDays)) : today;
  }

  DateTime get _today { final n = DateTime.now(); return DateTime(n.year, n.month, n.day); }
  // A past start records a leave already taken: only an upcoming date inside the notice window breaks the rule.
  bool get _noticeViolated => _start != null && !_start!.isBefore(_today) && _start!.isBefore(_minStart);

  Future<void> _save() async {
    if (_type.isEmpty || _start == null || _end == null || _busy) return;
    if (widget.members != null && _employee == null) return;
    if (_noticeViolated) {
      final min = _minStart;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr(
        'يجب تقديم هذا الطلب قبل موعد بدايته بـ $_noticeDays يومًا على الأقل — أقرب بداية ${min.day}/${min.month}/${min.year}. الطارئة والمرضية معفاة.',
        'This leave needs $_noticeDays days\' notice — earliest start ${min.day}/${min.month}/${min.year}. Emergency and sick leave are exempt.',
      ))));
      return;
    }
    setState(() => _busy = true);
    try {
      final body = {
        'leaveType': _type,
        'startDate': _start!.toIso8601String().substring(0, 10),
        'endDate': _end!.toIso8601String().substring(0, 10),
        'reason': _reason.text,
        'files': _files.map((f) => {'dataUrl': f.dataUrl, 'fileName': f.fileName, 'title': f.fileName}).toList(),
      };
      final l = widget.editing;
      if (widget.members != null) {
        body['employee'] = _employee!;
        await Api.instance.post('/api/hr/team/leaves', body);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr(
            'قُدِّمت الإجازة — موافقتك مسجّلة، وهي قيد المراجعة.', 'Leave filed — your approval is recorded; it is under review.'))));
        }
      } else if (l != null) {
        final keptIds = _kept.map((a) => '${a['_id']}').toSet();
        body['removeAttachments'] = [for (final a in (l['attachments'] as List? ?? const [])) if (!keptIds.contains('${(a as Map)['_id']}')) '${a['_id']}'];
        await Api.instance.put('/api/hr/me/leaves/${l['_id']}', body);
      } else {
        await Api.instance.post('/api/hr/me/leaves', body);
      }
      widget.onDone();
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<DateTime?> _pick(DateTime? initial) {
    // Past dates are open (leave already taken); the notice rule is checked on save for upcoming dates.
    final now = DateTime.now();
    final first = DateTime(now.year - 1, now.month, now.day);
    final seed = initial ?? _minStart;
    return showDatePicker(
      context: context,
      initialDate: seed.isBefore(first) ? first : seed,
      firstDate: first,
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
  }

  @override
  Widget build(BuildContext context) {
    String fmt(DateTime? d) => d == null ? tr('اختر التاريخ', 'Pick date') : '${d.day}/${d.month}/${d.year}';
    return Padding(
      padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(context).viewInsets.bottom + 18),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.members != null
              ? tr('تقديم إجازة لأحد فريقي', 'File leave for my team')
              : widget.editing != null ? tr('تعديل الطلب', 'Edit request') : tr('طلب إجازة جديد', 'New leave request'),
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 14),
          if (widget.members != null) ...[
            Text(tr('تُسجَّل موافقتك كمديرٍ مباشر عند التقديم ويوضع توقيعك في خانة المدير المباشر. خانة الموظف تحمل توقيعه إن كان له حساب، وإلا اسمه.',
                    'Your manager approval is recorded with the filing and your signature goes in the direct manager box. The employee box carries his signature if he has an account, else his name.'),
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: _employee,
              isExpanded: true,
              decoration: InputDecoration(labelText: tr('الموظّف *', 'Employee *')),
              items: widget.members!.map((m) {
                final nm = '${m['arabicName'] ?? ''}'.trim().isNotEmpty ? '${m['arabicName']}' : '${m['firstName'] ?? ''} ${m['lastName'] ?? ''}'.trim();
                final num = '${m['employeeNumber'] ?? ''}';
                return DropdownMenuItem(value: '${m['_id']}', child: Text(num.isEmpty ? nm : '$nm · #$num', overflow: TextOverflow.ellipsis));
              }).toList(),
              onChanged: (v) => setState(() => _employee = v),
            ),
            if (_employee != null) ...[
              const SizedBox(height: 8),
              _MemberBalanceCard(
                b: widget.balances[_employee] is Map ? Map<String, dynamic>.from(widget.balances[_employee] as Map) : null,
                days: countLeaveDays(_start, _end),
                deducts: _type.isEmpty ? null : widget.types.where((t) => t['_id'] == _type).firstOrNull?['affectsBalance'] != false,
              ),
            ],
            const SizedBox(height: 10),
          ],
          DropdownButtonFormField<String>(
            initialValue: _type.isEmpty ? null : _type,
            decoration: InputDecoration(labelText: tr('نوع الإجازة *', 'Leave type *')),
            items: widget.types
                .map((t) => DropdownMenuItem(value: t['_id'].toString(), child: Text(t['nameAr'] ?? t['nameEn'] ?? '')))
                .toList(),
            onChanged: (v) => setState(() {
              _type = v ?? '';
              // Switching to a type with a longer notice must clear a date that
              // is now illegal rather than silently keeping it.
              if (_noticeViolated) { _start = null; _end = null; }
            }),
          ),
          if (_type.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: _needsNotice ? const Color(0xFFFEF3C7) : const Color(0xFFD1FAE5),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(children: [
                Icon(_needsNotice ? Icons.schedule_rounded : Icons.verified_outlined,
                    size: 16, color: _needsNotice ? const Color(0xFF92400E) : const Color(0xFF065F46)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _needsNotice
                        ? tr('تحتاج إخطارًا مسبقًا $_noticeDays يومًا — أقرب بداية ${_minStart.day}/${_minStart.month}/${_minStart.year}.',
                            'Needs $_noticeDays days\' notice — earliest start ${_minStart.day}/${_minStart.month}/${_minStart.year}.')
                        : tr('إجازة طارئة/مرضية — معفاة من الإخطار المسبق.',
                            'Emergency / sick leave — exempt from advance notice.'),
                    style: TextStyle(fontSize: 11.5, color: _needsNotice ? const Color(0xFF92400E) : const Color(0xFF065F46)),
                  ),
                ),
              ]),
            ),
          ],
          const SizedBox(height: 10),
          Row(children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _type.isEmpty ? null : () async { final d = await _pick(_start); if (d != null) setState(() { _start = d; if (_end != null && _end!.isBefore(d)) _end = d; }); },
                child: Text('${tr('من', 'From')}: ${fmt(_start)}${_start == null ? '' : '\n${hijriHint(_start, ar: Lang.instance.ar)}'}', textAlign: TextAlign.center),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton(
                onPressed: _type.isEmpty || _start == null ? null : () async { final d = await _pick(_end ?? _start); if (d != null) setState(() => _end = d); },
                child: Text('${tr('إلى', 'To')}: ${fmt(_end)}${_end == null ? '' : '\n${hijriHint(_end, ar: Lang.instance.ar)}'}', textAlign: TextAlign.center),
              ),
            ),
          ]),
          if (_start != null && _end != null) Builder(builder: (_) {
            final cf = _chosen?['countsFridays'] == true;
            final n = countLeaveDays(_start, _end, countFridays: cf);
            return Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(n == 0 ? tr('تاريخ النهاية قبل البداية', 'The end date is before the start') : '${tr('عدد أيام الإجازة', 'Leave days')}: $n ${fridaysNote(_start, _end, countFridays: cf)}',
                  style: TextStyle(fontWeight: FontWeight.w700, color: n == 0 ? T.danger : T.ink)),
            );
          }),
          const SizedBox(height: 10),
          TextField(controller: _reason, decoration: InputDecoration(labelText: tr('السبب', 'Reason'))),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _busy ? null : () async {
                  if (_files.length >= 5) return;
                  final f = await pickFileAsDataUrl();
                  if (f != null) setState(() => _files.add(f));
                },
                icon: const Icon(Icons.attach_file_rounded, size: 16),
                label: Text(tr('إرفاق ملفّ', 'Attach file')),
              ),
            ),
          ]),
          ..._kept.map((a) => Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Row(children: [
              const Icon(Icons.cloud_done_outlined, size: 16, color: T.success),
              const SizedBox(width: 6),
              Expanded(child: Text('${a['title'] ?? a['fileName'] ?? ''}', style: const TextStyle(fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis)),
              IconButton(
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.close, size: 16, color: T.danger),
                onPressed: () => setState(() => _kept.remove(a)),
              ),
            ]),
          )),
          ..._files.asMap().entries.map((e) => Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Row(children: [
              const Icon(Icons.description_outlined, size: 16, color: T.navy),
              const SizedBox(width: 6),
              Expanded(child: Text(e.value.fileName, style: const TextStyle(fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis)),
              IconButton(
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.close, size: 16, color: T.danger),
                onPressed: () => setState(() => _files.removeAt(e.key)),
              ),
            ]),
          )),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: _busy || _type.isEmpty || _start == null || _end == null || _noticeViolated ? null : _save,
            child: _busy
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Text(tr('إرسال الطلب', 'Submit')),
          ),
        ],
      ),
    );
  }
}

/// The reply dialog: answer text, one attachment and the request itself, editable. Pops the reply body, or null.
class _ReplyDialog extends StatefulWidget {
  const _ReplyDialog({required this.leave, required this.types, required this.full});
  final Map<String, dynamic> leave;
  final List<Map<String, dynamic>> types;
  final bool full;
  @override
  State<_ReplyDialog> createState() => _ReplyDialogState();
}

class _ReplyDialogState extends State<_ReplyDialog> {
  final _text = TextEditingController();
  final _reason = TextEditingController();
  PickedFile? _file;
  String _type = '';
  DateTime? _start;
  DateTime? _end;
  late final String _type0;
  late final String _start0;
  late final String _end0;

  @override
  void initState() {
    super.initState();
    final l = widget.leave;
    _type = '${l['leaveType'] is Map ? l['leaveType']['_id'] : l['leaveType'] ?? ''}';
    _start = DateTime.tryParse('${l['startDate'] ?? ''}');
    _end = DateTime.tryParse('${l['endDate'] ?? ''}');
    _reason.text = '${l['reason'] ?? ''}';
    _type0 = _type;
    _start0 = _ymd(_start);
    _end0 = _ymd(_end);
  }

  @override
  void dispose() {
    _text.dispose();
    _reason.dispose();
    super.dispose();
  }

  String _ymd(DateTime? d) => d == null ? '' : '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  String _fmt(DateTime? d) => d == null ? tr('اختر التاريخ', 'Pick date') : '${d.day}/${d.month}/${d.year}';
  bool get _amended => _type != _type0 || _ymd(_start) != _start0 || _ymd(_end) != _end0;
  Map<String, dynamic>? get _chosen => widget.types.where((t) => '${t['_id']}' == _type).firstOrNull;

  Future<DateTime?> _pick(DateTime? initial, {DateTime? min}) {
    final now = DateTime.now();
    final first = min ?? DateTime(now.year - 1, now.month, now.day);
    final seed = initial != null && !initial.isBefore(first) ? initial : first;
    return showDatePicker(context: context, initialDate: seed, firstDate: first, lastDate: now.add(const Duration(days: 365)));
  }

  @override
  Widget build(BuildContext context) {
    final cf = _chosen?['countsFridays'] == true;
    final n = countLeaveDays(_start, _end, countFridays: cf);
    final typeIds = widget.types.map((t) => '${t['_id']}').toSet();
    return AlertDialog(
      title: Text(tr('الردّ على الاستفسار', 'Reply to the question')),
      content: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          LeaveThread(leave: widget.leave, full: widget.full),
          TextField(
            controller: _text,
            minLines: 3,
            maxLines: 5,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: tr('ردّك', 'Your reply'),
              hintText: tr('اكتب ردّك أو ما عدّلته…', 'Write your reply or what you changed…'),
            ),
          ),
          const SizedBox(height: 8),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton.icon(
              onPressed: () async {
                final f = await pickFileAsDataUrl();
                if (f != null) setState(() => _file = f);
              },
              icon: const Icon(Icons.attach_file_rounded, size: 16),
              label: Text(_file == null ? tr('إرفاق ملفّ (إيصال، تقرير…)', 'Attach a file (receipt, report…)') : _file!.fileName),
            ),
          ),
          const SizedBox(height: 6),
          Text(tr('تعديل الطلب — اختياري', 'Amend the request — optional'),
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.inkSoft)),
          const SizedBox(height: 6),
          DropdownButtonFormField<String>(
            initialValue: typeIds.contains(_type) ? _type : null,
            isExpanded: true,
            decoration: InputDecoration(labelText: tr('نوع الإجازة', 'Leave type')),
            items: widget.types.map((t) => DropdownMenuItem(value: '${t['_id']}', child: Text('${(Lang.instance.ar ? t['nameAr'] : t['nameEn']) ?? t['nameAr'] ?? ''}'))).toList(),
            onChanged: (v) => setState(() => _type = v ?? _type),
          ),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () async { final d = await _pick(_start); if (d != null) setState(() { _start = d; if (_end != null && _end!.isBefore(d)) _end = d; }); },
                child: Text('${tr('من', 'From')}: ${_fmt(_start)}', textAlign: TextAlign.center),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton(
                onPressed: _start == null ? null : () async { final d = await _pick(_end ?? _start, min: _start); if (d != null) setState(() => _end = d); },
                child: Text('${tr('إلى', 'To')}: ${_fmt(_end)}', textAlign: TextAlign.center),
              ),
            ),
          ]),
          if (_start != null && _end != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(n == 0 ? tr('تاريخ النهاية قبل البداية', 'The end date is before the start') : '${tr('عدد أيام الإجازة', 'Leave days')}: $n ${fridaysNote(_start, _end, countFridays: cf)}',
                  style: TextStyle(fontWeight: FontWeight.w700, color: n == 0 ? T.danger : T.ink)),
            ),
          const SizedBox(height: 8),
          TextField(controller: _reason, decoration: InputDecoration(labelText: tr('السبب', 'Reason'))),
          if (_amended)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(top: 10),
              padding: const EdgeInsets.all(9),
              decoration: BoxDecoration(color: const Color(0xFFFEF3C7), borderRadius: BorderRadius.circular(8), border: Border.all(color: const Color(0xFFFDE68A))),
              child: Text(tr('غيّرت نوع الإجازة أو تاريخها، فيُراجَع الطلب من جديد كاملًا.', 'You changed the leave type or dates, so the request is reviewed again in full.'),
                  style: const TextStyle(fontSize: 11.5, color: Color(0xFF92400E))),
            ),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: const Color(0xFFEA580C)),
          onPressed: _text.text.trim().isEmpty || (_start != null && _end != null && n == 0) ? null : () => Navigator.pop(context, <String, dynamic>{
            'text': _text.text.trim(),
            if (_file != null) 'attachment': _file!.dataUrl,
            if (_file != null) 'attachmentName': _file!.fileName,
            if (_type.isNotEmpty) 'leaveType': _type,
            if (_start != null) 'startDate': _ymd(_start),
            if (_end != null) 'endDate': _ymd(_end),
            'reason': _reason.text,
          }),
          child: Text(tr('إرسال الردّ', 'Send reply')),
        ),
      ],
    );
  }
}


/// The picked employee's balance in the team filing sheet (twin of web MemberBalanceCard): entitlement, accrued, used, available, and what remains after this request when its type deducts.
class _MemberBalanceCard extends StatelessWidget {
  final Map<String, dynamic>? b;
  final int days;
  final bool? deducts;
  const _MemberBalanceCard({required this.b, required this.days, required this.deducts});

  num _n(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;
  String _f(num v) { final r = (v * 100).round() / 100; return r == r.roundToDouble() ? r.round().toString() : r.toString(); }

  @override
  Widget build(BuildContext context) {
    final b = this.b;
    if (b == null) {
      return Text(tr('لا عقد ساريًا لهذا الموظف — لا يُحسب له رصيد.', 'No active contract — no balance.'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint));
    }
    final available = _n(b['available']);
    final after = deducts == true && days > 0 ? available - days : null;
    Widget cell(String label, num v, Color c) => Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8), border: Border.all(color: T.line)),
            child: Column(children: [
              Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkFaint), textAlign: TextAlign.center),
              Text(_f(v), style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: c)),
            ]),
          ),
        );
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: T.success.withValues(alpha: 0.06), borderRadius: BorderRadius.circular(10), border: Border.all(color: T.success.withValues(alpha: 0.3))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(tr('رصيد إجازات الموظف', 'Employee leave balance'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        Row(children: [
          cell(tr('الاستحقاق السنوي', 'Annual'), _n(b['entitlement']), T.ink),
          const SizedBox(width: 4),
          cell(tr('المتراكم', 'Accrued'), _n(b['accrued']) + _n(b['carried']), T.info),
          const SizedBox(width: 4),
          cell(tr('المستخدم', 'Used'), _n(b['taken']), T.warn),
          const SizedBox(width: 4),
          cell(tr('المتاح', 'Available'), available, available < 0 ? T.danger : T.success),
        ]),
        if (after != null) ...[
          const SizedBox(height: 6),
          Text('${tr('بعد هذه الإجازة', 'After this leave')} ($days ${tr('يوم', 'd')}): ${_f(after)} ${tr('يوم', 'd')}${after < 0 ? tr(' — تتجاوز الرصيد المتاح', ' — exceeds the available balance') : ''}',
              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: after < 0 ? T.danger : T.ink)),
        ],
        if (deducts == false && days > 0)
          Padding(padding: const EdgeInsets.only(top: 4), child: Text(tr('هذا النوع لا يُخصم من الرصيد.', 'This type does not come off the balance.'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
      ]),
    );
  }
}
