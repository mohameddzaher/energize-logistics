import 'dart:async';
import 'package:flutter/material.dart';
import '../resource/configs.dart' show collectionsCanEdit;
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'collections_party.dart';
import 'ls2_common.dart' show ls2ExportMenu;

/// Team: each collection employee's performance and who handles which account (like the web page /system/collections-dept/team). Both panels are on one screen on purpose: the decision after reading the evaluation is moving accounts from one employee to another.
class CollectionsTeamScreen extends StatefulWidget {
  const CollectionsTeamScreen({super.key});
  @override
  State<CollectionsTeamScreen> createState() => _CollectionsTeamScreenState();
}

String _ymd(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
String _m(dynamic n) {
  final v = (n is num) ? n : num.tryParse('$n') ?? 0;
  final s = v.round().abs().toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');
  return v < 0 ? '-$s' : s;
}
/// Officer name; unassigned accounts belong to the section manager (officerLabel on the web).
String _officerLabel(Map r) {
  for (final k in ['effectiveOfficer', 'collectionOfficer', 'officer']) {
    final v = '${r[k] ?? ''}';
    if (v.isNotEmpty) return v;
  }
  return tr('مدير القسم', 'Dept. manager');
}
Color _gradeColor(String g) {
  final k = g.toUpperCase();
  if (k.startsWith('A')) return T.success;
  if (k.startsWith('B')) return T.warn;
  if (k.startsWith('C')) return T.danger;
  return T.inkSoft;
}

class _CollectionsTeamScreenState extends State<CollectionsTeamScreen> {
  List<Map<String, dynamic>> _perf = [];
  List<Map<String, dynamic>> _team = [];
  List<Map<String, dynamic>> _rows = [];
  String _managerName = '';
  bool _loading = true;
  String? _error;
  String _from = '', _to = '';
  String _officerFilter = '';
  String _search = '';
  final _searchCtl = TextEditingController(); // Text stays equal to _search if the field leaves the screen.
  final Set<String> _sel = {};
  String _assignTo = '';
  bool _saving = false;
  String _msg = '';
  int _perfSeq = 0, _rowsSeq = 0;
  Timer? _deb;

  @override
  void initState() {
    super.initState();
    Future.wait([_loadPerf(), _loadRows()]).whenComplete(() { if (mounted) setState(() => _loading = false); });
  }

  @override
  void dispose() { _deb?.cancel(); _searchCtl.dispose(); super.dispose(); }

  Future<void> _loadPerf() async {
    final mine = ++_perfSeq;
    try {
      final p = [
        if (_from.isNotEmpty) 'from=$_from',
        if (_to.isNotEmpty) 'to=$_to',
        if (_officerFilter.isNotEmpty) 'officer=${Uri.encodeQueryComponent(_officerFilter)}',
      ].join('&');
      final res = await Future.wait([
        Api.instance.get('/api/collections-dept/ledger/performance?$p'),
        Api.instance.get('/api/collections-dept/ledger/team'),
      ]);
      if (!mounted || mine != _perfSeq) return;
      setState(() {
        _perf = List<Map<String, dynamic>>.from(res[0]['rows'] ?? const []);
        _team = List<Map<String, dynamic>>.from(res[1]['officers'] ?? const []);
        _managerName = '${(res[1]['manager'] as Map?)?['name'] ?? ''}';
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _perfSeq) setState(() => _error = e.toString());
    }
  }

  Future<void> _loadRows() async {
    final mine = ++_rowsSeq;
    try {
      final p = [
        'limit=500',
        if (_search.isNotEmpty) 'search=${Uri.encodeQueryComponent(_search)}',
        if (_officerFilter.isNotEmpty) 'officer=${Uri.encodeQueryComponent(_officerFilter)}',
      ].join('&');
      final d = await Api.instance.get('/api/collections-dept/ledger/aging?$p');
      if (!mounted || mine != _rowsSeq) return;
      setState(() => _rows = List<Map<String, dynamic>>.from(d['rows'] ?? const []));
    } catch (_) {/* Existing rows remain. */}
  }

  List<String> get _officers {
    final s = {for (final t in _team) if ('${t['officer'] ?? ''}'.isNotEmpty) '${t['officer']}'}.toList()..sort();
    return s;
  }

  Future<void> _pickDate(bool from) async {
    final cur = DateTime.tryParse(from ? _from : _to) ?? DateTime.now();
    final v = await showDatePicker(context: context, initialDate: cur, firstDate: DateTime(2020), lastDate: DateTime(2035));
    if (v == null) return;
    setState(() { if (from) { _from = _ymd(v); } else { _to = _ymd(v); } });
    _loadPerf();
  }

  Future<void> _assign() async {
    if (_sel.isEmpty) return;
    setState(() { _saving = true; _msg = ''; });
    try {
      final r = await Api.instance.put('/api/collections-dept/ledger/team/assign', {'parties': _sel.toList(), 'officer': _assignTo});
      // Leaving the name empty removes the assignment, so the account returns to the section manager.
      final to = _assignTo.isNotEmpty
          ? _assignTo
          : (_managerName.isNotEmpty ? '$_managerName (${tr('مدير القسم', 'dept. manager')})' : tr('مدير القسم', 'the dept. manager'));
      setState(() { _msg = tr('نُقل ${r['updated']} حسابًا إلى $to', '${r['updated']} accounts moved to $to'); _sel.clear(); });
      await Future.wait([_loadPerf(), _loadRows()]);
    } catch (e) {
      setState(() => _msg = e.toString());
    }
    if (mounted) setState(() => _saving = false);
  }

  /// Opens an employee's accounts, or those with no officer, like the web link to the customer register.
  void _openAccounts(String officer) => Navigator.push(context, MaterialPageRoute(
      builder: (_) => _OfficerAccountsScreen(officer: officer.isEmpty ? 'none' : officer)));

  // Export columns: the web columns in the same order and values.
  List<ExportCol> get _assignCols => [
        ExportCol('الكود', 'Code', (r) => r['code'] ?? ''),
        ExportCol('الحساب', 'Account', (r) => r['name'] ?? ''),
        ExportCol('المسؤول الحالي', 'Current officer', (r) => _officerLabel(r)),
        ExportCol('غير مُسنَد (عند مدير القسم)', 'Unassigned (with manager)', (r) => r['officerIsDefault'] == true ? tr('نعم', 'Yes') : ''),
        ExportCol('التقييم', 'Grade', (r) => r['grade'] ?? ''),
        ExportCol('المديونية', 'Outstanding', (r) => r['outstanding'] ?? 0),
      ];

  List<ExportCol> get _perfCols => [
        ExportCol('الموظف', 'Officer', (r) => _officerLabel({'officer': r['officer']})),
        ExportCol('حسابات', 'Accounts', (r) => r['accounts']),
        ExportCol('محصَّل', 'Collected', (r) => r['collectedAmount']),
        ExportCol('عدد المحصَّل', 'Invoices', (r) => r['collectedCount']),
        ExportCol('باقٍ', 'Outstanding', (r) => r['openAmount']),
        ExportCol('متأخر', 'Past due', (r) => r['overdueAmount']),
        ExportCol('منه متقادم 60ي+', 'of which aged 60d+', (r) => r['agedOver60Amount']),
        ExportCol('في المهلة', 'Within terms (amount)', (r) => r['withinTermsAmount']),
        ExportCol('نسبة التحصيل %', 'Collection rate %', (r) => r['collectionRate'] is num ? (r['collectionRate'] as num).round() : ''),
        ExportCol('في المهلة %', 'Within terms %', (r) => r['withinTermsRate'] is num ? (r['withinTermsRate'] as num).round() : ''),
        ExportCol('متقادم 60ي+ %', 'Aged 60d+ %', (r) => r['agedOver60Rate'] is num ? (r['agedOver60Rate'] as num).round() : ''),
        ExportCol('متوسط أيام التحصيل', 'Avg days to collect', (r) => r['avgDaysToCollect']),
        ExportCol('مهام منجزة', 'Tasks done', (r) => r['tasksDone']),
        ExportCol('إجمالي المهام', 'Tasks total', (r) => r['tasks']),
      ];

  Widget _rate(String label, dynamic v, Color Function(num) colorOf, {String? hint}) {
    final has = v is num;
    return Tooltip(
      message: hint ?? '',
      child: Column(children: [
        Text(has ? '${v.round()}%' : '—', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: has ? colorOf(v) : T.inkFaint)),
        Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
      ]),
    );
  }

  Widget _perfCard(Map<String, dynamic> r) {
    final officer = '${r['officer'] ?? ''}';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          InkWell(
            onTap: () => _openAccounts(officer),
            child: Row(children: [
              Expanded(child: Text.rich(TextSpan(children: [
                TextSpan(text: _officerLabel(r), style: const TextStyle(fontWeight: FontWeight.w800, color: T.orange)),
                if (_managerName.isNotEmpty && officer == _managerName)
                  TextSpan(text: '  ${tr('مدير القسم — ومعه ما لم يُسنَد', 'manager — incl. unassigned')}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
              ]))),
              Chip2('${r['accounts'] ?? 0} ${tr('حساب', 'accounts')}', T.navy),
            ]),
          ),
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, children: [
            Chip2('${tr('محصَّل', 'Collected')} ${_m(r['collectedAmount'])} (${r['collectedCount'] ?? 0})', T.success),
            Chip2('${tr('باقٍ', 'Outstanding')} ${_m(r['openAmount'])}', T.ink),
            Chip2('${tr('متأخر', 'Past due')} ${_m(r['overdueAmount'])}', T.danger),
            Chip2('${tr('المهام', 'Tasks')} ${r['tasksDone'] ?? 0}/${r['tasks'] ?? 0}', T.inkSoft),
            Chip2('${tr('متوسط أيام التحصيل', 'Avg days')} ${r['avgDaysToCollect'] ?? '—'}', T.info),
          ]),
          const SizedBox(height: 8),
          Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
            _rate(tr('نسبة التحصيل', 'Collection rate'), r['collectionRate'], (v) => v >= 80 ? T.success : v >= 50 ? T.warn : T.danger,
                hint: tr('ما حُصِّل ÷ (ما حُصِّل + ما تأخّر عن أجله). المال الذي لم يحن موعدُه خارج الحساب.', 'Collected ÷ (collected + past due).')),
            _rate(tr('في المهلة', 'Within terms'), r['withinTermsRate'], (v) => v >= 60 ? T.success : v >= 35 ? T.warn : T.danger,
                hint: tr('كم من الرصيد المفتوح لم يحن موعدُ سداده بعد', 'Share of the open book still within terms')),
            _rate(tr('متقادم 60ي+', 'Aged 60d+'), r['agedOver60Rate'], (v) => v <= 20 ? T.success : v <= 40 ? T.warn : T.danger,
                hint: tr('كم من المتأخّر جاوز 60 يومًا بعد أجله', 'Share of past-due money more than 60 days late')),
          ]),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final canEdit = collectionsCanEdit;
    final officers = _officers;
    final allSel = _rows.isNotEmpty && _rows.every((r) => _sel.contains('${r['_id']}'));
    return AppScaffold(
      title: Text(tr('الفريق', 'The team')),
      actions: [
        // Both panels export, as on the web: team evaluation, account assignment, or both in one file.
        IconButton(
          tooltip: tr('تصدير Excel', 'Export to Excel'),
          icon: const Icon(Icons.file_download_outlined),
          onPressed: () async {
            final assign = (tr('إسناد الحسابات', 'Assignment'), _assignCols, _rows);
            final perf = (tr('تقييم الفريق', 'Team'), _perfCols, _perf);
            await ls2ExportMenu(context, fileName: tr('الفريق', 'team'), options: [
              ('تقييم الفريق', 'Team performance', [perf]),
              ('إسناد الحسابات', 'Account assignment', [assign]),
              ('الاثنان معًا', 'Both', [perf, assign]),
            ]);
          },
        ),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 200)])
          : RefreshIndicator(
              onRefresh: () => Future.wait([_loadPerf(), _loadRows()]),
              child: ListView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 40), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                Text(tr('أداءُ كل موظف تحصيل، ومَن يتولّى أي عميل.', 'How each collection officer is doing, and who handles which customer.'),
                    style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
                if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: ErrorRetry(message: _error!, onRetry: _loadPerf)),
                const SizedBox(height: 10),
                // Evaluation
                Row(children: [
                  const Icon(Icons.trending_up, color: T.orange, size: 18),
                  const SizedBox(width: 6),
                  Text(tr('تقييم الفريق', 'Team performance'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)),
                ]),
                const SizedBox(height: 8),
                Row(children: [
                  Expanded(child: OutlinedButton.icon(onPressed: () => _pickDate(true), icon: const Icon(Icons.event, size: 16),
                      label: Text(_from.isEmpty ? tr('من', 'From') : _from, style: const TextStyle(fontSize: 12)))),
                  const SizedBox(width: 6),
                  Expanded(child: OutlinedButton.icon(onPressed: () => _pickDate(false), icon: const Icon(Icons.event, size: 16),
                      label: Text(_to.isEmpty ? tr('إلى', 'To') : _to, style: const TextStyle(fontSize: 12)))),
                  if (_from.isNotEmpty || _to.isNotEmpty)
                    IconButton(onPressed: () { setState(() { _from = ''; _to = ''; }); _loadPerf(); }, icon: const Icon(Icons.clear, size: 18)),
                ]),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: _officerFilter, isExpanded: true,
                  decoration: InputDecoration(labelText: tr('الموظف', 'Officer'), isDense: true),
                  items: [
                    DropdownMenuItem(value: '', child: Text(tr('كل الفريق', 'Whole team'))),
                    for (final o in officers) DropdownMenuItem(value: o, child: Text(o, overflow: TextOverflow.ellipsis)),
                  ],
                  onChanged: (v) { setState(() => _officerFilter = v ?? ''); _loadPerf(); _loadRows(); },
                ),
                const SizedBox(height: 10),
                if (_perf.isEmpty)
                  EmptyState(icon: Icons.groups_outlined, title: tr('لا بيانات', 'No data'))
                else
                  for (final r in _perf) _perfCard(r),

                // Assignment
                if (canEdit) ...[
                  const SizedBox(height: 14),
                  Row(children: [
                    const Icon(Icons.manage_accounts_outlined, color: T.orange, size: 18),
                    const SizedBox(width: 6),
                    Expanded(child: Text(tr('إسناد الحسابات', 'Assign accounts'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5))),
                    TextButton(
                      onPressed: () => setState(() { if (allSel) { _sel.clear(); } else { _sel.addAll(_rows.map((r) => '${r['_id']}')); } }),
                      child: Text(allSel ? tr('إلغاء التحديد', 'Clear') : tr('تحديد الكل', 'Select all')),
                    ),
                  ]),
                  SearchField(
                    controller: _searchCtl,
                    dense: true,
                    onChanged: (v) { _deb?.cancel(); _deb = Timer(const Duration(milliseconds: 350), () { _search = v.trim(); _loadRows(); }); },
                    hint: tr('ابحث عن حساب…', 'Find an account…'),
                  ),
                  if (_sel.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    AppCard(
                      padding: const EdgeInsets.all(10),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        Text(tr('${_sel.length} محدَّد', '${_sel.length} selected'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                        const SizedBox(height: 6),
                        Autocomplete<String>(
                          optionsBuilder: (v) => officers.where((o) => o.toLowerCase().contains(v.text.toLowerCase())),
                          onSelected: (v) => _assignTo = v,
                          fieldViewBuilder: (c, ctrl, focus, onSubmit) => TextField(
                            controller: ctrl, focusNode: focus,
                            onChanged: (v) => _assignTo = v.trim(),
                            decoration: InputDecoration(labelText: tr('اسم الموظف (فارغ = مدير القسم)', 'Officer (blank = dept. manager)'), isDense: true),
                          ),
                        ),
                        const SizedBox(height: 8),
                        FilledButton.icon(
                          onPressed: _saving ? null : _assign,
                          style: FilledButton.styleFrom(backgroundColor: T.orange),
                          icon: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.check),
                          label: Text(tr('إسناد', 'Assign')),
                        ),
                      ]),
                    ),
                  ],
                  if (_msg.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_msg, style: const TextStyle(color: T.success, fontSize: 12.5))),
                  const SizedBox(height: 8),
                  if (_rows.isEmpty && _search.isNotEmpty)
                    Padding(padding: const EdgeInsets.all(16), child: Center(child: Text(tr('لا نتائج مطابقة', 'No matches'), style: const TextStyle(color: T.inkFaint)))),
                  for (final r in _rows)
                    Card(
                      margin: const EdgeInsets.only(bottom: 6),
                      color: _sel.contains('${r['_id']}') ? T.orange.withValues(alpha: 0.06) : null,
                      child: CheckboxListTile(
                        dense: true,
                        activeColor: T.orange,
                        value: _sel.contains('${r['_id']}'),
                        onChanged: (v) => setState(() { final id = '${r['_id']}'; if (v == true) { _sel.add(id); } else { _sel.remove(id); } }),
                        title: Text('${r['name'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                          if ('${r['code'] ?? ''}'.isNotEmpty) Text('${r['code']}', style: const TextStyle(fontFamily: 'monospace', fontSize: 11)),
                          Text(_officerLabel(r) + (r['officerIsDefault'] == true ? ' ${tr('(مدير القسم — غير مُسنَد)', '(manager — unassigned)')}' : ''),
                              style: const TextStyle(fontSize: 11.5)),
                          if ('${r['grade'] ?? ''}'.isNotEmpty) Chip2('${r['grade']}', _gradeColor('${r['grade']}')),
                          Text(_m(r['outstanding']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
                        ]),
                      ),
                    ),
                ],
              ]),
            ),
    );
  }
}

