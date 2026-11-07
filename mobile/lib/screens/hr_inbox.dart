import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth.dart';
import '../services/api.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/leave_chain.dart';
import '../ui/leave_return.dart';
import '../ui/widgets.dart';
import '../ui/export_sheet.dart';
import 'hr_leave_pdf.dart';
import 'hr_leave_register.dart';
import '../ui/search_field.dart';
import 'top_management.dart';

/// HR inboxes, native: leave requests (HR decisions) and employee requests (reply and status change).

// Leave requests.
/// Where HR stands on a request, for the card mark (twin of web hrMark): 'now' waits on HR, 'before' is open and has not reached HR yet, '' once HR acted or it is closed.
String _hrMark(Map l) {
  final st = '${l['status'] ?? ''}';
  if (st == 'pending_hr') return 'now';
  final open = st.startsWith('pending_') || st == 'info_requested';
  final hrDone = l['hrDecision'] is Map && '${l['hrDecision']['at'] ?? ''}'.isNotEmpty;
  return open && !hrDone ? 'before' : '';
}

class HrLeavesScreen extends StatefulWidget {
  const HrLeavesScreen({super.key});
  @override
  State<HrLeavesScreen> createState() => _HrLeavesScreenState();
}


class _HrLeavesScreenState extends State<HrLeavesScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _status = '';
  String _type = '';
  // Search by employee or requester, like the web (filters the loaded rows).
  String _q = '';
  // Changing the status reloads and destroys the field; the text lives in a controller so it survives.
  final _searchCtl = TextEditingController();
  int _seq = 0;
  late final void Function() _onLive;

  String _empName(Map<String, dynamic> l) => l['employee'] is Map
      ? ((l['employee']['arabicName'] ?? '').toString().isNotEmpty && Lang.instance.ar
          ? '${l['employee']['arabicName']}'
          : '${l['employee']['firstName'] ?? ''} ${l['employee']['lastName'] ?? ''}'.trim())
      : '';
  String _reqName(Map<String, dynamic> l) => l['requester'] is Map ? '${l['requester']['firstName'] ?? ''} ${l['requester']['lastName'] ?? ''}'.trim() : '';

  /// Status keys shared by the chips and the stats strip; filtered here over the full list so the counts never shrink to the filter.
  bool _matchStatus(Map<String, dynamic> l) {
    if (_status.isEmpty) return true;
    final s = '${l['status']}';
    if (_status == 'in_review') return leaveIsActionable(s);
    if (_status == 'on_leave') return _onLeaveToday(l);
    if (_status == 'approved_month' || _status == 'rejected_month') return _decidedThisMonth(l, _status.split('_').first);
    return s == _status;
  }

  static String _riyadhToday() {
    final d = DateTime.now().toUtc().add(const Duration(hours: 3));
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }
  static bool _onLeaveToday(Map l) {
    final t = _riyadhToday();
    return l['status'] == 'approved' && '${l['startDate']}'.compareTo(t) <= 0 && '${l['endDate']}'.compareTo(t) >= 0;
  }
  static bool _decidedThisMonth(Map l, String status) =>
      l['status'] == status && '${l['updatedAt'] ?? l['createdAt'] ?? ''}'.startsWith(_riyadhToday().substring(0, 7));

  List<Map<String, dynamic>> get _shown {
    final q = _q.trim().toLowerCase();
    final rows = _rows.where((l) => _matchStatus(l) && (_type.isEmpty || (l['leaveType'] is Map && '${l['leaveType']['_id']}' == _type))).toList();
    if (q.isEmpty) return rows;
    return rows.where((l) => _empName(l).toLowerCase().contains(q) || _reqName(l).toLowerCase().contains(q)
        || '${(l['employee'] as Map?)?['arabicName'] ?? ''}'.contains(q)).toList();
  }

  // Export columns as on the web: employee, type, start and end in both calendars, days, status, reason.
  List<ExportCol> get _exportCols => [
        ExportCol('Employee', 'Employee', (r) => _empName(r)),
        ExportCol('Type', 'Type', (r) => r['leaveType'] is Map ? (r['leaveType']['nameEn'] ?? r['leaveType']['nameAr'] ?? '') : ''),
        ExportCol('تاريخ البداية الميلادي', 'Start date (Gregorian)', (r) => gregDay(r['startDate'])),
        ExportCol('تاريخ البداية الهجري', 'Start date (Hijri)', (r) => hijriDay(r['startDate'])),
        ExportCol('تاريخ النهاية الميلادي', 'End date (Gregorian)', (r) => gregDay(r['endDate'])),
        ExportCol('تاريخ النهاية الهجري', 'End date (Hijri)', (r) => hijriDay(r['endDate'])),
        ExportCol('Days', 'Days', (r) => r['days'] ?? ''),
        ExportCol('Status', 'Status', (r) { final st = leaveStatusFor(r['status'], full: _full); return tr(st.$1, st.$2); }),
        ExportCol('Reason', 'Reason', (r) => r['reason'] ?? ''),
      ];

  // Stages are shown to process viewers only (seesLeaveProcess); HR staff filter and read «قيد المراجعة».
  bool get _full => seesLeaveProcess(context.read<AuthProvider>().user);
  Map<String, (String, String, Color)> get _statusFilters => _full
      ? leaveStatusMeta
      : {'in_review': ('قيد المراجعة', 'Under review', const Color(0xFFD97706)), for (final e in leaveStatusMeta.entries) if (!leaveIsActionable(e.key)) e.key: e.value};

  Future<void> _export(String scope) async {
    var rows = _shown;
    // The full list is always loaded (filters run here), so "All" is what is held.
    if (scope == 'all') rows = _rows;
    if (!mounted) return;
    exportExcel(context, fileName: 'leaves', sheets: [('Leaves', _exportCols, rows)]);
  }

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('hr:leave', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('hr:leave', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      // Unfiltered: the stats strip counts every request, and the chips filter locally.
      final d = await Api.instance.get('/api/hr/leaves');
      if (!mounted || mine != _seq) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['leaves'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _decide(Map<String, dynamic> l, String decision) async {
    final note = TextEditingController();
    final approving = decision == 'approved';
    final asking = decision == 'info';
    // Fetch the approver's signatures so they can optionally pick one when approving.
    List<Map<String, dynamic>> signatures = [];
    if (approving) {
      try {
        final d = await Api.instance.get('/api/auth/signatures');
        signatures = List<Map<String, dynamic>>.from(d['signatures'] ?? []);
      } catch (_) { /* no signatures */ }
    }
    if (!mounted) return;
    String? sigId = approving
        ? (signatures.firstWhere((s) => s['isDefault'] == true, orElse: () => signatures.isNotEmpty ? signatures.first : {})['_id'])?.toString()
        : null;
    final askDeduct = approving && leaveNeedsDeduction(l);
    bool? deduct;
    // At HR's stage every Friday is a leave day unless HR picks it out (not counted, not off the balance).
    final hrStage = approving && l['status'] == 'pending_hr';
    final start = DateTime.tryParse('${l['startDate'] ?? ''}');
    final end = DateTime.tryParse('${l['endDate'] ?? ''}');
    final fridays = hrStage ? fridaysOf(start, end) : const <String>[];
    var offFridays = leaveExcludedFridays(l).where(fridays.contains).toList();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c, setD) => AlertDialog(
        title: Text(approving ? tr('اعتماد الطلب', 'Approve') : asking ? tr('استفسار / طلب تعديل', 'Ask / request change') : tr('رفض الطلب', 'Reject')),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (fridays.isNotEmpty) ...[
            LeaveFridayPicker(fridays: fridays, calendarDays: countLeaveDays(start, end), value: offFridays, onChanged: (v) => setD(() => offFridays = v)),
            const SizedBox(height: 10),
          ],
          if (askDeduct) ...[
            DeductionPicker(value: deduct, days: l['days'], onChanged: (v) => setD(() => deduct = v)),
            const SizedBox(height: 10),
          ],
          TextField(controller: note, onChanged: (_) => setD(() {}), decoration: InputDecoration(labelText: asking ? tr('سؤالك أو ما تريد تعديله *', 'Your question *') : tr('ملاحظة (اختياري)', 'Note'))),
          if (approving) ...[
            const SizedBox(height: 12),
            if (signatures.isEmpty)
              Row(children: [
                const Icon(Icons.info_outline, size: 15, color: T.inkFaint),
                const SizedBox(width: 6),
                Expanded(child: Text(tr('لا يوجد توقيع — أضِفه من الإعدادات', 'No signature — add one in Settings'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
              ])
            else
              DropdownButtonFormField<String>(
                initialValue: sigId,
                isExpanded: true,
                decoration: InputDecoration(labelText: tr('التوقيع', 'Signature'), prefixIcon: const Icon(Icons.draw_outlined, size: 18)),
                // Every approval is signed; the approver only chooses which of his signatures.
                items: [
                  ...signatures.map((s) => DropdownMenuItem(value: (s['_id']).toString(), child: Text((s['name'] ?? 'توقيع').toString()))),
                ],
                onChanged: (v) => setD(() => sigId = v ?? sigId),
              ),
          ],
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: approving ? T.success : asking ? const Color(0xFFEA580C) : T.danger),
            onPressed: (askDeduct && deduct == null) || (asking && note.text.trim().isEmpty) ? null : () => Navigator.pop(c, true),
            child: Text(approving ? tr('اعتماد', 'Approve') : asking ? tr('إرسال', 'Send') : tr('رفض', 'Reject')),
          ),
        ],
      )),
    );
    if (ok != true) return;
    try {
      await Api.instance.patch('/api/hr/leaves/${l['_id']}/decision', {
        'decision': decision,
        'note': note.text,
        if (approving && sigId != null) 'signatureId': sigId,
        if (askDeduct) 'deductBalance': deduct,
        if (hrStage) 'excludedFridays': offFridays,
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  String _d(dynamic v) {
    final d = v != null ? DateTime.tryParse(v.toString()) : null;
    return d == null ? '—' : '${d.day}/${d.month}/${d.year}${hijriDay(v).isEmpty ? '' : ' · ${hijriDay(v)} ${tr('هـ', 'AH')}'}';
  }

  /// Edit a leave: a record correction (type, dates, reason); its status stays.
  Future<void> _edit(Map<String, dynamic> l) async {
    List<Map<String, dynamic>> types = [];
    try {
      final b = await Api.instance.get('/api/hr/leave-types');
      types = List<Map<String, dynamic>>.from(((b as Map)['leaveTypes'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      return;
    }
    if (!mounted) return;
    String? typeId = l['leaveType'] is Map ? l['leaveType']['_id']?.toString() : l['leaveType']?.toString();
    if (!types.any((t) => t['_id'] == typeId)) typeId = null;
    DateTime? start = DateTime.tryParse((l['startDate'] ?? '').toString());
    DateTime? end = DateTime.tryParse((l['endDate'] ?? '').toString());
    final reason = TextEditingController(text: (l['reason'] ?? '').toString());
    // Calendar days minus HR's excluded Fridays still inside the new period (the server counts the same).
    final excluded = leaveExcludedFridays(l);
    int days() => countLeaveDays(start, end) - fridaysOf(start, end).where(excluded.contains).length;
    String fmt(DateTime? d) => d == null ? '—' : '${d.day}/${d.month}/${d.year}';

    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setSt) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('تعديل الإجازة', 'Edit leave'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 4),
              Text(tr('تصحيحٌ للسجلّ: الحالة ومراحل الموافقة لا تتغيّر، والرصيد يُعاد حسابه تلقائيًّا.',
                      'A record correction: status and approvals stay; the balance is recalculated.'),
                  style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: typeId,
                isExpanded: true,
                decoration: InputDecoration(labelText: tr('نوع الإجازة', 'Leave type')),
                items: types.map((t) => DropdownMenuItem(
                  value: t['_id'] as String,
                  child: Text(tr('${t['nameAr']}', '${t['nameEn']}'), overflow: TextOverflow.ellipsis),
                )).toList(),
                onChanged: (v) => setSt(() => typeId = v),
              ),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: OutlinedButton(
                  onPressed: () async {
                    final d = await showDatePicker(context: c, initialDate: start ?? DateTime.now(),
                        firstDate: DateTime(DateTime.now().year - 5), lastDate: DateTime(DateTime.now().year + 2));
                    if (d != null) setSt(() { start = d; if (end != null && end!.isBefore(d)) end = d; });
                  },
                  child: Text('${tr('من', 'From')}: ${fmt(start)}${start == null ? '' : '\n${hijriHint(start, ar: Lang.instance.ar)}'}', textAlign: TextAlign.center),
                )),
                const SizedBox(width: 8),
                Expanded(child: OutlinedButton(
                  onPressed: start == null ? null : () async {
                    final d = await showDatePicker(context: c, initialDate: (end != null && !end!.isBefore(start!)) ? end! : start!,
                        firstDate: start!, lastDate: DateTime(DateTime.now().year + 2));
                    if (d != null) setSt(() => end = d);
                  },
                  child: Text('${tr('إلى', 'To')}: ${fmt(end)}${end == null ? '' : '\n${hijriHint(end, ar: Lang.instance.ar)}'}', textAlign: TextAlign.center),
                )),
              ]),
              if (days() > 0) ...[
                const SizedBox(height: 8),
                Text('${tr('المدّة', 'Duration')}: ${days()} ${tr('يوم', 'day(s)')}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
              ],
              const SizedBox(height: 10),
              TextField(controller: reason, maxLines: 2, decoration: InputDecoration(labelText: tr('السبب / ملاحظة', 'Reason / note'))),
              const SizedBox(height: 12),
              SizedBox(width: double.infinity, child: FilledButton(
                onPressed: (typeId == null || days() == 0) ? null : () => Navigator.pop(c, true),
                child: Text(tr('حفظ', 'Save')),
              )),
            ]),
          ),
        ),
      )),
    );
    if (ok != true) return;
    String iso(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    try {
      await Api.instance.put('/api/hr/leaves/${l['_id']}', {
        'leaveType': typeId,
        'startDate': iso(start!),
        'endDate': iso(end!),
        'reason': reason.text.trim(),
      });
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('عُدِّلت الإجازة', 'Leave updated'))));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _delete(Map<String, dynamic> l, String emp) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف الإجازة؟', 'Delete this leave?')),
        content: Text(tr('تُحذف إجازة $emp (${l['days'] ?? '—'} يوم) نهائيًّا، ويعود ما خُصم بها إلى رصيده.',
            "$emp's leave (${l['days'] ?? '—'} day(s)) is deleted permanently; deducted days return to the balance.")),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/hr/leaves/${l['_id']}');
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('حُذفت الإجازة', 'Leave deleted'))));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('طلبات الإجازات', 'Leave Requests')),
      actions: [
        PopupMenuButton<String>(
          icon: const Icon(Icons.file_download_outlined),
          tooltip: tr('تصدير Excel', 'Export to Excel'),
          onSelected: _export,
          itemBuilder: (_) => [
            PopupMenuItem(value: 'shown', child: Text(tr('المعروض', 'Shown'))),
            PopupMenuItem(value: 'all', child: Text(tr('الكل', 'All'))),
          ],
        ),
        // Recording a leave (incl. employees without a login) lives in the leave register.
        IconButton(
          icon: const Icon(Icons.event_note_outlined),
          tooltip: tr('سجل الإجازات', 'Leave register'),
          onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const HrLeaveRegisterScreen())),
        ),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 44), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  // The process at a glance, like the web: each card filters the list.
                  _LeaveStatsStrip(rows: _rows, active: _status, onPick: (k) => setState(() => _status = _status == k ? '' : k)),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
                    child: SearchField(
                      controller: _searchCtl, dense: true,
                      onChanged: (v) => setState(() => _q = v),
                      hint: tr('ابحث باسم الموظف…', 'Search by employee…'),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
                    child: DropdownButtonFormField<String>(
                      initialValue: _type,
                      isExpanded: true,
                      decoration: InputDecoration(labelText: tr('نوع الإجازة', 'Leave type'), isDense: true),
                      items: [
                        DropdownMenuItem(value: '', child: Text(tr('كل الأنواع', 'All types'))),
                        ...{for (final l in _rows) if (l['leaveType'] is Map) '${l['leaveType']['_id']}': tr('${l['leaveType']['nameAr'] ?? ''}', '${l['leaveType']['nameEn'] ?? ''}')}
                            .entries.map((t) => DropdownMenuItem(value: t.key, child: Text(t.value, overflow: TextOverflow.ellipsis))),
                      ],
                      onChanged: (v) => setState(() => _type = v ?? ''),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: _statusFilters.entries.map((e) {
                          final selected = _status == e.key;
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: selected,
                              onSelected: (_) => setState(() => _status = selected ? '' : e.key),
                              label: Text(tr(e.value.$1, e.value.$2)),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : e.value.$3),
                              selectedColor: e.value.$3,
                              backgroundColor: e.value.$3.withValues(alpha: 0.1),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          );
                        }).toList(),
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: _shown.isEmpty
                          ? EmptyState(icon: Icons.event_available_outlined, title: _q.trim().isNotEmpty ? tr('لا نتائج', 'No matches') : tr('لا توجد طلبات', 'No requests'))
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              padding: const EdgeInsets.all(14),
                              itemCount: _shown.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final l = _shown[i];
                                final canAct = canDecideLeave(context.read<AuthProvider>().user, l, hrStaff: true);
                                final st = leaveStatusFor(l['status'], full: _full, canAct: canAct);
                                final emp = l['employee'] is Map
                                    ? ((l['employee']['arabicName'] ?? '').toString().isNotEmpty
                                        ? l['employee']['arabicName']
                                        : '${l['employee']['firstName'] ?? ''} ${l['employee']['lastName'] ?? ''}'.trim())
                                    : (l['requester'] is Map ? '${l['requester']['firstName'] ?? ''} ${l['requester']['lastName'] ?? ''}'.trim() : '—');
                                final type = l['leaveType'] is Map ? (l['leaveType']['nameAr'] ?? l['leaveType']['nameEn'] ?? '') : '';
                                final actionable = canAct;
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  // Tapping the card opens the whole request (same sheet as the top management desk).
                                  child: InkWell(
                                  borderRadius: BorderRadius.circular(16),
                                  onTap: () => showModalBottomSheet(
                                    context: context, isScrollControlled: true, useSafeArea: true, backgroundColor: Colors.white,
                                    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
                                    builder: (c) => DraggableScrollableSheet(
                                      expand: false, initialChildSize: 0.88, maxChildSize: 0.96, minChildSize: 0.5,
                                      builder: (c, sc) => LeaveDetailSheet(leave: l, full: _full, canAct: false, scroll: sc, onDecide: (_) async {}),
                                    ),
                                  ),
                                  child: AppCard(
                                    // Waiting on HR now shows in orange, as the web row is marked.
                                    topAccent: _hrMark(l) == 'now' ? T.orange : st.$3,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        if (_hrMark(l) == 'now') const Padding(padding: EdgeInsetsDirectional.only(end: 6), child: Icon(Icons.notifications_active, size: 18, color: T.orange)),
                                        if (_hrMark(l) == 'before') const Padding(padding: EdgeInsetsDirectional.only(end: 6), child: Icon(Icons.hourglass_top, size: 17, color: T.info)),
                                        Expanded(child: Text(emp.toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                        Chip2(tr(st.$1, st.$2), st.$3),
                                        // Official leave sheet PDF with signatures, like the PDF button on the web.
                                        IconButton(
                                          visualDensity: VisualDensity.compact,
                                          tooltip: tr('تحميل ورقة الإجازة PDF', 'Download PDF sheet'),
                                          icon: const Icon(Icons.picture_as_pdf_outlined, size: 18, color: T.navy),
                                          onPressed: () => downloadLeaveSheet(context, '${l['_id']}'),
                                        ),
                                        IconButton(
                                          visualDensity: VisualDensity.compact,
                                          tooltip: tr('تعديل', 'Edit'),
                                          icon: const Icon(Icons.edit_outlined, size: 18, color: T.inkSoft),
                                          onPressed: () => _edit(l),
                                        ),
                                        IconButton(
                                          visualDensity: VisualDensity.compact,
                                          tooltip: tr('حذف', 'Delete'),
                                          icon: const Icon(Icons.delete_outline, size: 18, color: T.danger),
                                          onPressed: () => _delete(l, emp.toString()),
                                        ),
                                      ]),
                                      const SizedBox(height: 4),
                                      Text('$type · ${_d(l['startDate'])} ← ${_d(l['endDate'])} · ${l['days'] ?? '—'} ${tr('يوم', 'days')}',
                                          style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                                      if (leaveExcludedFridays(l).isNotEmpty)
                                        Text(tr('بدون ${leaveExcludedFridays(l).length} جمعة', '${leaveExcludedFridays(l).length} Fri not counted'),
                                            style: const TextStyle(fontSize: 11, color: Color(0xFF0369A1), fontWeight: FontWeight.w700)),
                                      const SizedBox(height: 6),
                                      LeaveChainBar(leave: l, full: _full),
                                      const SizedBox(height: 4),
                                      LeaveDeductionBadge(leave: l, full: _full),
                                      if (l['status'] == 'approved') ...[
                                        const SizedBox(height: 6),
                                        Row(children: [
                                          Expanded(child: Align(alignment: AlignmentDirectional.centerStart, child: LeaveReturnChip(l))),
                                          TextButton(
                                            onPressed: () => showLeaveReturnSheet(context, l, _load),
                                            child: Text(tr('عودة / تمديد', 'Return / extend')),
                                          ),
                                        ]),
                                      ],
                                      if ((l['reason'] ?? '').toString().isNotEmpty)
                                        Text(l['reason'], style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                                      if (!actionable && leaveIsOpen(l['status'])) ...[
                                        const SizedBox(height: 6),
                                        Text(leaveWaitNote(l, full: _full), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                      ],
                                      if (actionable) ...[
                                        const SizedBox(height: 8),
                                        Row(children: [
                                          Expanded(child: FilledButton(
                                            style: FilledButton.styleFrom(backgroundColor: T.success, minimumSize: const Size.fromHeight(38)),
                                            onPressed: () => _decide(l, 'approved'),
                                            child: Text(tr('اعتماد', 'Approve')),
                                          )),
                                          const SizedBox(width: 8),
                                          Expanded(child: FilledButton(
                                            style: FilledButton.styleFrom(backgroundColor: T.danger, minimumSize: const Size.fromHeight(38)),
                                            onPressed: () => _decide(l, 'rejected'),
                                            child: Text(tr('رفض', 'Reject')),
                                          )),
                                        ]),
                                        // A question is not a rejection: the request returns to its owner to answer or edit.
                                        Align(alignment: AlignmentDirectional.centerStart, child: TextButton.icon(
                                          onPressed: () => _decide(l, 'info'),
                                          icon: const Icon(Icons.help_outline, size: 16, color: Color(0xFFEA580C)),
                                          label: Text(tr('استفسار / طلب تعديل', 'Ask / request change'), style: const TextStyle(color: Color(0xFFEA580C))),
                                        )),
                                      ],
                                    ]),
                                  )),
                                );
                              },
                            ),
                    ),
                  ),
                ]),
    );
  }
}

