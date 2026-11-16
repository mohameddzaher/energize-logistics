import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/export_sheet.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'business_review_kit.dart';
import 'ops_common.dart' show opsPickMonth;

/// Business review archive: tasks finished more than a day ago, out of the meetings. Same API and filters as the web page.
class BrArchiveTab extends StatefulWidget {
  final Map<String, dynamic> meta;
  const BrArchiveTab({super.key, required this.meta});
  @override
  State<BrArchiveTab> createState() => _BrArchiveTabState();
}

String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class _BrArchiveTabState extends State<BrArchiveTab> {
  Map<String, dynamic>? _data;
  String? _error;
  int _seq = 0;
  String _q = '';
  String _department = '';
  String _assignee = '';
  String _status = '';
  String _timing = '';
  String _dateBy = 'closed';
  String _period = 'all';
  String _from = '';
  String _to = '';

  void _onLive() => _load();

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('br:action', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('br:action', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final my = ++_seq;
    final qs = <String>[
      'dateBy=$_dateBy',
      if (_from.isNotEmpty) 'from=$_from',
      if (_to.isNotEmpty) 'to=$_to',
      if (_department.isNotEmpty) 'department=${Uri.encodeQueryComponent(_department)}',
      if (_assignee.isNotEmpty) 'assignee=$_assignee',
      if (_status.isNotEmpty) 'status=$_status',
      if (_q.isNotEmpty) 'q=${Uri.encodeQueryComponent(_q)}',
    ].join('&');
    try {
      final d = await Api.instance.get('/api/business-review/archive?$qs');
      if (!mounted || my != _seq) return;
      setState(() { _data = Map<String, dynamic>.from(d); _error = null; });
    } catch (e) {
      if (mounted && my == _seq) setState(() => _error = e.toString());
    }
  }

  Future<void> _setPeriod(String k) async {
    final now = DateTime.now();
    if (k == 'month') {
      final m = await opsPickMonth(context, DateTime(now.year, now.month));
      if (m == null) return;
      _from = _ymd(DateTime(m.year, m.month, 1));
      _to = _ymd(DateTime(m.year, m.month + 1, 0));
    } else {
      _from = k == 'today' ? _ymd(now) : k == 'week' ? _ymd(now.subtract(const Duration(days: 6))) : '';
      _to = k == 'all' ? '' : _ymd(now);
    }
    setState(() => _period = k);
    _load();
  }

  String _timingLabel(String x) => switch (x) { 'ontime' => tr('في الموعد', 'On time'), 'late' => tr('بعد الموعد', 'Late'), 'nodue' => tr('بلا موعد', 'No due date'), _ => '' };
  String _cadence(String c) => c.isEmpty ? '' : brVocab(widget.meta['cadences'] as List?, c).label;

  List<Map<String, dynamic>> get _rows => List<Map<String, dynamic>>.from(_data?['items'] ?? const [])
      .where((r) => _timing.isEmpty || r['timing'] == _timing).toList();

  List<ExportCol> get _cols => [
        ExportCol('البند', 'Task', (r) => r['title']),
        ExportCol('القسم', 'Department', (r) => brDept(context, '${r['department'] ?? ''}')),
        ExportCol('المسؤول', 'Owner', (r) => r['assigneeName']),
        ExportCol('بمشاركة', 'Shared with', (r) => List.from(r['sharedWith'] ?? const []).join('، ')),
        ExportCol('مُسند لفريقه', 'Delegated to', (r) => List.from(r['delegatedTo'] ?? const []).join('، ')),
        ExportCol('أسندها', 'Assigned by', (r) => r['assignedByName']),
        ExportCol('طلبها', 'Requested by', (r) => r['raisedByName']),
        ExportCol('الاجتماع', 'Meeting', (r) => [_cadence('${r['meetingCadence'] ?? ''}'), r['meetingRef'], r['meetingTitle']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ')),
        ExportCol('تاريخ الاجتماع', 'Meeting date', (r) => brDate(r['meetingDate'])),
        ExportCol('أُسند في', 'Assigned at', (r) => brDateTime(r['assignedAt'])),
        ExportCol('موعد التسليم', 'Due', (r) => brDate(r['dueDate'])),
        ExportCol('الموعد الأصلي', 'Original due', (r) => brDate(r['originalDueDate'])),
        ExportCol('تم الإنجاز / الإلغاء', 'Closed at', (r) => brDateTime(r['closedAt'])),
        ExportCol('الحالة', 'Status', (r) => brVocab(widget.meta['actionStatuses'] as List?, '${r['status']}').label),
        ExportCol('الالتزام بالموعد', 'Timing', (r) => _timingLabel('${r['timing'] ?? ''}')),
        ExportCol('المدة (يوم)', 'Days', (r) => r['days']),
        ExportCol('آخر تحديث', 'Last update', (r) => r['lastUpdate'] is Map ? r['lastUpdate']['text'] : ''),
      ];

  Widget _drop(String hint, String value, List<(String, String)> items, ValueChanged<String> onChanged) => DropdownButtonFormField<String>(
        initialValue: items.any((x) => x.$1 == value) ? value : '',
        isExpanded: true,
        decoration: InputDecoration(labelText: hint, isDense: true),
        items: [for (final x in items) DropdownMenuItem(value: x.$1, child: Text(x.$2, overflow: TextOverflow.ellipsis))],
        onChanged: (v) { onChanged(v ?? ''); _load(); },
      );

  @override
  Widget build(BuildContext context) {
    if (_data == null && _error == null) return const Center(child: CircularProgressIndicator());
    if (_data == null) return ErrorRetry(message: _error ?? '—', onRetry: _load);
    final tot = Map<String, dynamic>.from(_data!['totals'] ?? const {});
    final opts = Map<String, dynamic>.from(_data!['options'] ?? const {});
    final rows = _rows;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(12), children: [
        Text(tr('كلُّ بندٍ تمّ إنجازه (أو أُلغي) ومضى عليه يوم يخرج من الاجتماعات ويُحفظ هنا.', 'Tasks done (or cancelled) for more than a day leave the meetings and are kept here.'),
            style: const TextStyle(fontSize: 12, color: T.inkSoft)),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(child: StatCard(label: tr('المؤرشف', 'Archived'), value: (tot['total'] ?? 0) as num, color: T.orange, icon: Icons.archive_outlined)),
          const SizedBox(width: 8),
          Expanded(child: StatCard(label: tr('في الموعد', 'On time'), value: (tot['onTime'] ?? 0) as num, color: T.success, icon: Icons.check_circle_outline)),
          const SizedBox(width: 8),
          Expanded(child: StatCard(label: tr('بعد الموعد', 'Late'), value: (tot['late'] ?? 0) as num, color: T.danger, icon: Icons.alarm)),
        ]),
        const SizedBox(height: 10),
        SearchField(hint: tr('البند، المسؤول، الاجتماع…', 'Task, owner, meeting…'), onChanged: (v) { _q = v.trim(); _load(); }),
        const SizedBox(height: 8),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final p in [('all', tr('الكل', 'All')), ('today', tr('اليوم', 'Today')), ('week', tr('آخر 7 أيام', 'Last 7 days')), ('month', tr('شهر…', 'Month…'))])
            ChoiceChip(label: Text(p.$1 == 'month' && _period == 'month' ? '${p.$2} ${_from.substring(0, 7)}' : p.$2), selected: _period == p.$1, onSelected: (_) => _setPeriod(p.$1)),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: _drop(tr('الفترة حسب', 'Period by'), _dateBy, [('closed', tr('تاريخ الإنجاز', 'Closing date')), ('assigned', tr('تاريخ الإسناد', 'Assignment date')), ('due', tr('موعد التسليم', 'Due date'))], (v) => _dateBy = v.isEmpty ? 'closed' : v)),
          const SizedBox(width: 8),
          Expanded(child: _drop(tr('القسم', 'Department'), _department, [('', tr('كل الأقسام', 'All')), ...List.from(opts['departments'] ?? const []).map((d) => ('$d', brDept(context, '$d')))], (v) => _department = v)),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: _drop(tr('الشخص', 'Person'), _assignee, [('', tr('الكل', 'Everyone')), ...List<Map>.from(opts['people'] ?? const []).map((p) => ('${p['_id']}', '${p['name']}'))], (v) => _assignee = v)),
          const SizedBox(width: 8),
          Expanded(child: _drop(tr('الحالة', 'Status'), _status, [('', tr('الكل', 'All')), ('done', brVocab(widget.meta['actionStatuses'] as List?, 'done').label), ('cancelled', brVocab(widget.meta['actionStatuses'] as List?, 'cancelled').label)], (v) => _status = v)),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: _drop(tr('الالتزام بالموعد', 'Timing'), _timing, [('', tr('الكل', 'All')), ('ontime', _timingLabel('ontime')), ('late', _timingLabel('late')), ('nodue', _timingLabel('nodue'))], (v) => setState(() => _timing = v))),
          const SizedBox(width: 8),
          ExportButton(fileName: 'business-review-archive', columns: _cols, rows: () => _rows, sheetName: tr('الأرشيف', 'Archive')),
        ]),
        const SizedBox(height: 10),
        Text(tr('${rows.length} بندًا', '${rows.length} tasks'), style: const TextStyle(fontSize: 12, color: T.inkSoft, fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        if (rows.isEmpty) EmptyState(icon: Icons.archive_outlined, title: tr('لا بنود في الأرشيف بهذه الفلاتر', 'No archived tasks for these filters')),
        for (final r in rows) _card(r),
      ]),
    );
  }

  Widget _card(Map<String, dynamic> r) {
    final st = brVocab(widget.meta['actionStatuses'] as List?, '${r['status']}');
    final timing = '${r['timing'] ?? ''}';
    final shared = List.from(r['sharedWith'] ?? const []);
    Widget line(String k, String v, {Color? color}) => v.trim().isEmpty ? const SizedBox.shrink() : Padding(
          padding: const EdgeInsets.only(top: 3),
          child: Text.rich(TextSpan(children: [
            TextSpan(text: '$k: ', style: const TextStyle(color: T.inkSoft, fontWeight: FontWeight.w600)),
            TextSpan(text: v, style: TextStyle(color: color ?? T.ink)),
          ]), style: const TextStyle(fontSize: 12.5)),
        );
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        topAccent: r['status'] == 'done' ? T.success : T.inkFaint,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${r['title']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            Chip2(st.label, st.color),
            if (timing.isNotEmpty) Chip2(_timingLabel(timing), timing == 'late' ? T.danger : timing == 'ontime' ? T.success : T.inkFaint),
            Chip2(brDept(context, '${r['department'] ?? ''}'), T.navy),
          ]),
          const SizedBox(height: 4),
          line(tr('المسؤول', 'Owner'), '${r['assigneeName'] ?? ''}'),
          if (shared.isNotEmpty) line(tr('بمشاركة', 'Shared with'), shared.join('، '), color: T.info),
          line(tr('مُسند لفريقه', 'Delegated to'), List.from(r['delegatedTo'] ?? const []).join('، ')),
          line(tr('أسندها', 'Assigned by'), '${r['assignedByName'] ?? ''}'),
          line(tr('طلبها', 'Requested by'), '${r['raisedByName'] ?? ''}'),
          line(tr('الاجتماع', 'Meeting'), [_cadence('${r['meetingCadence'] ?? ''}'), '${r['meetingRef'] ?? ''}', brDate(r['meetingDate'])].where((x) => x.isNotEmpty && x != '—').join(' · ')),
          line(tr('أُسند في', 'Assigned at'), brDateTime(r['assignedAt'])),
          line(tr('موعد التسليم', 'Due'), '${brDate(r['dueDate'])}${(r['postponeCount'] ?? 0) > 0 ? ' (${tr('أُجِّل', 'postponed')} ${r['postponeCount']}×)' : ''}'),
          line(r['status'] == 'done' ? tr('تم الإنجاز', 'Done at') : tr('أُلغي في', 'Cancelled at'), brDateTime(r['closedAt'])),
          if (r['days'] != null) line(tr('المدة', 'Duration'), '${r['days']} ${tr('يوم', 'days')}'),
          if (r['lastUpdate'] is Map) line(tr('آخر تحديث', 'Last update'), '${r['lastUpdate']['text'] ?? ''}'),
        ]),
      ),
    );
  }
}