/// One employee's accounts, or "no officer" (`officer=none`), from the customer register.
class _OfficerAccountsScreen extends StatefulWidget {
  final String officer;
  const _OfficerAccountsScreen({required this.officer});
  @override
  State<_OfficerAccountsScreen> createState() => _OfficerAccountsScreenState();
}

class _OfficerAccountsScreenState extends State<_OfficerAccountsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/collections-dept/parties?kind=customer&page=1&limit=500&officer=${Uri.encodeQueryComponent(widget.officer)}');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['parties'] ?? const []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final label = widget.officer == 'none' ? tr('مدير القسم', 'Dept. manager') : widget.officer;
    return AppScaffold(
      title: Text(tr('حسابات $label', "$label's accounts")),
      actions: [
        ExportButton(
          fileName: tr('حسابات-$label', '$label-accounts'),
          columns: [
            ExportCol('الكود', 'Code', (r) => r['code']),
            ExportCol('العميل', 'Customer', (r) => r['name']),
            ExportCol('المسؤول', 'Officer', (r) => _officerLabel(r)),
            ExportCol('المستحق', 'Outstanding', (r) => r['outstanding']),
          ],
          rows: () => _rows,
        ),
      ],
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: _load)
              : _rows.isEmpty
                  ? EmptyState(icon: Icons.people_outline, title: tr('لا حسابات', 'No accounts'))
                  : ListView.builder(
                      padding: const EdgeInsets.all(12),
                      itemCount: _rows.length,
                      itemBuilder: (_, i) {
                        final r = _rows[i];
                        return Card(
                          margin: const EdgeInsets.only(bottom: 6),
                          child: ListTile(
                            title: Text('${r['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                            subtitle: Text([r['code'], r['city']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ')),
                            trailing: Text(_m(r['outstanding']), style: const TextStyle(fontWeight: FontWeight.w800, color: T.danger)),
                            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => CollectionsPartyScreen(id: '${r['_id']}'))),
                          ),
                        );
                      },
                    ),
    );
  }
}
