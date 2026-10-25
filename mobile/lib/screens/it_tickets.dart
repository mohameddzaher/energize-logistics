import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'it_common.dart';
import 'jp.dart';

/// بلاغاتُ الدعم الفنّي — نظيرُ /system/it/tickets: فلاترُ الحالة والتصنيف
/// والأولويّة والمدى الزمني على الخادم، وبحثٌ في الشاشة، وتصديرُ المعروض أو الكلّ،
/// ونموذجُ البلاغ كاملًا (الموظّف وقسمه والمسؤول ويوم الحلّ).
class ItTicketsScreen extends StatefulWidget {
  /// البطاقاتُ في اللوحة تفتح الشاشةَ على حالةٍ بعينها.
  final String initialStatus;
  const ItTicketsScreen({super.key, this.initialStatus = ''});
  @override
  State<ItTicketsScreen> createState() => _ItTicketsScreenState();
}

// الحالات التي يصير فيها للبلاغ زمنُ حلّ، فيُطلب يومُ الحلّ.
const _closedStatuses = ['resolved', 'closed'];

List<ExportCol> ticketExportCols() => [
      ExportCol('رقم البلاغ', 'Ticket #', (r) => r['ticketNumber'] ?? ''),
      ExportCol('العنوان', 'Title', (r) => r['title'] ?? ''),
      ExportCol('التصنيف', 'Category', (r) => categoryLabel(r['category'])),
      ExportCol('الأولوية', 'Priority', (r) => priorityLabel(r['priority'])),
      ExportCol('الحالة', 'Status', (r) => ticketStatusLabel(r['status'])),
      ExportCol('مقدم البلاغ', 'Requester', (r) => r['requesterName'] ?? ''),
      ExportCol('القسم', 'Department', (r) => r['requesterDepartment'] ?? ''),
      ExportCol('تاريخ البلاغ', 'Reported', (r) => '${r['reportedAt'] ?? ''}'.split('T').first),
      ExportCol('زمن الحل', 'Resolution time', (r) => fmtDuration(r['resolutionMinutes'])),
      ExportCol('متكررة', 'Recurring', (r) => r['isRecurring'] == true),
      ExportCol('الحل', 'Resolution', (r) => r['resolution'] ?? ''),
      ExportCol('السبب الجذري', 'Root cause', (r) => r['rootCause'] ?? ''),
    ];

