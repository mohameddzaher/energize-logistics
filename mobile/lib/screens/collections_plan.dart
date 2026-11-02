import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../resource/configs.dart' show collectionsCanEdit;
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'collections_party.dart';

/// Daily plan: "whom do I visit today, and what happened" (like the web page /system/collections-dept/plan). The unit is (customer by day): the plan is written, then after the action what happened and how much was collected is written.
class CollectionsPlanScreen extends StatefulWidget {
  const CollectionsPlanScreen({super.key});
  @override
  State<CollectionsPlanScreen> createState() => _CollectionsPlanScreenState();
}

const _requestTypes = [
  ('Visit', 'زيارة', 'Visit'),
  ('Office', 'زيارة مكتب', 'Office'),
  ('Call', 'اتصال', 'Call'),
  ('Email', 'بريد', 'Email'),
  ('Delivery', 'تسليم فاتورة', 'Delivery'),
];

String _ymd(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
DateTime _today() { final n = DateTime.now(); return DateTime(n.year, n.month, n.day); }
String _m(dynamic n) {
  final v = (n is num) ? n : num.tryParse('$n') ?? 0;
  return v.round().toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');
}

/// The range as a word, not two dates; the two dates remain for whoever wants a specific period.
final _presets = <(String, String, String, (DateTime, DateTime) Function())>[
  ('today', 'اليوم', 'Today', () => (_today(), _today())),
  ('yesterday', 'أمس', 'Yesterday', () { final y = _today().subtract(const Duration(days: 1)); return (y, y); }),
  // The week starts on Saturday.
  ('week', 'هذا الأسبوع', 'This week', () { final t = _today(); final back = (t.weekday % 7 + 1) % 7; return (t.subtract(Duration(days: back)), t); }),
  ('month', 'هذا الشهر', 'This month', () { final t = _today(); return (DateTime(t.year, t.month, 1), t); }),
  ('lastMonth', 'الشهر الماضي', 'Last month', () { final t = _today(); return (DateTime(t.year, t.month - 1, 1), DateTime(t.year, t.month, 0)); }),
];

class _CollectionsPlanScreenState extends State<CollectionsPlanScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  bool _busy = false;
  String? _error;
  late String _from = _ymd(_today().subtract(const Duration(days: 7)));
  late String _to = _ymd(_today().add(const Duration(days: 7)));
  String _preset = 'week';
  String _officer = '';
  List<String> _officers = [];
  num _collected = 0;
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load();
    Api.instance.get('/api/collections-dept/ledger/team').then((d) {
      if (!mounted) return;
      setState(() => _officers = [for (final o in (d['officers'] as List? ?? const [])) if ('${(o as Map)['officer'] ?? ''}'.isNotEmpty) '${o['officer']}']);
    }).catchError((_) {});
  }

  Future<void> _load() async {
    final mine = ++_seq;
    setState(() => _busy = true);
    try {
      final p = [
        if (_from.isNotEmpty) 'from=$_from',
        if (_to.isNotEmpty) 'to=$_to',
        if (_officer.isNotEmpty) 'officer=${Uri.encodeQueryComponent(_officer)}',
        'limit=500',
      ].join('&');
      final d = await Api.instance.get('/api/collections-dept/ledger/tasks?$p');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['rows'] ?? const []);
        _collected = (d['collected'] as num?) ?? 0;
        _loading = false; _busy = false; _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _busy = false; _error = e.toString(); });
    }
  }

  void _toast(String s, {bool err = false}) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s), backgroundColor: err ? T.danger : null));

  String get _myName => context.read<AuthProvider>().fullName;

  Future<void> _pickDate(bool from) async {
    final cur = DateTime.tryParse(from ? _from : _to) ?? _today();
    final v = await showDatePicker(context: context, initialDate: cur, firstDate: DateTime(2020), lastDate: DateTime(2035));
    if (v == null) return;
    setState(() { if (from) { _from = _ymd(v); } else { _to = _ymd(v); } _preset = ''; });
    _load();
  }

  Future<void> _mark(Map<String, dynamic> t, Map<String, dynamic> patch) async {
    try { await Api.instance.put('/api/collections-dept/ledger/tasks/${t['_id']}', patch); _load(); }
    catch (e) { _toast('$e', err: true); }
  }

  Future<void> _remove(Map<String, dynamic> t) async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('حذف المهمة؟', 'Delete task?')),
      content: Text('${t['partyName'] ?? ''} · ${t['date'] ?? ''}'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok != true) return;
    try { await Api.instance.delete('/api/collections-dept/ledger/tasks/${t['_id']}'); _load(); }
    catch (e) { _toast('$e', err: true); }
  }

  /// "What happened": saving marks it done, since writing what happened means it happened.
  Future<void> _openLog(Map<String, dynamic> t) async {
    final action = TextEditingController(text: '${t['action'] ?? ''}');
    final collected = TextEditingController(text: (t['collected'] is num && t['collected'] != 0) ? '${t['collected']}' : '');
    final notes = TextEditingController(text: '${t['notes'] ?? ''}');
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text('${tr('ما حدث مع ', 'What happened — ')}${t['partyName'] ?? ''}'),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: action, autofocus: true, maxLines: 3, decoration: InputDecoration(
            labelText: tr('ماذا حدث؟', 'What happened?'),
            hintText: tr('كلّمتُ المحاسب، قال يسدّد الخميس بعد الجرد…', 'Spoke to their accountant — paying Thursday…'))),
        const SizedBox(height: 8),
        TextField(controller: collected, keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: tr('المبلغ المحصَّل', 'Amount collected'), hintText: '0')),
        const SizedBox(height: 8),
        TextField(controller: notes, decoration: InputDecoration(labelText: tr('ملاحظة', 'Note'))),
        const SizedBox(height: 8),
        Text(tr('الحفظ يُعلّم المهمّة «تمّت» — كتابةُ ما حدث تعني أنّها حدثت.', 'Saving marks the task done — writing what happened says it happened.'),
            style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
      ])),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
      ],
    ));
    if (ok != true) return;
    await _mark(t, {
      'action': action.text,
      'notes': notes.text,
      'collected': num.tryParse(collected.text.replaceAll(',', '')) ?? 0,
      'status': 'Done',
    });
  }

  Future<void> _add() async {
    final saved = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, useSafeArea: true,
      builder: (_) => _NewTaskSheet(myName: _myName, officers: _officers),
    );
    if (saved == true) _load();
  }

  String _typeLabel(String v) {
    for (final t in _requestTypes) { if (t.$1 == v) return tr(t.$2, t.$3); }
    return v.isEmpty ? tr('مهمة', 'task') : v;
  }

  String _dayLabel(String day) {
    final d = DateTime.tryParse(day);
    if (d == null) return day;
    const arDays = ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
    const enDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    return '${tr(arDays[d.weekday - 1], enDays[d.weekday - 1])} ${d.day}/${d.month}';
  }

  @override
  Widget build(BuildContext context) {
    final canEdit = collectionsCanEdit;
    final byDay = <String, List<Map<String, dynamic>>>{};
    for (final t in _rows) { byDay.putIfAbsent('${t['date'] ?? ''}', () => []).add(t); }
    final days = byDay.keys.toList()..sort((a, b) => b.compareTo(a));
    final done = _rows.where((r) => r['status'] == 'Done').length;

    return AppScaffold(
      title: Text(tr('الخطة اليومية', 'Daily plan')),
      floatingActionButton: canEdit
          ? FloatingActionButton.extended(onPressed: _add, backgroundColor: T.orange, icon: const Icon(Icons.add), label: Text(tr('مهمة جديدة', 'New task')))
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 90), children: [
          Text(tr('مَن يُزار اليوم ومَن يُتَّصل به — وما الذي حدث فعلًا.', 'Who gets visited or called today — and what actually happened.'),
              style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
          const SizedBox(height: 10),
          AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final p in _presets)
                ChoiceChip(
                  label: Text(tr(p.$2, p.$3)), selected: _preset == p.$1,
                  selectedColor: T.orange, labelStyle: TextStyle(color: _preset == p.$1 ? Colors.white : T.inkSoft, fontWeight: FontWeight.w600, fontSize: 12.5),
                  onSelected: (_) { final r = p.$4(); setState(() { _from = _ymd(r.$1); _to = _ymd(r.$2); _preset = p.$1; }); _load(); },
                ),
            ]),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: OutlinedButton.icon(onPressed: () => _pickDate(true), icon: const Icon(Icons.event, size: 16), label: Text('${tr('من', 'From')} $_from', style: const TextStyle(fontSize: 12)))),
              const SizedBox(width: 6),
              Expanded(child: OutlinedButton.icon(onPressed: () => _pickDate(false), icon: const Icon(Icons.event, size: 16), label: Text('${tr('إلى', 'To')} $_to', style: const TextStyle(fontSize: 12)))),
            ]),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: _officer, isExpanded: true,
              decoration: InputDecoration(labelText: tr('الموظف', 'Officer'), isDense: true),
              items: [
                DropdownMenuItem(value: '', child: Text(tr('كل الفريق', 'Whole team'))),
                for (final o in _officers) DropdownMenuItem(value: o, child: Text(o, overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) { setState(() => _officer = v ?? ''); _load(); },
            ),
            const SizedBox(height: 8),
            Wrap(spacing: 6, runSpacing: 6, children: [
              Chip2('${tr('مهام', 'Tasks')}: ${_rows.length}', T.navy),
              Chip2('${tr('تمّت', 'Done')}: $done', T.info),
              Chip2('${tr('حُصِّل', 'Collected')}: ${_m(_collected)}', T.success),
            ]),
          ])),
          if (_busy) const LinearProgressIndicator(minHeight: 2, color: T.orange),
          const SizedBox(height: 10),
          if (_loading)
            const Shimmer(height: 140)
          else if (_error != null)
            ErrorRetry(message: _error!, onRetry: _load)
          else if (days.isEmpty)
            EmptyState(icon: Icons.event_busy_outlined, title: tr('لا مهام في هذه الفترة', 'No tasks in this range'))
          else
            for (final day in days) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 8, 4, 6),
                child: Row(children: [
                  Expanded(child: Text(_dayLabel(day), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                  Text('${byDay[day]!.length} ${tr('مهمة', 'tasks')}', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                ]),
              ),
              for (final t in byDay[day]!) _taskCard(t, canEdit),
            ],
        ]),
      ),
    );
  }

  Widget _taskCard(Map<String, dynamic> t, bool canEdit) {
    final isDone = t['status'] == 'Done';
    final party = t['party'] is Map ? '${(t['party'] as Map)['_id'] ?? ''}' : '${t['party'] ?? ''}';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        topAccent: isDone ? null : T.orange,
        padding: const EdgeInsets.fromLTRB(12, 10, 6, 10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Chip2(_typeLabel('${t['requestType'] ?? ''}'), isDone ? T.success : T.inkSoft),
            const SizedBox(width: 8),
            Expanded(
              child: InkWell(
                onTap: party.isEmpty ? null : () => Navigator.push(context, MaterialPageRoute(builder: (_) => CollectionsPartyScreen(id: party))),
                child: Text.rich(TextSpan(children: [
                  if ('${t['partyCode'] ?? ''}'.isNotEmpty) TextSpan(text: '${t['partyCode']} ', style: const TextStyle(fontSize: 11, color: T.inkFaint, fontFamily: 'monospace')),
                  TextSpan(text: '${t['partyName'] ?? ''}', style: TextStyle(fontWeight: FontWeight.w700, color: party.isEmpty ? T.ink : T.orange)),
                ])),
              ),
            ),
          ]),
          const SizedBox(height: 4),
          Row(children: [
            Expanded(child: Text('${(t['officerName'] ?? '').toString().isNotEmpty ? t['officerName'] : tr('مدير القسم', 'Dept. manager')}',
                style: const TextStyle(fontSize: 12, color: T.inkFaint))),
            if (t['collected'] is num && t['collected'] != 0)
              Text(_m(t['collected']), style: const TextStyle(fontSize: 12.5, color: T.success, fontWeight: FontWeight.w800)),
            if (canEdit) ...[
              TextButton.icon(
                onPressed: () => _openLog(t),
                icon: const Icon(Icons.rate_review_outlined, size: 16, color: T.orange),
                label: Text(tr('ما حدث', 'Log'), style: const TextStyle(color: T.orange, fontSize: 12)),
              ),
              if (!isDone)
                IconButton(tooltip: tr('تم', 'Mark done'), onPressed: () => _mark(t, {'status': 'Done'}), icon: const Icon(Icons.check, color: T.success, size: 20)),
              IconButton(tooltip: tr('حذف', 'Delete'), onPressed: () => _remove(t), icon: const Icon(Icons.delete_outline, color: T.inkFaint, size: 20)),
            ],
          ]),
          if ('${t['action'] ?? ''}'.isNotEmpty || '${t['notes'] ?? ''}'.isNotEmpty)
            Container(
              margin: const EdgeInsets.only(top: 4),
              padding: const EdgeInsetsDirectional.only(start: 8),
              decoration: const BoxDecoration(border: BorderDirectional(start: BorderSide(color: T.line, width: 2))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if ('${t['action'] ?? ''}'.isNotEmpty) Text('${t['action']}', style: const TextStyle(fontSize: 13, color: T.inkSoft)),
                if ('${t['notes'] ?? ''}'.isNotEmpty) Text('${t['notes']}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
              ]),
            ),
        ]),
      ),
    );
  }
}

