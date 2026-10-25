import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'collections_party.dart';

// ═════════════════════════════════════════════════════════════════════════
// سجلُّ أعمار الديون — نظيرُ components/collections/AgingPage.
// صفٌّ لكلّ حساب: كودُه ومَن يتولّاه وتقييمُه، وحدُّه وكم استُهلك منه، ومهلتُه،
// ثمّ دَينُه موزَّعًا على شرائح العمر. الشرائحُ أزرارُ فلترة، والفلاترُ (الموظّف،
// التقييم، القسم، الفرع، المهلة) والفرزُ (ومنه «المستهلك من الحد») على الخادم،
// والتصديرُ للصفحة أو لكلّ نتائج الفلتر. والصفُّ يفتح ملفَّ الحساب.
// ═════════════════════════════════════════════════════════════════════════

String _s(Map r, String k) => '${r[k] ?? ''}';
num _num(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;
String _m(dynamic n) => _num(n).round().toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');

const bandLabels = {
  '15-': ('حتى 15 يومًا', 'Up to 15 days'),
  '30-': ('15 – 30 يومًا', '15 – 30 days'),
  '45-': ('30 – 45 يومًا', '30 – 45 days'),
  '60-': ('45 – 60 يومًا', '45 – 60 days'),
  '60+': ('60 – 90 يومًا', '60 – 90 days'),
  '90+': ('90 – 120 يومًا', '90 – 120 days'),
  '120+': ('120 يومًا – سنة', '120 days – 1 year'),
  '1Y+': ('أكثر من سنة', 'Over a year'),
  'noDate': ('بلا تاريخ', 'No date'),
};
String bandLabel(String k) => bandLabels[k] != null ? tr(bandLabels[k]!.$1, bandLabels[k]!.$2) : k;

Color _limitColor(dynamic pct) {
  if (pct == null) return T.inkFaint;
  final n = _num(pct);
  return n >= 100 ? T.danger : n >= 80 ? T.warn : T.success;
}

class CollectionsAgingScreen extends StatefulWidget {
  const CollectionsAgingScreen({super.key});
  @override
  State<CollectionsAgingScreen> createState() => _CollectionsAgingScreenState();
}

class _CollectionsAgingScreenState extends State<CollectionsAgingScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _totals = {};
  List<String> _bands = [];
  Map<String, List<String>> _opts = {};
  bool _loading = true, _busy = false;
  String? _error;
  int _page = 1, _pages = 1, _total = 0, _seq = 0;
  String _search = '', _officer = '', _grade = '', _department = '', _location = '', _creditDays = '', _band = '';
  String _sort = 'outstanding', _dir = 'desc';
  Timer? _deb;
  Timer? _searchDeb; // مؤقِّتُ البحث مستقلٌّ — كان التحديثُ الحيّ يُلغي بحثًا مُنتظِرًا
  final _searchCtl = TextEditingController(); // النصُّ يبقى مطابقًا لـ_search
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    Api.instance.get('/api/collections-dept/ledger/aging/filters').then((d) {
      if (!mounted || d is! Map) return;
      setState(() => _opts = {
            for (final k in ['officers', 'grades', 'departments', 'locations', 'creditDays']) k: [for (final x in (d[k] as List? ?? const [])) '$x'],
          });
    }).catchError((_) {});
    _onLive = () {
      _deb?.cancel();
      _deb = Timer(const Duration(milliseconds: 800), () => _load(background: true));
    };
    Live.instance.on('collections:party', _onLive);
    Live.instance.on('collections:changed', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('collections:party', _onLive);
    Live.instance.off('collections:changed', _onLive);
    _deb?.cancel();
    _searchDeb?.cancel();
    _searchCtl.dispose();
    super.dispose();
  }

  List<String> _params() => [
        if (_search.isNotEmpty) 'search=${Uri.encodeQueryComponent(_search)}',
        if (_officer.isNotEmpty) 'officer=${Uri.encodeQueryComponent(_officer)}',
        if (_grade.isNotEmpty) 'grade=${Uri.encodeQueryComponent(_grade)}',
        if (_department.isNotEmpty) 'department=${Uri.encodeQueryComponent(_department)}',
        if (_location.isNotEmpty) 'hoLocation=${Uri.encodeQueryComponent(_location)}',
        if (_creditDays.isNotEmpty) 'creditDays=$_creditDays',
        if (_band.isNotEmpty) 'band=${Uri.encodeQueryComponent(_band)}',
        'sort=$_sort', 'dir=$_dir',
      ];

  Future<void> _load({bool background = false}) async {
    final mine = ++_seq;
    if (!background) setState(() => _busy = true);
    try {
      final d = await Api.instance.get('/api/collections-dept/ledger/aging?${[..._params(), 'page=$_page', 'limit=50'].join('&')}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = [for (final r in (d['rows'] as List? ?? const [])) Map<String, dynamic>.from(r as Map)];
        _totals = Map<String, dynamic>.from((d['totals'] as Map?) ?? const {});
        _bands = [for (final b in (d['bands'] as List? ?? const [])) b is Map ? '${b['key']}' : '$b'];
        _total = _num(d['total']).toInt();
        _pages = _num(d['pages']).toInt().clamp(1, 1 << 30);
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e is ApiException ? e.message : '$e');
    } finally {
      if (mounted) setState(() { _busy = false; _loading = false; });
    }
  }

  void _refilter() { _page = 1; _load(); }

  List<String> get _ageBands => _bands.where((b) => b != 'noDate').toList();
  bool get _active => [_search, _officer, _grade, _department, _location, _creditDays, _band].any((x) => x.isNotEmpty);

  List<ExportCol> get _cols => [
        ExportCol('الكود', 'Code', (r) => r['code']),
        ExportCol('الحساب', 'Account', (r) => r['name']),
        ExportCol('موظف التحصيل', 'Officer', (r) => r['effectiveOfficer']),
        ExportCol('الفرع', 'Location', (r) => r['hoLocation']),
        ExportCol('التقييم', 'Grade', (r) => r['grade']),
        ExportCol('القسم', 'Department', (r) => r['department']),
        ExportCol('مندوب المبيعات', 'Sales', (r) => (r['salesManagers'] as List? ?? const []).join(' / ')),
        ExportCol('الحد الائتماني', 'Credit limit', (r) => r['creditLimit']),
        ExportCol('مهلة السداد', 'Credit days', (r) => r['creditDays']),
        ExportCol('إجمالي المديونية', 'Outstanding', (r) => r['outstanding']),
        ExportCol('منها ضريبي', 'of which tax', (r) => r['taxOutstanding']),
        ExportCol('منها نقدي', 'of which cash', (r) => r['cashOutstanding']),
        for (final b in _ageBands)
          ExportCol(bandLabels[b]?.$1 ?? b, bandLabels[b]?.$2 ?? b, (r) => _num(((r['bands'] as Map?) ?? const {})[b])),
      ];

  /// الصفحةُ وحدَها، أو كلُّ نتائج الفلتر من الخادم — يُسمّى النطاقُ باسمه.
  Future<void> _export() async {
    final scope = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(title: Text(tr('هذه الصفحة (${_rows.length})', 'This page (${_rows.length})')), onTap: () => Navigator.pop(c, 'page')),
          ListTile(title: Text(tr('كل نتائج الفلتر ($_total)', 'All matching ($_total)')), onTap: () => Navigator.pop(c, 'all')),
        ]),
      ),
    );
    if (scope == null || !mounted) return;
    var rows = _rows;
    if (scope == 'all') {
      try {
        final d = await Api.instance.get('/api/collections-dept/ledger/aging?${[..._params(), 'page=1', 'limit=5000'].join('&')}');
        rows = [for (final r in (d['rows'] as List? ?? const [])) Map<String, dynamic>.from(r as Map)];
      } catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : '$e')));
        return;
      }
    }
    if (!mounted) return;
    await exportExcel(context, fileName: tr('أعمار-الديون', 'aging'), sheets: [(tr('أعمار الديون', 'Aging'), _cols, rows)]);
  }

  Future<void> _pick(String title, List<String> opts, String cur, void Function(String) set, {String Function(String)? label}) async {
    final v = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(c).size.height * 0.7),
          child: ListView(shrinkWrap: true, children: [
            ListTile(title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800))),
            ListTile(title: Text(tr('الكل', 'All')), onTap: () => Navigator.pop(c, '')),
            for (final o in opts)
              ListTile(title: Text(label != null ? label(o) : o), trailing: cur == o ? const Icon(Icons.check, color: T.orange) : null, onTap: () => Navigator.pop(c, o)),
          ]),
        ),
      ),
    );
    if (v == null) return;
    setState(() => set(v));
    _refilter();
  }

  Future<void> _pickSort() async {
    const sorts = [
      ('outstanding', 'المديونية', 'Outstanding'),
      ('limitUsedPct', 'المستهلك من الحد', 'Limit used'),
      ('creditLimit', 'الحد', 'Limit'),
      ('creditDays', 'مهلة السداد', 'Terms'),
      ('name', 'الحساب', 'Account'),
      ('code', 'الكود', 'Code'),
    ];
    final v = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          for (final s in sorts)
            ListTile(
              title: Text(tr(s.$2, s.$3)),
              trailing: _sort == s.$1 ? Icon(_dir == 'desc' ? Icons.arrow_downward : Icons.arrow_upward, color: T.orange) : null,
              onTap: () => Navigator.pop(c, s.$1),
            ),
        ]),
      ),
    );
    if (v == null) return;
    setState(() { if (_sort == v) { _dir = _dir == 'desc' ? 'asc' : 'desc'; } else { _sort = v; _dir = 'desc'; } });
    _refilter();
  }

  Widget _filterChip(String label, String value, List<String> opts, void Function(String) set, {String Function(String)? fmt}) => Padding(
        padding: const EdgeInsetsDirectional.only(end: 6),
        child: InputChip(
          label: Text(value.isEmpty ? label : '$label: ${fmt != null ? fmt(value) : value}'),
          selected: value.isNotEmpty,
          onPressed: () => _pick(label, opts, value, set, label: fmt),
          onDeleted: value.isEmpty ? null : () { setState(() => set('')); _refilter(); },
        ),
      );

  Widget _card(Map<String, dynamic> r) {
    final bands = (r['bands'] as Map?) ?? const {};
    final pct = r['limitUsedPct'];
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Pressable(
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => CollectionsPartyScreen(id: _s(r, '_id')))),
        child: AppCard(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(_s(r, 'name'), style: const TextStyle(fontWeight: FontWeight.w800))),
              Text(_m(r['outstanding']), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
            ]),
            Text([
              _s(r, 'code'),
              '${_s(r, 'effectiveOfficer').isNotEmpty ? _s(r, 'effectiveOfficer') : (_s(r, 'collectionOfficer').isNotEmpty ? _s(r, 'collectionOfficer') : tr('مدير القسم', 'Dept. manager'))}'
                  '${r['officerIsDefault'] == true ? ' (${tr('مدير القسم', 'manager')})' : ''}',
              _s(r, 'hoLocation'), _s(r, 'department'),
            ].where((x) => x.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            if (_num(r['cashOutstanding']) > 0 && _num(r['taxOutstanding']) > 0)
              Text(tr('ضريبي ${_m(r['taxOutstanding'])} · نقدي ${_m(r['cashOutstanding'])}', 'tax ${_m(r['taxOutstanding'])} · cash ${_m(r['cashOutstanding'])}'),
                  style: const TextStyle(fontSize: 11, color: T.inkFaint))
            else if (_num(r['cashOutstanding']) > 0)
              Text(tr('نقدي', 'cash'), style: const TextStyle(fontSize: 11, color: T.success)),
            const SizedBox(height: 6),
            // ── استهلاكُ الحدّ: يُقرأ في السطر — قرارٌ قبل الشحنة التالية ───────
            if (_num(r['creditLimit']) > 0) ...[
              Row(children: [
                Expanded(
                  child: LinearProgressIndicator(
                    value: (_num(pct) / 100).clamp(0, 1).toDouble(), minHeight: 6,
                    color: _limitColor(pct), backgroundColor: _limitColor(pct).withValues(alpha: 0.12),
                  ),
                ),
                const SizedBox(width: 8),
                Text('${pct == null ? '—' : '${_num(pct).round()}%'} ${tr('من', 'of')} ${_m(r['creditLimit'])}',
                    style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: _limitColor(pct))),
              ]),
              const SizedBox(height: 6),
            ],
            Wrap(spacing: 6, runSpacing: 4, children: [
              if (_s(r, 'grade').isNotEmpty) Chip2(_s(r, 'grade'), T.cyan),
              if (_num(r['creditDays']) > 0) Chip2(tr('${r['creditDays']} يومًا', '${r['creditDays']}d'), T.navy),
              if ((r['salesManagers'] as List? ?? const []).isNotEmpty) Chip2((r['salesManagers'] as List).join(' / '), T.inkSoft),
              for (final b in _ageBands)
                if (_num(bands[b]) != 0) Chip2('${bandLabel(b)}: ${_m(bands[b])}', b == '120+' || b == '1Y+' ? T.danger : b == '60+' || b == '90+' ? T.warn : T.inkSoft),
            ]),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final tb = (_totals['bands'] as Map?) ?? const {};
    final hasNoDate = _num(tb['noDate']) != 0;
    return AppScaffold(
      title: Text(tr('أعمار الديون', 'Aging')),
      actions: [
        IconButton(tooltip: tr('ترتيب', 'Sort'), icon: const Icon(Icons.swap_vert_rounded), onPressed: _pickSort),
        IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _rows.isEmpty ? null : _export),
      ],
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null && _rows.isEmpty
              ? ErrorRetry(message: _error!, onRetry: _load)
              : Column(children: [
                  if (_busy) const LinearProgressIndicator(minHeight: 2),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(padding: const EdgeInsets.all(12), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                        // البطاقاتُ تعكس الفلترَ النشط.
                        Row(children: [
                          for (final c in [
                            (tr('حسابات', 'Accounts'), _m(_total), T.ink),
                            (tr('إجمالي المديونية', 'Outstanding'), _m(_totals['outstanding']), T.danger),
                          ])
                            Expanded(child: Padding(
                              padding: const EdgeInsetsDirectional.only(end: 6),
                              child: AppCard(padding: const EdgeInsets.all(10), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(c.$1, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                Text(c.$2, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: c.$3)),
                              ])),
                            )),
                        ]),
                        const SizedBox(height: 6),
                        Row(children: [
                          for (final c in [
                            (tr('عدد الفواتير', 'Open invoices'), _m(_totals['invoices'])),
                            (tr('إجمالي الحدود', 'Credit limits'), _m(_totals['creditLimit'])),
                          ])
                            Expanded(child: Padding(
                              padding: const EdgeInsetsDirectional.only(end: 6),
                              child: AppCard(padding: const EdgeInsets.all(10), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(c.$1, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                Text(c.$2, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
                              ])),
                            )),
                        ]),
                        const SizedBox(height: 10),
                        // ── الشرائحُ أزرارُ فلترة ─────────────────────────────
                        Wrap(spacing: 6, runSpacing: 6, children: [
                          ChoiceChip(label: Text('${tr('الكل', 'All')} · ${_m(_totals['outstanding'])}'), selected: _band.isEmpty,
                              onSelected: (_) { setState(() => _band = ''); _refilter(); }),
                          for (final b in _ageBands)
                            ChoiceChip(label: Text('${bandLabel(b)} · ${_m(tb[b])}'), selected: _band == b,
                                onSelected: (_) { setState(() => _band = _band == b ? '' : b); _refilter(); }),
                          if (hasNoDate)
                            ChoiceChip(
                              avatar: const Icon(Icons.warning_amber_rounded, size: 16, color: T.warn),
                              label: Text('${tr('بلا تاريخ', 'No date')} · ${_m(tb['noDate'])}'), selected: _band == 'noDate',
                              onSelected: (_) { setState(() => _band = _band == 'noDate' ? '' : 'noDate'); _refilter(); }),
                        ]),
                        const SizedBox(height: 10),
                        SearchField(
                          controller: _searchCtl,
                          dense: true,
                          hint: tr('ابحث بالاسم أو الكود أو الموظف…', 'Search name, code, officer…'),
                          onChanged: (v) {
                            _searchDeb?.cancel();
                            _searchDeb = Timer(const Duration(milliseconds: 350), () { _search = v.trim(); _refilter(); });
                          },
                        ),
                        const SizedBox(height: 8),
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(children: [
                            _filterChip(tr('موظف التحصيل', 'Officer'), _officer, _opts['officers'] ?? const [], (v) => _officer = v),
                            _filterChip(tr('الفرع', 'Location'), _location, _opts['locations'] ?? const [], (v) => _location = v),
                            _filterChip(tr('التقييم', 'Grade'), _grade, _opts['grades'] ?? const [], (v) => _grade = v),
                            _filterChip(tr('القسم', 'Department'), _department, _opts['departments'] ?? const [], (v) => _department = v),
                            _filterChip(tr('مهلة السداد', 'Credit days'), _creditDays, _opts['creditDays'] ?? const [], (v) => _creditDays = v,
                                fmt: (d) => tr('$d يومًا', '$d days')),
                            if (_active)
                              TextButton.icon(
                                onPressed: () {
                                  _searchDeb?.cancel();
                                  _searchCtl.clear();
                                  setState(() { _search = ''; _officer = ''; _grade = ''; _department = ''; _location = ''; _creditDays = ''; _band = ''; });
                                  _refilter();
                                },
                                icon: const Icon(Icons.filter_alt_off_outlined, color: T.danger),
                                label: Text(tr('مسح', 'Clear'), style: const TextStyle(color: T.danger)),
                              ),
                          ]),
                        ),
                        const SizedBox(height: 8),
                        if (_rows.isEmpty)
                          EmptyState(icon: Icons.layers_outlined, title: _active ? tr('لا نتائج للفلتر المحدد', 'No rows match the filters') : tr('لا حسابات', 'No accounts')),
                        for (final r in _rows) _card(r),
                        if (_pages > 1)
                          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                            OutlinedButton(onPressed: _page <= 1 ? null : () { setState(() => _page--); _load(); }, child: Text(tr('السابق', 'Prev'))),
                            Text(tr('صفحة $_page من $_pages · $_total حسابًا', 'Page $_page of $_pages · $_total accounts'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                            OutlinedButton(onPressed: _page >= _pages ? null : () { setState(() => _page++); _load(); }, child: Text(tr('التالي', 'Next'))),
                          ]),
                      ]),
                    ),
                  ),
                ]),
    );
  }
}