class _ItTicketsScreenState extends State<ItTicketsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  // متحكِّمُ البحث عند الشاشة: «مسح الفلاتر» يمسح الخانةَ أيضًا.
  final _searchCtl = TextEditingController();
  late String _status = widget.initialStatus;
  String _category = '';
  String _priority = '';
  String _from = '';
  String _to = '';
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () => _load();
    Live.instance.on('it:updated', _onLive);
    _load();
  }

  @override
  void dispose() {
    Live.instance.off('it:updated', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  String _query() {
    final qs = <String, String>{
      if (_status.isNotEmpty) 'status': _status,
      if (_category.isNotEmpty) 'category': _category,
      if (_priority.isNotEmpty) 'priority': _priority,
      if (_from.isNotEmpty) 'from': _from,
      if (_to.isNotEmpty) 'to': _to,
    };
    return qs.entries.map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&');
  }

  Future<void> _load() async {
    final my = ++_seq;
    try {
      final d = await Api.instance.get('/api/it/tickets?${_query()}');
      if (!mounted || my != _seq) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['tickets'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && my == _seq) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  void _set(VoidCallback f) { setState(f); _load(); }

  List<Map<String, dynamic>> get _filtered {
    final s = _q.trim().toLowerCase();
    if (s.isEmpty) return _rows;
    return _rows.where((t) => [t['title'], t['ticketNumber'], t['requesterName'], t['device'], t['description']]
        .any((v) => (v ?? '').toString().toLowerCase().contains(s))).toList();
  }

  bool get _anyFilter => _status.isNotEmpty || _category.isNotEmpty || _priority.isNotEmpty || _from.isNotEmpty || _to.isNotEmpty || _q.trim().isNotEmpty;

  Future<void> _export() async {
    final scope = await pickExportScope(context, filtered: _anyFilter);
    if (scope == null || !mounted) return;
    var rows = _filtered;
    if (scope == 'all' && _anyFilter) {
      try {
        final d = await Api.instance.get('/api/it/tickets');
        rows = List<Map<String, dynamic>>.from(d['tickets'] ?? []);
      } catch (_) {}
    }
    if (!mounted) return;
    await exportExcel(context, fileName: 'it-tickets', sheets: [('Tickets', ticketExportCols(), rows)]);
  }

  Future<void> _delete(Map<String, dynamic> t) async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('حذف هذا البلاغ؟', 'Delete this ticket?')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok != true) return;
    try { await Api.instance.delete('/api/it/tickets/${t['_id']}'); _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString()))); }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _filtered;
    final canEdit = canEditIt(context);
    return AppScaffold(
      title: Text(tr('بلاغات الدعم الفني', 'Support Tickets')),
      actions: [IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export)],
      floatingActionButton: !canEdit ? null : FloatingActionButton.extended(
        onPressed: () async { if (await openTicketForm(context, null) == true) _load(); },
        icon: const Icon(Icons.add), label: Text(tr('بلاغ جديد', 'New ticket')),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
          child: SearchField(
            controller: _searchCtl, dense: true,
            onChanged: (v) => setState(() => _q = v),
            hint: tr('بحث بالعنوان أو رقم البلاغ...', 'Search title or ticket #...'),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
          child: Row(children: [
            Expanded(child: ItFilterDropdown(label: tr('الحالة', 'Status'), value: _status, options: ticketStatuses, allAr: 'كل الحالات', allEn: 'All statuses', onChanged: (v) => _set(() => _status = v))),
            const SizedBox(width: 6),
            Expanded(child: ItFilterDropdown(label: tr('التصنيف', 'Category'), value: _category, options: ticketCategories, allAr: 'كل التصنيفات', allEn: 'All categories', onChanged: (v) => _set(() => _category = v))),
            const SizedBox(width: 6),
            Expanded(child: ItFilterDropdown(label: tr('الأولوية', 'Priority'), value: _priority, options: ticketPriorities, allAr: 'كل الأولويات', allEn: 'All priorities', onChanged: (v) => _set(() => _priority = v))),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
          child: ItDateRange(from: _from, to: _to, onFrom: (v) => _set(() => _from = v), onTo: (v) => _set(() => _to = v)),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Row(children: [
            Text('${rows.length} ${tr('بلاغ', 'tickets')}', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.inkSoft)),
            const Spacer(),
            if (_anyFilter)
              TextButton(
                onPressed: () => _set(() { _status = ''; _category = ''; _priority = ''; _from = ''; _to = ''; _q = ''; _searchCtl.clear(); }),
                child: Text(tr('مسح الفلاتر', 'Clear filters'), style: const TextStyle(fontSize: 12)),
              ),
          ]),
        ),
        Expanded(
          child: _loading
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer()])
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 60), EmptyState(icon: _q.trim().isNotEmpty ? Icons.search_off : Icons.confirmation_number_outlined, title: _q.trim().isNotEmpty ? tr('لا نتائج مطابقة للبحث.', 'No matches.') : tr('لا توجد بلاغات.', 'No tickets found.'))])
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              padding: const EdgeInsets.fromLTRB(14, 6, 14, 90),
                              itemCount: rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) => _card(rows[i], canEdit),
                            ),
                    ),
        ),
      ]),
    );
  }

  Widget _card(Map<String, dynamic> t, bool canEdit) {
    final requester = (t['requesterName'] ?? '').toString().isNotEmpty ? t['requesterName'].toString() : itEmpName(t['requester']);
    return Pressable(
      onTap: () async {
        await Navigator.push(context, MaterialPageRoute(builder: (_) => ItTicketDetailScreen(id: '${t['_id']}')));
        _load();
      },
      child: AppCard(
        topAccent: ticketStatusColor(t['status']),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            if (t['isRecurring'] == true) const Padding(padding: EdgeInsetsDirectional.only(end: 4), child: Text('⟳', style: TextStyle(color: T.danger, fontWeight: FontWeight.w900))),
            Expanded(child: Text('${t['title'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
            if (canEdit)
              PopupMenuButton<String>(
                padding: EdgeInsets.zero,
                onSelected: (v) async {
                  if (v == 'edit') { if (await openTicketForm(context, t) == true) _load(); }
                  if (v == 'del') _delete(t);
                },
                itemBuilder: (_) => [
                  PopupMenuItem(value: 'edit', child: Text(tr('تعديل', 'Edit'))),
                  PopupMenuItem(value: 'del', child: Text(tr('حذف', 'Delete'), style: const TextStyle(color: T.danger))),
                ],
              ),
          ]),
          Text([t['ticketNumber'] ?? '', itDate(t['reportedAt'])].where((x) => '$x'.isNotEmpty).join(' · '),
              style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            Chip2(ticketStatusLabel(t['status']), ticketStatusColor(t['status'])),
            Chip2(priorityLabel(t['priority']), priorityColor(t['priority'])),
            Chip2(categoryLabel(t['category']), T.navy),
            if (requester != '—' && requester.isNotEmpty) Chip2(requester, T.info, icon: Icons.person_outline),
            if ((t['requesterDepartment'] ?? '').toString().isNotEmpty) Chip2('${t['requesterDepartment']}', T.inkFaint),
            if ((t['assignedToName'] ?? '').toString().isNotEmpty) Chip2('${tr('المسؤول', 'Owner')}: ${t['assignedToName']}', T.violet),
            if (t['resolutionMinutes'] is num) Chip2(fmtDuration(t['resolutionMinutes']), T.success, icon: Icons.timer_outlined),
          ]),
        ]),
      ),
    );
  }
}