/// New task: the customer is searched in the aging register, and the employee starts from the typed name.
class _NewTaskSheet extends StatefulWidget {
  final String myName;
  final List<String> officers;
  const _NewTaskSheet({required this.myName, required this.officers});
  @override
  State<_NewTaskSheet> createState() => _NewTaskSheetState();
}

class _NewTaskSheetState extends State<_NewTaskSheet> {
  final _q = TextEditingController();
  final _notes = TextEditingController();
  List<Map<String, dynamic>> _hits = [];
  String _party = '', _partyName = '';
  String _date = _ymd(_today());
  String _type = 'Visit';
  late String _officerName = widget.myName;
  Timer? _deb;
  int _seq = 0;
  bool _pending = false; // A search in progress: "no results" is not shown before the reply.
  bool _saving = false;
  String _err = '';

  @override
  void dispose() { _deb?.cancel(); _q.dispose(); _notes.dispose(); super.dispose(); }

  void _search(String v) {
    setState(() { _party = ''; _partyName = ''; });
    _deb?.cancel();
    // Clearing invalidates any reply still in flight.
    if (v.trim().isEmpty) { _seq++; setState(() { _hits = []; _pending = false; }); return; }
    setState(() => _pending = true);
    _deb = Timer(const Duration(milliseconds: 350), () async {
      final mine = ++_seq;
      try {
        final d = await Api.instance.get('/api/collections-dept/ledger/aging?search=${Uri.encodeQueryComponent(v)}&limit=8');
        if (mounted && mine == _seq) setState(() { _hits = List<Map<String, dynamic>>.from(d['rows'] ?? const []); _pending = false; });
      } catch (_) {
        if (mounted && mine == _seq) setState(() { _hits = []; _pending = false; });
      }
    });
  }

