import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// سجلُّ التدقيق — نظيرُ /system/audit في الويب.
///
/// السجلُّ عشراتُ الآلاف من القيود، فالفلترةُ والترقيمُ عند الخادم: القسم ثمّ
/// الكيانُ داخله ثمّ الفعلُ داخله، والشخص، والفرع، ويومٌ واحد أو مدّة. وقوائمُ
/// الخيارات (/api/audit/options) تُعاد مع كلّ فلترٍ فتعدّ ما تحت الفلاتر الأخرى.
/// والتصديرُ: الصفحةُ الحاضرة أو كلُّ ما يطابق (يُجلَب بحدٍّ مفتوح).
const _pageSize = 25;

String _companyDay([int offset = 0]) {
  // اليومُ بتوقيت الرياض (+3) لا بساعة الجهاز — هو الذي يقطع به الخادم.
  final now = DateTime.now().toUtc().add(const Duration(hours: 3));
  final d = DateTime.utc(now.year, now.month, now.day).subtract(Duration(days: offset));
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

class AdminAuditScreen extends StatefulWidget {
  const AdminAuditScreen({super.key});
  @override
  State<AdminAuditScreen> createState() => _AdminAuditScreenState();
}

class _AdminAuditScreenState extends State<AdminAuditScreen> {
  List<Map<String, dynamic>> _logs = [];
  Map<String, dynamic> _opts = const {};
  bool _loading = true;
  String? _error;
  int _page = 1, _pages = 0, _total = 0, _seq = 0, _optSeq = 0;
  String _section = '', _entity = '', _user = '', _branch = '', _action = '';
  String _mode = 'day', _day = '', _from = '', _to = '';
  final Set<String> _expanded = {};

  @override
  void initState() { super.initState(); _refresh(); }

  String _params() {
    final p = <String, String>{
      'lang': Lang.instance.ar ? 'ar' : 'en',
      if (_entity.isNotEmpty) 'entity': _entity,
      if (_section.isNotEmpty) 'section': _section,
      if (_user.isNotEmpty) 'user': _user,
      if (_branch.isNotEmpty) 'branch': _branch,
      if (_action.isNotEmpty) 'action': _action,
      if (_mode == 'day' && _day.isNotEmpty) 'date': _day,
      if (_mode == 'range' && _from.isNotEmpty) 'dateFrom': _from,
      if (_mode == 'range' && _to.isNotEmpty) 'dateTo': _to,
    };
    return p.entries.map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&');
  }

  bool get _hasFilters => [_entity, _section, _user, _branch, _action].any((x) => x.isNotEmpty) || (_mode == 'day' ? _day.isNotEmpty : (_from.isNotEmpty || _to.isNotEmpty));

  void _refresh() { _loadOptions(); _load(1); }

  Future<void> _loadOptions() async {
    final mine = ++_optSeq;
    try {
      final d = await Api.instance.get('/api/audit/options?${_params()}');
      if (mounted && mine == _optSeq) setState(() => _opts = Map<String, dynamic>.from(d));
    } catch (_) {/* تبقى القوائمُ على آخر ما وصل */}
  }

  Future<void> _load(int page) async {
    final mine = ++_seq;
    setState(() => _loading = true);
    try {
      final d = await Api.instance.get('/api/audit?${_params()}&page=$page&limit=$_pageSize');
      if (!mounted || mine != _seq) return;
      setState(() {
        _logs = List<Map<String, dynamic>>.from((d['logs'] ?? const []).map((e) => Map<String, dynamic>.from(e)));
        _page = (d['page'] as num?)?.toInt() ?? page;
        _pages = (d['pages'] as num?)?.toInt() ?? 0;
        _total = (d['total'] as num?)?.toInt() ?? 0;
        _loading = false; _error = null; _expanded.clear();
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  List<Map<String, dynamic>> _opt(String k) => List<Map<String, dynamic>>.from((_opts[k] ?? const []).map((e) => Map<String, dynamic>.from(e)));

  void _set(VoidCallback f) { setState(f); _refresh(); }

  String _actor(Map<String, dynamic> l) {
    final u = l['user'];
    if (u is Map) return '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim();
    return (l['userName'] ?? tr('النظام', 'System')).toString();
  }

  String _when(dynamic v) {
    final d = DateTime.tryParse('${v ?? ''}');
    if (d == null) return '';
    final r = d.toUtc().add(const Duration(hours: 3));
    String two(int n) => n.toString().padLeft(2, '0');
    return '${r.year}-${two(r.month)}-${two(r.day)} ${two(r.hour)}:${two(r.minute)}';
  }

  late final _cols = [
    ExportCol('التاريخ', 'Date', (l) => _when(l['createdAt'])),
    ExportCol('المستخدم', 'User', (l) => _actor(l)),
    ExportCol('البريد', 'Email', (l) => l['user'] is Map ? l['user']['email'] : ''),
    ExportCol('الإجراء', 'Action', (l) => l['actionLabel'] ?? l['action']),
    ExportCol('القسم', 'Section', (l) => l['sectionLabel']),
    ExportCol('الكيان', 'Entity', (l) => l['entityLabel'] ?? l['entity']),
    ExportCol('السجل', 'Record', (l) => l['subject']),
    ExportCol('التفاصيل', 'Details', (l) => l['summary']),
    ExportCol('عنوان IP', 'IP address', (l) => l['ipAddress']),
  ];

  Future<void> _export() async {
    final pick = await showModalBottomSheet<String>(
      context: context, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(leading: const Icon(Icons.description_outlined), title: Text(tr('هذه الصفحة', 'This page')), onTap: () => Navigator.pop(c, 'page')),
        ListTile(leading: const Icon(Icons.filter_alt_outlined), title: Text(_hasFilters ? tr('كلُّ ما يطابق الفلاتر', 'All matching') : tr('الكلّ', 'All')), trailing: Text('$_total'), onTap: () => Navigator.pop(c, 'matching')),
        if (_hasFilters) ListTile(leading: const Icon(Icons.all_inclusive), title: Text(tr('السجلّ كاملًا', 'Everything')), onTap: () => Navigator.pop(c, 'all')),
      ])),
    );
    if (pick == null || !mounted) return;
    var rows = _logs;
    if (pick != 'page') {
      try {
        final q = pick == 'matching' ? _params() : 'lang=${Lang.instance.ar ? 'ar' : 'en'}';
        final d = await Api.instance.get('/api/audit?$q&page=1&limit=100000');
        rows = List<Map<String, dynamic>>.from((d['logs'] ?? const []).map((e) => Map<String, dynamic>.from(e)));
      } catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
        return;
      }
    }
    if (!mounted) return;
    if (rows.isEmpty) { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('لا صفوف للتصدير', 'Nothing to export')))); return; }
    await exportExcel(context, fileName: 'audit-log', sheets: [(tr('سجل التدقيق', 'Audit Log'), _cols, rows)]);
  }

  Future<void> _pickDate({required bool range}) async {
    if (range) {
      final r = await showDateRangePicker(context: context, firstDate: DateTime(2023), lastDate: DateTime.now().add(const Duration(days: 1)));
      if (r == null) return;
      String f(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
      _set(() { _mode = 'range'; _from = f(r.start); _to = f(r.end); });
    } else {
      final d = await showDatePicker(context: context, firstDate: DateTime(2023), lastDate: DateTime.now().add(const Duration(days: 1)), initialDate: DateTime.tryParse(_day) ?? DateTime.now());
      if (d == null) return;
      _set(() { _mode = 'day'; _day = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}'; });
    }
  }

  Widget _drop(String label, String value, List<(String, String)> items, void Function(String) on) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: DropdownButtonFormField<String>(
      initialValue: items.any((x) => x.$1 == value) ? value : '', isExpanded: true,
      decoration: InputDecoration(isDense: true, labelText: label, border: const OutlineInputBorder()),
      items: [for (final x in items) DropdownMenuItem(value: x.$1, child: Text(x.$2, overflow: TextOverflow.ellipsis))],
      onChanged: (v) => on(v ?? ''),
    ),
  );

  Future<void> _filtersSheet() async {
    await showModalBottomSheet<void>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => StatefulBuilder(builder: (c, set) {
        void upd(VoidCallback f) { _set(f); set(() {}); }
        final sections = _opt('sections');
        final entities = _opt('entities').where((e) => _section.isEmpty || e['section'] == _section).toList();
        final users = _opt('users');
        final branches = _opt('branches');
        final actions = _opt('actions');
        return Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(child: Text(tr('الفلاتر', 'Filters'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
              if (_hasFilters) TextButton(onPressed: () => upd(() { _entity = _section = _user = _branch = _action = _day = _from = _to = ''; }), child: Text(tr('مسح الكل', 'Clear all'))),
            ]),
            const SizedBox(height: 8),
            _drop(tr('القسم', 'Section'), _section, [
              ('', tr('كل الأقسام', 'All sections')),
              for (final s in sections) ('${s['key']}', '${tr('${s['ar'] ?? s['key']}', '${s['en'] ?? s['key']}')} (${s['count'] ?? 0})'),
            ], (v) => upd(() {
              _section = v;
              if (_entity.isNotEmpty && v.isNotEmpty && _opt('entities').firstWhere((e) => e['key'] == _entity, orElse: () => const {})['section'] != v) _entity = '';
              _action = '';
            })),
            _drop(tr('الكيان', 'Entity'), _entity, [
              ('', tr('كل الكيانات', 'All entities')),
              for (final e in entities) ('${e['key']}', '${e['label'] ?? e['key']} (${e['count'] ?? 0})'),
            ], (v) => upd(() { _entity = v; _action = ''; })),
            _drop(tr('الإجراء', 'Action'), _action, [
              ('', tr('كل الإجراءات', 'All actions')),
              for (final a in actions) ('${a['key']}', '${a['label'] ?? a['key']} (${a['count'] ?? 0})'),
            ], (v) => upd(() => _action = v)),
            _drop(tr('المستخدم', 'User'), _user, [
              ('', tr('كل المستخدمين', 'All users')),
              for (final u in users) ('${u['_id']}', '${'${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim()}${u['deleted'] == true ? tr(' (محذوف)', ' (deleted)') : ''} (${u['count'] ?? 0})'),
              if ((_opts['systemCount'] ?? 0) != 0 || _user == 'system') ('system', '${tr('النظام (إجراءات تلقائية)', 'System (automatic)')} (${_opts['systemCount'] ?? 0})'),
              if ((_opts['unnamedCount'] ?? 0) != 0 || _user == 'unnamed') ('unnamed', '${tr('حسابات محذوفة لم يُسجَّل اسمها', 'Deleted accounts with no recorded name')} (${_opts['unnamedCount'] ?? 0})'),
            ], (v) => upd(() => _user = v)),
            if (branches.isNotEmpty) _drop(tr('الفرع', 'Branch'), _branch, [
              ('', tr('كل الفروع', 'All branches')),
              for (final b in branches) ('${b['_id']}', '${b['name'] ?? ''}'),
            ], (v) => upd(() => _branch = v)),
            const SizedBox(height: 4),
            Text(tr('التاريخ', 'Date'), style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 6, children: [
              ChoiceChip(label: Text(tr('اليوم', 'Today')), selected: _mode == 'day' && _day == _companyDay(), onSelected: (_) => upd(() { _mode = 'day'; _day = _companyDay(); })),
              ChoiceChip(label: Text(tr('أمس', 'Yesterday')), selected: _mode == 'day' && _day == _companyDay(1), onSelected: (_) => upd(() { _mode = 'day'; _day = _companyDay(1); })),
              ChoiceChip(label: Text(tr('آخر 7 أيام', 'Last 7 days')), selected: _mode == 'range' && _from == _companyDay(6) && _to == _companyDay(), onSelected: (_) => upd(() { _mode = 'range'; _from = _companyDay(6); _to = _companyDay(); })),
              ChoiceChip(label: Text(tr('آخر 30 يومًا', 'Last 30 days')), selected: _mode == 'range' && _from == _companyDay(29) && _to == _companyDay(), onSelected: (_) => upd(() { _mode = 'range'; _from = _companyDay(29); _to = _companyDay(); })),
              ActionChip(avatar: const Icon(Icons.event, size: 16), label: Text(_mode == 'day' && _day.isNotEmpty ? _day : tr('يوم…', 'Day…')), onPressed: () async { await _pickDate(range: false); set(() {}); }),
              ActionChip(avatar: const Icon(Icons.date_range, size: 16), label: Text(_mode == 'range' && _from.isNotEmpty ? '$_from → $_to' : tr('فترة…', 'Range…')), onPressed: () async { await _pickDate(range: true); set(() {}); }),
              if (_day.isNotEmpty || _from.isNotEmpty) ActionChip(label: Text(tr('كل الوقت', 'All time')), onPressed: () => upd(() { _day = _from = _to = ''; })),
            ]),
            const SizedBox(height: 14),
            FilledButton(onPressed: () => Navigator.pop(c), child: Text(tr('عرض $_total قيدًا', 'Show $_total entries'))),
          ])),
        );
      }),
    );
  }

  Widget _detail(Map<String, dynamic> l) {
    final d = Map<String, dynamic>.from(l['detail'] ?? const {});
    final rows = List<Map<String, dynamic>>.from((d['rows'] ?? const []).map((e) => Map<String, dynamic>.from(e)));
    if (rows.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (final r in rows) Padding(
          padding: const EdgeInsets.only(bottom: 4),
          child: r['kind'] == 'changed'
              ? Text.rich(TextSpan(children: [
                  TextSpan(text: '${r['label']}: ', style: const TextStyle(fontWeight: FontWeight.w700)),
                  TextSpan(text: '${r['before'] ?? '—'}', style: const TextStyle(color: T.danger, decoration: TextDecoration.lineThrough)),
                  const TextSpan(text: '  →  '),
                  TextSpan(text: '${r['after'] ?? '—'}', style: const TextStyle(color: T.success, fontWeight: FontWeight.w700)),
                ]), style: const TextStyle(fontSize: 12))
              : Text('${r['label'] ?? ''}: ${r['text'] ?? r['after'] ?? ''}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
        ),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final active = [_section, _entity, _user, _branch, _action].where((x) => x.isNotEmpty).length + ((_mode == 'day' ? _day.isNotEmpty : _from.isNotEmpty) ? 1 : 0);
    return AppScaffold(
      title: Text(tr('سجل التدقيق', 'Audit Log')),
      actions: [
        IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), onPressed: _export, icon: const Icon(Icons.file_download_outlined)),
        IconButton(
          tooltip: tr('الفلاتر', 'Filters'), onPressed: _filtersSheet,
          icon: Badge(isLabelVisible: active > 0, label: Text('$active'), child: const Icon(Icons.filter_list)),
        ),
      ],
      body: _error != null && _logs.isEmpty
          ? ErrorRetry(message: _error!, onRetry: _refresh)
          : Column(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
                child: Row(children: [
                  Expanded(child: Text(tr('$_total قيد', '$_total entries'), style: const TextStyle(fontWeight: FontWeight.w700, color: T.inkSoft))),
                  if (_loading) const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                ]),
              ),
              Expanded(child: RefreshIndicator(
                onRefresh: () => _load(_page),
                child: _logs.isEmpty && !_loading
                    ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.fact_check_outlined, title: tr('لا قيود', 'No entries'))])
                    : ListView.separated(
                        padding: const EdgeInsets.fromLTRB(14, 6, 14, 14),
                        itemCount: _logs.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (c, i) {
                          final l = _logs[i];
                          final id = '${l['_id']}';
                          final open = _expanded.contains(id);
                          return Pressable(
                            onTap: l['hasDetails'] == true ? () => setState(() => open ? _expanded.remove(id) : _expanded.add(id)) : null,
                            child: AppCard(
                              padding: const EdgeInsets.all(12),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Row(children: [
                                  Expanded(child: Text('${l['actionLabel'] ?? l['action'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                  if (l['hasDetails'] == true) Icon(open ? Icons.expand_less : Icons.expand_more, size: 20, color: T.inkFaint),
                                ]),
                                if ('${l['subject'] ?? ''}'.isNotEmpty) Text('${l['subject']}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: T.navy)),
                                if ('${l['summary'] ?? ''}'.isNotEmpty) Padding(
                                  padding: const EdgeInsets.only(top: 3),
                                  child: Text('${l['summary']}', maxLines: open ? null : 3, overflow: open ? null : TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                                ),
                                const SizedBox(height: 6),
                                Wrap(spacing: 6, runSpacing: 4, children: [
                                  InkWell(
                                    onTap: l['user'] is Map ? () => _set(() => _user = '${l['user']['_id']}') : null,
                                    child: Chip2(_actor(l), T.navy, icon: Icons.person_outline),
                                  ),
                                  if ('${l['sectionLabel'] ?? ''}'.isNotEmpty) Chip2('${l['sectionLabel']}', T.orange),
                                  if ('${l['entityLabel'] ?? ''}'.isNotEmpty) Chip2('${l['entityLabel']}', T.inkSoft),
                                  Chip2(_when(l['createdAt']), T.inkFaint, icon: Icons.schedule),
                                ]),
                                if (open) _detail(l),
                              ]),
                            ),
                          );
                        },
                      ),
              )),
              if (_pages > 1) SafeArea(top: false, child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 4, 14, 8),
                child: Row(children: [
                  IconButton(onPressed: _page <= 1 || _loading ? null : () => _load(_page - 1), icon: const Icon(Icons.chevron_left)),
                  Expanded(child: Text(tr('صفحة $_page من $_pages', 'Page $_page of $_pages'), textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700))),
                  IconButton(onPressed: _page >= _pages || _loading ? null : () => _load(_page + 1), icon: const Icon(Icons.chevron_right)),
                ]),
              )),
            ]),
    );
  }
}