/// Counts over every loaded request: open ones by stage, returned ones, this month's outcomes, and who is on leave today. Each card filters the list.
class _LeaveStatsStrip extends StatelessWidget {
  final List<Map<String, dynamic>> rows;
  final String active;
  final ValueChanged<String> onPick;
  const _LeaveStatsStrip({required this.rows, required this.active, required this.onPick});

  @override
  Widget build(BuildContext context) {
    int n(bool Function(Map<String, dynamic>) f) => rows.where(f).length;
    final cards = <(String, String, String, int, Color)>[
      ('in_review', 'قيد المسار الآن', 'In progress', n((l) => leaveIsActionable('${l['status']}')), const Color(0xFFB45309)),
      ('pending_hr', 'بانتظار الموارد البشرية', 'Awaiting HR', n((l) => l['status'] == 'pending_hr'), T.info),
      ('pending_manager', 'عند المدير المباشر', 'With the manager', n((l) => l['status'] == 'pending_manager'), T.inkSoft),
      ('pending_finance', 'عند الإدارة المالية', 'With finance', n((l) => l['status'] == 'pending_finance'), T.inkSoft),
      ('pending_executive', 'عند الإدارة العليا', 'With top management', n((l) => l['status'] == 'pending_executive'), T.inkSoft),
      ('info_requested', 'مطلوب إيضاح من الموظف', 'Awaiting the employee', n((l) => l['status'] == 'info_requested'), const Color(0xFFEA580C)),
      ('approved_month', 'معتمدة هذا الشهر', 'Approved this month', n((l) => _HrLeavesScreenState._decidedThisMonth(l, 'approved')), T.success),
      ('rejected_month', 'مرفوضة هذا الشهر', 'Rejected this month', n((l) => _HrLeavesScreenState._decidedThisMonth(l, 'rejected')), T.danger),
      ('on_leave', 'في إجازة اليوم', 'On leave today', n((l) => _HrLeavesScreenState._onLeaveToday(l)), T.violet),
    ];
    return SizedBox(
      height: 74,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
        children: [
          for (final c in cards)
            Padding(
              padding: const EdgeInsetsDirectional.only(end: 8),
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => onPick(c.$1),
                child: Container(
                  width: 128,
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: active == c.$1 ? T.orange : T.line, width: active == c.$1 ? 2 : 1),
                  ),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
                    Text(tr(c.$2, c.$3), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                    Text('${c.$4}', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: c.$5)),
                  ]),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// Employee requests.
class HrRequestsScreen extends StatefulWidget {
  const HrRequestsScreen({super.key});
  @override
  State<HrRequestsScreen> createState() => _HrRequestsScreenState();
}

const _reqStatuses = {
  'open': ('مفتوح', 'Open', T.warn),
  'in_progress': ('قيد التنفيذ', 'In progress', T.info),
  'received': ('تم الاستلام', 'Received', T.violet),
  'resolved': ('تم التسليم', 'Delivered', T.success),
  'closed': ('مغلق', 'Closed', T.inkFaint),
};

class _HrRequestsScreenState extends State<HrRequestsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('hr:request', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('hr:request', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/hr/requests');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['requests'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _reply(Map<String, dynamic> r) async {
    final body = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('الرد على الطلب', 'Reply')),
        content: TextField(controller: body, maxLines: 3, decoration: InputDecoration(labelText: tr('نص الرد', 'Reply text'))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('إرسال', 'Send'))),
        ],
      ),
    );
    if (ok != true || body.text.trim().isEmpty) return;
    try {
      await Api.instance.post('/api/hr/requests/${r['_id']}/reply', {'body': body.text});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _setStatus(Map<String, dynamic> r, String status) async {
    try {
      await Api.instance.patch('/api/hr/requests/${r['_id']}/status', {'status': status});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('طلبات الموظفين', 'Employee Requests')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 44), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _rows.isEmpty
                      ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.mark_email_unread_outlined, title: tr('لا توجد طلبات', 'No requests'))])
                      : ListView.separated(
                          padding: const EdgeInsets.all(14),
                          itemCount: _rows.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (c, i) {
                            final r = _rows[i];
                            final st = _reqStatuses[r['status']] ?? ('—', '—', T.inkFaint);
                            final requester = r['requester'] is Map ? '${r['requester']['firstName'] ?? ''} ${r['requester']['lastName'] ?? ''}'.trim() : '';
                            final thread = List<Map<String, dynamic>>.from(r['thread'] ?? []);
                            return FadeSlideIn(
                              delayMs: (i * 15).clamp(0, 150),
                              child: AppCard(
                                topAccent: st.$3,
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    Expanded(child: Text((r['subject'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                    Chip2(tr(st.$1, st.$2), st.$3),
                                  ]),
                                  Text(requester, style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                                  if (thread.isNotEmpty) ...[
                                    const SizedBox(height: 6),
                                    Text(thread.last['body']?.toString() ?? '',
                                        style: const TextStyle(fontSize: 12, color: T.inkFaint), maxLines: 2, overflow: TextOverflow.ellipsis),
                                  ],
                                  const SizedBox(height: 8),
                                  Row(children: [
                                    TextButton.icon(
                                      onPressed: () => _reply(r),
                                      icon: const Icon(Icons.reply_outlined, size: 17),
                                      label: Text(tr('رد', 'Reply'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                                    ),
                                    const Spacer(),
                                    DropdownButton<String>(
                                      value: _reqStatuses.containsKey(r['status']) ? r['status'] : null,
                                      hint: Text(tr('الحالة', 'Status'), style: const TextStyle(fontSize: 12)),
                                      underline: const SizedBox.shrink(),
                                      style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.ink),
                                      items: _reqStatuses.entries
                                          .map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2))))
                                          .toList(),
                                      onChanged: (v) { if (v != null) _setStatus(r, v); },
                                    ),
                                  ]),
                                ]),
                              ),
                            );
                          },
                        ),
                ),
    );
  }
}