  Future<void> _save() async {
    if (_party.isEmpty) return;
    setState(() { _saving = true; _err = ''; });
    try {
      await Api.instance.post('/api/collections-dept/ledger/tasks', {
        'party': _party, 'partyName': _partyName, 'date': _date, 'requestType': _type,
        'officerName': _officerName, 'action': '', 'notes': _notes.text,
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { _saving = false; _err = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final officers = {if (widget.myName.isNotEmpty) widget.myName, ...widget.officers, if (_officerName.isNotEmpty) _officerName}.toList();
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        Text(tr('مهمة جديدة', 'New task'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
        const SizedBox(height: 12),
        if (_party.isNotEmpty)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.business_outlined, color: T.orange),
            title: Text(_partyName, style: const TextStyle(fontWeight: FontWeight.w700)),
            trailing: IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() { _party = ''; _partyName = ''; })),
          )
        else ...[
          SearchField(controller: _q, onChanged: _search, autofocus: true,
              hint: tr('ابحث بالاسم أو الكود…', 'Search name or code…')),
          if (_hits.isEmpty && !_pending && _q.text.trim().isNotEmpty)
            Padding(padding: const EdgeInsets.all(12), child: Text(tr('لا نتائج مطابقة', 'No matches'), style: const TextStyle(color: T.inkFaint))),
          for (final h in _hits)
            ListTile(
              dense: true,
              title: Text('${h['name'] ?? ''}'),
              subtitle: '${h['code'] ?? ''}'.isEmpty ? null : Text('${h['code']}', style: const TextStyle(fontFamily: 'monospace', fontSize: 11)),
              onTap: () => setState(() {
                _party = '${h['_id']}'; _partyName = '${h['name'] ?? ''}'; _hits = [];
                if (_officerName.isEmpty) _officerName = '${h['effectiveOfficer'] ?? h['collectionOfficer'] ?? ''}';
              }),
            ),
        ],
        const SizedBox(height: 10),
        OutlinedButton.icon(
          onPressed: () async {
            final v = await showDatePicker(context: context, initialDate: DateTime.tryParse(_date) ?? _today(), firstDate: DateTime(2020), lastDate: DateTime(2035));
            if (v != null) setState(() => _date = _ymd(v));
          },
          icon: const Icon(Icons.event, size: 16),
          label: Text('${tr('التاريخ', 'Date')}: $_date'),
        ),
        const SizedBox(height: 10),
        DropdownButtonFormField<String>(
          initialValue: _type,
          decoration: InputDecoration(labelText: tr('نوع التواصل', 'Type')),
          items: [for (final t in _requestTypes) DropdownMenuItem(value: t.$1, child: Text(tr(t.$2, t.$3)))],
          onChanged: (v) => setState(() => _type = v ?? 'Visit'),
        ),
        const SizedBox(height: 10),
        DropdownButtonFormField<String>(
          initialValue: _officerName.isEmpty ? null : _officerName, isExpanded: true,
          decoration: InputDecoration(labelText: tr('الموظف', 'Officer'), hintText: tr('مسؤول الحساب', 'account owner')),
          items: [for (final o in officers) DropdownMenuItem(value: o, child: Text(o, overflow: TextOverflow.ellipsis))],
          onChanged: (v) => setState(() => _officerName = v ?? ''),
        ),
        const SizedBox(height: 10),
        TextField(controller: _notes, maxLines: 2, decoration: InputDecoration(
            labelText: tr('ملاحظة (اختياري)', 'Note (optional)'),
            hintText: tr('ما المطلوب في هذه الزيارة؟ أو ما اتُّفق عليه سابقًا…', 'What is this visit for? What was agreed before?…'))),
        if (_err.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_err, style: const TextStyle(color: T.danger, fontSize: 12.5))),
        const SizedBox(height: 14),
        FilledButton(
          onPressed: _party.isEmpty || _saving ? null : _save,
          style: FilledButton.styleFrom(backgroundColor: T.orange),
          child: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(tr('حفظ', 'Save')),
        ),
      ])),
    );
  }
}