// ── نموذج البلاغ (إضافة / تعديل) — نفس حقول الويب ───────────────────────────
Future<bool?> openTicketForm(BuildContext context, Map<String, dynamic>? editing) async {
  final title = TextEditingController(text: '${editing?['title'] ?? ''}');
  final description = TextEditingController(text: '${editing?['description'] ?? ''}');
  final resolution = TextEditingController(text: '${editing?['resolution'] ?? ''}');
  final rootCause = TextEditingController(text: '${editing?['rootCause'] ?? ''}');
  final preventive = TextEditingController(text: '${editing?['preventiveAction'] ?? ''}');
  final notes = TextEditingController(text: '${editing?['notes'] ?? ''}');
  String category = '${editing?['category'] ?? 'hardware'}';
  String priority = '${editing?['priority'] ?? 'medium'}';
  String status = '${editing?['status'] ?? 'open'}';
  String reportedAt = editing == null ? todayYmd() : '${editing['reportedAt'] ?? ''}'.split('T').first;
  String resolvedDate = '${editing?['resolvedDate'] ?? ''}'.split('T').first;
  String requester = idOf(editing?['requester']);
  String requesterLabel = editing == null ? '' : ((editing['requesterName'] ?? '').toString().isNotEmpty ? '${editing['requesterName']}' : (editing['requester'] is Map ? itEmpName(editing['requester']) : ''));
  String department = '${editing?['requesterDepartment'] ?? ''}';
  String assignedTo = idOf(editing?['assignedTo']);
  String assignedToName = '${editing?['assignedToName'] ?? ''}';

  // القسمُ ومن يُسند إليه الحلّ قائمتان من الخادم لا نصٌّ حرّ.
  List<String> departments = [];
  List<Map<String, dynamic>> assignees = [];
  try {
    final r = await Future.wait([Api.instance.get('/api/it/departments'), Api.instance.get('/api/it/assignees')]);
    departments = List<String>.from((r[0]['departments'] ?? []).map((x) => '$x'));
    assignees = List<Map<String, dynamic>>.from(r[1]['users'] ?? []);
  } catch (_) {}
  if (!context.mounted) return null;

  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (c) {
      bool saving = false;
      return StatefulBuilder(builder: (c, setS) {
        Widget dd(String label, String value, Map<String, (String, String)> opts, ValueChanged<String> on) => DropdownButtonFormField<String>(
              initialValue: opts.containsKey(value) ? value : null,
              isExpanded: true,
              decoration: InputDecoration(labelText: label, isDense: true),
              items: opts.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
              onChanged: (v) => setS(() => on(v ?? value)),
            );
        Widget picker(String label, String text, VoidCallback onTap) => InkWell(
              onTap: onTap,
              child: InputDecorator(
                decoration: InputDecoration(labelText: label, isDense: true, suffixIcon: const Icon(Icons.arrow_drop_down)),
                child: Text(text.isEmpty ? '—' : text, style: TextStyle(fontSize: 13, color: text.isEmpty ? T.inkFaint : T.ink)),
              ),
            );
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(editing == null ? tr('بلاغ جديد', 'New ticket') : tr('تعديل البلاغ', 'Edit ticket'),
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
                const SizedBox(height: 12),
                TextField(controller: title, decoration: InputDecoration(labelText: tr('عنوان المشكلة', 'Problem title'), hintText: tr('مثال: الطابعة لا تستجيب', 'e.g. Printer not responding'))),
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(child: dd(tr('التصنيف', 'Category'), category, ticketCategories, (v) => category = v)),
                  const SizedBox(width: 8),
                  Expanded(child: dd(tr('الأولوية', 'Priority'), priority, ticketPriorities, (v) => priority = v)),
                ]),
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(child: dd(tr('الحالة', 'Status'), status, ticketStatuses, (v) => status = v)),
                  const SizedBox(width: 8),
                  Expanded(child: ItDateField(label: tr('تاريخ البلاغ', 'Reported at'), value: reportedAt, onChanged: (v) => setS(() => reportedAt = v))),
                ]),
                // يومُ الحلّ يُدخله من أغلق البلاغ — لحظةُ الحفظ ليست لحظةَ الإصلاح.
                if (_closedStatuses.contains(status)) ...[
                  const SizedBox(height: 10),
                  ItDateField(label: tr('تاريخ الحل الفعلي', 'Date actually resolved'), value: resolvedDate, onChanged: (v) => setS(() => resolvedDate = v), clearable: true),
                ],
                const SizedBox(height: 10),
                // اختيارُ الموظّف يملأ قسمَه.
                picker(tr('الموظف صاحب المشكلة', 'Employee'), requesterLabel, () async {
                  final e = await pickItEmployee(c);
                  if (e == null) return;
                  setS(() {
                    requester = '${e['_id']}';
                    requesterLabel = itEmpName(e);
                    final dep = '${e['department'] ?? ''}';
                    if (dep.isNotEmpty) department = dep;
                  });
                }),
                const SizedBox(height: 10),
                picker(tr('القسم', 'Department'), department, () async {
                  final p = await pickFromList(c, title: tr('اختر القسم', 'Select a department'),
                      items: departments.map((d) => {'name': d}).toList(), label: (m) => '${m['name']}');
                  if (p != null) setS(() => department = '${p['name']}');
                }),
                const SizedBox(height: 10),
                // الاسمُ يُحفظ بجانب المرجع ليبقى البلاغُ مقروءًا لو حُذف المستخدم.
                picker(tr('المسؤول عن الحل', 'Assigned to'), assignedToName, () async {
                  final u = await pickFromList(c, title: tr('اختر المسؤول', 'Select the owner'), items: assignees,
                      label: (m) => userName(m), hint: (m) => '${m['email'] ?? m['role'] ?? ''}');
                  if (u != null) setS(() { assignedTo = '${u['_id']}'; assignedToName = userName(u); });
                }),
                const SizedBox(height: 10),
                TextField(controller: description, maxLines: 3, decoration: InputDecoration(labelText: tr('وصف المشكلة', 'Description'))),
                const SizedBox(height: 10),
                TextField(controller: resolution, maxLines: 3, decoration: InputDecoration(labelText: tr('ما تم عمله لحل المشكلة', 'Resolution — what IT did'))),
                const SizedBox(height: 10),
                TextField(controller: rootCause, maxLines: 2, decoration: InputDecoration(labelText: tr('السبب الجذري', 'Root cause'))),
                const SizedBox(height: 10),
                TextField(controller: preventive, maxLines: 2, decoration: InputDecoration(labelText: tr('الإجراء الوقائي لمنع التكرار', 'Preventive action'))),
                const SizedBox(height: 10),
                TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
                const SizedBox(height: 14),
                FilledButton(
                  onPressed: saving ? null : () async {
                    if (title.text.trim().isEmpty) return;
                    setS(() => saving = true);
                    final body = {
                      'title': title.text.trim(), 'category': category, 'priority': priority, 'status': status,
                      'reportedAt': reportedAt, 'resolvedDate': resolvedDate,
                      'requesterDepartment': department, 'assignedToName': assignedToName,
                      if (requester.isNotEmpty) 'requester': requester,
                      if (assignedTo.isNotEmpty) 'assignedTo': assignedTo,
                      'description': description.text, 'resolution': resolution.text, 'rootCause': rootCause.text,
                      'preventiveAction': preventive.text, 'notes': notes.text,
                    };
                    try {
                      if (editing != null) { await Api.instance.put('/api/it/tickets/${editing['_id']}', body); }
                      else { await Api.instance.post('/api/it/tickets', body); }
                      if (c.mounted) Navigator.pop(c, true);
                    } catch (e) {
                      setS(() => saving = false);
                      if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
                    }
                  },
                  child: Text(tr('حفظ', 'Save')),
                ),
              ]),
            ),
          ),
        );
      });
    },
  );
}

