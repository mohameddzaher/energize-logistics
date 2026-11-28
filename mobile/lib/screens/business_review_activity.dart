import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/export_sheet.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'business_review_kit.dart';
import 'business_review_meeting_depts.dart';
import 'ops_common.dart' show opsPickMonth;

/// Business review activity log: every update on any task, same API and filters as the web page.
/// Shown to the top roles and the software team, or to anyone given the page (meta.me.canSeeActivity).
class BrActivityTab extends StatefulWidget {
  final Map<String, dynamic> meta;
  const BrActivityTab({super.key, required this.meta});
  @override
  State<BrActivityTab> createState() => _BrActivityTabState();
}

String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class _BrActivityTabState extends State<BrActivityTab> {
  Map<String, dynamic>? _data;
  String? _error;
  int _seq = 0;
  String _q = '';
  String _section = '';
  String _dept = '';
  String _person = '';
  String _kind = '';
  String _period = 'week';
  late String _from = _ymd(DateTime.now().subtract(const Duration(days: 6)));
  late String _to = _ymd(DateTime.now());

  void _onLive() => _load();

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('br:action', _onLive);
    Live.instance.on('br:assignment', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('br:action', _onLive);
    Live.instance.off('br:assignment', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final my = ++_seq;
    try {
      final d = await Api.instance.get('/api/business-review/activity?from=$_from&to=$_to');
      if (!mounted || my != _seq) return;
      setState(() { _data = Map<String, dynamic>.from(d); _error = null; });
    } catch (e) {
      if (mounted && my == _seq) setState(() => _error = brErr(e));
    }
  }

  Future<void> _setPeriod(String k) async {
    final now = DateTime.now();
    if (k == 'month') {
      final m = await opsPickMonth(context, DateTime(now.year, now.month));
      if (m == null) return;
      _from = _ymd(DateTime(m.year, m.month, 1));
      _to = _ymd(DateTime(m.year, m.month + 1, 0));
    } else if (k == 'day') {
      final d = await showDatePicker(context: context, initialDate: now, firstDate: DateTime(now.year - 1), lastDate: now);
      if (d == null) return;
      _from = _ymd(d); _to = _ymd(d);
    } else if (k == 'range') {
      final r = await showDateRangePicker(context: context, firstDate: DateTime(now.year - 1), lastDate: now);
      if (r == null) return;
      _from = _ymd(r.start); _to = _ymd(r.end);
    } else {
      final days = switch (k) { 'today' => 0, 'yesterday' => 1, 'week' => 6, '90' => 89, _ => 29 };
      _from = _ymd(k == 'thismonth' ? DateTime(now.year, now.month, 1) : now.subtract(Duration(days: days)));
      _to = _ymd(k == 'yesterday' ? now.subtract(const Duration(days: 1)) : now);
    }
    setState(() => _period = k);
    _load();
  }

  List<Map<String, dynamic>> get _all => List<Map<String, dynamic>>.from(_data?['rows'] ?? const []);
  List<Map<String, dynamic>> get _rows {
    final n = _q.toLowerCase();
    return _all.where((r) {
      final t = Map<String, dynamic>.from(r['task'] ?? const {});
      if (_section.isNotEmpty && r['bySection'] != _section) return false;
      if (_dept.isNotEmpty && t['department'] != _dept) return false;
      if (_person.isNotEmpty && r['by'] != _person) return false;
      if (_kind.isNotEmpty && r['kind'] != _kind) return false;
      if (n.isNotEmpty && ![r['byName'], r['text'], t['title'], t['assigneeName'], (r['part'] ?? const {})['title']].any((x) => '${x ?? ''}'.toLowerCase().contains(n))) return false;
      return true;
    }).toList();
  }

  String _change(Map r) => '${r['statusTo'] ?? ''}'.isEmpty ? '' : '${'${r['statusFromAr'] ?? ''}'.isEmpty ? '—' : r['statusFromAr']} ← ${r['statusToAr']}';

  List<ExportCol> get _cols => [
        ExportCol('التاريخ والوقت', 'Date & time', (r) => brDateTime(r['at'])),
        ExportCol('الشخص', 'Person', (r) => r['byName']),
        ExportCol('صفته', 'Role', (r) => r['byRoleAr']),
        ExportCol('قسمه', 'His section', (r) => r['bySectionAr']),
        ExportCol('نوع التحديث', 'Update', (r) => r['kindAr']),
        ExportCol('تغيير الحالة', 'Status change', (r) => _change(r)),
        ExportCol('التفاصيل', 'Details', (r) => r['text']),
        ExportCol('المرفقات', 'Files', (r) => List<Map>.from(r['files'] ?? const []).map((f) => f['fileName']).join('، ')),
        ExportCol('البند', 'Task', (r) => r['task']?['title']),
        ExportCol('جزء الفريق', 'Team part', (r) => r['part'] == null ? '' : '${r['part']['title']} — ${r['part']['assigneeName']}'),
        ExportCol('قسم البند', 'Task department', (r) => r['task']?['departmentAr']),
        ExportCol('مسؤول البند', 'Task owner', (r) => r['task']?['assigneeName']),
        ExportCol('حالة البند الآن', 'Task status now', (r) => r['task']?['statusAr']),
        ExportCol('نسبة الإنجاز', 'Progress', (r) => '${r['task']?['progress'] ?? 0}%'),
        ExportCol('موعد التسليم', 'Due', (r) => brDate(r['task']?['dueDate'])),
        ExportCol('الاجتماع', 'Meeting', (r) => [r['task']?['meetingRef'], r['task']?['meetingTitle']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ')),
      ];

  List<(String, String)> _opts(String Function(Map) key, String Function(Map) label) {
    final m = <String, String>{};
    for (final r in _all) { final k = key(r); if (k.isNotEmpty) m[k] = label(r); }
    final out = m.entries.map((e) => (e.key, e.value)).toList()..sort((a, b) => a.$2.compareTo(b.$2));
    return out;
  }

  Widget _drop(String hint, String value, List<(String, String)> items, ValueChanged<String> onChanged) => DropdownButtonFormField<String>(
        initialValue: items.any((x) => x.$1 == value) ? value : '',
        isExpanded: true,
        decoration: InputDecoration(labelText: hint, isDense: true),
        items: [for (final x in items) DropdownMenuItem(value: x.$1, child: Text(x.$2, overflow: TextOverflow.ellipsis))],
        onChanged: (v) => setState(() => onChanged(v ?? '')),
      );

  @override
  Widget build(BuildContext context) {
    if (_data == null && _error == null) return const Center(child: CircularProgressIndicator());
    if (_data == null) return ErrorRetry(message: _error ?? '—', onRetry: _load);
    final rows = _rows;
    final kinds = Map<String, dynamic>.from(_data!['kinds'] ?? const {});
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(12), children: [
        Text(tr('كلُّ تحديثٍ على البنود: مَن حدّث، ومن أيّ قسم، وماذا غيّر، ومتى، وأين يقف البند الآن. اضغط أيَّ بطاقةٍ للتفاصيل وفتح البند.', 'Every update on tasks: who, section, what changed, when, and where the task stands now. Tap a card for details.'),
            style: const TextStyle(fontSize: 12, color: T.inkSoft)),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(child: StatCard(label: tr('التحديثات', 'Updates'), value: rows.length, color: T.orange, icon: Icons.history)),
          const SizedBox(width: 8),
          Expanded(child: StatCard(label: tr('تغييرات الحالة', 'Status changes'), value: rows.where((r) => '${r['statusTo'] ?? ''}'.isNotEmpty).length, color: T.info, icon: Icons.swap_horiz)),
          const SizedBox(width: 8),
          Expanded(child: StatCard(label: tr('الأشخاص', 'People'), value: rows.map((r) => r['by']).toSet().length, color: T.navy, icon: Icons.people_outline)),
        ]),
        const SizedBox(height: 10),
        SearchField(hint: tr('الشخص، البند، التفاصيل…', 'Person, task, details…'), onChanged: (v) => setState(() => _q = v.trim())),
        const SizedBox(height: 8),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final p in [('today', tr('اليوم', 'Today')), ('yesterday', tr('أمس', 'Yesterday')), ('week', tr('آخر 7 أيام', 'Last 7 days')), ('thismonth', tr('هذا الشهر', 'This month')), ('90', tr('آخر 90 يومًا', '90 days')), ('day', tr('يوم…', 'Day…')), ('month', tr('شهر…', 'Month…')), ('range', tr('فترة…', 'Range…'))])
            ChoiceChip(label: Text(p.$2), selected: _period == p.$1, onSelected: (_) => _setPeriod(p.$1)),
        ]),
        Padding(padding: const EdgeInsets.only(top: 6), child: Text('${tr('الفترة', 'Period')}: $_from → $_to', style: const TextStyle(fontSize: 12, color: T.inkSoft, fontWeight: FontWeight.w700))),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: _drop(tr('قسم الشخص', 'Person’s section'), _section, [('', tr('الكل', 'All')), ..._opts((r) => '${r['bySection'] ?? ''}', (r) => '${r['bySectionAr'] ?? ''}')], (v) => _section = v)),
          const SizedBox(width: 8),
          Expanded(child: _drop(tr('قسم البند', 'Task department'), _dept, [('', tr('الكل', 'All')), ..._opts((r) => '${r['task']?['department'] ?? ''}', (r) => '${r['task']?['departmentAr'] ?? ''}')], (v) => _dept = v)),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: _drop(tr('الشخص', 'Person'), _person, [('', tr('الكل', 'Everyone')), ..._opts((r) => '${r['by'] ?? ''}', (r) => '${r['byName'] ?? ''}')], (v) => _person = v)),
          const SizedBox(width: 8),
          Expanded(child: _drop(tr('نوع التحديث', 'Update'), _kind, [('', tr('الكل', 'All')), ...kinds.entries.map((e) => (e.key, '${e.value}'))], (v) => _kind = v)),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          Text(tr('${rows.length} تحديثًا', '${rows.length} updates'), style: const TextStyle(fontSize: 12, color: T.inkSoft, fontWeight: FontWeight.w700)),
          const Spacer(),
          Text(tr('المعروض', 'Shown'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
          ExportButton(fileName: 'business-review-activity', columns: _cols, rows: () => _rows, sheetName: tr('سجل التحديثات', 'Activity')),
          Text(tr('الكل', 'All'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
          ExportButton(fileName: 'business-review-activity-all', columns: _cols, rows: () => _all, sheetName: tr('سجل التحديثات', 'Activity')),
        ]),
        const SizedBox(height: 6),
        if (rows.isEmpty) EmptyState(icon: Icons.history, title: tr('لا تحديثاتَ في هذه الفترة أو بهذه الفلاتر', 'No updates for this period or filters')),
        for (final r in rows) _card(r),
      ]),
    );
  }

  Widget _line(String k, String v, {Color? color}) => v.trim().isEmpty ? const SizedBox.shrink() : Padding(
        padding: const EdgeInsets.only(top: 3),
        child: Text.rich(TextSpan(children: [
          TextSpan(text: '$k: ', style: const TextStyle(color: T.inkSoft, fontWeight: FontWeight.w600)),
          TextSpan(text: v, style: TextStyle(color: color ?? T.ink)),
        ]), style: const TextStyle(fontSize: 12.5)),
      );

  Widget _card(Map<String, dynamic> r) {
    final t = Map<String, dynamic>.from(r['task'] ?? const {});
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        onTap: () => _detail(r),
        child: AppCard(
        topAccent: r['statusTo'] == 'done' ? T.success : r['kind'] == 'postpone' ? T.warn : T.info,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text('${r['byName'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
            Text(brDateTime(r['at']), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
          ]),
          Text([r['byRoleAr'], r['bySectionAr']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            Chip2('${r['kindAr'] ?? ''}', T.navy),
            if (_change(r).isNotEmpty) Chip2(_change(r), T.info),
          ]),
          if ('${r['text'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text('${r['text']}', style: const TextStyle(fontSize: 13))),
          _line(tr('البند', 'Task'), '${t['title'] ?? ''}'),
          _line(tr('البند الآن', 'Task now'), '${t['statusAr'] ?? ''} · ${t['progress'] ?? 0}% · ${t['departmentAr'] ?? ''}'),
        ]),
      )),
    );
  }

  /// Full details of one update, with a button that opens the task in its meeting.
  void _detail(Map<String, dynamic> r) {
    final t = Map<String, dynamic>.from(r['task'] ?? const {});
    final files = List<Map>.from(r['files'] ?? const []);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(child: Padding(
        padding: const EdgeInsets.all(16),
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${t['title'] ?? ''}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
          const SizedBox(height: 8),
          _line(tr('الشخص', 'Person'), '${r['byName'] ?? ''}'),
          _line(tr('صفته وقسمه', 'Role & section'), [r['byRoleAr'], r['bySectionAr']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ')),
          _line(tr('التاريخ والوقت', 'When'), brDateTime(r['at'])),
          _line(tr('نوع التحديث', 'Update'), '${r['kindAr'] ?? ''}'),
          _line(tr('تغيير الحالة', 'Status change'), _change(r)),
          _line(tr('التفاصيل', 'Details'), '${r['text'] ?? ''}'),
          if (r['part'] != null) _line(tr('جزء الفريق', 'Team part'), '${r['part']['title']} — ${r['part']['assigneeName']}', color: T.violet),
          if (files.isNotEmpty) _line(tr('المرفقات', 'Files'), files.map((f) => f['fileName']).join('، ')),
          const Divider(height: 20),
          _line(tr('قسم البند', 'Task department'), '${t['departmentAr'] ?? ''}'),
          _line(tr('مسؤول البند', 'Task owner'), '${t['assigneeName'] ?? ''}'),
          _line(tr('حالة البند الآن', 'Task status now'), '${t['statusAr'] ?? ''} · ${t['progress'] ?? 0}%'),
          _line(tr('موعد التسليم', 'Due'), brDate(t['dueDate']), color: t['overdue'] == true ? T.danger : null),
          _line(tr('الاجتماع', 'Meeting'), [t['meetingRef'], t['meetingTitle']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ')),
          if (t['archived'] == true) _line(tr('الأرشيف', 'Archive'), tr('البند في الأرشيف', 'The task is archived')),
          const SizedBox(height: 14),
          if ('${t['meeting'] ?? ''}'.isNotEmpty && t['archived'] != true)
            SizedBox(width: double.infinity, child: FilledButton.icon(
              icon: const Icon(Icons.open_in_new, size: 18),
              label: Text(tr('فتح البند', 'Open task')),
              onPressed: () {
                Navigator.pop(c);
                Navigator.of(context).push(MaterialPageRoute(builder: (_) => Scaffold(
                  appBar: AppBar(title: Text('${t['title'] ?? ''}')),
                  body: BrMeetingDepartmentsTab(meetingId: '${t['meeting']}', meta: widget.meta, initialDept: '${t['department'] ?? ''}', initialTask: '${t['_id']}'),
                )));
              },
            )),
        ])),
      )),
    );
  }
}