// ── صفحة البلاغ — نظيرُ /system/it/tickets/[id] ─────────────────────────────
class ItTicketDetailScreen extends StatefulWidget {
  final String id;
  const ItTicketDetailScreen({super.key, required this.id});
  @override
  State<ItTicketDetailScreen> createState() => _ItTicketDetailScreenState();
}

class _ItTicketDetailScreenState extends State<ItTicketDetailScreen> {
  Map<String, dynamic>? _t;
  List<Map<String, dynamic>> _siblings = [];
  bool _loading = true;
  bool _saving = false;
  String _status = 'open';
  final _resolution = TextEditingController();
  final _rootCause = TextEditingController();
  final _preventive = TextEditingController();
  final _notes = TextEditingController();
  late final void Function() _onLive;
  // تحديثٌ حيٌّ لا يمسح ما يكتبه المستخدم: الحقول تُملأ أوّلَ مرّةٍ وبعد الحفظ فقط.
  bool _dirty = false;

  @override
  void initState() {
    super.initState();
    _onLive = () => _load();
    Live.instance.on('it:updated', _onLive);
    _load(fill: true);
  }

  @override
  void dispose() {
    Live.instance.off('it:updated', _onLive);
    for (final c in [_resolution, _rootCause, _preventive, _notes]) { c.dispose(); }
    super.dispose();
  }

  Future<void> _load({bool fill = false}) async {
    try {
      final d = await Api.instance.get('/api/it/tickets/${widget.id}');
      if (!mounted) return;
      final t = Map<String, dynamic>.from(d['ticket'] ?? {});
      setState(() {
        _t = t;
        _siblings = List<Map<String, dynamic>>.from(d['siblings'] ?? []);
        if (fill || !_dirty) {
          _status = '${t['status'] ?? 'open'}';
          _resolution.text = '${t['resolution'] ?? ''}';
          _rootCause.text = '${t['rootCause'] ?? ''}';
          _preventive.text = '${t['preventiveAction'] ?? ''}';
          _notes.text = '${t['notes'] ?? ''}';
          _dirty = false;
        }
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await Api.instance.put('/api/it/tickets/${widget.id}', {
        'status': _status, 'resolution': _resolution.text, 'rootCause': _rootCause.text,
        'preventiveAction': _preventive.text, 'notes': _notes.text,
      });
      _dirty = false;
      await _load(fill: true);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم الحفظ', 'Saved'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
    }
    if (mounted) setState(() => _saving = false);
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      content: Text(tr('حذف هذه التذكرة نهائيًّا؟ يُحذف معها سجلُّ تحديثاتها.', 'Delete this ticket permanently? Its update history goes with it.')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/it/tickets/${widget.id}');
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
    }
  }

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 110, child: Text(label, style: const TextStyle(fontSize: 12, color: T.inkFaint))),
          Expanded(child: Text(value.isEmpty ? '—' : value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final t = _t;
    final canEdit = canEditIt(context);
    return AppScaffold(
      title: Text(t == null ? tr('البلاغ', 'Ticket') : '${t['ticketNumber'] ?? tr('البلاغ', 'Ticket')}'),
      actions: [
        if (t != null && canEdit) ...[
          IconButton(tooltip: tr('تعديل', 'Edit'), icon: const Icon(Icons.edit_outlined),
              onPressed: () async { if (await openTicketForm(context, t) == true) _load(fill: true); }),
          IconButton(tooltip: tr('حذف التذكرة', 'Delete ticket'), icon: const Icon(Icons.delete_outline), onPressed: _delete),
        ],
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer()])
          : t == null
              ? EmptyState(icon: Icons.search_off, title: tr('البلاغ غير موجود.', 'Ticket not found.'))
              : RefreshIndicator(
                  onRefresh: () => _load(),
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    Text('${t['title'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
                    const SizedBox(height: 6),
                    Wrap(spacing: 6, runSpacing: 6, children: [
                      Chip2(ticketStatusLabel(t['status']), ticketStatusColor(t['status'])),
                      Chip2(priorityLabel(t['priority']), priorityColor(t['priority'])),
                      Chip2(categoryLabel(t['category']), T.navy),
                    ]),
                    if (t['isRecurring'] == true) ...[
                      const SizedBox(height: 10),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(color: const Color(0xFFFEF2F2), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFFECACA))),
                        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          const Icon(Icons.warning_amber_rounded, color: T.danger, size: 20),
                          const SizedBox(width: 8),
                          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(tr('مشكلة متكررة', 'Recurring problem'), style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xFF991B1B))),
                            const SizedBox(height: 3),
                            Text(tr('تكررت هذه المشكلة ${_siblings.length + 1} مرات. الحل المؤقت لن يكفي — يجب معالجة السبب الجذري.',
                                    'This problem has now occurred ${_siblings.length + 1} times. Patching it again won\'t hold — the root cause needs a permanent fix.'),
                                style: const TextStyle(fontSize: 12, color: Color(0xFFB91C1C))),
                          ])),
                        ]),
                      ),
                    ],
                    const SizedBox(height: 12),
                    AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(tr('تفاصيل البلاغ', 'Ticket details'), style: const TextStyle(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 6),
                      _row(tr('مقدم البلاغ', 'Requester'), (t['requesterName'] ?? '').toString().isNotEmpty ? '${t['requesterName']}' : itEmpName(t['requester'])),
                      _row(tr('القسم', 'Department'), '${t['requesterDepartment'] ?? ''}'),
                      _row(tr('المسؤول', 'Assigned to'), (t['assignedToName'] ?? '').toString().isNotEmpty ? '${t['assignedToName']}' : userName(t['assignedTo'])),
                      _row(tr('الجهاز', 'Device'), '${t['device'] ?? ''}'),
                      _row(tr('تاريخ البلاغ', 'Reported at'), itDate(t['reportedAt'])),
                      _row(tr('تاريخ الحل', 'Resolved at'), itDate(t['resolvedAt'])),
                      _row(tr('زمن الحل', 'Resolution time'), fmtDuration(t['resolutionMinutes'])),
                    ])),
                    const SizedBox(height: 10),
                    AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(tr('وصف المشكلة', 'Description'), style: const TextStyle(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 6),
                      Text((t['description'] ?? '').toString().isEmpty ? tr('لا يوجد وصف.', 'No description.') : '${t['description']}',
                          style: const TextStyle(fontSize: 13, color: T.inkSoft)),
                    ])),
                    if (canEdit) ...[
                      const SizedBox(height: 10),
                      // التحديثُ في الصفحة نفسها — القسمُ يعمل على البلاغ من هنا.
                      AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        Text(tr('تحديث الحالة والحل', 'Update status & resolution'), style: const TextStyle(fontWeight: FontWeight.w800)),
                        const SizedBox(height: 10),
                        DropdownButtonFormField<String>(
                          initialValue: ticketStatuses.containsKey(_status) ? _status : null,
                          decoration: InputDecoration(labelText: tr('الحالة', 'Status'), isDense: true),
                          items: ticketStatuses.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
                          onChanged: (v) => setState(() { _status = v ?? _status; _dirty = true; }),
                        ),
                        const SizedBox(height: 10),
                        for (final (ctrl, ar, en, lines) in [
                          (_resolution, 'ما تم عمله لحل المشكلة', 'Resolution — what IT did', 3),
                          (_rootCause, 'السبب الجذري', 'Root cause', 2),
                          (_preventive, 'الإجراء الوقائي لمنع التكرار', 'Preventive action', 2),
                          (_notes, 'ملاحظات', 'Notes', 2),
                        ]) ...[
                          TextField(controller: ctrl, maxLines: lines, onChanged: (_) => _dirty = true, decoration: InputDecoration(labelText: tr(ar, en))),
                          const SizedBox(height: 10),
                        ],
                        FilledButton.icon(
                          onPressed: _saving ? null : _save,
                          icon: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.check),
                          label: Text(tr('حفظ', 'Save')),
                        ),
                      ])),
                    ],
                    const SizedBox(height: 10),
                    // سيرةُ التكرار — كلُّ مرّةٍ سابقةٍ لنفس المشكلة وما جُرِّب فيها.
                    AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        const Icon(Icons.history, size: 18, color: T.orange),
                        const SizedBox(width: 6),
                        Expanded(child: Text(tr('مرات حدوث نفس المشكلة سابقاً', 'Previous occurrences of this same problem'), style: const TextStyle(fontWeight: FontWeight.w800))),
                        Text('(${_siblings.length})', style: const TextStyle(color: T.inkFaint, fontSize: 12)),
                      ]),
                      const SizedBox(height: 8),
                      if (_siblings.isEmpty)
                        Text(tr('هذه أول مرة تُسجَّل فيها هذه المشكلة.', 'This is the first time this problem has been logged.'), style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
                      for (final s in _siblings)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Pressable(
                            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ItTicketDetailScreen(id: '${s['_id']}'))),
                            child: Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), border: Border.all(color: T.line)),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Row(children: [
                                  Expanded(child: Text('${s['ticketNumber'] ?? ''} · ${s['title'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                                  Chip2(ticketStatusLabel(s['status']), ticketStatusColor(s['status'])),
                                ]),
                                const SizedBox(height: 3),
                                Text([
                                  itDate(s['reportedAt']),
                                  s['requesterName'], s['requesterDepartment'],
                                  if (s['resolutionMinutes'] is num) '${tr('زمن الحل', 'resolved in')} ${fmtDuration(s['resolutionMinutes'])}',
                                ].where((x) => x != null && '$x'.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                                if ((s['resolution'] ?? '').toString().isNotEmpty)
                                  Text('${tr('ما تم عمله: ', 'What was done: ')}${s['resolution']}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                                if ((s['rootCause'] ?? '').toString().isNotEmpty)
                                  Text('${tr('السبب الجذري: ', 'Root cause: ')}${s['rootCause']}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                              ]),
                            ),
                          ),
                        ),
                    ])),
                    const SizedBox(height: 10),
                    // مهامُّ JP المربوطة بهذا البلاغ — تُضاف من هنا.
                    JpTaskPanel(section: 'it', kind: 'ticket', refId: '${t['_id'] ?? widget.id}'),
                    const SizedBox(height: 30),
                  ]),
                ),
    );
  }
}
